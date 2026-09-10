import { backend } from './backend.js?v=20260903-7';
import { PlateMap, parseEarthquakeFile, parseVolcanoFile, setupEarthquakeTimeline, setupVolcanoTimeline } from './map-app.js?v=20260903-7';

const $ = (selector) => document.querySelector(selector);
const code = (new URLSearchParams(location.search).get('code') || '').trim().toUpperCase();
const map = new PlateMap('student-map', { drawing: true, showBaseData: false, deferData: true });
if (['localhost', '127.0.0.1'].includes(location.hostname)) globalThis.__plateStudentMap = map;
const groupDialog = $('#group-dialog');
const groupGrid = $('#group-grid');
const joinButton = $('#join-group');
const groupStatus = $('#group-status');
const submissionForm = $('#submission-form');
const applicationForm = $('#application-form');
let selectedGroup = null;
let groupData = null;
let currentSession = null;
let toastTimer = null;
let explorationUnlocked = false;
let timelineController = null;
let volcanoTimelineController = null;
let studentMapReadyPromise = null;
let customEarthquakeFile = null;
let customVolcanoFile = null;
let baseEarthquakeCount = 0;
let baseVolcanoCount = 0;
let dataChapter = 'volcano';
let activeSessionNumber = 1;

const sessionScopedKey = (name) => `plate-${name}-${code}-${activeSessionNumber}`;

function migrateLegacyLocalValue(legacyKey, scopedKey) {
  const legacyValue = localStorage.getItem(legacyKey);
  if (legacyValue != null && localStorage.getItem(scopedKey) == null) localStorage.setItem(scopedKey, legacyValue);
  if (legacyValue != null) localStorage.removeItem(legacyKey);
}

const phaseCopy = {
  explore: ['02', '자료에서 경계 찾기', '자료 파일을 불러오고, 지진과 화산이 띠 모양으로 이어지는 곳을 찾아 경계선을 그려 보세요.'],
  compare: ['03', '모둠 결과 비교', '그리기가 마감되었습니다. 전자칠판에서 일곱 모둠의 선을 비교하세요.'],
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
  if (code) localStorage.setItem(sessionScopedKey('active-tab'), name);
  if (name === 'map') {
    map.invalidateSize();
    ensureStudentMapReady().catch((error) => {
      console.error(error);
      toast('지도 자료를 불러오지 못했습니다. 인터넷 연결을 확인해 주세요.');
    });
  }
}

function ensureStudentMapReady() {
  if (studentMapReadyPromise) return studentMapReadyPromise;
  studentMapReadyPromise = (async () => {
    const counts = await map.ensureReady();
    baseEarthquakeCount = counts.earthquakes;
    baseVolcanoCount = counts.volcanoes;
    timelineController ||= await setupEarthquakeTimeline(map, $('[data-earthquake-timeline]'));
    volcanoTimelineController ||= await setupVolcanoTimeline(map, $('[data-volcano-timeline]'));
    updateDataAccess(currentSession);
    map.invalidateSize();
    return counts;
  })().catch((error) => {
    studentMapReadyPromise = null;
    throw error;
  });
  return studentMapReadyPromise;
}

function updateExplorationGate(session) {
  const enabled = Boolean(session?.dataExplorationEnabled);
  const canEnter = enabled && explorationUnlocked;
  const mapTab = $('[data-tab="map"]');
  mapTab.classList.toggle('is-locked', !canEnter);
  document.querySelectorAll('[data-start-exploration]').forEach((button) => {
    button.disabled = !enabled;
    button.textContent = enabled
      ? '학습 완료 · 데이터 탐구 시작 →'
      : '선생님의 데이터 탐구 시작 신호를 기다려 주세요';
  });
  if (!enabled && $('#map-tab').classList.contains('is-active')) setTab('principle');
}

function firestoreSafeLines(records) {
  return records.map((record) => ({
    chapter: record.chapter || 'volcano',
    points: record.coordinates.map(([longitude, latitude]) => ({ longitude, latitude }))
  }));
}

function startExploration() {
  if (!currentSession?.dataExplorationEnabled) return toast('선생님이 데이터 탐구를 시작할 때까지 기다려 주세요.');
  explorationUnlocked = true;
  localStorage.setItem(sessionScopedKey('principle-complete'), '1');
  updatePhase(currentSession);
  setTab('map');
  toast('원리 학습 완료! 직접 찾은 화산·지진 파일을 업로드하세요.');
}

