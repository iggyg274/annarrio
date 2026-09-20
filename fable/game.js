// game.js — engine: rendering, physics, entities, HUD, screens.
(function () {
  'use strict';

  const L = window.LEVEL;
  const T = L.T, VW = 480, VH = 270;
  const WPX = L.W * T, HPX = L.H * T;
  const { SOLID, ONEWAY, WATER, QBLOCK, BRICK } = L;

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const audio = new window.AudioSys();

  // ---- images -------------------------------------------------------------
  const IMG = {};
  function loadImg(src) {
    return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('failed to load ' + src)); i.src = src; });
  }
  const imagesReady = Promise.all([
    loadImg('sprites/Tilemap/tilemap_packed.png'),
    loadImg('sprites/Tilemap/tilemap-characters_packed.png'),
    loadImg('sprites/Tilemap/tilemap-backgrounds_packed.png'),
    loadImg('urbantileset/urbantileset32x32.png'),
  ]).then(([t, c, b, u]) => { IMG.tiles = t; IMG.chars = c; IMG.bgs = b; IMG.urban = u; });

  function drawTile(i, x, y, s) {
    s = s || 1;
    ctx.drawImage(IMG.tiles, (i % 20) * 18, Math.floor(i / 20) * 18, 18, 18, Math.round(x), Math.round(y), 18 * s, 18 * s);
  }
  function drawChar(i, x, y, flip, flipY) {
    const sx = (i % 9) * 24, sy = Math.floor(i / 9) * 24;
    x = Math.round(x); y = Math.round(y);
    if (!flip && !flipY) { ctx.drawImage(IMG.chars, sx, sy, 24, 24, x, y, 24, 24); return; }
    ctx.save();
    ctx.translate(x + 12, y + 12);
    ctx.scale(flip ? -1 : 1, flipY ? -1 : 1);
    ctx.drawImage(IMG.chars, sx, sy, 24, 24, -12, -12, 24, 24);
    ctx.restore();
  }
  function drawBg(i, x, y, s) {
    ctx.drawImage(IMG.bgs, (i % 8) * 24, Math.floor(i / 8) * 24, 24, 24, Math.round(x), Math.round(y), 24 * s, 24 * s);
  }
  function drawUrban(id, x, y, s) {
    const r = L.URBAN[id];
    ctx.drawImage(IMG.urban, r.x, r.y, r.w, r.h, Math.round(x), Math.round(y), Math.round(r.w * s), Math.round(r.h * s));
  }
  function text(str, x, y, o) {
    o = o || {};
    const size = o.size || 8;
    ctx.font = `${o.bold === false ? '' : 'bold '}${size}px "Lucida Console", Monaco, Consolas, monospace`;
    ctx.textAlign = o.align || 'left';
    ctx.textBaseline = 'top';
    if (o.bg) {
      const w = ctx.measureText(str).width, pad = o.pad || 2;
      let bx = x - pad; if (o.align === 'center') bx = x - w / 2 - pad; else if (o.align === 'right') bx = x - w - pad;
      ctx.fillStyle = o.bg;
      ctx.fillRect(Math.round(bx), Math.round(y - pad), Math.round(w + pad * 2), Math.round(size + pad * 2));
    }
    if (o.outline) { ctx.lineWidth = o.lw || 2; ctx.strokeStyle = o.outline; ctx.lineJoin = 'round'; ctx.strokeText(str, x, y); }
    ctx.fillStyle = o.color || '#fff';
    ctx.fillText(str, x, y);
  }

  // ---- sizing ---------------------------------------------------------------
  let S = 2;
  function resize() {
    const cssScale = Math.min(window.innerWidth / VW, (window.innerHeight - 0) / VH);
    canvas.style.width = Math.floor(VW * cssScale) + 'px';
    canvas.style.height = Math.floor(VH * cssScale) + 'px';
    S = Math.max(1, Math.min(5, Math.ceil(cssScale * (window.devicePixelRatio || 1))));
    canvas.width = VW * S; canvas.height = VH * S;
    ctx.setTransform(S, 0, 0, S, 0, 0);
    ctx.imageSmoothingEnabled = false;
  }
  window.addEventListener('resize', resize);
  resize();

  // ---- input ----------------------------------------------------------------
  const keys = {};
  const input = { left: false, right: false, jump: false, jumpBuf: 0, down: false };
  let anyPress = false;
  const KEYMAP = {
    ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
    ArrowUp: 'jump', KeyW: 'jump', Space: 'jump', KeyZ: 'jump', KeyX: 'jump', KeyK: 'jump',
    ArrowDown: 'down', KeyS: 'down',
  };
  function press(name) {
    if (name === 'jump' && !input.jump) input.jumpBuf = 0.12;
    input[name] = true; anyPress = true;
  }
  window.addEventListener('keydown', (e) => {
    if (e.repeat) { if (KEYMAP[e.code]) e.preventDefault(); return; }
    const k = KEYMAP[e.code];
    if (k) { press(k); e.preventDefault(); }
    keys[e.code] = true;
    onKey(e.code);
  });
  window.addEventListener('keyup', (e) => {
    const k = KEYMAP[e.code];
    if (k) { input[k] = false; e.preventDefault(); }
    keys[e.code] = false;
  });
  // touch buttons
  document.querySelectorAll('[data-btn]').forEach((el) => {
    const name = el.dataset.btn;
    const on = (e) => { e.preventDefault(); if (name === 'start') { anyPress = true; onKey('Enter'); } else press(name); el.classList.add('on'); };
    const off = (e) => { e.preventDefault(); if (name !== 'start') input[name] = false; el.classList.remove('on'); };
    el.addEventListener('pointerdown', on);
    el.addEventListener('pointerup', off);
    el.addEventListener('pointercancel', off);
    el.addEventListener('pointerleave', off);
  });
  canvas.addEventListener('pointerdown', () => { anyPress = true; if (state === 'title' || state === 'credits') onKey('Enter'); else if (state === 'won' || state === 'gameover') onKey('Enter'); });
  if ('ontouchstart' in window) document.body.classList.add('touch');

  // ---- game state -----------------------------------------------------------
  let state = 'loading';
  let time = 0, levelTime = 0;
  let player, enemies, coins, particles, popups, toasts, checkpoints, triggersDone, moodIdx;
  let cam = { x: 0, y: 0 };
  let flash = 0, endTimer = 0, respawn, qblocksLeft = 0;
  const tilesRT = new Int16Array(L.tiles);   // runtime copy (q-blocks change)
  const flagsRT = new Uint8Array(L.flags);

  function newGame() {
    tilesRT.set(L.tiles); flagsRT.set(L.flags);
    player = { x: L.spawn.x, y: L.spawn.y, w: 14, h: 22, vx: 0, vy: 0, onGround: false, facing: 1, anim: 0, inv: 0, hearts: 3, coins: 0, coyote: 0, dead: 0, wasBottom: 0 };
    respawn = { x: L.spawn.x, y: L.spawn.y };
    enemies = L.enemies.map(makeEnemy);
    coins = L.coins.map((c) => ({ x: c.x, y: c.y, gem: c.gem, taken: false }));
    particles = []; popups = []; toasts = [];
    checkpoints = L.checkpoints.map((c) => ({ x: c.x, y: c.y, on: false }));
    triggersDone = {};
    moodIdx = -1;
    levelTime = 0; endTimer = 0;
    cam.x = 0; cam.y = HPX - VH;
  }

  function makeEnemy(e) {
    const base = { type: e.type, x0: e.x0, x1: e.x1, dir: 1, alive: true, t: Math.random() * 6, dead: 0 };
    switch (e.type) {
      case 'squirrel': return Object.assign(base, { x: e.x, y: e.y + 18 - 15, w: 11, h: 15, ox: -6, oy: -5, frames: [13, 14], speed: 32, ground: true });
      case 'parkbot':  return Object.assign(base, { x: e.x, y: e.y + 18 - 14, w: 15, h: 14, ox: -5, oy: -10, frames: [18, 20], speed: 42, ground: true });
      case 'bat':      return Object.assign(base, { x: e.x, y: e.y, by: e.y, w: 18, h: 17, ox: -3, oy: -4, frames: [24], speed: 45, fly: true, amp: 14, fr: 3 });
      case 'drone':    return Object.assign(base, { x: e.x, y: e.y, by: e.y, w: 15, h: 18, ox: -4, oy: -6, frames: [15, 16], speed: 60, fly: true, amp: 6, fr: 2 });
    }
    return base;
  }

  // ---- tile queries -----------------------------------------------------------
  function flagAt(tx, ty) {
    if (tx < 0 || tx >= L.W) return SOLID;   // level walls
    if (ty < 0 || ty >= L.H) return 0;
    return flagsRT[ty * L.W + tx];
  }

  // Axis-separated tile collision for an AABB body.
  function moveX(b, dx) {
    b.x += dx;
    const y0 = Math.floor(b.y / T), y1 = Math.floor((b.y + b.h - 0.01) / T);
    if (dx > 0) {
      const tx = Math.floor((b.x + b.w - 0.01) / T);
      for (let ty = y0; ty <= y1; ty++) if (flagAt(tx, ty) & SOLID) { b.x = tx * T - b.w; b.vx = 0; return true; }
    } else if (dx < 0) {
      const tx = Math.floor(b.x / T);
      for (let ty = y0; ty <= y1; ty++) if (flagAt(tx, ty) & SOLID) { b.x = (tx + 1) * T; b.vx = 0; return true; }
    }
    return false;
  }
  function moveY(b, dy, isPlayer) {
    const prevBottom = b.y + b.h;
    b.y += dy;
    const x0 = Math.floor(b.x / T), x1 = Math.floor((b.x + b.w - 0.01) / T);
    b.onGround = false;
    if (dy > 0) {
      const ty = Math.floor((b.y + b.h - 0.01) / T);
      for (let tx = x0; tx <= x1; tx++) {
        const f = flagAt(tx, ty);
        if ((f & SOLID) || ((f & ONEWAY) && prevBottom <= ty * T + 0.5)) {
          b.y = ty * T - b.h; b.vy = 0; b.onGround = true; return true;
        }
      }
    } else if (dy < 0) {
      const ty = Math.floor(b.y / T);
      let hit = null;
      for (let tx = x0; tx <= x1; tx++) {
        const f = flagAt(tx, ty);
        if (f & SOLID) {
          // prefer the block most overlapped horizontally for bump logic
          const ov = Math.min(b.x + b.w, (tx + 1) * T) - Math.max(b.x, tx * T);
          if (!hit || ov > hit.ov) hit = { tx, ty, f, ov };
        }
      }
      if (hit) {
        b.y = (hit.ty + 1) * T; b.vy = 0;
        if (isPlayer) bumpBlock(hit.tx, hit.ty, hit.f);
        return true;
      }
    }
    return false;
  }

  function bumpBlock(tx, ty, f) {
    if (f & QBLOCK) {
      tilesRT[ty * L.W + tx] = 9;
      flagsRT[ty * L.W + tx] = SOLID;
      audio.qblock();
      player.coins++;
      popups.push({ x: tx * T + 9, y: ty * T - 4, text: '+1', life: 0.8, coinAnim: true });
      burst(tx * T + 9, ty * T, '#ffcb05', 6);
    } else {
      audio.bump();
      burst(tx * T + 9, ty * T + 18, '#c9a66b', 3);
    }
  }

  function burst(x, y, color, n, spread) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, sp = 40 + Math.random() * (spread || 60);
      particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 40, life: 0.5 + Math.random() * 0.3, color, size: 2 });
    }
  }
  function toast(text, sub, life, slot) {
    slot = slot || 'event';
    toasts = toasts.filter((q) => q.slot !== slot);
    toasts.push({ text, sub, life: life || 2.5, max: life || 2.5, slot });
  }

  // ---- update -------------------------------------------------------------------
  const GRAV = 900, JUMP = -335, RUN = 112, ACC = 900, FRIC = 1000, MAXFALL = 420;

  function hurtPlayer(knockDir) {
    if (player.inv > 0 || player.dead) return;
    player.hearts--;
    audio.hurt();
    flash = 0.25;
    burst(player.x + 7, player.y + 11, '#ff5555', 8);
    if (player.hearts <= 0) { killPlayer(); return; }
    player.inv = 1.6;
    player.vy = -200; player.vx = 150 * (knockDir || -player.facing);
  }
  function killPlayer() {
    player.dead = 1.4; player.vy = -260; player.vx = 0;
    audio.music.stop();
    audio.die();
  }
  function fellOut() {
    if (player.dead) return;
    audio.splash();
    player.hearts--;
    flash = 0.3;
    if (player.hearts <= 0) { player.hearts = 0; state = 'gameover'; audio.music.stop(); audio.die(); return; }
    player.x = respawn.x; player.y = respawn.y; player.vx = 0; player.vy = 0; player.inv = 1.5;
    toast('SPLASH!', 'back to the last checkpoint', 1.8);
  }

  function update(dt) {
    time += dt;
    if (state !== 'playing') return;
    levelTime += dt;
    if (flash > 0) flash -= dt;
    if (input.jumpBuf > 0) input.jumpBuf -= dt;

    const p = player;
    // ---- player death animation
    if (p.dead) {
      p.dead -= dt;
      p.vy += GRAV * dt; p.y += p.vy * dt;
      if (p.dead <= 0) state = 'gameover';
      updateFX(dt);
      return;
    }

    // ---- player movement
    const ax = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    if (ax !== 0) {
      p.vx += ax * ACC * dt;
      p.facing = ax;
    } else {
      const f = FRIC * dt;
      if (Math.abs(p.vx) <= f) p.vx = 0; else p.vx -= Math.sign(p.vx) * f;
    }
    p.vx = Math.max(-RUN, Math.min(RUN, p.vx));
    if (p.onGround) p.coyote = 0.1; else p.coyote -= dt;
    if (input.jumpBuf > 0 && p.coyote > 0) {
      p.vy = JUMP; p.coyote = 0; input.jumpBuf = 0; p.onGround = false;
      audio.jump();
    }
    if (!input.jump && p.vy < -120) p.vy = -120;   // variable jump height
    p.vy = Math.min(MAXFALL, p.vy + GRAV * dt);
    moveX(p, p.vx * dt);
    const wasGround = p.onGround;
    moveY(p, p.vy * dt, true);
    if (p.onGround && !wasGround && p.vy === 0) { /* landed */ }
    if (p.inv > 0) p.inv -= dt;
    if (ax !== 0 && p.onGround) p.anim += dt * 9; else if (p.onGround) p.anim = 0;

    // water / pit
    const cx = p.x + p.w / 2;
    const tyFeet = Math.floor((p.y + p.h - 4) / T);
    if (p.y > HPX + 40 || (flagAt(Math.floor(cx / T), tyFeet) & WATER)) { fellOut(); }

    // ---- coins
    for (const c of coins) {
      if (c.taken) continue;
      if (Math.abs(c.x - cx) < 12 && Math.abs(c.y - (p.y + p.h / 2)) < 16) {
        c.taken = true;
        if (c.gem) { p.coins += 5; audio.gem(); popups.push({ x: c.x, y: c.y - 6, text: '+5', life: 0.9 }); burst(c.x, c.y, '#4fc3f7', 8); }
        else { p.coins++; audio.coin(); popups.push({ x: c.x, y: c.y - 6, text: '+1', life: 0.7 }); burst(c.x, c.y, '#ffcb05', 4, 30); }
      }
    }

    // ---- enemies
    for (const e of enemies) {
      if (!e.alive) { if (e.dead > 0) { e.dead -= dt; e.y += 120 * dt; } continue; }
      e.t += dt;
      if (e.ground) {
        e.vy = Math.min(MAXFALL, (e.vy || 0) + GRAV * dt);
        const hitWall = moveX(e, e.dir * e.speed * dt);
        moveY(e, e.vy * dt);
        // turn at walls, patrol bounds, and ledges
        let turn = hitWall || e.x < e.x0 || e.x + e.w > e.x1;
        if (!turn && e.onGround) {
          const aheadX = e.dir > 0 ? e.x + e.w + 1 : e.x - 1;
          const f = flagAt(Math.floor(aheadX / T), Math.floor((e.y + e.h + 1) / T));
          if (!(f & (SOLID | ONEWAY))) turn = true;
        }
        if (turn) { e.dir = -e.dir; e.x = Math.max(e.x0, Math.min(e.x1 - e.w, e.x)); }
      } else if (e.fly) {
        e.x += e.dir * e.speed * dt;
        if (e.x < e.x0) { e.x = e.x0; e.dir = 1; }
        if (e.x + e.w > e.x1) { e.x = e.x1 - e.w; e.dir = -1; }
        e.y = e.by + Math.sin(e.t * e.fr) * e.amp;
      }
      // player collision
      if (p.inv <= 0 && p.x < e.x + e.w && p.x + p.w > e.x && p.y < e.y + e.h && p.y + p.h > e.y) {
        const stomp = p.vy > 0 && (p.y + p.h) - e.y < e.h * 0.6;
        if (stomp) {
          e.alive = false; e.dead = 0.8; e.stomped = true;
          p.vy = input.jump ? -300 : -210;
          audio.stomp();
          p.coins += 2;
          popups.push({ x: e.x + e.w / 2, y: e.y - 4, text: '+2', life: 0.8 });
          burst(e.x + e.w / 2, e.y + e.h / 2, '#ffffff', 6);
        } else {
          hurtPlayer(p.x + p.w / 2 < e.x + e.w / 2 ? -1 : 1);
        }
      }
    }

    // ---- checkpoints
    for (const c of checkpoints) {
      if (!c.on && Math.abs(c.x + 9 - cx) < 18 && p.y + p.h > c.y - 90 && p.y < c.y + 40) {
        c.on = true; respawn = { x: c.x, y: c.y - 8 };
        audio.checkpoint();
        toast('CHECKPOINT', null, 1.5);
        burst(c.x + 9, c.y + 4, '#ffcb05', 10);
      }
    }
    // ---- triggers
    for (const t of L.triggers) {
      if (triggersDone[t.id]) continue;
      if (cx > t.x0 && cx < t.x1 && p.y + p.h > t.y0 && p.y + p.h < t.y1 + 2 && p.onGround) {
        triggersDone[t.id] = true;
        if (t.id === 'steppedM') { audio.sad(); toast('YOU STEPPED ON THE M!', 'legend says you will now fail your first blue book', 4); }
      }
    }
    // ---- section / music mood
    let mi = 0;
    for (let i = 0; i < L.moods.length; i++) if (cx >= L.moods[i].x) mi = i;
    if (mi !== moodIdx) {
      moodIdx = mi;
      audio.music.setMood(L.moods[mi].mood);
      toast(L.moods[mi].name, null, 2.2, 'section');
    }
    // ---- goal
    if (cx >= L.goalX) {
      state = 'won';
      audio.music.stop();
      audio.win();
      burst(p.x + 7, p.y, '#ffcb05', 20, 120);
      burst(p.x + 7, p.y, '#00274c', 20, 120);
    }

    updateFX(dt);

    // ---- camera
    const tx = Math.max(0, Math.min(WPX - VW, p.x + p.w / 2 - VW * 0.42));
    const ty = Math.max(0, Math.min(HPX - VH, p.y + p.h / 2 - VH * 0.58));
    cam.x += (tx - cam.x) * Math.min(1, dt * 9);
    cam.y += (ty - cam.y) * Math.min(1, dt * 5);
  }

  function updateFX(dt) {
    for (const q of particles) { q.life -= dt; q.vy += 300 * dt; q.x += q.vx * dt; q.y += q.vy * dt; }
    particles = particles.filter((q) => q.life > 0);
    for (const q of popups) { q.life -= dt; q.y -= 30 * dt; }
    popups = popups.filter((q) => q.life > 0);
    for (const q of toasts) q.life -= dt;
    toasts = toasts.filter((q) => q.life > 0);
  }

  // ---- render -------------------------------------------------------------------
  function render() {
    ctx.setTransform(S, 0, 0, S, 0, 0);
    ctx.imageSmoothingEnabled = false;
    const cx = Math.round(cam.x), cy = Math.round(cam.y);

    // sky
    const grad = ctx.createLinearGradient(0, 0, 0, VH);
    grad.addColorStop(0, '#9fd6ea');
    grad.addColorStop(0.55, '#e0f4f6');
    grad.addColorStop(1, '#e9f9f8');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, VW, VH);

    // far clouds band (Kenney background tiles 8..11, scaled 2x)
    {
      const s = 2, tw = 24 * s, px = 0.15, py = 0.2;
      const yb = 44 - cy * py;
      const ox = -((cx * px) % tw);
      for (let i = -1; i <= VW / tw + 1; i++) {
        const wx = Math.floor((cx * px) / tw) + i;
        const id = 8 + ((wx * 7 + 3) & 3);
        drawBg(id, ox + i * tw, yb, s);
      }
    }
    // tree line band (tiles 14/15, scaled 2x) + green fill beneath
    {
      const s = 2, tw = 24 * s, px = 0.3, py = 0.4;
      const yb = 238 - cy * py;
      const ox = -((cx * px) % tw);
      for (let i = -1; i <= VW / tw + 1; i++) {
        const wx = Math.floor((cx * px) / tw) + i;
        drawBg(14 + (wx & 1), ox + i * tw, yb, s);
      }
      ctx.fillStyle = '#2fb880';
      ctx.fillRect(0, yb + tw - 1, VW, VH);
    }
    // mid layer skyline (urban tileset, parallax)
    ctx.save();
    ctx.translate(-Math.round(cx * 0.5), -Math.round(cy * 0.6));
    for (const d of L.decor) {
      if (d.layer !== 'mid') continue;
      const sw = L.URBAN[d.id].w * d.s;
      if (d.x + sw < cx * 0.5 - 10 || d.x > cx * 0.5 + VW + 10) continue;
      drawUrban(d.id, d.x, d.y, d.s);
    }
    ctx.restore();

    // world layers
    ctx.save();
    ctx.translate(-cx, -cy);
    const vis = (x, w) => x + w >= cx - 20 && x <= cx + VW + 20;

    for (const d of L.decor) {
      if (d.layer !== 'near') continue;
      if (!vis(d.x, L.URBAN[d.id].w * d.s)) continue;
      drawUrban(d.id, d.x, d.y, d.s);
    }
    for (const r of L.rects) if (vis(r.x - 40, 160)) drawRect(r, 'near');
    for (const lb of L.labels) if (lb.layer === 'near' && vis(lb.x - 60, 200)) drawLabel(lb);
    for (const pr of L.props) if (vis(pr.x, 18)) drawTile(pr.t, pr.x, pr.y, pr.s);
    for (const sg of L.signs) if (vis(sg.x - 40, 100)) {
      drawTile(sg.tile, sg.x, sg.y);
      text(sg.text, sg.x + 9, sg.y - 12, { size: 6, align: 'center', color: '#fff', bg: '#5a3d2b', pad: 2 });
    }
    for (const c of checkpoints) if (vis(c.x, 18)) {
      drawTile(52, c.x, c.y); drawTile(52, c.x, c.y - 18);
      ctx.globalAlpha = c.on ? 1 : 0.35;
      drawTile(112, c.x + 6, c.y - 20 + (c.on ? Math.sin(time * 6) * 1.5 : 0));
      ctx.globalAlpha = 1;
      text('CHECKPOINT', c.x + 9, c.y - 32, { size: 5, align: 'center', color: c.on ? '#ffcb05' : '#fff', bg: '#00274c', pad: 2 });
    }

    // tiles
    const tx0 = Math.max(0, Math.floor(cx / T)), tx1 = Math.min(L.W - 1, Math.floor((cx + VW) / T));
    const ty0 = Math.max(0, Math.floor(cy / T)), ty1 = Math.min(L.H - 1, Math.floor((cy + VH) / T));
    for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
      const t = tilesRT[ty * L.W + tx];
      if (t >= 0) {
        if (t === 33) { // animated water top: bob slightly
          drawTile(33, tx * T, ty * T + Math.round(Math.sin(time * 2 + tx * 0.8)) );
        } else drawTile(t, tx * T, ty * T);
      }
    }
    for (const r of L.rects) if (vis(r.x - 40, 160)) drawRect(r, 'tiles');

    // coins
    for (const c of coins) {
      if (c.taken || !vis(c.x, 18)) continue;
      const bob = Math.sin(time * 4 + c.x * 0.05) * 1.5;
      const sq = Math.abs(Math.cos(time * 3 + c.x * 0.1));
      ctx.save();
      ctx.translate(c.x, c.y + bob);
      ctx.scale(0.5 + sq * 0.5, 1);
      drawTile(c.gem ? 67 : 151, -9, -9);
      ctx.restore();
    }
    // enemies
    for (const e of enemies) {
      if (!vis(e.x, e.w)) continue;
      if (!e.alive && e.dead <= 0) continue;
      const fr = e.frames[Math.floor(e.t * 6) % e.frames.length];
      const flip = e.dir > 0 ? (e.type === 'bat' ? Math.sin(e.t * 12) > 0 : true) : (e.type === 'bat' ? Math.sin(e.t * 12) > 0 : false);
      drawChar(fr, e.x + e.ox, e.y + e.oy, flip, !e.alive);
    }
    // player
    {
      const p = player;
      const blink = p.inv > 0 && Math.floor(p.inv * 12) % 2 === 0;
      if (!blink) {
        let fr = 6;
        if (!p.onGround) fr = 7; else if (Math.abs(p.vx) > 5) fr = Math.floor(p.anim) % 2 ? 7 : 6;
        drawChar(fr, p.x - 5, p.y - 1, p.facing < 0, p.dead > 0);
      }
    }
    // fx
    for (const q of particles) { ctx.fillStyle = q.color; ctx.globalAlpha = Math.min(1, q.life * 2); ctx.fillRect(Math.round(q.x), Math.round(q.y), q.size, q.size); }
    ctx.globalAlpha = 1;
    for (const q of popups) text(q.text, q.x, q.y, { size: 7, align: 'center', color: '#fff', outline: '#00274c' });
    for (const lb of L.labels) if (lb.layer === 'front' && vis(lb.x - 60, 200)) drawLabel(lb);
    ctx.restore();

    if (flash > 0) { ctx.fillStyle = `rgba(255,60,60,${flash})`; ctx.fillRect(0, 0, VW, VH); }

    drawHUD();
    if (state === 'title') drawTitle();
    if (state === 'credits') drawCredits();
    if (state === 'won') drawWon();
    if (state === 'gameover') drawGameOver();
    if (state === 'loading') { ctx.fillStyle = '#00274c'; ctx.fillRect(0, 0, VW, VH); text('loading...', VW / 2, VH / 2, { align: 'center', color: '#ffcb05', size: 10 }); }
  }

  function drawLabel(lb) {
    text(lb.text, lb.x, lb.y, { size: lb.size, color: lb.color, bg: lb.bg, pad: lb.pad, outline: lb.outline, lw: 3 });
  }

  function drawRect(r, pass) {
    if (pass === 'near') {
      if (r.kind === 'marquee') {
        ctx.fillStyle = '#7a1f1f'; ctx.fillRect(r.x, r.y, r.w, r.h);
        ctx.fillStyle = '#fff5d6'; ctx.fillRect(r.x + 3, r.y + 3, r.w - 6, r.h - 6);
        text(r.text, r.x + r.w / 2, r.y + 5, { size: 6, align: 'center', color: '#7a1f1f' });
        text(r.sub, r.x + r.w / 2, r.y + 14, { size: 4, align: 'center', color: '#333' });
        for (let i = 0; i < r.w; i += 6) { ctx.fillStyle = Math.floor(time * 4 + i / 6) % 2 ? '#ffe680' : '#ffb000'; ctx.fillRect(r.x + i + 2, r.y + 1, 2, 1); ctx.fillRect(r.x + i + 2, r.y + r.h - 2, 2, 1); }
        // marquee support
        ctx.fillStyle = '#444'; ctx.fillRect(r.x + r.w / 2 - 1, r.y + r.h, 2, L.G * T - r.y - r.h - 34);
      } else if (r.kind === 'streetsign') {
        ctx.fillStyle = '#555'; ctx.fillRect(r.x, r.y, 2, L.G * T - r.y);
        text(r.text, r.x + 2, r.y, { size: 5, color: '#fff', bg: '#1e7a3a', pad: 2 });
      } else if (r.kind === 'belfry') {
        ctx.fillStyle = '#3d4b63'; ctx.fillRect(r.x, r.y, r.w, r.h);
        ctx.fillStyle = '#26324a';
        for (let i = 0; i < 3; i++) ctx.fillRect(r.x + 8 + i * 20, r.y + 20, 12, 18);
        ctx.fillStyle = '#c8a24c'; ctx.fillRect(r.x - 3, r.y - 3, r.w + 6, 3);
        // clock
        const ccx = r.x + r.w / 2, ccy = r.y + 9;
        ctx.fillStyle = '#f4f1e6'; ctx.beginPath(); ctx.arc(ccx, ccy, 8, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#26324a'; ctx.lineWidth = 1; ctx.stroke();
        const mins = (levelTime / 60) % 60, hrs = 10 + levelTime / 3600;
        ctx.beginPath(); ctx.moveTo(ccx, ccy); ctx.lineTo(ccx + Math.sin(mins / 60 * Math.PI * 2) * 6, ccy - Math.cos(mins / 60 * Math.PI * 2) * 6); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(ccx, ccy); ctx.lineTo(ccx + Math.sin(hrs / 12 * Math.PI * 2) * 4, ccy - Math.cos(hrs / 12 * Math.PI * 2) * 4); ctx.stroke();
      } else if (r.kind === 'flagpole') {
        ctx.fillStyle = '#9aa3ad'; ctx.fillRect(r.x, r.y, 2, r.h);
        ctx.fillStyle = '#ffcb05'; ctx.beginPath(); ctx.arc(r.x + 1, r.y - 1, 3, 0, Math.PI * 2); ctx.fill();
      }
    } else if (pass === 'tiles') {
      if (r.kind === 'blockM') {
        ctx.fillStyle = '#00274c'; ctx.fillRect(r.x + 1, r.y + 1, 34, 8);
        text('M', r.x + 18, r.y + 1, { size: 8, align: 'center', color: '#ffcb05' });
      }
    }
  }

  function drawHUD() {
    if (state === 'loading' || state === 'title' || state === 'credits') return;
    const p = player;
    for (let i = 0; i < 3; i++) drawTile(i < p.hearts ? 44 : 46, 6 + i * 16, 5);
    drawTile(151, VW / 2 - 24, 4);
    text('x ' + p.coins, VW / 2 - 6, 8, { size: 8, color: '#fff', outline: '#00274c' });
    const m = Math.floor(levelTime / 60), s = Math.floor(levelTime % 60);
    text(`TIME ${m}:${s < 10 ? '0' : ''}${s}`, VW - 6, 8, { size: 8, align: 'right', color: '#fff', outline: '#00274c' });
    if (audio.muted) text('MUTED (M)', VW - 6, 20, { size: 5, align: 'right', color: '#ffcb05', outline: '#00274c' });
    // toasts
    for (const q of toasts) {
      const a = Math.min(1, q.life * 2, (q.max - q.life) * 4);
      const ty = q.slot === 'section' ? 30 : 52;
      ctx.globalAlpha = a;
      text(q.text, VW / 2, ty, { size: 11, align: 'center', color: '#ffcb05', outline: '#00274c', lw: 3 });
      if (q.sub) text(q.sub, VW / 2, ty + 14, { size: 6, align: 'center', color: '#fff', outline: '#00274c' });
      ctx.globalAlpha = 1;
    }
  }

  function overlay(a) { ctx.fillStyle = `rgba(0,39,76,${a})`; ctx.fillRect(0, 0, VW, VH); }
  function drawTitle() {
    overlay(0.72);
    text('SUPER ANN ARBOR', VW / 2, 42, { size: 26, align: 'center', color: '#ffcb05', outline: '#000', lw: 4 });
    text('a maize & blue platformer', VW / 2, 74, { size: 8, align: 'center', color: '#fff' });
    // little cast lineup
    drawChar(6, VW / 2 - 70, 96, false); drawChar(13, VW / 2 - 30, 96, true); drawChar(18, VW / 2 + 6, 96, true); drawChar(24, VW / 2 + 44, 94, true);
    text('you', VW / 2 - 58, 122, { size: 5, align: 'center', color: '#ffcb05' });
    text('diag squirrel', VW / 2 - 18, 122, { size: 5, align: 'center', color: '#fff' });
    text('parking bot', VW / 2 + 18, 130, { size: 5, align: 'center', color: '#fff' });
    text('river bat', VW / 2 + 56, 122, { size: 5, align: 'center', color: '#fff' });
    text('ARROWS / WASD move     SPACE / UP jump     M mute     R restart', VW / 2, 150, { size: 6, align: 'center', color: '#cfe3ff' });
    text('stomp enemies  •  bump ! chests  •  reach the Big House', VW / 2, 162, { size: 6, align: 'center', color: '#cfe3ff' });
    if (Math.floor(time * 2) % 2 === 0) text(document.body.classList.contains('touch') ? 'TAP TO START' : 'PRESS ENTER TO START', VW / 2, 190, { size: 10, align: 'center', color: '#ffcb05', outline: '#000' });
    text('C for credits', VW / 2, 212, { size: 6, align: 'center', color: '#fff' });
    text('art: Kenney (CC0)  •  urban tileset: Dlou Saiyan  •  music: live Web Audio', VW / 2, 252, { size: 5, align: 'center', color: '#9fb8d8' });
  }
  function drawCredits() {
    overlay(0.9);
    text('CREDITS', VW / 2, 16, { size: 16, align: 'center', color: '#ffcb05', outline: '#000', lw: 3 });
    if (IMG.urban) drawUrban(70, VW / 2 - 33, 36, 0.5);
    const lines = [
      ['Urban City Tileset', '© Dlou Saiyan — used with credit; not for resale or redistribution'],
      ['Pixel Platformer kit', 'Kenney (www.kenney.nl) — CC0'],
      ['Music & sound', 'generated live with the Web Audio API — a new tune every run'],
      ['Ann Arbor landmarks', 'lovingly approximated with generic buildings and painted signs'],
      ['Squirrels', 'no actual Diag squirrels were harmed'],
    ];
    let y = 110;
    for (const [h, b] of lines) {
      text(h, VW / 2, y, { size: 7, align: 'center', color: '#ffcb05' });
      text(b, VW / 2, y + 9, { size: 5, align: 'center', color: '#fff' });
      y += 24;
    }
    text('press ENTER / ESC to go back', VW / 2, 246, { size: 6, align: 'center', color: '#cfe3ff' });
  }
  function drawWon() {
    overlay(0.65);
    text('HAIL!', VW / 2, 50, { size: 30, align: 'center', color: '#ffcb05', outline: '#000', lw: 4 });
    text('you made it to the Big House', VW / 2, 88, { size: 9, align: 'center', color: '#fff' });
    const m = Math.floor(levelTime / 60), s = Math.floor(levelTime % 60);
    text(`coins: ${player.coins}     time: ${m}:${s < 10 ? '0' : ''}${s}     hearts left: ${player.hearts}`, VW / 2, 112, { size: 8, align: 'center', color: '#fff' });
    const all = coins.length, got = coins.filter((c) => c.taken).length;
    text(`${got} / ${all} collectibles found`, VW / 2, 128, { size: 7, align: 'center', color: '#cfe3ff' });
    if (triggersDone.steppedM) text('(you also stepped on the M. good luck on that blue book.)', VW / 2, 142, { size: 6, align: 'center', color: '#ffcb05' });
    if (Math.floor(time * 2) % 2 === 0) text('PRESS ENTER TO PLAY AGAIN', VW / 2, 180, { size: 9, align: 'center', color: '#ffcb05', outline: '#000' });
  }
  function drawGameOver() {
    overlay(0.7);
    text('GAME OVER', VW / 2, 70, { size: 24, align: 'center', color: '#ff6b6b', outline: '#000', lw: 4 });
    text('the parking bots win this round', VW / 2, 102, { size: 8, align: 'center', color: '#fff' });
    if (Math.floor(time * 2) % 2 === 0) text('PRESS ENTER TO CONTINUE FROM CHECKPOINT', VW / 2, 150, { size: 8, align: 'center', color: '#ffcb05', outline: '#000' });
  }

  // ---- screens / key handling ---------------------------------------------------
  function startAudio() {
    audio.init();
    audio.resume();
    if (audio.music && !audio.music.playing) audio.music.start();
  }
  function onKey(code) {
    if (code === 'KeyM') { if (!audio.ctx) audio.init(); audio.toggleMute(); return; }
    if (state === 'title') {
      if (code === 'KeyC') { state = 'credits'; return; }
      if (code === 'Enter' || code === 'Space' || code === 'KeyZ' || code === 'ArrowUp' || code === 'KeyW') {
        startAudio(); newGame(); state = 'playing'; input.jumpBuf = 0;
      }
    } else if (state === 'credits') {
      if (code === 'Enter' || code === 'Escape' || code === 'KeyC') state = 'title';
    } else if (state === 'playing') {
      if (code === 'KeyR') { newGame(); audio.music.stop(); startAudio(); }
    } else if (state === 'won') {
      if (code === 'Enter' || code === 'KeyR' || code === 'Space') { newGame(); startAudio(); state = 'playing'; input.jumpBuf = 0; }
    } else if (state === 'gameover') {
      if (code === 'Enter' || code === 'KeyR' || code === 'Space') {
        // continue from the last checkpoint with full hearts (coins kept)
        const keepCoins = player.coins, rs = respawn, cps = checkpoints.map((c) => c.on), td = triggersDone;
        newGame();
        player.coins = keepCoins; respawn = rs; player.x = rs.x; player.y = rs.y;
        checkpoints.forEach((c, i) => c.on = cps[i]); triggersDone = td;
        cam.x = Math.max(0, Math.min(WPX - VW, player.x - VW * 0.42));
        startAudio(); state = 'playing'; input.jumpBuf = 0;
      }
    }
  }

  // ---- tiny debug hook (used by the automated test harness; harmless otherwise)
  window.SUPER_A2 = {
    get state() { return state; }, get player() { return player; }, get cam() { return cam; }, get audio() { return audio; }, get enemies() { return enemies; },
    teleport(x, y) { if (player) { player.x = x; player.y = y; player.vx = 0; player.vy = 0; cam.x = Math.max(0, Math.min(WPX - VW, x - VW * 0.42)); cam.y = Math.max(0, Math.min(HPX - VH, y - VH * 0.58)); } },
  };

  // ---- main loop ---------------------------------------------------------------
  let last = 0, acc = 0;
  const STEP = 1 / 60;
  function frame(now) {
    requestAnimationFrame(frame);
    if (!last) last = now;
    let dt = (now - last) / 1000; last = now;
    if (dt > 0.1) dt = 0.1;
    acc += dt;
    while (acc >= STEP) { update(STEP); acc -= STEP; }
    render();
  }

  imagesReady.then(() => {
    newGame();
    state = 'title';
    requestAnimationFrame(frame);
  }).catch((err) => {
    state = 'loading';
    document.getElementById('err').textContent = err.message + ' — if you opened index.html directly, some browsers block local images; serve the folder over http instead.';
  });
})();
