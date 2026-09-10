const DATA_FILES = {
  countries: './data/countries.geojson?v=20260903-1',
  earthquakes: './data/earthquakes.json?v=20260903-1',
  volcanoes: './data/volcanoes.json?v=20260903-1',
  boundaries: './data/plate-boundaries.geojson?v=20260903-1',
  korea: './data/korea-earthquakes.json?v=20260903-1'
};
const WORLD_OFFSETS = [-360, 0, 360];

const koreaStyle = { radius: 3.1, color: '#8f165d', weight: .65, fillColor: '#d93b8e', fillOpacity: .64 };

// 실제 판 경계를 공개할 때 함께 보여줄 주요 판 이름과 라벨 위치 [이름, 위도, 경도]
const PLATE_LABELS = [
  ['태평양판', 5, -150], ['북아메리카판', 48, -103], ['남아메리카판', -18, -62],
  ['유라시아판', 55, 72], ['아프리카판', 2, 20], ['인도-오스트레일리아판', -25, 118],
  ['남극판', -78, 40], ['나스카판', -22, -100], ['코코스판', 6, -92],
  ['카리브판', 14, -73], ['필리핀판', 17, 133], ['아라비아판', 24, 45]
];

const PointCanvasLayer = L.Layer.extend({
  initialize(type) {
    this.type = type;
    this.items = [];
    this.visibleCount = 0;
    this.frame = null;
    this.projectedItems = null;
    this.projectionZoom = null;
  },

  onAdd(map) {
    this.map = map;
    this.canvas = L.DomUtil.create('canvas', `leaflet-layer point-canvas-layer ${this.type}-canvas-layer`);
    this.canvas.style.pointerEvents = 'none';
    map.getPane('dataPane').appendChild(this.canvas);
    map.on('moveend zoomend resize', this.scheduleRedraw, this);
    this.redraw();
  },

  onRemove(map) {
    map.off('moveend zoomend resize', this.scheduleRedraw, this);
    if (this.frame) cancelAnimationFrame(this.frame);
    this.canvas?.remove();
    this.canvas = null;
    this.map = null;
  },

  setItems(items) {
    this.items = items;
    this.visibleCount = items.length;
    this.projectedItems = null;
    this.projectionZoom = null;
    this.scheduleRedraw();
  },

  setVisibleCount(count) {
    const nextCount = Math.max(0, Math.min(count, this.items.length));
    if (nextCount === this.visibleCount) return;
    this.visibleCount = nextCount;
    this.scheduleRedraw();
  },

  scheduleRedraw() {
    if (!this.map || this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = null;
      this.redraw();
    });
  },

  redraw() {
    if (!this.map || !this.canvas) return;
    const size = this.map.getSize();
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const topLeft = this.map.containerPointToLayerPoint([0, 0]);
    L.DomUtil.setPosition(this.canvas, topLeft);
    const physicalWidth = Math.round(size.x * ratio);
    const physicalHeight = Math.round(size.y * ratio);
    if (this.canvas.width !== physicalWidth) this.canvas.width = physicalWidth;
    if (this.canvas.height !== physicalHeight) this.canvas.height = physicalHeight;
    this.canvas.style.width = `${size.x}px`;
    this.canvas.style.height = `${size.y}px`;
    const context = this.canvas.getContext('2d');
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, size.x, size.y);
    const zoom = this.map.getZoom();
    if (!this.projectedItems || this.projectionZoom !== zoom) {
      this.projectedItems = this.items.map((item) => {
        const latitude = this.type === 'earthquake' ? item[1] : item.lat;
        const longitude = this.type === 'earthquake' ? item[0] : item.lon;
        const point = this.map.project([latitude, longitude], zoom);
        return [point.x, point.y];
      });
      this.projectionZoom = zoom;
    }
    const worldWidth = this.map.getPixelWorldBounds(zoom).getSize().x;
    const pixelOrigin = this.map.getPixelOrigin();
    const panePosition = this.map._getMapPanePos();

    const drawWrapped = (worldPoint, margin, draw) => {
      const pointX = worldPoint[0] - pixelOrigin.x + panePosition.x;
      const pointY = worldPoint[1] - pixelOrigin.y + panePosition.y;
      const firstCopy = Math.ceil((-margin - pointX) / worldWidth);
      const lastCopy = Math.floor((size.x + margin - pointX) / worldWidth);
      for (let copy = firstCopy; copy <= lastCopy; copy += 1) draw(pointX + copy * worldWidth, pointY);
    };

    if (this.type === 'earthquake') {
      context.fillStyle = 'rgba(49,111,232,.48)';
      context.beginPath();
      for (let index = 0; index < this.visibleCount; index += 1) {
        const point = this.projectedItems[index];
        const pointY = point[1] - pixelOrigin.y + panePosition.y;
        if (pointY < -3 || pointY > size.y + 3) continue;
        drawWrapped(point, 3, (x, y) => {
          context.moveTo(x + 2.15, y);
          context.arc(x, y, 2.15, 0, Math.PI * 2);
        });
      }
      context.fill();
      return;
    }

    context.fillStyle = '#ff6b3d';
    context.beginPath();
    for (let index = 0; index < this.visibleCount; index += 1) {
      const point = this.projectedItems[index];
      const pointY = point[1] - pixelOrigin.y + panePosition.y;
      if (pointY < -5 || pointY > size.y + 5) continue;
      drawWrapped(point, 5, (x, y) => {
        context.moveTo(x, y - 4.8);
        context.lineTo(x - 4.4, y + 3.8);
        context.lineTo(x + 4.4, y + 3.8);
        context.closePath();
      });
    }
    context.fill();
  }
});

