// Pure UI policies: test without camera, GPU or network.
export const SPEEDS = [
  { name: 'Точно', gain: 0.65 },
  { name: 'Обычно', gain: 1 },
  { name: 'Быстро', gain: 1.35 },
];
export function readSpeed(value) { const n = Number(value); return value != null && Number.isInteger(n) && n >= 0 && n < SPEEDS.length ? n : 1; }
export function panGain(style, speed) { return SPEEDS[readSpeed(speed)].gain * (style === 'joystick' ? 0.9 : 1); }
export function readingTime(text, kind = 'info') { return Math.min(12000, Math.max(kind === 'error' ? 6500 : 4500, text.length * 42)); }
export class HintPolicy {
  constructor() { this.current = null; this.pending = null; }
  offer(text, kind, hold, now) {
    if (!text) return null;
    const priority = hold ? 3 : kind === 'error' ? 2 : 1;
    if (this.current?.text === text && this.current.kind === kind) { this.pending = null; return null; }
    if (this.current && now < this.current.until && priority <= this.current.priority && !hold) return null;
    if (!hold && this.current) {
      if (this.pending?.text !== text) { this.pending = { text, since: now }; return null; }
      if (now - this.pending.since < 250) return null;
    }
    this.current = { text, kind, priority, until: now + Math.max(hold, readingTime(text, kind)) };
    this.pending = null;
    return this.current;
  }
}
export function globeError(error) {
  return /WebGL|GPUInitialization/i.test(String(error?.message || error))
    ? 'Браузер не смог включить 3D-графику (WebGL2). Включи аппаратное ускорение в настройках браузера или открой сайт в другом современном браузере.'
    : 'Глобус не загрузился. Проверь соединение и нажми «Повторить загрузку». Камера пока не нужна.';
}
