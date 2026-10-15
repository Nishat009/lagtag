// Entity interpolation for remote players: render them slightly in the past
// (renderTime = serverNow - delay) and blend between the two snapshots that
// bracket that time. Snapshots may arrive out of order over the unordered
// data channel, so they're inserted sorted.
const KEEP_MS = 1500;
const MAX_EXTRAPOLATE_MS = 120;

export class Interpolator {
  constructor() {
    this.buf = []; // { ts, players: Map<id, state> }
    this.extrapolating = false;
  }

  push(ts, players) {
    const b = this.buf;
    let i = b.length;
    while (i > 0 && b[i - 1].ts > ts) i--;
    if (i > 0 && b[i - 1].ts === ts) return;
    b.splice(i, 0, { ts, players });
    const cutoff = b[b.length - 1].ts - KEEP_MS;
    while (b.length > 2 && b[0].ts < cutoff) b.shift();
  }

  latest() {
    return this.buf[this.buf.length - 1];
  }

  // How much buffered future we have beyond renderTime (negative = starving).
  aheadMs(renderTime) {
    const last = this.latest();
    return last ? last.ts - renderTime : 0;
  }

  sample(id, renderTime) {
    const b = this.buf;
    if (!b.length) return null;
    const last = this.latest();
    if (renderTime < last.ts) {
      for (let i = b.length - 2; i >= 0; i--) {
        if (b[i].ts > renderTime) continue;
        const a = b[i].players.get(id);
        const c = b[i + 1].players.get(id);
        if (!a || !c) return a ?? c ?? null;
        const k = (renderTime - b[i].ts) / (b[i + 1].ts - b[i].ts);
        return { x: a.x + (c.x - a.x) * k, y: a.y + (c.y - a.y) * k, frz: a.frz, dash: c.dash };
      }
      return b[0].players.get(id) ?? null; // older than anything buffered
    }
    // Ran out of snapshots (loss / jitter spike): dead-reckon briefly.
    const p = last.players.get(id);
    if (!p) return null;
    const ext = Math.min(renderTime - last.ts, MAX_EXTRAPOLATE_MS) / 1000;
    return { x: p.x + p.vx * ext, y: p.y + p.vy * ext, frz: p.frz, dash: p.dash, extrapolated: true };
  }
}
