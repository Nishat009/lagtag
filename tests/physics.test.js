import test from 'node:test';
import assert from 'node:assert/strict';
import { createState, step, cloneState } from '../shared/physics.js';
import {
  RADIUS, WORLD_W, WORLD_H, OBSTACLES, K_RIGHT, K_DASH, K_DOWN, DASH_COOLDOWN, PW_SPEED, PW_GHOST, SPEED_TICKS,
} from '../shared/constants.js';

function rng(seed) {
  return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

test('step is deterministic (prediction relies on this)', () => {
  const rand = rng(42);
  const inputs = Array.from({ length: 2000 }, () => Math.floor(rand() * 32));
  const a = createState(100, 100);
  const b = createState(100, 100);
  inputs.forEach((k, i) => step(a, k, i % 300 < 150));
  inputs.forEach((k, i) => step(b, k, i % 300 < 150));
  assert.deepEqual(a, b);
});

test('players never leave the arena or end up inside obstacles', () => {
  const rand = rng(7);
  const s = createState(90, 90);
  for (let i = 0; i < 20000; i++) {
    if (i % 20 === 0) s._k = Math.floor(rand() * 32);
    step(s, s._k, false);
    assert.ok(s.x >= RADIUS && s.x <= WORLD_W - RADIUS && s.y >= RADIUS && s.y <= WORLD_H - RADIUS);
    for (const r of OBSTACLES) {
      const cx = Math.max(r.x, Math.min(s.x, r.x + r.w));
      const cy = Math.max(r.y, Math.min(s.y, r.y + r.h));
      assert.ok(Math.hypot(s.x - cx, s.y - cy) >= RADIUS - 0.02, `overlaps obstacle at ${s.x},${s.y}`);
    }
  }
});

test('dash has a cooldown', () => {
  const s = createState(640, 250);
  step(s, K_RIGHT | K_DASH, false);
  assert.ok(s.dash > 0);
  assert.equal(s.cd, DASH_COOLDOWN);
  const x = cloneState(s);
  for (let i = 0; i < 20; i++) step(s, K_DOWN | K_DASH, false);
  assert.ok(s.cd > 0 && s.dx === x.dx, 'second dash must wait for cooldown');
});

test('frozen players do not move', () => {
  const s = createState(400, 400);
  s.frz = 10;
  for (let i = 0; i < 10; i++) step(s, K_RIGHT, false);
  assert.equal(s.x, 400);
  step(s, K_RIGHT, false);
  assert.ok(s.x > 400);
});

test('speed power-up makes you faster, then wears off', () => {
  const plain = createState(100, 450);
  const fast = createState(100, 450);
  fast.pw = PW_SPEED;
  fast.pt = SPEED_TICKS;
  for (let i = 0; i < 60; i++) { step(plain, K_RIGHT, false); step(fast, K_RIGHT, false); }
  assert.ok(fast.x - 100 > (plain.x - 100) * 1.3, `boosted ${fast.x} vs ${plain.x}`);
  for (let i = 0; i < SPEED_TICKS; i++) step(fast, 0, false);
  assert.equal(fast.pw, 0);
  assert.equal(fast.pt, 0);
});

test('ghost walks through obstacles and is pushed out when it wears off', () => {
  const wall = OBSTACLES[0]; // tall pillar
  const y = wall.y + wall.h / 2;
  const solid = createState(wall.x - 60, y);
  const ghost = createState(wall.x - 60, y);
  ghost.pw = PW_GHOST;
  ghost.pt = 40;
  for (let i = 0; i < 25; i++) { step(solid, K_RIGHT, false); step(ghost, K_RIGHT, false); }
  assert.ok(solid.x <= wall.x - RADIUS + 0.01, 'solid player stops at the wall');
  assert.ok(ghost.x > wall.x, 'ghost is inside or past the wall');
  for (let i = 0; i < 40; i++) step(ghost, 0, false);
  const cx = Math.max(wall.x, Math.min(ghost.x, wall.x + wall.w));
  const cy = Math.max(wall.y, Math.min(ghost.y, wall.y + wall.h));
  assert.ok(Math.hypot(ghost.x - cx, ghost.y - cy) >= RADIUS - 0.02, 'not left inside the wall');
});
