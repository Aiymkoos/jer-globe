// «Жер»: камера → две руки (MediaPipe в фоновом потоке) → жесты → 3D-глобус.
// Без камеры глобус крутится мышью, режимы переключаются кнопками и цифрами 1–7.

import { createGlobe, applyMode, setLevel, countryAt, onGlobe, setFlag, MODES, LEVEL_RANGE } from './globe.js';
import { GlobeHands, assignHands, T } from './hands.js';
import { classifyHand, POSE, POSE_NAMES } from './gestures.js';
import { Quiz } from './quiz.js';
import { fetchQuakes, fetchIss, countryAtLngLat, timeAgo } from './live.js';
import { OneEuro } from './filters.js';
import { preload } from './loader.js';

const $ = id => document.getElementById(id);
const DEBUG = new URLSearchParams(location.search).has('debug');
const video = $('video');
const hud = $('hud');

const state = {
  mode: 'satellite',
  level: 70,
  camera: false,
  hover: {},        // страна под пальцем каждой руки
  dwell: {},        // наведение: { key: { target, t } }
  inertia: null,
  quiz: null,
  quizLock: 0,
  cardId: null,
  iss: null,
};

let globe = null;
let map = null;
let tracker = null;
let rotStyle = 'joystick';
try { rotStyle = new URLSearchParams(location.search).has('drag') || localStorage.getItem('jer-rot') === 'drag' ? 'drag' : 'joystick'; } catch {}
const engine = new GlobeHands(rotStyle);
function showRotStyle() {
  $('rotStyle').textContent = engine.style === 'joystick' ? '✊ джойстик' : '✊ перетаскивание';
}
$('rotStyle').addEventListener('click', () => {
  engine.style = engine.style === 'joystick' ? 'drag' : 'joystick';
  engine.grab = {}; engine.spin = null; engine.vel = []; spinTarget = null;
  try { localStorage.setItem('jer-rot', engine.style); } catch {}
  showRotStyle();
  hint(engine.style === 'joystick' ? 'Джойстик: сдвинь кулак — глобус едет туда, верни на место — стоп' : 'Перетаскивание: кулаком тащи глобус, раскрой ладонь — отпустить', 'info', 2500);
});
showRotStyle();
const lastPos = {};
const filters = {};
let rawHands = [];
let lastResultAt = -Infinity;
let hintHold = 0;
let view = { pointers: [] };

// ---------- подсказка ----------
function hint(text, kind = 'info', hold = 0) {
  if (!text) return;
  const now = performance.now();
  if (now < hintHold && !hold) return;
  if (hold) hintHold = now + hold;
  const el = $('hint');
  el.textContent = text;
  el.className = `hint ${kind === 'info' ? '' : kind}`;
}

// ---------- режимы ----------
function renderModes() {
  $('modes').replaceChildren(...MODES.map((m, i) => {
    const b = document.createElement('button');
    b.textContent = `${i + 1} · ${m.name}`;
    b.dataset.target = `mode:${m.id}`;
    b.onclick = () => setMode(m.id);
    return b;
  }));
}

function setMode(id) {
  const m = MODES.find(x => x.id === id);
  if (!m || !map) return;
  state.mode = id;
  if (m.level != null) state.level = m.level;
  applyMode(map, id, state.level);
  document.querySelectorAll('#modes button').forEach(b => b.classList.toggle('on', b.dataset.target === `mode:${id}`));
  $('modeInfo').hidden = false;
  $('modeName').textContent = m.name;
  $('modeDesc').textContent = m.desc;
  $('level').hidden = m.level == null;
  $('live').hidden = id !== 'live';
  $('quiz').hidden = id !== 'quiz';
  if (id === 'quiz') startQuiz();
  else { $('card').hidden = true; clearQuizMarks(); }
  if (id === 'live') refreshLive();
  renderLevel();
  hint(`${m.name}: ${m.desc}`, 'ok', 2500);
}

function shiftMode(dir) {
  const i = MODES.findIndex(m => m.id === state.mode);
  setMode(MODES[(i + dir + MODES.length) % MODES.length].id);
}

