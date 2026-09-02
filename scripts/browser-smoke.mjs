import { mkdtemp, rm } from 'node:fs/promises';
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
  const teacher = await createTarget(`${baseUrl}/teacher.html?backend=local`);
  await waitFor(teacher, `document.querySelector('#create-session') && document.querySelector('#backend-mode')?.textContent.includes('로컬')`);
  await evaluate(teacher, `document.querySelector('#create-session').click()`);
  await waitFor(teacher, `document.querySelector('#class-code')?.textContent !== '------'`);
  const code = await evaluate(teacher, `document.querySelector('#class-code').textContent`);

  const student = await createTarget(`${baseUrl}/student.html?code=${code}&backend=local`);
  await waitFor(student, `document.querySelector('#group-grid button') && document.querySelector('#group-dialog')?.open`);
  await evaluate(student, `document.querySelector('#group-grid button').click(); document.querySelector('#join-group').click()`);
  await waitFor(student, `!document.querySelector('#group-dialog').open && document.querySelector('.leaflet-draw-draw-polyline')`);
  await evaluate(student, `globalThis.__plateStudentMap.setLines([[[-76,-15],[-75,-25],[-73,-35]]])`);
  await evaluate(student, `(() => { const e=document.querySelector('#evidence'); e.value='지진이 길게 띠 모양으로 이어져 경계라고 판단했다.'; e.dispatchEvent(new Event('input',{bubbles:true})); document.querySelector('#submission-form').requestSubmit(); })()`);
  await delay(500);
  const submissionDiagnostic = await evaluate(student, `(() => ({status:document.querySelector('#submit-status').textContent,toast:document.querySelector('#toast').textContent,paths:document.querySelectorAll('.leaflet-overlay-pane path').length,db:localStorage.getItem('plate-boundary-local-db')}))()`);
  if (!submissionDiagnostic.status) console.log('Submission diagnostic:', JSON.stringify(submissionDiagnostic));
  await waitFor(student, `!document.querySelector('#principle-content').classList.contains('is-hidden')`);
  await waitFor(teacher, `document.querySelector('#submitted-total')?.textContent === '1/6'`);

  await evaluate(teacher, `window.confirm=()=>true; document.querySelector('[data-delete-group="1"]').click()`);
  await delay(500);
  const deletionDiagnostic = await evaluate(teacher, `(() => ({total:document.querySelector('#submitted-total').textContent,toast:document.querySelector('#teacher-toast').textContent,db:localStorage.getItem('plate-boundary-local-db')}))()`);
  if (deletionDiagnostic.total !== '0/6') throw new Error(`Individual deletion failed: ${JSON.stringify(deletionDiagnostic)}`);
  await waitFor(teacher, `document.querySelector('#submitted-total')?.textContent === '0/6'`);
  await evaluate(student, `document.querySelector('#submission-form').requestSubmit()`);
  await waitFor(teacher, `document.querySelector('#submitted-total')?.textContent === '1/6'`);
  await evaluate(teacher, `document.querySelector('#reset-submissions').click()`);
  await waitFor(teacher, `document.querySelector('#submitted-total')?.textContent === '0/6'`);

  await evaluate(teacher, `document.querySelector('[data-phase="compare"]').click()`);
  await waitFor(student, `document.querySelector('#submit-boundary').disabled`);
  await evaluate(teacher, `document.querySelector('[data-phase="reveal"]').click()`);
  await waitFor(student, `globalThis.__plateStudentMap.map.hasLayer(globalThis.__plateStudentMap.layers.boundaries)`);
  await evaluate(teacher, `document.querySelector('[data-phase="eastAsia"]').click()`);
  await waitFor(student, `!document.querySelector('#application-card').classList.contains('is-hidden') && !globalThis.__plateStudentMap.map.hasLayer(globalThis.__plateStudentMap.layers.boundaries)`);
  await evaluate(teacher, `document.querySelector('#east-boundary').click()`);
  await waitFor(student, `globalThis.__plateStudentMap.map.hasLayer(globalThis.__plateStudentMap.layers.boundaries)`);
  await evaluate(teacher, `document.querySelector('#korea-detail').click()`);
  await waitFor(student, `globalThis.__plateStudentMap.map.hasLayer(globalThis.__plateStudentMap.layers.korea)`);
  await evaluate(student, `(() => { const rows=[...document.querySelectorAll('.choice-row')]; rows[0].querySelectorAll('button')[0].click(); rows[1].querySelectorAll('button')[0].click(); rows[2].querySelectorAll('button')[1].click(); document.querySelector('#application-form').requestSubmit(); })()`);
  await waitFor(teacher, `document.querySelector('#evidence-list')?.textContent.includes('적용 일본/일본/틀림')`);

  const studentStatus = await evaluate(student, `document.querySelector('#submit-status').textContent`);
  const teacherStatus = await evaluate(teacher, `document.querySelector('#submitted-total').textContent`);
  const runtimeErrors = [...teacher.exceptions, ...student.exceptions];
  if (runtimeErrors.length) throw new Error(`Browser runtime errors: ${runtimeErrors.join('; ')}`);
  console.log(`Browser smoke passed: session ${code}, student="${studentStatus}", teacher=${teacherStatus}`);
  teacher.socket.close();
  student.socket.close();
} finally {
  if (chrome.exitCode === null) chrome.kill();
  await Promise.race([chromeExited, delay(2000)]);
  const resolvedProfile = path.resolve(profile);
  if (!resolvedProfile.startsWith(path.resolve(os.tmpdir()))) throw new Error(`Unsafe temp path: ${resolvedProfile}`);
  await rm(resolvedProfile, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
}
