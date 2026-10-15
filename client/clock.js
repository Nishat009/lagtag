// Two clocks, deliberately different:
//
// 1. RTT, from ping/pong over the active transport (shown in the lab).
// 2. The *received* server timeline used for interpolation. Each snapshot
//    stamped ts that arrives at local time `now` gives a sample ts - now. The
//    largest sample in a recent window is the least-delayed packet (least
//    queueing/jitter), so serverNow() tracks "the newest server time that can
//    have reached us", not true server time. Rendering at serverNow() - delay
//    then always has `delay` ms of buffered snapshots, whatever the latency.
//    (The server undoes exactly this when it rewinds for lag compensation:
//    rewind ≈ RTT + interpolation delay.)
const WINDOW_MS = 1000;

export class ServerClock {
  constructor() {
    this.samples = []; // { at, offset }
    this.offset = 0;
    this.target = 0;
    this.synced = false;
    this.rtts = [];
    this.rtt = 0;
  }

  addPong(clientSent, now = performance.now()) {
    this.rtts.push(now - clientSent);
    if (this.rtts.length > 8) this.rtts.shift();
    this.rtt = this.rtts.reduce((a, b) => a + b, 0) / this.rtts.length;
  }

  addSnapshot(ts, now = performance.now()) {
    this.samples.push({ at: now, offset: ts - now });
    while (this.samples.length && this.samples[0].at < now - WINDOW_MS) this.samples.shift();
    this.target = Math.max(...this.samples.map((s) => s.offset));
    if (!this.synced) {
      this.offset = this.target;
      this.synced = true;
    }
  }

  update(dtMs) {
    // Slow down quickly (we're outrunning our data), speed up gently.
    const diff = this.target - this.offset;
    if (Math.abs(diff) > 250) this.offset = this.target;
    else this.offset += Math.max(-dtMs * 0.3, Math.min(dtMs * 0.05, diff));
  }

  serverNow(now = performance.now()) {
    return now + this.offset;
  }
}
