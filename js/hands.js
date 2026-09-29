// Две руки → действия с глобусом. Собственная логика, без DOM и карты — покрыта тестами.
//   кулак — «джойстик»: где сжал — там центр; сдвинул кулак — глобус плавно едет туда,
//     чем дальше от центра, тем быстрее; вернул к центру — стоп (рука не уезжает к краю кадра)
//   (режим «перетаскивание»: кулак схватил и тащит, раскрыл ладонь — крутится по инерции)
//   большой + указательный: свёл, затем развёл — ближе, свёл — дальше (как на телефоне)
//   два кулака или две ладони — развести/свести руки: масштаб
//   ладонь — взмах в сторону: сменить режим (только одной рукой, уже какое-то время в кадре);
//     в режимах с морем — вверх/вниз уровень воды
//   указательный палец — указатель: страна, кнопки

import { POSE } from './gestures.js';

export const T = {
  SWIPE_DX: 0.2,
  SWIPE_MAX_MS: 750,
  SWIPE_MIN_MS: 90,
  SWIPE_COOLDOWN: 1200,
  SWIPE_ARM_MS: 300,
  AXIS_LOCK: 0.04,    // сдвиг ладони, после которого решаем: взмах в сторону или уровень моря
  LEVEL_IDLE_MS: 500, // ладонь замерла столько — жест «уровень моря» закончен  // ладонь должна продержаться столько, прежде чем взмах засчитается
  SWIPE_SETTLE_MS: 600, // рука только появилась или ушла вторая — взмахи не считаем
  ZOOM_DEAD: 0.03,    // двуручный масштаб: изменение расстояния меньше (log2) — дрожание
  SPREAD_IDLE_MS: 700, // масштаб пальцами: ладонь/указатель без движения столько — масштаб отпущен
  FAST: 3,            // долей кадра в секунду — «крутишь слишком резко»
  EDGE: 0.04,         // доля кадра у края
  DEAD: 0.0015,       // движения меньше — дрожание руки, глобус не трогаем
  SMOOTH: 0.45,       // сглаживание положения ладони (0 — нет, 1 — стоит на месте)
  SPREAD_ZOOM: 1.7,   // уровней масштаба на каждое удвоение расстояния между пальцами
  SPREAD_DEAD: 0.015, // изменение раствора пальцев меньше — дрожание
  TWO_HAND_ZOOM: 2.4, // уровней масштаба на удвоение расстояния между руками
  LEVEL_GAIN: 260,    // метров уровня моря на всю высоту кадра
  CLOSE_HANDS: 0.12,  // руки ближе — масштаб двумя руками неточный
  RELEASE_FRAMES: 2,  // столько кадров раскрытой руки — глобус отпущен
  JOY_DEAD: 0.045,    // джойстик: сдвиг кулака меньше — глобус стоит
  JOY_RANGE: 0.22,    // сдвиг, при котором скорость максимальна
  JOY_MAX: 0.45,      // максимальная скорость, долей экрана в секунду
  JOY_SMOOTH: 0.2,    // джойстик сглаживает руку слабее: дрожание гасит мёртвая зона — меньше задержка
  LOST_MS: 300,       // джойстик: рука пропала на столько — центр кулака помним
  STALE_MS: 1000,     // кадров не было дольше (вкладка скрыта) — всё начинаем заново
};

