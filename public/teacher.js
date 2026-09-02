import { backend } from './backend.js';
import { PlateMap } from './map-app.js';

const $ = (selector) => document.querySelector(selector);
const colors = ['#ff5d35', '#2a7fff', '#13a17d', '#b640da', '#e9a51b', '#e93873'];
const map = new PlateMap('teacher-map', { drawing: false, showBaseData: true });
let sessionCode = null;
let currentSession = null;
let groups = [];
let visibility = {};
let toastTimer = null;
let stopSessionWatch = null;
let stopGroupsWatch = null;

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

function renderEmptyGroups() {
  $('#group-status-list').innerHTML = Array.from({ length: 6 }, (_, index) => `
    <div class="group-status-row">
      <div class="group-status" data-group="${index + 1}">
        <span style="background:${colors[index]}">${index + 1}</span>
        <div><b>${index + 1}모둠</b><small>접속 전</small></div>
      </div>
      <button class="delete-submission" type="button" disabled aria-label="${index + 1}모둠 제출 삭제" title="제출 없음">×</button>
    </div>
  `).join('');
}

function hasSubmission(group) {
  return Boolean(group?.v1 || group?.v2);
}

function hasStoredWork(group) {
  return hasSubmission(group) || Boolean(group?.application);
}

function groupStatusLabel(group) {
  if (group?.status === 'final' || group?.v2) return '최종 제출';
  if (group?.status === 'initial' || group?.v1) return '1차 제출';
  if (group) return '접속';
  return '접속 전';
}

