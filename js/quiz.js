// Викторина «Найди страну»: подсказка направления и расстояния при ошибке.

const R = 6371;
const rad = d => (d * Math.PI) / 180;

export function distanceKm(a, b) {
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Начальный курс от a к b, градусы (0 — север, 90 — восток).
export function bearing(a, b) {
  const y = Math.sin(rad(b.lng - a.lng)) * Math.cos(rad(b.lat));
  const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lng - a.lng));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

const DIRS = [
  { word: 'севернее', drag: 'потяни глобус кулаком вниз' },
  { word: 'северо-восточнее', drag: 'потяни глобус влево-вниз' },
  { word: 'восточнее', drag: 'потяни глобус влево' },
  { word: 'юго-восточнее', drag: 'потяни глобус влево-вверх' },
  { word: 'южнее', drag: 'потяни глобус вверх' },
  { word: 'юго-западнее', drag: 'потяни глобус вправо-вверх' },
  { word: 'западнее', drag: 'потяни глобус вправо' },
  { word: 'северо-западнее', drag: 'потяни глобус вправо-вниз' },
];

export function direction(deg) {
  return DIRS[Math.round(deg / 45) % 8];
}

const center = p => ({ lng: p.lx, lat: p.ly });
const roundKm = km => (km < 1000 ? Math.round(km / 50) * 50 : Math.round(km / 100) * 100);

export class Quiz {
  constructor(countries, { rounds = 8, rand = Math.random } = {}) {
    // Крупные страны: маленькие на глобусе трудно показать пальцем.
    this.pool = countries.features.map(f => ({ id: f.id, ...f.properties })).filter(c => c.pop >= 3e6 && c.capital);
    this.rounds = rounds;
    this.rand = rand;
    this.reset();
  }

  reset() {
    const pool = [...this.pool];
    this.questions = [];
    while (this.questions.length < this.rounds && pool.length) this.questions.push(pool.splice(Math.floor(this.rand() * pool.length), 1)[0]);
    this.index = 0;
    this.tries = 0;
    this.score = 0;
    this.streak = 0;
    this.results = [];
    this.done = false;
  }

  get target() {
    return this.questions[this.index];
  }

  /** answer — страна под пальцем (или null — океан/космос). */
  answer(country) {
    const t = this.target;
    if (!t || this.done) return { type: 'done' };
    if (!country) return { type: 'miss', hint: 'Это океан — наведи палец на сушу и подержи' };
    if (country.id === t.id) {
      const points = [100, 60, 30][this.tries] ?? 10;
      this.streak++;
      const bonus = this.streak >= 3 ? 20 : 0;
      this.score += points + bonus;
      this.results.push({ name: t.name, tries: this.tries + 1, ok: true });
      return { type: 'correct', points: points + bonus, hint: `Верно! ${t.name}, столица — ${t.capital}` };
    }
    this.tries++;
    this.streak = 0;
    const from = center(country), to = center(t);
    const km = roundKm(distanceKm(from, to));
    const dir = direction(bearing(from, to));
    if (this.tries >= 3) {
      this.results.push({ name: t.name, tries: this.tries, ok: false });
      return { type: 'reveal', wrong: country.id, hint: `Это ${country.name}. Показываю, где ${t.name}` };
    }
    return { type: 'wrong', wrong: country.id, hint: `Это ${country.name}. Нужная страна ${dir.word}, примерно ${km} км — ${dir.drag}` };
  }

  next() {
    this.index++;
    this.tries = 0;
    if (this.index >= this.questions.length) this.done = true;
    return !this.done;
  }
}
