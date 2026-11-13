import { backend, participantCount, participantLabel } from './backend.js?v=20261019-4';
import { PlateMap, setupEarthquakeTimeline } from './map-app.js?v=20261019-4';

const $ = (selector) => document.querySelector(selector);
const colors = ['#ff5d35', '#2a7fff', '#13a17d', '#b640da', '#e9a51b', '#e93873', '#627f24'];
const map = new PlateMap('teacher-map', { drawing: false, showBaseData: true });
if (['localhost', '127.0.0.1'].includes(location.hostname)) globalThis.__plateTeacherMap = map;
let sessionCode = null;
let currentSession = null;
let groups = [];
let visibility = {};
let toastTimer = null;
let stopSessionWatch = null;
let stopGroupsWatch = null;
let teacherTimelineController = null;
let submissionChapter = 'all';
const teacherLayerVisibility = {
  earthquakes: localStorage.getItem('plate-teacher-layer-earthquakes') !== 'false',
  volcanoes: localStorage.getItem('plate-teacher-layer-volcanoes') !== 'false'
};
let teacherSessions = [];
let stopTeacherSessionsWatch = null;
const canManageSession = () => currentSession?.ownerUid === backend.currentUid;
const canReadSubmissions = () => canManageSession() || ['compare', 'reveal', 'eastAsia', 'closed'].includes(currentSession?.phase);

const phaseNames = {
  explore: '학생 탐구 진행 중',
  compare: '모둠 경계선 비교',
  reveal: '실제 판 경계 공개',
  eastAsia: '일본·한반도 적용',
  closed: '수업 종료'
};

function toast(message) {
  const element = $('#teacher-toast');
  element.textContent = message;
  element.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => element.classList.remove('is-visible'), 2600);
}

function setTeacherLayer(name, visible) {
  teacherLayerVisibility[name] = visible;
  localStorage.setItem(`plate-teacher-layer-${name}`, String(visible));
  map.setLayer(name, visible);
  const button = $(`#teacher-toggle-${name}`);
  const label = name === 'earthquakes' ? '지진' : '화산';
  button.classList.toggle('is-active', visible);
  button.setAttribute('aria-pressed', String(visible));
  button.querySelector('b').textContent = `${label} ${visible ? '켜짐' : '꺼짐'}`;
  if (name === 'earthquakes') {
    const timeline = $('[data-earthquake-timeline]');
    timeline.classList.toggle('is-disabled', !visible);
    timeline.querySelectorAll('button, input').forEach((control) => { control.disabled = !visible; });
    if (!visible) teacherTimelineController?.pause();
  }
}

function hasSubmission(group) {
  return Boolean(group?.v1 || group?.v2);
}

// v2는 옛 2단계 제출 데이터 호환용. 현재는 v1 단일 제출만 쓴다.

function hasStoredWork(group) {
  return hasSubmission(group) || Boolean(group?.application);
}

function groupStatusLabel(group) {
  if (group?.v1 || group?.v2) return '제출 완료';
  if (group) return '접속';
  return '접속 전';
}

