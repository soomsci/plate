import { mkdir, writeFile } from 'node:fs/promises';
import https from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDirectory = path.join(root, 'public', 'data');
const startYear = 2000;
const endDate = process.argv[2] || new Date().toISOString().slice(0, 10);
const endYear = Number(endDate.slice(0, 4));

function request(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = https.get({
      hostname: parsed.hostname,
      path: `${parsed.pathname}${parsed.search}`,
      headers: { 'User-Agent': 'PlateBoundaryClassroom/1.0 (education data snapshot)' },
      rejectUnauthorized: !parsed.hostname.endsWith('volcano.si.edu')
    }, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location && redirects < 5) {
        response.resume();
        return resolve(request(new URL(response.headers.location, url).href, redirects + 1));
      }
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        if (response.statusCode < 200 || response.statusCode >= 300) {
          return reject(new Error(`${response.statusCode} ${url}\n${body.slice(0, 300)}`));
        }
        resolve(body);
      });
    });
    req.on('error', reject);
  });
}

async function requestJson(url) {
  return JSON.parse(await request(url));
}

function yearWindows() {
  const windows = [];
  for (let year = startYear; year <= endYear; year += 1) {
    const start = `${year}-01-01`;
    const end = year === endYear ? endDate : `${year + 1}-01-01`;
    if (start < end) windows.push([start, end]);
  }
  return windows;
}

async function fetchEarthquakes({ minMagnitude, bounds = null }) {
  const all = new Map();
  for (const [start, end] of yearWindows()) {
    const params = new URLSearchParams({
      format: 'geojson',
      starttime: start,
      endtime: end,
      minmagnitude: String(minMagnitude),
      eventtype: 'earthquake',
      orderby: 'time-asc',
      limit: '20000'
    });
    if (bounds) {
      params.set('minlatitude', String(bounds.minLat));
      params.set('maxlatitude', String(bounds.maxLat));
      params.set('minlongitude', String(bounds.minLon));
      params.set('maxlongitude', String(bounds.maxLon));
    }
    const url = `https://earthquake.usgs.gov/fdsnws/event/1/query?${params}`;
    const data = await requestJson(url);
    for (const feature of data.features || []) {
      if (feature.geometry?.type !== 'Point') continue;
      const [lon, lat, depth] = feature.geometry.coordinates;
      const magnitude = feature.properties?.mag;
      if (![lon, lat, depth, magnitude].every(Number.isFinite)) continue;
      all.set(feature.id, [lon, lat, magnitude, depth, feature.properties?.time || null]);
    }
    process.stdout.write(`USGS ${start} ~ ${end}: ${data.features?.length || 0}\n`);
  }
  return [...all.values()];
}

function spatialSample(events, maxPerCell = 11) {
  const cells = new Map();
  for (const event of events) {
    const [lon, lat] = event;
    const key = `${Math.floor(lon / 2)}:${Math.floor(lat / 2)}`;
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(event);
  }
  const sampled = [];
  for (const cellEvents of cells.values()) {
    if (cellEvents.length <= maxPerCell) {
      sampled.push(...cellEvents);
      continue;
    }
    cellEvents.sort((a, b) => a[4] - b[4]);
    const step = (cellEvents.length - 1) / (maxPerCell - 1);
    for (let index = 0; index < maxPerCell; index += 1) {
      sampled.push(cellEvents[Math.round(index * step)]);
    }
  }
  return sampled;
}

function property(properties, candidates) {
  const entries = Object.entries(properties || {});
  for (const candidate of candidates) {
    const match = entries.find(([key]) => key.toLowerCase().replace(/[^a-z0-9]/g, '') === candidate);
    if (match) return match[1];
  }
  return '';
}

