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
for (const expected of ['student-map', 'submission-form', 'principle-content', 'application-card']) {
  if (!student.includes(`id="${expected}"`)) throw new Error(`student.html missing #${expected}`);
}
for (const expected of ['teacher-map', 'create-session', 'group-status-list', 'reset-submissions', 'east-boundary']) {
  if (!teacher.includes(`id="${expected}"`)) throw new Error(`teacher.html missing #${expected}`);
}

console.log('Static structure and data checks passed.');
