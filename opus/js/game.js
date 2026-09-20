'use strict';
// ---------------------------------------------------------------------------
// SUPER ANNARIO — engine: input, physics, entities, camera, rendering, UI.
// ---------------------------------------------------------------------------
(() => {
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  R.ctx = ctx;
  const SCALE = 2;

  const SOLID = new Set(['S', 'G', 'R', 's', 'g', 'r', 'H', 'W', 'C', 'X', 'B', 'Q', 'U']);
  const HAZARD = new Set(['~', '=']);
  const GRAVITY = 1150;
  const MAX_FALL = 430;
  const T = (n) => n * TILE;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const approach = (v, target, amt) => (v < target ? Math.min(v + amt, target) : Math.max(v - amt, target));
  const overlap = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  const params = new URLSearchParams(location.search);

  // ---------------------------------------------------------------- layout
  const isTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0 && matchMedia('(pointer: coarse)').matches);
  if (isTouch) document.body.classList.add('touch');
  function fit() {
    const credits = document.getElementById('credits');
    const availW = window.innerWidth - 20;
    const availH = window.innerHeight - credits.offsetHeight - 26;
    const s = Math.max(0.25, Math.min(availW / 960, availH / 540));
    canvas.style.width = `${Math.floor(960 * s)}px`;
    canvas.style.height = `${Math.floor(540 * s)}px`;
  }
  window.addEventListener('resize', fit);
  fit();

  // ----------------------------------------------------------------- input
  const keys = {};
  const pressed = {};
  const KEYMAP = {
    ArrowLeft: ['left'], KeyA: ['left'], ArrowRight: ['right'], KeyD: ['right'],
    ArrowUp: ['up', 'jump'], KeyW: ['up', 'jump'], ArrowDown: ['down'], KeyS: ['down'],
    Space: ['jump', 'start'], KeyZ: ['jump'], KeyK: ['jump'],
    ShiftLeft: ['run'], ShiftRight: ['run'], KeyX: ['run'], KeyJ: ['run'],
    Enter: ['start'], NumpadEnter: ['start'], KeyP: ['pause'], Escape: ['pause'], KeyM: ['mute'], KeyC: ['credits'],
  };
  function press(action) {
    if (!keys[action]) pressed[action] = true;
    keys[action] = true;
  }
  function release(action) { keys[action] = false; }
  window.addEventListener('keydown', (e) => {
    const acts = KEYMAP[e.code];
    if (!acts) return;
    e.preventDefault();
    Sound.init();
    if (e.repeat) return;
    acts.forEach(press);
  });
  window.addEventListener('keyup', (e) => {
    const acts = KEYMAP[e.code];
    if (acts) acts.forEach(release);
  });
  window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

  const touchMap = { bL: ['left'], bR: ['right'], bB: ['run'], bA: ['jump', 'up'] };
  for (const [id, acts] of Object.entries(touchMap)) {
    const el = document.getElementById(id);
    const down = (e) => {
      e.preventDefault();
      Sound.init();
      el.setPointerCapture?.(e.pointerId);
      el.classList.add('on');
      acts.forEach(press);
      if (id === 'bA') pressed.start = true;
    };
    const up = (e) => {
      e.preventDefault();
      el.classList.remove('on');
      acts.forEach(release);
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('lostpointercapture', up);
  }
  canvas.addEventListener('pointerdown', (e) => {
    Sound.init();
    const r = canvas.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * VIEW_W;
    const y = ((e.clientY - r.top) / r.height) * VIEW_H;
    if (G.state === 'title' && y > VIEW_H - 40 && x > VIEW_W - 90) pressed.credits = true;
    else if (G.state === 'playing' && y < 20 && x > VIEW_W - 30) pressed.mute = true;
    else pressed.start = true;
  });

  // ----------------------------------------------------------------- state
  const G = {
    state: 'loading', t: 0, stateT: 0, loadP: 0,
    score: 0, coins: 0, lives: 3, time: 300, best: 0,
    L: null, ids: null, player: null, cam: 0, look: 0, shake: 0,
    enemies: [], items: [], coinsEnt: [], particles: [], movers: [], bumps: [],
    toast: null, zoneIdx: -1, zoneBanner: 0, checkpoint: false, stompChain: 0,
    cube: { angle: 0.4, spin: 0.5, bonus: false }, brassM: { stepped: false, done: false },
    goal: null, seen: new Set(), far: null, clouds: [], fwT: 0, stats: {},
  };
  try { G.best = parseInt(localStorage.getItem('annario.best') || '0', 10) || 0; } catch (e) { /* storage unavailable */ }

  // ------------------------------------------------------------- tile map
  const GROUND_BASE = { S: 100, G: 20, R: 60 };
  const FLOAT_BASE = { s: 80, g: 0, r: 40 };

  function mapAt(x, y) {
    const L = G.L;
    if (y < 0 || y >= L.h) return null;
    return L.map[y][clamp(x, 0, L.w - 1)];
  }
  function solidAt(tx, ty) {
    const L = G.L;
    if (tx < 0 || tx >= L.w) return true;
    if (ty < 0 || ty >= L.h) return false;
    const c = L.map[ty][tx];
    return c !== null && SOLID.has(c);
  }
  function computeId(x, y) {
    const c = G.L.map[y][x];
    if (!c) return -1;
    const is = (cc, fam) => cc !== null && fam.includes(cc);
    const lr = (fam) => {
      const l = is(mapAt(x - 1, y), fam);
      const r = is(mapAt(x + 1, y), fam);
      return [l, r];
    };
    switch (c) {
      case 'S': case 'G': case 'R': {
        const [l, r] = lr('SGR');
        const col = !l && !r ? 0 : !l ? 1 : !r ? 3 : 2;
        const top = !is(mapAt(x, y - 1), 'SGR');
        return top ? GROUND_BASE[c] + col : 120 + col;
      }
      case 's': case 'g': case 'r': {
        const [l, r] = lr('sgr');
        return FLOAT_BASE[c] + (!l && !r ? 0 : !l ? 1 : !r ? 3 : 2);
      }
      case 'H': {
        const [l, r] = lr('H');
        const up = is(mapAt(x, y - 1), 'H');
        const dn = is(mapAt(x, y + 1), 'H');
        if (!l && !r) return !up && !dn ? 16 : !up ? 36 : !dn ? 76 : 56;
        const col = !l ? 0 : !r ? 2 : 1;
        return (!up && !dn ? 77 : !up ? 17 : !dn ? 57 : 37) + col;
      }
      case 'W': {
        const [l, r] = lr('W');
        return !l && !r ? 47 : !l ? 48 : !r ? 50 : 49;
      }
      case 'X': {
        const [l, r] = lr('X');
        return !l && !r ? 12 : !l ? 14 : !r ? 15 : 13;
      }
      case 'C': return 47;
      case 'B': return 6;
      case 'Q': return 10;
      case 'U': return 9;
      case '~': return 53;
      case '=': return 73;
      default: return -1;
    }
  }
  function computeAllIds() {
    const L = G.L;
    G.ids = L.map.map((row, y) => row.map((_, x) => computeId(x, y)));
  }
  function setTile(tx, ty, c) {
    const L = G.L;
    L.map[ty][tx] = c;
    for (let y = ty - 1; y <= ty + 1; y++) {
      for (let x = tx - 1; x <= tx + 1; x++) {
        if (x >= 0 && x < L.w && y >= 0 && y < L.h) G.ids[y][x] = computeId(x, y);
      }
    }
  }

  // ------------------------------------------------------------- physics
  function moveBody(b, dt, nudge = false) {
    const res = { x: 0, y: 0, heads: null };
    b.x += b.vx * dt;
    let ty0 = Math.floor(b.y / TILE);
    let ty1 = Math.floor((b.y + b.h - 0.01) / TILE);
    if (b.vx > 0) {
      const tx = Math.floor((b.x + b.w - 0.01) / TILE);
      for (let ty = ty0; ty <= ty1; ty++) {
        if (solidAt(tx, ty)) { b.x = tx * TILE - b.w; b.vx = 0; res.x = 1; break; }
      }
    } else if (b.vx < 0) {
      const tx = Math.floor(b.x / TILE);
      for (let ty = ty0; ty <= ty1; ty++) {
        if (solidAt(tx, ty)) { b.x = (tx + 1) * TILE; b.vx = 0; res.x = -1; break; }
      }
    }
    b.y += b.vy * dt;
    b.onGround = false;
    const tx0 = Math.floor(b.x / TILE);
    const tx1 = Math.floor((b.x + b.w - 0.01) / TILE);
    if (b.vy > 0) {
      const ty = Math.floor((b.y + b.h - 0.01) / TILE);
      for (let tx = tx0; tx <= tx1; tx++) {
        if (solidAt(tx, ty)) { b.y = ty * TILE - b.h; b.vy = 0; b.onGround = true; res.y = 1; break; }
      }
    } else if (b.vy < 0) {
      const ty = Math.floor(b.y / TILE);
      let heads = [];
      for (let tx = tx0; tx <= tx1; tx++) if (solidAt(tx, ty)) heads.push(tx);
      if (nudge && heads.length === 1) {
        // corner correction: slide around a block edge you barely clipped
        const left = heads[0] * TILE;
        const right = left + TILE;
        if (b.x + b.w - left < 5 && !solidAt(heads[0] - 1, ty) && !solidAt(heads[0] - 1, ty + 1)) {
          b.x = left - b.w; heads = [];
        } else if (right - b.x < 5 && !solidAt(heads[0] + 1, ty) && !solidAt(heads[0] + 1, ty + 1)) {
          b.x = right; heads = [];
        }
      }
      if (heads.length) {
        b.y = (ty + 1) * TILE;
        b.vy = 0;
        res.y = -1;
        res.heads = heads.map((tx) => ({ tx, ty }));
      }
    }
    return res;
  }

  // ------------------------------------------------------------ entities
  const EN = {
    squirrel: { w: 11, h: 14, speed: 36, frames: [13, 14], anim: 0.18, foot: 20, smart: true, hop: true, label: 'DIAG SQUIRREL', score: 100 },
    parkbot: { w: 14, h: 12, speed: 26, frames: [18, 19, 20, 19], anim: 0.12, foot: 24, label: 'PARKING ENFORCEMENT', score: 100 },
    drone: { w: 14, h: 15, frames: [15, 16, 17, 16], anim: 0.07, foot: 24, fly: true, label: 'SURVEY DRONE', score: 200 },
    roller: { w: 22, h: 20, speed: 20, frames: [21, 22, 23, 22], anim: 0.1, foot: 24, smart: true, hp: 2, label: 'ROAD CREW ROLLER', score: 500 },
  };

  function spawnEntities() {
    const L = G.L;
    G.enemies = [];
    G.items = [];
    G.coinsEnt = [];
    G.movers = [];
    G.particles = [];
    G.bumps = [];
    for (const e of L.ents) {
      if (e.type === 'coin') {
        G.coinsEnt.push({ x: T(e.tx) + 3, y: T(e.ty) + 3, w: 12, h: 12, phase: e.tx * 0.5 });
      } else if (e.type === 'canoe') {
        G.movers.push({ x: T(e.tx), y: T(e.ty), x0: T(e.tx), x1: T(e.tx1), w: 54, h: 10, dir: 1, speed: e.speed, dx: 0 });
      } else {
        const def = EN[e.type];
        const en = {
          type: e.type, w: def.w, h: def.h, vx: 0, vy: 0, dir: -1, animT: Math.random(), hp: def.hp || 1,
          x: T(e.tx) + (TILE - def.w) / 2, y: T(e.ty + 1) - def.h, active: false, dead: false, hopT: 1 + Math.random() * 2,
        };
        if (def.fly) {
          en.baseX = en.x; en.baseY = T(e.ty); en.y = en.baseY; en.range = e.range || 3; en.t = Math.random() * 6;
        }
        G.enemies.push(en);
      }
    }
  }

  function addScore(n, x, y) {
    G.score += n;
    if (x !== undefined) G.particles.push({ kind: 'text', text: `${n}`, x, y, vy: -30, life: 0.9 });
  }
  function addCoins(n) {
    G.coins += n;
    while (G.coins >= 100) {
      G.coins -= 100;
      oneUp();
    }
  }
  function oneUp() {
    G.lives++;
    Sound.play('oneup');
    const p = G.player;
    G.particles.push({ kind: 'text', text: '1UP', x: p.x + p.w / 2, y: p.y - 6, vy: -25, life: 1.2, color: '#7CFC00' });
  }
  function toast(lines, secs = 3) { G.toast = { lines: Array.isArray(lines) ? lines : [lines], t: secs }; }

  function sparkle(x, y, n = 6, colors = ['#ffcb05', '#ffffff']) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 30 + Math.random() * 60;
      G.particles.push({ kind: 'spark', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, g: 60, life: 0.35 + Math.random() * 0.25, color: colors[i % colors.length] });
    }
  }

  // --------------------------------------------------------------- level
  function newGame(warpTile) {
    G.score = 0;
    G.coins = 0;
    G.lives = 3;
    G.checkpoint = false;
    G.seen = new Set();
    G.brassM = { stepped: false, done: false };
    G.cube.bonus = false;
    G.stats = { stomps: 0, bricks: 0, deaths: 0 };
    startLevel(warpTile);
  }

  function startLevel(warpTile) {
    G.L = buildLevel();
    const L = G.L;
    computeAllIds();
    spawnEntities();
    const sp = G.checkpoint ? L.checkpoint : L.start;
    G.player = {
      x: sp.x, y: sp.y, w: 12, h: 20, vx: 0, vy: 0, facing: 1, onGround: false, onMover: null,
      coyote: 0, jumpBuf: 0, hearts: 3, inv: 0, hype: 0, walk: 0, hidden: false,
    };
    if (warpTile) { G.player.x = T(warpTile); G.player.y = T(4); }
    if (G.brassM.done || G.brassM.stepped || G.checkpoint) {
      // the M's verdict survives a respawn
    }
    G.time = L.timeLimit;
    G.goal = null;
    G.toast = null;
    G.zoneIdx = -1;
    G.stompChain = 0;
    G.cam = clamp(G.player.x - VIEW_W / 2, 0, L.w * TILE - VIEW_W);
    G.look = 0;
    setState('playing');
    const zone = currentZone();
    Sound.setHype(false);
    Sound.startMusic(zone.mood);
  }

  function currentZone() {
    const zones = G.L.zones;
    let zi = 0;
    for (let i = 0; i < zones.length; i++) if (G.player.x >= zones[i].x) zi = i;
    return zones[zi];
  }

  function setState(s) {
    G.state = s;
    G.stateT = 0;
  }

  // -------------------------------------------------------------- update
  function update(dt) {
    G.t += dt;
    G.stateT += dt;
    if (pressed.mute) Sound.toggleMute();

    switch (G.state) {
      case 'title':
        if (pressed.credits) { setState('credits'); Sound.play('select'); break; }
        if (pressed.start && G.stateT > 0.2) {
          Sound.init();
          Sound.play('select');
          newGame(parseInt(params.get('warp') || '0', 10) || 0);
        }
        if (!Sound.isPlaying && (pressed.jump || pressed.left || pressed.right)) Sound.startMusic('title');
        break;
      case 'credits':
        if ((pressed.start || pressed.credits || pressed.pause) && G.stateT > 0.2) { setState('title'); Sound.play('select'); }
        break;
      case 'playing':
        if (pressed.pause) {
          setState('paused');
          Sound.play('pause');
          setTimeout(() => { if (G.state === 'paused') Sound.suspend(); }, 300);
          break;
        }
        updateWorld(dt);
        break;
      case 'paused':
        if (pressed.pause || pressed.start) { Sound.resume(); setState('playing'); }
        break;
      case 'dying':
        updateDying(dt);
        updateParticles(dt);
        break;
      case 'goal':
        updateGoal(dt);
        break;
      case 'clear':
        updateGoal(dt);
        if (pressed.start && G.stateT > 1.5) toTitle();
        break;
      case 'gameover':
        updateParticles(dt);
        if (pressed.start && G.stateT > 1.5) toTitle();
        break;
      default:
        break;
    }
  }

  function toTitle() {
    setState('title');
    Sound.setHype(false);
    Sound.startMusic('title');
  }

  function updateWorld(dt) {
    const L = G.L;
    const p = G.player;
    G.time -= dt;
    if (G.time <= 0) { G.time = 0; die('time'); return; }

    for (const m of G.movers) {
      const nx = clamp(m.x + m.dir * m.speed * dt, m.x0, m.x1);
      if (nx === m.x0 || nx === m.x1) m.dir *= -1;
      m.dx = nx - m.x;
      m.x = nx;
    }

    updatePlayer(dt);
    if (G.state !== 'playing') return;
    updateEnemies(dt);
    updateItems(dt);
    updateParticles(dt);
    updateCamera(dt);

    // zones & music
    const zones = L.zones;
    let zi = 0;
    for (let i = 0; i < zones.length; i++) if (p.x >= zones[i].x) zi = i;
    if (zi !== G.zoneIdx) {
      if (G.zoneIdx !== -1 || zi === 0) G.zoneBanner = 2.8;
      G.zoneIdx = zi;
      Sound.setMood(zones[zi].mood);
    }
    G.zoneBanner = Math.max(0, G.zoneBanner - dt);
    if (G.toast) { G.toast.t -= dt; if (G.toast.t <= 0) G.toast = null; }

    // checkpoint
    if (!G.checkpoint && p.x > L.checkpoint.x) {
      G.checkpoint = true;
      Sound.play('checkpoint');
      toast(['CHECKPOINT', 'Welcome to campus!'], 2);
      sparkle(L.checkpoint.x + 9, GROUND_Y - 50, 12);
    }

    // The Cube
    const cb = L.cube;
    const nearCube = Math.abs(p.x + p.w / 2 - cb.x) < 24 && p.y + p.h > GROUND_Y - 30;
    if (nearCube && (pressed.up || Math.abs(p.vx) > 150) && G.cube.spin < 4) {
      G.cube.spin = 10;
      Sound.play('whoosh');
      if (!G.cube.bonus) {
        G.cube.bonus = true;
        addScore(250, cb.x, GROUND_Y - 60);
        toast(['YOU SPUN THE CUBE!', 'A time-honored campus tradition. +250'], 3);
      }
    }
    G.cube.spin = approach(G.cube.spin, 0.5, 2.2 * dt);
    G.cube.angle += G.cube.spin * dt;

    // The brass M
    const m = L.brassM;
    const pc = p.x + p.w / 2;
    if (!G.brassM.stepped && !G.brassM.done && p.onGround && pc > m.x0 && pc < m.x1 && Math.abs(p.y + p.h - GROUND_Y) < 1) {
      G.brassM.stepped = true;
      Sound.play('trombone');
      toast(['YOU STEPPED ON THE BRASS M!', 'Legend says you’ll fail your first blue book exam.'], 4.5);
    }
    if (!G.brassM.stepped && !G.brassM.done && p.x > m.x1 + 24) {
      G.brassM.done = true;
      addScore(500, p.x + p.w / 2, p.y - 8);
      Sound.play('select');
      toast(['YOU AVOIDED THE M!  +500', 'Your GPA is safe... for now.'], 3);
    }

    // goal
    const pole = L.pole;
    if (p.x + p.w >= T(pole.tx) - 1 && p.x <= T(pole.tx + 1) && p.y + p.h > T(pole.topTy)) grabPole();
  }

  function updatePlayer(dt) {
    const p = G.player;
    if (p.onMover) p.x += p.onMover.dx;

    const ax = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
    const maxV = (keys.run ? 172 : 110) * (p.hype > 0 ? 1.15 : 1);
    const accel = p.onGround ? 850 : 600;
    if (ax !== 0) {
      const turning = p.vx !== 0 && Math.sign(p.vx) !== ax;
      if (Math.abs(p.vx) <= maxV || turning) {
        p.vx += ax * accel * (turning ? 1.9 : 1) * dt;
        p.vx = clamp(p.vx, -Math.max(maxV, Math.abs(p.vx) * (turning ? 1 : 0)), Math.max(maxV, Math.abs(p.vx) * (turning ? 1 : 0)));
      } else {
        p.vx = approach(p.vx, ax * maxV, 400 * dt);
      }
      p.facing = ax;
    } else {
      p.vx = approach(p.vx, 0, (p.onGround ? 760 : 220) * dt);
    }

    if (pressed.jump) p.jumpBuf = 0.13; else p.jumpBuf -= dt;
    if (p.onGround) p.coyote = 0.09; else p.coyote -= dt;
    if (p.jumpBuf > 0 && p.coyote > 0) {
      p.vy = Math.abs(p.vx) > 140 ? -452 : -425;
      p.jumpBuf = 0;
      p.coyote = 0;
      p.onGround = false;
      p.onMover = null;
      Sound.play('jump');
    }
    const g = p.vy < 0 && !keys.jump ? GRAVITY * 2.4 : GRAVITY;
    p.vy = Math.min(p.vy + g * dt, MAX_FALL);

    const prevBottom = p.y + p.h;
    const hit = moveBody(p, dt, true);
    if (hit.heads) bumpHeads(hit.heads);

    p.onMover = null;
    if (p.vy >= 0) {
      for (const m of G.movers) {
        if (p.x + p.w > m.x + 1 && p.x < m.x + m.w - 1 && prevBottom <= m.y + 1 && p.y + p.h >= m.y) {
          p.y = m.y - p.h;
          p.vy = 0;
          p.onGround = true;
          p.onMover = m;
        }
      }
    }
    if (p.onGround) G.stompChain = 0;

    p.walk += Math.abs(p.vx) * dt / 11;
    p.inv = Math.max(0, p.inv - dt);
    if (p.hype > 0) {
      p.hype -= dt;
      if (Math.random() < 0.5) {
        G.particles.push({ kind: 'spark', x: p.x + Math.random() * p.w, y: p.y + Math.random() * p.h, vx: 0, vy: -20, g: 0, life: 0.4, color: Math.random() < 0.5 ? '#ffcb05' : '#4ea8ff' });
      }
      if (p.hype <= 0) { p.hype = 0; Sound.setHype(false); }
    }

    // enemies
    for (const e of G.enemies) {
      if (!e.active || e.dead || !overlap(p, e)) continue;
      if (p.hype > 0) { killFlip(e, p); continue; }
      const fromAbove = p.vy > 0 && prevBottom <= e.y + Math.max(6, e.h * 0.5);
      if (fromAbove) {
        stomp(e);
        p.y = e.y - p.h;
      } else {
        hurt(e);
      }
    }

    // coins
    for (const c of G.coinsEnt) {
      if (!c.got && overlap(p, c)) {
        c.got = true;
        addCoins(1);
        G.score += 100;
        Sound.play('coin');
        sparkle(c.x + 6, c.y + 6, 5);
      }
    }

    // hazards
    const htx = Math.floor((p.x + p.w / 2) / TILE);
    const hty = Math.floor((p.y + p.h - 3) / TILE);
    if (hty >= 0 && hty < G.L.h && HAZARD.has(mapAt(htx, hty))) { die('water'); return; }
    if (p.y > VIEW_H + 16) die('pit');
  }

  function bumpHeads(heads) {
    const p = G.player;
    const pc = p.x + p.w / 2;
    heads.sort((a, b) => Math.abs(T(a.tx) + 9 - pc) - Math.abs(T(b.tx) + 9 - pc));
    const { tx, ty } = heads[0];
    const L = G.L;
    const c = L.map[ty][tx];
    const key = `${tx},${ty}`;
    G.bumps.push({ tx, ty, t: 0 });

    for (const e of G.enemies) {
      if (!e.dead && Math.abs(e.y + e.h - T(ty)) < 3 && e.x + e.w > T(tx) && e.x < T(tx + 1)) killFlip(e, p);
    }
    for (const it of G.items) {
      if (Math.abs(it.y + it.h - T(ty)) < 3 && it.x + it.w > T(tx) && it.x < T(tx + 1)) { it.vy = -220; }
    }

    if (c === 'Q') {
      const what = L.contents[key] || 'coin';
      if (what === 'multi') {
        L.multi = L.multi || {};
        L.multi[key] = (L.multi[key] ?? 7) - 1;
        popCoin(tx, ty);
        if (L.multi[key] <= 0) setTile(tx, ty, 'U');
      } else {
        setTile(tx, ty, 'U');
        if (what === 'coin') popCoin(tx, ty);
        else if (what === 'gem') popGem(tx, ty);
        else spawnItem(what, tx, ty);
      }
    } else if (c === 'B') {
      setTile(tx, ty, null);
      G.stats.bricks++;
      addScore(50);
      Sound.play('brick');
      for (let i = 0; i < 4; i++) {
        G.particles.push({
          kind: 'debris', x: T(tx) + (i % 2) * 9, y: T(ty) + (i >> 1) * 9, sx: (i % 2) * 9, sy: (i >> 1) * 9,
          vx: (i % 2 ? 1 : -1) * (40 + Math.random() * 30), vy: -260 + (i >> 1) * 90, g: GRAVITY, life: 1.2, rot: 0, vr: (Math.random() - 0.5) * 12,
        });
      }
    } else {
      Sound.play('bump');
    }
  }

  function popCoin(tx, ty) {
    addCoins(1);
    G.score += 200;
    Sound.play('coin');
    G.particles.push({ kind: 'coinpop', tile: 151, x: T(tx), y: T(ty) - 18, vy: -300, g: 1100, life: 0.5, pts: 200 });
  }
  function popGem(tx, ty) {
    addCoins(5);
    G.score += 1000;
    Sound.play('gem');
    G.particles.push({ kind: 'coinpop', tile: 67, x: T(tx), y: T(ty) - 18, vy: -300, g: 900, life: 0.65, pts: 1000 });
  }
  function spawnItem(kind, tx, ty) {
    const p = G.player;
    G.items.push({ kind, x: T(tx) + 3, y: T(ty), w: 12, h: 12, vx: 0, vy: 0, emerge: 12, dir: p.x + p.w / 2 < T(tx) + 9 ? 1 : -1 });
    Sound.play('sprout');
  }

  function updateItems(dt) {
    const p = G.player;
    for (const it of G.items) {
      if (it.emerge > 0) {
        const d = 24 * dt;
        it.y -= d;
        it.emerge -= d;
        if (it.emerge <= 0) it.vx = it.dir * (it.kind === 'hype' ? 70 : 45);
        continue;
      }
      it.vy = Math.min(it.vy + GRAVITY * dt, MAX_FALL);
      const hit = moveBody(it, dt);
      if (hit.x) { it.dir = -hit.x; it.vx = it.dir * (it.kind === 'hype' ? 70 : 45); }
      if (it.kind === 'hype' && it.onGround) it.vy = -270;
      if (it.y > VIEW_H + 20) it.gone = true;
      if (overlap(p, it)) {
        it.gone = true;
        collectItem(it);
      }
    }
    G.items = G.items.filter((i) => !i.gone);
  }

  function collectItem(it) {
    const p = G.player;
    if (it.kind === 'heart') {
      if (p.hearts < 3) { p.hearts++; toast('+1 HEART ♥', 1.6); } else { addScore(1000, p.x + p.w / 2, p.y - 4); }
      Sound.play('heart');
      sparkle(p.x + 6, p.y + 6, 10, ['#ff4d6d', '#ffffff']);
    } else if (it.kind === 'hype') {
      p.hype = 10;
      Sound.play('powerup');
      Sound.setHype(true);
      toast(['GAME DAY HYPE!', 'Invincible for 10 seconds. GO BLUE!'], 2.5);
      sparkle(p.x + 6, p.y + 6, 14, ['#ffcb05', '#4ea8ff']);
    } else if (it.kind === 'oneup') {
      oneUp();
      toast('EXTRA LIFE!', 1.6);
    }
    addScore(1000);
  }

  function stomp(e) {
    const p = G.player;
    e.hp--;
    const pts = [100, 200, 400, 800, 1000, 2000, 4000, 8000][Math.min(G.stompChain, 7)];
    G.stompChain++;
    if (G.stompChain >= 9) oneUp();
    addScore(pts, e.x + e.w / 2, e.y - 4);
    if (e.hp > 0) {
      e.angry = true;
      e.flash = 0.5;
      Sound.play('bump');
    } else {
      e.dead = true;
      e.deadMode = 'squash';
      e.deadT = 0.45;
      G.stats.stomps++;
      Sound.play('stomp');
      sparkle(e.x + e.w / 2, e.y + e.h / 2, 5, ['#ffffff', '#cbd5e1']);
    }
    p.vy = keys.jump ? -430 : -250;
  }

  function killFlip(e, src) {
    if (e.dead) return;
    e.dead = true;
    e.deadMode = 'flip';
    e.deadT = 2;
    e.vy = -230;
    e.vx = (e.x + e.w / 2 < src.x + src.w / 2 ? -1 : 1) * 50;
    G.stats.stomps++;
    Sound.play('stomp');
    addScore(EN[e.type].score, e.x + e.w / 2, e.y - 4);
  }

  function hurt(src) {
    const p = G.player;
    if (p.inv > 0 || p.hype > 0 || G.state !== 'playing') return;
    p.hearts--;
    if (p.hearts <= 0) { die('hit'); return; }
    p.inv = 1.6;
    p.vy = -220;
    p.vx = (p.x + p.w / 2 < src.x + src.w / 2 ? -1 : 1) * 150;
    G.shake = 0.25;
    Sound.play('hurt');
  }

  function die(reason) {
    if (G.state !== 'playing') return;
    const p = G.player;
    setState('dying');
    G.stats.deaths++;
    p.hearts = 0;
    p.hype = 0;
    p.vx = 0;
    p.vy = reason === 'water' || reason === 'pit' ? -200 : -380;
    G.dieReason = reason;
    Sound.stopMusic();
    Sound.setHype(false);
    if (reason === 'water') {
      Sound.play('splash');
      for (let i = 0; i < 14; i++) {
        G.particles.push({ kind: 'spark', x: p.x + p.w / 2, y: T(13), vx: (Math.random() - 0.5) * 140, vy: -80 - Math.random() * 160, g: 700, life: 0.8, color: i % 2 ? '#bfefff' : '#2dc6f6' });
      }
    }
    Sound.play('die');
    if (reason === 'time') toast('TIME UP!', 3);
  }

  function updateDying(dt) {
    const p = G.player;
    if (G.stateT > 0.45) {
      p.vy += GRAVITY * 0.8 * dt;
      p.y += p.vy * dt;
    }
    if (G.stateT > 3) {
      G.lives--;
      if (G.lives < 0) {
        setState('gameover');
        saveBest();
      } else {
        startLevel();
      }
    }
  }

  function updateEnemies(dt) {
    const camR = G.cam + VIEW_W + 36;
    for (const e of G.enemies) {
      if (e.removed) continue;
      if (!e.active) {
        if (e.x < camR) {
          e.active = true;
          if (!G.seen.has(e.type)) { G.seen.add(e.type); e.labelT = 2.8; }
        } else continue;
      }
      if (e.labelT) e.labelT = Math.max(0, e.labelT - dt);
      if (e.flash) e.flash = Math.max(0, e.flash - dt);
      if (e.dead) {
        e.deadT -= dt;
        if (e.deadMode === 'flip') {
          e.vy += GRAVITY * dt;
          e.y += e.vy * dt;
          e.x += e.vx * dt;
        }
        if (e.deadT <= 0) e.removed = true;
        continue;
      }
      const def = EN[e.type];
      e.animT += dt;
      if (e.x < G.cam - 240) continue; // far behind: sleep
      if (def.fly) {
        e.t += dt;
        const nx = e.baseX + Math.sin(e.t * 1.1) * e.range * TILE;
        e.dir = nx >= e.x ? 1 : -1;
        e.x = nx;
        e.y = e.baseY + Math.sin(e.t * 2.6) * 6;
        continue;
      }
      e.vy = Math.min(e.vy + GRAVITY * dt, MAX_FALL);
      e.vx = e.dir * def.speed * (e.angry ? 2.2 : 1);
      const hit = moveBody(e, dt);
      if (hit.x) e.dir = -hit.x;
      if (def.smart && e.onGround) {
        const ax = e.dir > 0 ? e.x + e.w + 1 : e.x - 1;
        if (!solidAt(Math.floor(ax / TILE), Math.floor((e.y + e.h + 2) / TILE))) e.dir *= -1;
      }
      if (def.hop && e.onGround) {
        e.hopT -= dt;
        if (e.hopT <= 0) { e.vy = -200; e.hopT = 1.2 + Math.random() * 2.2; }
      }
      if (e.y > VIEW_H + 30) e.removed = true;
    }
    // walkers turn around when they bump into each other
    const act = G.enemies.filter((e) => e.active && !e.dead && !e.removed && !EN[e.type].fly);
    for (let i = 0; i < act.length; i++) {
      for (let j = i + 1; j < act.length; j++) {
        const a = act[i];
        const b = act[j];
        if (overlap(a, b)) {
          if (a.x < b.x) { a.dir = -1; b.dir = 1; } else { a.dir = 1; b.dir = -1; }
        }
      }
    }
    G.enemies = G.enemies.filter((e) => !e.removed);
  }

  function updateParticles(dt) {
    for (const pt of G.particles) {
      pt.life -= dt;
      if (pt.g) pt.vy += pt.g * dt;
      pt.x += (pt.vx || 0) * dt;
      pt.y += (pt.vy || 0) * dt;
      if (pt.vr) pt.rot += pt.vr * dt;
      if (pt.kind === 'coinpop' && pt.life <= 0) {
        G.particles.push({ kind: 'text', text: `${pt.pts}`, x: pt.x + 9, y: pt.y, vy: -30, life: 0.7 });
      }
      if (pt.kind === 'rocket' && pt.life <= 0) {
        Sound.play('firework');
        const cols = [['#ffcb05', '#fff3b0'], ['#4ea8ff', '#dbeafe'], ['#ffcb05', '#4ea8ff']][Math.floor(Math.random() * 3)];
        for (let i = 0; i < 36; i++) {
          const a = (i / 36) * Math.PI * 2;
          const s = 50 + Math.random() * 50;
          G.particles.push({ kind: 'spark', x: pt.x, y: pt.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, g: 50, life: 1 + Math.random() * 0.5, color: cols[i % 2], big: true });
        }
      }
    }
    G.particles = G.particles.filter((pt) => pt.life > 0);
    for (const b of G.bumps) b.t += dt;
    G.bumps = G.bumps.filter((b) => b.t < 0.2);
  }

  function updateCamera(dt) {
    const p = G.player;
    const L = G.L;
    G.look = approach(G.look, p.facing * 28, 70 * dt);
    const target = clamp(p.x + p.w / 2 - VIEW_W / 2 + G.look, 0, L.w * TILE - VIEW_W);
    G.cam += (target - G.cam) * Math.min(1, dt * 7);
    G.shake = Math.max(0, G.shake - dt);
  }

  // ---------------------------------------------------------------- goal
  function grabPole() {
    const p = G.player;
    const L = G.L;
    const top = T(L.pole.topTy);
    const bottom = T(L.pole.baseTy);
    const frac = 1 - clamp((p.y + p.h - top) / (bottom - top), 0, 1);
    const pts = frac > 0.92 ? 5000 : frac > 0.66 ? 2000 : frac > 0.4 ? 800 : frac > 0.15 ? 400 : 100;
    p.x = T(L.pole.tx) + 9 - p.w - 1;
    p.vx = 0;
    p.vy = 0;
    p.hype = 0;
    p.inv = 0;
    Sound.stopMusic();
    Sound.setHype(false);
    Sound.play('flagpole');
    addScore(pts, p.x, p.y - 4);
    G.goal = { phase: 'slide', flagY: top, t: 0, fireworks: 0, heightPts: pts };
    G.toast = null;
    setState('goal');
  }

  function updateGoal(dt) {
    const p = G.player;
    const L = G.L;
    const gl = G.goal;
    gl.t += dt;
    for (const m of G.movers) m.dx = 0;
    updateEnemies(dt);
    updateParticles(dt);
    updateCamera(dt);
    switch (gl.phase) {
      case 'slide': {
        const bottom = T(L.pole.baseTy);
        p.y = Math.min(p.y + 150 * dt, bottom - p.h);
        gl.flagY = Math.min(gl.flagY + 150 * dt, bottom - 20);
        if (p.y >= bottom - p.h && gl.flagY >= bottom - 20) { gl.phase = 'hop'; gl.t = 0; }
        break;
      }
      case 'hop':
        if (gl.t > 0.35) {
          gl.phase = 'walk';
          p.x = T(L.pole.tx) + 11;
          p.facing = 1;
          Sound.play('clear');
        }
        break;
      case 'walk':
        p.vx = 72;
        p.vy = Math.min(p.vy + GRAVITY * dt, MAX_FALL);
        moveBody(p, dt);
        p.walk += 72 * dt / 11;
        if (p.x > L.entranceX) { gl.phase = 'enter'; gl.t = 0; p.hidden = true; }
        break;
      case 'enter':
        if (gl.t > 0.8) { gl.phase = 'tally'; gl.t = 0; }
        break;
      case 'tally': {
        const n = Math.min(Math.ceil(G.time), 4);
        if (n > 0) {
          G.time = Math.max(0, Math.ceil(G.time) - n);
          G.score += n * 50;
          if (Math.floor(gl.t * 30) % 2 === 0) Sound.play('tick');
        } else {
          gl.phase = 'fireworks';
          gl.t = 0;
        }
        break;
      }
      case 'fireworks':
        if (gl.t > 0.5) {
          gl.t = 0;
          gl.fireworks++;
          launchRocket();
          if (gl.fireworks >= 6) {
            gl.phase = 'done';
            saveBest();
            setState('clear');
          }
        }
        break;
      case 'done':
        G.fwT -= dt;
        if (G.fwT <= 0) { G.fwT = 1.2 + Math.random(); launchRocket(); }
        break;
      default:
        break;
    }
  }

  function launchRocket() {
    const x = G.cam + 60 + Math.random() * (VIEW_W - 120);
    G.particles.push({ kind: 'rocket', x, y: GROUND_Y, vx: (Math.random() - 0.5) * 30, vy: -220 - Math.random() * 60, g: 120, life: 0.9 + Math.random() * 0.3 });
  }

  function saveBest() {
    if (G.score > G.best) {
      G.best = G.score;
      G.newBest = true;
      try { localStorage.setItem('annario.best', String(G.best)); } catch (e) { /* ignore */ }
    }
  }

  // -------------------------------------------------------------- render
  function buildBackdrop() {
    // Far skyline (prerendered, hazed) — generic urban sprites at a distance.
    const f = 0.3;
    const L = G.L;
    const w = Math.ceil((L.w * TILE - VIEW_W) * f + VIEW_W) + 60;
    const cv = document.createElement('canvas');
    cv.width = w * SCALE;
    cv.height = VIEW_H * SCALE;
    const c = cv.getContext('2d');
    c.imageSmoothingEnabled = false;
    c.scale(SCALE, SCALE);
    const saved = R.ctx;
    R.ctx = c;
    let seed = 1824;
    const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    let x = -10;
    const base = GROUND_Y + 8;
    while (x < w) {
      const k = Math.floor(rand() * 7);
      if (k === 0) { R.urban(12, x, base, 0.42); x += 42; }
      else if (k === 1) { R.urban(55, x, base, 0.36); x += 47; }
      else if (k === 2) { R.urban(63, x, base, 0.5); R.urban(72, x - 7, base - 71, 0.3); x += 34; }
      else if (k === 3) { R.urban(0, x, base, 0.34); x += 50; }
      else if (k === 4) { R.urban(64, x, base, 0.62); R.urban(69, x + 6, base - 88, 0.3); x += 42; }
      else if (k === 5) { R.urban(29, x, base, 0.3); x += 44; }
      else { R.urban(50, x, base, 0.42); R.urban(12, x + 22, base, 0.34); x += 56; }
      x += rand() * 10 - 2;
    }
    c.globalCompositeOperation = 'source-atop';
    c.fillStyle = 'rgba(196,228,242,0.58)';
    c.fillRect(0, 0, w, VIEW_H);
    R.ctx = saved;
    G.far = cv;
    G.farF = f;

    G.clouds = [];
    for (let i = 0; i < 12; i++) {
      G.clouds.push({ x: rand() * 900, y: 24 + rand() * 80, n: 2 + Math.floor(rand() * 3) });
    }
  }

  const lerp = (a, b, k) => a + (b - a) * k;
  const mix = (c1, c2, k) => `rgb(${Math.round(lerp(c1[0], c2[0], k))},${Math.round(lerp(c1[1], c2[1], k))},${Math.round(lerp(c1[2], c2[2], k))})`;

  function drawSky(cam) {
    const L = G.L;
    const prog = Math.pow(clamp(cam / (L.w * TILE - VIEW_W), 0, 1), 1.6);
    const grd = ctx.createLinearGradient(0, 0, 0, VIEW_H);
    grd.addColorStop(0, mix([70, 160, 222], [74, 92, 170], prog));
    grd.addColorStop(0.62, mix([170, 222, 240], [240, 170, 130], prog));
    grd.addColorStop(1, mix([223, 246, 245], [250, 204, 130], prog));
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    // sun
    const sy = lerp(40, 120, prog);
    ctx.fillStyle = mix([255, 250, 220], [255, 190, 90], prog);
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    ctx.arc(390 - cam * 0.02, sy, 16, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    // Kenney clouds
    const wrap = VIEW_W + 160;
    for (const cl of G.clouds) {
      let x = (cl.x - cam * 0.1 - G.t * 4) % wrap;
      if (x < 0) x += wrap;
      x -= 80;
      R.tile(153, x, cl.y);
      for (let i = 1; i < cl.n - 1; i++) R.tile(154, x + i * TILE, cl.y);
      R.tile(155, x + (cl.n - 1) * TILE, cl.y);
    }
    return prog;
  }

  function drawBurton(x) {
    const c = ctx;
    const bw = 44;
    const base = GROUND_Y;
    const shaftTop = base - 122;
    R.urbanFill(49, x, shaftTop, bw, 122, 0.3);
    c.save();
    c.globalCompositeOperation = 'multiply';
    c.fillStyle = '#e8d9b5';
    c.fillRect(x, shaftTop, bw, 122);
    c.restore();
    c.fillStyle = 'rgba(40,40,70,0.55)';
    for (let i = 0; i < 3; i++) c.fillRect(x + 9 + i * 11, shaftTop + 14, 4, 92);
    c.fillStyle = '#d4c29c';
    c.fillRect(x - 3, shaftTop - 28, bw + 6, 28);
    c.fillStyle = '#b8a67f';
    c.fillRect(x - 4, shaftTop - 2, bw + 8, 3);
    c.fillRect(x + 3, shaftTop - 40, bw - 6, 12);
    c.fillStyle = '#a3936d';
    c.fillRect(x + 11, shaftTop - 50, bw - 22, 10);
    c.fillStyle = '#6f9a86';
    c.beginPath();
    c.moveTo(x + 13, shaftTop - 50);
    c.lineTo(x + bw / 2, shaftTop - 62);
    c.lineTo(x + bw - 13, shaftTop - 50);
    c.fill();
    // clock face with the player's real local time
    const cx = x + bw / 2;
    const cy = shaftTop - 14;
    c.fillStyle = '#fbf6e6';
    c.beginPath();
    c.arc(cx, cy, 10, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = '#3b3322';
    c.lineWidth = 1.2;
    c.stroke();
    const now = new Date();
    const hr = ((now.getHours() % 12) + now.getMinutes() / 60) / 12 * Math.PI * 2;
    const mn = (now.getMinutes() / 60) * Math.PI * 2;
    c.beginPath();
    c.moveTo(cx, cy);
    c.lineTo(cx + Math.sin(hr) * 5, cy - Math.cos(hr) * 5);
    c.moveTo(cx, cy);
    c.lineTo(cx + Math.sin(mn) * 8, cy - Math.cos(mn) * 8);
    c.stroke();
    R.board('BURTON TOWER', cx, shaftTop + 26, { size: 5, bg: '#00274c', fg: '#ffcb05', border: '#ffcb05', pad: 2 });
  }

  function drawCube(cube, t) {
    const c = ctx;
    const cx = G.L.cube.x;
    c.fillStyle = '#4b5563';
    c.fillRect(cx - 4, GROUND_Y - 12, 8, 12);
    c.fillStyle = '#374151';
    c.fillRect(cx - 12, GROUND_Y - 3, 24, 3);
    const r = 17;
    const cy = GROUND_Y - 12 - r + 2;
    const a = cube.angle;
    const shades = ['#1f2229', '#3a3f4b', '#5b6170'];
    for (let k = 0; k < 3; k++) {
      const th = a + (k * Math.PI * 2) / 3;
      const p1 = [cx + Math.cos(th) * r, cy + Math.sin(th) * r];
      const p2 = [cx + Math.cos(th + Math.PI / 3) * r, cy + Math.sin(th + Math.PI / 3) * r];
      const p3 = [cx + Math.cos(th + (2 * Math.PI) / 3) * r, cy + Math.sin(th + (2 * Math.PI) / 3) * r];
      c.fillStyle = shades[k];
      c.beginPath();
      c.moveTo(cx, cy);
      c.lineTo(...p1);
      c.lineTo(...p2);
      c.lineTo(...p3);
      c.closePath();
      c.fill();
      c.strokeStyle = '#0b0c10';
      c.lineWidth = 1;
      c.stroke();
    }
    // a little glint of the sun on the steel
    c.fillStyle = 'rgba(255,255,255,0.25)';
    c.fillRect(cx + Math.cos(a * 3) * 6 - 1, cy - 6, 2, 2);
  }

  function drawTiles(cam) {
    const L = G.L;
    const tx0 = Math.max(0, Math.floor(cam / TILE));
    const tx1 = Math.min(L.w - 1, Math.ceil((cam + VIEW_W) / TILE));
    const bumpOff = {};
    for (const b of G.bumps) bumpOff[`${b.tx},${b.ty}`] = -Math.sin((b.t / 0.2) * Math.PI) * 5;
    for (let ty = 0; ty < L.h; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const id = G.ids[ty][tx];
        if (id < 0) continue;
        const c = L.map[ty][tx];
        if (HAZARD.has(c)) continue;
        const off = bumpOff[`${tx},${ty}`] || 0;
        R.tile(id, T(tx), T(ty) + off);
        if (c === 'U') {
          ctx.fillStyle = 'rgba(40,20,10,0.35)';
          ctx.fillRect(T(tx) + 1, T(ty) + 1 + off, 16, 16);
        } else if (c === 'Q') {
          const glow = (Math.sin(G.t * 5 + tx) + 1) * 0.08;
          ctx.fillStyle = `rgba(255,255,255,${glow})`;
          ctx.fillRect(T(tx) + 2, T(ty) + 2 + off, 14, 14);
        }
      }
    }
    // brass M, set into the Diag walkway
    const m = L.brassM;
    if (m.x1 > cam && m.x0 < cam + VIEW_W) {
      const mx = (m.x0 + m.x1) / 2;
      ctx.fillStyle = '#8a6a2f';
      ctx.fillRect(m.x0 + 2, GROUND_Y - 1, m.x1 - m.x0 - 4, 4);
      ctx.fillStyle = G.brassM.stepped ? '#9a7b45' : '#e0b84a';
      ctx.fillRect(m.x0 + 3, GROUND_Y - 1, m.x1 - m.x0 - 6, 2);
      R.text('M', mx, GROUND_Y + 9, { size: 11, color: '#ffcb05', outline: '#00274c', outlineW: 3 });
      if (!G.brassM.stepped && Math.sin(G.t * 4) > 0.7) {
        ctx.fillStyle = '#fff';
        ctx.fillRect(m.x0 + 6 + ((G.t * 30) % (m.x1 - m.x0 - 12)), GROUND_Y - 2, 2, 1);
      }
    }
  }

  function drawWater(cam) {
    const L = G.L;
    const tx0 = Math.max(0, Math.floor(cam / TILE));
    const tx1 = Math.min(L.w - 1, Math.ceil((cam + VIEW_W) / TILE));
    ctx.globalAlpha = 0.88;
    for (let ty = 0; ty < L.h; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const c = L.map[ty][tx];
        if (!HAZARD.has(c)) continue;
        const bob = c === '~' ? Math.round(Math.sin(G.t * 2.5 + tx * 0.8) * 1.2) : 0;
        R.tile(G.ids[ty][tx], T(tx), T(ty) + bob);
        if (c === '~') R.tile(73, T(tx), T(ty) + 18 + bob - 4);
      }
    }
    ctx.globalAlpha = 1;
  }

  function drawPole() {
    const L = G.L;
    const px = T(L.pole.tx);
    for (let ty = L.pole.topTy; ty < L.pole.baseTy; ty++) R.tile(52, px, T(ty));
    ctx.fillStyle = '#ffcb05';
    ctx.beginPath();
    ctx.arc(px + 9, T(L.pole.topTy) - 2, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#00274c';
    ctx.stroke();
    const fy = G.goal ? G.goal.flagY : T(L.pole.topTy) + 2;
    R.tile(Math.floor(G.t * 3) % 2 ? 111 : 112, px - 12, fy, true);
    R.text('GOAL', px + 9, T(L.pole.topTy) - 12, { size: 6, color: '#ffcb05', outline: '#00274c', outlineW: 2.5 });
  }

  function drawCheckpoint() {
    const cp = G.L.checkpoint;
    const x = cp.x + 4;
    for (let ty = 9; ty < 12; ty++) R.tile(52, x, T(ty));
    ctx.globalAlpha = G.checkpoint ? 1 : 0.55;
    R.tile(Math.floor(G.t * 3) % 2 ? 111 : 112, x + 9, G.checkpoint ? T(8) + 4 : T(10) + 6);
    ctx.globalAlpha = 1;
  }

  function drawEntities(cam) {
    const inView = (o, m = 30) => o.x + (o.w || 18) > cam - m && o.x < cam + VIEW_W + m;
    // canoes
    for (const m of G.movers) {
      if (!inView(m, 60)) continue;
      const bob = Math.sin(G.t * 3) * 0.8;
      R.tile(48, m.x, m.y + bob);
      R.tile(49, m.x + 18, m.y + bob);
      R.tile(50, m.x + 36, m.y + bob);
      R.text('ARGO', m.x + 27, m.y + 10 + bob, { size: 6, color: '#ffe9a8', outline: '#3b1d10', outlineW: 2 });
    }
    // coins
    for (const c of G.coinsEnt) {
      if (c.got || !inView(c)) continue;
      const sx = Math.abs(Math.cos(G.t * 4 + c.phase));
      ctx.save();
      ctx.translate(c.x + 6, c.y + 6);
      ctx.scale(Math.max(0.2, sx), 1);
      ctx.drawImage(Assets.tiles[151], -9, -9);
      ctx.restore();
    }
    // enemies
    for (const e of G.enemies) {
      if (!e.active || !inView(e)) continue;
      const def = EN[e.type];
      const fr = def.frames[Math.floor(e.animT / def.anim) % def.frames.length];
      const dx = e.x + e.w / 2 - 12;
      const dy = e.y + e.h - def.foot;
      if (e.flash && Math.floor(G.t * 20) % 2) continue;
      if (e.dead && e.deadMode === 'squash') {
        R.char(fr, dx, dy + (24 - def.foot), e.dir > 0, 0.4);
      } else if (e.dead) {
        R.char(fr, dx, dy - 24 + (24 - def.foot) * 2, e.dir > 0, -1);
      } else {
        R.char(fr, dx, dy, e.dir > 0);
        if (e.angry && Math.floor(G.t * 8) % 2) {
          R.text('!', e.x + e.w / 2, e.y - 6, { size: 9, color: '#ef4444', outline: '#fff', outlineW: 2 });
        }
      }
      if (e.labelT > 0) {
        ctx.globalAlpha = Math.min(1, e.labelT);
        R.board(def.label, e.x + e.w / 2, e.y - 22, { size: 5, bg: '#111827', fg: '#ffffff', border: '#ffcb05', pad: 2 });
        ctx.globalAlpha = 1;
      }
    }
    // player
    const p = G.player;
    if (p && !p.hidden) {
      const blink = p.inv > 0 && Math.floor(G.t * 18) % 2 === 0;
      if (!blink) {
        let fr = 6;
        if (G.state === 'dying') fr = 7;
        else if (!p.onGround) fr = 7;
        else if (Math.abs(p.vx) > 8) fr = Math.floor(p.walk) % 2 ? 7 : 6;
        const dx = p.x + p.w / 2 - 12;
        const dy = p.y + p.h - 24;
        R.char(fr, dx, dy, p.facing < 0);
        if (p.hype > 0 && Math.floor(G.t * 12) % 2) {
          ctx.save();
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = p.hype < 2 ? 0.35 : 0.6;
          R.char(fr, dx, dy, p.facing < 0);
          ctx.restore();
        }
      }
    }
  }

  function drawParticles() {
    for (const pt of G.particles) {
      if (pt.kind === 'spark') {
        ctx.globalAlpha = Math.min(1, pt.life * 2.5);
        ctx.fillStyle = pt.color;
        const s = pt.big ? 2 : 1.5;
        ctx.fillRect(pt.x - s / 2, pt.y - s / 2, s, s);
        ctx.globalAlpha = 1;
      } else if (pt.kind === 'rocket') {
        ctx.fillStyle = '#fff3b0';
        ctx.fillRect(pt.x - 1, pt.y - 1, 2, 3);
        if (Math.random() < 0.7) G.particles.push({ kind: 'spark', x: pt.x, y: pt.y + 3, vx: (Math.random() - 0.5) * 10, vy: 20, life: 0.3, color: '#ffb347' });
      } else if (pt.kind === 'debris') {
        ctx.save();
        ctx.translate(pt.x + 4.5, pt.y + 4.5);
        ctx.rotate(pt.rot);
        ctx.drawImage(Assets.tiles[6], pt.sx, pt.sy, 9, 9, -4.5, -4.5, 9, 9);
        ctx.restore();
      } else if (pt.kind === 'coinpop') {
        R.tile(pt.tile, pt.x, pt.y);
      } else if (pt.kind === 'text') {
        ctx.globalAlpha = Math.min(1, pt.life * 2);
        R.text(pt.text, pt.x, pt.y, { size: 6, color: pt.color || '#ffffff', outline: '#1f2937', outlineW: 2 });
        ctx.globalAlpha = 1;
      }
    }
  }

  function drawDecoList(list, cam) {
    for (const d of list) {
      if (d.x1 < cam - 140 || d.x0 > cam + VIEW_W + 140) continue;
      d.draw(ctx, G.t, G);
    }
  }

  function drawWorld(cam) {
    const L = G.L;
    ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
    ctx.imageSmoothingEnabled = false;
    drawSky(cam);
    // far skyline
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(G.far, -Math.round(cam * G.farF * SCALE), 0);
    // mid layer: Burton Tower
    const fMid = 0.55;
    ctx.setTransform(SCALE, 0, 0, SCALE, -Math.round(cam * fMid * SCALE), 0);
    const burtonWorldX = T(84);
    drawBurton(VIEW_W / 2 + (burtonWorldX - VIEW_W / 2) * fMid);

    let sx = 0;
    let sy = 0;
    if (G.shake > 0) { sx = (Math.random() - 0.5) * 4; sy = (Math.random() - 0.5) * 4; }
    ctx.setTransform(SCALE, 0, 0, SCALE, -Math.round((cam + sx) * SCALE), Math.round(sy * SCALE));
    drawDecoList(L.deco.back, cam);
    drawCube(G.cube, G.t);
    drawCheckpoint();
    drawPole();
    for (const it of G.items) {
      if (it.kind === 'heart') R.tile(44, it.x - 3, it.y - 3);
      else if (it.kind === 'hype') R.tile(68, it.x - 3, it.y - 5);
      else if (it.kind === 'oneup') {
        ctx.drawImage(Assets.chars[11], it.x - 2, it.y - 4, 16, 16);
      }
    }
    drawTiles(cam);
    drawEntities(cam);
    drawWater(cam);
    drawDecoList(L.deco.front, cam);
    drawParticles();
  }

  function pad(n, len) { return String(Math.max(0, Math.floor(n))).padStart(len, '0'); }

  function drawHUD() {
    const p = G.player;
    ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
    ctx.fillStyle = 'rgba(0,20,52,0.62)';
    ctx.fillRect(0, 0, VIEW_W, 20);
    ctx.fillStyle = '#ffcb05';
    ctx.fillRect(0, 20, VIEW_W, 1);
    R.text('SCORE', 8, 10.5, { size: 6, align: 'left', color: '#ffcb05' });
    R.digits(pad(G.score, 7), 36, 4);
    R.tile(151, 104, 1);
    R.text('×', 124, 10.5, { size: 7, color: '#fff' });
    R.digits(pad(G.coins, 2), 132, 4);
    for (let i = 0; i < 3; i++) R.tile(i < p.hearts ? 44 : 46, 162 + i * 15, 1);
    ctx.drawImage(Assets.chars[6], 220, 2, 16, 16);
    R.text('×', 241, 10.5, { size: 7, color: '#fff' });
    R.digits(pad(Math.max(0, G.lives), 2), 249, 4);
    const zone = G.L.zones[Math.max(0, G.zoneIdx)];
    R.text(zone.name, 340, 10.5, { size: 6, color: '#dbeafe' });
    R.text('TIME', 406, 10.5, { size: 6, align: 'left', color: '#ffcb05' });
    const tl = Math.ceil(G.time);
    if (tl > 60 || Math.floor(G.t * 4) % 2 || G.state !== 'playing') R.digits(pad(tl, 3), 434, 4);
    R.text(Sound.muted ? '♪̸' : '♪', 472, 10.5, { size: 8, color: Sound.muted ? '#f87171' : '#9ca3af' });
    if (p.hype > 0) {
      ctx.fillStyle = '#00274c';
      ctx.fillRect(170, 23, 140, 6);
      ctx.fillStyle = Math.floor(G.t * 10) % 2 ? '#ffcb05' : '#4ea8ff';
      ctx.fillRect(171, 24, 138 * (p.hype / 10), 4);
      R.text('HYPE', 240, 34, { size: 5, color: '#ffcb05', outline: '#00274c' });
    }
    if (G.zoneBanner > 0 && G.state === 'playing') {
      const a = Math.min(1, G.zoneBanner * 2, (2.8 - G.zoneBanner) * 4);
      ctx.globalAlpha = a;
      R.board([zone.name, zone.sub], VIEW_W / 2, 44, { size: 11, subSize: 6, bg: 'rgba(0,39,76,0.9)', fg: '#ffcb05', subFg: '#ffffff', border: '#ffcb05', pad: 6 });
      ctx.globalAlpha = 1;
    }
    if (G.toast) {
      const a = Math.min(1, G.toast.t * 3);
      ctx.globalAlpha = a;
      R.board(G.toast.lines, VIEW_W / 2, G.zoneBanner > 0 ? 84 : 44, { size: 8, subSize: 6, bg: 'rgba(17,24,39,0.92)', fg: '#ffffff', subFg: '#ffcb05', border: '#ffffff', pad: 6 });
      ctx.globalAlpha = 1;
    }
  }

  function overlay(alpha = 0.55) {
    ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
    ctx.fillStyle = `rgba(4,12,32,${alpha})`;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  }

  function drawLogo(y) {
    const wob = Math.sin(G.t * 2) * 1.5;
    R.text('SUPER', VIEW_W / 2, y - 26 + wob, { size: 16, color: '#ffffff', outline: '#00274c', outlineW: 5 });
    R.text('ANNARIO', VIEW_W / 2 + 2, y + 4 + wob + 2, { size: 44, color: '#00274c', weight: '900', font: 'Impact, "Arial Black", "Trebuchet MS", sans-serif' });
    R.text('ANNARIO', VIEW_W / 2, y + 4 + wob, { size: 44, color: '#ffcb05', outline: '#00274c', outlineW: 6, weight: '900', font: 'Impact, "Arial Black", "Trebuchet MS", sans-serif' });
  }

  function drawTitle() {
    overlay(0.62);
    drawLogo(78);
    R.text('AN ANN ARBOR PLATFORMER  ·  LEVEL 1-1: A DAY IN TREE TOWN', VIEW_W / 2, 118, { size: 7, color: '#ffffff', outline: '#00274c', outlineW: 3 });
    if (Math.floor(G.t * 2) % 2 === 0) {
      R.text(isTouch ? 'TAP TO START' : 'PRESS ENTER TO START', VIEW_W / 2, 146, { size: 11, color: '#ffcb05', outline: '#00274c', outlineW: 4 });
    }
    ctx.fillStyle = 'rgba(4,12,32,0.72)';
    ctx.fillRect(VIEW_W / 2 - 196, 164, 392, 66);
    const lines = isTouch
      ? ['◀ ▶ MOVE    ▲ JUMP    RUN = SPRINT']
      : ['ARROWS / WASD  MOVE        SPACE / Z / ↑  JUMP        SHIFT / X  RUN', 'P  PAUSE        M  MUTE        ↑ AT THE CUBE  SPIN IT'];
    lines.forEach((ln, i) => R.text(ln, VIEW_W / 2, 176 + i * 11, { size: 6, color: '#e5e7eb', outline: '#0b1530', outlineW: 2.5 }));
    R.text('Stomp parking bots & Diag squirrels. Grab coins. Reach the Big House. Don’t step on the M.', VIEW_W / 2, 204, { size: 6, color: '#bfdbfe', outline: '#0b1530', outlineW: 2.5 });
    if (G.best > 0) R.text(`BEST ${pad(G.best, 7)}`, VIEW_W / 2, 222, { size: 7, color: '#ffcb05', outline: '#0b1530', outlineW: 2.5 });
    R.board('C  CREDITS', VIEW_W - 44, VIEW_H - 26, { size: 6, bg: 'rgba(0,39,76,0.9)', fg: '#ffcb05', border: '#ffcb05', pad: 3 });
    R.text('Art: Urban City Tileset by Dlou Saiyan · Pixel Platformer by Kenney (CC0)', 8, VIEW_H - 8, { size: 5, align: 'left', color: '#cbd5e1', outline: '#0b1530', outlineW: 2 });
  }

  function drawCredits() {
    overlay(0.82);
    R.text('CREDITS', VIEW_W / 2, 26, { size: 16, color: '#ffcb05', outline: '#00274c', outlineW: 5 });
    // The asset artist's own billboard sprite belongs here, on the credits screen.
    R.urban(70, 40, 160, 0.8);
    const lx = 170;
    const rows = [
      ['URBAN CITY TILESET', '#ffcb05'],
      ['© Dlou Saiyan — dlousaiyan.com', '#ffffff'],
      ['', ''],
      ['PIXEL PLATFORMER', '#ffcb05'],
      ['Kenney — kenney.nl (CC0)', '#ffffff'],
      ['', ''],
      ['GAME, LEVEL & PROCEDURAL CHIPTUNES', '#ffcb05'],
      ['Handmade JavaScript + Web Audio API', '#ffffff'],
    ];
    rows.forEach(([txt, col], i) => { if (txt) R.text(txt, lx, 58 + i * 13, { size: 8, align: 'left', color: col }); });
    R.text('Ann Arbor landmarks appear as affectionate low-fi parody signage.', VIEW_W / 2, 196, { size: 6, color: '#cbd5e1' });
    R.text('No affiliation with the University of Michigan or any business named or winked at.', VIEW_W / 2, 208, { size: 6, color: '#cbd5e1' });
    R.text('Squirrels were not consulted.', VIEW_W / 2, 220, { size: 6, color: '#94a3b8' });
    if (Math.floor(G.t * 2) % 2 === 0) R.text('PRESS ENTER / TAP TO GO BACK', VIEW_W / 2, 248, { size: 8, color: '#ffcb05' });
  }

  function drawPaused() {
    overlay(0.5);
    R.text('PAUSED', VIEW_W / 2, 118, { size: 22, color: '#ffcb05', outline: '#00274c', outlineW: 5 });
    R.text('P / ENTER TO RESUME   ·   M TO MUTE', VIEW_W / 2, 146, { size: 7, color: '#ffffff', outline: '#00274c', outlineW: 3 });
  }

  function drawGameOver() {
    overlay(Math.min(0.75, G.stateT));
    R.text('GAME OVER', VIEW_W / 2, 100, { size: 26, color: '#ffcb05', outline: '#00274c', outlineW: 6 });
    R.text('The Diag squirrels win this round.', VIEW_W / 2, 128, { size: 8, color: '#ffffff' });
    R.text(`SCORE ${pad(G.score, 7)}${G.newBest ? '   NEW BEST!' : ''}`, VIEW_W / 2, 150, { size: 9, color: '#ffffff' });
    if (G.stateT > 1.5 && Math.floor(G.t * 2) % 2 === 0) R.text('PRESS ENTER / TAP', VIEW_W / 2, 180, { size: 9, color: '#ffcb05' });
  }

  function drawClear() {
    const a = Math.min(0.6, G.stateT);
    overlay(a);
    const y = 54;
    R.text('LEVEL CLEAR!', VIEW_W / 2, y, { size: 24, color: '#ffcb05', outline: '#00274c', outlineW: 6 });
    R.text('GO BLUE!', VIEW_W / 2, y + 28 + Math.sin(G.t * 5) * 2, { size: 16, color: '#ffffff', outline: '#00274c', outlineW: 5 });
    const s = G.stats;
    const rows = [
      ['SCORE', pad(G.score, 7) + (G.newBest ? '  NEW BEST!' : '')],
      ['FLAGPOLE', `${G.goal.heightPts}`],
      ['COINS LEFT OVER', `${G.coins}`],
      ['ENEMIES BONKED', `${s.stomps}`],
      ['BRICKS BROKEN', `${s.bricks}`],
      ['BRASS M', G.brassM.stepped ? 'STEPPED ON IT (uh oh)' : 'AVOIDED'],
      ['THE CUBE', G.cube.bonus ? 'SPUN' : 'UNSPUN'],
    ];
    rows.forEach(([k, v], i) => {
      R.text(k, VIEW_W / 2 - 8, 116 + i * 13, { size: 7, align: 'right', color: '#bfdbfe', outline: '#0b1530', outlineW: 2 });
      R.text(v, VIEW_W / 2 + 8, 116 + i * 13, { size: 7, align: 'left', color: '#ffffff', outline: '#0b1530', outlineW: 2 });
    });
    if (G.stateT > 1.5 && Math.floor(G.t * 2) % 2 === 0) R.text('Thanks for visiting Ann Arbor!  PRESS ENTER / TAP', VIEW_W / 2, 214, { size: 7, color: '#ffcb05', outline: '#0b1530', outlineW: 2.5 });
  }

  function drawLoading() {
    ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
    ctx.fillStyle = '#0b1530';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    R.text('LOADING ANN ARBOR...', VIEW_W / 2, 120, { size: 10, color: '#ffcb05' });
    ctx.fillStyle = '#1e3a8a';
    ctx.fillRect(140, 140, 200, 8);
    ctx.fillStyle = '#ffcb05';
    ctx.fillRect(141, 141, 198 * G.loadP, 6);
  }

  function render() {
    ctx.imageSmoothingEnabled = false;
    if (G.state === 'loading') { drawLoading(); return; }
    if (G.state === 'title' || G.state === 'credits') {
      const span = T(70);
      G.cam = (Math.sin(G.t * 0.05 - Math.PI / 2) * 0.5 + 0.5) * span;
      const saved = G.player;
      G.player = null;
      drawWorld(G.cam);
      G.player = saved;
      if (G.state === 'title') drawTitle(); else drawCredits();
      return;
    }
    const cam = Math.round(G.cam * SCALE) / SCALE;
    drawWorld(cam);
    drawHUD();
    if (G.state === 'paused') drawPaused();
    else if (G.state === 'gameover') drawGameOver();
    else if (G.state === 'clear') drawClear();
  }

  // ------------------------------------------------------------ main loop
  let last = performance.now();
  let acc = 0;
  const STEP = 1 / 60;
  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    acc += dt;
    while (acc >= STEP) {
      update(STEP);
      acc -= STEP;
      for (const k in pressed) pressed[k] = false;
    }
    render();
    requestAnimationFrame(frame);
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && G.state === 'playing') {
      setState('paused');
      Sound.suspend();
    }
  });

  Assets.load((p) => { G.loadP = p; }).then(() => {
    G.L = buildLevel();
    computeAllIds();
    spawnEntities();
    buildBackdrop();
    G.player = null;
    setState('title');
    if (params.has('autostart')) newGame(parseInt(params.get('warp') || '0', 10) || 0);
  });
  requestAnimationFrame(frame);

  // Small hook for automated testing / curious players.
  window.ANNARIO = { G, keys, pressed, newGame, startLevel };
})();
