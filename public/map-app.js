const DATA_FILES = {
  countries: './data/countries.geojson',
  earthquakes: './data/earthquakes.json',
  volcanoes: './data/volcanoes.json',
  boundaries: './data/plate-boundaries.geojson',
  korea: './data/korea-earthquakes.json'
};

const quakeStyle = { radius: 2.1, color: 'rgba(31,93,224,.24)', weight: .4, fillColor: '#316fe8', fillOpacity: .36 };
const koreaStyle = { radius: 3.1, color: '#8f165d', weight: .65, fillColor: '#d93b8e', fillOpacity: .64 };

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
  return Array.isArray(data) ? data : data.events || [];
}

export class PlateMap {
  constructor(elementId, { drawing = false, showBaseData = true } = {}) {
    this.map = L.map(elementId, {
      center: [12, 10],
      zoom: 2,
      minZoom: 2,
      maxZoom: 8,
      worldCopyJump: true,
      preferCanvas: true,
      zoomControl: true
    });
    this.map.setMaxBounds([[-84, -240], [84, 240]]);
    this.layers = {
      countries: L.layerGroup().addTo(this.map),
      earthquakes: L.layerGroup(),
      volcanoes: L.layerGroup(),
      boundaries: L.layerGroup(),
      korea: L.layerGroup(),
      submissions: L.layerGroup().addTo(this.map)
    };
    this.drawnItems = L.featureGroup().addTo(this.map);
    this.drawingEnabled = false;
    this.showBaseData = showBaseData;
    this.ready = this.loadData();
    if (drawing) this.setupDrawing();
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
    const volcanoItems = Array.isArray(volcanoes) ? volcanoes : volcanoes.volcanoes || [];
    const renderer = L.canvas({ padding: .35 });

    L.geoJSON(countries, {
      style: {
        color: '#8ca0a5',
        weight: .55,
        fillColor: '#edf0e9',
        fillOpacity: 1
      },
      interactive: false
    }).addTo(this.layers.countries);

    quakeEvents.forEach((event) => {
      const [lon, lat, magnitude, depth] = event;
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
      L.circleMarker([lat, lon], { ...quakeStyle, renderer })
        .bindTooltip(`규모 ${Number(magnitude).toFixed(1)} · 깊이 ${Math.round(depth || 0)} km`, { sticky: true })
        .addTo(this.layers.earthquakes);
    });

    volcanoItems.forEach((volcano) => {
      if (!Number.isFinite(volcano.lat) || !Number.isFinite(volcano.lon)) return;
      L.marker([volcano.lat, volcano.lon], {
        icon: L.divIcon({ className: 'volcano-marker', iconSize: [10, 9], iconAnchor: [5, 5] }),
        keyboard: false
      }).bindTooltip(`${volcano.name || '화산'}${volcano.country ? ` · ${volcano.country}` : ''}`, { className: 'volcano-tip', sticky: true })
        .addTo(this.layers.volcanoes);
    });

    if (boundaries?.features?.length) {
      L.geoJSON(boundaries, {
        style: { color: '#ff5d35', weight: 2.5, opacity: .92, dashArray: '7 6' },
        interactive: false
      }).addTo(this.layers.boundaries);
    }

    koreaEvents.forEach((event) => {
      const [lon, lat, magnitude, depth] = event;
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
      L.circleMarker([lat, lon], { ...koreaStyle, renderer })
        .bindTooltip(`한반도 상세 · 규모 ${Number(magnitude).toFixed(1)}${depth != null ? ` · 깊이 ${Math.round(depth)} km` : ''}`, { sticky: true })
        .addTo(this.layers.korea);
    });

    this.setLayer('earthquakes', this.showBaseData);
    return {
      earthquakes: quakeEvents.length,
      volcanoes: volcanoItems.length,
      boundaries: boundaries?.features?.length || 0,
      korea: koreaEvents.length,
      meta: { earthquakes: earthquakes.meta, volcanoes: volcanoes.meta, korea: korea.meta }
    };
  }

  setupDrawing() {
    this.drawControl = new L.Control.Draw({
      position: 'topleft',
      draw: {
        polyline: {
          shapeOptions: { color: '#071a2b', weight: 4, opacity: .9 },
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
      this.drawnItems.addLayer(layer);
      this.dispatchChange();
    });
    this.map.on(L.Draw.Event.EDITED, () => this.dispatchChange());
    this.map.on(L.Draw.Event.DELETED, () => this.dispatchChange());
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

  getLines() {
    const lines = [];
    this.drawnItems.eachLayer((layer) => {
      const latlngs = layer.getLatLngs();
      const flattened = Array.isArray(latlngs[0]) ? latlngs.flat(Infinity).filter((item) => item?.lat != null) : latlngs;
      if (flattened.length > 1) lines.push(flattened.map(({ lat, lng }) => [Number(lng.toFixed(5)), Number(lat.toFixed(5))]));
    });
    return lines;
  }

  setLines(lines = []) {
    this.drawnItems.clearLayers();
    lines.forEach((coordinates) => {
      const latlngs = coordinates.map(([lon, lat]) => [lat, lon]);
      if (latlngs.length > 1) L.polyline(latlngs, { color: '#071a2b', weight: 4, opacity: .9 }).addTo(this.drawnItems);
    });
  }

  showSubmissions(groups, visibility = {}) {
    const colors = ['#ff5d35', '#2a7fff', '#13a17d', '#b640da', '#e9a51b', '#e93873'];
    this.layers.submissions.clearLayers();
    groups.forEach((group) => {
      if (visibility[group.group] === false) return;
      const version = group.v2 || group.v1;
      (version?.lines || []).forEach((coordinates) => {
        L.polyline(coordinates.map(([lon, lat]) => [lat, lon]), {
          color: colors[(group.group - 1) % colors.length],
          weight: 4,
          opacity: .72,
          lineCap: 'round'
        }).bindTooltip(`${group.group}모둠`, { sticky: true }).addTo(this.layers.submissions);
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
