// Client-side prediction + server reconciliation for the local player.
//
//   predict:   apply each input locally the moment it's pressed (no RTT wait)
//   reconcile: when an authoritative state arrives (acked up to input N),
//              rewind to it and replay inputs N+1..latest that are still in flight
//   smoothing: any remaining mismatch is blended out visually over ~100 ms
//              instead of snapping
import { step, cloneState } from '../shared/physics.js';

const MAX_PENDING = 240;
const SNAP_DISTANCE = 120; // bigger corrections (respawn, teleport) snap instantly

export class Predictor {
  constructor() {
    this.state = null;
    this.pending = []; // [seq, keys]
    this.seq = 0;
    this.offset = { x: 0, y: 0 };
    this.lastError = 0;
  }

  // Record a new input for this tick; returns [seq, keys] for sending.
  local(keys, isIt, predict) {
    const input = [++this.seq, keys];
    this.pending.push(input);
    if (this.pending.length > MAX_PENDING) this.pending.shift();
    if (predict && this.state) step(this.state, keys, isIt);
    return input;
  }

  onServerState(serverState, ack, isIt, { predict, reconcile }) {
    while (this.pending.length && this.pending[0][0] <= ack) this.pending.shift();
    const prev = this.state;
    const next = cloneState(serverState);
    if (predict && reconcile) {
      for (const [, keys] of this.pending) step(next, keys, isIt);
    }
    if (prev && predict) {
      const ex = prev.x - next.x;
      const ey = prev.y - next.y;
      this.lastError = Math.hypot(ex, ey);
      if (reconcile && this.lastError < SNAP_DISTANCE) {
        this.offset.x += ex;
        this.offset.y += ey;
      } else {
        this.offset.x = 0;
        this.offset.y = 0;
      }
    } else {
      this.lastError = 0;
    }
    this.state = next;
  }

  decay(dtMs) {
    const f = Math.exp(-dtMs / 70);
    this.offset.x *= f;
    this.offset.y *= f;
  }

  renderPos() {
    return { x: this.state.x + this.offset.x, y: this.state.y + this.offset.y };
  }
}