function renderGroups(nextGroups) {
  groups = nextGroups;
  const byGroup = Object.fromEntries(groups.map((group) => [group.group, group]));
  const finalOrInitial = groups.filter(hasSubmission).length;
  $('#submitted-total').textContent = `${finalOrInitial}/6`;
  $('#reset-submissions').disabled = !groups.some(hasStoredWork);
  $('#group-status-list').innerHTML = Array.from({ length: 6 }, (_, index) => {
    const number = index + 1;
    const group = byGroup[number];
    const hidden = visibility[number] === false;
    const submitted = hasStoredWork(group);
    return `
      <div class="group-status-row">
        <button class="group-status group-visibility" data-group="${number}" type="button" title="지도에서 ${number}모둠 선 켜기/끄기" style="border:1px solid ${hidden ? 'transparent' : colors[index] + '55'};opacity:${hidden ? '.45' : '1'}">
          <span style="background:${colors[index]}">${number}</span>
          <div><b>${number}모둠</b><small>${groupStatusLabel(group)}</small></div>
        </button>
        <button class="delete-submission" data-delete-group="${number}" type="button" ${submitted ? '' : 'disabled'} aria-label="${number}모둠 제출 삭제" title="${submitted ? `${number}모둠 제출 삭제` : '제출 없음'}">×</button>
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

  map.showSubmissions(groups, visibility);
  $('#evidence-list').innerHTML = groups.length ? groups.map((group) => {
    const version = group.v2 || group.v1;
    const answers = group.application;
    return `
      <article class="evidence-item">
        <span style="background:${colors[(group.group - 1) % colors.length]}">${group.group}</span>
        <div>
          <p>${escapeHtml(version?.evidence || '근거 입력 전')}</p>
          <small>${version?.revision ? `수정: ${escapeHtml(version.revision)}` : groupStatusLabel(group)}${answers ? ` · 적용 ${answers.density}/${answers.near}/${answers.intraplate}` : ''}</small>
        </div>
      </article>
    `;
  }).join('') : '<p style="padding:10px;color:#657581;font-size:11px">아직 참여한 모둠이 없습니다.</p>';
}

async function clearGroupSubmission(groupNumber) {
  if (!sessionCode) return toast('먼저 수업 코드를 만들어 주세요.');
  if (!hasStoredWork(groups.find((group) => group.group === groupNumber))) return;
  if (!confirm(`${groupNumber}모둠의 제출 경계선과 근거를 삭제할까요?\n학생은 다시 제출할 수 있습니다.`)) return;
  try {
    await backend.clearGroupSubmission(sessionCode, groupNumber);
    visibility[groupNumber] = true;
    toast(`${groupNumber}모둠의 제출을 삭제했습니다.`);
  } catch (error) {
    toast(error.message || '모둠 제출을 삭제하지 못했습니다.');
  }
}

async function clearAllSubmissions() {
  if (!sessionCode) return toast('먼저 수업 코드를 만들어 주세요.');
  const count = groups.filter(hasStoredWork).length;
  if (!count) return;
  if (!confirm(`이 수업의 모둠 제출 ${count}건을 모두 초기화할까요?\n이 작업은 되돌릴 수 없습니다.`)) return;
  const button = $('#reset-submissions');
  button.disabled = true;
  try {
    await backend.clearSubmissions(sessionCode);
    visibility = {};
    toast('모든 모둠 제출을 초기화했습니다.');
  } catch (error) {
    toast(error.message || '전체 제출을 초기화하지 못했습니다.');
    button.disabled = false;
  }
}

function escapeHtml(value) {
  const element = document.createElement('div');
  element.textContent = value;
  return element.innerHTML;
}

function updateSessionView(session) {
  currentSession = session;
  $('#phase-label').textContent = phaseNames[session.phase] || '수업 준비';
  map.setLayer('boundaries', Boolean(session.showBoundaries));
  map.setLayer('korea', Boolean(session.showKoreaDetail));
  if (session.phase === 'eastAsia') {
    map.fitEastAsia();
    map.setLayer('volcanoes', true);
  }
  document.querySelectorAll('[data-phase]').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.phase === session.phase);
  });
}

function showActiveSession(code) {
  sessionCode = code;
  localStorage.setItem('plate-teacher-session', code);
  $('#session-empty').classList.add('is-hidden');
  $('#session-active').classList.remove('is-hidden');
  $('#class-code').textContent = code;
  const url = `${location.origin}${location.pathname.replace(/teacher\.html$/, '')}student.html?code=${code}`;
  $('#join-url').textContent = url;

  stopSessionWatch?.();
  stopGroupsWatch?.();
  stopSessionWatch = backend.watchSession(code, (session) => {
    if (!session) return toast('수업 정보를 찾을 수 없습니다.');
    updateSessionView(session);
  }, (error) => toast(error.message));
  stopGroupsWatch = backend.watchGroups(code, renderGroups, (error) => toast(error.message));
}

async function createSession() {
  const button = $('#create-session');
  button.disabled = true;
  button.textContent = '만드는 중…';
  try {
    const code = await backend.createSession();
    showActiveSession(code);
    toast('수업이 열렸습니다. 코드를 학생들에게 알려 주세요.');
  } catch (error) {
    toast(error.message || '수업을 만들지 못했습니다.');
  } finally {
    button.disabled = false;
    button.textContent = '수업 코드 만들기';
  }
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
    if (session?.ownerUid === backend.currentUid) showActiveSession(stored);
  } catch (error) {
    console.warn(error);
  }
}

$('#create-session').addEventListener('click', createSession);
$('#copy-code').addEventListener('click', () => copyText(sessionCode, '수업 코드를 복사했습니다.'));
$('#copy-url').addEventListener('click', () => copyText($('#join-url').textContent, '학생 입장 주소를 복사했습니다.'));
$('#reset-submissions').addEventListener('click', clearAllSubmissions);
document.querySelectorAll('[data-phase]').forEach((button) => {
  button.addEventListener('click', () => {
    const phase = button.dataset.phase;
    const changes = {
      phase,
      showBoundaries: phase === 'reveal',
      showKoreaDetail: false
    };
    setSession(changes, phase === 'compare' ? '학생 편집을 마감했습니다.' : phase === 'reveal' ? '실제 판 경계를 공개했습니다.' : '동아시아 적용 화면으로 이동했습니다.');
  });
});
$('#east-boundary').addEventListener('click', () => setSession({ phase: 'eastAsia', showBoundaries: true }, '동아시아 판 경계를 공개했습니다.'));
$('#korea-detail').addEventListener('click', () => setSession({ phase: 'eastAsia', showBoundaries: true, showKoreaDetail: true }, '한반도 상세 지진 자료를 공개했습니다.'));
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

renderEmptyGroups();
map.ready.then(() => {
  map.setLayer('earthquakes', true);
  map.setLayer('volcanoes', true);
});
$('#backend-mode').textContent = backend.isCloud ? 'Firebase 실시간 연결' : '로컬 시연 모드';
$('#cloud-dot').classList.toggle('is-cloud', backend.isCloud);
resumeSession();
