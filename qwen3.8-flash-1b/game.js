/* game.js — "DIAG DASH: An Ann Arbor Sprint"
 * A single-level browser platformer. Classic run-and-jump feel with coyote time,
 * jump buffering, stomp chains, a coffee "fury" power-up and text-signage landmarks.
 * Scenery art: urban city tileset (credit: Dlou Saiyan). Gameplay tiles/sprites are
 * drawn at runtime by art.js because the Kenney kit named in ASSETS.md is not present.
 */
(function () {
  'use strict';

  var VIEW_W = 960, VIEW_H = 544, TILE = 32;

  /* ---- physics ------------------------------------------------------- */
  var GRAV = 1700, JUMP_V = -720, CUT_VY = -240;
  var WALK_MAX = 200, RUN_MAX = 320, FURY_MULT = 1.18;
  var ACCEL = 1500, AIR_ACCEL = 1150, FRICTION = 1500;
  var COYOTE = 0.10, JUMP_BUFFER = 0.13;
  var STOMP_BOUNCE = -430, FURY_STOMP = -520;
  var PW = 20, PH = 26;
  var FURY_TIME = 11;

  /* ---- DOM ----------------------------------------------------------- */
  var canvas = document.getElementById('game');
  var ctx = null;
  var sheet = new Image();          /* urban tileset (art: Dlou Saiyan) */
  var sheetReady = false;
  var domOverlay = document.getElementById('overlay');
  var btnMute = document.getElementById('btn-mute');
  var btnPause = document.getElementById('btn-pause');
  var btnRestart = document.getElementById('btn-restart');

  /* ---- world state --------------------------------------------------- */
  var L = null;                    /* level data */
  var SOLID = {};                  /* tile codes that block movement */
  var state = 'title';             /* title | playing | paused | flag | dying | end | over */
  var stateT = 0;                  /* seconds in current state */
  var cam = { x: 0, shake: 0 };
  var keys = { left: false, right: false, run: false, jump: false };
  var jumpHeld = false;

  var player, enemies, pickups, particles, pops, clouds, bumps, debris;
  var hearts, lives, coins, score, elapsed, furyT, chain, invulnT, respawnAt;
  var respawnDelay = 1.6, fullRestore = true, deathMsg = '';
  var flagY = 0, won = false, stats = null;
  var animFrame = 0, animT = 0;

  /* ==================================================================== */
  function boot() {
    ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ART.build();
    L = LEVEL.make();
    var c = L.codes;
    SOLID = {};
    [c.T_CONC_TOP, c.T_CONC_FILL, c.T_BRICK_TOP, c.T_BRICK_FILL, c.T_GRASS_TOP,
     c.T_DIRT, c.T_HEDGE, c.T_WOOD, c.T_BRICKBLOCK, c.T_MBLOCK, c.T_USED, c.T_STONE]
      .forEach(function (v) { SOLID[v] = true; });

    clouds = [];
    var r = rndSeed(99);
    for (var i = 0; i < 26; i++) {
      clouds.push({ x: r() * L.W, y: 30 + r() * 190, w: 60 + r() * 120, h: 22 + r() * 26, s: 0.25 + r() * 0.35 });
    }

    sheet.onload = function () { sheetReady = true; };
    sheet.onerror = function () { sheetReady = false; };
    sheet.src = './urbantileset/urbantileset32x32.png';

    bindInput();
    resetRun(true);
    requestAnimationFrame(loop);
  }

  function rndSeed(seed) {
    var s = seed >>> 0;
    return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  }

  function resetRun(toTitle) {
    player = {
      x: L.spawn.x, y: L.TOP * TILE - PH, vx: 0, vy: 0, dir: 1,
      onGround: false, coyote: 0, jbuf: 0, jumping: false, doubleReady: false, frame: 'idle', prevJump: false, hadGround: false
    };
    enemies = L.enemies.map(function (e) {
      return {
        kind: e.kind, x: e.x0, y: e.y - (e.bob ? 6 : 0), vx: e.kind === 'drone' ? 85 : (e.kind === 'roverRed' ? 105 : (e.kind === 'squirrel' ? 95 : 70)),
        x0: e.x0, x1: e.x1, fly: !!e.bob, dead: false, t: Math.random() * 6, dir: 1, w: e.kind === 'drone' ? 22 : 18, h: e.kind === 'drone' ? 14 : 14
      };
    });
    pickups = L.pickups.map(function (p) { return { type: p.type, x: p.tx * TILE + 9, y: p.ty * TILE + 9, taken: false, t: Math.random() * 6 }; });
    particles = []; pops = []; debris = []; bumps = {};
    hearts = 3; lives = 3; coins = 0; score = 0; elapsed = 0; furyT = 0; chain = 0; invulnT = 0;
    respawnAt = { x: L.spawn.x, y: L.TOP * TILE - PH };
    flagY = 0; won = false; stats = null;
    cam.x = Math.max(0, Math.min(L.W - VIEW_W, player.x - VIEW_W / 3));
    if (!toTitle) { state = 'playing'; SOUND.music.start(); }
  }

  /* ==================================================================== */
  /* input                                                                */
  /* ==================================================================== */
  function bindInput() {
    window.addEventListener('keydown', onKey, { passive: false });
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', function () { keys.left = keys.right = keys.run = false; jumpHeld = false; });

    btnMute.addEventListener('click', function () { toggleMute(); });
    btnPause.addEventListener('click', function () { togglePause(); });
    btnRestart.addEventListener('click', function () { SOUND.sfx.play('select'); resetRun(false); });

    /* touch buttons */
    [['btn-left', 'left'], ['btn-right', 'right'], ['btn-jump', 'jump']].forEach(function (pair) {
      var el = document.getElementById(pair[0]);
      if (!el) return;
      var down = function (ev) { ev.preventDefault(); setKey(pair[1], true); firstGesture(); };
      var up = function (ev) { ev.preventDefault(); setKey(pair[1], false); };
      el.addEventListener('pointerdown', down);
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
      el.addEventListener('pointerleave', up);
    });

    canvas.addEventListener('pointerdown', function () { firstGesture(); if (state !== 'playing' && state !== 'paused') confirmAction(); });
  }

  function setKey(k, v) {
    if (k === 'jump') { keys.jump = v; jumpHeld = v; }
    else keys[k] = v;
  }

  function onKey(e) {
    var k = e.key;
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' ', 'Space'].indexOf(k) >= 0) e.preventDefault();
    firstGesture();
    switch (k) {
      case 'ArrowLeft': case 'a': case 'A': setKey('left', true); break;
      case 'ArrowRight': case 'd': case 'D': setKey('right', true); break;
      case 'Shift': case 'z': case 'Z': case 'b': case 'B': setKey('run', true); break;
      case ' ': case 'Space': case 'ArrowUp': case 'w': case 'W': case 'x': case 'X': setKey('jump', true); break;
      default:
        if (k === 'p' || k === 'P') togglePause();
        else if (k === 'm' || k === 'M') toggleMute();
        else if (k === 'r' || k === 'R') { resetRun(false); }
        else if (k === 'Enter') confirmAction();
    }
  }
  function onKeyUp(e) {
    switch (e.key) {
      case 'ArrowLeft': case 'a': case 'A': setKey('left', false); break;
      case 'ArrowRight': case 'd': case 'D': setKey('right', false); break;
      case 'Shift': case 'z': case 'Z': case 'b': case 'B': setKey('run', false); break;
      case ' ': case 'Space': case 'ArrowUp': case 'w': case 'W': case 'x': case 'X': setKey('jump', false); break;
    }
  }

  var audioStarted = false;
  function firstGesture() {
    if (audioStarted) return;
    audioStarted = true;
    SOUND.music.start();
  }

  var muted = false;
  function toggleMute() {
    muted = !muted;
    SOUND.music.setMuted(muted);
    btnMute.textContent = muted ? '🔇' : '🔊';
    btnMute.classList.toggle('off', muted);
  }

  function togglePause() {
    if (state === 'playing') { state = 'paused'; SOUND.sfx.play('select'); }
    else if (state === 'paused') { state = 'playing'; SOUND.sfx.play('select'); }
    btnPause.textContent = state === 'paused' ? '▶' : '⏸';
  }

  function confirmAction() {
    if (state === 'title') { startGame(); return; }
    if (state === 'end' || state === 'over') { resetRun(false); SOUND.sfx.play('select'); return; }
    if (state === 'paused') { togglePause(); }
  }

  function startGame() { resetRun(false); }

  /* ==================================================================== */
  /* tile helpers                                                         */
  /* ==================================================================== */
  function tileAt(tx, ty) {
    if (tx < 0 || tx >= L.COLS || ty < 0 || ty >= L.ROWS) return 0;
    return L.grid[ty * L.COLS + tx];
  }
  function setTile(tx, ty, v) {
    if (tx < 0 || tx >= L.COLS || ty < 0 || ty >= L.ROWS) return;
    L.grid[ty * L.COLS + tx] = v;
  }
  function solidAt(pxv, pyv) { return !!SOLID[tileAt(Math.floor(pxv / TILE), Math.floor(pyv / TILE))]; }

  function boxHitsSolid(x, y, w, h) {
    var x0 = Math.floor(x / TILE), x1 = Math.floor((x + w - 1) / TILE);
    var y0 = Math.floor(y / TILE), y1 = Math.floor((y + h - 1) / TILE);
    for (var ty = y0; ty <= y1; ty++) {
      for (var tx = x0; tx <= x1; tx++) {
        if (SOLID[tileAt(tx, ty)]) return true;
      }
    }
    return false;
  }

  /* axis-separated movement with tile response */
  function moveActor(a, dt, onBlockHit) {
    var nx = a.x + a.vx * dt;
    if (boxHitsSolid(nx, a.y, PW, PH)) {
      if (a.vx > 0) nx = Math.floor((nx + PW) / TILE) * TILE - PW - 0.001;
      else nx = (Math.floor(nx / TILE) + 1) * TILE + 0.001;
      a.vx = 0;
    }
    a.x = nx;

    var ny = a.y + a.vy * dt;
    a.onGround = false;
    if (boxHitsSolid(a.x, ny, PW, PH)) {
      if (a.vy > 0) {
        ny = Math.floor((ny + PH) / TILE) * TILE - PH - 0.001;
        a.onGround = true;
      } else {
        ny = Math.floor(ny / TILE) * TILE + TILE + 0.001;
        if (onBlockHit) onBlockHit(a);
      }
      a.vy = 0;
    }
    a.y = ny;
  }

  /* ==================================================================== */
  /* update                                                               */
  /* ==================================================================== */
  function loop(ts) {
    var dt = Math.min(0.033, (ts - lastTs) / 1000 || 0.016);
    lastTs = ts;
    if (state === 'playing') update(dt);
    else if (state === 'flag' || state === 'dying') updateCinematic(dt);
    else if (state === 'title') { animT += dt; }
    render(dt);
    requestAnimationFrame(loop);
  }
  var lastTs = 0;

  function update(dt) {
    elapsed += dt;
    SOUND.music.intensity(Math.min(1, Math.abs(player.vx) / RUN_MAX));
    if (furyT > 0) furyT -= dt;
    if (invulnT > 0) invulnT -= dt;
    if (chain > 0 && chainTimer <= 0) { chain = 0; }
    chainTimer -= dt;

    updatePlayer(dt);
    updateEnemies(dt);
    updatePickups(dt);
    updateParticles(dt);
    updateCamera(dt);
    checkCheckpoints();
    checkGoal();
  }
  var chainTimer = 0;

  function updatePlayer(dt) {
    var p = player;
    var maxS = (keys.run ? RUN_MAX : WALK_MAX) * (furyT > 0 ? FURY_MULT : 1);
    var accel = p.onGround ? ACCEL : AIR_ACCEL;

    if (keys.left && !keys.right) { p.vx -= accel * dt; p.dir = -1; }
    else if (keys.right && !keys.left) { p.vx += accel * dt; p.dir = 1; }
    else if (Math.abs(p.vx) > 0 && p.onGround) {
      var f = FRICTION * dt;
      p.vx = Math.abs(p.vx) <= f ? 0 : p.vx - Math.sign(p.vx) * f;
    }
    if (Math.abs(p.vx) > maxS) p.vx = Math.sign(p.vx) * maxS;

    /* jump: buffer + coyote */
    p.jbuf -= dt; p.coyote -= dt;
    if (keys.jump && !p.prevJump) p.jbuf = JUMP_BUFFER;
    var canGround = p.onGround || p.coyote > 0;
    if (p.jbuf > 0 && canGround) {
      p.vy = JUMP_V; p.jumping = true; p.jbuf = 0; p.coyote = 0; p.doubleReady = furyT > 0;
      SOUND.sfx.play('jump');
      spawnDust(p.x + PW / 2, p.y + PH, 4);
    } else if (p.jbuf > 0 && !canGround && p.doubleReady && p.vy > -120) {
      /* fury double-jump */
      p.vy = JUMP_V * 0.86; p.jbuf = 0; p.doubleReady = false;
      SOUND.sfx.play('jump2');
      spawnBurst(p.x + PW / 2, p.y + PH, '#ffcb05', 8);
    }
    /* variable height: release early -> cut rise */
    if (!keys.jump && p.vy < CUT_VY) p.vy = CUT_VY;
    p.prevJump = keys.jump;

    p.vy += GRAV * dt;
    if (p.vy > 900) p.vy = 900;

    moveActor(p, dt, hitBlockFromBelow);
    if (p.onGround && p.vy === 0) { p.coyote = COYOTE; p.doubleReady = furyT > 0; }
    if (p.onGround && !p.hadGround) {
      SOUND.sfx.play('land');
      spawnDust(p.x + PW / 2, p.y + PH, 3);
    }
    p.hadGround = p.onGround;

    /* animation */
    animFrame += dt * (4 + Math.abs(p.vx) / 45);
    if (!p.onGround) p.frame = p.vy < -30 ? 'jump' : 'fall';
    else if (Math.abs(p.vx) > 12) p.frame = (animFrame % 2 < 1) ? 'walkA' : 'walkB';
    else p.frame = 'idle';

    /* fell into a street canyon: costs a heart, then you hop back to the curb.
       Only an empty heart meter costs a whole life. */
    if (p.y > L.H + 30) pitFall();
  }

  function pitFall() {
    if (state !== 'playing') return;
    hearts--;
    furyT = 0;
    addShake(6);
    SOUND.sfx.play('hurt');
    spawnBurst(player.x + PW / 2, Math.min(player.y, L.H), '#49d6d6', 18);
    if (hearts <= 0) { loseLife('pit'); }
    else {
      respawnDelay = 0.8; fullRestore = false; deathMsg = 'slipped into traffic — back to the curb';
      state = 'dying'; stateT = 0; player.vy = 0;
    }
  }

  function hitBlockFromBelow(a) {
    var x0 = Math.floor(a.x / TILE), x1 = Math.floor((a.x + PW - 1) / TILE);
    var ty = Math.floor(a.y / TILE);
    for (var tx = x0; tx <= x1; tx++) {
      var v = tileAt(tx, ty);
      if (v === L.codes.T_MBLOCK) {
        setTile(tx, ty, L.codes.T_USED);
        var itemKind = L.blocks[ty * L.COLS + tx] || 'coin';
        awardBlockItem(tx, ty, itemKind);
      } else if (v === L.codes.T_BRICKBLOCK) {
        if (furyT > 0) { breakBrick(tx, ty); }
        else { bumps[ty * L.COLS + tx] = 0.28; SOUND.sfx.play('bump'); addShake(1.5); }
      } else if (v !== 0) {
        SOUND.sfx.play('bump');
      }
    }
  }

  function awardBlockItem(tx, ty, kind) {
    var cx = tx * TILE + TILE / 2, cy = ty * TILE;
    if (kind === 'coin') { coins++; score += 100; SOUND.sfx.play('coin'); addPop(cx, cy - 8, '+100', '#ffcb05'); spawnCoinPop(cx, cy); }
    else if (kind === 'heart') { hearts = Math.min(3, hearts + 1); score += 100; SOUND.sfx.play('heart'); addPop(cx, cy - 8, 'HEART', '#e2432f'); }
    else if (kind === 'cherry') { score += 250; SOUND.sfx.play('cherry'); addPop(cx, cy - 8, '+250', '#ff6b8a'); }
    addShake(2);
  }

  function breakBrick(tx, ty) {
    setTile(tx, ty, 0);
    SOUND.sfx.play('brick');
    for (var i = 0; i < 6; i++) {
      debris.push({ x: tx * TILE + 8 + (i % 3) * 8, y: ty * TILE + 6 + Math.floor(i / 3) * 12, vx: (i % 2 ? -70 : 70) + Math.random() * 40, vy: -140 - Math.random() * 90, t: 1 });
    }
    addShake(3);
    score += 50;
  }

  function updateEnemies(dt) {
    var p = player;
    for (var i = 0; i < enemies.length; i++) {
      var e = enemies[i];
      if (e.dead) continue;
      if (Math.abs(e.x - cam.x) > VIEW_W * 1.6) continue;   /* sleep off-screen */
      e.t += dt;

      if (e.fly) {
        e.x += e.vx * dt * e.dir;
        if (e.x <= e.x0 || e.x >= e.x1) e.dir = -e.dir;
        var bobY = Math.sin(e.t * 3.2) * 10;
        e.dispY = e.y + bobY;
      } else {
        /* patrol, with edge detection so they stay on their platform */
        var probeX = e.dir > 0 ? e.x + e.w + 6 : e.x - 6;
        var hasFloor = solidAt(probeX, e.y + e.h + 8);
        if (!hasFloor || e.x <= e.x0 || e.x + e.w >= e.x1) e.dir = -e.dir;
        e.x += e.vx * dt * e.dir;
        /* gravity so they settle onto steps */
        e.vy = (e.vy || 0) + GRAV * dt;
        if (e.vy > 900) e.vy = 900;
        var ny = e.y + e.vy * dt;
        var ey0 = Math.floor(e.x / TILE), ey1 = Math.floor((e.x + e.w - 1) / TILE);
        var ty = Math.floor((ny + e.h - 1) / TILE);
        var landed = false;
        for (var tx = ey0; tx <= ey1; tx++) if (SOLID[tileAt(tx, ty)]) { landed = true; break; }
        if (landed) { e.y = ty * TILE - e.h - 0.001; e.vy = 0; } else e.y = ny;
        e.dispY = e.y;
      }

      /* collision with player */
      var eyv = e.dispY != null ? e.dispY : e.y;
      if (invulnT > 0) continue;
      if (p.x + PW > e.x && p.x < e.x + e.w && p.y + PH > eyv + 2 && p.y < eyv + e.h - 2) {
        var stomping = p.vy > 60 && (p.y + PH) < eyv + e.h * 0.6;
        if (stomping || furyT > 0 && p.vy > 0) {
          killEnemy(e);
          p.vy = (furyT > 0 ? FURY_STOMP : STOMP_BOUNCE);
          p.doubleReady = furyT > 0;
        } else {
          damage();
        }
      }
    }
  }

  function killEnemy(e) {
    e.dead = true;
    var pts = 400 * Math.max(1, chain + 1);
    if (chain > 0) addPop(e.x + e.w / 2, (e.dispY || e.y) - 8, '+' + pts, '#ffe45c');
    score += pts;
    chain++; chainTimer = 1.1;
    SOUND.sfx.play('stomp');
    spawnBurst(e.x + e.w / 2, (e.dispY || e.y) + e.h / 2, '#8b93a5', 10);
    addShake(2);
  }

  function damage() {
    if (invulnT > 0 || state !== 'playing') return;
    hearts--; invulnT = 1.4; furyT = 0;
    player.vy = -300;
    addShake(5);
    SOUND.sfx.play('hurt');
    spawnBurst(player.x + PW / 2, player.y + PH / 2, '#e2432f', 12);
    if (hearts <= 0) loseLife('hit');
  }

  function loseLife(why) {
    lives--;
    respawnDelay = 1.6; fullRestore = true;
    deathMsg = why === 'pit' ? 'down a life — the Campus Loop got you' : 'down a life';
    state = 'dying'; stateT = 0;
    player.vy = -520; player.vx = 0;
    SOUND.sfx.play('die');
    spawnBurst(player.x + PW / 2, player.y + PH / 2, '#f4f7ff', 16);
  }

  function updateCinematic(dt) {
    stateT += dt;
    if (state === 'dying') {
      player.vy += GRAV * dt * 0.8;
      player.y += player.vy * dt;
      updateParticles(dt);
      if (stateT > respawnDelay) {
        if (lives <= 0) { state = 'over'; stateT = 0; SOUND.music.stop(); }
        else {
          player.x = respawnAt.x; player.y = respawnAt.y; player.vx = player.vy = 0;
          hearts = fullRestore ? 3 : Math.max(1, hearts);
          invulnT = 1.2; furyT = 0;
          state = 'playing'; stateT = 0; respawnDelay = 1.6;
        }
      }
    } else if (state === 'flag') {
      /* slide down the flagpole */
      var targetY = (L.TOP - 1) * TILE - PH;
      player.x = L.goalX + 2;
      if (player.y < targetY) { player.y = Math.min(targetY, player.y + 260 * dt); player.frame = 'win'; }
      flagY = Math.min(1, flagY + dt * 0.9);
      updateParticles(dt);
      if (stateT > 1.7 && !won) {
        won = true; state = 'end'; stateT = 0;
        computeScore();
        SOUND.music.stop();
        SOUND.sfx.play('win');
      }
    }
  }

  function updatePickups(dt) {
    var p = player;
    for (var i = 0; i < pickups.length; i++) {
      var k = pickups[i];
      if (k.taken) continue;
      k.t += dt;
      var w = 14, h = 14;
      if (p.x + PW > k.x && p.x < k.x + w && p.y + PH > k.y && p.y < k.y + h) {
        k.taken = true;
        if (k.type === 'coin') { coins++; score += 100; SOUND.sfx.play('coin'); addPop(k.x, k.y - 6, '+100', '#ffcb05'); }
        else if (k.type === 'cherry') { score += 250; SOUND.sfx.play('cherry'); addPop(k.x, k.y - 6, '+250', '#ff6b8a'); }
        else if (k.type === 'heart') { hearts = Math.min(3, hearts + 1); SOUND.sfx.play('heart'); addPop(k.x, k.y - 6, '+♥', '#ff6b8a'); }
        else if (k.type === 'coffee') { furyT = FURY_TIME; score += 150; SOUND.sfx.play('power'); addPop(k.x, k.y - 6, 'FURY!', '#ffe45c'); spawnBurst(k.x + 7, k.y + 7, '#ffcb05', 14); }
        spawnBurst(k.x + 7, k.y + 7, k.type === 'coin' ? '#ffcb05' : '#ffffff', 6);
      }
    }
  }

  function updateCamera(dt) {
    var target = player.x - VIEW_W * 0.42;
    cam.x += (target - cam.x) * Math.min(1, dt * 7);
    cam.x = Math.max(0, Math.min(L.W - VIEW_W, cam.x));
  }
  function addShake(v) { cam.shake = Math.min(8, cam.shake + v); }

  var CHECKPOINTS = [4, 27, 51, 77, 101, 125, 145];
  function checkCheckpoints() {
    for (var i = 0; i < CHECKPOINTS.length; i++) {
      var cx = CHECKPOINTS[i] * TILE;
      if (player.x >= cx && player.onGround) {
        var wantY = L.TOP * TILE - PH;
        if (respawnAt.x !== cx) { respawnAt = { x: cx, y: wantY }; addPop(player.x, player.y - 10, 'CHECKPOINT', '#49d6d6'); SOUND.sfx.play('flag'); }
      }
    }
  }

  function checkGoal() {
    if (state !== 'playing') return;
    var gx = L.goalX + 8;
    if (player.x + PW > gx && player.x < gx + TILE * 2) {
      state = 'flag'; stateT = 0;
      player.vx = 0;
      SOUND.sfx.play('flag');
      spawnBurst(L.goalX + 14, player.y, '#ffcb05', 18);
    }
  }

  function computeScore() {
    var timeBonus = Math.max(0, 30000 - Math.floor(elapsed) * 250);
    var coinBonus = coins * 60;
    var lifeBonus = lives * 1500;
    var heartsBonus = hearts * 400;
    stats = { time: elapsed, timeBonus: timeBonus, coinBonus: coinBonus, lifeBonus: lifeBonus, heartsBonus: heartsBonus, base: score };
    score += timeBonus + coinBonus + lifeBonus + heartsBonus;
  }

  /* ==================================================================== */
  /* particles                                                            */
  /* ==================================================================== */
  function spawnDust(x, y, n) { for (var i = 0; i < n; i++) particles.push({ x: x, y: y, vx: (Math.random() - 0.5) * 90, vy: -20 - Math.random() * 60, t: 0.45, c: '#c2c8d4', s: 3 }); }
  function spawnBurst(x, y, c, n) { for (var i = 0; i < n; i++) { var a = Math.random() * Math.PI * 2, sp = 60 + Math.random() * 150; particles.push({ x: x, y: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 40, t: 0.5 + Math.random() * 0.3, c: c, s: 3 }); } }
  function spawnCoinPop(x, y) { particles.push({ x: x, y: y, vx: 0, vy: -260, t: 0.7, c: '#ffcb05', s: 10, coin: true }); }
  function addPop(x, y, text, c) { pops.push({ x: x, y: y, text: text, c: c, t: 1.1 }); }

  function updateParticles(dt) {
    for (var i = particles.length - 1; i >= 0; i--) {
      var q = particles[i];
      q.t -= dt;
      q.x += q.vx * dt; q.y += q.vy * dt;
      q.vy += (q.coin ? 900 : 620) * dt;
      if (q.t <= 0) particles.splice(i, 1);
    }
    for (var j = pops.length - 1; j >= 0; j--) { var pp = pops[j]; pp.t -= dt; pp.y -= 28 * dt; if (pp.t <= 0) pops.splice(j, 1); }
    for (var d = debris.length - 1; d >= 0; d--) { var b = debris[d]; b.t -= dt; b.x += b.vx * dt; b.y += b.vy * dt; b.vy += 1400 * dt; if (b.t <= 0) debris.splice(d, 1); }
    for (var k in bumps) { bumps[k] -= dt; if (bumps[k] <= 0) delete bumps[k]; }
  }

  /* ==================================================================== */
  /* rendering                                                            */
  /* ==================================================================== */
  function render(dt) {
    var sx = cam.shake ? Math.round((Math.random() - 0.5) * cam.shake) : 0;
    var sy = cam.shake ? Math.round((Math.random() - 0.5) * cam.shake) : 0;
    /* decay shake here so it settles in every state, not just while playing */
    if (cam.shake > 0) cam.shake = Math.max(0, cam.shake - dt * 9);

    drawSky();
    drawClouds();          /* screen space, slow parallax */
    ctx.save();
    ctx.translate(-Math.round(cam.x) + sx, sy);

    drawDecoLayer('far');
    drawDecoLayer('mid');
    drawTiles();
    drawDecoLayer('front');
    drawSigns('mid');
    drawPickups();
    drawDebris();
    drawEnemies();
    drawPlayer();
    drawParticles();
    drawPops();
    drawFlagPole();
    drawSigns('front');

    ctx.restore();

    drawHUD();
    drawOverlay(dt);
  }

  function drawSky() {
    var g = ctx.createLinearGradient(0, 0, 0, VIEW_H);
    g.addColorStop(0, '#1b3f7a');
    g.addColorStop(0.45, '#2f6fb5');
    g.addColorStop(0.8, '#79aed6');
    g.addColorStop(1, '#a9d3e8');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    /* the deep street band under the surface line */
    var gy = L.TOP * TILE;
    var g2 = ctx.createLinearGradient(0, gy, 0, L.H);
    g2.addColorStop(0, '#1a2338');
    g2.addColorStop(1, '#05070d');
    ctx.fillStyle = g2;
    ctx.fillRect(0, gy, VIEW_W, L.H - gy);
  }

  function drawDecoLayer(name) {
    var factor = name === 'far' ? 0.5 : name === 'mid' ? 0.78 : 1;
    for (var j = 0; j < L.decor.length; j++) {
      var d = L.decor[j];
      if (d.layer !== name) continue;
      /* parallax: draw at a shifted world coord so this layer scrolls slower */
      var wx = d.x + cam.x * (1 - factor);
      var screenX = wx - cam.x;
      if (screenX < -500 || screenX > VIEW_W + 500) continue;
      drawUrban(d.id, wx, d.yBottom, d.scale || 1, name === 'far' ? 0.85 : 1);
    }
  }

  var SKY_W = VIEW_W * 1.5;
  function drawClouds() {
    var par = 0.3;
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.86)';
    for (var i = 0; i < clouds.length; i++) {
      var c = clouds[i];
      var sxp = ((c.x % SKY_W) - cam.x * par) % SKY_W;
      sxp = ((sxp % SKY_W) + SKY_W) % SKY_W;
      drawCloudShape(sxp, c.y, c.w, c.h);
      drawCloudShape(sxp - SKY_W, c.y, c.w, c.h);
    }
    ctx.restore();
  }

  function drawCloudShape(x, y, w, h) {
    if (x > VIEW_W + w || x < -w * 2) return;
    ellPx(x, y, w, h);
    ellPx(x + w * 0.42, y - h * 0.45, w * 0.68, h * 0.95);
    ellPx(x + w * 0.72, y + h * 0.12, w * 0.5, h * 0.72);
  }
  function ellPx(x, y, w, h) {
    ctx.beginPath();
    ctx.ellipse(Math.round(x), Math.round(y), Math.round(w / 2), Math.round(h / 2), 0, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawUrban(id, x, yBottom, scale, alpha) {
    if (!sheetReady || !URB[id]) return;
    var u = URB[id];
    var w = Math.max(1, Math.round(u.w * scale)), h = Math.max(1, Math.round(u.h * scale));
    ctx.save();
    ctx.globalAlpha = alpha == null ? 1 : alpha;
    ctx.drawImage(sheet, u.x, u.y, u.w, u.h, Math.round(x), Math.round(yBottom - h), w, h);
    ctx.restore();
  }

  function tileCanvasFor(v) {
    var c = L.codes, t = ART.tiles;
    switch (v) {
      case c.T_CONC_TOP: return t.concreteTop;
      case c.T_CONC_FILL: return t.concreteFill;
      case c.T_BRICK_TOP: return t.brickTop;
      case c.T_BRICK_FILL: return t.brickFill;
      case c.T_GRASS_TOP: return t.grassTop;
      case c.T_DIRT: return t.dirtFill;
      case c.T_HEDGE: return t.hedge;
      case c.T_WOOD: return t.wood;
      case c.T_BRICKBLOCK: return t.brickBlock;
      case c.T_MBLOCK: return t.mBlock;
      case c.T_USED: return t.usedBlock;
      case c.T_STONE: return t.stoneBlock;
    }
    return null;
  }

  function drawTiles() {
    var x0 = Math.max(0, Math.floor(cam.x / TILE) - 1);
    var x1 = Math.min(L.COLS - 1, Math.floor((cam.x + VIEW_W) / TILE) + 1);
    for (var ty = 0; ty < L.ROWS; ty++) {
      for (var tx = x0; tx <= x1; tx++) {
        var v = tileAt(tx, ty);
        if (!v) continue;
        var img = tileCanvasFor(v);
        if (!img) continue;
        var off = 0;
        var bk = bumps[ty * L.COLS + tx];
        if (bk > 0) off = -Math.round(Math.sin((0.28 - bk) / 0.28 * Math.PI) * 6);
        ctx.drawImage(img, tx * TILE, ty * TILE + off);
      }
    }
  }

  function drawSigns(layer) {
    for (var i = 0; i < L.signs.length; i++) {
      var s = L.signs[i];
      if ((s.layer || 'mid') !== layer) continue;
      /* parallax: mid-layer signs drift slower than the foreground */
      var wx = s.x + cam.x * (layer === 'mid' ? 0.22 : 0);
      drawSignBoard(wx, s.y, s.text, s.sub, s.size, !!s.panel);
    }
  }

  function setFont(px) {
    ctx.font = 'bold ' + px + 'px "Trebuchet MS", Verdana, sans-serif';
    if ('letterSpacing' in ctx) ctx.letterSpacing = Math.max(0, px * 0.06) + 'px';
  }

  function drawSignBoard(x, y, text, sub, size, panel) {
    setFont(size);
    var w = Math.ceil(ctx.measureText(text).width) + 24;
    var h = Math.ceil(size * 1.35) + (sub ? Math.ceil(size * 0.75) : 0) + 16;
    ctx.save();
    if (panel) {
      ctx.fillStyle = '#0a1424cc';
      roundRect(x, y, w, h, 8); ctx.fill();
      ctx.strokeStyle = '#ffcb05'; ctx.lineWidth = 3;
      roundRect(x, y, w, h, 8); ctx.stroke();
      /* sign posts */
      ctx.fillStyle = '#5c3a1c';
      ctx.fillRect(x + 10, y + h, 6, 26);
      ctx.fillRect(x + w - 16, y + h, 6, 26);
    } else {
      ctx.fillStyle = 'rgba(8,20,40,0.55)';
      roundRect(x - 6, y - 4, w + 12, h + 8, 8); ctx.fill();
    }
    ctx.textBaseline = 'top';
    ctx.lineWidth = Math.max(2, size * 0.13);
    ctx.strokeStyle = '#0a1424';
    ctx.strokeText(text, x + 12, y + 6);
    ctx.fillStyle = '#ffcb05';
    ctx.fillText(text, x + 12, y + 6);
    if (sub) {
      setFont(Math.max(10, size * 0.5));
      ctx.strokeStyle = '#0a1424';
      ctx.lineWidth = 3;
      ctx.strokeText(sub, x + 12, y + 8 + size * 1.2);
      ctx.fillStyle = '#f4f7ff';
      ctx.fillText(sub, x + 12, y + 8 + size * 1.2);
    }
    ctx.restore();
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y); ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r); ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h); ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r); ctx.arcTo(x, y, x + r, y, r);
  }

  function drawPickups() {
    for (var i = 0; i < pickups.length; i++) {
      var k = pickups[i];
      if (k.taken) continue;
      if (k.x < cam.x - 40 || k.x > cam.x + VIEW_W + 40) continue;
      var img;
      if (k.type === 'coin') img = ART.items.coin[Math.floor(k.t * 8) % 4];
      else if (k.type === 'cherry') img = ART.items.cherry[Math.floor(k.t * 3) % 2];
      else if (k.type === 'heart') img = ART.items.heartFull;
      else img = ART.items.coffee[Math.floor(k.t * 4) % 2];
      var bob = Math.sin(k.t * 2.6) * 3;
      ctx.drawImage(img, Math.round(k.x - 1), Math.round(k.y + bob));
    }
  }

  function enemyFrames(e) {
    if (e.kind === 'rover') return ART.enemies.rover;
    if (e.kind === 'roverRed') return ART.enemies.roverRed;
    if (e.kind === 'drone') return ART.enemies.drone;
    return ART.enemies.squirrel;
  }

  function drawEnemies() {
    for (var i = 0; i < enemies.length; i++) {
      var e = enemies[i];
      if (e.dead) continue;
      if (e.x < cam.x - 60 || e.x > cam.x + VIEW_W + 60) continue;
      var frames = enemyFrames(e);
      var f = Math.floor(e.t * (e.fly ? 6 : 8)) % 2;
      var yv = (e.dispY != null ? e.dispY : e.y);
      drawFlipped(frames[f], e.x, yv, e.dir, e.w, e.h);
    }
  }

  function drawFlipped(img, x, y, dir, boxW, boxH) {
    var w = img.width, h = img.height;
    var dx = Math.round(x + (boxW - w) / 2), dy = Math.round(y + (boxH - h));
    ctx.save();
    if (dir < 0) {
      ctx.translate(dx + w, dy);
      ctx.scale(-1, 1);
      ctx.drawImage(img, 0, 0);
    } else {
      ctx.drawImage(img, dx, dy);
    }
    ctx.restore();
  }

  function drawPlayer() {
    var p = player;
    if (invulnT > 0 && Math.floor(invulnT * 14) % 2 === 0) return;
    var img = ART.player[p.frame] || ART.player.idle;
    ctx.save();
    if (furyT > 0) {
      ctx.shadowColor = '#ffcb05';
      ctx.shadowBlur = 14;
    }
    var dx = Math.round(p.x + (PW - img.width) / 2), dy = Math.round(p.y + (PH - img.height));
    if (p.dir < 0) {
      ctx.translate(dx + img.width, dy); ctx.scale(-1, 1); ctx.drawImage(img, 0, 0);
    } else ctx.drawImage(img, dx, dy);
    ctx.restore();
  }

  function drawParticles() {
    for (var i = 0; i < particles.length; i++) {
      var q = particles[i];
      if (q.coin) { ctx.drawImage(ART.items.coin[0], Math.round(q.x - 7), Math.round(q.y - 7)); continue; }
      ctx.globalAlpha = Math.max(0, Math.min(1, q.t * 2));
      ctx.fillStyle = q.c;
      ctx.fillRect(Math.round(q.x), Math.round(q.y), q.s, q.s);
      ctx.globalAlpha = 1;
    }
  }

  function drawPops() {
    for (var i = 0; i < pops.length; i++) {
      var pp = pops[i];
      ctx.save();
      setFont(16);
      ctx.globalAlpha = Math.max(0, Math.min(1, pp.t));
      ctx.lineWidth = 3; ctx.strokeStyle = '#0a1424';
      ctx.textBaseline = 'top';
      var txt = pp.text;
      var w = ctx.measureText(txt).width;
      ctx.strokeText(txt, Math.round(pp.x - w / 2), Math.round(pp.y));
      ctx.fillStyle = pp.c;
      ctx.fillText(txt, Math.round(pp.x - w / 2), Math.round(pp.y));
      ctx.restore();
    }
  }

  function drawDebris() {
    for (var i = 0; i < debris.length; i++) {
      var b = debris[i];
      ctx.fillStyle = '#a8452f';
      ctx.fillRect(Math.round(b.x), Math.round(b.y), 7, 7);
      ctx.fillStyle = '#6b2317';
      ctx.fillRect(Math.round(b.x) + 2, Math.round(b.y) + 2, 3, 3);
    }
  }

  function drawFlagPole() {
    var gx = L.goalX;
    var gy = (L.TOP - 1) * TILE;   /* top of the goal plateau */
    /* pole */
    ctx.fillStyle = '#8b93a5';
    ctx.fillRect(gx + 10, gy - 250, 6, 250);
    ctx.fillStyle = '#c2c8d4';
    ctx.fillRect(gx + 11, gy - 250, 2, 250);
    /* base block */
    ctx.fillStyle = '#596172';
    ctx.fillRect(gx - 4, gy - 12, 34, 12);
    ctx.fillStyle = '#ffcb05';
    ctx.fillRect(gx + 8, gy - 258, 10, 8);
    /* banner slides up as the player slides down */
    var fy = gy - 70 - flagY * 165;
    var img = ART.items.flag;
    ctx.save();
    ctx.translate(gx + 16, Math.round(fy));
    ctx.scale(2.2, 2.2);
    ctx.drawImage(img, 0, 0);
    ctx.restore();
  }

  /* ==================================================================== */
  /* HUD                                                                  */
  /* ==================================================================== */
  function drawHUD() {
    ctx.save();
    /* panel */
    ctx.fillStyle = 'rgba(8,20,40,0.55)';
    roundRect(12, 10, VIEW_W - 24, 46, 10); ctx.fill();

    ctx.textBaseline = 'middle';
    setFont(13);
    ctx.fillStyle = '#9ec8ff';
    ctx.fillText('WORLD 1-1 · ANN ARBOR SPRINT', 24, 24);

    /* hearts */
    for (var i = 0; i < 3; i++) {
      ctx.globalAlpha = i < hearts ? 1 : 0.35;
      ctx.drawImage(i < hearts ? ART.items.heartFull : ART.items.heartEmpty, 24 + i * 20, 32);
    }
    ctx.globalAlpha = 1;

    /* coins */
    ctx.drawImage(ART.items.coin[0], 96, 30);
    setFont(18);
    ctx.fillStyle = '#ffcb05';
    var coinTxt = String(coins) + '/' + totalCoins();
    ctx.fillText(coinTxt, 118, 40);

    /* score */
    setFont(18);
    ctx.fillStyle = '#f4f7ff';
    var stxt = String(score).padStart(6, '0');
    ctx.textAlign = 'center';
    ctx.fillText(stxt, VIEW_W / 2, 40);
    setFont(11);
    ctx.fillStyle = '#9ec8ff';
    ctx.fillText('SCORE', VIEW_W / 2, 22);

    /* timer */
    ctx.textAlign = 'right';
    setFont(18);
    ctx.fillStyle = '#f4f7ff';
    ctx.fillText(fmtTime(elapsed), VIEW_W - 90, 40);
    setFont(11); ctx.fillStyle = '#9ec8ff';
    ctx.fillText('TIME', VIEW_W - 90, 22);

    /* lives */
    for (var l = 0; l < lives; l++) ctx.drawImage(ART.items.life, VIEW_W - 74 + l * 22, 26);

    /* fury meter */
    if (furyT > 0) {
      var frac = furyT / FURY_TIME;
      ctx.textAlign = 'left';
      setFont(11);
      ctx.fillStyle = '#ffe45c';
      ctx.fillText('ESPRESSO FURY', VIEW_W / 2 - 60, 52);
      ctx.fillStyle = '#0a1424';
      ctx.fillRect(VIEW_W / 2 + 30, 46, 80, 8);
      ctx.fillStyle = '#ffcb05';
      ctx.fillRect(VIEW_W / 2 + 30, 46, Math.round(80 * frac), 8);
    }
    ctx.restore();
  }

  function totalCoins() {
    if (totalCoins.v == null) {
      var n = L.pickups.filter(function (p) { return p.type === 'coin'; }).length;
      for (var k in L.blocks) if (L.blocks[k] === 'coin') n++;
      totalCoins.v = n;
    }
    return totalCoins.v;
  }
  function fmtTime(t) {
    var m = Math.floor(t / 60), s = Math.floor(t % 60), cs = Math.floor((t * 100) % 100);
    return m + ':' + String(s).padStart(2, '0') + '.' + String(cs).padStart(2, '0');
  }

  /* ==================================================================== */
  /* overlays (title / pause / win / game over)                           */
  /* ==================================================================== */
  function drawOverlay(dt) {
    if (state === 'playing' || state === 'flag') { domOverlay.classList.add('hidden'); return; }
    domOverlay.classList.remove('hidden');
    var c = ctx;
    c.save();
    c.fillStyle = 'rgba(5,10,24,0.82)';
    c.fillRect(0, 0, VIEW_W, VIEW_H);
    c.textBaseline = 'top';
    c.textAlign = 'center';

    if (state === 'title') {
      drawTitle();
    } else if (state === 'paused') {
      setFont(42); c.fillStyle = '#ffcb05';
      c.fillText('PAUSED', VIEW_W / 2, 180);
      setFont(16); c.fillStyle = '#cfe3f5';
      c.fillText('press P or the ▶ button to continue', VIEW_W / 2, 250);
    } else if (state === 'end') {
      drawEnd();
    } else if (state === 'over') {
      setFont(46); c.fillStyle = '#e2432f';
      c.fillText('GAME OVER', VIEW_W / 2, 150);
      setFont(18); c.fillStyle = '#cfe3f5';
      c.fillText('The Campus Loop bus got you. Score: ' + score, VIEW_W / 2, 220);
      c.fillText('press R or ↻ to try again', VIEW_W / 2, 260);
    } else if (state === 'dying') {
      setFont(28); c.fillStyle = '#f4f7ff';
      c.fillText(deathMsg || 'ouch', VIEW_W / 2, 200);
    }
    c.restore();
  }

  function drawTitle() {
    var c = ctx;
    /* title banner */
    setFont(58);
    c.textAlign = 'center';
    c.lineWidth = 8; c.strokeStyle = '#0a1424';
    c.strokeText('DIAG DASH', VIEW_W / 2, 70);
    c.fillStyle = '#ffcb05';
    c.fillText('DIAG DASH', VIEW_W / 2, 70);
    setFont(20);
    c.lineWidth = 4; c.strokeText('An Ann Arbor Sprint', VIEW_W / 2, 148);
    c.fillStyle = '#f4f7ff';
    c.fillText('An Ann Arbor Sprint', VIEW_W / 2, 148);

    /* controls */
    var lines = [
      ['← → / A D', 'run'],
      ['SHIFT / Z', 'hurry (run faster)'],
      ['SPACE / ↑ / X', 'jump — hold longer to jump higher'],
      ['P', 'pause'], ['M', 'mute'], ['R', 'restart']
    ];
    setFont(15);
    var y = 210;
    for (var i = 0; i < lines.length; i++) {
      c.textAlign = 'right';
      c.fillStyle = '#ffcb05';
      c.fillText(lines[i][0], VIEW_W / 2 - 60, y + i * 24);
      c.textAlign = 'left';
      c.fillStyle = '#cfe3f5';
      c.fillText(lines[i][1], VIEW_W / 2 - 40, y + i * 24);
    }

    /* goal blurb */
    setFont(15); c.textAlign = 'center';
    c.fillStyle = '#9ec8ff';
    c.fillText('Reach the flag at Elsey Street. Stomp the campus rovers, grab the maize coins,', VIEW_W / 2, 380);
    c.fillText('find coffee for ESPRESSO FURY (double jump + brick smashing), and honk for the Diag.', VIEW_W / 2, 404);

    /* credits (urban tileset license requires visible credit to Dlou Saiyan) */
    setFont(13);
    c.fillStyle = '#8ea9c6';
    c.fillText('City art © Dlou Saiyan — used with permission (see below). Ann Arbor landmarks are drawn as low-fi text signage.', VIEW_W / 2, 450);
    c.fillText('Game code, tiles & chiptune: this repo. Press ENTER or SPACE to start.', VIEW_W / 2, 472);

    /* billboard sprite once, out-of-game, on the credits screen */
    if (sheetReady && URB[70]) {
      var u = URB[70];
      c.save();
      c.globalAlpha = 0.9;
      c.drawImage(sheet, u.x, u.y, u.w, u.h, VIEW_W / 2 - 80, 496 - 10, 66, 66);
      c.restore();
    }
    setFont(12); c.textAlign = 'left';
    c.fillStyle = '#7f96b0';
    c.fillText('credit: Dlou Saiyan', VIEW_W / 2 + 4, 508);
  }

  function drawEnd() {
    var c = ctx;
    setFont(46); c.textAlign = 'center';
    c.lineWidth = 7; c.strokeStyle = '#0a1424';
    c.strokeText('LEVEL CLEAR!', VIEW_W / 2, 60);
    c.fillStyle = '#ffcb05';
    c.fillText('LEVEL CLEAR!', VIEW_W / 2, 60);

    if (stats) {
      var rows = [
        ['Time', fmtTime(stats.time), '' ],
        ['Time bonus', stats.timeBonus, ''],
        ['Coins', coins + '/' + totalCoins(), '' ],
        ['Coin bonus', stats.coinBonus, ''],
        ['Lives left', lives, '' ],
        ['Life bonus', stats.lifeBonus, ''],
        ['Hearts bonus', stats.heartsBonus, '']
      ];
      setFont(17);
      var y = 150;
      for (var i = 0; i < rows.length; i++) {
        c.textAlign = 'right';
        c.fillStyle = '#cfe3f5';
        c.fillText(rows[i][0] + ':', VIEW_W / 2 - 40, y + i * 26);
        c.textAlign = 'left';
        c.fillStyle = '#ffcb05';
        var v = rows[i][1];
        c.fillText(typeof v === 'number' ? String(v) : v, VIEW_W / 2 + 40, y + i * 26);
      }
      setFont(24);
      c.textAlign = 'center';
      c.fillStyle = '#f4f7ff';
      c.fillText('TOTAL ' + score, VIEW_W / 2, y + rows.length * 26 + 10);
    }
    setFont(16);
    c.fillStyle = '#9ec8ff';
    c.fillText('press R or ↻ to run it again', VIEW_W / 2, 470);
    setFont(13);
    c.fillStyle = '#8ea9c6';
    c.fillText('City art © Dlou Saiyan', VIEW_W / 2, 500);
  }

  /* ==================================================================== */
  /* debug hook — read-only snapshot, used by the headless smoke test      */
  /* ==================================================================== */
  try {
    window.__DIAG = {
      snapshot: function () {
        return {
          state: state, x: player.x, y: player.y, vx: player.vx, vy: player.vy,
          onGround: player.onGround, hearts: hearts, lives: lives, coins: coins,
          score: score, elapsed: elapsed, furyT: furyT, camX: cam.x,
          enemiesAlive: enemies.filter(function (e) { return !e.dead; }).length,
          pickupsLeft: pickups.filter(function (p) { return !p.taken; }).length,
          totalCoins: totalCoins(), sheetReady: sheetReady, muted: muted
        };
      },
      tile: function (tx, ty) { return tileAt(tx, ty); },
      enemyList: function () {
        return enemies.filter(function (e) { return !e.dead; }).map(function (e) {
          return { x: e.x, y: (e.dispY != null ? e.dispY : e.y), fly: !!e.fly, w: e.w, h: e.h };
        });
      }
    };
  } catch (e) { /* ignore in restricted environments */ }

  /* ==================================================================== */
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