// ---------- уровень моря ----------
function renderLevel() {
  const [lo, hi] = LEVEL_RANGE;
  const k = (state.level - lo) / (hi - lo);
  $('levelFill').style.height = `${k * 100}%`;
  $('levelMark').style.bottom = `${((0 - lo) / (hi - lo)) * 100}%`;
  $('levelValue').textContent = `${state.level > 0 ? '+' : ''}${Math.round(state.level)} м`;
}

function changeLevel(dv) {
  if (!['flood', 'iceage'].includes(state.mode)) return;
  const [lo, hi] = LEVEL_RANGE;
  const before = state.level;
  state.level = Math.max(lo, Math.min(hi, state.level + dv));
  if (state.level === before && dv) hint(dv > 0 ? 'Выше +100 м уровень не поднимается' : 'Ниже −130 м моря не было даже в ледниковый период', 'error', 1500);
  setLevel(map, state.mode, state.level);
  renderLevel();
}

// ---------- карточка страны ----------
const fmtPop = n => (n >= 1e9 ? `${(n / 1e9).toFixed(2)} млрд` : n >= 1e6 ? `${(n / 1e6).toFixed(1)} млн` : `${Math.round(n / 1e3)} тыс.`).replace('.', ',');

async function showCard(c) {
  if (!c || state.cardId === c.id) return;
  state.cardId = c.id;
  $('card').hidden = false;
  $('cardName').textContent = c.name;
  $('cardCont').textContent = c.cont ?? '';
  $('cardCapital').textContent = c.capital || '—';
  $('cardPop').textContent = c.pop ? fmtPop(c.pop) : '—';
  $('cardFlag').src = c.iso2 ? `https://flagcdn.com/w160/${c.iso2.toLowerCase()}.png` : '';
  $('cardFlag').hidden = !c.iso2;
  $('cardWiki').textContent = '';
  try {
    const res = await fetch(`https://ru.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(c.name)}`);
    const data = res.ok ? await res.json() : null;
    if (state.cardId === c.id && data?.extract) $('cardWiki').textContent = data.extract.split('. ').slice(0, 3).join('. ').replace(/\.?$/, '.');
  } catch { /* без интернета карточка работает и без текста */ }
}

// ---------- викторина ----------
function startQuiz() {
  state.quiz ??= new Quiz(globe.countries);
  state.quiz.reset();
  $('card').hidden = true;
  renderQuiz();
  hint('Найди страну: поверни глобус кулаком, наведи палец и подержи', 'info', 2500);
}

function clearQuizMarks() {
  for (const f of globe?.countries.features ?? []) { setFlag(map, f.id, 'wrong', false); setFlag(map, f.id, 'right', false); }
}

function renderQuiz() {
  const q = state.quiz;
  $('quizScore').textContent = q.score;
  $('quizStreak').textContent = q.streak;
  if (q.done) {
    $('quizRound').textContent = 'Итог';
    $('quizTarget').textContent = `${q.score} очков`;
    const ok = q.results.filter(r => r.ok).length;
    $('quizResult').innerHTML = `<p>Найдено ${ok} из ${q.results.length}.</p><ol>${q.results.map(r => `<li>${r.name} — ${r.ok ? (r.tries === 1 ? 'с первой попытки' : `с ${r.tries}-й попытки`) : 'не найдена'}</li>`).join('')}</ol><button class="primary" data-target="cmd:quiz-again" id="quizAgain">Ещё раунд</button>`;
    $('quizAgain').onclick = startQuiz;
    return;
  }
  $('quizRound').textContent = `Вопрос ${q.index + 1} из ${q.questions.length}`;
  $('quizTarget').textContent = q.target.name;
  $('quizResult').textContent = '';
}

