// Canvas renderer: tiles, props, animated sprites (catalog animations + anchors), effects.
(function (root) {
  'use strict';
  const DG = root.DG = root.DG || {};
  const A = DG.Assets, { T } = DG, U = DG.levelUtil;
  const TS = 32;

  class Renderer {
    constructor(canvas, game) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.scale = 2;
      this.setGame(game);
      this.time = 0;
      this.effects = [];
      this.floaters = [];
      this.projectiles = [];
      this.cam = { x: 0, y: 0, init: false };
    }

    setGame(game) {
      this.game = game;
      this.sprites = new Map(); // entity id -> sprite state
      this.levelCache = null;
      this.cam = { x: 0, y: 0, init: false };
      this.effects = []; this.floaters = []; this.projectiles = [];
    }

    resize(w, h) {
      const dpr = root.devicePixelRatio || 1;
      this.canvas.width = Math.floor(w * dpr);
      this.canvas.height = Math.floor(h * dpr);
      this.canvas.style.width = w + 'px';
      this.canvas.style.height = h + 'px';
      this.viewW = w; this.viewH = h; this.dpr = dpr;
      this.scale = this.fixedScale || (w < 700 ? 1.5 : 2);
    }

    // ---------------------------------------------------------------- static level layer
    buildLevelCache(lv) {
      const theme = A.themes[lv.theme];
      const auto = DG.MapGen.autotile(lv);
      const D = 'elthen.dungeon';
      const cells = new Array(lv.w * lv.h);
      for (let y = 0; y < lv.h; y++) for (let x = 0; x < lv.w; x++) {
        const i = U.idx(lv, x, y);
        const a = auto[i];
        const layers = []; // [{sheet, sx, sy, sw, sh, dx, dy}] in tile-local coordinates
        const h = DG.hash(x, y, lv.depth * 7 + 3);
        const tile = (sheet, id, dx, dy) => {
          if (Array.isArray(id)) { // composite piece: [{id, sy, h, dy}]
            for (const part of id) {
              const r = A.tileRect(sheet, part.id);
              layers.push({ sheet, sx: r.x, sy: r.y + part.sy, sw: r.w, sh: part.h, dx: 0, dy: part.dy });
            }
            return;
          }
          const r = A.tileRect(sheet, id);
          layers.push({ sheet, sx: r.x, sy: r.y, sw: r.w, sh: r.h, dx: dx || 0, dy: dy || 0 });
        };
        const cell = lv.cells[i];
        const floorTile = (kind) => {
          if (kind === 'slab') return this.slabTile(lv, x, y);
          const list = theme.floors[kind] || theme.floors[Object.keys(theme.floors)[0]];
          return list[h % list.length];
        };
        const isPillar = lv.pillar && lv.pillar[i];
        if (a.base === 'floor' || cell !== T.ROCK || isPillar) {
          const kind = a.floorKind || lv.floorKind[i] || Object.keys(theme.floors)[0];
          const ft = floorTile(kind);
          tile(kind === 'slab' ? D : theme.sheet, ft.id != null ? ft.id : ft);
        }
        if (cell === T.PIT) {
          const ex = A.extras;
          const above = U.cellAt(lv, x, y - 1) === T.PIT;
          const list = above ? ex.pitInner : ex.pitTop;
          tile(D, list[h % list.length]);
        } else if (cell === T.WATER) {
          this.waterTile(lv, x, y, theme, tile);
        }
        let wall = null;
        if (a.wall && a.wall !== 'void' && !isPillar) {
          let id = theme.wall[a.wall];
          if (a.wall === 'capN') id = theme.wall.caps[h % theme.wall.caps.length];
          if (a.wall === 'faceN') {
            const rare = theme.wall.rareFaces;
            id = (rare.length && h % 23 === 0) ? rare[(h >> 5) % rare.length] : theme.wall.faces[h % theme.wall.faces.length];
          }
          wall = id;
          tile(theme.sheet, id);
        }
        if (a.overlay) tile(theme.sheet, theme.wall[a.overlay]);
        cells[i] = { layers, void: a.base === 'void' && cell === T.ROCK && !isPillar, shadow: a.shadow, wall: a.wall };
      }
      this.levelCache = { lv, cells, theme };
    }

    slabTile(lv, x, y) {
      // tile the big flagstone slab stamp's inner 8x2 area
      const st = A.stamp('elthen.dungeon', 'floor_slab');
      const cx = ((x % st.cols) + st.cols) % st.cols;
      const cy = 1 + (((y % 2) + 2) % 2);
      return A.tileAt('elthen.dungeon', st.col + cx, st.row + cy);
    }

    waterTile(lv, x, y, theme, tile) {
      // arena pools: pick the 3x3 pool stamp piece from the 4-neighbourhood
      const w = (dx, dy) => U.cellAt(lv, x + dx, y + dy) === T.WATER;
      const col = !w(-1, 0) ? 0 : !w(1, 0) ? 2 : 1;
      const row = !w(0, -1) ? 0 : !w(0, 1) ? 2 : 1;
      if (theme.pool) tile(theme.sheet, theme.pool(col, row));
    }

    // ---------------------------------------------------------------- sprites
    spriteFor(e) {
      let s = this.sprites.get(e.id);
      if (!s) {
        s = { id: e.id, px: e.x, py: e.y, fromX: e.x, fromY: e.y, moveT: 1, anim: null, animT: 0,
              oneShot: null, flash: 0, dead: false, deathT: 0, alpha: 1, entity: e };
        this.sprites.set(e.id, s);
      }
      s.entity = e;
      return s;
    }

    animNameFor(e, role) {
      const an = e.anims;
      if (!an) return null;
      let n = an[role];
      if (Array.isArray(n)) n = n[Math.floor(Math.random() * n.length)];
      if (n && A.anim(e.sheet, n)) return n;
      return null;
    }

    playOneShot(s, name) {
      if (!name) return;
      s.oneShot = name; s.oneShotT = 0;
    }

    // feed game events
    handleEvents(events) {
      const g = this.game;
      for (const ev of events) {
        switch (ev.type) {
          case 'level':
            this.levelCache = null; this.sprites.clear(); this.effects = []; this.projectiles = []; this.floaters = [];
            this.cam.init = false;
            break;
          case 'move': {
            const e = this.entityById(ev.id); if (!e) break;
            const s = this.spriteFor(e);
            s.fromX = s.px; s.fromY = s.py; s.moveT = 0; s.toX = ev.x; s.toY = ev.y;
            break;
          }
          case 'teleport': {
            const e = this.entityById(ev.id); if (!e) break;
            const s = this.spriteFor(e);
            s.px = s.fromX = s.toX = ev.x; s.py = s.fromY = s.toY = ev.y; s.moveT = 1;
            this.effects.push({ kind: 'teleport', x: ev.x, y: ev.y, t: 0 });
            break;
          }
          case 'attack': {
            const e = this.entityById(ev.id); if (!e) break;
            const s = this.spriteFor(e);
            this.playOneShot(s, this.animNameFor(e, 'attack'));
            s.lunge = { dx: Math.sign(ev.x - e.x), dy: Math.sign(ev.y - e.y), t: 0 };
            break;
          }
          case 'anim': {
            const e = this.entityById(ev.id); if (!e) break;
            this.playOneShot(this.spriteFor(e), this.animNameFor(e, ev.role));
            break;
          }
          case 'hurt': {
            const e = this.entityById(ev.id);
            if (e) {
              const s = this.spriteFor(e);
              s.flash = 0.25;
              if (!ev.quiet) this.playOneShot(s, this.animNameFor(e, 'hurt'));
            }
            this.floaters.push({ text: '-' + ev.amount, x: ev.x, y: ev.y, t: 0, color: e && e.isPlayer ? '#ff6b6b' : '#ffe08a' });
            break;
          }
          case 'miss':
            { const e = this.entityById(ev.id); if (e) this.floaters.push({ text: 'miss', x: e.x, y: e.y, t: 0, color: '#bbb' }); }
            break;
          case 'die': {
            const e = this.entityById(ev.id) || (this.sprites.get(ev.id) || {}).entity;
            if (!e) break;
            const s = this.spriteFor(e);
            s.dead = true; s.deathT = 0;
            s.deathAnim = this.animNameFor(e, 'die');
            break;
          }
          case 'projectile':
            this.projectiles.push({ ...ev, t: 0, dur: Math.max(0.12, 0.05 * Math.hypot(ev.to.x - ev.from.x, ev.to.y - ev.from.y)) });
            break;
          case 'effect':
            this.effects.push({ kind: ev.kind, x: ev.x, y: ev.y, t: 0 });
            break;
          case 'pickup':
            this.effects.push({ kind: 'sparkle', x: ev.x, y: ev.y, t: 0 });
            break;
        }
      }
    }

    entityById(id) {
      const g = this.game;
      if (g.player.id === id) return g.player;
      return g.level.monsters.find(m => m.id === id) || null;
    }

    // ---------------------------------------------------------------- frame
    draw(dt) {
      this.time += dt;
      const g = this.game, lv = g.level, ctx = this.ctx;
      if (!this.levelCache || this.levelCache.lv !== lv) this.buildLevelCache(lv);
      const sc = this.scale * this.dpr;
      const vw = this.viewW / this.scale, vh = this.viewH / this.scale; // world px visible

      // camera follows the player sprite smoothly
      const ps = this.spriteFor(g.player);
      this.updateSprite(ps, dt);
      const tx = ps.px * TS + TS / 2 - vw / 2, ty = ps.py * TS + TS / 2 - vh / 2;
      if (!this.cam.init) { this.cam.x = tx; this.cam.y = ty; this.cam.init = true; }
      const k = 1 - Math.pow(0.0001, dt);
      this.cam.x += (tx - this.cam.x) * k; this.cam.y += (ty - this.cam.y) * k;
      const camX = Math.round(this.cam.x * this.scale) / this.scale, camY = Math.round(this.cam.y * this.scale) / this.scale;

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = '#0d0d10';
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
      ctx.imageSmoothingEnabled = false;
      ctx.setTransform(sc, 0, 0, sc, -camX * sc, -camY * sc);

      const x0 = Math.max(0, Math.floor(camX / TS) - 1), y0 = Math.max(0, Math.floor(camY / TS) - 1);
      const x1 = Math.min(lv.w - 1, Math.ceil((camX + vw) / TS) + 1), y1 = Math.min(lv.h - 1, Math.ceil((camY + vh) / TS) + 2);
      const theme = this.levelCache.theme;

      // pass 1: ground + walls
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const i = U.idx(lv, x, y);
        if (!lv.seen[i]) continue;
        const c = this.levelCache.cells[i];
        const px = x * TS, py = y * TS;
        if (c.void) { ctx.fillStyle = theme.voidColor; ctx.fillRect(px, py, TS, TS); continue; }
        for (const L of c.layers) ctx.drawImage(A.images[L.sheet], L.sx, L.sy, L.sw, L.sh, px + L.dx, py + L.dy, L.sw, L.sh);
      }
      // pillars (tower_block stamp: 3x4 tiles over a 3x3 footprint, top row overhangs the floor behind)
      for (const t of lv.towers || []) {
        if (!lv.seen[U.idx(lv, t.x, t.y)] && !lv.seen[U.idx(lv, t.x + 1, t.y + 1)]) continue;
        const r = theme.tower;
        ctx.drawImage(A.images[theme.sheet], r.x, r.y, r.w, r.h, t.x * TS, (t.y - 1) * TS, r.w, r.h);
      }
      // wall shadows on the floor under brick faces
      ctx.globalAlpha = 1;
      const shadow = A.extras.shadowWall;
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const i = U.idx(lv, x, y);
        if (!lv.seen[i] || !this.levelCache.cells[i].shadow) continue;
        ctx.drawImage(A.images['elthen.shadows'], shadow.x + 32, shadow.y + 4, 32, 32, x * TS, y * TS, TS, TS);
      }
      // wall decoration
      for (const wd of lv.wallDecor) {
        if (wd.x < x0 || wd.x > x1 || wd.y < y0 || wd.y > y1 || !lv.seen[U.idx(lv, wd.x, wd.y)]) continue;
        if (wd.type === 'torch') this.drawAnimFrame('elthen.torch', 'burn', this.time + wd.x * 0.37, wd.x * TS + 12, wd.y * TS + 6, false);
        else if (wd.type === 'banner') this.drawAnimFrame('elthen.banner', 'wave', this.time + wd.x * 0.21, wd.x * TS, wd.y * TS - 2, false);
        else if (wd.type === 'vines') { const r = wd.rect; ctx.drawImage(A.images['elthen.dungeon'], r.x, r.y + 16, r.w, 48, wd.x * TS, wd.y * TS - 16, r.w, 48); }
      }
      // floor decor, stairs, traps, portal
      for (const d of lv.decor) {
        if (d.x < x0 || d.x > x1 || d.y < y0 || d.y > y1 || !lv.seen[U.idx(lv, d.x, d.y)]) continue;
        this.drawPiece(d.sheet, d.tile, d.rect, d.x, d.y);
      }
      const D = 'elthen.dungeon', ex = A.extras;
      if (lv.stairsUp && lv.seen[U.idx(lv, lv.stairsUp.x, lv.stairsUp.y)]) this.drawPiece(D, ex.stairsUp, null, lv.stairsUp.x, lv.stairsUp.y);
      if (lv.stairsDown && lv.seen[U.idx(lv, lv.stairsDown.x, lv.stairsDown.y)]) this.drawPiece(D, ex.stairsDown, null, lv.stairsDown.x, lv.stairsDown.y);
      for (const t of lv.traps) {
        if (t.hidden || !lv.seen[U.idx(lv, t.x, t.y)]) continue;
        if (t.type === 'spikes') this.drawPiece(D, ex.spikes[0], null, t.x, t.y);
        else if (t.type === 'trapdoor') this.drawPiece(D, ex.crackedFloor, null, t.x, t.y);
        else if (t.type === 'portal') this.drawAnimFrame('elthen.purple_portal', 'idle', this.time, t.x * TS + 16, t.y * TS + 26, false, 0.6);
      }
      if (lv.portal) this.drawAnimFrame('elthen.green_portal', 'idle', this.time, lv.portal.x * TS + 16, lv.portal.y * TS + 28, false, 0.85);

      // items
      for (const it of lv.items) {
        const i = U.idx(lv, it.x, it.y);
        if (!lv.seen[i] || it.x < x0 || it.x > x1 || it.y < y0 || it.y > y1) continue;
        this.drawItemIcon(it.kind, it.x * TS + 8, it.y * TS + 10, it.qty);
      }

      // y-sorted: props + entities
      const drawables = [];
      for (const p of lv.props) {
        if (!lv.seen[U.idx(lv, p.x, p.y)]) continue;
        drawables.push({ y: p.y, sub: 0, fn: () => this.drawProp(p) });
      }
      for (const m of lv.monsters) {
        const s = this.spriteFor(m);
        this.updateSprite(s, dt);
        if (!lv.visible[U.idx(lv, m.x, m.y)] && !s.dead) continue;
        drawables.push({ y: s.py, sub: 1, fn: () => this.drawEntity(m, s) });
      }
      // dying sprites whose monsters were already removed
      for (const s of this.sprites.values()) {
        if (s.dead && !lv.monsters.includes(s.entity) && s.entity !== g.player) {
          this.updateSprite(s, dt);
          if (s.deathT < 1.6) drawables.push({ y: s.py, sub: 1, fn: () => this.drawEntity(s.entity, s) });
          else this.sprites.delete(s.id);
        }
      }
      drawables.push({ y: ps.py, sub: 2, fn: () => this.drawEntity(g.player, ps) });
      drawables.sort((a, b) => a.y - b.y || a.sub - b.sub);
      for (const d of drawables) d.fn();

      // projectiles & effects
      this.drawProjectiles(dt);
      this.drawEffects(dt);

      // fog: dim remembered cells, darken unseen void edges
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const i = U.idx(lv, x, y);
        if (!lv.seen[i]) continue;
        if (!lv.visible[i]) { ctx.fillStyle = 'rgba(8,8,14,0.6)'; ctx.fillRect(x * TS, y * TS, TS, TS); }
      }
      this.drawFloaters(dt);

      // vignette / blindness
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      if (g.player.status.blind) {
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
      }
    }

    drawPiece(sheet, tile, rect, x, y) {
      const ctx = this.ctx;
      if (rect) {
        ctx.drawImage(A.images[sheet], rect.x, rect.y, rect.w, rect.h, x * TS + (TS - rect.w) / 2, y * TS + (TS - rect.h), rect.w, rect.h);
      } else {
        const r = A.tileRect(sheet, tile);
        ctx.drawImage(A.images[sheet], r.x, r.y, r.w, r.h, x * TS, y * TS, r.w, r.h);
      }
    }

    drawProp(p) {
      const ctx = this.ctx, r = p.rect;
      const img = A.images[p.sheet];
      if (p.type === 'grave') ctx.drawImage(img, r.x, r.y, r.w, r.h, p.x * TS, (p.y - 1) * TS, r.w, r.h);
      else if (p.type === 'bench') ctx.drawImage(img, r.x, r.y, r.w, r.h, p.x * TS, p.y * TS, r.w, r.h);
      else if (p.type === 'chest') {
        ctx.drawImage(img, r.x, r.y, r.w, r.h, p.x * TS, p.y * TS + 2, r.w, r.h);
        if (p.locked) { const l = A.extras.padlock; ctx.drawImage(img, l.x, l.y, l.w, l.h, p.x * TS, p.y * TS + 6, l.w, l.h); }
      }
    }

    drawItemIcon(kind, x, y, qty) {
      const d = DG.ITEMS[kind], ctx = this.ctx;
      const ic = d.icon;
      if (kind === 'gold') {
        const n = qty >= 60 ? 'coins_4' : qty >= 30 ? 'coins_3' : qty >= 12 ? 'coins_2' : 'coins_1';
        const r = A.region(ic.sheet, n);
        ctx.drawImage(A.images[ic.sheet], r.x, r.y, r.w, r.h, x - 8, y - 12, r.w, r.h);
        return;
      }
      if (ic.region) {
        const r = A.region(ic.sheet, ic.region);
        const bob = Math.round(Math.sin(this.time * 3 + x) * 1);
        ctx.drawImage(A.images[ic.sheet], r.x, r.y, r.w, r.h, x, y + bob, r.w, r.h);
      } else if (ic.anim) {
        const a = A.anim(ic.sheet, ic.anim);
        const f = a.frames[Math.floor(this.time / a.frameDuration) % a.frames.length];
        ctx.drawImage(A.images[ic.sheet], f[0], f[1], f[2], f[3], x, y, f[2], f[3]);
      }
    }

    updateSprite(s, dt) {
      const e = s.entity;
      if (s.moveT < 1) {
        s.moveT = Math.min(1, s.moveT + dt / 0.11);
        const t = 1 - Math.pow(1 - s.moveT, 2);
        s.px = s.fromX + (e.x - s.fromX) * t;
        s.py = s.fromY + (e.y - s.fromY) * t;
      } else { s.px = e.x; s.py = e.y; }
      s.animT += dt;
      if (s.oneShot) s.oneShotT += dt;
      if (s.flash > 0) s.flash -= dt;
      if (s.lunge) { s.lunge.t += dt; if (s.lunge.t > 0.18) s.lunge = null; }
      if (s.dead) s.deathT += dt;
    }

    drawEntity(e, s) {
      const ctx = this.ctx, sheet = A.sheet(e.sheet);
      let name, t, loop = true;
      if (s.dead) {
        name = s.deathAnim; t = s.deathT; loop = false;
        if (!name) { s.alpha = Math.max(0, 1 - s.deathT * 2); name = this.animNameFor(e, 'idle'); t = 0; }
      } else if (s.oneShot) {
        const a = A.anim(e.sheet, s.oneShot);
        const dur = a.frames.length * a.frameDuration;
        if (s.oneShotT >= dur) s.oneShot = null;
        else { name = s.oneShot; t = s.oneShotT; loop = false; }
      }
      if (!name) {
        const moving = s.moveT < 1;
        const role = moving ? 'move' : (e.awake === false ? 'idle' : (e.anims.awake && !e.isPlayer ? 'awake' : 'idle'));
        name = this.animNameFor(e, role) || this.animNameFor(e, 'idle');
        t = s.animT + (e.id % 7) * 0.13;
      }
      const a = A.anim(e.sheet, name);
      if (!a) return;
      let fi = Math.floor(t / a.frameDuration);
      fi = loop ? fi % a.frames.length : Math.min(fi, a.frames.length - 1);
      const f = a.frames[fi];
      const anchor = sheet.anchor || { x: f[2] / 2, y: f[3] };
      let wx = s.px * TS + TS / 2, wy = s.py * TS + TS - 3;
      if (s.lunge) { const k = Math.sin(Math.min(1, s.lunge.t / 0.18) * Math.PI) * 6; wx += s.lunge.dx * k; wy += s.lunge.dy * k; }
      const lift = (e.def && e.def.lift) || 0;
      // drop shadow
      ctx.fillStyle = 'rgba(0,0,0,0.28)';
      ctx.beginPath(); ctx.ellipse(wx, wy, 9, 3.5, 0, 0, Math.PI * 2); ctx.fill();
      wy -= lift + (lift ? Math.sin(this.time * 4 + e.id) * 2 : 0);
      const flip = this.shouldFlip(e, sheet);
      const fade = s.dead && s.deathT > 1.0 ? Math.max(0, 1 - (s.deathT - 1.0) / 0.6) : s.alpha;
      ctx.save();
      ctx.globalAlpha = fade;
      ctx.translate(Math.round(wx), Math.round(wy));
      if (flip) ctx.scale(-1, 1);
      ctx.drawImage(A.images[e.sheet], f[0], f[1], f[2], f[3], -anchor.x, -anchor.y, f[2], f[3]);
      if (s.flash > 0) { // white hit flash
        ctx.globalCompositeOperation = 'source-atop';
        ctx.globalAlpha = Math.min(1, s.flash * 4) * 0.7;
        ctx.fillStyle = '#fff';
        ctx.fillRect(-anchor.x, -anchor.y, f[2], f[3]);
      }
      ctx.restore();
      ctx.globalAlpha = 1;
      // health bar for damaged monsters
      if (!e.isPlayer && !s.dead && e.hp < e.maxHp) {
        const w = 20, hgt = 3, bx = Math.round(wx - w / 2), by = Math.round(wy - (e.def.boss ? 34 : 26));
        ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fillRect(bx - 1, by - 1, w + 2, hgt + 2);
        ctx.fillStyle = e.hp / e.maxHp > 0.5 ? '#6c6' : e.hp / e.maxHp > 0.25 ? '#dc4' : '#d44';
        ctx.fillRect(bx, by, Math.max(1, Math.round(w * e.hp / e.maxHp)), hgt);
      }
      if (e.awake === false && !s.dead && this.game.canSee(e.x, e.y)) {
        ctx.fillStyle = '#cde'; ctx.font = '8px monospace';
        ctx.fillText('z', wx + 6, wy - 18 - Math.sin(this.time * 2 + e.id) * 2);
      }
      if (e.peaceful && !s.dead) {
        ctx.fillStyle = '#9f9'; ctx.font = '8px monospace'; ctx.fillText('♥', wx + 5, wy - 20);
      }
    }

    shouldFlip(e, sheet) {
      const facing = sheet.facing;
      if (facing === 'right') return e.facing < 0;
      if (facing === 'left') return e.facing > 0;
      return false; // front-facing art: no mirroring
    }

    drawAnimFrame(sheetId, name, t, x, y, flip, alpha) {
      const a = A.anim(sheetId, name), sheet = A.sheet(sheetId), ctx = this.ctx;
      if (!a) return;
      const f = a.frames[Math.floor(t / a.frameDuration) % a.frames.length];
      const an = sheet.anchor || { x: f[2] / 2, y: f[3] / 2 };
      if (alpha != null) ctx.globalAlpha = alpha;
      ctx.drawImage(A.images[sheetId], f[0], f[1], f[2], f[3], Math.round(x - an.x), Math.round(y - an.y), f[2], f[3]);
      ctx.globalAlpha = 1;
    }

    drawProjectiles(dt) {
      const ctx = this.ctx;
      this.projectiles = this.projectiles.filter(p => p.t < p.dur);
      for (const p of this.projectiles) {
        p.t += dt;
        const k = Math.min(1, p.t / p.dur);
        const x = (p.from.x + (p.to.x - p.from.x) * k) * TS + 16, y = (p.from.y + (p.to.y - p.from.y) * k) * TS + 14;
        const ang = Math.atan2(p.to.y - p.from.y, p.to.x - p.from.x);
        if (p.kind === 'arrow') {
          ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
          ctx.fillStyle = '#d9c9a3'; ctx.fillRect(-7, -0.5, 12, 1.5);
          ctx.fillStyle = '#eee'; ctx.fillRect(4, -1.5, 3, 3);
          ctx.fillStyle = '#a33'; ctx.fillRect(-8, -1.5, 2, 3);
          ctx.restore();
        } else if (p.kind === 'fireball') {
          // the imp's fireball animation ends with the flying ball (last frames)
          const a = A.anim('elthen.imp', 'fireball');
          const f = a.frames[a.frames.length - 1 - (Math.floor(this.time * 12) % 2)];
          ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
          ctx.drawImage(A.images['elthen.imp'], f[0] + 20, f[1] + 18, 12, 14, -8, -7, 12, 14);
          ctx.restore();
        } else if (p.kind === 'hex') {
          this.drawAnimFrame('elthen.hex', 'play', this.time, x, y, false);
        } else if (p.kind === 'bomb') {
          const r = A.anim('elthen.dungeon_collectables', 'bomb_fuse');
          const f = r.frames[Math.floor(this.time * 10) % r.frames.length];
          const arc = Math.sin(k * Math.PI) * 18;
          ctx.drawImage(A.images['elthen.dungeon_collectables'], f[0], f[1], f[2], f[3], x - 8, y - 8 - arc, f[2], f[3]);
        }
      }
    }

    drawEffects(dt) {
      const keep = [];
      for (const e of this.effects) {
        e.t += dt;
        const cx = e.x * TS + 16, cy = e.y * TS + 16;
        let alive = true;
        switch (e.kind) {
          case 'explosion': {
            const a = A.anim('elthen.dungeon_collectables', 'bomb_explode');
            const dur = a.frames.length * a.frameDuration;
            if (e.t < dur) {
              const f = a.frames[Math.floor(e.t / a.frameDuration)];
              this.ctx.drawImage(A.images['elthen.dungeon_collectables'], f[0], f[1], f[2], f[3], cx - 32, cy - 36, f[2] * 2, f[3] * 2);
            } else alive = false;
            break;
          }
          case 'hex': case 'levelup': case 'heal': case 'sparkle': {
            const a = A.anim('elthen.hex', 'play');
            const dur = a.frames.length * a.frameDuration;
            if (e.t < dur * (e.kind === 'levelup' ? 3 : 1)) {
              const fi = Math.floor(e.t / a.frameDuration) % a.frames.length;
              const f = a.frames[fi];
              this.ctx.globalAlpha = e.kind === 'sparkle' ? 0.7 : 1;
              if (e.kind === 'heal') this.ctx.filter = 'hue-rotate(200deg)';
              this.ctx.drawImage(A.images['elthen.hex'], f[0], f[1], f[2], f[3], cx - 16, cy - 20 - (e.kind === 'levelup' ? e.t * 10 : 0), f[2], f[3]);
              this.ctx.filter = 'none';
              this.ctx.globalAlpha = 1;
            } else alive = false;
            break;
          }
          case 'teleport': case 'portal': {
            const sheetId = e.kind === 'portal' ? 'elthen.green_portal' : 'elthen.purple_portal';
            const open = A.anim(sheetId, 'open'), close = A.anim(sheetId, 'close');
            const d1 = open.frames.length * open.frameDuration, d2 = close.frames.length * close.frameDuration;
            if (e.kind === 'teleport') {
              let a, t;
              if (e.t < d1) { a = 'open'; t = e.t; } else if (e.t < d1 + d2) { a = 'close'; t = e.t - d1; } else { alive = false; break; }
              const an = A.anim(sheetId, a);
              const f = an.frames[Math.min(an.frames.length - 1, Math.floor(t / an.frameDuration))];
              this.ctx.drawImage(A.images[sheetId], f[0], f[1], f[2], f[3], cx - 32, cy - 40, f[2], f[3]);
            } else if (e.t < d1) {
              const f = open.frames[Math.floor(e.t / open.frameDuration)];
              this.ctx.drawImage(A.images[sheetId], f[0], f[1], f[2], f[3], cx - 32, cy - 40, f[2], f[3]);
            } else alive = false;
            break;
          }
          case 'spikes': {
            if (e.t < 0.4) { const ex = A.extras; this.drawPiece('elthen.dungeon', ex.spikes[0], null, e.x, e.y); } else alive = false;
            break;
          }
          default: alive = false;
        }
        if (alive) keep.push(e);
      }
      this.effects = keep;
    }

    drawFloaters(dt) {
      const ctx = this.ctx;
      ctx.font = 'bold 9px monospace';
      ctx.textAlign = 'center';
      this.floaters = this.floaters.filter(f => f.t < 0.9);
      for (const f of this.floaters) {
        f.t += dt;
        const x = f.x * TS + 16, y = f.y * TS - 2 - f.t * 18;
        ctx.globalAlpha = Math.max(0, 1 - f.t / 0.9);
        ctx.fillStyle = '#000'; ctx.fillText(f.text, x + 1, y + 1);
        ctx.fillStyle = f.color; ctx.fillText(f.text, x, y);
      }
      ctx.globalAlpha = 1;
      ctx.textAlign = 'left';
    }

    busy() { return this.projectiles.length > 0; }
  }

  DG.Renderer = Renderer;
})(typeof window !== 'undefined' ? window : globalThis);
