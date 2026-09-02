import { backend } from './backend.js';
import { PlateMap } from './map-app.js';

const $ = (selector) => document.querySelector(selector);
const code = (new URLSearchParams(location.search).get('code') || '').trim().toUpperCase();
const map = new PlateMap('student-map', { drawing: true });
if (['localhost', '127.0.0.1'].includes(location.hostname)) globalThis.__plateStudentMap = map;
const groupDialog = $('#group-dialog');
const groupGrid = $('#group-grid');
const joinButton = $('#join-group');
const submissionForm = $('#submission-form');
const applicationForm = $('#application-form');
let selectedGroup = null;
let groupData = null;
let currentSession = null;
let toastTimer = null;

const phaseCopy = {
  explore: ['01', '자료에서 경계 찾기', '지진과 화산이 띠 모양으로 이어지는 곳을 찾아 경계선을 그려 보세요.'],
  compare: ['03', '모둠 결과 비교', '그리기가 마감되었습니다. 전자칠판에서 여섯 모둠의 선을 비교하세요.'],
  reveal: ['04', '실제 경계와 검증', '우리 모둠의 선과 실제 판 경계가 어디에서 같고 다른지 찾아보세요.'],
  eastAsia: ['05', '일본·한반도에 적용', '같은 기준으로 두 지역을 비교한 뒤, 판 경계와의 거리를 확인하세요.'],
  closed: ['06', '탐구 마무리', '출구 과제에 오늘 발견한 내용을 정리하세요.']
};

function toast(message) {
  const element = $('#toast');
  element.textContent = message;
  element.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => element.classList.remove('is-visible'), 2800);
}

function setTab(name) {
  document.querySelectorAll('.tab').forEach((tab) => tab.classList.toggle('is-active', tab.dataset.tab === name));
  $('#map-tab').classList.toggle('is-active', name === 'map');
  $('#principle-tab').classList.toggle('is-active', name === 'principle');
  if (name === 'map') map.invalidateSize();
}

function unlockPrinciple() {
  $('[data-tab="principle"]').classList.remove('is-locked');
  $('#principle-lock').classList.add('is-hidden');
  $('#principle-content').classList.remove('is-hidden');
  $('#revision-wrap').classList.remove('is-hidden');
  $('#submit-boundary').textContent = '수정한 경계선 최종 제출';
}

function updatePhase(session) {
  currentSession = session;
  const phase = session?.phase || 'explore';
  const [number, title, guide] = phaseCopy[phase] || phaseCopy.explore;
  $('#phase-number').textContent = number;
  $('#phase-title').textContent = title;
  $('#phase-guide').textContent = guide;

  const editable = phase === 'explore';
  map.setDrawingEnabled(editable);
  submissionForm.querySelectorAll('textarea, input, button').forEach((element) => {
    element.disabled = !editable;
  });
  map.setLayer('boundaries', Boolean(session?.showBoundaries));

  const eastAsia = phase === 'eastAsia';
  $('#korea-detail-row').classList.toggle('is-hidden', !eastAsia);
  $('#application-card').classList.toggle('is-hidden', !eastAsia);
  if (eastAsia) {
    map.fitEastAsia();
    $('#earthquake-toggle').checked = true;
    $('#volcano-toggle').checked = true;
    map.setLayer('earthquakes', true);
    map.setLayer('volcanoes', true);
  }

  const detail = eastAsia && Boolean(session?.showKoreaDetail);
  $('#korea-detail-toggle').checked = detail;
  map.setLayer('korea', detail);
}

function renderGroupButtons() {
  groupGrid.innerHTML = '';
  for (let group = 1; group <= 6; group += 1) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = `${group}모둠`;
    button.addEventListener('click', () => {
      selectedGroup = group;
      groupGrid.querySelectorAll('button').forEach((item) => item.classList.toggle('is-selected', item === button));
      joinButton.disabled = false;
    });
    groupGrid.append(button);
  }
}

async function joinGroup() {
  if (!selectedGroup) return;
  joinButton.disabled = true;
  joinButton.textContent = '참여 확인 중…';
  try {
    groupData = await backend.claimGroup(code, selectedGroup);
    $('#header-group').textContent = `${selectedGroup}모둠`;
    groupDialog.close();
    const draftKey = `plate-draft-${code}-${selectedGroup}`;
    const draft = JSON.parse(localStorage.getItem(draftKey) || 'null');
    const latest = groupData.v2 || groupData.v1 || draft;
    if (latest?.lines) map.setLines(latest.lines);
    if (latest?.evidence) $('#evidence').value = latest.evidence;
    if (latest?.revision) $('#revision').value = latest.revision;
    if (latest?.confidence) {
      const input = document.querySelector(`input[name="confidence"][value="${latest.confidence}"]`);
      if (input) input.checked = true;
    }
    if (groupData.v1) unlockPrinciple();

    $('#student-map').addEventListener('boundarychange', () => {
      localStorage.setItem(draftKey, JSON.stringify({
        lines: map.getLines(),
        evidence: $('#evidence').value,
        revision: $('#revision').value,
        confidence: document.querySelector('input[name="confidence"]:checked')?.value || '보통'
      }));
    });
    toast(`${selectedGroup}모둠으로 참여했습니다.`);
  } catch (error) {
    toast(error.message || '모둠 참여에 실패했습니다.');
    joinButton.disabled = false;
  } finally {
    joinButton.textContent = '선택한 모둠으로 시작';
  }
}

