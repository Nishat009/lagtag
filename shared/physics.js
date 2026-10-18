// Deterministic movement step. Runs on the server (authoritative) and on the
// client (prediction + reconciliation replay). Pure: same input -> same output.
import {
  DT, RADIUS, WORLD_W, WORLD_H, OBSTACLES, MAX_SPEED, IT_SPEED_MUL, ACCEL,
  DASH_SPEED, DASH_TICKS, DASH_COOLDOWN, K_UP, K_DOWN, K_LEFT, K_RIGHT, K_DASH,
  PW_SPEED, PW_GHOST, SPEED_BOOST_MUL,
} from './constants.js';

const q2 = (v) => Math.round(v * 100) / 100;
const q3 = (v) => Math.round(v * 1000) / 1000;

export function createState(x, y) {
  // dash/cd/frz are tick counters, dx/dy the locked dash direction,
  // pw the active movement power-up and pt its ticks left
  return { x, y, vx: 0, vy: 0, dash: 0, cd: 0, dx: 0, dy: 0, frz: 0, pw: 0, pt: 0 };
}

export function cloneState(s) {
  return {
    x: s.x, y: s.y, vx: s.vx, vy: s.vy, dash: s.dash, cd: s.cd, dx: s.dx, dy: s.dy, frz: s.frz,
    pw: s.pw, pt: s.pt,
  };
}

export function step(s, keys, isIt) {
  if (s.cd > 0) s.cd--;
  if (s.pt > 0 && --s.pt === 0) s.pw = 0;
  if (s.frz > 0) {
    s.frz--;
    s.vx = 0;
    s.vy = 0;
    return s;
  }

  let ix = (keys & K_RIGHT ? 1 : 0) - (keys & K_LEFT ? 1 : 0);
  let iy = (keys & K_DOWN ? 1 : 0) - (keys & K_UP ? 1 : 0);
  if (ix && iy) {
    ix *= Math.SQRT1_2;
    iy *= Math.SQRT1_2;
  }

  if (keys & K_DASH && s.cd === 0 && s.dash === 0 && (ix || iy)) {
    s.dash = DASH_TICKS;
    s.cd = DASH_COOLDOWN;
    s.dx = q3(ix);
    s.dy = q3(iy);
  }

  if (s.dash > 0) {
    s.vx = s.dx * DASH_SPEED;
    s.vy = s.dy * DASH_SPEED;
    s.dash--;
  } else {
    const max = MAX_SPEED * (isIt ? IT_SPEED_MUL : 1) * (s.pw === PW_SPEED ? SPEED_BOOST_MUL : 1);
    const a = Math.min(1, ACCEL * DT);
    s.vx += (ix * max - s.vx) * a;
    s.vy += (iy * max - s.vy) * a;
  }

  s.x += s.vx * DT;
  s.y += s.vy * DT;
  collideWorld(s, s.pw === PW_GHOST);
  // Quantise so the snapshot carries the *exact* server state: with a clean
  // network, client replay reproduces it bit-for-bit (zero correction).
  s.x = q2(s.x);
  s.y = q2(s.y);
  s.vx = q2(s.vx);
  s.vy = q2(s.vy);
  return s;
}

// A ghost passes through obstacles; when it wears off inside one, the
// centre-inside branch of collideRect pushes it out.
function collideWorld(s, ghost) {
  if (s.x < RADIUS) { s.x = RADIUS; if (s.vx < 0) s.vx = 0; }
  if (s.x > WORLD_W - RADIUS) { s.x = WORLD_W - RADIUS; if (s.vx > 0) s.vx = 0; }
  if (s.y < RADIUS) { s.y = RADIUS; if (s.vy < 0) s.vy = 0; }
  if (s.y > WORLD_H - RADIUS) { s.y = WORLD_H - RADIUS; if (s.vy > 0) s.vy = 0; }
  if (!ghost) for (const r of OBSTACLES) collideRect(s, r);
}

function collideRect(s, r) {
  const cx = Math.max(r.x, Math.min(s.x, r.x + r.w));
  const cy = Math.max(r.y, Math.min(s.y, r.y + r.h));
  const dx = s.x - cx;
  const dy = s.y - cy;
  const d2 = dx * dx + dy * dy;
  if (d2 >= RADIUS * RADIUS) return;

  let nx, ny;
  if (d2 > 1e-9) {
    const d = Math.sqrt(d2);
    nx = dx / d;
    ny = dy / d;
    s.x = cx + nx * RADIUS;
    s.y = cy + ny * RADIUS;
  } else {
    // Centre is inside the rect: push out along the shallowest axis.
    const pen = [s.x - r.x, r.x + r.w - s.x, s.y - r.y, r.y + r.h - s.y];
    const i = pen.indexOf(Math.min(...pen));
    nx = i === 0 ? -1 : i === 1 ? 1 : 0;
    ny = i === 2 ? -1 : i === 3 ? 1 : 0;
    if (i === 0) s.x = r.x - RADIUS;
    else if (i === 1) s.x = r.x + r.w + RADIUS;
    else if (i === 2) s.y = r.y - RADIUS;
    else s.y = r.y + r.h + RADIUS;
  }
  const vn = s.vx * nx + s.vy * ny;
  if (vn < 0) {
    s.vx -= vn * nx;
    s.vy -= vn * ny;
  }
}

export function touching(a, b, slop = 0) {
  const r = RADIUS * 2 + slop;
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy <= r * r;
}

// Snapshot wire format for a player's physics state (compact array).
export function packState(s) {
  return [s.x, s.y, s.vx, s.vy, s.dash, s.cd, s.dx, s.dy, s.frz, s.pw, s.pt];
}

export const PACKED_LEN = 11;

export function unpackState(a, o = 0) {
  return {
    x: a[o], y: a[o + 1], vx: a[o + 2], vy: a[o + 3], dash: a[o + 4], cd: a[o + 5], dx: a[o + 6], dy: a[o + 7], frz: a[o + 8],
    pw: a[o + 9], pt: a[o + 10],
  };
}
