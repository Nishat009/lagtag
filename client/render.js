import { WORLD_W, WORLD_H, RADIUS, OBSTACLES } from '../shared/constants.js';

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
      t.push({ x: p.x, y: p.y, dash: p.dash > 0 });
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
    if (p.isIt) {
      const pulse = 0.5 + 0.5 * Math.sin(now / 120);
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

    ctx.textAlign = 'center';
    ctx.font = '700 13px "Space Grotesk", sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.fillText(p.isMe ? `${p.name} (you)` : p.name, p.x, p.y - RADIUS - 10);
    if (p.isIt) {
      ctx.font = '800 14px "Space Grotesk", sans-serif';
      ctx.fillStyle = '#0b0d18';
      ctx.fillText('IT', p.x, p.y + 5);
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
