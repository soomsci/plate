import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

const chromePath = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const baseUrl = process.env.APP_URL || 'http://127.0.0.1:4173';
const port = 9338;
const profile = await mkdtemp(path.join(os.tmpdir(), 'plate-browser-smoke-'));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--disable-software-rasterizer', '--no-sandbox',
  `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--window-size=1440,1000', 'about:blank'
], { stdio: 'ignore' });
const chromeExited = new Promise((resolve) => chrome.once('exit', resolve));

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForJson(url, attempts = 60) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return response.json();
    } catch { /* Chrome가 시작되는 동안 재시도 */ }
    await delay(150);
  }
  throw new Error(`Timed out: ${url}`);
}

async function createTarget(url) {
  const target = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' }).then((response) => response.json());
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  let sequence = 0;
  const pending = new Map();
  const exceptions = [];
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      return message.error ? reject(new Error(message.error.message)) : resolve(message.result);
    }
    if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails?.text || 'Runtime exception');
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
  await send('Runtime.enable');
  await send('Page.enable');
  return { socket, send, exceptions };
}

async function evaluate(target, expression) {
  const result = await target.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result?.value;
}

async function waitFor(target, expression, attempts = 80) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await evaluate(target, `Boolean(${expression})`)) return;
    await delay(125);
  }
  throw new Error(`Element/state not ready: ${expression}`);
}

try {
  let appResponse;
  try {
    appResponse = await fetch(`${baseUrl}/index.html`);
  } catch {
    throw new Error(`Local app server is not running at ${baseUrl}. Run "npm.cmd run serve" first.`);
  }
  if (!appResponse.ok) throw new Error(`Local app server returned ${appResponse.status}.`);
  await waitForJson(`http://127.0.0.1:${port}/json/version`);
  const landing = await createTarget(`${baseUrl}/index.html`);
  await waitFor(landing, `document.querySelector('#join-form') && !document.querySelector('a[href*="teacher.html"]') && !document.body.textContent.includes('교사 대시보드')`);
  landing.socket.close();
  const teacher = await createTarget(`${baseUrl}/teacher.html?backend=local`);
  await waitFor(teacher, `document.querySelector('#class-session-form') && document.querySelector('#backend-mode')?.textContent.includes('로컬')`);
  await evaluate(teacher, `(() => { document.querySelector('#class-name').value='2학년 1반'; document.querySelector('#fixed-code').value='CLASS1'; document.querySelector('#class-session-form').requestSubmit(); })()`);
  await waitFor(teacher, `document.querySelector('#class-code')?.textContent === 'CLASS1' && document.querySelector('#active-class-name')?.textContent === '2학년 1반'`);
  const code = await evaluate(teacher, `document.querySelector('#class-code').textContent`);
  if (code !== 'CLASS1') throw new Error(`Fixed class code was not used: ${code}`);
  await waitFor(teacher, `document.querySelector('#enable-data-exploration') && document.querySelector('#enable-data-exploration b')?.textContent.includes('시작 허용') && document.querySelector('#release-earthquakes') && document.querySelector('#release-volcanoes') && globalThis.__plateTeacherMap && globalThis.__plateTeacherMap.map.hasLayer(globalThis.__plateTeacherMap.layers.earthquakes) && globalThis.__plateTeacherMap.map.hasLayer(globalThis.__plateTeacherMap.layers.volcanoes)`);
  await evaluate(teacher, `document.querySelector('#teacher-toggle-earthquakes').click()`);
  await waitFor(teacher, `!globalThis.__plateTeacherMap.map.hasLayer(globalThis.__plateTeacherMap.layers.earthquakes) && document.querySelector('#teacher-toggle-earthquakes').getAttribute('aria-pressed') === 'false' && document.querySelector('[data-earthquake-timeline]').classList.contains('is-disabled')`);
  await evaluate(teacher, `document.querySelector('#teacher-toggle-earthquakes').click(); document.querySelector('#teacher-toggle-volcanoes').click()`);
  await waitFor(teacher, `globalThis.__plateTeacherMap.map.hasLayer(globalThis.__plateTeacherMap.layers.earthquakes) && !globalThis.__plateTeacherMap.map.hasLayer(globalThis.__plateTeacherMap.layers.volcanoes) && document.querySelector('#teacher-toggle-volcanoes').getAttribute('aria-pressed') === 'false'`);
  await evaluate(teacher, `document.querySelector('#teacher-toggle-volcanoes').click()`);
  await waitFor(teacher, `globalThis.__plateTeacherMap.map.hasLayer(globalThis.__plateTeacherMap.layers.volcanoes)`);

  const student = await createTarget(`${baseUrl}/student.html?code=${code}&backend=local`);
  await waitFor(student, `document.querySelectorAll('#group-grid button').length === 7 && document.querySelector('#group-grid button:last-child')?.textContent === '7모둠' && document.querySelector('#group-dialog')?.open`);
  await evaluate(student, `document.querySelector('#group-grid button').click()`);
  await waitFor(student, `!document.querySelector('#join-group').disabled && document.querySelector('#group-status')?.textContent.includes('1모둠을 선택')`);
  await evaluate(student, `document.querySelector('#join-group').click()`);
  await waitFor(student, `!document.querySelector('#group-dialog').open && document.querySelector('[data-start-exploration]')?.disabled && document.querySelector('[data-start-exploration]')?.textContent.includes('시작 신호') && document.querySelector('[data-tab="map"]').classList.contains('is-locked') && document.querySelectorAll('.plate-process-grid svg').length === 2`);
  const occupiedStudent = await createTarget(`${baseUrl}/student.html?code=${code}&backend=local`);
  await waitFor(occupiedStudent, `document.querySelector('#group-grid button') && document.querySelector('#group-dialog')?.open`);
  await evaluate(occupiedStudent, `document.querySelector('#group-grid button').click(); document.querySelector('#join-group').click()`);
  await waitFor(occupiedStudent, `document.querySelector('#group-dialog').open && document.querySelector('#group-status')?.classList.contains('is-error') && document.querySelector('#group-status')?.textContent.includes('이미 다른 기기') && document.querySelector('#group-grid button').disabled`);
  await waitFor(student, `globalThis.__plateStudentMap.ready === null && performance.getEntriesByType('resource').every((entry) => !entry.name.includes('/data/'))`);
  await evaluate(student, `document.querySelector('[data-tab="map"]').click()`);
  await waitFor(student, `document.querySelector('#toast')?.textContent.includes('선생님이 데이터 탐구를 시작')`);
  await evaluate(teacher, `document.querySelector('#enable-data-exploration').click()`);
  await waitFor(student, `!document.querySelector('[data-start-exploration]').disabled && document.querySelector('[data-start-exploration]').textContent.includes('데이터 탐구 시작')`);
  await evaluate(teacher, `window.confirm=()=>true; document.querySelector('#enable-data-exploration').click()`);
  await waitFor(student, `document.querySelector('[data-start-exploration]').disabled && document.querySelector('[data-tab="map"]').classList.contains('is-locked')`);
  await evaluate(teacher, `document.querySelector('#enable-data-exploration').click()`);
  await waitFor(student, `!document.querySelector('[data-start-exploration]').disabled`);
  if (process.env.SCREENSHOT_PATH) {
    await evaluate(student, `document.querySelector('.plate-process-grid').scrollIntoView({block:'start'})`);
    await delay(500);
    const screenshot = await student.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
    await writeFile(process.env.SCREENSHOT_PATH, Buffer.from(screenshot.data, 'base64'));
  }
  await evaluate(student, `document.querySelector('[data-start-exploration]').click()`);
  await waitFor(student, `document.querySelector('#map-tab').classList.contains('is-active') && !document.querySelector('#upload-earthquakes').disabled && !document.querySelector('#upload-volcanoes').disabled && [...document.querySelectorAll('[data-data-chapter]')].every((button) => button.disabled) && !document.querySelector('#data-empty-state').classList.contains('is-hidden') && [...document.querySelectorAll('[data-chapter-panel]')].every((panel) => panel.classList.contains('is-hidden')) && !globalThis.__plateStudentMap.map.hasLayer(globalThis.__plateStudentMap.layers.earthquakes) && !globalThis.__plateStudentMap.map.hasLayer(globalThis.__plateStudentMap.layers.volcanoes) && globalThis.__plateStudentMap.layers.countries.getLayers().length === 3 && globalThis.__plateStudentMap.layers.boundaries.getLayers().length === 6 && getComputedStyle(document.querySelector('.leaflet-draw-draw-polyline'),'::after').content.includes('선 그리기') && getComputedStyle(document.querySelector('.leaflet-draw-edit-edit'),'::after').content.includes('선 수정')`);
  await student.send('Page.reload', { ignoreCache: true });
  await waitFor(student, `document.querySelector('#map-tab')?.classList.contains('is-active') && !document.querySelector('#group-dialog')?.open && document.querySelector('#header-group')?.textContent === '1모둠' && document.querySelector('.leaflet-draw-draw-polyline') && globalThis.__plateStudentMap`);
  await evaluate(teacher, `document.querySelector('#enable-data-exploration').click()`);
  await waitFor(student, `document.querySelector('#principle-tab').classList.contains('is-active') && document.querySelector('[data-tab="map"]').classList.contains('is-locked') && document.querySelector('[data-start-exploration]').disabled && document.querySelector('.leaflet-draw-draw-polyline') === null`);
  await evaluate(teacher, `document.querySelector('#enable-data-exploration').click()`);
  await waitFor(student, `!document.querySelector('[data-tab="map"]').classList.contains('is-locked') && !document.querySelector('[data-start-exploration]').disabled`);
  await evaluate(student, `document.querySelector('[data-tab="map"]').click()`);
  await waitFor(student, `document.querySelector('#map-tab').classList.contains('is-active') && document.querySelector('.leaflet-draw-draw-polyline')`);
  await evaluate(teacher, `document.querySelector('#release-volcanoes').click()`);
  await waitFor(student, `!document.querySelector('[data-data-chapter="volcano"]').disabled && document.querySelector('[data-data-chapter="volcano"]').classList.contains('is-active') && document.querySelector('[data-data-chapter="earthquake"]').disabled && document.querySelector('#volcano-count')?.textContent.includes('교사 제공 자료') && globalThis.__plateStudentMap.map.hasLayer(globalThis.__plateStudentMap.layers.volcanoes) && document.querySelector('.volcano-canvas-layer') && !document.querySelector('[data-volcano-timeline]').classList.contains('is-hidden') && document.querySelectorAll('.volcano-marker').length === 0 && !globalThis.__plateStudentMap.map.hasLayer(globalThis.__plateStudentMap.layers.earthquakes)`);
  await evaluate(teacher, `document.querySelector('#release-volcanoes').click()`);
  await waitFor(student, `[...document.querySelectorAll('[data-data-chapter]')].every((button) => button.disabled) && !globalThis.__plateStudentMap.map.hasLayer(globalThis.__plateStudentMap.layers.volcanoes)`);
  await evaluate(teacher, `document.querySelector('#release-earthquakes').click()`);
  await waitFor(student, `!document.querySelector('[data-data-chapter="earthquake"]').disabled && document.querySelector('[data-data-chapter="earthquake"]').classList.contains('is-active') && document.querySelector('[data-data-chapter="volcano"]').disabled && document.querySelector('#quake-count')?.textContent.includes('교사 제공 자료') && globalThis.__plateStudentMap.map.hasLayer(globalThis.__plateStudentMap.layers.earthquakes) && document.querySelector('.earthquake-canvas-layer') && !globalThis.__plateStudentMap.map.hasLayer(globalThis.__plateStudentMap.layers.volcanoes) && !document.querySelector('[data-earthquake-timeline]').classList.contains('is-hidden')`);
  await evaluate(teacher, `document.querySelector('#release-earthquakes').click()`);
  await waitFor(student, `[...document.querySelectorAll('[data-data-chapter]')].every((button) => button.disabled) && !globalThis.__plateStudentMap.map.hasLayer(globalThis.__plateStudentMap.layers.earthquakes)`);
  await evaluate(student, `(() => { const csv='longitude,latitude,name,country,year\\n127.1,36.2,Sample Volcano,Korea,2000\\n142.3,38.1,Test Volcano,Japan,2001\\n'; const input=document.querySelector('#upload-volcanoes'); const transfer=new DataTransfer(); transfer.items.add(new File([csv],'student-volcanoes.csv',{type:'text/csv'})); Object.defineProperty(input,'files',{configurable:true,value:transfer.files}); input.dispatchEvent(new Event('change',{bubbles:true})); })()`);
  await waitFor(student, `document.querySelector('#volcano-count')?.textContent.includes('2곳 · 업로드 자료') && !document.querySelector('[data-data-chapter="volcano"]').disabled && document.querySelector('[data-data-chapter="earthquake"]').disabled && document.querySelector('[data-data-chapter="compare"]').disabled && globalThis.__plateStudentMap.map.hasLayer(globalThis.__plateStudentMap.layers.volcanoes) && globalThis.__plateStudentMap.layers.volcanoes.visibleCount === 0 && !document.querySelector('[data-volcano-timeline]').classList.contains('is-hidden') && document.querySelector('[data-volcano-timeline] [data-timeline-count]')?.textContent.includes('0곳 누적') && !globalThis.__plateStudentMap.map.hasLayer(globalThis.__plateStudentMap.layers.earthquakes)`);
  await evaluate(student, `(() => { const root=document.querySelector('[data-volcano-timeline]'); const range=root.querySelector('[data-timeline-range]'); range.value='1'; range.dispatchEvent(new Event('input',{bubbles:true})); })()`);
  await waitFor(student, `globalThis.__plateStudentMap.layers.volcanoes.visibleCount === 1 && document.querySelector('[data-volcano-timeline] [data-timeline-count]')?.textContent.includes('1곳 누적')`);
  await evaluate(student, `document.querySelector('[data-volcano-timeline] [data-timeline-reset]').click(); document.querySelector('[data-volcano-timeline] [data-timeline-play]').click()`);
  await waitFor(student, `globalThis.__plateStudentMap.layers.volcanoes.visibleCount === 2 && document.querySelector('[data-volcano-timeline] [data-timeline-count]')?.textContent.includes('2곳 누적') && document.querySelector('[data-volcano-timeline] [data-timeline-play]')?.textContent.includes('재생')`);
  await evaluate(student, `(() => { const csv='longitude,latitude,mag,depth,time\\n127.1,36.2,5.1,12,2000-01-03T00:00:00.000Z\\n142.3,38.1,6.2,25,2001-02-04T00:00:00.000Z\\n'; const input=document.querySelector('#upload-earthquakes'); const transfer=new DataTransfer(); transfer.items.add(new File([csv],'student-quakes.csv',{type:'text/csv'})); Object.defineProperty(input,'files',{configurable:true,value:transfer.files}); input.dispatchEvent(new Event('change',{bubbles:true})); })()`);
  await waitFor(student, `document.querySelector('#quake-count')?.textContent.includes('2건 · 업로드 자료') && [...document.querySelectorAll('[data-data-chapter]')].every((button) => !button.disabled) && document.querySelector('[data-data-chapter="earthquake"]').classList.contains('is-active') && !globalThis.__plateStudentMap.map.hasLayer(globalThis.__plateStudentMap.layers.volcanoes) && globalThis.__plateStudentMap.map.hasLayer(globalThis.__plateStudentMap.layers.earthquakes) && globalThis.__plateStudentMap.layers.earthquakes.visibleCount === 0 && !document.querySelector('[data-earthquake-timeline]').classList.contains('is-hidden') && document.querySelector('[data-earthquake-timeline] [data-timeline-count]')?.textContent.includes('0건 누적')`);
  await evaluate(teacher, `document.querySelector('#release-volcanoes').click(); document.querySelector('#release-earthquakes').click()`);
  await waitFor(student, `!document.querySelector('#upload-volcanoes').disabled && !document.querySelector('#upload-earthquakes').disabled && document.querySelector('#quake-count')?.textContent.includes('2건 · 업로드 자료') && globalThis.__plateStudentMap.map.hasLayer(globalThis.__plateStudentMap.layers.earthquakes)`);
  await evaluate(teacher, `document.querySelector('#release-volcanoes').click(); document.querySelector('#release-earthquakes').click()`);
  await waitFor(student, `document.querySelector('#quake-count')?.textContent.includes('2건 · 업로드 자료') && globalThis.__plateStudentMap.map.hasLayer(globalThis.__plateStudentMap.layers.earthquakes)`);
  await evaluate(student, `document.querySelector('[data-data-chapter="compare"]').click()`);
  await waitFor(student, `globalThis.__plateStudentMap.map.hasLayer(globalThis.__plateStudentMap.layers.volcanoes) && globalThis.__plateStudentMap.map.hasLayer(globalThis.__plateStudentMap.layers.earthquakes)`);
  if (process.env.MAP_SCREENSHOT_PATH) {
    await evaluate(student, `(() => { globalThis.__plateStudentMap.map.setView([12,180],2,{animate:false}); return true; })()`);
    await delay(350);
    const screenshot = await student.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
    await writeFile(process.env.MAP_SCREENSHOT_PATH, Buffer.from(screenshot.data, 'base64'));
    await evaluate(student, `globalThis.__plateStudentMap.fitWorld()`);
  }
  await evaluate(student, `document.querySelector('[data-data-chapter="earthquake"]').click()`);
  await evaluate(student, `(() => { const root=document.querySelector('[data-earthquake-timeline]'); const range=root.querySelector('[data-timeline-range]'); range.value='1'; range.dispatchEvent(new Event('input',{bubbles:true})); })()`);
  await waitFor(student, `globalThis.__plateStudentMap.layers.earthquakes.visibleCount === 1 && document.querySelector('[data-earthquake-timeline] [data-timeline-count]')?.textContent.includes('1건 누적')`);
  await evaluate(student, `document.querySelector('[data-earthquake-timeline] [data-timeline-reset]').click(); document.querySelector('[data-earthquake-timeline] [data-timeline-play]').click()`);
  await waitFor(student, `globalThis.__plateStudentMap.layers.earthquakes.visibleCount === 2 && document.querySelector('[data-earthquake-timeline] [data-timeline-count]')?.textContent.includes('2건 누적') && document.querySelector('[data-earthquake-timeline] [data-timeline-play]')?.textContent.includes('재생')`);
  await evaluate(student, `document.querySelector('#submission-form').requestSubmit()`);
  await waitFor(student, `document.querySelector('#submit-status')?.textContent.includes('선 그리기')`);
  await evaluate(student, `globalThis.__plateStudentMap.setLines([[[-76,-15],[-75,-25],[-73,-35]]])`);
  await waitFor(student, `!document.querySelector('.leaflet-draw-edit-edit').classList.contains('leaflet-disabled') && !document.querySelector('.leaflet-draw-edit-remove').classList.contains('leaflet-disabled') && globalThis.__plateStudentMap.drawnItems.getLayers()[0]?.options.pane === 'studentLinePane' && globalThis.__plateStudentMap.drawnItemCopies.getLayers().length === 2 && globalThis.__plateStudentMap.drawnItemCopies.getLayers().every((layer) => layer.options.interactive === false) && Number(globalThis.__plateStudentMap.map.getPane('studentLinePane').style.zIndex) > Number(globalThis.__plateStudentMap.map.getPane('dataPane').style.zIndex)`);
  await evaluate(student, `document.querySelector('[data-data-chapter="volcano"]').click()`);
  await waitFor(student, `globalThis.__plateStudentMap.lineChapter === 'volcano' && globalThis.__plateStudentMap.drawnItemCopies.getLayers().length === 0`);
  await evaluate(student, `document.querySelector('[data-data-chapter="compare"]').click()`);
  await waitFor(student, `globalThis.__plateStudentMap.drawnItemCopies.getLayers().length === 2`);
  await evaluate(student, `document.querySelector('[data-data-chapter="earthquake"]').click()`);
  await waitFor(student, `globalThis.__plateStudentMap.drawnItemCopies.getLayers().length === 2`);
  await evaluate(student, `document.querySelector('#submission-form').requestSubmit()`);
  await waitFor(student, `document.querySelector('#submit-status')?.textContent.includes('근거')`);
  await evaluate(student, `(() => { const e=document.querySelector('#evidence'); e.value='지진이 길게 띠 모양으로 이어져 경계라고 판단했다.'; e.dispatchEvent(new Event('input',{bubbles:true})); document.querySelector('#submission-form').requestSubmit(); })()`);
  await delay(500);
  const submissionDiagnostic = await evaluate(student, `(() => ({status:document.querySelector('#submit-status').textContent,toast:document.querySelector('#toast').textContent,paths:document.querySelectorAll('.leaflet-overlay-pane path').length,db:localStorage.getItem('plate-boundary-local-db')}))()`);
  if (!submissionDiagnostic.status) console.log('Submission diagnostic:', JSON.stringify(submissionDiagnostic));
  const storedLinesAreFirestoreSafe = await evaluate(student, `(() => { const db=JSON.parse(localStorage.getItem('plate-boundary-local-db')); const session=db.sessions['${code}']; const lines=session.groups['1'].v1.lines; return Array.isArray(lines) && lines.length > 0 && Array.isArray(lines[0].points) && !Array.isArray(lines[0].points[0]); })()`);
  if (!storedLinesAreFirestoreSafe) throw new Error('Submission lines are not Firestore-safe objects.');
  await waitFor(student, `!document.querySelector('#principle-content').classList.contains('is-hidden')`);
  await waitFor(teacher, `document.querySelector('#submitted-total')?.textContent === '1/7' && globalThis.__plateTeacherMap.layers.submissions.getLayers().length === 3`);
  await evaluate(teacher, `document.querySelector('[data-submission-chapter="volcano"]').click()`);
  await waitFor(teacher, `globalThis.__plateTeacherMap.layers.submissions.getLayers().length === 0`);
  await evaluate(teacher, `document.querySelector('[data-submission-chapter="earthquake"]').click()`);
  await waitFor(teacher, `globalThis.__plateTeacherMap.layers.submissions.getLayers().length === 3`);
  await evaluate(teacher, `document.querySelector('[data-submission-chapter="all"]').click()`);

  await evaluate(teacher, `window.confirm=()=>true; document.querySelector('[data-delete-group="1"]').click()`);
  await delay(500);
  const deletionDiagnostic = await evaluate(teacher, `(() => ({total:document.querySelector('#submitted-total').textContent,toast:document.querySelector('#teacher-toast').textContent,db:localStorage.getItem('plate-boundary-local-db')}))()`);
  if (deletionDiagnostic.total !== '0/7') throw new Error(`Individual deletion failed: ${JSON.stringify(deletionDiagnostic)}`);
  await waitFor(teacher, `document.querySelector('#submitted-total')?.textContent === '0/7'`);
  await evaluate(student, `document.querySelector('#submission-form').requestSubmit()`);
  await waitFor(teacher, `document.querySelector('#submitted-total')?.textContent === '1/7'`);
  await evaluate(teacher, `document.querySelector('#reset-submissions').click()`);
  await waitFor(teacher, `document.querySelector('#submitted-total')?.textContent === '0/7'`);

  await evaluate(teacher, `document.querySelector('[data-phase="compare"]').click()`);
  await waitFor(student, `document.querySelector('#submit-boundary').disabled && document.querySelector('.leaflet-draw-draw-polyline') === null`);
  await waitFor(teacher, `document.querySelector('[data-phase="compare"] b')?.textContent.includes('마감 취소')`);
  await evaluate(teacher, `document.querySelector('[data-phase="compare"]').click()`);
  await waitFor(student, `!document.querySelector('#submit-boundary').disabled && document.querySelector('.leaflet-draw-draw-polyline')`);
  await waitFor(teacher, `document.querySelector('[data-phase="compare"] b')?.textContent.includes('제출 마감')`);
  await evaluate(teacher, `document.querySelector('[data-phase="compare"]').click()`);
  await waitFor(student, `document.querySelector('#submit-boundary').disabled`);
  await evaluate(teacher, `document.querySelector('[data-phase="reveal"]').click()`);
  await waitFor(student, `globalThis.__plateStudentMap.map.hasLayer(globalThis.__plateStudentMap.layers.boundaries) && globalThis.__plateStudentMap.map.hasLayer(globalThis.__plateStudentMap.layers.plateLabels) && [...document.querySelectorAll('.plate-label')].some((element) => element.textContent.includes('태평양판'))`);
  await evaluate(teacher, `document.querySelector('[data-phase="eastAsia"]').click()`);
  await waitFor(student, `!document.querySelector('#application-card').classList.contains('is-hidden') && !globalThis.__plateStudentMap.map.hasLayer(globalThis.__plateStudentMap.layers.boundaries)`);
  await evaluate(teacher, `document.querySelector('#east-boundary').click()`);
  await waitFor(student, `globalThis.__plateStudentMap.map.hasLayer(globalThis.__plateStudentMap.layers.boundaries)`);
  await evaluate(teacher, `document.querySelector('#korea-detail').click()`);
  await waitFor(student, `globalThis.__plateStudentMap.map.hasLayer(globalThis.__plateStudentMap.layers.korea)`);
  await evaluate(student, `(() => { const rows=[...document.querySelectorAll('.choice-row')]; rows[0].querySelectorAll('button')[0].click(); rows[1].querySelectorAll('button')[0].click(); rows[2].querySelectorAll('button')[1].click(); document.querySelector('#application-form').requestSubmit(); })()`);
  await waitFor(teacher, `document.querySelector('#evidence-list')?.textContent.includes('적용 일본/일본/틀림')`);
  await evaluate(teacher, `document.querySelector('#close-session').click()`);
  await waitFor(student, `document.querySelector('#phase-title')?.textContent === '탐구 마무리' && document.querySelector('#submit-boundary').disabled && document.querySelector('.leaflet-draw-draw-polyline') === null`);
  await waitFor(teacher, `document.querySelector('#close-session b')?.textContent === '수업 다시 열기' && document.querySelector('#phase-label')?.textContent === '수업 종료'`);
  await evaluate(teacher, `document.querySelector('#close-session').click()`);
  await waitFor(student, `document.querySelector('#phase-title')?.textContent === '자료에서 경계 찾기' && !document.querySelector('#submit-boundary').disabled && document.querySelector('.leaflet-draw-draw-polyline')`);
  await evaluate(teacher, `window.confirm=()=>true; document.querySelector('#restart-session').click()`);
  await waitFor(teacher, `document.querySelector('#class-code')?.textContent === 'CLASS1' && document.querySelector('#submitted-total')?.textContent === '0/7' && (() => { const db=JSON.parse(localStorage.getItem('plate-boundary-local-db')); const session=db.sessions.CLASS1; return session?.phase === 'explore' && session?.sessionNumber === 2 && Object.keys(session?.groups || {}).length === 0; })()`);
  await evaluate(teacher, `document.querySelector('#switch-class').click()`);
  await waitFor(teacher, `!document.querySelector('#session-empty').classList.contains('is-hidden') && document.querySelector('[data-class-code="CLASS1"]')`);
  await evaluate(teacher, `document.querySelector('[data-class-code="CLASS1"]').click()`);
  await waitFor(teacher, `document.querySelector('#class-code')?.textContent === 'CLASS1' && document.querySelector('#active-class-name')?.textContent === '2학년 1반'`);

  const studentStatus = await evaluate(student, `document.querySelector('#submit-status').textContent`);
  const teacherStatus = await evaluate(teacher, `document.querySelector('#submitted-total').textContent`);
  const runtimeErrors = [...teacher.exceptions, ...student.exceptions, ...occupiedStudent.exceptions];
  if (runtimeErrors.length) throw new Error(`Browser runtime errors: ${runtimeErrors.join('; ')}`);
  console.log(`Browser smoke passed: session ${code}, student="${studentStatus}", teacher=${teacherStatus}`);
  teacher.socket.close();
  student.socket.close();
  occupiedStudent.socket.close();
} finally {
  if (chrome.exitCode === null) chrome.kill();
  await Promise.race([chromeExited, delay(2000)]);
  const resolvedProfile = path.resolve(profile);
  if (!resolvedProfile.startsWith(path.resolve(os.tmpdir()))) throw new Error(`Unsafe temp path: ${resolvedProfile}`);
  await rm(resolvedProfile, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
}