function renderGroups(nextGroups) {
  groups = nextGroups;
  const byGroup = Object.fromEntries(groups.map((group) => [group.group, group]));
  const finalOrInitial = groups.filter(hasSubmission).length;
  $('#submitted-total').textContent = `${currentSession && !canReadSubmissions() ? '—' : finalOrInitial}/${participantCount(currentSession)}`;
  $('#reset-submissions').disabled = !canManageSession() || !groups.some(hasStoredWork);
  const individual = currentSession?.participationMode === 'individual';
  $('#submission-heading').textContent = individual ? '개별 제출 현황' : '모둠 제출 현황';
  $('#drawer-toggle span').textContent = individual ? '학생 근거 보기' : '모둠 근거 보기';
  $('#group-status-list').classList.toggle('is-individual', individual);
  $('#group-status-list').innerHTML = Array.from({ length: participantCount(currentSession) }, (_, index) => {
    const number = index + 1;
    const group = byGroup[number];
    const hidden = visibility[number] === false;
    const submitted = hasStoredWork(group);
    return `
      <div class="group-status-row">
        <button class="group-status group-visibility" data-group="${number}" type="button" title="지도에서 ${participantLabel(currentSession, number)} 선 켜기/끄기" style="border:1px solid ${hidden ? 'transparent' : colors[index % colors.length] + '55'};opacity:${hidden ? '.45' : '1'}">
          <span style="background:${colors[index % colors.length]}">${number}</span>
          <div><b>${participantLabel(currentSession, number)}</b><small>${groupStatusLabel(group)}</small></div>
        </button>
        <button class="delete-submission" data-delete-group="${number}" type="button" ${submitted && canManageSession() ? '' : 'disabled'} aria-label="${participantLabel(currentSession, number)} 제출 삭제" title="${submitted ? `${participantLabel(currentSession, number)} 제출 삭제` : '제출 없음'}">×</button>
      </div>
    `;
  }).join('');
  $('#group-status-list').querySelectorAll('.group-visibility').forEach((button) => {
    button.addEventListener('click', () => {
      const group = Number(button.dataset.group);
      visibility[group] = visibility[group] === false;
      renderGroups(groups);
    });
  });
  $('#group-status-list').querySelectorAll('[data-delete-group]').forEach((button) => {
    button.addEventListener('click', () => clearGroupSubmission(Number(button.dataset.deleteGroup)));
  });

  map.showSubmissions(groups, visibility, submissionChapter, currentSession?.participationMode === 'individual' ? '번' : '모둠');
  $('#evidence-list').innerHTML = groups.length ? groups.map((group) => {
    const version = group.v1 || group.v2;
    const answers = group.application;
    return `
      <article class="evidence-item">
        <span style="background:${colors[(group.group - 1) % colors.length]}">${group.group}</span>
        <div>
          <p>${escapeHtml(version?.evidence || '근거 입력 전')}</p>
          <small>${participantLabel(currentSession, group.group)} · ${groupStatusLabel(group)}${answers ? ` · 적용 ${answers.density}/${answers.near}/${answers.intraplate}` : ''}</small>
        </div>
      </article>
    `;
  }).join('') : '<p style="padding:10px;color:#657581;font-size:11px">아직 참여자가 없습니다.</p>';
}

async function clearGroupSubmission(groupNumber) {
  if (!sessionCode) return toast('먼저 수업 코드를 만들어 주세요.');
  if (!hasStoredWork(groups.find((group) => group.group === groupNumber))) return;
  if (!confirm(`${participantLabel(currentSession, groupNumber)}의 제출 경계선과 근거를 삭제할까요?\n학생은 다시 제출할 수 있습니다.`)) return;
  try {
    await backend.clearGroupSubmission(sessionCode, groupNumber);
    visibility[groupNumber] = true;
    toast(`${participantLabel(currentSession, groupNumber)}의 제출을 삭제했습니다.`);
  } catch (error) {
    toast(error.message || '제출을 삭제하지 못했습니다.');
  }
}

async function clearAllSubmissions() {
  if (!sessionCode) return toast('먼저 수업 코드를 만들어 주세요.');
  const count = groups.filter(hasStoredWork).length;
  if (!count) return;
  if (!confirm(`이 수업의 제출 ${count}건을 모두 초기화할까요?\n이 작업은 되돌릴 수 없습니다.`)) return;
  const button = $('#reset-submissions');
  button.disabled = true;
  try {
    await backend.clearSubmissions(sessionCode);
    visibility = {};
    toast('모든 제출을 초기화했습니다.');
  } catch (error) {
    toast(error.message || '전체 제출을 초기화하지 못했습니다.');
    button.disabled = false;
  }
}

