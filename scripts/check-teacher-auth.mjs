import assert from 'node:assert/strict';

// Load the real backend in local preview; OAuth and Firestore calls below are controlled seams.
globalThis.location = { hostname: 'localhost', search: '?backend=local' };
globalThis.sessionStorage = { getItem: () => 'test-device', setItem() {} };
globalThis.window = {};
const { FirebaseBackend } = await import('../public/backend.js');

function fixture({ linkError, failBatch = false, sessionCount = 2 } = {}) {
  const auth = { currentUser: { uid: 'old-teacher', isAnonymous: true } };
  const targetUser = { uid: 'google-teacher', isAnonymous: false, email: 'teacher@example.test' };
  const sessions = new Map(Array.from({ length: sessionCount }, (_, index) => [`CLASS${index}`, {
    ownerUid: 'old-teacher', className: `반 ${index}`, groupCount: 25, participationMode: 'individual', phase: 'compare',
    groups: { 25: { v1: { evidence: '기존 학생 근거', lines: [] } } }
  }]));
  sessions.set('OTHER', { ownerUid: 'another-teacher', className: '다른 교사' });
  sessions.set('GOOGLE', { ownerUid: targetUser.uid, className: '이미 연결된 수업' });
  const events = [];
  const modules = {
    GoogleAuthProvider: class { setCustomParameters() {} static credentialFromError() { return { test: true }; } },
    linkWithPopup: async () => {
      if (linkError) throw { code: linkError };
      auth.currentUser = { ...targetUser, uid: auth.currentUser.uid };
      return { user: auth.currentUser };
    },
    initializeApp: () => ({}), getAuth: () => ({}), inMemoryPersistence: 'memory',
    setPersistence: async (_, persistence) => assert.equal(persistence, 'memory'),
    signInWithCredential: async (selectedAuth) => {
      if (selectedAuth === auth) { events.push('sign-in-main'); auth.currentUser = targetUser; }
      return { user: targetUser };
    },
    collection: (_, name) => name,
    where: (field, op, value) => ({ field, op, value }),
    query: (name, filter) => ({ name, filter }),
    getDocs: async ({ name, filter }) => {
      assert.equal(name, 'sessions'); assert.deepEqual(filter, { field: 'ownerUid', op: '==', value: 'old-teacher' });
      const docs = [...sessions].filter(([, data]) => data.ownerUid === filter.value).map(([id]) => ({ ref: id }));
      return { docs, empty: docs.length === 0 };
    },
    writeBatch: () => {
      const changes = [];
      return {
        update: (id, patch) => changes.push([id, patch]),
        commit: async () => {
          events.push('commit');
          assert(changes.length <= 10);
          if (failBatch) throw new Error('simulated offline');
          for (const [id, patch] of changes) Object.assign(sessions.get(id), patch);
        }
      };
    },
    serverTimestamp: () => 'updated-time', deleteApp: async () => events.push('cleanup'),
    onSnapshot: (collection, callback) => {
      assert.equal(collection, 'sessions');
      callback({ docs: [...sessions].map(([id, data]) => ({ id, data: () => data })) });
      return () => {};
    }
  };
  return { backend: new FirebaseBackend(modules, auth, {}, auth.currentUser), auth, sessions, events };
}

const fresh = fixture();
await fresh.backend.signInTeacher();
assert.equal(fresh.backend.currentUid, 'old-teacher');
assert.equal(fresh.backend.user.isAnonymous, false);
assert.equal(fresh.events.length, 0, 'First Google link must preserve the existing UID and records');

const existing = fixture({ linkError: 'auth/credential-already-in-use', sessionCount: 25 });
const recordsBefore = structuredClone(existing.sessions.get('CLASS24'));
await existing.backend.signInTeacher();
assert.equal(existing.backend.currentUid, 'google-teacher');
assert.equal(existing.events.filter((event) => event === 'commit').length, 3);
assert(existing.events.indexOf('sign-in-main') > existing.events.lastIndexOf('commit'));
assert.deepEqual(existing.sessions.get('CLASS24'), { ...recordsBefore, ownerUid: 'google-teacher', updatedAt: 'updated-time' });
assert.equal(existing.sessions.get('OTHER').ownerUid, 'another-teacher');
let recovered;
existing.backend.watchTeacherSessions((sessions) => { recovered = sessions; });
assert.equal(recovered.length, 27, 'DB history must include all saved sessions without an account filter');
assert(recovered.some((session) => session.ownerUid === 'another-teacher'));

const offline = fixture({ linkError: 'auth/credential-already-in-use', failBatch: true });
await assert.rejects(offline.backend.signInTeacher(), /simulated offline/);
assert.equal(offline.auth.currentUser.uid, 'old-teacher');
assert.equal(offline.sessions.get('CLASS0').ownerUid, 'old-teacher');
assert(!offline.events.includes('sign-in-main'));
assert(offline.events.includes('cleanup'));

const cancelled = fixture({ linkError: 'auth/popup-closed-by-user' });
await assert.rejects(cancelled.backend.signInTeacher(), (error) => error.code === 'auth/popup-closed-by-user');
assert.equal(cancelled.sessions.get('CLASS0').ownerUid, 'old-teacher');
console.log('Teacher auth checks passed: initial link, existing-account merge (25 classes), all-session DB list, offline preservation, popup cancellation.');
