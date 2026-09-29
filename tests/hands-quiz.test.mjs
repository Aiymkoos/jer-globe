// Тесты жестов для глобуса и викторины: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { GlobeHands, assignHands, T, joySpeed } from '../js/hands.js';
import { POSE } from '../js/gestures.js';
import { Quiz, bearing, direction, distanceKm } from '../js/quiz.js';

const h = (pose, x, y, extra = {}) => ({ present: true, pose, palm: { x, y }, tip: { x, y: y - 0.1 }, ...extra });
const none = { present: false };

function run(e, frames, ctx) {
  const actions = [];
  let last;
  frames.forEach((hands, i) => { last = e.update(hands, i * 33, ctx); actions.push(...last.actions); });
  return { actions, last };
}
const seq = (n, f) => Array.from({ length: n }, (_, i) => f(i));

test('кулак крутит глобус, разжал — инерция', () => {
  const e = new GlobeHands('drag');
  const r = run(e, [...seq(10, i => ({ Right: h(POSE.FIST, 0.5 + i * 0.01, 0.5), Left: none })), ...seq(2, () => ({ Right: h(POSE.PALM, 0.6, 0.5), Left: none }))]);
  const rot = r.actions.filter(a => a.type === 'rotate');
  assert.ok(rot.length >= 8, String(rot.length));
  assert.ok(rot.every(a => a.dx > 0 && Math.abs(a.dy) < 1e-9));
  const rel = r.actions.find(a => a.type === 'release');
  assert.ok(rel && rel.vx > 0.2, JSON.stringify(rel));
});

test('слишком резкое вращение ограничивается и объясняется', () => {
  const e = new GlobeHands('drag');
  const r = run(e, seq(5, i => ({ Right: h(POSE.FIST, 0.2 + i * 0.15, 0.5), Left: none })));
  const rot = r.actions.filter(a => a.type === 'rotate');
  assert.ok(rot.every(a => a.dx / 0.033 <= T.FAST + 1e-6));
  assert.match(r.last.hint, /плавнее/);
  assert.equal(r.last.kind, 'error');
});

test('кулак у края кадра — подсказка перехватить', () => {
  const e = new GlobeHands('drag');
  const r = run(e, seq(3, () => ({ Right: h(POSE.FIST, 0.98, 0.5), Left: none })));
  assert.match(r.last.hint, /края/);
});

test('свёл и развёл большой с указательным — ближе, свёл — дальше', () => {
  const e = new GlobeHands('drag');
  // пальцы сведены (щипок), затем раствор растёт — поза уже «указатель»
  let r = run(e, [
    ...seq(3, () => ({ Left: h(POSE.PINCH, 0.3, 0.5, { pinch: 0.22 }), Right: none })),
    ...seq(10, i => ({ Left: h(POSE.POINT, 0.3, 0.5, { pinch: 0.3 + i * 0.1 }), Right: none })),
  ]);
  const zin = r.actions.filter(a => a.type === 'zoom').reduce((s, a) => s + a.dz, 0);
  assert.ok(zin > 1.5, String(zin));
  r = run(e, seq(10, i => ({ Left: h(POSE.POINT, 0.3, 0.5, { pinch: 1.2 - i * 0.09 }), Right: none })));
  assert.ok(r.actions.filter(a => a.type === 'zoom').reduce((s, a) => s + a.dz, 0) < -1);
});

test('раскрыл ладонь — масштаб «отпущен», можно начать заново без отдаления', () => {
  const e = new GlobeHands('drag');
  run(e, [...seq(3, () => ({ Left: h(POSE.PINCH, 0.3, 0.5, { pinch: 0.2 }), Right: none })), ...seq(5, i => ({ Left: h(POSE.POINT, 0.3, 0.5, { pinch: 0.4 + i * 0.15 }), Right: none }))]);
  const r = run(e, [...seq(3, () => ({ Left: h(POSE.PALM, 0.3, 0.5, { pinch: 1.3 }), Right: none })), ...seq(3, () => ({ Left: h(POSE.PINCH, 0.3, 0.5, { pinch: 0.2 }), Right: none }))]);
  assert.equal(r.actions.filter(a => a.type === 'zoom').length, 0);
});