async function submitBoundary(event) {
  event.preventDefault();
  if (!selectedGroup || !groupData) return toast('모둠을 먼저 선택해 주세요.');
  if (currentSession?.phase !== 'explore') return toast('경계선 제출이 마감되었습니다.');
  const lines = map.getLines();
  if (!lines.length) return toast('지도에 경계선을 하나 이상 그려 주세요.');
  if (!$('#evidence').value.trim()) return $('#evidence').focus();

  const version = {
    lines,
    evidence: $('#evidence').value.trim(),
    revision: $('#revision').value.trim(),
    confidence: document.querySelector('input[name="confidence"]:checked')?.value || '보통',
    submittedAt: new Date().toISOString()
  };
  const button = $('#submit-boundary');
  button.disabled = true;
  button.textContent = '제출 중…';
  try {
    const latestGroup = await backend.getGroup(code, selectedGroup);
    if (latestGroup) groupData = latestGroup;
    const isRevision = Boolean(groupData.v1);
    const changes = isRevision
      ? { v2: version, status: 'final' }
      : { v1: version, status: 'initial', principleUnlocked: true };
    await backend.saveSubmission(code, selectedGroup, changes);
    Object.assign(groupData, changes);
    $('#submit-status').textContent = isRevision ? '최종 경계선이 저장되었습니다.' : '1차 제출 완료 · 원리 탭이 열렸습니다.';
    if (!isRevision) {
      unlockPrinciple();
      toast('제출 완료! 이제 “왜 이곳에서?” 탭을 확인하세요.');
    } else {
      toast('수정한 경계선을 최종 제출했습니다.');
    }
  } catch (error) {
    toast(error.message || '제출하지 못했습니다. 다시 시도해 주세요.');
  } finally {
    button.disabled = currentSession?.phase !== 'explore';
    button.textContent = groupData.v1 ? '수정한 경계선 최종 제출' : '1차 경계선 제출';
  }
}

function setupApplicationChoices() {
  document.querySelectorAll('.choice-row').forEach((row) => {
    row.querySelectorAll('button').forEach((button) => {
      button.addEventListener('click', () => {
        row.querySelectorAll('button').forEach((item) => item.classList.toggle('is-selected', item === button));
      });
    });
  });
}

async function submitApplication(event) {
  event.preventDefault();
  const answers = {};
  document.querySelectorAll('.choice-row').forEach((row) => {
    answers[row.dataset.name] = row.querySelector('.is-selected')?.textContent || '';
  });
  if (Object.values(answers).some((answer) => !answer)) return toast('세 문항에 모두 답해 주세요.');
  try {
    await backend.saveSubmission(code, selectedGroup, { application: answers });
    $('#application-status').textContent = '적용 답안을 저장했습니다.';
    toast('동아시아 적용 답안이 저장되었습니다.');
  } catch (error) {
    toast(error.message || '답안을 저장하지 못했습니다.');
  }
}

async function initialize() {
  if (!code) return location.replace('./index.html');
  $('#header-code').textContent = code;
  $('#dialog-code').textContent = code;

  const session = await backend.getSession(code);
  if (!session) {
    alert('수업 코드를 찾을 수 없습니다. 코드를 다시 확인해 주세요.');
    return location.replace('./index.html');
  }
  currentSession = session;
  renderGroupButtons();
  groupDialog.showModal();
  backend.watchSession(code, (nextSession) => {
    if (!nextSession) return toast('수업이 종료되었거나 삭제되었습니다.');
    updatePhase(nextSession);
  });

  const counts = await map.ready;
  $('#quake-count').textContent = `${counts.earthquakes.toLocaleString('ko-KR')}건 · 규모 5.0 이상`;
  $('#volcano-count').textContent = `${counts.volcanoes.toLocaleString('ko-KR')}곳 · 홀로세`;
  map.setDrawingEnabled(true);
}

document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    if (tab.dataset.tab === 'principle' && tab.classList.contains('is-locked')) return toast('경계선을 먼저 제출하면 열립니다.');
    setTab(tab.dataset.tab);
  });
});
document.querySelectorAll('[data-go-map]').forEach((button) => button.addEventListener('click', () => setTab('map')));
$('#earthquake-toggle').addEventListener('change', (event) => map.setLayer('earthquakes', event.target.checked));
$('#volcano-toggle').addEventListener('change', (event) => map.setLayer('volcanoes', event.target.checked));
$('#korea-detail-toggle').addEventListener('change', (event) => map.setLayer('korea', event.target.checked));
$('#reset-view').addEventListener('click', () => map.fitWorld());
$('#east-asia-view').addEventListener('click', () => map.fitEastAsia());
joinButton.addEventListener('click', joinGroup);
submissionForm.addEventListener('submit', submitBoundary);
applicationForm.addEventListener('submit', submitApplication);
$('#application-card .close-card').addEventListener('click', () => $('#application-card').classList.add('is-hidden'));
setupApplicationChoices();

initialize().catch((error) => {
  console.error(error);
  toast('앱을 시작하지 못했습니다. Firebase 설정과 네트워크를 확인해 주세요.');
});