function addWrappedGeoJson(data, target, options) {
  WORLD_OFFSETS.forEach((longitudeOffset) => {
    L.geoJSON(data, {
      ...options,
      coordsToLatLng: ([longitude, latitude, altitude]) => L.latLng(latitude, longitude + longitudeOffset, altitude)
    }).addTo(target);
  });
}

function addWrappedPolyline(coordinates, target, options, offsets = WORLD_OFFSETS) {
  offsets.forEach((longitudeOffset) => {
    const latlngs = coordinates.map(([longitude, latitude]) => [latitude, longitude + longitudeOffset]);
    if (latlngs.length > 1) L.polyline(latlngs, options).addTo(target);
  });
}

function coordinatesForLine(line) {
  if (Array.isArray(line)) return line;
  if (!Array.isArray(line?.points)) return [];
  return line.points.map((point) => [Number(point.longitude ?? point.lon), Number(point.latitude ?? point.lat)]);
}

async function loadJson(url, fallback) {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${response.status}`);
    return await response.json();
  } catch (error) {
    console.warn(`자료를 불러오지 못했습니다: ${url}`, error);
    return fallback;
  }
}

function eventArray(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.events)) return data.events;
  if (Array.isArray(data?.features)) return data.features;
  return [];
}

function volcanoArray(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.volcanoes)) return data.volcanoes;
  if (Array.isArray(data?.features)) return data.features;
  return [];
}

function eventTime(value) {
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function eventYear(value) {
  if (value == null || value === '') return null;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric >= -12000 && numeric <= 3000) return Math.round(numeric);
  const timestamp = Number.isFinite(numeric) ? numeric : Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  return new Date(timestamp).getUTCFullYear();
}

function normalizeEarthquakeEvent(event) {
  if (event?.geometry?.coordinates) {
    const [longitude, latitude, depth] = event.geometry.coordinates;
    return normalizeEarthquakeEvent([
      longitude,
      latitude,
      event.properties?.magnitude ?? event.properties?.mag,
      depth ?? event.properties?.depth,
      event.properties?.time ?? event.properties?.date
    ]);
  }
  const values = Array.isArray(event)
    ? event
    : [event.longitude ?? event.lon ?? event.lng, event.latitude ?? event.lat, event.magnitude ?? event.mag, event.depth_km ?? event.depthkm ?? event.depth, event.time ?? event.date ?? event.updated];
  const [longitude, latitude, magnitude, depth, timeValue] = values;
  const normalized = [Number(longitude), Number(latitude), Number(magnitude), Number(depth), eventTime(timeValue)];
  if (!normalized.every(Number.isFinite)) return null;
  if (normalized[0] < -180 || normalized[0] > 180 || normalized[1] < -90 || normalized[1] > 90) return null;
  return normalized;
}

function normalizeVolcanoItem(item, index = 0) {
  if (item?.geometry?.coordinates) {
    const [longitude, latitude] = item.geometry.coordinates;
    return normalizeVolcanoItem({
      ...item.properties,
      longitude,
      latitude
    }, index);
  }
  const values = Array.isArray(item)
    ? item
    : [
        item.longitude ?? item.lon ?? item.lng,
        item.latitude ?? item.lat,
        item.name ?? item.volcano_name ?? item.volcanoname,
        item.country,
        item.lastEruptionYear ?? item.last_eruption_year ?? item.lasteruptionyear
          ?? item.eruption_year ?? item.eruptionyear ?? item.year ?? item.time ?? item.date
      ];
  const [longitude, latitude, name, country, yearValue] = values;
  const normalized = {
    id: String(item?.id ?? item?.volcano_number ?? item?.volcanonumber ?? index + 1),
    name: String(name || '화산'),
    country: String(country || ''),
    lon: Number(longitude),
    lat: Number(latitude),
    lastEruptionYear: eventYear(yearValue)
  };
  if (!Number.isFinite(normalized.lon) || !Number.isFinite(normalized.lat)) return null;
  if (normalized.lon < -180 || normalized.lon > 180 || normalized.lat < -90 || normalized.lat > 90) return null;
  return normalized;
}

function parseCsvLine(line) {
  const values = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"' && quoted && line[index + 1] === '"') {
      value += '"';
      index += 1;
    } else if (character === '"') quoted = !quoted;
    else if (character === ',' && !quoted) {
      values.push(value.trim());
      value = '';
    } else value += character;
  }
  values.push(value.trim());
  return values;
}

export async function parseEarthquakeFile(file) {
  if (!file) throw new Error('불러올 파일을 선택해 주세요.');
  if (file.size > 12 * 1024 * 1024) throw new Error('파일은 12MB 이하만 불러올 수 있습니다.');
  const text = (await file.text()).replace(/^\uFEFF/, '').trim();
  let source;

  if (file.name.toLowerCase().endsWith('.json') || text.startsWith('{') || text.startsWith('[')) {
    source = eventArray(JSON.parse(text));
  } else {
    const lines = text.split(/\r?\n/).filter((line) => line.trim());
    const headers = parseCsvLine(lines.shift() || '').map((header) => header.toLowerCase().replace(/[^a-z0-9_]/g, ''));
    source = lines.map((line) => {
      const values = parseCsvLine(line);
      return Object.fromEntries(headers.map((header, index) => [header, values[index]]));
    });
  }

  if (source.length > 50000) throw new Error('한 번에 최대 50,000건까지 표시할 수 있습니다.');
  const events = source.map(normalizeEarthquakeEvent).filter(Boolean);
  if (!events.length) throw new Error('표시할 수 있는 지진 자료가 없습니다.');
  if (events.length !== source.length) throw new Error(`형식이 올바르지 않은 행이 ${source.length - events.length}개 있습니다.`);
  return events;
}

export async function parseVolcanoFile(file) {
  if (!file) throw new Error('불러올 파일을 선택해 주세요.');
  if (file.size > 12 * 1024 * 1024) throw new Error('파일은 12MB 이하만 불러올 수 있습니다.');
  const text = (await file.text()).replace(/^\uFEFF/, '').trim();
  let source;

  if (file.name.toLowerCase().endsWith('.json') || text.startsWith('{') || text.startsWith('[')) {
    source = volcanoArray(JSON.parse(text));
  } else {
    const lines = text.split(/\r?\n/).filter((line) => line.trim());
    const headers = parseCsvLine(lines.shift() || '').map((header) => header.toLowerCase().replace(/[^a-z0-9_]/g, ''));
    source = lines.map((line) => {
      const values = parseCsvLine(line);
      return Object.fromEntries(headers.map((header, index) => [header, values[index]]));
    });
  }

  if (source.length > 50000) throw new Error('한 번에 최대 50,000건까지 표시할 수 있습니다.');
  const volcanoes = source.map(normalizeVolcanoItem).filter(Boolean);
  if (!volcanoes.length) throw new Error('표시할 수 있는 화산 자료가 없습니다. longitude, latitude 열을 확인해 주세요.');
  if (volcanoes.length !== source.length) throw new Error(`형식이 올바르지 않은 행이 ${source.length - volcanoes.length}개 있습니다.`);
  const missingYears = volcanoes.filter((item) => !Number.isFinite(item.lastEruptionYear)).length;
  if (missingYears) throw new Error(`시간 재생에 필요한 화산 연도가 없는 행이 ${missingYears}개 있습니다. year, last_eruption_year, date 또는 time 열을 추가해 주세요.`);
  return volcanoes;
}

export class PlateMap {
  constructor(elementId, { drawing = false, showBaseData = true, deferData = false } = {}) {
    this.map = L.map(elementId, {
      center: [12, 10],
      zoom: 2,
      minZoom: 2,
      maxZoom: 8,
      worldCopyJump: false,
      preferCanvas: true,
      zoomControl: true
    });
    this.map.setMaxBounds([[-84, -540], [84, 540]]);
    this.map.createPane('dataPane').style.zIndex = '410';
    this.map.createPane('referencePane').style.zIndex = '450';
    this.map.createPane('studentLinePane').style.zIndex = '440';
    this.layers = {
      countries: L.layerGroup().addTo(this.map),
      earthquakes: new PointCanvasLayer('earthquake'),
      volcanoes: new PointCanvasLayer('volcano'),
      boundaries: L.layerGroup(),
      plateLabels: L.layerGroup(),
      korea: L.layerGroup(),
      submissions: L.layerGroup().addTo(this.map)
    };
    this.drawnItemCopies = L.layerGroup().addTo(this.map);
    this.drawnItems = L.featureGroup().addTo(this.map);
    this.quakeTimes = [];
    this.quakeEvents = [];
    this.quakeVisibleCount = 0;
    this.volcanoItems = [];
    this.volcanoVisibleCount = 0;
    this.baseEarthquakeEvents = [];
    this.baseVolcanoItems = [];
    this.drawingEnabled = false;
    this.lineChapter = 'volcano';
    this.showBaseData = showBaseData;
    this.ready = null;
    if (!deferData) this.ensureReady();
    if (drawing) this.setupDrawing();
  }

  ensureReady() {
    this.ready ||= this.loadData();
    return this.ready;
  }

  async loadData() {
    const [countries, earthquakes, volcanoes, boundaries, korea] = await Promise.all([
      loadJson(DATA_FILES.countries, { type: 'FeatureCollection', features: [] }),
      loadJson(DATA_FILES.earthquakes, { events: [] }),
      loadJson(DATA_FILES.volcanoes, { volcanoes: [] }),
      loadJson(DATA_FILES.boundaries, { type: 'FeatureCollection', features: [] }),
      loadJson(DATA_FILES.korea, { events: [] })
    ]);

    const quakeEvents = eventArray(earthquakes);
    const koreaEvents = eventArray(korea);
    const volcanoItems = volcanoArray(volcanoes).map(normalizeVolcanoItem).filter(Boolean);
    const countryRenderer = L.canvas({ padding: .35 });
    const referenceRenderer = L.canvas({ padding: .35, pane: 'referencePane' });
    const detailRenderer = L.canvas({ padding: .35, pane: 'dataPane' });

    addWrappedGeoJson(countries, this.layers.countries, {
      renderer: countryRenderer,
      smoothFactor: 1.5,
      style: {
        color: '#8ca0a5',
        weight: .55,
        fillColor: '#edf0e9',
        fillOpacity: 1
      },
      interactive: false
    });

    this.baseEarthquakeEvents = quakeEvents.map(normalizeEarthquakeEvent).filter(Boolean);
    this.baseVolcanoItems = volcanoItems;
    this.setEarthquakeEvents(this.baseEarthquakeEvents);
    this.setVolcanoItems(this.baseVolcanoItems);

    if (boundaries?.features?.length) {
      // 흰 케이싱 위에 굵은 실선 — 모둠 선(점선·색상)과 확실히 구분되고 항상 맨 위에 올라온다
      addWrappedGeoJson(boundaries, this.layers.boundaries, {
        pane: 'referencePane',
        renderer: referenceRenderer,
        smoothFactor: 1.5,
        style: { color: '#ffffff', weight: 7, opacity: .85, lineCap: 'round', lineJoin: 'round' },
        interactive: false
      });
      addWrappedGeoJson(boundaries, this.layers.boundaries, {
        pane: 'referencePane',
        renderer: referenceRenderer,
        smoothFactor: 1.5,
        style: { color: '#e10600', weight: 3.4, opacity: 1, lineCap: 'round', lineJoin: 'round' },
        interactive: false
      });
    }

    PLATE_LABELS.forEach(([name, lat, lon]) => {
      WORLD_OFFSETS.forEach((longitudeOffset) => {
        L.marker([lat, lon + longitudeOffset], {
          icon: L.divIcon({ className: 'plate-label', html: `<span>${name}</span>` }),
          interactive: false,
          keyboard: false
        }).addTo(this.layers.plateLabels);
      });
    });

    koreaEvents.forEach((event) => {
      const [lon, lat, magnitude, depth] = event;
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
      L.circleMarker([lat, lon], { ...koreaStyle, renderer: detailRenderer })
        .bindTooltip(`한반도 상세 · 규모 ${Number(magnitude).toFixed(1)}${depth != null ? ` · 깊이 ${Math.round(depth)} km` : ''}`, { sticky: true })
        .addTo(this.layers.korea);
    });

    this.setLayer('earthquakes', this.showBaseData);
    return {
      earthquakes: this.quakeEvents.length,
      volcanoes: volcanoItems.length,
      boundaries: boundaries?.features?.length || 0,
      korea: koreaEvents.length,
      meta: { earthquakes: earthquakes.meta, volcanoes: volcanoes.meta, korea: korea.meta }
    };
  }

  getEarthquakeTimeline() {
    return {
      startTime: this.quakeTimes[0] || null,
      endTime: this.quakeTimes.at(-1) || null,
      visible: this.quakeVisibleCount,
      total: this.quakeEvents.length
    };
  }

  setEarthquakeEvents(events) {
    this.quakeTimes = [];
    this.quakeEvents = events.map(normalizeEarthquakeEvent).filter(Boolean).sort((a, b) => a[4] - b[4]);
    this.quakeTimes = this.quakeEvents.map((event) => event[4]);
    this.quakeVisibleCount = this.quakeEvents.length;
    this.layers.earthquakes.setItems(this.quakeEvents);
    return this.getEarthquakeTimeline();
  }

  setVolcanoItems(items) {
    this.volcanoItems = items.map(normalizeVolcanoItem).filter(Boolean).sort((a, b) => {
      const first = Number.isFinite(a.lastEruptionYear) ? a.lastEruptionYear : Infinity;
      const second = Number.isFinite(b.lastEruptionYear) ? b.lastEruptionYear : Infinity;
      return first - second;
    });
    this.volcanoVisibleCount = this.volcanoItems.length;
    this.layers.volcanoes.setItems(this.volcanoItems);
    return this.getVolcanoTimeline();
  }

  getVolcanoTimeline() {
    const dated = this.volcanoItems.filter((item) => Number.isFinite(item.lastEruptionYear));
    return {
      startYear: dated[0]?.lastEruptionYear ?? null,
      endYear: dated.at(-1)?.lastEruptionYear ?? null,
      visible: this.volcanoVisibleCount,
      total: this.volcanoItems.length
    };
  }

  getEarthquakeCsv() {
    const rows = this.quakeEvents.map(([lon, lat, magnitude, depth, time]) => (
      `${lon},${lat},${magnitude},${depth},${new Date(time).toISOString()}`
    ));
    return `\uFEFFlongitude,latitude,magnitude,depth_km,time\n${rows.join('\n')}\n`;
  }

  getTeacherEarthquakeCsv() {
    const rows = this.baseEarthquakeEvents.map(([lon, lat, magnitude, depth, time]) => (
      `${lon},${lat},${magnitude},${depth},${new Date(time).toISOString()}`
    ));
    return `\uFEFFlongitude,latitude,magnitude,depth_km,time\n${rows.join('\n')}\n`;
  }

  getVolcanoCsv(items = this.volcanoItems) {
    const csvValue = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`;
    const rows = items.map((item) => [item.lon, item.lat, csvValue(item.name), csvValue(item.country), item.lastEruptionYear ?? ''].join(','));
    return `\uFEFFlongitude,latitude,name,country,last_eruption_year\n${rows.join('\n')}\n`;
  }

  getTeacherVolcanoCsv() {
    return this.getVolcanoCsv(this.baseVolcanoItems);
  }

  setEarthquakeTime(timestamp) {
    let low = 0;
    let high = this.quakeTimes.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (this.quakeTimes[middle] <= timestamp) low = middle + 1;
      else high = middle;
    }

    const nextCount = low;
    this.quakeVisibleCount = nextCount;
    this.layers.earthquakes.setVisibleCount(nextCount);
    return this.getEarthquakeTimeline();
  }

  setEarthquakeCount(count) {
    this.quakeVisibleCount = Math.max(0, Math.min(Math.round(count), this.quakeEvents.length));
    this.layers.earthquakes.setVisibleCount(this.quakeVisibleCount);
    return this.getEarthquakeTimeline();
  }

  setVolcanoCount(count) {
    this.volcanoVisibleCount = Math.max(0, Math.min(Math.round(count), this.volcanoItems.length));
    this.layers.volcanoes.setVisibleCount(this.volcanoVisibleCount);
    return this.getVolcanoTimeline();
  }

  setupDrawing() {
    this.drawControl = new L.Control.Draw({
      position: 'topleft',
      draw: {
        polyline: {
          shapeOptions: { color: '#071a2b', weight: 4, opacity: .9, pane: 'studentLinePane' },
          metric: true,
          showLength: false,
          repeatMode: true
        },
        polygon: false,
        rectangle: false,
        circle: false,
        circlemarker: false,
        marker: false
      },
      edit: { featureGroup: this.drawnItems, edit: true, remove: true }
    });
    this.map.on(L.Draw.Event.CREATED, ({ layer }) => {
      layer.options.chapter = this.lineChapter;
      this.drawnItems.addLayer(layer);
      this.syncDrawnItemCopies();
      this.dispatchChange();
    });
    this.map.on(L.Draw.Event.EDITED, () => {
      this.syncDrawnItemCopies();
      this.dispatchChange();
    });
    this.map.on(L.Draw.Event.DELETED, () => {
      this.syncDrawnItemCopies();
      this.dispatchChange();
    });
  }

  setDrawingEnabled(enabled) {
    if (!this.drawControl) return;
    if (enabled && !this.drawingEnabled) this.map.addControl(this.drawControl);
    if (!enabled && this.drawingEnabled) this.map.removeControl(this.drawControl);
    this.drawingEnabled = enabled;
  }

  dispatchChange() {
    this.map.getContainer().dispatchEvent(new CustomEvent('boundarychange', { detail: this.getLines() }));
  }

  setLayer(name, visible) {
    const layer = this.layers[name];
    if (!layer) return;
    if (visible && !this.map.hasLayer(layer)) layer.addTo(this.map);
    if (!visible && this.map.hasLayer(layer)) this.map.removeLayer(layer);
  }

  lineCoordinates(layer) {
    const latlngs = layer.getLatLngs();
    const flattened = Array.isArray(latlngs[0]) ? latlngs.flat(Infinity).filter((item) => item?.lat != null) : latlngs;
    return flattened.length > 1 ? flattened.map(({ lat, lng }) => [Number(lng.toFixed(5)), Number(lat.toFixed(5))]) : null;
  }

  lineChapterVisible(layer) {
    return this.lineChapter === 'compare' || (layer.options.chapter || 'volcano') === this.lineChapter;
  }

  setLineChapter(chapter) {
    this.lineChapter = chapter || 'volcano';
    this.applyChapterVisibility();
  }

  applyChapterVisibility() {
    // ponytail: 다른 챕터에서 그린 선은 drawnItems에 남긴 채 opacity 0으로만 숨김. 수업 흐름상 편집 충돌 없음
    this.drawnItems.eachLayer((layer) => layer.setStyle({ opacity: this.lineChapterVisible(layer) ? .9 : 0 }));
    this.syncDrawnItemCopies();
  }

  getLines() {
    const lines = [];
    this.drawnItems.eachLayer((layer) => {
      const coordinates = this.lineCoordinates(layer);
      if (coordinates) lines.push(coordinates);
    });
    return lines;
  }

  getLineRecords() {
    const records = [];
    this.drawnItems.eachLayer((layer) => {
      const coordinates = this.lineCoordinates(layer);
      if (coordinates) records.push({ chapter: layer.options.chapter || 'volcano', coordinates });
    });
    return records;
  }

  syncDrawnItemCopies() {
    this.drawnItemCopies.clearLayers();
    this.drawnItems.eachLayer((layer) => {
      if (!this.lineChapterVisible(layer)) return;
      const coordinates = this.lineCoordinates(layer);
      if (!coordinates) return;
      addWrappedPolyline(coordinates, this.drawnItemCopies, {
        color: '#071a2b',
        weight: 4,
        opacity: .9,
        pane: 'studentLinePane',
        interactive: false
      }, [-360, 360]);
    });
  }

  setLines(lines = []) {
    this.drawnItems.clearLayers();
    lines.forEach((line) => {
      const coordinates = coordinatesForLine(line);
      const latlngs = coordinates.map(([lon, lat]) => [lat, lon]);
      if (latlngs.length > 1) L.polyline(latlngs, {
        color: '#071a2b',
        weight: 4,
        opacity: .9,
        pane: 'studentLinePane',
        chapter: line?.chapter || this.lineChapter
      }).addTo(this.drawnItems);
    });
    this.applyChapterVisibility();
  }

  showSubmissions(groups, visibility = {}, chapterFilter = 'all') {
    const colors = ['#ff5d35', '#2a7fff', '#13a17d', '#b640da', '#e9a51b', '#e93873', '#627f24'];
    this.layers.submissions.clearLayers();
    groups.forEach((group) => {
      if (visibility[group.group] === false) return;
      (group.v1?.lines || []).forEach((line) => {
        const chapter = line?.chapter || 'volcano';
        if (chapterFilter !== 'all' && chapter !== chapterFilter) return;
        const coordinates = coordinatesForLine(line);
        const options = {
          color: colors[(group.group - 1) % colors.length],
          weight: 4,
          opacity: .72,
          lineCap: 'round',
          dashArray: chapter === 'volcano' ? '6 5' : null,
          pane: 'studentLinePane'
        };
        const label = `${group.group}모둠 · ${chapter === 'volcano' ? '화산' : '지진'} 선`;
        WORLD_OFFSETS.forEach((longitudeOffset) => {
          const latlngs = coordinates.map(([longitude, latitude]) => [latitude, longitude + longitudeOffset]);
          if (latlngs.length < 2) return;
          L.polyline(latlngs, options)
            .bindTooltip(label, { sticky: true })
            .addTo(this.layers.submissions);
        });
      });
    });
  }

  fitWorld() {
    this.map.setView([12, 10], 2, { animate: true });
  }

  fitEastAsia() {
    this.map.fitBounds([[30, 120], [47, 148]], { animate: true, padding: [20, 20] });
  }

  invalidateSize() {
    setTimeout(() => this.map.invalidateSize(), 0);
  }
}

