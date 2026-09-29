// One Euro Filter: гасит дрожание кончика пальца, когда рука почти стоит,
// и почти не добавляет задержки при быстрых движениях.

const alpha = (dt, cutoff) => 1 / (1 + 1 / (2 * Math.PI * cutoff * dt));

export class OneEuro {
  constructor(minCutoff = 1.5, beta = 0.008, dCutoff = 1) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
    this.reset();
  }

  reset() {
    this.x = null;
    this.dx = 0;
    this.t = null;
  }

  filter(value, t) {
    if (this.x === null) {
      this.x = value;
      this.t = t;
      return value;
    }
    const dt = Math.max(1e-3, t - this.t);
    this.t = t;
    const a = alpha(dt, this.dCutoff);
    this.dx = a * ((value - this.x) / dt) + (1 - a) * this.dx;
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx);
    this.x += alpha(dt, cutoff) * (value - this.x);
    return this.x;
  }
}
