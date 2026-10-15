// Keyboard (WASD / arrows, Space or Shift to dash) and a touch joystick.
import { K_UP, K_DOWN, K_LEFT, K_RIGHT, K_DASH } from '../shared/constants.js';

const KEYMAP = {
  KeyW: K_UP, ArrowUp: K_UP,
  KeyS: K_DOWN, ArrowDown: K_DOWN,
  KeyA: K_LEFT, ArrowLeft: K_LEFT,
  KeyD: K_RIGHT, ArrowRight: K_RIGHT,
  Space: K_DASH, ShiftLeft: K_DASH, ShiftRight: K_DASH,
};

export class Input {
  constructor({ stick, knob, dashBtn }) {
    this.down = new Set();
    this.touchKeys = 0;
    this.touchDash = false;

    addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return;
      if (KEYMAP[e.code]) {
        this.down.add(e.code);
        e.preventDefault();
      }
    });
    addEventListener('keyup', (e) => this.down.delete(e.code));
    addEventListener('blur', () => this.down.clear());

    this.bindStick(stick, knob);
    dashBtn.addEventListener('touchstart', (e) => { e.preventDefault(); this.touchDash = true; });
    dashBtn.addEventListener('touchend', () => { this.touchDash = false; });
  }

  bindStick(stick, knob) {
    let id = null;
    let cx = 0;
    let cy = 0;
    const R = 50;
    const move = (t) => {
      let dx = t.clientX - cx;
      let dy = t.clientY - cy;
      const d = Math.hypot(dx, dy);
      if (d > R) { dx = (dx / d) * R; dy = (dy / d) * R; }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      if (d < 12) { this.touchKeys = 0; return; }
      const oct = ((Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) % 8) + 8) % 8;
      this.touchKeys = [K_RIGHT, K_RIGHT | K_DOWN, K_DOWN, K_DOWN | K_LEFT, K_LEFT, K_LEFT | K_UP, K_UP, K_UP | K_RIGHT][oct];
    };
    stick.addEventListener('touchstart', (e) => {
      e.preventDefault();
      const t = e.changedTouches[0];
      id = t.identifier;
      const r = stick.getBoundingClientRect();
      cx = r.left + r.width / 2;
      cy = r.top + r.height / 2;
      move(t);
    });
    stick.addEventListener('touchmove', (e) => {
      e.preventDefault();
      for (const t of e.changedTouches) if (t.identifier === id) move(t);
    });
    const end = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier !== id) continue;
        id = null;
        this.touchKeys = 0;
        knob.style.transform = '';
      }
    };
    stick.addEventListener('touchend', end);
    stick.addEventListener('touchcancel', end);
  }

  read() {
    let k = this.touchKeys | (this.touchDash ? K_DASH : 0);
    for (const code of this.down) k |= KEYMAP[code];
    return k;
  }
}
