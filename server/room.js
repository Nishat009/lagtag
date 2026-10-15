// Authoritative game room: fixed 60 Hz simulation, 20 Hz snapshots,
// per-player input queues, server-side lag compensation, bots as filler.
import {
  TICK_MS, SNAPSHOT_EVERY, MAX_PLAYERS, SPAWNS, COLORS, FREEZE_TICKS, IMMUNE_TICKS,
  ROUND_TICKS, INTERMISSION_TICKS, MAX_REWIND_MS, TAG_SLOP,
} from '../shared/constants.js';
import { createState, step, touching, packState } from '../shared/physics.js';
import { History } from './history.js';
import { botKeys } from './bot.js';

const BOT_NAMES = ['Ada (bot)', 'Linus (bot)', 'Grace (bot)', 'Alan (bot)'];
// Inputs a player may apply per tick, accrued at 1/tick. Absorbs jitter bursts
// while stopping a modified client from moving faster by sending extra inputs.
const MAX_CREDITS = 8;
const MAX_QUEUE = 30;
const CLAIM_TTL = 20; // ticks a lag-comp claim may wait for its inputs to arrive

export class Room {
  constructor(id, startTick) {
    this.id = id;
    this.tick = startTick;
    this.players = new Map();
    this.nextId = 1;
    this.history = new History(1000);
    this.round = 0;
    this.it = null;
    this.fillBots();
    this.startRound();
  }

  get time() {
    return this.tick * TICK_MS;
  }

  humans() {
    return [...this.players.values()].filter((p) => !p.bot);
  }

  isFull() {
    return this.humans().length >= MAX_PLAYERS;
  }

  makePlayer(name, client) {
    const used = new Set([...this.players.values()].map((p) => p.slot));
    const slot = [0, 1, 2, 3].find((s) => !used.has(s));
    const sp = SPAWNS[slot];
    const p = {
      id: this.nextId++,
      slot,
      name,
      color: COLORS[slot],
      bot: !client,
      client,
      state: createState(sp.x, sp.y),
      queue: [],
      lastSeq: 0,
      ack: 0,
      credits: MAX_CREDITS,
      itTicks: 0,
      immuneUntil: 0,
      lagComp: true,
      claims: [],
    };
    this.players.set(p.id, p);
    return p;
  }

  fillBots() {
    while (this.players.size < MAX_PLAYERS) {
      const used = new Set([...this.players.values()].map((p) => p.name));
      this.makePlayer(BOT_NAMES.find((n) => !used.has(n)), null);
    }
  }

  addHuman(client, name) {
    if (this.isFull()) return null;
    const bots = [...this.players.values()].filter((p) => p.bot);
    const victim = bots.find((b) => b.id !== this.it) ?? bots[0];
    const wasIt = victim && victim.id === this.it;
    const slotState = victim?.state;
    if (victim) this.players.delete(victim.id);
    const p = this.makePlayer(name, client);
    if (slotState) Object.assign(p.state, slotState);
    if (wasIt) this.it = p.id;
    p.itTicks = victim?.itTicks ?? 0;
    this.broadcastRoster();
    return p;
  }

  removeHuman(id) {
    const p = this.players.get(id);
    if (!p) return;
    this.players.delete(id);
    this.fillBots();
    if (this.it === id) this.it = this.randomPlayerId();
    this.broadcastRoster();
  }

  randomPlayerId() {
    const ids = [...this.players.keys()];
    return ids[Math.floor(Math.random() * ids.length)];
  }

  // ---- network input -------------------------------------------------------

  onInputs(p, list) {
    if (!Array.isArray(list)) return;
    // Packets are unordered and carry redundant copies of unacked inputs;
    // keep only what's new, in order. Gaps (all copies lost) are skipped.
    const fresh = list
      .slice(-32)
      .filter((e) => Array.isArray(e) && Number.isInteger(e[0]) && Number.isInteger(e[1]) && e[0] > p.lastSeq)
      .sort((a, b) => a[0] - b[0]);
    for (const [seq, k] of fresh) {
      p.queue.push([seq, k & 31]);
      p.lastSeq = seq;
    }
    if (p.queue.length > MAX_QUEUE) p.queue.splice(0, p.queue.length - MAX_QUEUE);
  }

  onClaim(p, msg) {
    if (p.id !== this.it || !p.lagComp || this.phase !== 'play') return;
    if (!Number.isInteger(msg.id) || typeof msg.rt !== 'number' || !Number.isInteger(msg.seq)) return;
    if (p.claims.length > 8) return;
    p.claims.push({ target: msg.id, rt: msg.rt, seq: msg.seq, expires: this.tick + CLAIM_TTL });
  }

  setLagComp(p, on) {
    p.lagComp = !!on;
    if (!on) p.claims.length = 0;
  }

  // ---- simulation ----------------------------------------------------------