// Скорость джойстика: мягкий старт у центра, точное управление малыми сдвигами.
export function joySpeed(off) {
  const d = Math.hypot(off.x, off.y);
  if (d <= T.JOY_DEAD) return { vx: 0, vy: 0, k: 0 };
  const k = Math.min(1, (d - T.JOY_DEAD) / (T.JOY_RANGE - T.JOY_DEAD));
  const v = T.JOY_MAX * k ** 1.8;
  return { vx: (off.x / d) * v, vy: (off.y / d) * v, k };
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// Руки различаем по положению (левая/правая половина кадра) и держим «слот»,
// пока рука видна рядом с прежним местом — метка MediaPipe иногда перескакивает.
export function assignHands(palms, lastPos, now) {
  const recent = k => lastPos[k] && now - lastPos[k].t < 400;
  let keys;
  if (palms.length === 1) {
    const p = palms[0];
    const near = ['Right', 'Left'].filter(recent).sort((a, b) => dist(lastPos[a], p) - dist(lastPos[b], p))[0];
    keys = [near ?? (p.x < 0.5 ? 'Left' : 'Right')];
  } else if (palms.length === 2) {
    const [a, b] = palms;
    if (recent('Left') && recent('Right')) {
      const keep = dist(lastPos.Left, a) + dist(lastPos.Right, b);
      const swap = dist(lastPos.Right, a) + dist(lastPos.Left, b);
      keys = keep <= swap ? ['Left', 'Right'] : ['Right', 'Left'];
    } else if (recent('Left') || recent('Right')) {
      // В кадр вошла вторая рука — «слот» остаётся у той, что уже была (иначе захват перескочит на новую).
      const k = recent('Left') ? 'Left' : 'Right', o = k === 'Left' ? 'Right' : 'Left';
      keys = dist(lastPos[k], a) <= dist(lastPos[k], b) ? [k, o] : [o, k];
    } else keys = a.x <= b.x ? ['Left', 'Right'] : ['Right', 'Left'];
  } else keys = [];
  palms.forEach((p, i) => { lastPos[keys[i]] = { x: p.x, y: p.y, t: now }; });
  return keys;
}

export class GlobeHands {
  constructor(style = 'joystick') {
    this.style = style;  // 'joystick' | 'drag'
    this.pose = {};      // текущая поза каждой руки
    this.poseSince = {};
    this.palm = {};      // сглаженное положение ладони: { x, y, t }
    this.grab = {};      // рука держит глобус: { open } — сколько кадров подряд раскрыта
    this.spread = {};    // рука меняет масштаб пальцами: { r, idle }
    this.vel = [];
    this.twoDist = null;
    this.swipe = null;
    this.cooldown = 0;
    this.spin = null;    // текущая скорость джойстика
    this.seen = {};      // когда рука появилась в кадре
    this.calmUntil = 0;  // до этого времени взмахи ладонью не считаем
  }

  /**
   * hands: { Left, Right } — { present, pose, near, hint, pinch, palm:{x,y}, tip:{x,y} } (доли кадра, отзеркалено).
   * ctx: { levelMode } — в режимах с уровнем моря ладонь вверх/вниз меняет уровень.
   */
  update(hands, now, ctx = {}) {
    const out = { actions: [], hint: null, kind: 'info', pointers: [], joy: null };
    const act = a => out.actions.push(a);
    const list = Object.entries(hands).filter(([, h]) => h?.present);
    const moves = {};
    for (const [key] of list) this.seen[key] ??= now;
    for (const key of Object.keys(this.seen)) if (!hands[key]?.present) delete this.seen[key];
    if (list.length === 2) this.calmUntil = now + T.SWIPE_SETTLE_MS;
    // Долго не было кадров (вкладка скрыта) — старый захват не продолжаем.
    if (this.lastT != null && now - this.lastT > T.STALE_MS) {
      this.pose = {}; this.poseSince = {}; this.palm = {}; this.grab = {}; this.spread = {};
      this.vel = []; this.twoDist = null; this.swipe = null; this.spin = null; this.cooldown = 0;
    }
    this.lastT = now;

    // Позы, сглаженные ладони и сколько сдвинулась каждая рука.
    for (const [key, h] of list) {
      if (h.pose !== this.pose[key]) { this.pose[key] = h.pose; this.poseSince[key] = now; }
      const prev = this.palm[key];
      const a = 1 - (this.style === 'joystick' && this.grab[key] ? T.JOY_SMOOTH : T.SMOOTH);
      const s = prev ? { x: prev.x + (h.palm.x - prev.x) * a, y: prev.y + (h.palm.y - prev.y) * a, t: now } : { ...h.palm, t: now };
      if (prev) moves[key] = { dx: s.x - prev.x, dy: s.y - prev.y, dt: Math.max(0.001, (now - prev.t) / 1000) };
      this.palm[key] = s;
    }
    const previousGrabbers = Object.keys(this.grab);
    const wasGrabbing = Object.keys(this.grab).length > 0;
    for (const key of new Set([...Object.keys(this.pose), ...Object.keys(this.grab)])) {
      if (hands[key]?.present) continue;
      delete this.pose[key]; delete this.palm[key]; delete this.spread[key];
      // Джойстик: камера на миг потеряла руку — центр кулака помним, иначе глобус «сбросится» и встанет.
      const g = this.grab[key];
      if (g && (this.style !== 'joystick' || now - g.seen > T.LOST_MS)) delete this.grab[key];
    }

    // Захват «липкий»: кулак хватает, отпускает только раскрытая ладонь или палец-указатель.
    for (const [key, h] of list) {
      if (h.pose === POSE.FIST && !this.spread[key]) {
        if (this.grab[key]) this.grab[key].open = 0;
        else { this.grab[key] = { open: 0, ax: this.palm[key].x, ay: this.palm[key].y }; delete moves[key]; }
      }
      else if (this.grab[key]) {
        // Щипок тоже отпускает не с одного кадра: сжатый кулак иногда на миг распознаётся как щипок.
        if (h.pose === POSE.PALM || h.pose === POSE.POINT || h.pose === POSE.PINCH) {
          if (++this.grab[key].open >= T.RELEASE_FRAMES) delete this.grab[key];
        } else this.grab[key].open = 0;
      }
      if (this.grab[key]) this.grab[key].seen = now;
    }
    const grabbers = Object.keys(this.grab).filter(k => hands[k]?.present);

    // Отпустил глобус — пусть крутится дальше по инерции.
    if (wasGrabbing && !Object.keys(this.grab).length) {
      if (this.spin) {
        act({ type: 'release', vx: this.spin.vx * 0.6, vy: this.spin.vy * 0.6 });
        this.spin = null;
      } else if (this.vel.length) {
        const n = this.vel.length;
        act({ type: 'release', vx: this.vel.reduce((s, v) => s + v.vx, 0) / n, vy: this.vel.reduce((s, v) => s + v.vy, 0) / n });
      }
      this.vel = [];
    }

    if (!grabbers.length && this.spin) act({ type: 'spin', vx: 0, vy: 0 });
    if (previousGrabbers.length === 2 && grabbers.length === 1) { const key = grabbers[0]; delete moves[key]; this.grab[key].ax = this.palm[key].x; this.grab[key].ay = this.palm[key].y; }

    if (grabbers.length === 2) {
      // Масштаб двумя руками.
      let d = dist(this.palm[grabbers[0]], this.palm[grabbers[1]]);
      if (d < T.CLOSE_HANDS) {
        out.hint = 'Руки слишком близко — разведи их шире, чтобы менять масштаб';
        out.kind = 'error';
        d = null; // руки сошлись — масштаб не считаем от этого расстояния, иначе потом скачок
      } else if (this.twoDist) {
        const r = Math.log2(d / this.twoDist);
        if (Math.abs(r) > T.ZOOM_DEAD) act({ type: 'zoom', dz: r * T.TWO_HAND_ZOOM });
        else d = this.twoDist; // дрожание — копим, пока не наберётся заметное движение
        out.hint = 'Разводи руки — ближе, своди — дальше';
      } else out.hint = 'Две руки: разводи — приблизить, своди — отдалить';
      this.twoDist = d;
      this.vel = [];
      if (this.spin) act({ type: 'spin', vx: 0, vy: 0 }); // второй кулак — глобус перестаёт ехать
      this.spin = null;
      for (const k of grabbers) { this.grab[k].ax = this.palm[k].x; this.grab[k].ay = this.palm[k].y; }
    } else if (grabbers.length === 0 && list.length === 2 && list.every(([k, h]) => h.pose === POSE.PALM && !this.spread[k])) {
      // Две раскрытые ладони — тоже масштаб: ладонь камера видит надёжнее всего.
      let d = dist(this.palm[list[0][0]], this.palm[list[1][0]]);
      if (d < T.CLOSE_HANDS) d = null;
      else if (this.twoDist) {
        const r = Math.log2(d / this.twoDist);
        if (Math.abs(r) > T.ZOOM_DEAD) act({ type: 'zoom', dz: r * T.TWO_HAND_ZOOM });
        else d = this.twoDist;
      }
      out.hint = 'Две ладони: разводи — ближе, своди — дальше';
      this.twoDist = d;
    } else {
      this.twoDist = null;
      if (grabbers.length === 1 && this.style === 'joystick') {
        const key = grabbers[0], g = this.grab[key], p = this.palm[key];
        const off = { x: p.x - g.ax, y: p.y - g.ay };
        const s = hands[key].pose === POSE.FIST || hands[key].pose === POSE.OTHER ? joySpeed(off) : { vx: 0, vy: 0, k: 0 };
        this.spin = { vx: s.vx, vy: s.vy };
        act({ type: 'spin', vx: s.vx, vy: s.vy });
        out.joy = { key, ax: g.ax, ay: g.ay, x: p.x, y: p.y, k: s.k };
        const d = Math.hypot(off.x, off.y);
        if (d > T.JOY_RANGE * 1.8) {
          out.hint = 'Кулак слишком далеко от центра — глобус и так на полной скорости. Раскрой ладонь, чтобы начать заново';
          out.kind = 'error';
        } else if (s.k > 0) out.hint = 'Глобус едет за кулаком. Верни кулак в кружок — стоп, раскрой ладонь — отпустить';
        else out.hint = 'Держишь глобус. Сдвинь кулак чуть в сторону — поедет туда, чем дальше, тем быстрее';
      } else if (grabbers.length === 1) {
        const key = grabbers[0];
        const m = [POSE.FIST, POSE.OTHER].includes(hands[key].pose) ? moves[key] : null;
        if (m && Math.hypot(m.dx, m.dy) > T.DEAD) {
          const speed = Math.hypot(m.dx, m.dy) / m.dt;
          const k = speed > T.FAST ? T.FAST / speed : 1; // слишком резко — ограничиваем
          act({ type: 'rotate', dx: m.dx * k, dy: m.dy * k });
          this.vel.push({ vx: (m.dx * k) / m.dt, vy: (m.dy * k) / m.dt, t: now });
          if (speed > T.FAST) { out.hint = 'Крути плавнее — глобус не успевает за рукой'; out.kind = 'error'; }
        }
        this.vel = this.vel.filter(v => now - v.t < 120);
        const p = hands[key].palm;
        if (p.x < T.EDGE || p.x > 1 - T.EDGE || p.y < T.EDGE || p.y > 1 - T.EDGE) {
          out.hint = 'Рука у края кадра — раскрой ладонь и перехвати глобус ближе к центру';
          out.kind = 'error';
        }
        out.hint ??= 'Держишь глобус — веди кулак. Раскрой ладонь — отпустить';
      }
    }

    // Масштаб пальцами: свёл большой и указательный — «зацепил», разводишь — ближе.
    for (const [key, h] of list) {
      if (this.grab[key]) continue;
      if (h.pose === POSE.PINCH && Number.isFinite(h.pinch) && !this.spread[key]) this.spread[key] = { r: Math.max(.08, h.pinch), idle: now, started: now };
      const sp = this.spread[key];
      if (!sp) continue;
      // Раскрыл ладонь или сжал кулак — «отпустил» масштаб. Палец замер на 2 с — снова указатель.
      // Широко развёл пальцы — рука похожа на ладонь, но это ещё масштаб: отпускаем, только когда замерла.
      if (h.pose === POSE.FIST || !Number.isFinite(h.pinch) || ((h.pose === POSE.PALM || h.pose === POSE.POINT) && now - sp.idle > T.SPREAD_IDLE_MS)) {
        delete this.spread[key];
        continue;
      }
      const r = sp.r + (Math.max(.08, h.pinch) - sp.r) * 0.5;
      if (Math.abs(r - sp.r) > T.SPREAD_DEAD) {
        act({ type: 'zoom', dz: Math.log2(r / sp.r) * T.SPREAD_ZOOM });
        sp.r = r;
        sp.idle = now;
      }
      if (now - sp.idle > 1500 && now - sp.started > 1500) {
        out.hint ??= 'Разведи большой и указательный пальцы — глобус приблизится. Раскрой ладонь, чтобы начать заново';
      } else out.hint ??= 'Разводи пальцы — ближе, своди — дальше. Раскрой ладонь — начать заново';
    }

    // Остальные руки: ладонь, палец, подсказки.
    for (const [key, h] of list) {
      if (this.grab[key] || this.spread[key]) continue;
      if (h.pose === POSE.PALM && grabbers.length === 0) {
        if (list.length === 2) continue; // две ладони — это масштаб, не взмах
        if (now < this.calmUntil || now - this.seen[key] < T.SWIPE_SETTLE_MS || now - this.poseSince[key] < T.SWIPE_ARM_MS) {
          this.swipe = null;
          out.hint ??= 'Ладонь — взмах вправо или влево: сменить режим';
          continue;
        }
        this.palmGesture(h, now, ctx, out, act, key);
      }
      else if (h.pose === POSE.POINT) out.pointers.push({ key, x: h.tip.x, y: h.tip.y });
      else if (h.pose === POSE.OTHER && h.hint && now - this.poseSince[key] > 350) {
        out.hint ??= h.near === POSE.FIST ? 'Сожми кулак плотнее, чтобы схватить глобус' : h.hint;
        out.kind = 'error';
      }
    }
    if (!list.some(([k, h]) => h.pose === POSE.PALM && !this.grab[k])) this.swipe = null;

    if (!list.length) out.hint = 'Подними руку перед камерой: кулак — крутить, две ладони — масштаб';
    out.hint ??= 'Кулак — крутить · две ладони развести — масштаб · палец — страна · взмах ладонью — режим';
    return out;
  }

  // Ладонь: горизонтальный взмах — режим; в режимах с морем — вверх/вниз уровень.
  palmGesture(h, now, ctx, out, act, key) {
    if (now < this.cooldown) return;
    const sw = this.swipe;
    const expired = sw && (sw.axis === 'v' ? now - sw.moved > T.LEVEL_IDLE_MS : now - sw.t > T.SWIPE_MAX_MS);
    if (!sw || sw.key !== key || expired) this.swipe = { key, x: h.palm.x, y: h.palm.y, t: now, ly: h.palm.y, moved: now, axis: null };
    const g = this.swipe;
    const dx = h.palm.x - g.x, dy = h.palm.y - g.y, age = now - g.t;
    // Направление решаем, только когда рука заметно сдвинулась, и держим до конца жеста:
    // иначе горизонтальный взмах, чуть ушедший вверх в начале, менял уровень моря.
    if (!g.axis) {
      if (Math.hypot(dx, dy) < T.AXIS_LOCK) {
        out.hint ??= ctx.levelMode ? 'Ладонь: вверх-вниз — уровень моря, взмах в сторону — другой режим' : 'Ладонь — взмах вправо или влево: сменить режим';
        return;
      }
      g.axis = ctx.levelMode && Math.abs(dy) > Math.abs(dx) * 1.3 ? 'v' : 'h';
      g.ly = h.palm.y;
    }
    if (g.axis === 'v') {
      const dv = -(h.palm.y - g.ly) * T.LEVEL_GAIN;
      if (Math.abs(h.palm.y - g.ly) > 0.002) g.moved = now;
      g.ly = h.palm.y;
      if (dv) act({ type: 'level', dv });
      out.hint ??= 'Ладонь вверх — море поднимается, вниз — опускается. Замри — и можно взмахнуть в сторону';
      return;
    }
    if (Math.abs(dx) >= T.SWIPE_DX && age >= T.SWIPE_MIN_MS) {
      if (Math.abs(dy) > Math.abs(dx) * 0.7) {
        out.hint = 'Чтобы сменить режим, веди ладонь горизонтально';
        out.kind = 'error';
        this.swipe = null;
      } else {
        act({ type: 'swipe', dir: dx > 0 ? 1 : -1 });
        this.cooldown = now + T.SWIPE_COOLDOWN;
        this.swipe = null;
      }
    } else if (Math.abs(dx) > T.SWIPE_DX * 0.45) out.hint ??= 'Продолжи взмах дальше в сторону';
    else out.hint ??= 'Ладонь — взмах вправо или влево: сменить режим';
  }
}
