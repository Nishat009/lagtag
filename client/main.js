import { TICK_MS, SNAPSHOT_EVERY, DEFAULT_INTERP_MS, TICK_RATE } from '../shared/constants.js';
import { unpackState, touching } from '../shared/physics.js';
import { NetSim } from './netsim.js';
import { Net } from './net.js';
import { ServerClock } from './clock.js';
import { Predictor } from './prediction.js';
import { Interpolator } from './interpolation.js';
import { Renderer } from './render.js';
import { Input } from './input.js';

const $ = (s) => document.querySelector(s);
const REDUNDANCY = 12; // each input rides in this many consecutive packets

const sim = new NetSim();
const net = new Net(sim);
const clock = new ServerClock();
const pred = new Predictor();
const interp = new Interpolator();
const renderer = new Renderer($('#game'));
const input = new Input({ stick: $('#stick'), knob: $('#knob'), dashBtn: $('#dash-btn') });

const settings = {
  predict: true,
  reconcile: true,
  interp: true,
  lagComp: true,
  ghosts: false,
  interpDelay: DEFAULT_INTERP_MS,
};

const game = {
  myId: null,
  roomId: null,
  roster: new Map(),
  it: null,
  phase: 0,
  left: 0,
  lastK: -1,
  latest: null,
  latestTs: 0,
};

const stats = {
  recv: 0, late: 0, seen: new Set(), lossFrom: null, lossEma: 0,
  bytesIn: 0, bytesOut: 0, lastAt: performance.now(),
};
const lastClaim = new Map();
window.__lagtag = { game, settings, pred, net, sim, clock, stats };

// ---- network handlers --------------------------------------------------------

net.on('u', (msg) => {
  if (msg.t === 's') onSnapshot(msg);
  else if (msg.t === 'o') clock.addPong(msg.c);
});

net.on('roster', (list) => {
  game.roster = new Map(list.map((p) => [p.id, p]));
});

net.on('event', onEvent);
net.on('disconnect', () => toast('Disconnected from server — reload to rejoin', 'bad', 60000));

function onSnapshot(msg) {
  const players = new Map();
  for (const a of msg.p) {
    players.set(a[0], { ...unpackState(a, 1), ack: a[10], itTicks: a[11], imm: a[12] });
  }
  interp.push(msg.ts, players);
  clock.addSnapshot(msg.ts);
  stats.recv++;
  stats.seen.add(msg.k);
  stats.lossFrom ??= msg.k;
  if (msg.k <= game.lastK) {
    // Overtaken by a newer snapshot (jitter reordering). Too old to drive
    // reconciliation, but still useful for interpolation.
    stats.late++;
    return;
  }

  game.lastK = msg.k;
  game.latest = players;
  game.latestTs = msg.ts;
  game.it = msg.it;
  game.phase = msg.ph;
  game.left = msg.left;

  const me = players.get(game.myId);
  if (me) pred.onServerState(me, me.ack, msg.it === game.myId, settings);
}

function onEvent(e) {
  const name = (id) => (id === game.myId ? 'You' : game.roster.get(id)?.name ?? '???');
  if (e.type === 'tag') {
    renderer.addEffect({ type: 'ring', x: e.at.x, y: e.at.y, color: '#ff3b5c', life: 600 });
    if (e.comp) {
      renderer.addEffect({ type: 'rewind', x: e.comp.x, y: e.comp.y, label: `rewound ${e.comp.rewindMs} ms`, life: 1600 });
      logLine(`⏪ ${name(e.from)} → ${name(e.to)}: lag-compensated hit, target rewound ${e.comp.rewindMs} ms`);
    } else {
      logLine(`● ${name(e.from)} → ${name(e.to)}: direct contact on server`);
    }
    if (e.to === game.myId) {
      renderer.kick(16);
      toast("You're IT! Frozen for 1s, then go get them", 'bad');
    } else if (e.from === game.myId) {
      toast(`Tagged ${name(e.to)}!${e.comp ? ` (server rewound ${e.comp.rewindMs} ms)` : ''}`, 'good');
    }
  } else if (e.type === 'round-start') {
    $('#round-end').hidden = true;
    toast(`Round ${e.round}: ${name(e.it)} ${e.it === game.myId ? 'are' : 'is'} IT`);
  } else if (e.type === 'round-end') {
    const list = $('#ranking');
    list.replaceChildren(
      ...e.ranking.map((r, i) => {
        const li = document.createElement('li');
        li.innerHTML = `<span class="dot"></span><span class="nm"></span><span class="sec"></span>`;
        li.querySelector('.dot').style.background = r.color;
        li.querySelector('.nm').textContent = (i === 0 ? '🏆 ' : '') + (r.id === game.myId ? `${r.name} (you)` : r.name);
        li.querySelector('.sec').textContent = `${r.secs.toFixed(1)}s as IT`;
        return li;
      }),
    );
    $('#round-end').hidden = false;
  }
}

// ---- fixed-step simulation -----------------------------------------------------

let last = performance.now();
let acc = 0;