async function restartSession() {
  if (!sessionCode) return toast('먼저 반 수업을 열어 주세요.');
  const className = currentSession?.className || '현재 반';
  if (!confirm(`${className}의 새 수업을 시작할까요?\n고정 코드 ${sessionCode}는 유지되고, 이전 참여·제출 기록은 모두 삭제됩니다.`)) return;
  const button = $('#restart-session');
  button.disabled = true;
  button.textContent = '새 수업 준비 중…';
  try {
    await backend.restartSession(sessionCode);
    visibility = {};
    toast(`${sessionCode} 코드로 새 수업을 시작했습니다.`);
  } catch (error) {
    toast(error.message || '새 수업을 시작하지 못했습니다.');
  } finally {
    button.disabled = false;
    button.textContent = '같은 코드로 새 수업 시작';
  }
}

function escapeHtml(value) {
  const element = document.createElement('div');
  element.textContent = value;
  return element.innerHTML;
}

function getClassProfiles() {
  return teacherSessions.map((session) => ({
    name: session.className || session.code, code: session.code,
    detail: `${session.participationMode === 'individual' ? '개별 활동' : '모둠 활동'} · ${phaseNames[session.phase] || '수업 준비'}`
  }))
    .sort((first, second) => first.name.localeCompare(second.name, 'ko', { numeric: true }));
}

function watchTeacherSessions() {
  stopTeacherSessionsWatch?.();
  $('#class-list-status').textContent = '수업 목록 불러오는 중…';
  stopTeacherSessionsWatch = backend.watchTeacherSessions((sessions) => {
    teacherSessions = sessions;
    renderClassProfiles();
    $('#class-list-status').textContent = getClassProfiles().length ? '' : '저장된 수업이 없습니다.';
  }, () => {
    $('#class-list-status').textContent = '수업 목록을 불러오지 못했습니다. 연결을 확인한 뒤 새로고침해 주세요.';
  });
}

function renderTeacherAccount() {
  const signedIn = backend.isCloud && !backend.user.isAnonymous;
  $('#teacher-account-status').textContent = backend.isCloud
    ? signedIn ? backend.user.email || 'Google 계정 연결됨' : '수업 목록은 로그인 없이 불러옵니다.'
    : '로컬 시연 모드';
  $('#teacher-sign-in').classList.toggle('is-hidden', signedIn || !backend.isCloud);
  $('#teacher-sign-out').classList.toggle('is-hidden', !signedIn);
  $('#teacher-account-guide').textContent = !backend.isCloud
    ? '로컬 시연은 이 브라우저 안에서만 작동합니다. 실제 사이트에서는 DB의 수업 목록을 불러옵니다.'
    : signedIn
      ? '연결한 계정의 수업을 관리할 수 있습니다. 저장된 수업 목록은 계정과 관계없이 표시됩니다.'
      : '다른 컴퓨터에서 수업을 제어하려면 기존 수업을 만든 브라우저에서 계정을 연결하세요. 목록 조회에는 필요하지 않습니다.';
}

async function signInTeacher() {
  const button = $('#teacher-sign-in');
  button.disabled = true;
  button.textContent = '계정 연결 중…';
  stopSessionWatch?.();
  stopGroupsWatch?.();
  stopTeacherSessionsWatch?.();
  try {
    await backend.signInTeacher();
    location.reload();
  } catch (error) {
    const messages = {
      'auth/popup-closed-by-user': '로그인을 취소했습니다. 기존 수업은 그대로 유지됩니다.',
      'auth/popup-blocked': '로그인 팝업이 차단되었습니다. 팝업을 허용한 뒤 다시 눌러 주세요.',
      'auth/operation-not-allowed': 'Google 로그인 설정을 확인해 주세요.',
      'auth/network-request-failed': '인터넷 연결을 확인한 뒤 다시 로그인해 주세요.'
    };
    toast(messages[error.code] || '계정을 연결하지 못했습니다. 다시 로그인해 주세요.');
    renderTeacherAccount();
    watchTeacherSessions();
    await resumeSession();
    button.disabled = false;
    button.textContent = 'Google로 로그인·기존 수업 연결';
  }
}

