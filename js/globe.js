import { floodRamp, iceRamp } from './terrain.js';
export { floodRamp, iceRamp } from './terrain.js';
// 3D-глобус на MapLibre: спутник, Земля без воды, потоп, ледниковый период,
// ночные огни, землетрясения и МКС. Все источники бесплатные и без ключей.

import * as maplibregl from '../vendor/maplibre/maplibre-gl.mjs';

export const MODES = [
  { id: 'satellite', name: 'Спутник', desc: 'Настоящая Земля — приближай до улиц своего города' },
  { id: 'drained', name: 'Без воды', desc: 'Океаны осушены: подводные хребты, желоба, Марианская впадина' },
  { id: 'flood', name: 'Растаяли льды', desc: 'Если растают все ледники, море поднимется на ~70 м. Ладонь вверх-вниз — уровень моря', level: 70 },
  { id: 'iceage', name: 'Ледниковый период', desc: '20 тысяч лет назад море было на ~120 м ниже: песочным — суша, которой сейчас нет', level: -120 },
  { id: 'night', name: 'Ночная Земля', desc: 'Огни городов из космоса — снимки NASA' },
  { id: 'live', name: 'Живая Земля', desc: 'Землетрясения за последние сутки и МКС прямо сейчас' },
  { id: 'quiz', name: 'Викторина', desc: 'Найди страну на глобусе и покажи её пальцем' },
];

export const LEVEL_RANGE = [-130, 100];

const ATTR_ESRI = 'Снимки © Esri, Maxar, Earthstar Geographics';
const ATTR_NASA = 'Ночные огни © NASA Black Marble';
const ATTR_DEM = 'Рельеф: Mapzen Terrain Tiles (AWS Open Data)';
const ATTR_OSM = '© OpenStreetMap, OpenFreeMap';
const ATTR_NE = 'Страны: Natural Earth';

const name = ['coalesce', ['get', 'name:ru'], ['get', 'name']];

// Цвет по высоте для «Земли без воды»: дно — синие оттенки, суша — природные.
const DRAINED_RAMP = [
  'interpolate', ['linear'], ['elevation'],
  -11000, '#1c0f0b', -8000, '#33201a', -6000, '#4d3326', -4500, '#6b4c36', -3000, '#8a6a4c', -1500, '#a88a68',
  -200, '#c4aa86', 0, '#d2c595', 400, '#9fbb70', 1200, '#c3ae74', 2500, '#a47c58', 4500, '#d8d0c8', 7000, '#ffffff',
];

// «Потоп»: всё, что ниже уровня моря L, заливается водой.