function frame(now) {
  const dt = Math.min(now - last, 250);
  last = now;
  acc += dt;
  while (acc >= TICK_MS) {
    acc -= TICK_MS;
    fixedTick();
  }
  clock.update(dt);
  pred.decay(dt);
  draw(now);
  requestAnimationFrame(frame);
}

function fixedTick() {
  if (!game.latest) return;
  pred.local(input.read(), game.it === game.myId, settings.predict);
  net.sendU({ t: 'i', i: pred.pending.slice(-REDUNDANCY) });
}

// ---- rendering -------------------------------------------------------------------

function draw(now) {
  if (!game.latest) return;
  const renderTime = clock.serverNow() - settings.interpDelay;
  const players = [];
  const ghosts = [];

  for (const [id, snap] of game.latest) {
    const info = game.roster.get(id) ?? { name: '…', color: '#888' };
    const isMe = id === game.myId;
    let pos;
    if (isMe) pos = pred.state ? { ...pred.renderPos(), frz: pred.state.frz, dash: pred.state.dash } : snap;
    else if (settings.interp) pos = interp.sample(id, renderTime) ?? snap;
    else pos = snap;

    players.push({
      id, isMe, name: info.name, color: info.color,
      x: pos.x, y: pos.y, frz: pos.frz, dash: pos.dash,
      isIt: id === game.it, immune: snap.imm === 1,
    });

    if (settings.ghosts) {
      if (isMe) ghosts.push({ x: snap.x, y: snap.y, color: '#ffffff', kind: 'server', label: 'server' });
      else ghosts.push({ x: snap.x, y: snap.y, color: info.color, kind: 'raw' });
    }
  }
  players.sort((a, b) => a.isMe - b.isMe);

  const itColor = game.it === game.myId ? '#ff3b5c' : null;
  renderer.draw({ players, ghosts, itColor });
  maybeClaimTag(settings.interp ? renderTime : game.latestTs, players, now);
  updateHud(now);
}

// When I'm IT and *my screen* shows contact, tell the server what time I was
// looking at. The server rewinds the target to that time to validate.
function maybeClaimTag(viewTime, players, now) {
  if (!settings.lagComp || game.it !== game.myId || game.phase !== 0) return;
  const me = pred.state;
  if (!me || me.frz > 0) return;
  for (const p of players) {
    if (p.isMe || p.immune || !touching(me, p)) continue;
    if (now - (lastClaim.get(p.id) ?? 0) < 80) continue;
    lastClaim.set(p.id, now);
    net.sendU({ t: 'g', id: p.id, rt: viewTime, seq: pred.seq });
  }
}

// ---- HUD --------------------------------------------------------------------------

let hudAt = 0;
function updateHud(now) {
  if (now - hudAt < 100) return;
  hudAt = now;

  const secs = Math.max(0, Math.ceil(game.left / TICK_RATE));
  $('#timer').textContent = game.phase === 0 ? `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}` : 'next round…';

  const amIt = game.it === game.myId;
  const banner = $('#it-banner');
  banner.hidden = !amIt || game.phase !== 0;

  const rows = [...game.latest.entries()]
    .map(([id, s]) => ({ id, s, info: game.roster.get(id) }))
    .filter((r) => r.info)
    .sort((a, b) => a.s.itTicks - b.s.itTicks);
  const board = $('#scoreboard');
  board.replaceChildren(
    ...rows.map(({ id, s, info }) => {
      const li = document.createElement('li');
      if (id === game.myId) li.classList.add('me');
      if (id === game.it) li.classList.add('it');
      li.innerHTML = `<span class="dot"></span><span class="nm"></span><span class="sec"></span>`;
      li.querySelector('.dot').style.background = info.color;
      li.querySelector('.nm').textContent = info.name + (id === game.it ? '  · IT' : '');
      li.querySelector('.sec').textContent = (s.itTicks / TICK_RATE).toFixed(1) + 's';
      return li;
    }),
  );

  if (now - stats.lastAt >= 500) updateStats(now);
}

function updateStats(now) {
  const secs = (now - stats.lastAt) / 1000;
  // A snapshot tick counts as lost once it's 0.5 s old and never arrived.
  let expected = 0;
  let lost = 0;
  let k = stats.lossFrom;
  for (; k !== null && k <= game.lastK - 30; k += SNAPSHOT_EVERY) {
    expected++;
    if (!stats.seen.delete(k)) lost++;
  }
  if (expected) stats.lossFrom = k;
  if (expected) stats.lossEma = stats.lossEma * 0.85 + (lost / expected) * 0.15;
  const set = (id, v) => { $(id).textContent = v; };
  set('#st-transport', net.transport);
  set('#st-rtt', clock.rtts.length ? `${Math.round(clock.rtt)} ms` : '…');
  set('#st-snaps', `${Math.round(stats.recv / secs)} /s`);
  set('#st-loss', `${Math.round(stats.lossEma * 100)} % / ${stats.recv ? Math.round((stats.late / stats.recv) * 100) : 0} %`);
  set('#st-bw', `${((net.bytesIn - stats.bytesIn) / secs / 1024).toFixed(1)} ↓  ${((net.bytesOut - stats.bytesOut) / secs / 1024).toFixed(1)} ↑ kB/s`);
  set('#st-pending', `${pred.pending.length} inputs`);
  set('#st-error', `${pred.lastError.toFixed(1)} px`);
  const ahead = interp.aheadMs(clock.serverNow() - settings.interpDelay);
  set('#st-buffer', `${Math.round(ahead)} ms${ahead < 0 ? ' (extrapolating)' : ''}`);
  $('#st-buffer').classList.toggle('warn', ahead < 0);
  $('#st-transport').classList.toggle('good', net.usingRtc);
  Object.assign(stats, { recv: 0, late: 0, bytesIn: net.bytesIn, bytesOut: net.bytesOut, lastAt: now });
}

