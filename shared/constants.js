// Shared between server and browser. Anything that affects the simulation
// must live here so client-side prediction replays exactly what the server runs.

export const TICK_RATE = 60;
export const DT = 1 / TICK_RATE;
export const TICK_MS = 1000 / TICK_RATE;
export const SNAPSHOT_EVERY = 3; // ticks -> 20 Hz snapshots

export const WORLD_W = 1280;
export const WORLD_H = 720;
export const RADIUS = 22;

export const MAX_SPEED = 290; // px/s
export const IT_SPEED_MUL = 1.1; // "it" is slightly faster so chases resolve
export const ACCEL = 12; // velocity smoothing factor (1/s)
export const DASH_SPEED = 860;
export const DASH_TICKS = 9;
export const DASH_COOLDOWN = 75;
export const FREEZE_TICKS = 60; // newly tagged player is frozen for 1s
export const IMMUNE_TICKS = 120; // previous "it" can't be tagged straight back

export const MAX_PLAYERS = 4;
export const ROUND_TICKS = 90 * TICK_RATE;
export const INTERMISSION_TICKS = 5 * TICK_RATE;

export const DEFAULT_INTERP_MS = 100;
export const MAX_REWIND_MS = 500; // covers ~400 ms RTT + 100 ms interpolation
export const TAG_SLOP = 4; // px of tolerance on lag-compensated tags

// Input bitmask
export const K_UP = 1;
export const K_DOWN = 2;
export const K_LEFT = 4;
export const K_RIGHT = 8;
export const K_DASH = 16;

export const OBSTACLES = [
  { x: 250, y: 140, w: 50, h: 190 },
  { x: 980, y: 390, w: 50, h: 190 },
  { x: 560, y: 330, w: 160, h: 50 },
  { x: 150, y: 540, w: 220, h: 40 },
  { x: 910, y: 140, w: 220, h: 40 },
  { x: 610, y: 90, w: 60, h: 60 },
  { x: 610, y: 570, w: 60, h: 60 },
];

export const SPAWNS = [
  { x: 90, y: 90 },
  { x: WORLD_W - 90, y: WORLD_H - 90 },
  { x: WORLD_W - 90, y: 90 },
  { x: 90, y: WORLD_H - 90 },
];

export const COLORS = ['#4cc9f0', '#f72585', '#b5e48c', '#ffb703'];
