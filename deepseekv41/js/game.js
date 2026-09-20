/* game.js — ANN ARBOR BROTHERS: physics, enemies, camera, HUD, game states.
 *
 * Runs on a fixed 60 Hz timestep (with a render pass per animation frame) so the
 * feel is the same on any display. Everything is drawn to a 512x288 canvas that
 * CSS scales up with image-rendering: pixelated, which keeps the pixel art crisp.
 */
(function (global) {
  'use strict';

  var AAB = global.AAB;
  var T = AAB.assets.TILE;            // 18 px world tile
  var VW = 512, VH = 288;             // virtual (canvas) resolution
  var STEP_MS = 1000 / 60;

  var ctx = null, canvas = null;
  var acc = 0, lastTime = 0, time = 0;

  var PHASE = { TITLE: 'title', PLAY: 'play', PAUSED: 'paused', DYING: 'dying',
                DEAD: 'dead', WIN: 'win', CREDITS: 'credits', ERROR: 'error' };

  var G = null;                       // live game state
  var L = null;                       // level data (built once)
  var solids = [];                    // precomputed {x,y} solid tile cells
  var clouds = [];                    // runtime cloud sprites

  // ------------------------------------------------------------------- helpers

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  function lerp(a, b, k) { return a + (b - a) * k; }

  function approach(cur, target, rate) { return cur + (target - cur) * rate; }

  function aabb(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }

  function overlapArea(a, b) {
    var ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
    var oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
    if (ox <= 0 || oy <= 0) return 0;
    return ox * oy;
  }

  function tileAt(tx, ty) {
    if (tx < 0 || ty < 0 || tx >= L.widthTiles || ty >= L.heightTiles) return -1;
    return L.tiles[ty * L.widthTiles + tx];
  }

  function isSolid(tx, ty) {
    var v = tileAt(tx, ty);
    if (v === -1) return true;              // out of bounds behaves like bedrock
    return v !== 0 && AAB.level.SOLID[v] === true;
  }

  function isWater(tx, ty) {
    var v = tileAt(tx, ty);
    return v !== -1 && v !== 0 && AAB.level.WATER[v] === true;
  }

  /** Screen position of a world x for a parallax layer (0 = pinned to viewport). */
  function px(worldX, scroll) {
    if (!scroll || scroll === 1) return Math.round(worldX - G.cam.x);
    return Math.round(G.cam.x * (1 - scroll) + worldX * scroll - G.cam.x);
  }

  // -------------------------------------------------------------------- level

  function initLevel() {
    L = AAB.level.build();
    AAB.level.data = L;
    solids.length = 0;
    for (var y = 0; y < L.heightTiles; y++) {
      for (var x = 0; x < L.widthTiles; x++) {
        var v = L.tiles[y * L.widthTiles + x];
        if (v !== 0 && AAB.level.SOLID[v]) solids.push({ x: x, y: y });
      }
    }
    clouds.length = 0;
    for (var i = 0; i < 9; i++) {
      clouds.push({ x: 60 + i * 420, y: 12 + (i % 3) * 24, scale: 1.6 + (i % 2) * 0.5, scroll: 0.18 + (i % 3) * 0.05 });
    }
  }

  // ---------------------------------------------------------------- game state

  function newPlayer() {
    return {
      box: { x: 0, y: 0, w: 12, h: 22 },
      vx: 0, vy: 0,
      grounded: false, coyote: 0, jumpBuf: 0, jumpHeld: false,
      facing: 1, animT: 0, invuln: 0, hurtT: 0, inWater: false,
      dead: false, deadT: 0, sinkT: 0, won: false
    };
  }

  function resetPlayer() {
    var p = G.player;
    p.box.x = G.spawn.x;
    p.box.y = G.spawn.y;
    p.vx = 0; p.vy = 0;
    p.grounded = false; p.coyote = 0; p.jumpBuf = 0;
    p.facing = 1; p.animT = 0; p.invuln = 0; p.hurtT = 0; p.inWater = false;
    p.dead = false; p.deadT = 0; p.sinkT = 0; p.won = false;
  }

  function resetEntities() {
    var groundFeet = L.groundRow * T + T;         // world y of the ground surface
    G.enemies = L.enemies.map(function (e) {
      return {
        type: e.type, x: e.x, y: e.baseY == null ? groundFeet : e.baseY,
        patrolFrom: e.patrolFrom, patrolTo: e.patrolTo,
        baseY: e.baseY, amp: e.amp, phase: e.phase,
        dir: 1, alive: true, dying: 0, w: 18, h: 18, animT: 0
      };
    });
    G.coins = L.coins.map(function (c) {
      return { x: c.x, y: c.y, kind: c.kind, taken: false, bob: (c.x % 7) * 0.2 };
    });
    G.mystery = L.mysteryBlocks.map(function (m) { return { tx: m.tx, ty: m.ty, used: false, reward: m.reward, bump: 0 }; });
    G.pops = [];
  }

  function newGame() {
    G = {
      phase: PHASE.TITLE,
      player: newPlayer(),
      enemies: [], coins: [], mystery: [], pops: [],
      lives: 3, health: 3, score: 0, coinCount: 0, gemCount: 0,
      spawn: { x: L.spawn.x, y: L.spawn.y },
      cpIndex: -1,
      coinCombo: 0, coinComboT: 0, stompCombo: 0, stompComboT: 0,
      cam: { x: 0, y: 0, shake: 0 },
      flagT: 0, endTimer: 0, msg: '', msgT: 0,
      titleT: 0, creditsFrom: PHASE.TITLE, debug: false
    };
    resetEntities();
    resetPlayer();
    G.cam.x = clamp(G.player.box.x - 160, 0, L.widthPx - VW);
    G.cam.y = clamp(L.heightPx - VH, 0, L.heightPx - VH);
    return G;
  }

  // ------------------------------------------------------------------- physics

  function playerInput() {
    var p = G.player, k = keys;
    var left = k.left || touch.left, right = k.right || touch.right, jump = k.jump || touch.jump;

    var sprint = k.sprint ? 1.28 : 1;
    var target = 0;
    if (left) { target -= 1; p.facing = -1; }
    if (right) { target += 1; p.facing = 1; }

    var accel = p.grounded ? 0.62 : 0.38;
    var maxSpd = 3.1 * sprint;
    var desired = target * maxSpd;
    if (target === 0) {
      p.vx = approach(p.vx, 0, p.grounded ? 0.34 : 0.12);
    } else {
      p.vx = approach(p.vx, desired, accel);
    }
    p.vx = clamp(p.vx, -maxSpd, maxSpd);

    // jump: buffer the press, honour coyote time, allow a variable-height jump
    if (jump && !p.jumpHeld) p.jumpBuf = 0.16;
    p.jumpHeld = jump;
    if (p.jumpBuf > 0) p.jumpBuf -= STEP_MS / 1000;
    if (p.coyote > 0) p.coyote -= STEP_MS / 1000;

    if (p.jumpBuf > 0 && p.coyote > 0) {
      p.vy = -7.6;
      p.grounded = false;
      p.coyote = 0;
      p.jumpBuf = 0;
      p.jumpHeld = true;                    // require a fresh press for the next jump
      AAB.audio.sfx('jump');
    }
    if (!jump && p.vy < 0) p.vy *= 0.72;    // short-hop on release
  }

  function moveX(p, dt) {
    var dx = p.vx * dt;
    if (dx === 0) return;
    p.box.x += dx;
    var y0 = Math.floor(p.box.y / T), y1 = Math.floor((p.box.y + p.box.h - 1) / T);
    if (dx > 0) {
      var tx = Math.floor((p.box.x + p.box.w - 1) / T);
      for (var y = y0; y <= y1; y++) {
        if (isSolid(tx, y)) { p.box.x = tx * T - p.box.w; p.vx = 0; return; }
      }
    } else {
      var tx2 = Math.floor(p.box.x / T);
      for (var y2 = y0; y2 <= y1; y2++) {
        if (isSolid(tx2, y2)) { p.box.x = (tx2 + 1) * T; p.vx = 0; return; }
      }
    }
    p.box.x = clamp(p.box.x, 0, L.widthPx - p.box.w);
  }

  function moveY(p, dt) {
    var dy = p.vy * dt;
    if (dy === 0) return;
    p.box.y += dy;
    var x0 = Math.floor(p.box.x / T), x1 = Math.floor((p.box.x + p.box.w - 1) / T);
    if (dy > 0) {
      var ty = Math.floor((p.box.y + p.box.h - 1) / T);
      for (var x = x0; x <= x1; x++) {
        if (isSolid(x, ty)) {
          p.box.y = ty * T - p.box.h;
          p.vy = 0;
          p.grounded = true;
          p.coyote = 0.1;
          return;
        }
      }
    } else {
      var ty2 = Math.floor(p.box.y / T);
      for (var x2 = x0; x2 <= x1; x2++) {
        if (isSolid(x2, ty2)) {
          p.box.y = (ty2 + 1) * T;
          p.vy = 0;
          hitBlockAbove(x2, ty2);
          return;
        }
      }
    }
  }

  function hitBlockAbove(tx, ty) {
    for (var i = 0; i < G.mystery.length; i++) {
      var m = G.mystery[i];
      if (m.tx === tx && m.ty === ty && !m.used) {
        m.used = true;
        m.bump = 1;
        if (m.reward === 'gem') {
          G.pops.push({ x: tx * T + T / 2, y: ty * T - 4, vy: -3.4, kind: 'gem', life: 0.9 });
          AAB.audio.sfx('powerup');
        } else {
          G.pops.push({ x: tx * T + T / 2, y: ty * T - 4, vy: -3.4, kind: 'coin', life: 0.9 });
          AAB.audio.sfx('coin');
        }
        G.score += 50;
        return;
      }
    }
    AAB.audio.sfx('bump');
  }

  function updatePlayer(dt) {
    var p = G.player;
    playerInput();

    // water check (centre point, so brushing the edge doesn't drown you)
    var cx = Math.floor((p.box.x + p.box.w / 2) / T);
    var cy = Math.floor((p.box.y + p.box.h * 0.5) / T);
    if (isWater(cx, cy) && !p.dead) {
      killPlayer('water');
      return;
    }

    var wasGrounded = p.grounded;
    p.grounded = false;
    // gravity in world pixels per frame at 60 Hz
    p.vy = clamp(p.vy + 0.46 * dt * 60, -14, 6.2);
    moveX(p, dt);
    moveY(p, dt);

    // grounded only when there is a solid tile right below the feet
    if (p.grounded) {
      var feetX0 = Math.floor(p.box.x / T), feetX1 = Math.floor((p.box.x + p.box.w - 1) / T);
      var feetY = Math.floor((p.box.y + p.box.h) / T);
      var support = false;
      for (var x = feetX0; x <= feetX1; x++) if (isSolid(x, feetY)) { support = true; break; }
      if (!support) p.grounded = false;
    }
    if (!p.grounded && p.vy > 0) p.coyote = Math.max(0, p.coyote - dt);

    // solid props (pipes, signposts) act as platforms/obstacles
    resolveProps(p);

    if (p.invuln > 0) p.invuln -= dt;
    if (p.hurtT > 0) p.hurtT -= dt;

    p.animT += dt * (Math.abs(p.vx) > 0.4 ? Math.abs(p.vx) : 0.6);
    if (p.box.y > L.heightPx + 40 && !p.dead) killPlayer('pit');
  }

  function propBox(pr) {
    var w = pr.w || T, h = pr.h || T;
    var gy = pr.groundTopRow * T + T;             // world y of the ground surface
    return { x: pr.x, y: gy - h, w: w, h: h };
  }

  function resolveProps(p) {
    for (var i = 0; i < L.props.length; i++) {
      var pr = L.props[i];
      if (!pr.solid) continue;
      var pb = propBox(pr);
      if (!aabb(p.box, pb)) continue;
      // resolve on the axis of least overlap
      var ox = Math.min(p.box.x + p.box.w, pb.x + pb.w) - Math.max(p.box.x, pb.x);
      var oy = Math.min(p.box.y + p.box.h, pb.y + pb.h) - Math.max(p.box.y, pb.y);
      if (oy <= ox) {
        if (p.vy >= 0) { p.box.y = pb.y - p.box.h; p.vy = 0; p.grounded = true; p.coyote = 0.1; }
        else { p.box.y = pb.y + pb.h; p.vy = 0; }
      } else {
        if (p.vx >= 0) p.box.x = pb.x - p.box.w;
        else p.box.x = pb.x + pb.w;
        p.vx = 0;
      }
    }
  }

  // ------------------------------------------------------------------- enemies

  function enemyBox(e) {
    return { x: e.x - e.w / 2, y: e.y - e.h, w: e.w, h: e.h };
  }

  function updateEnemies(dt) {
    for (var i = 0; i < G.enemies.length; i++) {
      var e = G.enemies[i];
      if (!e.alive) { if (e.dying > 0) e.dying -= dt; continue; }
      e.animT += dt;

      if (e.type === 'rover') {
        e.x += e.dir * 1.05 * dt * 60;
        var ahead = e.x + e.dir * (e.w / 2 + 4);
        var tx = Math.floor(ahead / T), ty = Math.floor((e.y + 2) / T);
        if (e.x < e.patrolFrom || e.x > e.patrolTo || isSolid(tx, ty)) e.dir *= -1;
        e.x = clamp(e.x, e.patrolFrom, e.patrolTo);
      } else {
        // drone: flies back and forth, bobbing on a sine
        e.x += e.dir * 0.85 * dt * 60;
        if (e.x < e.patrolFrom || e.x > e.patrolTo) e.dir *= -1;
        e.x = clamp(e.x, e.patrolFrom, e.patrolTo);
        e.y = e.baseY + Math.sin(time * 2.2 + e.phase) * e.amp;
      }

      // player interaction
      var p = G.player;
      if (p.dead || p.won) continue;
      var eb = enemyBox(e);
      if (!aabb(p.box, eb)) continue;

      var stomped = p.vy > 0 && (p.box.y + p.box.h) - p.vy <= eb.y + 3;
      if (stomped) {
        e.alive = false;
        e.dying = 0.45;
        p.vy = keys.jump || touch.jump ? -7.2 : -5.0;
        p.box.y = eb.y - p.box.h;
        G.stompCombo++;
        G.stompComboT = 1.2;
        G.score += 100 * Math.min(G.stompCombo, 5);
        AAB.audio.sfx('stomp');
        G.cam.shake = Math.min(6, G.cam.shake + 3);
      } else {
        hurtPlayer();
      }
    }
    if (G.stompComboT > 0) {
      G.stompComboT -= dt;
      if (G.stompComboT <= 0) G.stompCombo = 0;
    }
  }

  // -------------------------------------------------------------------- hazards

  function killPlayer(reason) {
    var p = G.player;
    if (p.dead) return;
    p.dead = true;
    p.deadT = 0;
    p.sinkT = reason === 'water' ? 0.5 : 0;
    G.phase = PHASE.DYING;
    G.lives--;
    AAB.audio.sfx(reason === 'water' ? 'splash' : 'die');
    G.cam.shake = 4;
  }

  function hurtPlayer() {
    var p = G.player;
    if (p.invuln > 0 || p.dead || G.phase !== PHASE.PLAY) return;
    p.invuln = 1.6;
    p.hurtT = 0.4;
    p.vy = -3.4;
    p.vx = -p.facing * 2.2;
    G.cam.shake = 5;
    AAB.audio.sfx('hurt');
    // enemy contact costs a heart (the HUD icons); losing all hearts costs a life
    G.health--;
    if (G.health <= 0) {
      killPlayer('hit');
    }
  }

  function updateDying(dt) {
    var p = G.player;
    p.deadT += dt;
    if (p.sinkT > 0) {
      p.sinkT -= dt;
      p.box.y += 0.3;
    } else {
      p.vy = clamp(p.vy + 0.4, -6, 6);
      p.box.y += p.vy * dt * 60 / 60;
    }
    if (p.deadT > 1.15) {
      if (G.lives <= 0) { G.phase = PHASE.DEAD; G.endTimer = 0; return; }
      G.phase = PHASE.PLAY;
      G.health = 3;
      resetPlayer();
    }
  }

  // ---------------------------------------------------------------- collectibles

  function updateCoins(dt) {
    var p = G.player;
    if (G.coinComboT > 0) { G.coinComboT -= dt; if (G.coinComboT <= 0) G.coinCombo = 0; }
    var pc = { x: p.box.x + p.box.w / 2 - 9, y: p.box.y + p.box.h / 2 - 9, w: 18, h: 18 };
    for (var i = 0; i < G.coins.length; i++) {
      var c = G.coins[i];
      if (c.taken) continue;
      var cb = { x: c.x - 9, y: c.y - 9, w: 18, h: 18 };
      if (!aabb(pc, cb)) continue;
      c.taken = true;
      G.coinCombo++;
      G.coinComboT = 0.6;
      if (c.kind === 'gem') {
        G.gemCount++;
        G.score += 500;
        AAB.audio.sfx('gem');
      } else {
        G.coinCount++;
        G.score += 100;
        AAB.audio.sfx('coin', Math.pow(2, Math.min(G.coinCombo - 1, 6) / 12));
      }
    }

    // mystery-block coin pops
    for (var j = G.pops.length - 1; j >= 0; j--) {
      var pop = G.pops[j];
      pop.vy += 0.28;
      pop.y += pop.vy;
      pop.life -= dt;
      if (pop.life <= 0) G.pops.splice(j, 1);
    }

    for (var m = 0; m < G.mystery.length; m++) {
      if (G.mystery[m].bump > 0) G.mystery[m].bump -= dt * 3;
    }
  }

  // ------------------------------------------------------------------ checkpoints

  function updateProgress(dt) {
    var p = G.player;
    for (var i = G.cpIndex + 1; i < L.checkpoints.length; i++) {
      if (p.box.x >= L.checkpoints[i].x) {
        G.cpIndex = i;
        G.spawn.x = L.checkpoints[i].x;
        G.spawn.y = L.checkpoints[i].y;
        AAB.audio.sfx('checkpoint');
        flash('CHECKPOINT — GO BLUE');
      }
    }
    if (!p.won && p.box.x + p.box.w >= L.goal.x) {
      p.won = true;
      G.phase = PHASE.WIN;
      G.flagT = 0;
      G.endTimer = 0;
      G.score += 1000;
      AAB.audio.sfx('flag');
      setTimeout(function () { AAB.audio.sfx('win'); }, 600);
    }
  }

  function flash(text) {
    G.msg = text;
    G.msgT = 2.2;
  }

  // ---------------------------------------------------------------------- camera

  function updateCamera(dt) {
    var p = G.player;
    var targetX = p.box.x + p.box.w / 2 - VW * 0.42;
    var airborne = !p.grounded && p.box.y < 13 * T;
    var targetY = airborne ? clamp(p.box.y - VH * 0.45, 0, L.heightPx - VH) : (L.heightPx - VH);
    var k = 0.09;
    if (p.box.x > G.cam.x + VW * 0.62) k = 0.22;      // catch up when sprinting ahead
    G.cam.x = clamp(lerp(G.cam.x, targetX, k), 0, L.widthPx - VW);
    G.cam.y = clamp(lerp(G.cam.y, targetY, 0.08), 0, L.heightPx - VH);
    if (G.cam.shake > 0) G.cam.shake = Math.max(0, G.cam.shake - dt * 12);
  }

  // ------------------------------------------------------------------- game step

  function step(dt) {
    time += dt;

    if (G.phase === PHASE.TITLE) {
      G.titleT += dt;
      updateCamera(dt);
      G.cam.x = clamp(40 + Math.sin(G.titleT * 0.35) * 30, 0, L.widthPx - VW);
      return;
    }
    if (G.phase === PHASE.PAUSED || G.phase === PHASE.CREDITS || G.phase === PHASE.ERROR) return;

    if (G.msgT > 0) G.msgT -= dt;

    if (G.phase === PHASE.DYING) {
      updateDying(dt);
      updateCamera(dt);
      updateCoins(dt);
      return;
    }

    if (G.phase === PHASE.DEAD) { G.endTimer += dt; updateCamera(dt); return; }
    if (G.phase === PHASE.WIN) {
      G.flagT += dt;
      G.endTimer += dt;
      G.player.vy = 0;
      updateCamera(dt);
      return;
    }

    if (G.phase === PHASE.PLAY) {
      updatePlayer(dt);
      if (G.phase === PHASE.PLAY) { updateEnemies(dt); updateCoins(dt); updateProgress(dt); }
      updateCamera(dt);
    }
  }

  // --------------------------------------------------------------------- render

  function render() {
    if (!ctx) return;
    var shakeX = 0, shakeY = 0;
    if (G.cam.shake > 0) {
      shakeX = Math.round(Math.sin(time * 47) * G.cam.shake * 0.5);
      shakeY = Math.round(Math.cos(time * 39) * G.cam.shake * 0.5);
    }
    ctx.save();
    ctx.translate(shakeX, shakeY);
    drawSky();
    drawFarLayer();
    drawSkyline();
    drawLabels();
    drawTiles();
    drawProps();
    drawCoins();
    drawEnemies();
    drawGoal();
    if (G.phase !== PHASE.TITLE) drawPlayer();
    ctx.restore();
    drawHud();
    drawOverlays();
  }

  function drawSky() {
    var g = ctx.createLinearGradient(0, 0, 0, VH);
    if (G.phase === PHASE.WIN) {
      g.addColorStop(0, '#2b3f6b'); g.addColorStop(0.5, '#f0a24a'); g.addColorStop(1, '#ffe08a');
    } else {
      g.addColorStop(0, '#4a86c8'); g.addColorStop(0.45, '#8fc4f2'); g.addColorStop(1, '#d8ecfa');
    }
    ctx.fillStyle = g;
    ctx.fillRect(-8, -8, VW + 16, VH + 16);
  }

  function drawFarLayer() {
    // distant tree canopy over the whole city (ASSETS.md §1c ids 14/15)
    var bandY = 196;
    var x0 = -((G.cam.x * 0.25) % 72);
    for (var x = x0; x < VW + 72; x += 72) {
      AAB.assets.bgFill(ctx, 14, x, bandY - 72, 72, 72);
      AAB.assets.bgFill(ctx, 15, x, bandY, 72, 72);
    }
    // a soft haze so the skyline reads as far away
    ctx.fillStyle = 'rgba(216, 236, 250, 0.34)';
    ctx.fillRect(0, 120, VW, 96);
  }

  function drawSkyline() {
    for (var i = 0; i < L.buildings.length; i++) {
      var b = L.buildings[i];
      var size = AAB.assets.urbanSize(b.urbanId, b.scale);
      var x = px(b.x, b.scroll);
      if (x + size.w < -8 || x > VW + 8) continue;
      AAB.assets.urban(ctx, b.urbanId, x, b.baselineY - size.h, b.scale);
    }
  }

  function drawTiles() {
    var c0 = Math.max(0, Math.floor(G.cam.x / T) - 1);
    var c1 = Math.min(L.widthTiles - 1, Math.floor((G.cam.x + VW) / T));
    var r0 = Math.max(0, Math.floor(G.cam.y / T));
    var r1 = Math.min(L.heightTiles - 1, Math.floor((G.cam.y + VH) / T));
    for (var i = 0; i < solids.length; i++) {
      var s = solids[i];
      if (s.x < c0 || s.x > c1 || s.y < r0 || s.y > r1) continue;
      AAB.assets.tile(ctx, L.tiles[s.y * L.widthTiles + s.x], s.x * T - G.cam.x, s.y * T - G.cam.y, 3);
    }
    // water shimmer (animated, non-collidable decoration over the hazard tiles)
    var water = AAB.level.TILES.water;
    for (var y = r0; y <= r1; y++) {
      for (var x = c0; x <= c1; x++) {
        var v = tileAt(x, y);
        if (v === 0 || !AAB.level.WATER[v]) continue;
        var dx = x * T - G.cam.x, dy = y * T - G.cam.y;
        AAB.assets.tile(ctx, v, dx, dy, 3);
        ctx.fillStyle = 'rgba(255,255,255,0.20)';
        var wob = Math.sin(time * 3 + x * 0.7 + y) * 4;
        ctx.fillRect(dx + 2, dy + 10 + wob * 0.4, T * 3 - 4, 3);
        ctx.fillStyle = 'rgba(255,255,255,0.10)';
        ctx.fillRect(dx + 4, dy + 6 - wob * 0.3, T * 3 - 8, 2);
      }
    }
  }

  function propGroundY(pr) { return pr.groundTopRow * T + T; }

  function drawProps() {
    for (var i = 0; i < L.props.length; i++) {
      var pr = L.props[i];
      if (pr.kind === 'cloud') {
        var cxs = Math.round(G.cam.x * (1 - pr.scroll) + pr.x * pr.scroll - G.cam.x);
        if (cxs > VW + 60 || cxs < -60) continue;
        AAB.assets.tile(ctx, pr.tileIndex, cxs, pr.cloudY, 3);
        continue;
      }
      if (pr.kind === 'urban') {
        var size = AAB.assets.urbanSize(pr.urbanId, pr.scale);
        var x = pr.x - G.cam.x;
        if (x + size.w < -8 || x > VW + 8) continue;
        var gy = propGroundY(pr);
        if (pr.float) gy -= pr.float;
        AAB.assets.urban(ctx, pr.urbanId, x, gy - size.h, pr.scale);
        continue;
      }
      // Kenney kit props
      var kx = pr.x - G.cam.x;
      if (kx < -T * 3 || kx > VW + T * 3) continue;
      var kgy = propGroundY(pr);
      if (pr.kind === 'pipe') {
        AAB.assets.tile(ctx, AAB.level.TILES.pipe, kx, kgy - 6 * T, 3);
        AAB.assets.tile(ctx, AAB.level.TILES.pipe, kx, kgy - 3 * T, 3);
      } else if (pr.kind === 'manhole') {
        AAB.assets.tile(ctx, AAB.level.TILES.manhole, kx, kgy - T * 1.4, 3);
      } else if (pr.kind === 'signpost') {
        AAB.assets.tile(ctx, AAB.level.TILES.signpost, kx, kgy - 2 * T, 3);
        AAB.assets.tile(ctx, AAB.level.TILES.signpost, kx, kgy - T, 3);
      } else if (pr.kind === 'snowman') {
        AAB.assets.tile(ctx, AAB.level.TILES.snowman, kx, kgy - T, 3);
      }
    }
  }

  function drawCoins() {
    for (var i = 0; i < G.coins.length; i++) {
      var c = G.coins[i];
      if (c.taken) continue;
      var sx = c.x - G.cam.x;
      if (sx < -40 || sx > VW + 40) continue;
      var bob = Math.sin(time * 3 + c.bob) * 2;
      var sy = c.y - G.cam.y + bob;
      var idx = c.kind === 'gem' ? AAB.level.TILES.gem : AAB.level.TILES.coin;
      var sq = 0.72 + 0.28 * Math.abs(Math.sin(time * 5 + c.bob));
      ctx.save();
      ctx.translate(sx, sy);
      ctx.scale(sq, 1);
      AAB.assets.tile(ctx, idx, -T * 1.5, -T * 1.5, 3);
      ctx.restore();
    }
    for (var j = 0; j < G.pops.length; j++) {
      var pop = G.pops[j];
      var idx2 = pop.kind === 'gem' ? AAB.level.TILES.gem : AAB.level.TILES.coin;
      AAB.assets.tile(ctx, idx2, pop.x - G.cam.x - T * 1.5, pop.y - G.cam.y - T * 1.5, 3);
    }
  }

  function drawEnemies() {
    for (var i = 0; i < G.enemies.length; i++) {
      var e = G.enemies[i];
      if (!e.alive && e.dying <= 0) continue;
      var sx = e.x - G.cam.x;
      if (sx < -60 || sx > VW + 60) continue;
      var sy = e.y - G.cam.y;
      var idx = e.type === 'rover' ? 18 : 15;
      ctx.save();
      ctx.translate(sx, sy);
      ctx.scale(e.dir < 0 ? -1 : 1, 1);
      if (!e.alive) {                       // stomped: flatten out
        var f = clamp(1 - e.dying / 0.45, 0, 1);
        ctx.globalAlpha = f;
        ctx.translate(0, 4 * (1 - f));
      }
      var bob = e.type === 'rover' ? Math.sin(e.animT * 12) * 1.2 : Math.sin(e.animT * 9) * 2;
      AAB.assets.chr(ctx, idx, -e.w / 2, -e.h + bob, 3);
      ctx.restore();
    }
  }

  function drawGoal() {
    var gx = L.goal.x - G.cam.x;
    if (gx < -80 || gx > VW + 80) return;
    var groundY = L.groundRow * T + T - G.cam.y;
    var topY = L.goal.poleTopY - G.cam.y;
    var poleX = gx + 9;
    // pole: a stack of wooden post tiles
    for (var y = groundY - T; y >= topY; y -= T) {
      AAB.assets.tile(ctx, AAB.level.TILES.signpost, poleX - T * 1.5, y - T, 3);
    }
    // the checkered flag slides down as you finish (Mario-style)
    var t = clamp(G.flagT / 1.4, 0, 1);
    var flagY = lerp(topY + 8, groundY - 3 * T, t);
    AAB.assets.tile(ctx, L.goal.flagTile, poleX + 2, flagY, 3);
    // base block
    AAB.assets.tile(ctx, AAB.level.TILES.wood[0], poleX - T * 1.5, groundY - T, 3);
  }

  function drawPlayer() {
    var p = G.player;
    var sx = Math.round(p.box.x + p.box.w / 2 - G.cam.x);
    var feetY = Math.round(p.box.y + p.box.h - G.cam.y);
    var blink = p.invuln > 0 && Math.floor(time * 18) % 2 === 0;
    if (blink) return;

    var moving = p.grounded && Math.abs(p.vx) > 0.35;
    var frame = moving && Math.floor(p.animT * 2.2) % 2 === 0 ? 7 : 6;
    var bob = moving ? Math.round(Math.sin(p.animT * 9) * 1.6) : 0;
    var sq = 1;
    if (!p.grounded) sq = p.vy < -1 ? 1.08 : 0.92;

    ctx.save();
    ctx.translate(sx, feetY);
    ctx.scale(p.facing, 1);
    ctx.scale(1, sq);
    AAB.assets.chr(ctx, frame, -12, -24 - bob, 3);
    ctx.restore();

    // a tiny winter-scarf pixel? no new art — instead a soft shadow under the feet
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.beginPath();
    ctx.ellipse(sx, feetY, 9, 3, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawLabels() {
    for (var i = 0; i < L.labels.length; i++) {
      var lb = L.labels[i];
      var x = px(lb.x, lb.scroll);
      var y = lb.y - G.cam.y;
      var size = lb.size || 12;
      ctx.font = '700 ' + size + 'px "Courier New", ui-monospace, monospace';
      var w = ctx.measureText(lb.text).width;
      if (x > VW + 10 || x + w < -10 || y < -20 || y > VH + 20) continue;
      ctx.fillStyle = 'rgba(8, 18, 30, 0.72)';
      ctx.fillRect(x - 4, y - size, w + 8, size + 7);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
      ctx.lineWidth = 1;
      ctx.strokeRect(x - 3.5, y - size + 0.5, w + 7, size + 6);
      ctx.fillStyle = lb.color || '#ffe08a';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(lb.text, x, y + 1);
    }
  }

  // ------------------------------------------------------------------------ HUD

  function drawText(text, x, y, size, color, align) {
    ctx.font = '700 ' + size + 'px "Courier New", ui-monospace, monospace';
    ctx.textAlign = align || 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillText(text, x + 1, y + 1);
    ctx.fillStyle = color || '#ffe08a';
    ctx.fillText(text, x, y);
  }

  function drawHud() {
    var p = G.player;
    // hearts = remaining health (Kenney id 44 / 46), plus a lives tally
    for (var i = 0; i < 3; i++) {
      var idx = i < G.health ? AAB.level.TILES.heartFull : AAB.level.TILES.heartEmpty;
      AAB.assets.tile(ctx, idx, 8 + i * 22, 8, 1.2);
    }
    drawText('LIVES ' + Math.max(0, G.lives), 8, 26, 12, '#fff1c1');
    // coin counter
    AAB.assets.tile(ctx, AAB.level.TILES.coin, 8, 46, 1.2);
    drawText('× ' + G.coinCount, 30, 48, 12, '#ffe08a');
    if (G.gemCount > 0) {
      AAB.assets.tile(ctx, AAB.level.TILES.gem, 8, 66, 1.2);
      drawText('× ' + G.gemCount, 30, 68, 12, '#9fe4ff');
    }
    // score / progress / timer
    drawText('SCORE ' + String(G.score).padStart(6, '0'), 8, VH - 20, 12, '#fff1c1');
    var prog = Math.round(clamp(p.box.x / L.goal.x, 0, 1) * 100);
    drawText('LEVEL ' + prog + '%', VW / 2, VH - 20, 12, '#9fe4ff', 'center');
    drawText('T ' + Math.floor(time) + 's', VW - 8, VH - 20, 12, '#9fe4ff', 'right');

    if (G.msgT > 0) {
      ctx.globalAlpha = clamp(G.msgT, 0, 1);
      drawText(G.msg, VW / 2, 96, 18, '#ffe08a', 'center');
      ctx.globalAlpha = 1;
    }
    if (AAB.audio.muted) drawText('MUSIC MUTED (M)', VW - 8, 8, 11, '#ff9b8a', 'right');
  }

  function panel(x, y, w, h) {
    ctx.fillStyle = 'rgba(6, 14, 24, 0.80)';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = 'rgba(126, 200, 255, 0.45)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  }

  function drawOverlays() {
    var p = G.player;
    if (G.phase === PHASE.TITLE) {
      panel(24, 40, VW - 48, 208);
      drawText('ANN ARBOR BROTHERS', VW / 2, 56, 26, '#ffe08a', 'center');
      drawText('LEVEL 1 — HURON STREET TO GO BLUE PLAZA', VW / 2, 86, 12, '#9fe4ff', 'center');
      drawText('PRESS  SPACE  OR  ENTER  TO START', VW / 2, 118, 16,
               Math.floor(G.titleT * 2) % 2 ? '#ffe08a' : '#fff1c1', 'center');
      drawText('← → / A D move   ·   SPACE / W jump   ·   X sprint', VW / 2, 150, 11, '#cfe4f7', 'center');
      drawText('P pause   ·   R restart   ·   M mute   ·   C credits', VW / 2, 166, 11, '#cfe4f7', 'center');
      drawText('Ann Arbor references are low-fi parody signage drawn', VW / 2, 190, 10, '#9fc2e6', 'center');
      drawText('over generic sprites — no real landmark art exists.', VW / 2, 204, 10, '#9fc2e6', 'center');
      drawText('Urban tileset © Dlou Saiyan  ·  tiles by Kenney (CC0)', VW / 2, 226, 10, '#ffe08a', 'center');
      return;
    }

    if (G.phase === PHASE.PAUSED) {
      panel(VW / 2 - 120, 84, 240, 120);
      drawText('PAUSED', VW / 2, 104, 22, '#ffe08a', 'center');
      drawText('P  resume', VW / 2, 140, 12, '#cfe4f7', 'center');
      drawText('R  restart level', VW / 2, 156, 12, '#cfe4f7', 'center');
      drawText('C  credits', VW / 2, 172, 12, '#cfe4f7', 'center');
      return;
    }

    if (G.phase === PHASE.DEAD) {
      panel(VW / 2 - 150, 92, 300, 104);
      drawText('GAME OVER', VW / 2, 108, 24, '#ff9b8a', 'center');
      drawText('Final score ' + G.score + '  ·  coins ' + G.coinCount, VW / 2, 142, 12, '#cfe4f7', 'center');
      drawText('PRESS  R  TO TRY AGAIN', VW / 2, 164, 14, '#ffe08a', 'center');
      return;
    }

    if (G.phase === PHASE.WIN) {
      var t = clamp(G.endTimer / 1.2, 0, 1);
      ctx.globalAlpha = t;
      panel(VW / 2 - 150, 70, 300, 148);
      drawText('LEVEL COMPLETE!', VW / 2, 84, 22, '#ffe08a', 'center');
      drawText('GO BLUE PLAZA — ANN ARBOR, MICHIGAN', VW / 2, 112, 11, '#9fe4ff', 'center');
      drawText('Score ' + G.score + '   Coins ' + G.coinCount + '   Gems ' + G.gemCount, VW / 2, 132, 12, '#fff1c1', 'center');
      drawText('Time ' + Math.floor(time) + 's', VW / 2, 150, 12, '#fff1c1', 'center');
      drawText('PRESS  R  TO PLAY AGAIN', VW / 2, 176, 14, '#ffe08a', 'center');
      ctx.globalAlpha = 1;
      return;
    }

    if (G.phase === PHASE.CREDITS) {
      panel(18, 22, VW - 36, VH - 44);
      drawText('CREDITS / ABOUT', VW / 2, 34, 18, '#ffe08a', 'center');
      drawText('ANN ARBOR BROTHERS — a single-level browser platformer', VW / 2, 60, 11, '#cfe4f7', 'center');
      drawText('World tiles, characters & background fills:', VW / 2, 84, 11, '#9fe4ff', 'center');
      drawText('Kenney “Pixel Platformer” kit — CC0, no restrictions', VW / 2, 98, 12, '#fff1c1', 'center');
      drawText('Urban city tileset (background decoration):', VW / 2, 120, 11, '#9fe4ff', 'center');
      drawText('© Dlou Saiyan — dlousaiyan.com', VW / 2, 134, 12, '#fff1c1', 'center');
      drawText('Used with permission for this project;', VW / 2, 150, 10, '#cfe4f7', 'center');
      drawText('no resale, redistribution or repackaging.', VW / 2, 162, 10, '#cfe4f7', 'center');
      drawText('(The “DLOU SAIYAN” rooftop billboard sprite is', VW / 2, 180, 10, '#9fc2e6', 'center');
      drawText('credited here on purpose, never placed in the level.)', VW / 2, 192, 10, '#9fc2e6', 'center');
      drawText('Music & SFX: generated live with the Web Audio API.', VW / 2, 210, 11, '#9fe4ff', 'center');
      drawText('Ann Arbor flavor: level design + painted text signage', VW / 2, 232, 10, '#9fc2e6', 'center');
      drawText('over generic sprites (no real landmark art exists).', VW / 2, 244, 10, '#9fc2e6', 'center');
      drawText('PRESS  C  OR  ENTER  TO GO BACK', VW / 2, VH - 22, 12, '#ffe08a', 'center');
      return;
    }

    if (G.phase === PHASE.ERROR) {
      panel(VW / 2 - 170, 90, 340, 110);
      drawText('ASSETS UNAVAILABLE', VW / 2, 104, 18, '#ff9b8a', 'center');
      drawText('Some sprite files could not be loaded.', VW / 2, 136, 11, '#cfe4f7', 'center');
      drawText('Serve this folder over http (see page footer).', VW / 2, 150, 11, '#cfe4f7', 'center');
      drawText('PRESS  R  TO RETRY', VW / 2, 176, 12, '#ffe08a', 'center');
    }
  }

  // ---------------------------------------------------------------------- input

  var keys = { left: false, right: false, jump: false, sprint: false };
  var touch = { left: false, right: false, jump: false };
  var keyDownOnce = {};                 // for edge-triggered keys (P/R/M/C)

  function edge(name) {
    if (keyDownOnce[name]) { keyDownOnce[name] = false; return true; }
    return false;
  }

  function bindInput() {
    window.addEventListener('keydown', function (ev) {
      var c = ev.code;
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space',
           'KeyA', 'KeyD', 'KeyW', 'KeyX', 'KeyP', 'KeyR', 'KeyM', 'KeyC',
           'Enter', 'NumpadEnter'].indexOf(c) >= 0) ev.preventDefault();
      switch (c) {
        case 'ArrowLeft': case 'KeyA': keys.left = true; break;
        case 'ArrowRight': case 'KeyD': keys.right = true; break;
        case 'ArrowUp': case 'KeyW': case 'Space': keys.jump = true; break;
        case 'KeyX': keys.sprint = true; break;
        case 'KeyP': keyDownOnce.p = true; break;
        case 'KeyR': keyDownOnce.r = true; break;
        case 'KeyM': keyDownOnce.m = true; break;
        case 'KeyC': keyDownOnce.c = true; break;
        case 'Enter': case 'NumpadEnter': keyDownOnce.enter = true; break;
      }
      firstGesture();
    }, { passive: false });

    window.addEventListener('keyup', function (ev) {
      switch (ev.code) {
        case 'ArrowLeft': case 'KeyA': keys.left = false; break;
        case 'ArrowRight': case 'KeyD': keys.right = false; break;
        case 'ArrowUp': case 'KeyW': case 'Space': keys.jump = false; break;
        case 'KeyX': keys.sprint = false; break;
      }
    });

    window.addEventListener('blur', function () {
      keys.left = keys.right = keys.jump = keys.sprint = false;
      touch.left = touch.right = touch.jump = false;
    });

    var stage = document.getElementById('stage');
    if (stage) stage.addEventListener('pointerdown', function () { firstGesture(); });

    var touchWrap = document.getElementById('touch');
    if (touchWrap) {
      var acts = touchWrap.querySelectorAll('button');
      for (var i = 0; i < acts.length; i++) {
        (function (btn) {
          var act = btn.getAttribute('data-act');
          var set = function (v) { touch[act] = v; firstGesture(); };
          btn.addEventListener('pointerdown', function (ev) { ev.preventDefault(); set(true); });
          btn.addEventListener('pointerup', function (ev) { ev.preventDefault(); set(false); });
          btn.addEventListener('pointerleave', function () { set(false); });
          btn.addEventListener('pointercancel', function () { set(false); });
        })(acts[i]);
      }
    }
  }

  var gestured = false;
  function firstGesture() {
    if (gestured) return;
    gestured = true;
    AAB.audio.unlock();
  }

  function handleMetaKeys() {
    if (edge('m')) {
      var muted = AAB.audio.toggleMute();
      if (!muted) AAB.audio.startMusic();
    }
    if (edge('r')) restart();
    if (edge('c')) toggleCredits();
    if (G.phase === PHASE.TITLE || G.phase === PHASE.DEAD || G.phase === PHASE.WIN) {
      if (edge('enter') || keys.jump) {
        if (G.phase === PHASE.TITLE) startGame();
        else restart();
      }
    } else if (G.phase === PHASE.PLAY || G.phase === PHASE.PAUSED) {
      if (edge('p')) {
        G.phase = G.phase === PHASE.PLAY ? PHASE.PAUSED : PHASE.PLAY;
        AAB.audio.sfx('pause');
      }
    } else if (G.phase === PHASE.CREDITS) {
      if (edge('enter') || edge('c')) {
        G.phase = G.creditsFrom;
        AAB.audio.sfx('select');
      }
    }
  }

  function toggleCredits() {
    if (G.phase === PHASE.CREDITS) {
      G.phase = G.creditsFrom;
    } else if (G.phase === PHASE.TITLE || G.phase === PHASE.PAUSED || G.phase === PHASE.DEAD || G.phase === PHASE.WIN) {
      G.creditsFrom = G.phase;
      G.phase = PHASE.CREDITS;
    }
    AAB.audio.sfx('select');
  }

  function startGame() {
    AAB.audio.unlock();
    AAB.audio.startMusic();
    AAB.audio.sfx('select');
    time = 0;
    newGame();
    G.phase = PHASE.PLAY;
  }

  function restart() {
    AAB.audio.sfx('select');
    time = 0;
    newGame();
    G.phase = PHASE.PLAY;
  }

  // ------------------------------------------------------------------- the loop

  function frame(now) {
    var dtMs = now - lastTime;
    lastTime = now;
    if (!isFinite(dtMs) || dtMs < 0) dtMs = STEP_MS;
    dtMs = Math.min(dtMs, 100);          // never simulate more than 100ms at once
    acc += dtMs;

    handleMetaKeys();

    var guard = 0;
    while (acc >= STEP_MS && guard < 8) {
      step(STEP_MS / 1000);
      acc -= STEP_MS;
      guard++;
    }
    if (guard >= 8) acc = 0;

    render();
    requestAnimationFrame(frame);
  }

  // ----------------------------------------------------------------------- boot

  function boot() {
    canvas = document.getElementById('game');
    if (!canvas) return;
    ctx = canvas.getContext('2d', { alpha: false });
    ctx.imageSmoothingEnabled = false;

    var loadingEl = document.getElementById('loading');
    var detailEl = document.getElementById('loading-detail');
    var fatalEl = document.getElementById('fatal');
    var fatalDetail = document.getElementById('fatal-detail');

    bindInput();
    initLevel();
    newGame();

    AAB.assets.load(function (done, total, label) {
      if (detailEl) detailEl.textContent = done + ' / ' + total + ' — ' + label;
    }).then(function () {
      if (AAB.assets.failedHard) {
        if (loadingEl) loadingEl.classList.add('hidden');
        if (fatalEl) fatalEl.classList.remove('hidden');
        if (fatalDetail) fatalDetail.textContent = AAB.assets.error;
        G.phase = PHASE.ERROR;
      } else {
        if (loadingEl) loadingEl.classList.add('hidden');
        G.phase = PHASE.TITLE;
        AAB.audio.sfx = AAB.audio.sfx;
        console.log('[AAB] ready — ' + (AAB.assets.missing.length
          ? 'missing: ' + AAB.assets.missing.join(', ')
          : 'all assets loaded'));
        if (AAB.assets.error) console.warn('[AAB] ' + AAB.assets.error);
      }
      lastTime = performance.now();
      requestAnimationFrame(frame);
    }).catch(function (err) {
      console.error('[AAB] load failure', err);
      if (loadingEl) loadingEl.classList.add('hidden');
      if (fatalEl) fatalEl.classList.remove('hidden');
      if (fatalDetail) fatalDetail.textContent = String(err && err.message || err);
      G.phase = PHASE.ERROR;
      lastTime = performance.now();
      requestAnimationFrame(frame);
    });
  }

  AAB.boot = boot;
  AAB.PHASE = PHASE;
  AAB.getState = function () { return G; };
})(window);