async function setupAccumulationTimeline(map, root, {
  type,
  unit,
  getState,
  setCount,
  valueAt,
  formatValue,
  formatBound
}) {
  if (!root) return null;
  await map.ensureReady();

  const range = root.querySelector('[data-timeline-range]');
  const playButton = root.querySelector('[data-timeline-play]');
  const resetButton = root.querySelector('[data-timeline-reset]');
  const dateLabel = root.querySelector('[data-timeline-date]');
  const countLabel = root.querySelector('[data-timeline-count]');
  const startLabel = root.querySelector('[data-timeline-start]');
  const endLabel = root.querySelector('[data-timeline-end]');
  if (!range) return null;
  let timeline = null;
  let timer = null;

  function render() {
    if (!timeline) return;
    const count = Number(range.value);
    const state = setCount(count);
    const currentValue = count > 0 ? valueAt(Math.min(count, state.total) - 1) : null;
    dateLabel.textContent = count > 0 ? formatValue(currentValue) : '재생 전 · 지도에 표시된 점 없음';
    countLabel.textContent = `${state.visible.toLocaleString('ko-KR')}${unit} 누적`;
    range.style.setProperty('--timeline-progress', `${state.total ? (state.visible / state.total) * 100 : 0}%`);
  }

  function reload({ initialEmpty = false } = {}) {
    pause();
    timeline = getState();
    range.min = '0';
    range.max = String(timeline.total);
    range.step = '1';
    range.value = String(initialEmpty ? 0 : timeline.total);
    startLabel.textContent = formatBound('start', timeline);
    endLabel.textContent = formatBound('end', timeline);
    const disabled = timeline.total === 0;
    range.disabled = disabled;
    playButton.disabled = disabled;
    resetButton.disabled = disabled;
    render();
  }

  function pause() {
    if (timer) clearInterval(timer);
    timer = null;
    playButton.textContent = '▶ 재생';
    playButton.setAttribute('aria-label', `${type} 누적 재생`);
  }

  function play() {
    if (timer) return pause();
    if (!timeline?.total) return;
    if (Number(range.value) >= timeline.total) {
      range.value = '0';
      render();
    }
    playButton.textContent = 'Ⅱ 일시정지';
    playButton.setAttribute('aria-label', `${type} 누적 재생 일시정지`);
    const step = Math.max(1, Math.ceil(timeline.total / 240));
    timer = setInterval(() => {
      const next = Math.min(timeline.total, Number(range.value) + step);
      range.value = String(next);
      render();
      if (next >= timeline.total) pause();
    }, 65);
  }

  range.addEventListener('input', () => {
    pause();
    render();
  });
  playButton.addEventListener('click', play);
  resetButton.addEventListener('click', () => {
    pause();
    range.value = '0';
    render();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) pause();
  });
  reload();

  return { play, pause, render, reload };
}