async function signOutTeacher() {
  const button = $('#teacher-sign-out');
  button.disabled = true;
  try {
    await backend.signOutTeacher();
    localStorage.removeItem('plate-teacher-session');
    localStorage.removeItem('plate-teacher-classes');
    location.reload();
  } catch {
    toast('로그아웃하지 못했습니다. 다시 시도해 주세요.');
    button.disabled = false;
  }
}

function renderClassProfiles() {
  const root = $('#saved-classes');
  const profiles = getClassProfiles();
  root.classList.toggle('is-hidden', !profiles.length);
  root.innerHTML = profiles.map((profile) => `
    <div class="saved-class-row">
      <button class="saved-class-open" data-class-code="${escapeHtml(profile.code)}" data-class-name="${escapeHtml(profile.name)}" type="button"><span>${escapeHtml(profile.name)}<small>${escapeHtml(profile.detail)}</small></span><b>${escapeHtml(profile.code)}</b></button>
    </div>
  `).join('');
  root.querySelectorAll('[data-class-code]').forEach((button) => {
    button.addEventListener('click', () => openClassSession(button.dataset.className, button.dataset.classCode));
  });

}

function updateSessionView(session) {
  currentSession = session;
  const canManage = canManageSession();
  $('#session-access').textContent = canManage ? '수업 관리 가능' : '저장된 수업 조회 중 · 수업 제어는 관리자만 가능합니다.';
  $('#restart-session').disabled = !canManage;
  document.querySelectorAll('.control-stack button').forEach((button) => { button.disabled = !canManage; });
  $('#group-status-list').classList.toggle('is-hidden', !canReadSubmissions());
  $('#submission-access').classList.toggle('is-hidden', canReadSubmissions());
  $('#active-class-name').textContent = session.className || '반 이름 없음';
  const individual = session.participationMode === 'individual';
  $('#active-participation-mode').textContent = individual ? '개별 활동 · 1~25번' : '모둠 활동 · 1~7모둠';
  $('#phase-label').textContent = session.phase === 'compare' && individual ? '학생 경계선 비교' : phaseNames[session.phase] || '수업 준비';
  map.setLayer('boundaries', Boolean(session.showBoundaries));
  map.setLayer('plateLabels', Boolean(session.showBoundaries));
  map.setLayer('korea', Boolean(session.showKoreaDetail));
  if (session.phase === 'eastAsia') {
    map.fitEastAsia();
  }
  document.querySelectorAll('[data-phase]').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.phase === session.phase);
  });
  const compareButton = $('[data-phase="compare"]');
  const comparisonClosed = session.phase === 'compare';
  compareButton.querySelector('b').textContent = comparisonClosed ? '마감 취소·그리기 다시 열기' : individual ? '제출 마감·개별 비교' : '제출 마감·모둠 비교';
  compareButton.querySelector('small').textContent = comparisonClosed
    ? '학생 편집과 제출을 다시 시작합니다.'
    : '학생 편집을 멈추고 선을 겹칩니다.';
  const closeButton = $('#close-session');
  const sessionClosed = session.phase === 'closed';
  closeButton.classList.toggle('is-active', sessionClosed);
  closeButton.querySelector('b').textContent = sessionClosed ? '수업 다시 열기' : '수업 세션 종료';
  closeButton.querySelector('small').textContent = sessionClosed
    ? '학생 탐구와 제출을 다시 시작합니다.'
    : '학생 편집과 제출을 모두 마감합니다.';
  const explorationEnabled = Boolean(session.dataExplorationEnabled);
  const explorationButton = $('#enable-data-exploration');
  explorationButton.classList.toggle('is-active', explorationEnabled);
  explorationButton.querySelector('b').textContent = explorationEnabled ? '데이터 탐구 다시 잠그기' : '데이터 탐구 시작 허용';
  explorationButton.querySelector('small').textContent = explorationEnabled
    ? '학생을 원리 학습 화면으로 되돌리고 버튼을 잠급니다.'
    : '학생의 데이터 탐구 버튼을 활성화합니다.';
  const earthquakeReleased = Boolean(session.earthquakeDataReleased ?? session.dataReleased);
  const volcanoReleased = Boolean(session.volcanoDataReleased);
  const earthquakeButton = $('#release-earthquakes');
  const volcanoButton = $('#release-volcanoes');
  earthquakeButton.classList.toggle('is-active', earthquakeReleased);
  volcanoButton.classList.toggle('is-active', volcanoReleased);
  earthquakeButton.querySelector('b').textContent = earthquakeReleased ? '지진 자료 배포 중지' : '지진 자료 배포';
  volcanoButton.querySelector('b').textContent = volcanoReleased ? '화산 자료 배포 중지' : '화산 자료 배포';
  earthquakeButton.querySelector('small').textContent = earthquakeReleased
    ? '학생 지도에서 교사 제공 지진 좌표를 숨깁니다.'
    : '학생 지도에 지진 좌표를 바로 표시합니다.';
  volcanoButton.querySelector('small').textContent = volcanoReleased
    ? '학생 지도에서 교사 제공 화산 좌표를 숨깁니다.'
    : '학생 지도에 화산 좌표를 바로 표시합니다.';
  renderGroups(groups);
}