function chapterIsReady(chapter) {
  const earthquakeReady = Boolean(customEarthquakeFile || currentSession?.earthquakeDataReleased || currentSession?.dataReleased);
  const volcanoReady = Boolean(customVolcanoFile || currentSession?.volcanoDataReleased);
  if (chapter === 'volcano') return volcanoReady;
  if (chapter === 'earthquake') return earthquakeReady;
  return volcanoReady && earthquakeReady;
}

function renderDataChapter() {
  if (!chapterIsReady(dataChapter)) {
    if (chapterIsReady('volcano')) dataChapter = 'volcano';
    else if (chapterIsReady('earthquake')) dataChapter = 'earthquake';
  }
  const selectedReady = chapterIsReady(dataChapter);
  document.querySelectorAll('[data-data-chapter]').forEach((button) => {
    const ready = chapterIsReady(button.dataset.dataChapter);
    const selected = ready && button.dataset.dataChapter === dataChapter;
    button.classList.toggle('is-active', selected);
    button.setAttribute('aria-selected', String(selected));
    button.disabled = !ready;
  });
  document.querySelectorAll('[data-chapter-panel]').forEach((panel) => {
    panel.classList.toggle('is-hidden', !selectedReady || panel.dataset.chapterPanel !== dataChapter);
  });
  $('#data-empty-state').classList.toggle('is-hidden', selectedReady);
  if (!selectedReady) $('#data-empty-state').textContent = '직접 찾은 화산 또는 지진 파일을 업로드하면 해당 탐구 챕터가 열립니다.';

  const timeline = $('[data-earthquake-timeline]');
  const volcanoTimeline = $('[data-volcano-timeline]');
  const earthquakeReady = chapterIsReady('earthquake');
  const volcanoReady = chapterIsReady('volcano');
  timeline.classList.toggle('is-hidden', !earthquakeReady || dataChapter !== 'earthquake');
  timeline.querySelectorAll('button, input').forEach((element) => { element.disabled = !earthquakeReady; });
  volcanoTimeline.classList.toggle('is-hidden', !volcanoReady || dataChapter !== 'volcano');
  volcanoTimeline.querySelectorAll('button, input').forEach((element) => { element.disabled = !volcanoReady; });
  map.setLayer('earthquakes', earthquakeReady && ['earthquake', 'compare'].includes(dataChapter));
  map.setLayer('volcanoes', volcanoReady && ['volcano', 'compare'].includes(dataChapter));
  map.setLineChapter(dataChapter);
}

function updateDataAccess(session) {
  const earthquakeReleased = Boolean(session?.earthquakeDataReleased ?? session?.dataReleased);
  const volcanoReleased = Boolean(session?.volcanoDataReleased);
  if (!customEarthquakeFile) {
    $('#quake-count').textContent = earthquakeReleased
      ? `${baseEarthquakeCount.toLocaleString('ko-KR')}건 · 교사 제공 자료`
      : '파일 업로드 전';
    $('#earthquake-file-status').textContent = earthquakeReleased
      ? '교사 제공 지진 자료가 지도에 표시되었습니다'
      : '직접 찾은 지진 CSV·JSON 파일을 업로드하세요';
  }
  if (!customVolcanoFile) {
    $('#volcano-count').textContent = volcanoReleased
      ? `${baseVolcanoCount.toLocaleString('ko-KR')}곳 · 교사 제공 자료`
      : '파일 업로드 전';
    $('#volcano-file-status').textContent = volcanoReleased
      ? '교사 제공 화산 자료가 지도에 표시되었습니다'
      : '경도·위도와 분화 연도(year)가 있는 화산 CSV·JSON 파일을 업로드하세요';
  }
  renderDataChapter();
}

