// Simple steering bots so a lone visitor always has a full 4-player match.
// Bots produce the same input bitmask a human would and run through the
// same physics step; they just skip the network.
import { OBSTACLES, RADIUS, WORLD_W, WORLD_H, K_UP, K_DOWN, K_LEFT, K_RIGHT, K_DASH } from '../shared/constants.js';

const THINK_EVERY = 6; // ticks: gives bots a human-ish reaction time

export function botKeys(bot, room) {
  if (room.tick % THINK_EVERY !== bot.id % THINK_EVERY && bot.lastKeys !== undefined) {
    return bot.lastKeys & ~K_DASH;
  }
  const me = bot.state;
  const itP = room.players.get(room.it);
  let dx = 0;
  let dy = 0;
  let dash = false;

  if (bot.id === room.it) {
    let best = null;
    let bestD = Infinity;
    for (const p of room.players.values()) {
      if (p === bot || p.immuneUntil > room.tick) continue;
      const d = Math.hypot(p.state.x - me.x, p.state.y - me.y);
      if (d < bestD) { bestD = d; best = p; }
    }
    if (best) {
      // Lead the target a little.
      dx = best.state.x + best.state.vx * 0.2 - me.x;
      dy = best.state.y + best.state.vy * 0.2 - me.y;
      dash = bestD < 170 && Math.random() < 0.35;
    } else {
      wander(bot);
      dx = Math.cos(bot.wander);
      dy = Math.sin(bot.wander);
    }
  } else if (itP) {
    const ax = me.x - itP.state.x;
    const ay = me.y - itP.state.y;
    const d = Math.hypot(ax, ay) || 1;
    if (d < 420) {
      // Flee, with a sideways component so bots circle instead of cornering themselves.
      const side = bot.id % 2 ? 1 : -1;
      dx = ax / d + (-ay / d) * 0.6 * side;
      dy = ay / d + (ax / d) * 0.6 * side;
      dash = d < 110 && Math.random() < 0.3;
    } else {
      // Safe for now: grab a nearby power-up, else wander.
      const u = nearestPickup(me, room, 380);
      if (u) {
        dx = u.x - me.x;
        dy = u.y - me.y;
      } else {
        wander(bot);
        dx = Math.cos(bot.wander);
        dy = Math.sin(bot.wander);
      }
    }
    // Wall repulsion.
    const m = 140;
    if (me.x < m) dx += (m - me.x) / m * 1.5;
    if (me.x > WORLD_W - m) dx -= (me.x - (WORLD_W - m)) / m * 1.5;
    if (me.y < m) dy += (m - me.y) / m * 1.5;
    if (me.y > WORLD_H - m) dy -= (me.y - (WORLD_H - m)) / m * 1.5;
  }

  [dx, dy] = avoidObstacles(me, dx, dy);
  // Aim error.
  const ang = Math.atan2(dy, dx) + (Math.random() - 0.5) * 0.5;
  let keys = toKeys(ang, Math.hypot(dx, dy) > 0.05);
  if (dash) keys |= K_DASH;
  bot.lastKeys = keys;
  return keys;
}

function nearestPickup(me, room, maxD) {
  let best = null;
  for (const u of room.pickups ?? []) {
    const d = Math.hypot(u.x - me.x, u.y - me.y);
    if (d < maxD) { maxD = d; best = u; }
  }
  return best;
}

function wander(bot) {
  bot.wander = (bot.wander ?? Math.random() * Math.PI * 2) + (Math.random() - 0.5) * 0.8;
}

function blocked(x, y) {
  const pad = RADIUS + 6;
  if (x < pad || y < pad || x > WORLD_W - pad || y > WORLD_H - pad) return true;
  return OBSTACLES.some((r) => x > r.x - pad && x < r.x + r.w + pad && y > r.y - pad && y < r.y + r.h + pad);
}

function avoidObstacles(me, dx, dy) {
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return [dx, dy];
  const base = Math.atan2(dy, dx);
  for (const off of [0, 0.5, -0.5, 1, -1, 1.6, -1.6]) {
    const a = base + off;
    if (!blocked(me.x + Math.cos(a) * 55, me.y + Math.sin(a) * 55)) return [Math.cos(a), Math.sin(a)];
  }
  return [dx, dy];
}

function toKeys(angle, moving) {
  if (!moving) return 0;
  const oct = ((Math.round(angle / (Math.PI / 4)) % 8) + 8) % 8;
  return [K_RIGHT, K_RIGHT | K_DOWN, K_DOWN, K_DOWN | K_LEFT, K_LEFT, K_LEFT | K_UP, K_UP, K_UP | K_RIGHT][oct];
}
