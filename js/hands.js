// Две руки → действия с глобусом. Собственная логика, без DOM и карты — покрыта тестами.
//   кулак — схватить и крутить; разжать — глобус крутится по инерции
//   два кулака — развести/свести руки: масштаб
//   щипок (большой + указательный) — вверх ближе, вниз дальше
//   ладонь — взмах в сторону: сменить режим; в режимах с морем — вверх/вниз уровень воды
//   указательный палец — указатель: страна, кнопки

import { POSE } from './gestures.js';

export const T = {
  SWIPE_DX: 0.14,
  SWIPE_MAX_MS: 750,
  SWIPE_MIN_MS: 90,
  SWIPE_COOLDOWN: 900,
  FAST: 2.4,          // долей кадра в секунду — «крутишь слишком резко»
  EDGE: 0.05,         // доля кадра у края
  PINCH_ZOOM: 5,      // уровней масштаба на всю высоту кадра
  TWO_HAND_ZOOM: 2.4, // уровней масштаба на удвоение расстояния между руками
  LEVEL_GAIN: 260,    // метров уровня моря на всю высоту кадра
  CLOSE_HANDS: 0.12,  // руки ближе — масштаб двумя руками неточный
};

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
    } else keys = a.x <= b.x ? ['Left', 'Right'] : ['Right', 'Left'];
  } else keys = [];
  palms.forEach((p, i) => { lastPos[keys[i]] = { x: p.x, y: p.y, t: now }; });
  return keys;
}

export class GlobeHands {
  constructor() {
    this.prev = {};      // прошлое положение ладони каждой руки
    this.poseSince = {};
    this.pose = {};
    this.vel = [];       // последние движения при захвате — для инерции
    this.twoDist = null;
    this.swipe = null;
    this.cooldown = 0;
    this.grabKey = null;
  }

  /**
   * hands: { Left, Right } — { present, pose, near, hint, palm:{x,y}, tip:{x,y} } (доли кадра, отзеркалено).
   * ctx: { levelMode } — в режимах с уровнем моря ладонь вверх/вниз меняет уровень.
   */
  update(hands, now, ctx = {}) {
    const out = { actions: [], hint: null, kind: 'info', pointers: [] };
    const act = a => out.actions.push(a);
    const list = Object.entries(hands).filter(([, h]) => h?.present);

    for (const [key, h] of list) {
      if (h.pose !== this.pose[key]) { this.pose[key] = h.pose; this.poseSince[key] = now; }
    }
    for (const key of Object.keys(this.pose)) if (!hands[key]?.present) { delete this.pose[key]; delete this.prev[key]; }

    const fists = list.filter(([, h]) => h.pose === POSE.FIST);
    const moved = (key, h) => {
      const p = this.prev[key];
      return p ? { dx: h.palm.x - p.x, dy: h.palm.y - p.y, dt: Math.max(0.001, (now - p.t) / 1000) } : null;
    };

    // Отпустил глобус — пусть крутится дальше по инерции.
    if (this.grabKey && !(fists.length === 1 && fists[0][0] === this.grabKey)) {
      if (this.vel.length && fists.length === 0) {
        const n = this.vel.length;
        act({ type: 'release', vx: this.vel.reduce((s, v) => s + v.vx, 0) / n, vy: this.vel.reduce((s, v) => s + v.vy, 0) / n });
      }
      this.grabKey = null;
      this.vel = [];
    }

    if (fists.length === 2) {
      // Масштаб двумя руками.
      const d = dist(fists[0][1].palm, fists[1][1].palm);
      if (d < T.CLOSE_HANDS) {
        out.hint = 'Руки слишком близко — разведи их шире, чтобы менять масштаб';
        out.kind = 'error';
      } else if (this.twoDist) {
        act({ type: 'zoom', dz: Math.log2(d / this.twoDist) * T.TWO_HAND_ZOOM });
        out.hint = 'Разводи руки — ближе, своди — дальше';
      } else out.hint = 'Две руки: разводи — приблизить, своди — отдалить';
      this.twoDist = d;
    } else {
      this.twoDist = null;
      if (fists.length === 1) {
        const [key, h] = fists[0];
        const m = moved(key, h);
        if (this.grabKey !== key) { this.grabKey = key; this.vel = []; }
        if (m) {
          const speed = Math.hypot(m.dx, m.dy) / m.dt;
          const k = speed > T.FAST ? T.FAST / speed : 1; // слишком резко — ограничиваем
          act({ type: 'rotate', dx: m.dx * k, dy: m.dy * k });
          this.vel.push({ vx: (m.dx * k) / m.dt, vy: (m.dy * k) / m.dt, t: now });
          this.vel = this.vel.filter(v => now - v.t < 120);
          if (speed > T.FAST) { out.hint = 'Крути плавнее — глобус не успевает за рукой'; out.kind = 'error'; }
        }
        const edge = h.palm.x < T.EDGE || h.palm.x > 1 - T.EDGE || h.palm.y < T.EDGE || h.palm.y > 1 - T.EDGE;
        if (edge) { out.hint = 'Рука у края кадра — разожми кулак и перехвати глобус ближе к центру'; out.kind = 'error'; }
        out.hint ??= 'Держишь глобус — веди кулак, чтобы крутить';
      }
    }

    // Остальные руки: щипок, ладонь, палец.
    for (const [key, h] of list) {
      const m = moved(key, h);
      if (h.pose === POSE.PINCH && fists.length < 2) {
        if (m) act({ type: 'zoom', dz: -m.dy * T.PINCH_ZOOM });
        out.hint ??= 'Щипок: веди вверх — ближе, вниз — дальше';
      } else if (h.pose === POSE.PALM && fists.length === 0) {
        this.palm(h, now, ctx, out, act);
      } else if (h.pose === POSE.POINT) {
        out.pointers.push({ key, x: h.tip.x, y: h.tip.y });
      } else if (h.pose === POSE.OTHER && h.hint && now - this.poseSince[key] > 350) {
        out.hint ??= h.near === POSE.FIST ? 'Сожми кулак плотнее, чтобы схватить глобус' : h.hint;
        out.kind = 'error';
      }
    }
    if (!list.some(([, h]) => h.pose === POSE.PALM)) this.swipe = null;

    for (const [key, h] of list) this.prev[key] = { x: h.palm.x, y: h.palm.y, t: now };
    if (!list.length) out.hint = 'Подними руку перед камерой: кулак — крутить, щипок — масштаб';
    out.hint ??= 'Кулак — крутить · щипок — масштаб · палец — страна · взмах ладонью — режим';
    return out;
  }

  // Ладонь: горизонтальный взмах — режим; в режимах с морем — вверх/вниз уровень.
  palm(h, now, ctx, out, act) {
    if (now < this.cooldown) return;
    if (!this.swipe || now - this.swipe.t > T.SWIPE_MAX_MS) this.swipe = { x: h.palm.x, y: h.palm.y, t: now, ly: h.palm.y };
    const dx = h.palm.x - this.swipe.x, dy = h.palm.y - this.swipe.y, age = now - this.swipe.t;
    if (ctx.levelMode && Math.abs(dy) > Math.abs(dx)) {
      const dv = -(h.palm.y - this.swipe.ly) * T.LEVEL_GAIN;
      this.swipe.ly = h.palm.y;
      if (dv) act({ type: 'level', dv });
      out.hint ??= 'Ладонь вверх — море поднимается, вниз — опускается';
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