function answerQuiz(c) {
  const q = state.quiz;
  if (!q || q.done || performance.now() < state.quizLock) return;
  const r = q.answer(c);
  clearQuizMarks();
  if (r.type === 'miss') return hint(r.hint, 'error', 2000);
  if (r.type === 'wrong') { setFlag(map, r.wrong, 'wrong', true); hint(r.hint, 'error', 4000); renderQuiz(); return; }
  const target = q.target;
  setFlag(map, target.id, 'right', true);
  if (r.type === 'reveal') setFlag(map, r.wrong, 'wrong', true);
  map.flyTo({ center: [target.lx, target.ly], zoom: Math.max(map.getZoom(), 2.2), duration: 1400 });
  hint(r.type === 'correct' ? `${r.hint} · +${r.points}` : r.hint, r.type === 'correct' ? 'ok' : 'error', 3000);
  state.quizLock = performance.now() + 2600;
  renderQuiz();
  setTimeout(() => { clearQuizMarks(); q.next(); renderQuiz(); }, 2600);
}

// ---------- живые данные ----------
async function refreshLive() {
  try {
    const quakes = await fetchQuakes();
    map.getSource('quakes').setData(quakes);
    const top = [...quakes.features].sort((a, b) => b.properties.mag - a.properties.mag).slice(0, 6);
    $('quakeList').innerHTML = quakes.features.length
      ? `<li><span>Всего ${quakes.features.length} толчков сильнее 2,5</span></li>` + top.map(f => `<li><b>${f.properties.mag.toFixed(1)}</b><span>${f.properties.place} · ${timeAgo(f.properties.time)}</span></li>`).join('')
      : '<li><span>За сутки сильных толчков не было</span></li>';
  } catch {
    $('quakeList').innerHTML = '<li><span>Не удалось загрузить данные USGS — проверь интернет</span></li>';
  }
}

async function refreshIss() {
  if (!map || document.hidden) return;
  try {
    const iss = await fetchIss();
    state.iss = iss;
    map.getSource('iss').setData({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [iss.lng, iss.lat] }, properties: {} }] });
    const over = countryAtLngLat(globe.countries, iss.lng, iss.lat);
    $('issText').textContent = `${Math.round(iss.alt)} км над ${over ? `страной ${over.name}` : 'океаном'} · ${Math.round(iss.speed).toLocaleString('ru')} км/ч. Точка на глобусе обновляется каждые 5 секунд.`;
  } catch {
    $('issText').textContent = 'Нет связи с сервером МКС';
  }
}

// ---------- руки → наблюдения ----------
// Область кадра, которую рука удобно проходит, растягивается на весь экран.
const BOX = { x0: 0.12, x1: 0.88, y0: 0.1, y1: 0.85 };
const toScreen = p => ({ x: Math.max(0, Math.min(1, (p.x - BOX.x0) / (BOX.x1 - BOX.x0))), y: Math.max(0, Math.min(1, (p.y - BOX.y0) / (BOX.y1 - BOX.y0))) });

function handsFrom(res) {
  const vw = video.videoWidth || 640, vh = video.videoHeight || 480;
  const list = (res.landmarks ?? []).slice(0, 2).map((norm, i) => {
    const mirror = p => ({ x: 1 - p.x, y: p.y });
    return { norm, world: res.worldLandmarks?.[i] ?? null, palm: mirror(norm[9]), tip: mirror(norm[8]), px: norm.map(p => ({ x: (1 - p.x) * vw, y: p.y * vh })) };
  });
  const keys = assignHands(list.map(h => h.palm), lastPos, performance.now());
  const out = { Left: { present: false }, Right: { present: false } };
  const t = performance.now() / 1000;
  rawHands = [];
  list.forEach((h, i) => {
    const key = keys[i];
    const prevPinch = engine.pose[key] === POSE.PINCH;
    const cls = classifyHand(h.px, h.world, prevPinch);
    filters[key] ??= { x: new OneEuro(1.4, 4), y: new OneEuro(1.4, 4) };
    const s = toScreen(h.tip);
    out[key] = { present: true, ...cls, palm: h.palm, tip: { x: filters[key].x.filter(s.x, t), y: filters[key].y.filter(s.y, t) } };
    rawHands.push({ key, norm: h.norm, pose: cls.pose });
    $(key === 'Left' ? 'stateLeft' : 'stateRight').textContent = `${key === 'Left' ? 'левая' : 'правая'}: ${POSE_NAMES[cls.pose]}`;
  });
  for (const key of ['Left', 'Right']) if (!out[key].present) $(key === 'Left' ? 'stateLeft' : 'stateRight').textContent = `${key === 'Left' ? 'левая' : 'правая'}: —`;
  return out;
}

