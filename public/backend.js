import { firebaseConfig } from './firebase-config.js';

const localPreview = ['localhost', '127.0.0.1'].includes(location.hostname)
  && new URLSearchParams(location.search).get('backend') === 'local';
const configured = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId) && !localPreview;
const uidKey = 'plate-boundary-device-id';
let uid = sessionStorage.getItem(uidKey);
if (!uid) {
  uid = crypto.randomUUID();
  sessionStorage.setItem(uidKey, uid);
}

const clone = (value) => value == null ? value : JSON.parse(JSON.stringify(value));
const nowIso = () => new Date().toISOString();
const normalizeCode = (code) => String(code || '').trim().toUpperCase();
const randomCode = () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let result = '';
  crypto.getRandomValues(new Uint8Array(6)).forEach((number) => {
    result += chars[number % chars.length];
  });
  return result;
};

class LocalBackend {
  constructor() {
    this.isCloud = false;
    this.currentUid = uid;
    this.channel = 'BroadcastChannel' in window ? new BroadcastChannel('plate-boundary-local') : null;
  }

  get store() {
    return JSON.parse(localStorage.getItem('plate-boundary-local-db') || '{"sessions":{}}');
  }

  write(store) {
    localStorage.setItem('plate-boundary-local-db', JSON.stringify(store));
    this.channel?.postMessage({ type: 'change', at: Date.now() });
    window.dispatchEvent(new Event('plate-boundary-local-change'));
  }

  async createSession() {
    const store = this.store;
    let code = randomCode();
    while (store.sessions[code]) code = randomCode();
    store.sessions[code] = {
      code,
      ownerUid: this.currentUid,
      groupCount: 6,
      phase: 'explore',
      showBoundaries: false,
      showKoreaDetail: false,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      groups: {}
    };
    this.write(store);
    return code;
  }

  async getSession(code) {
    return clone(this.store.sessions[normalizeCode(code)] || null);
  }

  async updateSession(code, changes) {
    const key = normalizeCode(code);
    const store = this.store;
    const session = store.sessions[key];
    if (!session) throw new Error('수업을 찾을 수 없습니다.');
    if (session.ownerUid !== this.currentUid) throw new Error('이 수업을 제어할 권한이 없습니다.');
    Object.assign(session, clone(changes), { updatedAt: nowIso() });
    this.write(store);
  }

  async claimGroup(code, group) {
    const key = normalizeCode(code);
    const groupKey = String(group);
    const store = this.store;
    const session = store.sessions[key];
    if (!session) throw new Error('수업 코드를 확인해 주세요.');
    const existing = session.groups[groupKey];
    if (existing && existing.ownerUid !== this.currentUid) throw new Error('이미 다른 기기에서 선택한 모둠입니다.');
    session.groups[groupKey] = existing || {
      ownerUid: this.currentUid,
      group: Number(group),
      status: 'connected',
      connectedAt: nowIso()
    };
    this.write(store);
    return clone(session.groups[groupKey]);
  }

  async getGroup(code, group) {
    return clone(this.store.sessions[normalizeCode(code)]?.groups[String(group)] || null);
  }

  async saveSubmission(code, group, payload) {
    const key = normalizeCode(code);
    const groupKey = String(group);
    const store = this.store;
    const target = store.sessions[key]?.groups[groupKey];
    if (!target || target.ownerUid !== this.currentUid) throw new Error('모둠 참여 정보를 다시 확인해 주세요.');
    Object.assign(target, clone(payload), { updatedAt: nowIso() });
    this.write(store);
  }

  async clearGroupSubmission(code, group) {
    const key = normalizeCode(code);
    const groupKey = String(group);
    const store = this.store;
    const session = store.sessions[key];
    if (!session) throw new Error('수업을 찾을 수 없습니다.');
    if (session.ownerUid !== this.currentUid) throw new Error('이 수업을 제어할 권한이 없습니다.');
    const target = session.groups[groupKey];
    if (!target) return false;
    delete target.v1;
    delete target.v2;
    delete target.application;
    delete target.principleUnlocked;
    Object.assign(target, { status: 'connected', updatedAt: nowIso() });
    this.write(store);
    return true;
  }

  async clearSubmissions(code) {
    const key = normalizeCode(code);
    const store = this.store;
    const session = store.sessions[key];
    if (!session) throw new Error('수업을 찾을 수 없습니다.');
    if (session.ownerUid !== this.currentUid) throw new Error('이 수업을 제어할 권한이 없습니다.');
    const targets = Object.values(session.groups || {});
    targets.forEach((target) => {
      delete target.v1;
      delete target.v2;
      delete target.application;
      delete target.principleUnlocked;
      Object.assign(target, { status: 'connected', updatedAt: nowIso() });
    });
    if (targets.length) this.write(store);
    return targets.length;
  }