test('пальцы сведены и дрожат — масштаб не прыгает', () => {
  const e = new GlobeHands('drag');
  const r = run(e, seq(20, i => ({ Left: h(POSE.PINCH, 0.3, 0.5, { pinch: 0.22 + (i % 2) * 0.012 }), Right: none })));
  assert.equal(r.actions.filter(a => a.type === 'zoom').length, 0);
});

test('одна рука крутит, другая пальцами меняет масштаб — одновременно', () => {
  const e = new GlobeHands('drag');
  const r = run(e, [
    ...seq(3, i => ({ Right: h(POSE.FIST, 0.6 + i * 0.01, 0.5), Left: h(POSE.PINCH, 0.3, 0.5, { pinch: 0.2 }) })),
    ...seq(6, i => ({ Right: h(POSE.FIST, 0.63 + i * 0.01, 0.5), Left: h(POSE.POINT, 0.3, 0.5, { pinch: 0.3 + i * 0.12 }) })),
  ]);
  assert.ok(r.actions.some(a => a.type === 'rotate'));
  assert.ok(r.actions.some(a => a.type === 'zoom' && a.dz > 0));
});

test('захват «липкий»: неясная поза на миг не роняет глобус, раскрытая ладонь отпускает', () => {
  const e = new GlobeHands('drag');
  const frames = [
    ...seq(4, i => ({ Right: h(POSE.FIST, 0.5 + i * 0.01, 0.5), Left: none })),
    ...seq(2, i => ({ Right: h(POSE.OTHER, 0.54 + i * 0.01, 0.5), Left: none })),
    ...seq(3, i => ({ Right: h(POSE.FIST, 0.56 + i * 0.01, 0.5), Left: none })),
  ];
  let r = run(e, frames);
  assert.ok(!r.actions.some(a => a.type === 'release'));
  assert.ok(r.actions.filter(a => a.type === 'rotate').length >= 7);
  r = run(e, seq(3, () => ({ Right: h(POSE.PALM, 0.6, 0.5), Left: none })));
  assert.ok(r.actions.some(a => a.type === 'release'));
});

test('дрожание неподвижного кулака не крутит глобус', () => {
  const e = new GlobeHands('drag');
  const r = run(e, seq(20, i => ({ Right: h(POSE.FIST, 0.5 + (i % 2) * 0.002, 0.5), Left: none })));
  assert.equal(r.actions.filter(a => a.type === 'rotate').length, 0);
});

test('два кулака: развести — приблизить', () => {
  const e = new GlobeHands('drag');
  const r = run(e, seq(6, i => ({ Left: h(POSE.FIST, 0.4 - i * 0.03, 0.5), Right: h(POSE.FIST, 0.6 + i * 0.03, 0.5) })));
  const dz = r.actions.filter(a => a.type === 'zoom').reduce((s, a) => s + a.dz, 0);
  assert.ok(dz > 1, String(dz));
  assert.ok(!r.actions.some(a => a.type === 'rotate'));
});

test('два кулака слишком близко — подсказка развести шире', () => {
  const e = new GlobeHands('drag');
  const r = run(e, seq(3, () => ({ Left: h(POSE.FIST, 0.47, 0.5), Right: h(POSE.FIST, 0.53, 0.5) })));
  assert.match(r.last.hint, /шире/);
});

