// Server-side WebRTC peer (libdatachannel via node-datachannel). The browser
// opens an unordered, zero-retransmit data channel to the server, which gives
// UDP-like delivery: a lost snapshot is simply superseded by the next one
// instead of stalling everything behind it (TCP head-of-line blocking).
//
// Optional: if the native module is missing or DISABLE_RTC is set, the game
// runs entirely over Socket.IO.
let RTCPeerConnection = null;
if (!process.env.DISABLE_RTC) {
  try {
    ({ RTCPeerConnection } = await import('node-datachannel/polyfill'));
  } catch (err) {
    console.warn('[rtc] node-datachannel unavailable, WebSocket only:', err.message);
  }
}

export const rtcAvailable = () => RTCPeerConnection !== null;

const ICE_SERVERS = [{ urls: process.env.STUN_URL || 'stun:stun.l.google.com:19302' }];

function gatheringComplete(pc, timeoutMs) {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      pc.removeEventListener('icegatheringstatechange', onChange);
      resolve();
    };
    const onChange = () => pc.iceGatheringState === 'complete' && done();
    const timer = setTimeout(done, timeoutMs);
    pc.addEventListener('icegatheringstatechange', onChange);
  });
}

// Non-trickle ICE: one offer in, one complete answer out over Socket.IO.
export async function answerOffer(offer, onChannel) {
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  pc.ondatachannel = (e) => onChannel(e.channel);
  await pc.setRemoteDescription(offer);
  await pc.setLocalDescription(await pc.createAnswer());
  await gatheringComplete(pc, 2000);
  const { type, sdp } = pc.localDescription;
  return { pc, answer: { type, sdp } };
}