async function uploadEarthquakes(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  const status = $('#earthquake-file-status');
  status.textContent = `${file.name} 읽는 중…`;
  try {
    const events = await parseEarthquakeFile(file);
    await ensureStudentMapReady();
    customEarthquakeFile = { name: file.name, count: events.length };
    map.setEarthquakeEvents(events);
    timelineController?.reload({ initialEmpty: true });
    dataChapter = 'earthquake';
    $('#quake-count').textContent = `${events.length.toLocaleString('ko-KR')}건 · 업로드 자료`;
    status.textContent = `${file.name} · ${events.length.toLocaleString('ko-KR')}건 적용됨`;
    updateDataAccess(currentSession);
    toast('업로드 완료! 재생을 누르면 지진이 시간순으로 나타납니다.');
  } catch (error) {
    status.textContent = error.message || '파일을 불러오지 못했습니다.';
    toast('지진 자료 파일의 형식을 확인해 주세요.');
  } finally {
    event.target.value = '';
  }
}

async function uploadVolcanoes(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  const status = $('#volcano-file-status');
  status.textContent = `${file.name} 읽는 중…`;
  try {
    const volcanoes = await parseVolcanoFile(file);
    await ensureStudentMapReady();
    customVolcanoFile = { name: file.name, count: volcanoes.length };
    map.setVolcanoItems(volcanoes);
    volcanoTimelineController?.reload({ initialEmpty: true });
    dataChapter = 'volcano';
    $('#volcano-count').textContent = `${volcanoes.length.toLocaleString('ko-KR')}곳 · 업로드 자료`;
    status.textContent = `${file.name} · ${volcanoes.length.toLocaleString('ko-KR')}곳 적용됨`;
    updateDataAccess(currentSession);
    toast('업로드 완료! 재생을 누르면 화산이 연도순으로 나타납니다.');
  } catch (error) {
    status.textContent = error.message || '파일을 불러오지 못했습니다.';
    toast('화산 자료 파일의 형식을 확인해 주세요.');
  } finally {
    event.target.value = '';
  }
}

function updatePhase(session) {
  currentSession = session;
  const phase = session?.phase || 'explore';
  const [number, title, guide] = phaseCopy[phase] || phaseCopy.explore;
  $('#phase-number').textContent = number;
  $('#phase-title').textContent = title;
  $('#phase-guide').textContent = guide;

  updateExplorationGate(session);
  const editable = phase === 'explore' && Boolean(session?.dataExplorationEnabled) && explorationUnlocked;
  map.setDrawingEnabled(editable);
  submissionForm.querySelectorAll('textarea, input, button').forEach((element) => {
    element.disabled = !editable;
  });
  map.setLayer('boundaries', Boolean(session?.showBoundaries));
  map.setLayer('plateLabels', Boolean(session?.showBoundaries));
  updateDataAccess(session);

  const eastAsia = phase === 'eastAsia';
  $('#korea-detail-row').classList.toggle('is-hidden', !eastAsia);
  $('#application-card').classList.toggle('is-hidden', !eastAsia);
  if (eastAsia) {
    map.fitEastAsia();
    if (chapterIsReady('compare')) dataChapter = 'compare';
    else if (chapterIsReady('volcano')) dataChapter = 'volcano';
    else if (chapterIsReady('earthquake')) dataChapter = 'earthquake';
    renderDataChapter();
  }

  const detail = eastAsia && chapterIsReady('earthquake') && Boolean(session?.showKoreaDetail);
  $('#korea-detail-toggle').checked = detail;
  map.setLayer('korea', detail);
}

function renderGroupButtons() {
  groupGrid.innerHTML = '';
  for (let group = 1; group <= 7; group += 1) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.group = String(group);
    button.textContent = `${group}모둠`;
    button.addEventListener('click', () => {
      selectedGroup = group;
      groupGrid.querySelectorAll('button').forEach((item) => item.classList.toggle('is-selected', item === button));
      joinButton.disabled = false;
      groupStatus.textContent = `${group}모둠을 선택했습니다. 아래 시작 버튼을 눌러 주세요.`;
      groupStatus.classList.remove('is-error');
    });
    groupGrid.append(button);
  }
}