  update() {
    this.tick++;
    for (const p of this.players.values()) {
      const isIt = p.id === this.it;
      if (p.bot) {
        step(p.state, botKeys(p, this), isIt);
        continue;
      }
      p.credits = Math.min(MAX_CREDITS, p.credits + 1);
      while (p.queue.length && p.credits > 0) {
        const [seq, k] = p.queue.shift();
        step(p.state, k, isIt);
        p.ack = seq;
        p.credits--;
      }
    }

    if (this.phase === 'play') {
      const itP = this.players.get(this.it);
      if (itP) {
        itP.itTicks++;
        this.processClaims(itP) || this.contactTags(itP);
      }
      if (--this.phaseTicks <= 0) this.endRound();
    } else if (--this.phaseTicks <= 0) {
      this.startRound();
    }

    const positions = new Map();
    for (const p of this.players.values()) positions.set(p.id, { x: p.state.x, y: p.state.y });
    this.history.push(this.time, positions);

    if (this.tick % SNAPSHOT_EVERY === 0) this.sendSnapshot();
  }

  canTag(itP, target) {
    return target && target !== itP && itP.state.frz === 0 && target.immuneUntil <= this.tick;
  }

  // Lag compensation: the tagger saw everyone else ~(RTT/2 + interp delay) in
  // the past. Rewind the target to the time the tagger was rendering and
  // check the hit there ("favour the shooter"), bounded by MAX_REWIND_MS.
  processClaims(itP) {
    const keep = [];
    for (const c of itP.claims) {
      // Wait until the inputs the client had applied when it claimed are in,
      // so the tagger's own position matches what it predicted.
      if (itP.ack < c.seq && this.tick < c.expires) { keep.push(c); continue; }
      const target = this.players.get(c.target);
      if (!this.canTag(itP, target)) continue;
      const rewindMs = Math.max(0, Math.min(MAX_REWIND_MS, this.time - c.rt));
      const past = this.history.sample(target.id, this.time - rewindMs);
      if (past && touching(itP.state, past, TAG_SLOP)) {
        this.doTag(itP, target, { x: past.x, y: past.y, rewindMs: Math.round(rewindMs) });
        return true;
      }
    }
    itP.claims = keep;
    return false;
  }

  contactTags(itP) {
    for (const p of this.players.values()) {
      if (this.canTag(itP, p) && touching(itP.state, p.state)) {
        this.doTag(itP, p, null);
        return true;
      }
    }
    return false;
  }

  doTag(from, to, comp) {
    to.state.frz = FREEZE_TICKS;
    to.state.dash = 0;
    from.immuneUntil = this.tick + IMMUNE_TICKS;
    from.claims = [];
    this.it = to.id;
    this.broadcast('event', {
      type: 'tag', from: from.id, to: to.id, comp,
      at: { x: (from.state.x + to.state.x) / 2, y: (from.state.y + to.state.y) / 2 },
    });
  }

  startRound() {
    this.round++;
    this.phase = 'play';
    this.phaseTicks = ROUND_TICKS;
    const order = [...this.players.values()].sort(() => Math.random() - 0.5);
    order.forEach((p) => {
      const sp = SPAWNS[p.slot];
      Object.assign(p.state, createState(sp.x, sp.y));
      p.itTicks = 0;
      p.immuneUntil = 0;
      p.claims = [];
    });
    const it = order[0];
    this.it = it.id;
    it.state.frz = FREEZE_TICKS * 1.5; // head start for everyone else
    this.broadcast('event', { type: 'round-start', round: this.round, it: it.id });
  }

  endRound() {
    this.phase = 'end';
    this.phaseTicks = INTERMISSION_TICKS;
    const ranking = [...this.players.values()]
      .sort((a, b) => a.itTicks - b.itTicks)
      .map((p) => ({ id: p.id, name: p.name, color: p.color, secs: +(p.itTicks / 60).toFixed(1) }));
    this.broadcast('event', { type: 'round-end', ranking });
  }

  // ---- output ----------------------------------------------------------------

  sendSnapshot() {
    const msg = {
      t: 's',
      k: this.tick,
      ts: this.time,
      it: this.it,
      ph: this.phase === 'play' ? 0 : 1,
      left: this.phaseTicks,
      p: [...this.players.values()].map((p) => [
        p.id, ...packState(p.state), p.ack, p.itTicks, p.immuneUntil > this.tick ? 1 : 0,
      ]),
    };
    const str = JSON.stringify(msg);
    for (const p of this.players.values()) if (p.client) p.client.sendU(msg, str);
  }

  roster() {
    return [...this.players.values()].map((p) => ({ id: p.id, name: p.name, color: p.color, bot: p.bot }));
  }

  broadcastRoster() {
    this.broadcast('roster', this.roster());
  }

  broadcast(ev, data) {
    for (const p of this.players.values()) if (p.client) p.client.emit(ev, data);
  }
}
