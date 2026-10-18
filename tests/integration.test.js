import test from 'node:test';
import assert from 'node:assert/strict';
import { io } from 'socket.io-client';
import { createGameServer } from '../server/index.js';
import { rtcAvailable } from '../server/rtc.js';
import { K_RIGHT } from '../shared/constants.js';

const game = createGameServer();
const port = await game.listen(0);
const url = `http://localhost:${port}`;
test.after(() => game.close());

function connect(room) {
  const socket = io(url, { transports: ['websocket'], forceNew: true });
  const joined = new Promise((resolve, reject) => {
    socket.emit('join', { name: 'Test', room }, (res) => (res.error ? reject(new Error(res.error)) : resolve(res)));
  });
  return { socket, joined };
}

function nextMessage(subscribe, predicate, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), timeoutMs);
    subscribe((msg) => {
      if (predicate(msg)) {
        clearTimeout(timer);
        resolve(msg);
      }
    });
  });
}

test('join fills the room with bots and streams snapshots over WebSocket', async () => {
  const { socket, joined } = connect('it-ws');
  const res = await joined;
  assert.equal(res.roster.length, 4);
  assert.equal(res.roster.filter((p) => p.bot).length, 3);

  const snap = await nextMessage((fn) => socket.on('u', fn), (m) => m.t === 's');
  assert.equal(snap.p.length, 4);

  // Send inputs; the server should ack them and move us right.
  const me0 = snap.p.find((p) => p[0] === res.id);
  let seq = 0;
  const timer = setInterval(() => {
    seq++;
    socket.emit('u', { t: 'i', i: [[seq, K_RIGHT]] });
  }, 1000 / 60);
  const later = await nextMessage((fn) => socket.on('u', fn), (m) => m.t === 's' && m.p.find((p) => p[0] === res.id)[12] >= 30);
  clearInterval(timer);
  const me1 = later.p.find((p) => p[0] === res.id);
  assert.ok(me1[1] > me0[1] || me1[9] > 0, 'moved right (unless frozen as IT)');

  const pong = new Promise((resolve) => socket.on('u', (m) => m.t === 'o' && resolve(m)));
  socket.emit('u', { t: 'p', c: 123 });
  assert.equal((await pong).c, 123);
  socket.close();
});

test('a fifth human is turned away from a full room', async () => {
  const clients = [0, 1, 2, 3].map(() => connect('it-full'));
  await Promise.all(clients.map((c) => c.joined));
  const fifth = connect('it-full');
  await assert.rejects(fifth.joined, /full/);
  for (const c of [...clients, fifth]) c.socket.close();
});

test('WebRTC data channel to the server carries snapshots and inputs', { skip: !rtcAvailable() }, async () => {
  const { RTCPeerConnection } = await import('node-datachannel/polyfill');
  const { socket, joined } = connect('it-rtc');
  const res = await joined;

  const pc = new RTCPeerConnection({ iceServers: [] });
  const dc = pc.createDataChannel('state', { ordered: false, maxRetransmits: 0 });
  const opened = new Promise((resolve) => { dc.onopen = resolve; });
  await pc.setLocalDescription(await pc.createOffer());
  await new Promise((resolve) => {
    if (pc.iceGatheringState === 'complete') return resolve();
    pc.addEventListener('icegatheringstatechange', () => pc.iceGatheringState === 'complete' && resolve());
    setTimeout(resolve, 2000);
  });
  const { type, sdp } = pc.localDescription;
  const ans = await socket.timeout(8000).emitWithAck('rtc-offer', { type, sdp });
  assert.ok(ans.answer, ans.error);
  await pc.setRemoteDescription(ans.answer);
  await opened;

  const snap = await nextMessage((fn) => { dc.onmessage = (e) => fn(JSON.parse(e.data)); }, (m) => m.t === 's');
  assert.equal(snap.p.length, 4);

  dc.send(JSON.stringify({ t: 'i', i: [[1, K_RIGHT], [2, K_RIGHT]] }));
  const acked = await nextMessage((fn) => { dc.onmessage = (e) => fn(JSON.parse(e.data)); },
    (m) => m.t === 's' && m.p.find((p) => p[0] === res.id)[12] === 2);
  assert.ok(acked);

  pc.close();
  socket.close();
});
