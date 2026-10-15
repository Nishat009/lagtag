// Ring buffer of past world positions, used for lag compensation:
// "where was player X at server time t?" (linear interpolation between ticks).
export class History {
  constructor(maxMs = 1000) {
    this.maxMs = maxMs;
    this.frames = [];
  }

  push(time, positions) {
    this.frames.push({ time, positions });
    while (this.frames.length && this.frames[0].time < time - this.maxMs) this.frames.shift();
  }

  sample(id, t) {
    const f = this.frames;
    if (!f.length) return null;
    if (t <= f[0].time) return f[0].positions.get(id) ?? null;
    for (let i = f.length - 1; i >= 0; i--) {
      if (f[i].time > t) continue;
      const a = f[i].positions.get(id);
      const next = f[i + 1];
      if (!next) return a ?? null;
      const b = next.positions.get(id);
      if (!a || !b) return a ?? b ?? null;
      const k = (t - f[i].time) / (next.time - f[i].time);
      return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
    }
    return null;
  }
}
