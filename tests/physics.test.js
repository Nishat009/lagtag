import test from 'node:test';
import assert from 'node:assert/strict';
import { createState, step, cloneState } from '../shared/physics.js';
import { RADIUS, WORLD_W, WORLD_H, OBSTACLES, K_RIGHT, K_DASH, K_DOWN, DASH_COOLDOWN } from '../shared/constants.js';

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
