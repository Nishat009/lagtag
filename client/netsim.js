// Artificial bad network, applied in the browser to every packet in both
// directions. Unreliable packets can be dropped and reordered (jitter);
// reliable ones are only delayed and keep their order, like TCP would.
export class NetSim {
  constructor() {
    this.rttMs = 0;
    this.jitterMs = 0;
    this.loss = 0;
    this.lastReliable = { up: 0, down: 0 };
  }

  run(dir, fn, reliable = false) {
    if (!reliable && this.loss > 0 && Math.random() < this.loss) return;
    const now = performance.now();
    let at = now + this.rttMs / 2 + Math.random() * this.jitterMs;
    if (reliable) {
      at = Math.max(at, this.lastReliable[dir]);
      this.lastReliable[dir] = at;
    }
    if (at - now < 1) fn();
    else setTimeout(fn, at - now);
  }
}