function style(countries) {
  return {
    version: 8,
    projection: { type: 'globe' },
    glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
    sky: { 'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 5, 1, 7, 0] },
    sources: {
      sat: { type: 'raster', tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'], tileSize: 256, maxzoom: 19, attribution: ATTR_ESRI },
      night: { type: 'raster', tiles: ['https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_Black_Marble/default/2016-01-01/GoogleMapsCompatible_Level8/{z}/{y}/{x}.png'], tileSize: 256, maxzoom: 8, attribution: ATTR_NASA },
      dem: { type: 'raster-dem', tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'], tileSize: 256, maxzoom: 12, encoding: 'terrarium', attribution: ATTR_DEM },
      ofm: { type: 'vector', url: 'https://tiles.openfreemap.org/planet', attribution: ATTR_OSM },
      countries: { type: 'geojson', data: countries, attribution: ATTR_NE },
      quakes: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
      iss: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
    },
    layers: [
      { id: 'space', type: 'background', paint: { 'background-color': '#0c2744' } },
      { id: 'sat', type: 'raster', source: 'sat' },
      { id: 'night', type: 'raster', source: 'night', layout: { visibility: 'none' } },
      { id: 'relief', type: 'color-relief', source: 'dem', layout: { visibility: 'none' }, paint: { 'color-relief-color': DRAINED_RAMP, 'color-relief-opacity': 1 } },
      { id: 'hillshade', type: 'hillshade', source: 'dem', layout: { visibility: 'none' }, paint: { 'hillshade-exaggeration': 0.55, 'hillshade-shadow-color': '#0b1220', 'hillshade-highlight-color': '#ffffff' } },
      {
        id: 'political', type: 'fill', source: 'countries', layout: { visibility: 'none' },
        paint: {
          'fill-color': ['match', ['%', ['to-number', ['id']], 6], 0, '#e9c46a', 1, '#8ab17d', 2, '#e76f51', 3, '#6d9dc5', 4, '#f4a261', '#b392ac'],
          'fill-opacity': 0.72,
        },
      },
      { id: 'country-hit', type: 'fill', source: 'countries', paint: { 'fill-color': '#ffffff', 'fill-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 0.18, 0.001] } },
      { id: 'country-wrong', type: 'fill', source: 'countries', paint: { 'fill-color': '#ef5b5b', 'fill-opacity': ['case', ['boolean', ['feature-state', 'wrong'], false], 0.7, 0] } },
      { id: 'country-right', type: 'fill', source: 'countries', paint: { 'fill-color': '#5bd18a', 'fill-opacity': ['case', ['boolean', ['feature-state', 'right'], false], 0.75, 0] } },
      { id: 'borders', type: 'line', source: 'countries', paint: { 'line-color': ['case', ['boolean', ['feature-state', 'hover'], false], '#ffd166', 'rgba(255,255,255,0.45)'], 'line-width': ['case', ['boolean', ['feature-state', 'hover'], false], 2.5, 0.7] } },
      {
        id: 'labels-country', type: 'symbol', source: 'ofm', 'source-layer': 'place', filter: ['==', ['get', 'class'], 'country'], maxzoom: 7,
        layout: { 'text-field': name, 'text-font': ['Noto Sans Bold'], 'text-size': ['interpolate', ['linear'], ['zoom'], 1, 10, 5, 15], 'text-max-width': 8 },
        paint: { 'text-color': '#ffffff', 'text-halo-color': 'rgba(0,0,0,0.75)', 'text-halo-width': 1.4 },
      },
      {
        id: 'labels-city', type: 'symbol', source: 'ofm', 'source-layer': 'place', minzoom: 4,
        filter: ['in', ['get', 'class'], ['literal', ['city', 'town']]],
        layout: { 'text-field': name, 'text-font': ['Noto Sans Regular'], 'text-size': ['interpolate', ['linear'], ['zoom'], 4, 11, 10, 15], 'symbol-sort-key': ['get', 'rank'] },
        paint: { 'text-color': '#fff7e0', 'text-halo-color': 'rgba(0,0,0,0.8)', 'text-halo-width': 1.3 },
      },
      {
        id: 'quakes', type: 'circle', source: 'quakes', layout: { visibility: 'none' },
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['get', 'mag'], 2.5, 3, 5, 9, 7, 20],
          'circle-color': ['interpolate', ['linear'], ['get', 'depth'], 0, '#ff5a3c', 70, '#ffb03a', 300, '#6fd0ff'],
          'circle-opacity': 0.85, 'circle-stroke-color': '#fff', 'circle-stroke-width': 0.8,
        },
      },
      { id: 'iss-glow', type: 'circle', source: 'iss', paint: { 'circle-radius': 14, 'circle-color': '#8fe3ff', 'circle-opacity': 0.25, 'circle-blur': 0.6 } },
      { id: 'iss', type: 'circle', source: 'iss', paint: { 'circle-radius': 5, 'circle-color': '#ffffff', 'circle-stroke-color': '#8fe3ff', 'circle-stroke-width': 2 } },
      {
        id: 'iss-label', type: 'symbol', source: 'iss',
        layout: { 'text-field': 'МКС', 'text-font': ['Noto Sans Bold'], 'text-size': 13, 'text-offset': [0, 1.4], 'text-anchor': 'top' },
        paint: { 'text-color': '#8fe3ff', 'text-halo-color': '#000', 'text-halo-width': 1.2 },
      },
    ],
  };
}

// Видимость слоёв и раскраска рельефа для режима — прямо в стиле, чтобы
// глобус сразу появлялся в нужном виде.
function styleFor(countries, id, level) {
  const st = style(countries);
  const on = visibleLayers(id);
  for (const l of st.layers) if (l.id in on) (l.layout ??= {}).visibility = on[l.id] ? 'visible' : 'none';
  const relief = st.layers.find(l => l.id === 'relief');
  relief.paint['color-relief-color'] = reliefRamp(id, level);
  st.layers.find(l => l.id === 'sat').paint = { 'raster-brightness-max': id === 'live' ? 0.6 : id === 'quiz' ? 0.45 : 1 };
  return st;
}

export async function createGlobe(container, { mode = 'satellite', level, center = [68.7, 48], zoom = 1.7 } = {}) {
  const response = await fetch(new URL('../data/countries.json', import.meta.url), { signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`Country data: ${response.status}`);
  const countries = await response.json();
  const map = new maplibregl.Map({
    container,
    style: styleFor(countries, mode, level ?? MODES.find(m => m.id === mode)?.level),
    center,
    zoom,
    maxZoom: 17,
    attributionControl: { compact: true },
    renderWorldCopies: false,
  });
  globalThis.__globeMap = map; // для автопроверки: перерисовка во вкладке без анимации
  // ошибки стиля и загрузки видны сразу, а не теряются до события load
  map.on('error', e => (globalThis.__globeErrors ??= []).push(String(e.error?.message ?? e.message ?? e)));
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { map.remove(); reject(new Error('Globe loading timeout')); }, 30000);
    map.once('load', () => { clearTimeout(timer); resolve(); });
  });
  return { map, countries, maplibregl };
}

// Какие слои видны в каждом режиме.
function visibleLayers(id) {
  return {
    sat: ['satellite', 'flood', 'iceage', 'live', 'quiz'].includes(id),
    night: id === 'night',
    relief: ['drained', 'flood', 'iceage'].includes(id),
    hillshade: id === 'drained',
    political: id === 'quiz',
    quakes: id === 'live',
    'labels-country': id !== 'quiz',
    'labels-city': id !== 'quiz',
  };
}

function reliefRamp(id, level) {
  if (id === 'flood') return floodRamp(level ?? 70);
  if (id === 'iceage') return iceRamp(level ?? -120);
  return DRAINED_RAMP;
}

/** Включает режим: какие слои видны и чем раскрашен рельеф. */
export function applyMode(map, id, level) {
  for (const [layer, on] of Object.entries(visibleLayers(id))) map.setLayoutProperty(layer, 'visibility', on ? 'visible' : 'none');
  map.setPaintProperty('relief', 'color-relief-color', reliefRamp(id, level));
  map.setPaintProperty('sat', 'raster-brightness-max', id === 'live' ? 0.6 : id === 'quiz' ? 0.45 : 1);
}

export function setLevel(map, id, level) {
  if (id === 'flood') map.setPaintProperty('relief', 'color-relief-color', floodRamp(level));
  if (id === 'iceage') map.setPaintProperty('relief', 'color-relief-color', iceRamp(level));
}

/** Страна под точкой экрана (или null — океан или космос). */
export function countryAt(map, px) {
  const f = map.queryRenderedFeatures(px, { layers: ['country-hit'] })[0];
  return f ? { id: f.id, ...f.properties } : null;
}

/** Попадает ли точка экрана на глобус (а не в космос). */
export function onGlobe(map, px) {
  try {
    const ll = map.unproject(px);
    const back = map.project(ll);
    return Math.hypot(back.x - px[0], back.y - px[1]) < 3;
  } catch {
    return false;
  }
}

export function setFlag(map, id, key, on) {
  if (id == null) return;
  map.setFeatureState({ source: 'countries', id }, { [key]: on });
}
