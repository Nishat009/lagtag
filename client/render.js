import {
  WORLD_W, WORLD_H, RADIUS, OBSTACLES, PICKUP_RADIUS, PW_SPEED, PW_SHIELD, PW_GHOST, TICK_RATE,
} from '../shared/constants.js';

const PICKUP_STYLE = {
  [PW_SPEED]: { color: '#ffd166', icon: '⚡' },
  [PW_SHIELD]: { color: '#4cc9f0', icon: '🛡' },
  [PW_GHOST]: { color: '#c77dff', icon: '👻' },
};

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.effects = [];
    this.trails = new Map();
    this.shake = 0;
    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
  }

  resize() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    const pad = 12;
    this.scale = Math.min((w - pad * 2) / WORLD_W, (h - pad * 2) / WORLD_H) * dpr;
    this.ox = (this.canvas.width - WORLD_W * this.scale) / 2;
    this.oy = (this.canvas.height - WORLD_H * this.scale) / 2;
    this.arenaCache = new Map();
  }

  // The arena is static: render it once per size/border colour, then blit.
  arena(itColor) {
    const key = itColor || 'default';
    let c = this.arenaCache.get(key);
    if (!c) {
      const pad = 40;
      c = document.createElement('canvas');
      c.width = Math.ceil((WORLD_W + pad * 2) * this.scale);
      c.height = Math.ceil((WORLD_H + pad * 2) * this.scale);
      const ctx = c.getContext('2d');
      ctx.setTransform(this.scale, 0, 0, this.scale, pad * this.scale, pad * this.scale);
      this.drawArena(ctx, itColor);
      c.pad = pad * this.scale;
      this.arenaCache.set(key, c);
    }
    return c;
  }

  addEffect(e) {
    this.effects.push({ born: performance.now(), ...e });
  }

  kick(amount) {
    this.shake = Math.max(this.shake, amount);
  }

  // A one-shot spray of particles; positions are computed from age, so no
  // per-frame physics is needed.
  burst(x, y, colors, n, speed) {
    const parts = Array.from({ length: n }, (_, i) => {
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.6;
      const v = speed * (0.4 + Math.random() * 0.8);
      return { vx: Math.cos(a) * v, vy: Math.sin(a) * v, r: 2 + Math.random() * 3, c: colors[i % colors.length] };
    });
    this.addEffect({ type: 'particles', x, y, parts, life: 700 + Math.random() * 200 });
  }

  draw(view) {
    const { ctx } = this;
    const now = performance.now();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#07080f';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    const sx = (Math.random() - 0.5) * this.shake * this.scale;
    const sy = (Math.random() - 0.5) * this.shake * this.scale;
    this.shake *= 0.86;
    const arena = this.arena(view.itColor);
    ctx.drawImage(arena, this.ox + sx - arena.pad, this.oy + sy - arena.pad);
    ctx.setTransform(this.scale, 0, 0, this.scale, this.ox + sx, this.oy + sy);

    if (view.pickups) for (const u of view.pickups) this.drawPickup(u, now);
    this.drawTrails(view.players);
    if (view.ghosts) for (const g of view.ghosts) this.drawGhost(g);
    for (const p of view.players) this.drawPlayer(p, now);
    this.drawEffects(now);
  }

  drawArena(ctx, itColor) {
    ctx.fillStyle = '#0d1020';
    ctx.fillRect(0, 0, WORLD_W, WORLD_H);
    ctx.strokeStyle = 'rgba(120,140,255,0.06)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 40; x < WORLD_W; x += 40) { ctx.moveTo(x, 0); ctx.lineTo(x, WORLD_H); }
    for (let y = 40; y < WORLD_H; y += 40) { ctx.moveTo(0, y); ctx.lineTo(WORLD_W, y); }
    ctx.stroke();

    ctx.save();
    ctx.shadowBlur = 24;
    ctx.shadowColor = itColor || '#5b6cff';
    ctx.strokeStyle = itColor || '#5b6cff';
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 4;
    ctx.strokeRect(2, 2, WORLD_W - 4, WORLD_H - 4);
    ctx.restore();

    for (const r of OBSTACLES) {
      ctx.fillStyle = '#1a1f3d';
      roundRect(ctx, r.x, r.y, r.w, r.h, 8);
      ctx.fill();
      ctx.strokeStyle = 'rgba(140,160,255,0.35)';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  drawTrails(players) {
    const { ctx } = this;
    for (const p of players) {
      let t = this.trails.get(p.id);
      if (!t) this.trails.set(p.id, (t = []));
      t.push({ x: p.x, y: p.y, dash: p.dash > 0 || p.pw === PW_SPEED });
      if (t.length > 14) t.shift();
      for (let i = 0; i < t.length; i++) {
        if (!t[i].dash) continue;
        ctx.globalAlpha = (i / t.length) * 0.35;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(t[i].x, t[i].y, RADIUS * (0.5 + i / t.length / 2), 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  drawPickup([, kind, x, y], now) {
    const st = PICKUP_STYLE[kind];
    if (!st) return;
    const { ctx } = this;
    const bob = Math.sin(now / 260 + x) * 4;
    const pulse = 0.5 + 0.5 * Math.sin(now / 180 + y);
    ctx.save();
    ctx.shadowBlur = 16 + pulse * 14;
    ctx.shadowColor = st.color;
    ctx.strokeStyle = st.color;
    ctx.fillStyle = 'rgba(13,16,32,0.85)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(x, y + bob, PICKUP_RADIUS, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.font = '16px "Segoe UI Emoji", "Apple Color Emoji", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(st.icon, x, y + bob + 1);
    ctx.restore();
  }

  drawGhost(g) {
    const { ctx } = this;
    ctx.save();
    ctx.setLineDash(g.kind === 'server' ? [6, 5] : [2, 4]);
    ctx.strokeStyle = g.color;
    ctx.globalAlpha = 0.85;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(g.x, g.y, RADIUS, 0, Math.PI * 2);
    ctx.stroke();
    if (g.label) {
      ctx.setLineDash([]);
      ctx.font = '600 11px "JetBrains Mono", monospace';
      ctx.fillStyle = g.color;
      ctx.textAlign = 'center';
      ctx.fillText(g.label, g.x, g.y + RADIUS + 14);
    }
    ctx.restore();
  }

  drawPlayer(p, now) {
    const { ctx } = this;
    ctx.save();
    if (p.pw === PW_GHOST) ctx.globalAlpha = 0.45 + 0.15 * Math.sin(now / 90);
    if (p.isIt) {
      const pulse = 0.5 + 0.5 * Math.sin(now / (p.bomb ? 60 : 120));
      ctx.shadowBlur = 30 + pulse * 20;
      ctx.shadowColor = '#ff3b5c';
      ctx.strokeStyle = '#ff3b5c';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(p.x, p.y, RADIUS + 7 + pulse * 3, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.shadowBlur = 18;
    ctx.shadowColor = p.color;
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, RADIUS, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    if (p.isMe) {
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 3;
      ctx.stroke();
    }
    if (p.frz > 0) {
      ctx.fillStyle = 'rgba(180,220,255,0.55)';
      ctx.beginPath();
      ctx.arc(p.x, p.y, RADIUS, 0, Math.PI * 2);
      ctx.fill();
    }
    if (p.immune) {
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = 'rgba(255,255,255,0.7)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(p.x, p.y, RADIUS + 6, now / 300, now / 300 + Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (p.shield) {
      ctx.save();
      ctx.strokeStyle = '#4cc9f0';
      ctx.fillStyle = 'rgba(76,201,240,0.12)';
      ctx.shadowBlur = 14;
      ctx.shadowColor = '#4cc9f0';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = now / 900 + (i * Math.PI) / 3;
        const r = RADIUS + 11;
        if (i === 0) ctx.moveTo(p.x + Math.cos(a) * r, p.y + Math.sin(a) * r);
        else ctx.lineTo(p.x + Math.cos(a) * r, p.y + Math.sin(a) * r);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
    if (p.pw === PW_SPEED) {
      ctx.strokeStyle = '#ffd166';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(p.x, p.y, RADIUS + 4, now / 80, now / 80 + Math.PI * 0.7);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(p.x, p.y, RADIUS + 4, now / 80 + Math.PI, now / 80 + Math.PI * 1.7);
      ctx.stroke();
    }

    ctx.textAlign = 'center';
    ctx.font = '700 13px "Space Grotesk", sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.fillText(p.isMe ? `${p.name} (you)` : p.name, p.x, p.y - RADIUS - 10);
    if (p.isIt) {
      ctx.font = '800 14px "Space Grotesk", sans-serif';
      ctx.fillStyle = '#0b0d18';
      ctx.fillText('IT', p.x, p.y + 5);
    }
    if (p.bomb) {
      const secs = p.bomb / TICK_RATE;
      const flash = secs < 1.5 ? Math.sin(now / 50) > 0 : Math.sin(now / 150) > 0;
      const by = p.y - RADIUS - 34;
      ctx.font = '22px "Segoe UI Emoji", "Apple Color Emoji", sans-serif';
      ctx.fillText('💣', p.x, by);
      ctx.font = '800 12px "JetBrains Mono", monospace';
      ctx.fillStyle = flash ? '#ff3b5c' : '#ffd166';
      ctx.fillText(secs.toFixed(1), p.x + 24, by - 4);
    }
    ctx.restore();
  }

  drawEffects(now) {
    const { ctx } = this;
    this.effects = this.effects.filter((e) => now - e.born < e.life);
    for (const e of this.effects) {
      const k = (now - e.born) / e.life;
      ctx.save();
      if (e.type === 'ring') {
        ctx.globalAlpha = 1 - k;
        ctx.strokeStyle = e.color;
        ctx.lineWidth = 5 * (1 - k) + 1;
        ctx.beginPath();
        ctx.arc(e.x, e.y, RADIUS + k * 110, 0, Math.PI * 2);
        ctx.stroke();
      } else if (e.type === 'rewind') {
        ctx.globalAlpha = Math.min(1, (1 - k) * 2);
        ctx.strokeStyle = '#ff9f1c';
        ctx.fillStyle = 'rgba(255,159,28,0.18)';
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 4]);
        ctx.beginPath();
        ctx.arc(e.x, e.y, RADIUS, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.font = '600 12px "JetBrains Mono", monospace';
        ctx.fillStyle = '#ff9f1c';
        ctx.textAlign = 'center';
        ctx.fillText(e.label, e.x, e.y - RADIUS - 10);
      } else if (e.type === 'particles') {
        const t = (now - e.born) / 1000;
        const travel = (1 - Math.exp(-t * 4)) / 4; // drag-damped distance
        ctx.globalAlpha = 1 - k;
        for (const q of e.parts) {
          ctx.fillStyle = q.c;
          ctx.beginPath();
          ctx.arc(e.x + q.vx * travel, e.y + q.vy * travel + 40 * t * t, q.r * (1 - k * 0.6), 0, Math.PI * 2);
          ctx.fill();
        }
      } else if (e.type === 'text') {
        const ease = 1 - (1 - Math.min(1, k * 4)) ** 3;
        ctx.globalAlpha = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
        ctx.font = `800 ${Math.round(e.size * (0.6 + 0.4 * ease))}px "Space Grotesk", sans-serif`;
        ctx.textAlign = 'center';
        ctx.lineWidth = 4;
        ctx.strokeStyle = 'rgba(7,8,15,0.8)';
        ctx.strokeText(e.text, e.x, e.y - k * 40);
        ctx.fillStyle = e.color;
        ctx.fillText(e.text, e.x, e.y - k * 40);
      } else if (e.type === 'boom') {
        ctx.globalAlpha = 1 - k;
        const g = ctx.createRadialGradient(e.x, e.y, 0, e.x, e.y, RADIUS + k * 160);
        g.addColorStop(0, 'rgba(255,240,200,0.95)');
        g.addColorStop(0.4, 'rgba(255,159,28,0.7)');
        g.addColorStop(1, 'rgba(255,59,92,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(e.x, e.y, RADIUS + k * 160, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
