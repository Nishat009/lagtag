// Transport layer. Socket.IO carries the lobby, WebRTC signalling and reliable
// events. Fast state (inputs, snapshots, pings, tag claims) prefers a WebRTC
// data channel to the server with {ordered:false, maxRetransmits:0}, and
// falls back to volatile Socket.IO emits when WebRTC can't connect.
const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];

export class Net {
  constructor(sim) {
    this.sim = sim;
    this.socket = null;
    this.pc = null;
    this.dc = null;
    this.forceWs = false;
    this.handlers = {};
    this.bytesIn = 0;
    this.bytesOut = 0;
    this.rtcState = 'off';
  }

  on(ev, fn) {
    this.handlers[ev] = fn;
  }

  emitLocal(ev, data) {
    this.handlers[ev]?.(data);
  }

  get usingRtc() {
    return !this.forceWs && this.dc?.readyState === 'open';
  }

  get transport() {
    return this.usingRtc ? 'WebRTC (UDP-like)' : 'WebSocket (TCP)';
  }

  connect(name, room) {
    // global `io` comes from /socket.io/socket.io.min.js
    this.socket = io({ transports: ['websocket'] });
    this.socket.on('u', (msg) => this.recv(msg, JSON.stringify(msg).length));
    for (const ev of ['roster', 'event']) {
      this.socket.on(ev, (data) => this.sim.run('down', () => this.emitLocal(ev, data), true));
    }
    this.socket.on('disconnect', () => this.emitLocal('disconnect'));
    return new Promise((resolve, reject) => {
      this.socket.emit('join', { name, room }, (res) => (res.error ? reject(new Error(res.error)) : resolve(res)));
    });
  }

  async startRtc() {
    if (!window.RTCPeerConnection) return;
    this.rtcState = 'connecting';
    try {
      const pc = (this.pc = new RTCPeerConnection({ iceServers: ICE_SERVERS }));
      const dc = pc.createDataChannel('state', { ordered: false, maxRetransmits: 0 });
      dc.onmessage = (e) => {
        try { this.recv(JSON.parse(e.data), e.data.length); } catch { /* ignore */ }
      };
      dc.onclose = () => { this.rtcState = 'closed'; };
      const opened = new Promise((resolve, reject) => {
        dc.onopen = resolve;
        setTimeout(() => reject(new Error('timeout')), 8000);
      });

      await pc.setLocalDescription(await pc.createOffer());
      await gatheringComplete(pc, 2000);
      const { type, sdp } = pc.localDescription;
      const res = await this.socket.timeout(8000).emitWithAck('rtc-offer', { type, sdp });
      if (res.error) throw new Error(res.error);
      await pc.setRemoteDescription(res.answer);
      await opened;
      this.dc = dc;
      this.rtcState = 'open';
    } catch (err) {
      console.warn('[rtc] staying on WebSocket:', err.message);
      this.rtcState = 'failed';
      try { this.pc?.close(); } catch { /* noop */ }
    }
  }

  setForceWs(on) {
    this.forceWs = on;
    this.sendR('settings', { transport: on ? 'ws' : 'auto' });
  }

  sendU(obj) {
    const str = JSON.stringify(obj);
    this.bytesOut += str.length;
    this.sim.run('up', () => {
      try {
        if (this.usingRtc) this.dc.send(str);
        else this.socket.volatile.emit('u', obj);
      } catch { /* channel closed mid-flight: it's unreliable anyway */ }
    });
  }

  sendR(ev, data) {
    this.sim.run('up', () => this.socket.emit(ev, data), true);
  }

  recv(msg, len) {
    this.bytesIn += len;
    this.sim.run('down', () => this.emitLocal('u', msg));
  }
}

function gatheringComplete(pc, timeoutMs) {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    pc.addEventListener('icegatheringstatechange', () => {
      if (pc.iceGatheringState === 'complete') {
        clearTimeout(timer);
        resolve();
      }
    });
  });
}