async function joinGroup({ silent = false } = {}) {
  if (!selectedGroup) {
    groupStatus.textContent = '참여할 모둠을 먼저 선택해 주세요.';
    groupStatus.classList.add('is-error');
    return;
  }
  joinButton.disabled = true;
  joinButton.textContent = '참여 확인 중…';
  groupStatus.textContent = `${selectedGroup}모둠 참여 가능 여부를 확인하고 있습니다…`;
  groupStatus.classList.remove('is-error');
  try {
    groupData = await Promise.race([
      backend.claimGroup(code, selectedGroup),
      new Promise((_, reject) => setTimeout(() => reject(new Error('참여 확인 시간이 오래 걸리고 있습니다. 인터넷 연결을 확인하고 다시 눌러 주세요.')), 12000))
    ]);
    sessionStorage.setItem(sessionScopedKey('selected-group'), String(selectedGroup));
    $('#header-group').textContent = `${selectedGroup}모둠`;
    groupStatus.textContent = `${selectedGroup}모둠으로 참여했습니다.`;
    groupDialog.close();
    const draftKey = `${sessionScopedKey('draft')}-${selectedGroup}`;
    migrateLegacyLocalValue(`plate-draft-${code}-${selectedGroup}`, draftKey);
    const draft = JSON.parse(localStorage.getItem(draftKey) || 'null');
    const latest = groupData.v1 || groupData.v2 || draft;
    if (latest?.lines) map.setLines(latest.lines);
    if (latest?.evidence) $('#evidence').value = latest.evidence;
    if (latest?.confidence) {
      const input = document.querySelector(`input[name="confidence"][value="${latest.confidence}"]`);
      if (input) input.checked = true;
    }

    $('#student-map').addEventListener('boundarychange', () => {
      localStorage.setItem(draftKey, JSON.stringify({
        lines: firestoreSafeLines(map.getLineRecords()),
        evidence: $('#evidence').value,
        confidence: document.querySelector('input[name="confidence"]:checked')?.value || '보통'
      }));
    });
    if (!silent) toast(`${selectedGroup}모둠으로 참여했습니다.`);
  } catch (error) {
    sessionStorage.removeItem(sessionScopedKey('selected-group'));
    const message = error?.code === 'permission-denied'
      ? '모둠 참여 권한을 확인하지 못했습니다. 새로고침한 뒤 다시 시도해 주세요.'
      : error.message || '모둠 참여에 실패했습니다. 인터넷 연결을 확인해 주세요.';
    groupStatus.textContent = message;
    groupStatus.classList.add('is-error');
    toast(message);
    if (!groupDialog.open) groupDialog.showModal();
    if (message.includes('이미 다른 기기')) {
      const occupiedButton = groupGrid.querySelector(`[data-group="${selectedGroup}"]`);
      if (occupiedButton) {
        occupiedButton.disabled = true;
        occupiedButton.textContent = `${selectedGroup}모둠 · 사용 중`;
        occupiedButton.classList.remove('is-selected');
      }
      selectedGroup = null;
    }
  } finally {
    joinButton.textContent = '선택한 모둠으로 시작';
    joinButton.disabled = !selectedGroup;
  }
}