async function fetchVolcanoes() {
  const params = new URLSearchParams({
    service: 'WFS',
    version: '1.0.0',
    request: 'GetFeature',
    typeName: 'GVP-VOTW:Smithsonian_VOTW_Holocene_Volcanoes',
    outputFormat: 'application/json',
    maxFeatures: '5000'
  });
  const data = await requestJson(`https://webservices.volcano.si.edu/geoserver/GVP-VOTW/ows?${params}`);
  return (data.features || []).flatMap((feature) => {
    if (feature.geometry?.type !== 'Point') return [];
    const [lon, lat] = feature.geometry.coordinates;
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return [];
    return [{
      id: String(property(feature.properties, ['volcanonumber', 'volcanonum', 'number']) || feature.id || ''),
      name: String(property(feature.properties, ['volcanoname', 'name']) || '화산'),
      country: String(property(feature.properties, ['country']) || ''),
      lat,
      lon
    }];
  });
}

async function fetchBoundaries() {
  const features = [];
  let template = null;
  for (let offset = 0; ; offset += 1000) {
    const params = new URLSearchParams({
      where: '1=1',
      outFields: 'OBJECTID,NAME,LABEL',
      returnGeometry: 'true',
      outSR: '4326',
      orderByFields: 'OBJECTID',
      resultOffset: String(offset),
      resultRecordCount: '1000',
      f: 'geojson'
    });
    const page = await requestJson(`https://earthquake.usgs.gov/arcgis/rest/services/eq/map_plateboundaries/MapServer/1/query?${params}`);
    template ||= page;
    features.push(...(page.features || []));
    process.stdout.write(`USGS plate boundaries offset ${offset}: ${page.features?.length || 0}\n`);
    if (!page.features || page.features.length < 1000) break;
  }
  return { ...template, features };
}

async function saveJson(filename, data) {
  await writeFile(path.join(outputDirectory, filename), JSON.stringify(data), 'utf8');
  process.stdout.write(`saved ${filename}\n`);
}

await mkdir(outputDirectory, { recursive: true });

const rawEarthquakes = await fetchEarthquakes({ minMagnitude: 5 });
const earthquakes = spatialSample(rawEarthquakes);
await saveJson('earthquakes.json', {
  meta: {
    source: 'USGS Earthquake Catalog',
    sourceUrl: 'https://earthquake.usgs.gov/fdsnws/event/1/',
    startDate: `${startYear}-01-01`,
    endDate,
    minMagnitude: 5,
    rawCount: rawEarthquakes.length,
    displayCount: earthquakes.length,
    sampling: '2-degree grid, up to 11 temporally spaced events per cell'
  },
  events: earthquakes
});

const volcanoes = await fetchVolcanoes();
await saveJson('volcanoes.json', {
  meta: {
    source: 'Smithsonian Global Volcanism Program — Holocene Volcanoes',
    sourceUrl: 'https://volcano.si.edu/database/webservices.cfm',
    snapshotDate: endDate
  },
  volcanoes
});

const boundaries = await fetchBoundaries();
boundaries.meta = {
  source: 'USGS Tectonic Plate Boundaries (Bird, 2003)',
  sourceUrl: 'https://earthquake.usgs.gov/arcgis/rest/services/eq/map_plateboundaries/MapServer/1',
  snapshotDate: endDate
};
await saveJson('plate-boundaries.geojson', boundaries);

const koreaRaw = await fetchEarthquakes({
  minMagnitude: 2.5,
  bounds: { minLat: 32, maxLat: 44, minLon: 122, maxLon: 133 }
});
await saveJson('korea-earthquakes.json', {
  meta: {
    source: 'USGS Earthquake Catalog — Korean Peninsula regional detail',
    sourceUrl: 'https://earthquake.usgs.gov/fdsnws/event/1/',
    startDate: `${startYear}-01-01`,
    endDate,
    minMagnitude: 2.5,
    bounds: [122, 32, 133, 44],
    note: 'Replace with a reviewed KMA/KIGAM snapshot when an API key is available.'
  },
  events: koreaRaw
});

process.stdout.write(`\nDone: ${earthquakes.length} global earthquakes, ${volcanoes.length} volcanoes, ${boundaries.features?.length || 0} boundary features, ${koreaRaw.length} regional earthquakes.\n`);