test('взмах ладонью меняет режим, по диагонали — нет, с подсказкой', () => {
  const e = new GlobeHands('drag');
  let r = run(e, seq(8, i => ({ Right: h(POSE.PALM, 0.4 + i * 0.03, 0.5), Left: none })));
  assert.deepEqual(r.actions.filter(a => a.type === 'swipe'), [{ type: 'swipe', dir: 1 }]);
  const e2 = new GlobeHands('drag');
  const hints = [];
  const acts = [];
  seq(8, i => ({ Right: h(POSE.PALM, 0.4 + i * 0.03, 0.4 + i * 0.03), Left: none })).forEach((f, i) => { const o = e2.update(f, i * 33); hints.push(o.hint); acts.push(...o.actions); });
  assert.equal(acts.filter(a => a.type === 'swipe').length, 0);
  assert.ok(hints.some(x => /горизонтально/.test(x)));
});

test('в режиме с морем ладонь вверх поднимает уровень', () => {
  const e = new GlobeHands('drag');
  const r = run(e, seq(8, i => ({ Right: h(POSE.PALM, 0.5, 0.7 - i * 0.03), Left: none })), { levelMode: true });
  const dv = r.actions.filter(a => a.type === 'level').reduce((s, a) => s + a.dv, 0);
  assert.ok(dv > 40, String(dv));
  assert.equal(r.actions.filter(a => a.type === 'swipe').length, 0);
});

test('указательный палец — указатель для каждой руки', () => {
  const e = new GlobeHands('drag');
  const o = e.update({ Left: h(POSE.POINT, 0.3, 0.5), Right: h(POSE.POINT, 0.7, 0.5) }, 0);
  assert.equal(o.pointers.length, 2);
});

test('неплотный кулак — подсказка сжать плотнее', () => {
  const e = new GlobeHands('drag');
  const r = run(e, seq(15, () => ({ Right: h(POSE.OTHER, 0.5, 0.5, { near: POSE.FIST, hint: 'Сожми кулак плотнее — согни мизинец' }), Left: none })));
  assert.match(r.last.hint, /Сожми кулак плотнее/);
});

test('руки различаются по месту и сохраняют «слот» при пересечении середины', () => {
  const last = {};
  assert.deepEqual(assignHands([{ x: 0.2, y: 0.5 }, { x: 0.8, y: 0.5 }], last, 0), ['Left', 'Right']);
  // правая рука плавно заходит на левую половину
  assignHands([{ x: 0.2, y: 0.5 }, { x: 0.6, y: 0.5 }], last, 33);
  assignHands([{ x: 0.2, y: 0.5 }, { x: 0.45, y: 0.5 }], last, 66);
  // левая пропала — оставшаяся рука у середины всё ещё правая
  assert.deepEqual(assignHands([{ x: 0.44, y: 0.5 }], last, 100), ['Right']);
  assert.deepEqual(assignHands([{ x: 0.42, y: 0.5 }], last, 133), ['Right']);
});

test('направление и расстояние: от Узбекистана до Казахстана — север', () => {
  const uz = { lng: 64, lat: 41.5 }, kz = { lng: 68.7, lat: 49 };
  assert.equal(direction(bearing(uz, kz)).word, 'севернее');
  const km = distanceKm(uz, kz);
  assert.ok(km > 800 && km < 1000, String(km));
  assert.equal(direction(bearing({ lng: 0, lat: 0 }, { lng: 20, lat: 0 })).word, 'восточнее');
});

test('викторина: ошибка — подсказка, три ошибки — показ, верно — очки', () => {
  const countries = { features: [
    { id: 1, properties: { name: 'Казахстан', capital: 'Астана', pop: 19e6, lx: 68.7, ly: 49 } },
    { id: 2, properties: { name: 'Узбекистан', capital: 'Ташкент', pop: 35e6, lx: 64, ly: 41.5 } },
  ] };
  const q = new Quiz(countries, { rounds: 2, rand: () => 0 });
  assert.equal(q.target.name, 'Казахстан');
  let r = q.answer({ id: 2, name: 'Узбекистан', lx: 64, ly: 41.5 });
  assert.equal(r.type, 'wrong');
  assert.match(r.hint, /Это Узбекистан\. Нужная страна севернее/);
  assert.match(r.hint, /потяни глобус кулаком вниз/);
  assert.equal(q.answer(null).type, 'miss');
  r = q.answer({ id: 1, name: 'Казахстан', lx: 68.7, ly: 49 });
  assert.equal(r.type, 'correct');
  assert.equal(q.score, 60);
  q.next();
  q.answer({ id: 1, name: 'Казахстан', lx: 68.7, ly: 49 });
  q.answer({ id: 1, name: 'Казахстан', lx: 68.7, ly: 49 });
  assert.equal(q.answer({ id: 1, name: 'Казахстан', lx: 68.7, ly: 49 }).type, 'reveal');
});

