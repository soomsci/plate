import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const required = [
  'public/index.html',
  'public/student.html',
  'public/teacher.html',
  'public/styles.css',
  'public/backend.js',
  'public/map-app.js',
  'public/student.js',
  'public/teacher.js',
  'public/vendor/leaflet.js',
  'public/vendor/leaflet.css',
  'public/vendor/leaflet-draw.js',
  'public/vendor/leaflet-draw.css',
  'public/data/countries.geojson',
  'public/data/earthquakes.json',
  'public/data/volcanoes.json',
  'public/data/plate-boundaries.geojson',
  'public/data/korea-earthquakes.json',
  'firebase.json',
  'firestore.rules'
];

for (const file of required) {
  const info = await stat(path.join(root, file));
  if (!info.size) throw new Error(`${file} is empty`);
}

for (const file of required.filter((item) => item.endsWith('.json') || item.endsWith('.geojson'))) {
  JSON.parse(await readFile(path.join(root, file), 'utf8'));
}

const student = await readFile(path.join(root, 'public/student.html'), 'utf8');
const teacher = await readFile(path.join(root, 'public/teacher.html'), 'utf8');
const landing = await readFile(path.join(root, 'public/index.html'), 'utf8');
if (landing.includes('teacher.html') || landing.includes('교사 대시보드')) {
  throw new Error('student landing page must not expose the teacher dashboard');
}
for (const expected of ['student-map', 'submission-form', 'principle-content', 'application-card', 'group-status', 'upload-earthquakes', 'upload-volcanoes']) {
  if (!student.includes(`id="${expected}"`)) throw new Error(`student.html missing #${expected}`);
}
for (const expected of ['teacher-map', 'class-session-form', 'class-name', 'fixed-code', 'create-session', 'restart-session', 'switch-class', 'group-status-list', 'reset-submissions', 'enable-data-exploration', 'release-earthquakes', 'release-volcanoes', 'teacher-toggle-earthquakes', 'teacher-toggle-volcanoes', 'east-boundary', 'close-session']) {
  if (!teacher.includes(`id="${expected}"`)) throw new Error(`teacher.html missing #${expected}`);
}

if (!student.includes('data-earthquake-timeline')) throw new Error('student.html missing earthquake timeline');
if (!student.includes('data-volcano-timeline')) throw new Error('student.html missing volcano timeline');
if (!student.includes('class="plate-process-grid"')) throw new Error('student.html missing plate process diagrams');
for (const chapter of ['earthquake', 'volcano', 'compare']) {
  if (!student.includes(`data-data-chapter="${chapter}"`)) throw new Error(`student.html missing ${chapter} data chapter`);
}
const volcanoChapterIndex = student.indexOf('data-data-chapter="volcano"');
const earthquakeChapterIndex = student.indexOf('data-data-chapter="earthquake"');
if (volcanoChapterIndex > earthquakeChapterIndex) throw new Error('student.html must introduce volcanoes before earthquakes');
if (!student.includes('id="data-empty-state"')) throw new Error('student.html missing locked data state');
if (!teacher.includes('data-earthquake-timeline')) throw new Error('teacher.html missing earthquake timeline');

for (const [file, maximumBytes] of [['countries.geojson', 300000], ['plate-boundaries.geojson', 250000]]) {
  const info = await stat(path.join(root, 'public/data', file));
  if (info.size > maximumBytes) throw new Error(`${file} exceeds optimized size budget`);
}

const volcanoData = JSON.parse(await readFile(path.join(root, 'public/data/volcanoes.json'), 'utf8'));
if (!volcanoData.volcanoes?.length || volcanoData.volcanoes.some((item) => !Number.isFinite(item.lastEruptionYear))) {
  throw new Error('volcanoes.json must include a real lastEruptionYear for every volcano');
}

console.log('Static structure and data checks passed.');