function showActiveSession(code, className = '') {
  sessionCode = code;
  groups = [];
  visibility = {};
  localStorage.setItem('plate-teacher-session', code);
  $('#session-empty').classList.add('is-hidden');
  $('#session-active').classList.remove('is-hidden');
  $('#class-code').textContent = code;
  $('#active-class-name').textContent = className || '반 이름 없음';
  const url = `${location.origin}${location.pathname.replace(/teacher\.html$/, '')}student.html?code=${code}`;
  $('#join-url').textContent = url;

  stopSessionWatch?.();
  stopGroupsWatch?.();
  stopGroupsWatch = null;
  stopSessionWatch = backend.watchSession(code, (session) => {
    if (!session) return toast('수업 정보를 찾을 수 없습니다.');
    updateSessionView(session);
    if (canReadSubmissions() && !stopGroupsWatch) {
      stopGroupsWatch = backend.watchGroups(code, renderGroups, (error) => toast(error.message));
    } else if (!canReadSubmissions()) {
      stopGroupsWatch?.();
      stopGroupsWatch = null;
      renderGroups([]);
    }
  }, (error) => toast(error.message));
}

async function openClassSession(className, fixedCode, participationMode) {
  const button = $('#create-session');
  button.disabled = true;
  button.textContent = '여는 중…';
  try {
    const existing = await backend.getSession(fixedCode);
    if (existing && participationMode && (existing.participationMode || 'group') !== participationMode) {
      throw new Error('이 코드에 저장된 진행 방식이 다릅니다. 다른 방식으로 진행하려면 새 코드를 입력해 주세요.');
    }
    const code = existing && existing.ownerUid !== backend.currentUid
      ? fixedCode
      : await backend.createSession({ code: fixedCode, className, participationMode });
    showActiveSession(code, existing?.className || className);
    toast(existing ? '저장된 수업을 불러왔습니다.' : `${className} 수업을 열었습니다.`);
  } catch (error) {
    toast(error.message || '수업을 만들지 못했습니다.');
  } finally {
    button.disabled = false;
    button.textContent = '이 코드로 수업 열기';
  }
}

async function createSession(event) {
  event.preventDefault();
  const className = $('#class-name').value.trim();
  const fixedCode = $('#fixed-code').value.trim().toUpperCase();
  if (!className) return $('#class-name').focus();
  if (!/^[A-Z0-9]{4,6}$/.test(fixedCode)) {
    toast('고정 코드는 영문과 숫자 4~6자리로 입력해 주세요.');
    return $('#fixed-code').focus();
  }
  await openClassSession(className, fixedCode, $('#participation-mode').value);
}