async function submitBoundary(event) {
  event.preventDefault();
  const reportProblem = (message, target) => {
    $('#submit-status').textContent = message;
    toast(message);
    target?.focus();
  };
  if (!selectedGroup || !groupData) return reportProblem('모둠 참여 정보를 확인한 뒤 다시 제출해 주세요.');
  if (currentSession?.phase !== 'explore') return reportProblem('현재는 제출이 마감된 상태입니다. 교사에게 마감 취소를 요청하세요.');
  const records = map.getLineRecords();
  if (!records.length) return reportProblem('지도 왼쪽의 선 그리기로 경계선을 하나 이상 그려 주세요.');
  if (!$('#evidence').value.trim()) return reportProblem('그린 경계선의 근거를 한 문장으로 입력해 주세요.', $('#evidence'));

  const version = {
    lines: firestoreSafeLines(records),
    evidence: $('#evidence').value.trim(),
    confidence: document.querySelector('input[name="confidence"]:checked')?.value || '보통',
    submittedAt: new Date().toISOString()
  };
  const button = $('#submit-boundary');
  button.disabled = true;
  button.textContent = '제출 중…';
  try {
    const latestGroup = await backend.getGroup(code, selectedGroup);
    if (latestGroup) groupData = latestGroup;
    const resubmit = Boolean(groupData.v1);
    const changes = { v1: version, status: 'submitted' };
    await backend.saveSubmission(code, selectedGroup, changes);
    Object.assign(groupData, changes);
    $('#submit-status').textContent = resubmit ? '경계선을 다시 제출했습니다.' : '경계선을 제출했습니다. 필요하면 수정해 다시 제출할 수 있습니다.';
    toast(resubmit ? '경계선을 다시 제출했습니다.' : '경계선을 제출했습니다.');
  } catch (error) {
    const message = error.message || '제출하지 못했습니다. 인터넷 연결을 확인하고 다시 시도해 주세요.';
    $('#submit-status').textContent = message;
    toast(message);
  } finally {
    button.disabled = currentSession?.phase !== 'explore';
    button.textContent = groupData.v1 ? '경계선 다시 제출' : '경계선 제출';
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
  activeSessionNumber = Number(session.sessionNumber || 1);
  migrateLegacyLocalValue(`plate-principle-complete-${code}`, sessionScopedKey('principle-complete'));
  migrateLegacyLocalValue(`plate-active-tab-${code}`, sessionScopedKey('active-tab'));
  explorationUnlocked = localStorage.getItem(sessionScopedKey('principle-complete')) === '1';
  if (explorationUnlocked && session.dataExplorationEnabled) {
    const savedTab = localStorage.getItem(sessionScopedKey('active-tab'));
    setTab(savedTab === 'principle' ? 'principle' : 'map');
  } else setTab('principle');
  updateExplorationGate(session);
  renderGroupButtons();
  backend.watchSession(code, (nextSession) => {
    if (!nextSession) return toast('수업이 종료되었거나 삭제되었습니다.');
    if (Number(nextSession.sessionNumber || 1) !== activeSessionNumber) {
      location.reload();
      return;
    }
    updatePhase(nextSession);
  });

  const groupStorageKey = sessionScopedKey('selected-group');
  const legacyGroupStorageKey = `plate-selected-group-${code}`;
  const legacyRememberedGroup = localStorage.getItem(legacyGroupStorageKey);
  if (legacyRememberedGroup && !sessionStorage.getItem(groupStorageKey)) {
    sessionStorage.setItem(groupStorageKey, legacyRememberedGroup);
    localStorage.removeItem(legacyGroupStorageKey);
  }
  const rememberedGroup = Number(sessionStorage.getItem(groupStorageKey));
  if (Number.isInteger(rememberedGroup) && rememberedGroup >= 1 && rememberedGroup <= 7) {
    selectedGroup = rememberedGroup;
    const rememberedButton = groupGrid.querySelectorAll('button')[rememberedGroup - 1];
    rememberedButton?.classList.add('is-selected');
    await joinGroup({ silent: true });
  } else groupDialog.showModal();

  map.setDrawingEnabled(Boolean(currentSession?.dataExplorationEnabled) && explorationUnlocked);
}

document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    if (tab.classList.contains('is-locked')) {
      return toast(currentSession?.dataExplorationEnabled
        ? '먼저 원리 학습을 완료해 주세요.'
        : '선생님이 데이터 탐구를 시작할 때까지 기다려 주세요.');
    }
    setTab(tab.dataset.tab);
  });
});
document.querySelectorAll('[data-start-exploration]').forEach((button) => button.addEventListener('click', startExploration));
$('#upload-earthquakes').addEventListener('change', uploadEarthquakes);
$('#upload-volcanoes').addEventListener('change', uploadVolcanoes);
document.querySelectorAll('[data-data-chapter]').forEach((button) => {
  button.addEventListener('click', () => {
    if (button.disabled) return;
    dataChapter = button.dataset.dataChapter;
    renderDataChapter();
  });
});
$('#korea-detail-toggle').addEventListener('change', (event) => map.setLayer('korea', event.target.checked));
$('#reset-view').addEventListener('click', () => map.fitWorld());
$('#east-asia-view').addEventListener('click', () => map.fitEastAsia());
joinButton.addEventListener('click', () => joinGroup());
submissionForm.addEventListener('submit', submitBoundary);
applicationForm.addEventListener('submit', submitApplication);
$('#application-card .close-card').addEventListener('click', () => $('#application-card').classList.add('is-hidden'));
setupApplicationChoices();

initialize().catch((error) => {
  console.error(error);
  toast('앱을 시작하지 못했습니다. Firebase 설정과 네트워크를 확인해 주세요.');
});