function formatEarthquakeDate(timestamp) {
  if (!Number.isFinite(timestamp)) return '날짜 미상 자료까지';
  const date = new Date(timestamp);
  return `${date.getUTCFullYear()}년 ${date.getUTCMonth() + 1}월 ${date.getUTCDate()}일까지`;
}

function formatVolcanoYear(year, suffix = '까지') {
  if (!Number.isFinite(year)) return `연도 미상 자료${suffix}`;
  return year < 0 ? `기원전 ${Math.abs(year).toLocaleString('ko-KR')}년${suffix}` : `${year}년${suffix}`;
}

export function setupEarthquakeTimeline(map, root) {
  return setupAccumulationTimeline(map, root, {
    type: '지진',
    unit: '건',
    getState: () => map.getEarthquakeTimeline(),
    setCount: (count) => map.setEarthquakeCount(count),
    valueAt: (index) => map.quakeEvents[index]?.[4] ?? null,
    formatValue: formatEarthquakeDate,
    formatBound: (edge, state) => {
      const timestamp = edge === 'start' ? state.startTime : state.endTime;
      return Number.isFinite(timestamp) ? String(new Date(timestamp).getUTCFullYear()) : '—';
    }
  });
}

export function setupVolcanoTimeline(map, root) {
  return setupAccumulationTimeline(map, root, {
    type: '화산',
    unit: '곳',
    getState: () => map.getVolcanoTimeline(),
    setCount: (count) => map.setVolcanoCount(count),
    valueAt: (index) => map.volcanoItems[index]?.lastEruptionYear ?? null,
    formatValue: (year) => formatVolcanoYear(year),
    formatBound: (edge, state) => formatVolcanoYear(edge === 'start' ? state.startYear : state.endYear, '')
  });
}
