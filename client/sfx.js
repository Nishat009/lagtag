// Tiny synthesised sound effects (Web Audio, no asset files). The context is
// created on the first user gesture, as browsers require.
let ctx = null;
let master = null;
let muted = false;
try { muted = localStorage.getItem('lagtag-muted') === '1'; } catch { /* private mode */ }

export function unlock() {
  if (ctx) return;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = muted ? 0 : 0.5;
  master.connect(ctx.destination);
}

export function isMuted() {
  return muted;
}

export function toggleMute() {
  muted = !muted;
  try { localStorage.setItem('lagtag-muted', muted ? '1' : '0'); } catch { /* private mode */ }
  if (master) master.gain.value = muted ? 0 : 0.5;
  return muted;
}

function tone(freq, dur, { type = 'sine', vol = 0.3, to = null, at = 0 } = {}) {
  if (!ctx || muted) return;
  const t = ctx.currentTime + at;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (to) osc.frequency.exponentialRampToValueAtTime(to, t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  osc.connect(g).connect(master);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

function noise(dur, { vol = 0.3, freq = 1200, to = null, q = 1, type = 'bandpass', at = 0 } = {}) {
  if (!ctx || muted) return;
  const t = ctx.currentTime + at;
  const len = Math.ceil(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.Q.value = q;
  f.frequency.setValueAtTime(freq, t);
  if (to) f.frequency.exponentialRampToValueAtTime(to, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(f).connect(g).connect(master);
  src.start(t);
}

export const sfx = {
  tag() {
    tone(660, 0.12, { type: 'square', vol: 0.18, to: 330 });
    noise(0.12, { vol: 0.2, freq: 2500 });
  },
  tagged() {
    tone(300, 0.35, { type: 'sawtooth', vol: 0.2, to: 90 });
  },
  dash() {
    noise(0.22, { vol: 0.25, freq: 600, to: 3000, q: 2 });
  },
  pickup() {
    [660, 880, 1320].forEach((f, i) => tone(f, 0.12, { type: 'triangle', vol: 0.22, at: i * 0.06 }));
  },
  pickupFar() {
    tone(990, 0.1, { type: 'triangle', vol: 0.08 });
  },
  shield() {
    tone(1400, 0.25, { type: 'triangle', vol: 0.25, to: 500 });
    noise(0.25, { vol: 0.2, freq: 5000, type: 'highpass' });
  },
  boom() {
    noise(0.8, { vol: 0.6, freq: 1200, to: 60, type: 'lowpass' });
    tone(110, 0.6, { type: 'sine', vol: 0.5, to: 35 });
  },
  tick(urgent) {
    tone(urgent ? 1500 : 1100, 0.04, { type: 'square', vol: 0.12 });
  },
  alarm() {
    for (let i = 0; i < 3; i++) {
      tone(880, 0.12, { type: 'square', vol: 0.15, at: i * 0.26 });
      tone(660, 0.12, { type: 'square', vol: 0.15, at: i * 0.26 + 0.13 });
    }
  },
  countdown(last) {
    tone(last ? 1320 : 880, last ? 0.4 : 0.12, { type: 'sine', vol: 0.25 });
  },
  fanfare() {
    [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.22, { type: 'triangle', vol: 0.22, at: i * 0.11 }));
  },
};
