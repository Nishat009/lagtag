import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Server } from 'socket.io';
import { TICK_MS } from '../shared/constants.js';
import { Room } from './room.js';
import { answerOffer, rtcAvailable } from './rtc.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PORT = Number(process.env.PORT) || 3000;

export function createGameServer() {
  const app = express();
  app.use(express.static(path.join(root, 'client')));
  app.use('/shared', express.static(path.join(root, 'shared')));
  app.get('/health', (_req, res) => res.json({ ok: true, rooms: rooms.size, rtc: rtcAvailable() }));

  const httpServer = http.createServer(app);
  const io = new Server(httpServer);
  const rooms = new Map();

  // ---- clock & fixed-step loop ------------------------------------------------
  // One monotonic game clock for every room. Ticks catch up to wall time, so
  // coarse OS timers (≈15 ms on Windows) only make sends bursty; the snapshot
  // timestamps stay exact multiples of TICK_MS.
  const t0 = performance.now();
  const now = () => performance.now() - t0;
  let tick = 0;
  const loop = setInterval(() => {
    const target = Math.floor(now() / TICK_MS);
    let budget = 10;
    while (tick < target && budget-- > 0) {
      tick++;
      for (const room of rooms.values()) room.update();
    }
    if (tick < target - 60) tick = target; // hopelessly behind (debugger, sleep): skip
  }, 4);

  function findRoom(requested) {
    if (requested) {
      const id = String(requested).toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 24) || 'public';
      if (!rooms.has(id)) rooms.set(id, new Room(id, tick));
      const room = rooms.get(id);
      return room.isFull() ? null : room;
    }
    for (let n = 1; ; n++) {
      const id = n === 1 ? 'public' : `public-${n}`;
      if (!rooms.has(id)) rooms.set(id, new Room(id, tick));
      if (!rooms.get(id).isFull()) return rooms.get(id);
    }
  }

  io.on('connection', (socket) => {
    let room = null;
    let player = null;
    let preferWs = false;
    const rtc = { pc: null, dc: null };

    const client = {
      // Unreliable path: data channel when open, else a volatile Socket.IO emit
      // (dropped rather than buffered if the socket is backed up).
      sendU(obj, str) {
        if (!preferWs && rtc.dc && rtc.dc.readyState === 'open') {
          try {
            rtc.dc.send(str ?? JSON.stringify(obj));
            return;
          } catch { /* fall through */ }
        }
        socket.volatile.emit('u', obj);
      },
      emit(ev, data) {
        socket.emit(ev, data);
      },
    };

    function onUnreliable(msg) {
      if (!player || !msg || typeof msg !== 'object') return;
      if (msg.t === 'i') room.onInputs(player, msg.i);
      else if (msg.t === 'p') client.sendU({ t: 'o', c: msg.c, s: now() });
      else if (msg.t === 'g') room.onClaim(player, msg);
    }

    socket.on('join', (req, ack) => {
      if (player || typeof ack !== 'function') return;
      const name = String(req?.name || 'Player').replace(/[^\p{L}\p{N} _-]/gu, '').trim().slice(0, 16) || 'Player';
      room = findRoom(req?.room);
      if (!room) return ack({ error: 'Room is full (4 humans max).' });
      player = room.addHuman(client, name);
      ack({ id: player.id, room: room.id, rtc: rtcAvailable(), roster: room.roster() });
    });

    socket.on('u', onUnreliable);

    socket.on('settings', (s) => {
      if (!player || !s) return;
      if ('lagComp' in s) room.setLagComp(player, s.lagComp);
      if ('transport' in s) preferWs = s.transport === 'ws';
    });

    socket.on('rtc-offer', async (offer, ack) => {
      if (typeof ack !== 'function') return;
      if (!rtcAvailable() || rtc.pc || offer?.type !== 'offer' || typeof offer.sdp !== 'string') {
        return ack({ error: 'rtc unavailable' });
      }
      try {
        const { pc, answer } = await answerOffer(offer, (dc) => {
          rtc.dc = dc;
          dc.onmessage = (e) => {
            try { onUnreliable(JSON.parse(e.data)); } catch { /* ignore malformed */ }
          };
          dc.onclose = () => { if (rtc.dc === dc) rtc.dc = null; };
        });
        rtc.pc = pc;
        ack({ answer });
      } catch (err) {
        ack({ error: err.message });
      }
    });

    socket.on('disconnect', () => {
      try { rtc.pc?.close(); } catch { /* already closed */ }
      if (room && player) {
        room.removeHuman(player.id);
        if (room.humans().length === 0) rooms.delete(room.id);
      }
    });
  });

  return {
    httpServer,
    listen: (port = PORT) => new Promise((r) => httpServer.listen(port, () => r(httpServer.address().port))),
    close: () => {
      clearInterval(loop);
      io.close();
      httpServer.close();
    },
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const game = createGameServer();
  const port = await game.listen();
  console.log(`LagTag running on http://localhost:${port}  (WebRTC: ${rtcAvailable() ? 'on' : 'off'})`);
}