function showClassPicker() {
  stopSessionWatch?.();
  stopGroupsWatch?.();
  stopSessionWatch = null;
  stopGroupsWatch = null;
  sessionCode = null;
  currentSession = null;
  groups = [];
  visibility = {};
  localStorage.removeItem('plate-teacher-session');
  $('#session-active').classList.add('is-hidden');
  $('#session-empty').classList.remove('is-hidden');
  $('#group-status-list').classList.remove('is-hidden');
  $('#submission-access').classList.add('is-hidden');
  renderGroups([]);
  renderClassProfiles();
  $('#class-name').focus();
}

async function setSession(changes, successMessage) {
  if (!sessionCode) return toast('먼저 수업 코드를 만들어 주세요.');
  try {
    await backend.updateSession(sessionCode, changes);
    if (successMessage) toast(successMessage);
  } catch (error) {
    toast(error.message || '수업 단계를 바꾸지 못했습니다.');
  }
}

async function copyText(text, message = '복사했습니다.') {
  try {
    await navigator.clipboard.writeText(text);
    toast(message);
  } catch {
    toast('복사하지 못했습니다. 주소를 직접 선택해 주세요.');
  }
}

async function resumeSession() {
  const stored = localStorage.getItem('plate-teacher-session');
  if (!stored) return;
  try {
    const session = await backend.getSession(stored);
    if (session) showActiveSession(stored);
  } catch (error) {
    console.warn(error);
  }
}

$('#teacher-sign-in').addEventListener('click', signInTeacher);
$('#teacher-sign-out').addEventListener('click', signOutTeacher);
$('#class-session-form').addEventListener('submit', createSession);
$('#fixed-code').addEventListener('input', (event) => {
  event.target.value = event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
});
$('#switch-class').addEventListener('click', showClassPicker);
$('#restart-session').addEventListener('click', restartSession);
$('#copy-code').addEventListener('click', () => copyText(sessionCode, '수업 코드를 복사했습니다.'));
$('#copy-url').addEventListener('click', () => copyText($('#join-url').textContent, '학생 입장 주소를 복사했습니다.'));
$('#reset-submissions').addEventListener('click', clearAllSubmissions);
$('#enable-data-exploration').addEventListener('click', () => {
  const enabled = !Boolean(currentSession?.dataExplorationEnabled);
  if (!enabled && !confirm('데이터 탐구를 다시 잠글까요? 학생 화면은 원리 학습으로 돌아갑니다.')) return;
  setSession(
    { dataExplorationEnabled: enabled },
    enabled ? '학생의 데이터 탐구 버튼을 활성화했습니다.' : '학생의 데이터 탐구를 다시 잠갔습니다.'
  );
});
$('#release-earthquakes').addEventListener('click', () => {
  const released = !Boolean(currentSession?.earthquakeDataReleased ?? currentSession?.dataReleased);
  setSession(
    { earthquakeDataReleased: released, dataReleased: false },
    released ? '학생 지도에 지진 자료를 표시했습니다.' : '교사 제공 지진 자료를 숨겼습니다.'
  );
});
$('#release-volcanoes').addEventListener('click', () => {
  const released = !Boolean(currentSession?.volcanoDataReleased);
  setSession(
    { volcanoDataReleased: released },
    released ? '학생 지도에 화산 자료를 표시했습니다.' : '교사 제공 화산 자료를 숨겼습니다.'
  );
});
document.querySelectorAll('[data-phase]').forEach((button) => {
  button.addEventListener('click', () => {
    const requestedPhase = button.dataset.phase;
    const reopensDrawing = requestedPhase === 'compare' && currentSession?.phase === 'compare';
    const phase = reopensDrawing ? 'explore' : requestedPhase;
    const changes = {
      phase,
      showBoundaries: phase === 'reveal',
      showKoreaDetail: false
    };
    setSession(changes, reopensDrawing ? '마감을 취소하고 학생 그리기를 다시 열었습니다.' : phase === 'compare' ? '학생 편집을 마감했습니다.' : phase === 'reveal' ? '실제 판 경계를 공개했습니다.' : '동아시아 적용 화면으로 이동했습니다.');
  });
});
$('#east-boundary').addEventListener('click', () => setSession({ phase: 'eastAsia', showBoundaries: true }, '동아시아 판 경계를 공개했습니다.'));
$('#korea-detail').addEventListener('click', () => setSession({ phase: 'eastAsia', showBoundaries: true, showKoreaDetail: true }, '한반도 상세 지진 자료를 공개했습니다.'));
$('#close-session').addEventListener('click', () => {
  const reopening = currentSession?.phase === 'closed';
  if (!reopening && !confirm('수업 세션을 종료할까요? 학생의 편집과 제출이 모두 마감됩니다.')) return;
  setSession(
    { phase: reopening ? 'explore' : 'closed', showBoundaries: false, showKoreaDetail: false },
    reopening ? '수업을 다시 열었습니다.' : '수업 세션을 종료했습니다.'
  );
});
document.querySelectorAll('[data-submission-chapter]').forEach((button) => {
  button.addEventListener('click', () => {
    submissionChapter = button.dataset.submissionChapter;
    document.querySelectorAll('[data-submission-chapter]').forEach((item) => {
      const active = item === button;
      item.classList.toggle('is-active', active);
      item.setAttribute('aria-pressed', String(active));
    });
    map.showSubmissions(groups, visibility, submissionChapter, currentSession?.participationMode === 'individual' ? '번' : '모둠');
  });
});
$('#teacher-toggle-earthquakes').addEventListener('click', () => setTeacherLayer('earthquakes', !teacherLayerVisibility.earthquakes));
$('#teacher-toggle-volcanoes').addEventListener('click', () => setTeacherLayer('volcanoes', !teacherLayerVisibility.volcanoes));
$('#world-view').addEventListener('click', () => map.fitWorld());
$('#presentation-mode').addEventListener('click', async () => {
  document.body.classList.toggle('presentation');
  if (document.body.classList.contains('presentation')) {
    try { await document.documentElement.requestFullscreen?.(); } catch { /* 브라우저 정책에 따라 전체 화면이 거부될 수 있음 */ }
  } else if (document.fullscreenElement) {
    await document.exitFullscreen?.();
  }
  map.invalidateSize();
});
$('#drawer-toggle').addEventListener('click', () => $('#evidence-drawer').classList.toggle('is-collapsed'));