let toastTimer;
function toast(text, kind = '', ms = 2600) {
  const el = $('#toast');
  el.textContent = text;
  el.className = `show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = ''; }, ms);
}

function logLine(text) {
  const log = $('#lab-log');
  const li = document.createElement('li');
  li.textContent = text;
  log.prepend(li);
  while (log.children.length > 6) log.lastChild.remove();
}

// ---- Netcode Lab panel ------------------------------------------------------------

const PRESETS = {
  lan: { rtt: 0, jitter: 0, loss: 0 },
  mobile: { rtt: 120, jitter: 30, loss: 2 },
  wifi: { rtt: 180, jitter: 80, loss: 8 },
  world: { rtt: 350, jitter: 20, loss: 1 },
};

function bindLab() {
  for (const el of document.querySelectorAll('[data-setting]')) {
    el.checked = settings[el.dataset.setting];
    el.addEventListener('change', () => {
      settings[el.dataset.setting] = el.checked;
      if (el.dataset.setting === 'lagComp') net.sendR('settings', { lagComp: el.checked });
      if (el.dataset.setting === 'predict') $('#opt-reconcile').disabled = !el.checked;
    });
  }
  $('#opt-ws').addEventListener('change', (e) => net.setForceWs(e.target.checked));

  const sliders = {
    rtt: (v) => { sim.rttMs = v; return `${v} ms`; },
    jitter: (v) => { sim.jitterMs = v; return `±${v} ms`; },
    loss: (v) => { sim.loss = v / 100; return `${v} %`; },
    interp: (v) => { settings.interpDelay = v; return `${v} ms`; },
  };
  for (const [key, apply] of Object.entries(sliders)) {
    const el = $(`#sl-${key}`);
    const out = $(`#out-${key}`);
    const update = () => { out.textContent = apply(Number(el.value)); };
    el.addEventListener('input', update);
    update();
  }

  for (const btn of document.querySelectorAll('[data-preset]')) {
    btn.addEventListener('click', () => {
      const p = PRESETS[btn.dataset.preset];
      for (const k of ['rtt', 'jitter', 'loss']) {
        $(`#sl-${k}`).value = p[k];
        $(`#sl-${k}`).dispatchEvent(new Event('input'));
      }
    });
  }

  $('#lab-toggle').addEventListener('click', () => document.body.classList.toggle('lab-open'));
}

// ---- lobby -------------------------------------------------------------------------

function storedName() {
  try { return localStorage.getItem('lagtag-name') || ''; } catch { return ''; }
}

async function join(roomId) {
  const name = $('#name').value.trim() || `Player${Math.floor(Math.random() * 900 + 100)}`;
  try { localStorage.setItem('lagtag-name', name); } catch { /* private mode */ }
  $('#play').disabled = true;
  $('#private').disabled = true;
  let res;
  try {
    res = await net.connect(name, roomId);
    game.myId = res.id;
    game.roomId = res.room;
    game.roster = new Map(res.roster.map((p) => [p.id, p]));
  } catch (err) {
    $('#lobby-error').textContent = err.message;
    $('#play').disabled = false;
    $('#private').disabled = false;
    return;
  }

  document.body.classList.add('playing');
  $('#room-name').textContent = game.roomId;
  const url = new URL(location.href);
  url.searchParams.set('room', game.roomId);
  history.replaceState(null, '', url);

  setInterval(() => net.sendU({ t: 'p', c: performance.now() }), 500);
  net.sendU({ t: 'p', c: performance.now() });
  requestAnimationFrame(frame);
  if (res.rtc) net.startRtc().then(() => logLine(`Transport: ${net.transport}`));
  else logLine('Server has WebRTC disabled, using WebSocket');
}

function initLobby() {
  const params = new URLSearchParams(location.search);
  const room = params.get('room');
  $('#name').value = storedName();
  if (room) {
    $('#play').textContent = `Join room “${room}”`;
    $('#private').hidden = true;
  }
  $('#play').addEventListener('click', () => join(room));
  $('#private').addEventListener('click', () => join(Math.random().toString(36).slice(2, 7)));
  $('#name').addEventListener('keydown', (e) => e.key === 'Enter' && join(room));
  $('#invite').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(location.href);
      toast('Invite link copied: send it to up to 3 friends', 'good');
    } catch {
      toast(location.href);
    }
  });
  if (matchMedia('(pointer: coarse)').matches) document.body.classList.add('touch');
  if (innerWidth > 900) document.body.classList.add('lab-open');
}

bindLab();
initLobby();