// ---------- указатель: кнопки и страны ----------
const DWELL_MS = 700;
function point(p, key, now) {
  const x = p.x * innerWidth, y = p.y * innerHeight;
  const el = document.elementFromPoint(x, y)?.closest('[data-target]');
  const country = !el && onGlobe(map, [x, y]) ? countryAt(map, [x, y]) : null;
  if (state.hover[key]?.id !== country?.id) {
    setFlag(map, state.hover[key]?.id, 'hover', false);
    if (country) setFlag(map, country.id, 'hover', true);
    state.hover[key] = country;
  }
  const target = el ? el.dataset.target : country ? `country:${country.id}` : state.mode === 'quiz' ? 'ocean' : null;
  const d = state.dwell[key];
  if (!d || d.target !== target) state.dwell[key] = { target, t: now, fired: false };
  const cur = state.dwell[key];
  const progress = target ? Math.min(1, (now - cur.t) / DWELL_MS) : 0;
  document.querySelectorAll('[data-target].aim').forEach(b => { if (b !== el) { b.classList.remove('aim'); b.style.removeProperty('--p'); } });
  if (el) { el.classList.add('aim'); el.style.setProperty('--p', progress); }
  if (progress >= 1 && !cur.fired) {
    cur.fired = true;
    if (el) el.click();
    else if (state.mode === 'quiz') answerQuiz(country);
    else if (country) showCard(country);
  }
  return { key, x, y, progress, country };
}

// ---------- отрисовка курсоров и руки в окне камеры ----------
function drawHud() {
  const dpr = Math.min(2, devicePixelRatio || 1);
  if (hud.width !== innerWidth * dpr) { hud.width = innerWidth * dpr; hud.height = innerHeight * dpr; }
  const ctx = hud.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, innerWidth, innerHeight);
  for (const p of view.pointers) {
    ctx.strokeStyle = p.key === 'Left' ? '#ffcf6e' : '#6fd6ff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 12, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
    ctx.fill();
    if (p.progress > 0) {
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 20, -Math.PI / 2, -Math.PI / 2 + p.progress * Math.PI * 2);
      ctx.stroke();
    }
    if (p.country) {
      ctx.font = '600 13px Manrope, sans-serif';
      ctx.fillStyle = '#fff';
      ctx.strokeStyle = 'rgba(0,0,0,0.7)';
      ctx.lineWidth = 3;
      ctx.strokeText(p.country.name, p.x + 24, p.y - 14);
      ctx.fillText(p.country.name, p.x + 24, p.y - 14);
    }
  }
  // Джойстик: кружок — где сжат кулак (там глобус стоит), стрелка — куда и как быстро едет.
  const j = view.joy;
  if (j) {
    const ax = j.ax * innerWidth, ay = j.ay * innerHeight, x = j.x * innerWidth, y = j.y * innerHeight;
    const r = T.JOY_DEAD * Math.min(innerWidth, innerHeight) * 1.4;
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.setLineDash([5, 5]);
    ctx.beginPath(); ctx.arc(ax, ay, r, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
    if (j.k > 0) {
      ctx.strokeStyle = `hsl(${190 - j.k * 150} 90% 65%)`;
      ctx.lineWidth = 3 + j.k * 4;
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(x, y); ctx.stroke();
    }
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(x, y, 7, 0, Math.PI * 2); ctx.fill();
  }
  const c = $('handCanvas');
  if (c.width !== 320) { c.width = 320; c.height = 240; }
  const hc = c.getContext('2d');
  hc.clearRect(0, 0, 320, 240);
  if (performance.now() - lastResultAt > 450) return;
  const links = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12], [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [17, 18], [18, 19], [19, 20], [0, 17]];
  for (const h of rawHands) {
    hc.strokeStyle = h.key === 'Left' ? '#ffcf6e' : '#6fd6ff';
    hc.lineWidth = 2;
    hc.beginPath();
    for (const [a, b] of links) { hc.moveTo((1 - h.norm[a].x) * 320, h.norm[a].y * 240); hc.lineTo((1 - h.norm[b].x) * 320, h.norm[b].y * 240); }
    hc.stroke();
  }
}