  watchSession(code, callback) {
    const key = normalizeCode(code);
    const emit = () => callback(clone(this.store.sessions[key] || null));
    emit();
    const handler = () => emit();
    window.addEventListener('storage', handler);
    window.addEventListener('plate-boundary-local-change', handler);
    this.channel?.addEventListener('message', handler);
    return () => {
      window.removeEventListener('storage', handler);
      window.removeEventListener('plate-boundary-local-change', handler);
      this.channel?.removeEventListener('message', handler);
    };
  }

  watchGroups(code, callback) {
    return this.watchSession(code, (session) => callback(
      session ? Object.values(session.groups || {}).sort((a, b) => a.group - b.group) : []
    ));
  }
}

class FirebaseBackend {
  constructor(modules, auth, db, user) {
    Object.assign(this, modules);
    this.auth = auth;
    this.db = db;
    this.user = user;
    this.currentUid = user.uid;
    this.isCloud = true;
  }

  async createSession() {
    let code = randomCode();
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const ref = this.doc(this.db, 'sessions', code);
      const snapshot = await this.getDoc(ref);
      if (!snapshot.exists()) {
        await this.setDoc(ref, {
          code,
          ownerUid: this.currentUid,
          groupCount: 6,
          phase: 'explore',
          showBoundaries: false,
          showKoreaDetail: false,
          createdAt: this.serverTimestamp(),
          updatedAt: this.serverTimestamp()
        });
        return code;
      }
      code = randomCode();
    }
    throw new Error('수업 코드를 만들지 못했습니다. 다시 시도해 주세요.');
  }

  async getSession(code) {
    const snapshot = await this.getDoc(this.doc(this.db, 'sessions', normalizeCode(code)));
    return snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null;
  }

  async updateSession(code, changes) {
    await this.updateDoc(this.doc(this.db, 'sessions', normalizeCode(code)), {
      ...changes,
      updatedAt: this.serverTimestamp()
    });
  }

  async claimGroup(code, group) {
    const sessionCode = normalizeCode(code);
    const ref = this.doc(this.db, 'sessions', sessionCode, 'groups', String(group));
    return this.runTransaction(this.db, async (transaction) => {
      const snapshot = await transaction.get(ref);
      if (snapshot.exists() && snapshot.data().ownerUid !== this.currentUid) {
        throw new Error('이미 다른 기기에서 선택한 모둠입니다.');
      }
      if (!snapshot.exists()) {
        transaction.set(ref, {
          ownerUid: this.currentUid,
          group: Number(group),
          status: 'connected',
          connectedAt: this.serverTimestamp()
        });
      }
      return snapshot.exists() ? snapshot.data() : { ownerUid: this.currentUid, group: Number(group), status: 'connected' };
    });
  }

  async getGroup(code, group) {
    const snapshot = await this.getDoc(this.doc(this.db, 'sessions', normalizeCode(code), 'groups', String(group)));
    return snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null;
  }

  async saveSubmission(code, group, payload) {
    await this.setDoc(
      this.doc(this.db, 'sessions', normalizeCode(code), 'groups', String(group)),
      { ...payload, updatedAt: this.serverTimestamp() },
      { merge: true }
    );
  }

  submissionReset() {
    return {
      v1: this.deleteField(),
      v2: this.deleteField(),
      application: this.deleteField(),
      principleUnlocked: this.deleteField(),
      status: 'connected',
      updatedAt: this.serverTimestamp()
    };
  }

  async clearGroupSubmission(code, group) {
    const ref = this.doc(this.db, 'sessions', normalizeCode(code), 'groups', String(group));
    const snapshot = await this.getDoc(ref);
    if (!snapshot.exists()) return false;
    await this.updateDoc(ref, this.submissionReset());
    return true;
  }

  async clearSubmissions(code) {
    const snapshot = await this.getDocs(this.collection(this.db, 'sessions', normalizeCode(code), 'groups'));
    if (snapshot.empty) return 0;
    const batch = this.writeBatch(this.db);
    snapshot.docs.forEach((item) => batch.update(item.ref, this.submissionReset()));
    await batch.commit();
    return snapshot.size;
  }

  watchSession(code, callback, onError = console.error) {
    return this.onSnapshot(
      this.doc(this.db, 'sessions', normalizeCode(code)),
      (snapshot) => callback(snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null),
      onError
    );
  }

  watchGroups(code, callback, onError = console.error) {
    return this.onSnapshot(
      this.collection(this.db, 'sessions', normalizeCode(code), 'groups'),
      (snapshot) => callback(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })).sort((a, b) => a.group - b.group)),
      onError
    );
  }
}

async function initializeBackend() {
  if (!configured) return new LocalBackend();

  const appModule = await import('https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js');
  const authModule = await import('https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js');
  const firestoreModule = await import('https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js');
  const app = appModule.initializeApp(firebaseConfig);
  const auth = authModule.getAuth(app);
  const credential = await authModule.signInAnonymously(auth);
  const db = firestoreModule.getFirestore(app);

  return new FirebaseBackend({
    ...firestoreModule
  }, auth, db, credential.user);
}

export const backend = await initializeBackend();
