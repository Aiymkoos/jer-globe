// Тесты жестов для глобуса и викторины: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { GlobeHands, assignHands, T } from '../js/hands.js';
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
  const e = new GlobeHands();
  const r = run(e, [...seq(10, i => ({ Right: h(POSE.FIST, 0.5 + i * 0.01, 0.5), Left: none })), { Right: h(POSE.PALM, 0.6, 0.5), Left: none }]);
  const rot = r.actions.filter(a => a.type === 'rotate');
  assert.equal(rot.length, 9);
  assert.ok(rot.every(a => a.dx > 0 && Math.abs(a.dy) < 1e-9));
  const rel = r.actions.find(a => a.type === 'release');
  assert.ok(rel && rel.vx > 0.2, JSON.stringify(rel));
});

test('слишком резкое вращение ограничивается и объясняется', () => {
  const e = new GlobeHands();
  const r = run(e, seq(5, i => ({ Right: h(POSE.FIST, 0.2 + i * 0.15, 0.5), Left: none })));
  const rot = r.actions.filter(a => a.type === 'rotate');
  assert.ok(rot.every(a => a.dx / 0.033 <= T.FAST + 1e-6));
  assert.match(r.last.hint, /плавнее/);
  assert.equal(r.last.kind, 'error');
});

test('кулак у края кадра — подсказка перехватить', () => {
  const e = new GlobeHands();
  const r = run(e, seq(3, () => ({ Right: h(POSE.FIST, 0.98, 0.5), Left: none })));
  assert.match(r.last.hint, /края/);
});

test('щипок вверх приближает, вниз отдаляет', () => {
  const e = new GlobeHands();
  let r = run(e, seq(6, i => ({ Left: h(POSE.PINCH, 0.3, 0.6 - i * 0.02), Right: none })));
  const up = r.actions.filter(a => a.type === 'zoom').reduce((s, a) => s + a.dz, 0);
  assert.ok(up > 0.4, String(up));
  const e2 = new GlobeHands();
  r = run(e2, seq(6, i => ({ Left: h(POSE.PINCH, 0.3, 0.4 + i * 0.02), Right: none })));
  assert.ok(r.actions.filter(a => a.type === 'zoom').reduce((s, a) => s + a.dz, 0) < -0.4);
});

test('одна рука крутит, другая щипком меняет масштаб — одновременно', () => {
  const e = new GlobeHands();
  const r = run(e, seq(6, i => ({ Right: h(POSE.FIST, 0.6 + i * 0.01, 0.5), Left: h(POSE.PINCH, 0.3, 0.6 - i * 0.02) })));
  assert.ok(r.actions.some(a => a.type === 'rotate'));
  assert.ok(r.actions.some(a => a.type === 'zoom' && a.dz > 0));
});

test('два кулака: развести — приблизить', () => {
  const e = new GlobeHands();
  const r = run(e, seq(6, i => ({ Left: h(POSE.FIST, 0.4 - i * 0.03, 0.5), Right: h(POSE.FIST, 0.6 + i * 0.03, 0.5) })));
  const dz = r.actions.filter(a => a.type === 'zoom').reduce((s, a) => s + a.dz, 0);
  assert.ok(dz > 1, String(dz));
  assert.ok(!r.actions.some(a => a.type === 'rotate'));
});

test('два кулака слишком близко — подсказка развести шире', () => {
  const e = new GlobeHands();
  const r = run(e, seq(3, () => ({ Left: h(POSE.FIST, 0.47, 0.5), Right: h(POSE.FIST, 0.53, 0.5) })));
  assert.match(r.last.hint, /шире/);
});

test('взмах ладонью меняет режим, по диагонали — нет, с подсказкой', () => {
  const e = new GlobeHands();
  let r = run(e, seq(8, i => ({ Right: h(POSE.PALM, 0.4 + i * 0.03, 0.5), Left: none })));
  assert.deepEqual(r.actions.filter(a => a.type === 'swipe'), [{ type: 'swipe', dir: 1 }]);
  const e2 = new GlobeHands();
  const hints = [];
  const acts = [];
  seq(8, i => ({ Right: h(POSE.PALM, 0.4 + i * 0.03, 0.4 + i * 0.03), Left: none })).forEach((f, i) => { const o = e2.update(f, i * 33); hints.push(o.hint); acts.push(...o.actions); });
  assert.equal(acts.filter(a => a.type === 'swipe').length, 0);
  assert.ok(hints.some(x => /горизонтально/.test(x)));
});

test('в режиме с морем ладонь вверх поднимает уровень', () => {
  const e = new GlobeHands();
  const r = run(e, seq(8, i => ({ Right: h(POSE.PALM, 0.5, 0.7 - i * 0.03), Left: none })), { levelMode: true });
  const dv = r.actions.filter(a => a.type === 'level').reduce((s, a) => s + a.dv, 0);
  assert.ok(dv > 40, String(dv));
  assert.equal(r.actions.filter(a => a.type === 'swipe').length, 0);
});

test('указательный палец — указатель для каждой руки', () => {
  const e = new GlobeHands();
  const o = e.update({ Left: h(POSE.POINT, 0.3, 0.5), Right: h(POSE.POINT, 0.7, 0.5) }, 0);
  assert.equal(o.pointers.length, 2);
});

test('неплотный кулак — подсказка сжать плотнее', () => {
  const e = new GlobeHands();
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