// ---------- главный цикл ----------
const ROTATE_GAIN = 2; // небольшое движение руки заметно поворачивает глобус
const SPIN_EASE = 0.09; // с, за сколько скорость джойстика догоняет руку (меньше — отзывчивее, больше — плавнее)
let last = performance.now();
let spinTarget = null, spin = { vx: 0, vy: 0 };
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.max(0, Math.min(0.05, (now - last) / 1000));
  last = now;
  if (!map) return;

  if (state.camera && tracker && !document.hidden) {
    const res = tracker.detect(video, now);
    let hands = null;
    if (res) { hands = handsFrom(res); lastResultAt = now; }
    else if (now - lastResultAt > 400) hands = { Left: { present: false }, Right: { present: false } };
    if (hands) {
      const out = engine.update(hands, now, { levelMode: ['flood', 'iceage'].includes(state.mode) });
      for (const a of out.actions) {
        if (a.type === 'spin') { state.inertia = null; spinTarget = { vx: a.vx, vy: a.vy, t: now }; }
        else if (a.type === 'rotate') { state.inertia = null; map.panBy([-a.dx * innerWidth * ROTATE_GAIN, -a.dy * innerHeight * ROTATE_GAIN], { duration: 0 }); }
        else if (a.type === 'release') {
          if (engine.style === 'joystick') spinTarget = null; // джойстик: скорость плавно гаснет сама
          else state.inertia = { vx: a.vx, vy: a.vy };
        }
        else if (a.type === 'zoom') {
          const z = map.getZoom() + a.dz;
          if (z > map.getMaxZoom() && a.dz > 0) hint('Ближе уже некуда — это максимальное приближение', 'error', 1200);
          map.jumpTo({ zoom: Math.max(0.8, Math.min(map.getMaxZoom(), z)) });
        } else if (a.type === 'swipe') shiftMode(a.dir);
        else if (a.type === 'level') changeLevel(a.dv);
      }
      view.pointers = out.pointers.map(p => point(p, p.key, now));
      view.joy = out.joy;
      for (const key of ['Left', 'Right']) if (!out.pointers.some(p => p.key === key) && state.hover[key]) { setFlag(map, state.hover[key].id, 'hover', false); state.hover[key] = null; state.dwell[key] = null; }
      hint(out.hint, out.kind);
    }
  }

  // Джойстик: скорость задаёт рука, а крутим каждый кадр экрана (60 раз в секунду),
  // а не только когда пришёл кадр камеры, — поэтому без рывков. Скорость меняется плавно.
  if (spinTarget && now - spinTarget.t > T.LOST_MS) spinTarget = null; // рука пропала — стоп
  const tv = spinTarget ?? { vx: 0, vy: 0 };
  const ease = 1 - Math.exp(-dt / SPIN_EASE);
  spin.vx += (tv.vx - spin.vx) * ease; spin.vy += (tv.vy - spin.vy) * ease;
  if (Math.hypot(spin.vx, spin.vy) > 0.002) map.panBy([-spin.vx * dt * innerWidth * ROTATE_GAIN, -spin.vy * dt * innerHeight * ROTATE_GAIN], { duration: 0 });
  else if (!spinTarget) spin.vx = spin.vy = 0;

  // Отпущенный глобус крутится дальше и плавно останавливается.
  if (state.inertia) {
    const v = state.inertia;
    map.panBy([-v.vx * dt * innerWidth * ROTATE_GAIN, -v.vy * dt * innerHeight * ROTATE_GAIN], { duration: 0 });
    v.vx *= 0.93; v.vy *= 0.93;
    if (Math.hypot(v.vx, v.vy) < 0.02) state.inertia = null;
  }
  drawHud();
}

