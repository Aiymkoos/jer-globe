// Живые данные: МКС прямо сейчас и землетрясения за сутки. Открытые API без ключей.

const QUAKES = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson';
const ISS = 'https://api.wheretheiss.at/v1/satellites/25544';

export async function fetchQuakes() {
  const res = await fetch(QUAKES);
  if (!res.ok) throw new Error(`USGS: ${res.status}`);
  const data = await res.json();
  return {
    type: 'FeatureCollection',
    features: data.features.map(f => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: f.geometry.coordinates.slice(0, 2) },
      properties: { mag: f.properties.mag ?? 0, place: f.properties.place ?? '', time: f.properties.time, depth: f.geometry.coordinates[2] ?? 0 },
    })),
  };
}

export async function fetchIss() {
  const res = await fetch(ISS);
  if (!res.ok) throw new Error(`ISS: ${res.status}`);
  const d = await res.json();
  return { lat: d.latitude, lng: d.longitude, alt: d.altitude, speed: d.velocity };
}

// Точка внутри многоугольника (лучевой метод), координаты [lng, lat].
function inRing(ring, x, y) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function inPolygon(poly, x, y) {
  return inRing(poly[0], x, y) && !poly.slice(1).some(hole => inRing(hole, x, y));
}

/** Над какой страной точка (или null — над океаном). */
export function countryAtLngLat(countries, lng, lat) {
  for (const f of countries.features) {
    const g = f.geometry;
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
    if (polys.some(p => inPolygon(p, lng, lat))) return { id: f.id, ...f.properties };
  }
  return null;
}

export function timeAgo(ms) {
  const min = Math.round((Date.now() - ms) / 60000);
  if (min < 60) return `${min} мин назад`;
  const h = Math.round(min / 60);
  return `${h} ч назад`;
}