function setTimelineHidden(hidden) {
  $('[data-earthquake-timeline]').classList.toggle('is-hidden', hidden);
  const button = $('#toggle-timeline');
  button.textContent = hidden ? '재생바 보기' : '재생바 숨기기';
  button.setAttribute('aria-pressed', String(!hidden));
  localStorage.setItem('plate-teacher-timeline-hidden', String(hidden));
}
$('#toggle-timeline').addEventListener('click', () => {
  setTimelineHidden(!$('[data-earthquake-timeline]').classList.contains('is-hidden'));
});
setTimelineHidden(localStorage.getItem('plate-teacher-timeline-hidden') === 'true');

renderGroups([]);
renderTeacherAccount();
watchTeacherSessions();
map.ready.then(() => {
  setupEarthquakeTimeline(map, $('[data-earthquake-timeline]')).then((controller) => {
    teacherTimelineController = controller;
    setTeacherLayer('earthquakes', teacherLayerVisibility.earthquakes);
    setTeacherLayer('volcanoes', teacherLayerVisibility.volcanoes);
  });
});
$('#backend-mode').textContent = backend.isCloud ? 'Firebase 실시간 연결' : '로컬 시연 모드';
$('#cloud-dot').classList.toggle('is-cloud', backend.isCloud);
resumeSession();

if (backend.isCloud) {
  const initialUid = backend.currentUid;
  backend.onAuthStateChanged(backend.auth, (user) => {
    if ((!user || user.uid !== initialUid) && !$('#teacher-sign-in').disabled && !$('#teacher-sign-out').disabled) location.reload();
  });
}
