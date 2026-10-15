import test from 'node:test';
import assert from 'node:assert/strict';
import { createState, step } from '../shared/physics.js';
import { K_RIGHT, K_DOWN, K_DASH, TICK_MS, SNAPSHOT_EVERY } from '../shared/constants.js';
import { Predictor } from '../client/prediction.js';
import { Interpolator } from '../client/interpolation.js';
import { History } from '../server/history.js';
import { Room } from '../server/room.js';

const ON = { predict: true, reconcile: true };

// Simulate a client whose inputs reach the server `lagTicks` later.
function runPrediction(opts, lagTicks = 9) {
  const pred = new Predictor();
  const server = createState(100, 300);
  pred.onServerState(server, 0, false, opts);
  const sent = [];
  let ack = 0;
  let maxErr = 0;
  for (let t = 1; t <= 300; t++) {
    const keys = t % 90 < 45 ? K_RIGHT : K_DOWN | (t % 70 === 0 ? K_DASH : 0);
    sent.push({ at: t + lagTicks, input: pred.local(keys, false, opts.predict) });
    while (sent.length && sent[0].at <= t) {
      const [seq, k] = sent.shift().input;
      step(server, k, false);
      ack = seq;
    }
    if (t % SNAPSHOT_EVERY === 0) {
      pred.onServerState(server, ack, false, opts);
      maxErr = Math.max(maxErr, pred.lastError);
    }
  }
  return { pred, maxErr };
}

test('prediction + reconciliation: zero correction on a clean network', () => {
  const { maxErr, pred } = runPrediction(ON);
  assert.equal(maxErr, 0);
  assert.equal(pred.pending.length, 9, 'only in-flight inputs stay pending');
});

test('prediction without reconciliation rubber-bands', () => {
  const { maxErr } = runPrediction({ predict: true, reconcile: false });
  assert.ok(maxErr > 20, `expected visible snap-back, got ${maxErr}`);
});

test('reconciliation corrects a server-side intervention (freeze)', () => {
  const pred = new Predictor();
  const server = createState(100, 300);
  pred.onServerState(server, 0, false, ON);
  for (let i = 0; i < 5; i++) pred.local(K_RIGHT, false, true);
  // Server applied 2 inputs, then got frozen by a tag before the other 3.
  step(server, K_RIGHT, false);
  step(server, K_RIGHT, false);
  server.frz = 60;
  pred.onServerState(server, 2, false, ON);
  assert.equal(pred.state.x, server.x, 'replayed inputs respect the freeze');
  assert.ok(pred.lastError > 0);
});

test('interpolation blends between bracketing snapshots, tolerating reordering', () => {
  const it = new Interpolator();
  const snap = (x) => new Map([[1, { x, y: 0, vx: 0, vy: 0, frz: 0, dash: 0 }]]);
  it.push(100, snap(0));
  it.push(200, snap(100)); // arrives before 150
  it.push(150, snap(50));
  assert.equal(it.sample(1, 125).x, 25);
  assert.equal(it.sample(1, 175).x, 75);
  assert.equal(it.aheadMs(150), 50);
});

test('interpolation extrapolates briefly when starved', () => {
  const it = new Interpolator();
  it.push(100, new Map([[1, { x: 0, y: 0, vx: 100, vy: 0 }]]));
  it.push(150, new Map([[1, { x: 5, y: 0, vx: 100, vy: 0 }]]));
  const s = it.sample(1, 1000);
  assert.ok(s.extrapolated);
  assert.equal(s.x, 5 + 100 * 0.12, 'capped at 120 ms of dead reckoning');
});

test('history rewinds positions between ticks', () => {
  const h = new History(1000);
  h.push(0, new Map([[1, { x: 0, y: 0 }]]));
  h.push(100, new Map([[1, { x: 100, y: 50 }]]));
  assert.deepEqual(h.sample(1, 25), { x: 25, y: 12.5 });
});

// ---- server-side lag compensation -----------------------------------------------

function roomWithHuman() {
  const room = new Room('t', 0);
  const human = room.addHuman({ sendU() {}, emit() {} }, 'Tester');
  const target = [...room.players.values()].find((p) => p.bot);
  room.it = human.id;
  for (const p of room.players.values()) p.bot = false; // freeze bots: we drive positions
  human.state.frz = 0;
  return { room, human, target };
}

function moveTargetAway(room, human, target) {
  // Target overlapped the tagger ~150-300 ms ago (frz blocks a present-time
  // contact tag during that window), then moved 80px away.
  human.state.x = 600; human.state.y = 250;
  target.state.x = 640; target.state.y = 250;
  human.state.frz = 1;
  for (let i = 0; i < 9; i++) room.update();
  target.state.x = 720;
  human.state.frz = 0;
  for (let i = 0; i < 9; i++) room.update();
}

test('lag compensation accepts a tag that was valid on the tagger\'s screen', () => {
  const { room, human, target } = roomWithHuman();
  const sawAt = room.time;
  moveTargetAway(room, human, target);
  assert.equal(room.it, human.id, 'no contact in the present');
  room.onClaim(human, { id: target.id, rt: sawAt + TICK_MS * 4, seq: 0 });
  room.update();
  assert.equal(room.it, target.id);
});

test('lag compensation can be switched off per player', () => {
  const { room, human, target } = roomWithHuman();
  const sawAt = room.time;
  moveTargetAway(room, human, target);
  room.setLagComp(human, false);
  room.onClaim(human, { id: target.id, rt: sawAt + TICK_MS * 4, seq: 0 });
  room.update();
  assert.equal(room.it, human.id);
});

test('lag compensation rejects claims that miss even in the past', () => {
  const { room, human, target } = roomWithHuman();
  human.state.x = 300; human.state.y = 650;
  target.state.x = 900; target.state.y = 650;
  for (let i = 0; i < 12; i++) room.update();
  room.onClaim(human, { id: target.id, rt: room.time - 100, seq: 0 });
  room.update();
  assert.equal(room.it, human.id);
});
