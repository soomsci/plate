import { mkdir, writeFile } from 'node:fs/promises';
import https from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

function requestBuffer(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = https.get({
      hostname: parsed.hostname,
      path: `${parsed.pathname}${parsed.search}`,
      headers: { 'User-Agent': 'PlateBoundaryClassroom/1.0' }
    }, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location && redirects < 5) {
        response.resume();
        return resolve(requestBuffer(new URL(response.headers.location, url).href, redirects + 1));
      }
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        if (response.statusCode < 200 || response.statusCode >= 300) return reject(new Error(`${response.statusCode} ${url}`));
        resolve(Buffer.concat(chunks));
      });
    });
    req.on('error', reject);
  });
}

const assets = [
  ['vendor/leaflet.css', 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'],
  ['vendor/leaflet.js', 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'],
  ['vendor/leaflet-draw.css', 'https://unpkg.com/leaflet-draw@1.0.4/dist/leaflet.draw.css'],
  ['vendor/leaflet-draw.js', 'https://unpkg.com/leaflet-draw@1.0.4/dist/leaflet.draw.js'],
  ['vendor/images/spritesheet.png', 'https://unpkg.com/leaflet-draw@1.0.4/dist/images/spritesheet.png'],
  ['vendor/images/spritesheet-2x.png', 'https://unpkg.com/leaflet-draw@1.0.4/dist/images/spritesheet-2x.png'],
  ['data/countries.geojson', 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson']
];

for (const [destination, url] of assets) {
  const target = path.join(root, destination);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, await requestBuffer(url));
  process.stdout.write(`saved ${destination}\n`);
}