// ---------- запуск ----------
let loaded = false;
const assets = preload(p => {
  $('loadBar').style.width = `${Math.round(p * 100)}%`;
  if (!loaded) $('loadText').textContent = `Загружаю распознавание рук: ${Math.round(p * 100)}%`;
});
assets.then(() => { loaded = true; $('loadText').textContent = 'Распознавание загружено — можно начинать'; }, () => {});

async function startCamera() {
  const btn = $('camStart');
  btn.disabled = true;
  hint('Разреши доступ к камере в окне браузера', 'info', 800);
  try {
    const mod = await import('./tracker.js');
    await mod.startCamera(video);
    $('loadText').textContent = loaded ? 'Запускаю распознавание…' : 'Камера готова, догружаю распознавание…';
    tracker = await mod.createHandTracker(await preload());
    state.camera = true;
    $('camEmpty').hidden = true;
    $('start').hidden = true;
    hint('Сожми кулак и веди — глобус крутится. Сведи и разведи большой и указательный — масштаб', 'info', 3000);
  } catch (e) {
    console.error(e);
    video.srcObject?.getTracks().forEach(t => t.stop());
    $('loadText').textContent = e.name === 'NotAllowedError' ? 'Камера запрещена — разреши её в адресной строке' : 'Не удалось запустить камеру или распознавание. Проверь интернет и попробуй снова';
  } finally {
    btn.disabled = false;
  }
}

async function init() {
  renderModes();
  try {
    globe = await createGlobe('map', { mode: state.mode });
    map = globe.map;
  } catch (e) {
    console.error(e);
    hint('Не удалось загрузить глобус. Проверь интернет и обнови страницу', 'error', 60000);
    return;
  }
  setMode(state.mode);
  map.on('click', e => {
    const c = countryAt(map, [e.point.x, e.point.y]);
    if (state.mode === 'quiz') answerQuiz(c);
    else if (c) showCard(c);
  });
  refreshIss();
  setInterval(refreshIss, 5000);
  setInterval(() => { if (state.mode === 'live') refreshLive(); }, 5 * 60 * 1000);
  requestAnimationFrame(frame);
  if (DEBUG) {
    Object.assign(window, { jer: { state, map, globe, setMode, engine, answerQuiz, showCard } });
    // ?debug&show=режим&card=KZ — готовое состояние для снимков при проверке
    const q = new URLSearchParams(location.search);
    if (q.get('show')) setMode(q.get('show'));
    const iso = q.get('card');
    if (iso) showCard(globe.countries.features.map(f => ({ id: f.id, ...f.properties })).find(c => c.iso2 === iso));
    if (q.get('wrong')) { const w = globe.countries.features.find(f => f.properties.iso2 === q.get('wrong')); answerQuiz({ id: w.id, ...w.properties }); }
  }
}

$('camStart').onclick = startCamera;
$('mouseStart').onclick = () => { $('start').hidden = true; hint('Мышь: тяни — крутить, колёсико — масштаб, клик по стране — карточка, цифры 1–7 — режимы', 'info', 4000); };
addEventListener('keydown', e => {
  const n = Number(e.key);
  if (n >= 1 && n <= MODES.length) setMode(MODES[n - 1].id);
  if (e.key === 'ArrowRight') shiftMode(1);
  if (e.key === 'ArrowLeft') shiftMode(-1);
  if (['flood', 'iceage'].includes(state.mode) && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { e.preventDefault(); changeLevel(e.key === 'ArrowUp' ? 5 : -5); }
});
addEventListener('pagehide', () => { tracker?.close?.(); video.srcObject?.getTracks().forEach(t => t.stop()); });
if (DEBUG && new URLSearchParams(location.search).get('show')) $('start').hidden = true;

init();