test('МКС: страна под точкой по границам стран', async () => {
  const { countryAtLngLat } = await import('../js/live.js');
  const { readFileSync } = await import('node:fs');
  const countries = JSON.parse(readFileSync(new URL('../data/countries.json', import.meta.url), 'utf-8'));
  assert.equal(countryAtLngLat(countries, 73.1, 49.8)?.name, 'Казахстан'); // Караганда
  assert.equal(countryAtLngLat(countries, 37.6, 55.75)?.name, 'Россия');   // Москва
  assert.equal(countryAtLngLat(countries, -40, 30), null);                // Атлантика
});

test('джойстик: сдвинул кулак — глобус едет туда, вернул в центр — стоп', () => {
  const e = new GlobeHands();
  // сжал кулак в центре, затем плавно сдвинул вправо и держит
  let r = run(e, [...seq(3, () => ({ Right: h(POSE.FIST, 0.5, 0.5), Left: none })), ...seq(30, i => ({ Right: h(POSE.FIST, 0.5 + Math.min(i, 10) * 0.012, 0.5), Left: none }))]);
  const spins = r.actions.filter(a => a.type === 'spin');
  assert.ok(spins.length >= 15, String(spins.length));
  assert.ok(spins.every(a => a.vx > 0 && Math.abs(a.vy) < 1e-9));
  assert.ok(r.last.joy && Math.abs(r.last.joy.ax - 0.5) < 1e-9);
  // вернул кулак на место — вращение прекращается
  r = run(e, seq(20, () => ({ Right: h(POSE.FIST, 0.5, 0.5), Left: none })));
  assert.equal(r.last.actions.filter(a => a.type === 'spin').length, 0);
  assert.equal(r.last.joy.k, 0);
  assert.match(r.last.hint, /Сдвинь кулак/);
});

test('джойстик: дрожание кулака у центра не крутит, скорость растёт плавно и ограничена', () => {
  const e = new GlobeHands();
  const r = run(e, seq(20, i => ({ Right: h(POSE.FIST, 0.5 + (i % 2) * 0.01, 0.5 + (i % 3) * 0.008), Left: none })));
  assert.equal(r.actions.filter(a => a.type === 'spin').length, 0);
  const a = joySpeed({ x: 0.06, y: 0 }).vx, b = joySpeed({ x: 0.12, y: 0 }).vx, c = joySpeed({ x: 0.5, y: 0 }).vx;
  assert.ok(a > 0 && b > a * 2 && Math.abs(c - T.JOY_MAX) < 1e-9, `${a} ${b} ${c}`);
});

test('джойстик: раскрыл ладонь — глобус мягко останавливается, кулак далеко — подсказка', () => {
  const e = new GlobeHands();
  let r = run(e, [...seq(2, () => ({ Right: h(POSE.FIST, 0.4, 0.5), Left: none })), ...seq(8, i => ({ Right: h(POSE.FIST, 0.4 - i * 0.05, 0.5), Left: none }))]);
  assert.match(r.last.hint, /слишком далеко/);
  assert.equal(r.last.kind, 'error');
  r = run(e, seq(3, () => ({ Right: h(POSE.PALM, 0.05, 0.5), Left: none })));
  const rel = r.actions.find(a => a.type === 'release');
  assert.ok(rel && rel.vx < 0, JSON.stringify(rel));
});
