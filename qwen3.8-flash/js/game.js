/* game.js — main loop, camera, rendering, HUD, screens, interactions. */
(function () {
  var AA = (typeof window !== 'undefined' ? window : globalThis);
  if (!AA.Assets) return;

  var VIEW_W = 576, VIEW_H = 360;
  var canvas, ctx;

  // ---- input ---------------------------------------------------------------
  var input = { left: false, right: false, run: false, jumpHeld: false, jumpPressed: false };
  function keyMap(code) {
    switch (code) {
      case 'ArrowLeft': case 'KeyA': return 'left';
      case 'ArrowRight': case 'KeyD': return 'right';
      case 'ShiftLeft': case 'ShiftRight': return 'run';
      case 'Space': case 'ArrowUp': case 'KeyW': return 'jump';
    }
    return null;
  }

  // ---- game state ----------------------------------------------------------
  var G = null;
  var bestTime = null;

  function newGame() {
    var level = AA.LEVEL.buildLevel();
    G = {
      mode: 'play', level: level,
      player: AA.Ent.makePlayer(level.spawn),
      enemySpecs: level.enemies.slice(),
      enemies: level.enemies.map(AA.Ent.makeEnemy),
      coins: level.coins.map(function (c) { return { x: c.x, y: c.y, taken: false, t: Math.random() * 6 }; }),
      pickups: level.pickups.map(function (p) { return AA.Ent.makePickup(p.kind, p.x, p.y); }),
      particles: [], popups: [], bumps: [],
      score: 0, coinCount: 0, keys: 0, time: 0, frames: 0,
      camX: 0, camY: 0, respawn: { x: level.spawn.x, y: level.spawn.y },
      cpDone: level.checkpoints.map(function () { return false; }),
      burtonRang: false, chestOpened: false, needKeyHintT: 0,
      winT: 0, overT: 0, splashPlayed: false
    };
  }

  function popup(text, x, y, color) { G.popups.push({ text: text, x: x, y: y, life: 55, color: color || '#fff' }); }

  function respawnPlayer() {
    var p = G.player;
    p.x = G.respawn.x; p.y = G.respawn.y; p.vx = 0; p.vy = 0;
    p.invuln = 100; p.dead = false; p.deadT = 0;
    G.enemies = G.enemySpecs.map(AA.Ent.makeEnemy); // enemies reset, coins stay collected
  }

  function loseHeart(reason) {
    var p = G.player;
    if (p.dead || p.invuln > 0) return;
    if (p.shield > 0) { p.shield = 0; p.invuln = 40; AA.Sound.sfx('bump'); popup('SHIELD POP!', p.x, p.y - 10, '#7fd4ff'); return; }
    p.hearts--;
    AA.Sound.sfx('hurt');
    if (p.hearts <= 0) { die(); return; }
    if (reason === 'pit') { respawnPlayer(); }
    else { // side hit: knockback
      p.invuln = 80; p.vy = -5; p.vx = -p.facing * 3.4;
    }
  }

  function die() {
    G.player.dead = true; G.player.deadT = 0;
    AA.Sound.stopMusic(); AA.Sound.sfx('gameover');
    setTimeout(function () { if (G && G.player.dead) G.mode = 'gameover'; }, 1200);
  }

  function winGame() {
    G.mode = 'win'; G.winT = 0;
    var secs = Math.floor(G.time / 60);
    G.winSecs = secs;
    if (bestTime === null || secs < bestTime) bestTime = secs;
    AA.Sound.stopMusic(); AA.Sound.sfx('win');
  }

  // ---- update --------------------------------------------------------------
  function update() {
    var p = G.player, L = G.level;
    G.frames++;
    if (G.mode === 'play' && !p.dead) G.time++;

    if (G.mode !== 'play') {
      if (G.mode === 'win') G.winT++;
      if (G.mode === 'gameover') G.overT++;
      AA.Ent.updateParticles(G.particles); AA.Ent.updatePopups(G.popups);
      input.jumpPressed = false;
      return;
    }

    var out = AA.Ent.updatePlayer(p, input, L);
    if (out.jumped) AA.Sound.sfx('jump');
    if (out.landedNow) AA.Ent.burst(G.particles, p.x + p.w / 2, p.y + p.h, '#cfc7b0', 3, 1.0);

    // mystery block bumps
    out.bumpedCells.forEach(function (c) {
      var key = c[0] + ',' + c[1], id = AA.Ent.tileAt(L, c[0], c[1]);
      if (id === 10 && L.mystery[key]) {
        L.grid[c[1] * L.COLS + c[0]] = 6; // used block becomes brick
        G.bumps.push({ tx: c[0], ty: c[1], t: 0 });
        var cx = c[0] * L.TILE + 9, cy = c[1] * L.TILE;
        var what = L.mystery[key];
        if (what === 'coin') { G.coinCount++; G.score += 100; AA.Sound.sfx('coin'); popup('+100', cx, cy - 8, '#ffd94a'); AA.Ent.burst(G.particles, cx, cy - 6, '#ffd94a', 6, 1.4); }
        else if (what === 'heart') { p.hearts = Math.min(3, p.hearts + 1); AA.Sound.sfx('powerup'); popup('+1 UP', cx, cy - 8, '#ff7d7d'); }
        else if (what === 'goggles') { G.pickups.push(AA.Ent.makePickup('goggles', cx, cy - 20)); AA.Sound.sfx('keyget'); }
      } else if (id !== -1) { AA.Sound.sfx('bump'); }
      G.bumps.push({ tx: c[0], ty: c[1], t: 0 }); // cosmetic bump for plain blocks too
    });
    for (var bi = G.bumps.length - 1; bi >= 0; bi--) { if (++G.bumps[bi].t > 12) G.bumps.splice(bi, 1); }

    // enemies
    G.enemies.forEach(function (e) { AA.Ent.updateEnemy(e, L); });

    // player <-> enemy
    if (!p.dead) {
      for (var i = 0; i < G.enemies.length; i++) {
        var e = G.enemies[i];
        if (!e.alive || e.dead) continue;
        if (p.x < e.x + e.w && p.x + p.w > e.x && p.y < e.y + e.h && p.y + p.h > e.y) {
          var stomp = p.vy > 0.5 && (p.y + p.h) - e.y < e.h * 0.7;
          if (stomp) {
            AA.Ent.squash(e);
            G.score += 200; popup('+200', e.x + e.w / 2, e.y - 6, '#fff');
            AA.Sound.sfx('stomp');
            AA.Ent.burst(G.particles, e.x + e.w / 2, e.y + e.h / 2, '#d8d8e8', 7, 1.8);
            p.vy = input.jumpHeld ? -10 : -7;
          } else { loseHeart('hit'); }
        }
      }
    }

    // coins
    for (var ci = 0; ci < G.coins.length; ci++) {
      var co = G.coins[ci];
      if (co.taken) continue;
      if (Math.abs(p.x + p.w / 2 - co.x) < 14 && Math.abs(p.y + p.h / 2 - co.y) < 16) {
        co.taken = true; G.coinCount++; G.score += 100;
        AA.Sound.sfx('coin'); popup('+100', co.x, co.y - 8, '#ffd94a');
      }
    }

    // pickups
    for (var pi = 0; pi < G.pickups.length; pi++) {
      var pk = G.pickups[pi];
      if (pk.taken) continue;
      var hitP = p.x < pk.x + 14 && p.x + p.w > pk.x - 14 && p.y < pk.y + 14 && p.y + p.h > pk.y - 14;
      if (!hitP) continue;
      if (pk.kind === 'gem') { pk.taken = true; G.score += 500; AA.Sound.sfx('gem'); popup('+500', pk.x, pk.y - 10, '#7fd4ff'); AA.Ent.burst(G.particles, pk.x, pk.y, '#7fd4ff', 10, 2); }
      else if (pk.kind === 'key') { pk.taken = true; G.keys++; AA.Sound.sfx('keyget'); popup('KEY!', pk.x, pk.y - 10, '#ffd94a'); }
      else if (pk.kind === 'goggles') { pk.taken = true; p.shield = 7 * 60; AA.Sound.sfx('powerup'); popup('GO-GOGGLES! SHIELD UP', p.x, p.y - 12, '#7fd4ff'); }
      else if (pk.kind === 'chest') {
        if (G.keys > 0 && !G.chestOpened) {
          G.chestOpened = true; pk.taken = true; G.score += 1000;
          AA.Sound.sfx('chest'); popup('+1000 TREASURE!', pk.x, pk.y - 26, '#ffd94a');
          AA.Ent.burst(G.particles, pk.x, pk.y - 8, '#ffd94a', 16, 2.4);
        } else if (!G.chestOpened && G.frames > G.needKeyHintT) {
          G.needKeyHintT = G.frames + 90; popup('NEEDS A LITTLE GOLD KEY…', pk.x - 20, pk.y - 26, '#e8e8f0'); AA.Sound.sfx('bump');
        }
      }
    }

    // checkpoints
    L.checkpoints.forEach(function (cp, idx) {
      if (!G.cpDone[idx] && p.x > cp.px) {
        G.cpDone[idx] = true;
        G.respawn = { x: cp.px, y: cp.py };
        AA.Sound.sfx('checkpt'); popup('CHECKPOINT!', cp.px, cp.py - 30, '#7dff9a');
      }
    });

    // Burton carillon zone (once per game)
    if (!G.burtonRang && p.x > L.burtonZone.x0 && p.x < L.burtonZone.x1) {
      G.burtonRang = true; AA.Sound.burtonChime(); popup('♪ ♪ ♪ ♪', p.x, p.y - 34, '#fff');
    }

    // hazards: water + pit (always respawn, even mid-invulnerability)
    var footTx = Math.floor((p.x + p.w / 2) / L.TILE);
    var footTy = Math.floor((p.y + p.h - 2) / L.TILE);
    var inWater = L.HAZARD[AA.Ent.tileAt(L, footTx, footTy)] === true;
    if (!p.dead && (inWater || p.y > L.H + 30)) {
      if (inWater) AA.Ent.burst(G.particles, p.x + p.w / 2, footTy * L.TILE, '#7fd4ff', 10, 2);
      if (p.invuln > 0) { respawnPlayer(); }
      else {
        var wasHearts = p.hearts;
        loseHeart('pit');
        if (p.hearts < wasHearts && !p.dead) respawnPlayer();
      }
    }

    // goal
    var gl = L.goal;
    if (!p.dead && p.x + p.w > gl.x && p.x < gl.x + gl.w && p.y + p.h > gl.y) winGame();

    // camera: lerp + lookahead, clamped
    var targetX = p.x + p.w / 2 + p.facing * 46 - VIEW_W / 2;
    var targetY = p.y + p.h / 2 - VIEW_H / 2 - 20;
    G.camX += (targetX - G.camX) * 0.12;
    G.camY += (targetY - G.camY) * 0.1;
    G.camX = Math.max(0, Math.min(G.camX, L.W - VIEW_W));
    G.camY = Math.max(0, Math.min(G.camY, L.H - VIEW_H));

    AA.Ent.updateParticles(G.particles);
    AA.Ent.updatePopups(G.popups);
    input.jumpPressed = false;
  }

  // ---- rendering -----------------------------------------------------------
  var skyGrad = null;
  function drawSky() {
    if (!skyGrad) {
      skyGrad = ctx.createLinearGradient(0, 0, 0, VIEW_H);
      skyGrad.addColorStop(0, '#63bdf2');
      skyGrad.addColorStop(0.7, '#a8dcf7');
      skyGrad.addColorStop(1, '#d4eefb');
    }
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    // sun
    ctx.fillStyle = 'rgba(255,240,190,0.9)';
    ctx.beginPath(); ctx.arc(VIEW_W - 70, 46, 18, 0, Math.PI * 2); ctx.fill();
  }

  var CLOUDS = [
    { id: 153, x: 60, y: 30 }, { id: 154, x: 260, y: 58 }, { id: 155, x: 430, y: 24 },
    { id: 153, x: 640, y: 64 }, { id: 154, x: 900, y: 34 }, { id: 155, x: 1180, y: 52 },
    { id: 153, x: 1450, y: 26 }, { id: 154, x: 1720, y: 60 }, { id: 155, x: 2000, y: 40 },
    { id: 153, x: 2300, y: 30 }, { id: 154, x: 2620, y: 56 }, { id: 155, x: 2950, y: 36 },
    { id: 153, x: 3250, y: 58 }, { id: 154, x: 3560, y: 28 }
  ];
  function drawFar() {
    var L = G.level;
    // distant tree-line band (Kenney Backgrounds silhouettes)
    var p = 0.25, y = Math.round((L.GROUND_ROW - 4.6) * L.TILE - G.camY * p);
    var off = -((G.camX * p) % 24);
    for (var x = off - 24; x < VIEW_W + 24; x += 24) AA.Assets.drawBgTile(ctx, ((x / 24 | 0) % 2) ? 14 : 15, x, y);
    // clouds drift slowly on top
    var cp = 0.15;
    CLOUDS.forEach(function (c) {
      var sx = c.x - G.camX * cp - (G.frames * 0.08 % 4000);
      sx = ((sx % 3600) + 3600) % 3600 - 100;
      AA.Assets.drawTile(ctx, c.id, sx, c.y - G.camY * cp * 0.3);
    });
    // far urban decor (trees, water tower)
    drawDecoLayer('far', 0.35, 26);
  }

  function drawDecoLayer(layerName, par, lift) {
    var L = G.level;
    G.level.decos.forEach(function (d) {
      if (d.layer !== layerName) return;
      var sx = d.x - G.camX * par, sy = d.y - G.camY * par - (lift || 0);
      if (sx < -320 || sx > VIEW_W + 60) return;
      AA.Assets.drawUrban(ctx, d.id, sx, sy, d.scale, 'bl');
    });
  }

  function drawLandmarks() {
    var L = G.level, par = 0.78;
    drawDecoLayer('landmark', par, -2);
    // Burton clock + dome (drawn over the stacked generic panels — low-fi signage per ASSETS.md)
    var bx = (116 * L.TILE + 34) - G.camX * par, by = (G.GROUND_ROW * L.TILE) - G.camY * par;
    var towerTop = by - 284;
    ctx.fillStyle = '#5b6470';
    ctx.beginPath(); ctx.arc(bx, towerTop - 4, 13, Math.PI, 0); ctx.fill(); // dome
    ctx.fillStyle = '#e9edf2';
    ctx.beginPath(); ctx.arc(bx, towerTop + 16, 11, 0, Math.PI * 2); ctx.fill(); // clock face
    ctx.strokeStyle = '#2a2f38'; ctx.lineWidth = 1.5;
    var ang = (G.frames / 90) % (Math.PI * 2);
    ctx.beginPath(); ctx.moveTo(bx, towerTop + 16); ctx.lineTo(bx + Math.cos(ang) * 7, towerTop + 16 + Math.sin(ang) * 7); ctx.stroke();
    // stadium bunting under the label
    var sx0 = 184 * L.TILE - G.camX * par, sx1 = 210 * L.TILE - G.camX * par;
    var byy = (G.GROUND_ROW - 11.6) * L.TILE - G.camY * par;
    ctx.strokeStyle = '#3a4250'; ctx.beginPath(); ctx.moveTo(sx0, byy); ctx.lineTo(sx1, byy + 8); ctx.stroke();
    for (var fx = 0; fx < 13; fx++) {
      var t0 = fx / 12, fxx = sx0 + (sx1 - sx0) * t0, fyy = byy + 8 * t0;
      ctx.fillStyle = fx % 2 ? '#ffcb05' : '#00274c';
      ctx.beginPath(); ctx.moveTo(fxx - 4, fyy); ctx.lineTo(fxx + 4, fyy); ctx.lineTo(fxx, fyy + 9); ctx.closePath(); ctx.fill();
    }
  }

  function drawTerrain() {
    var L = G.level, T = L.TILE;
    var x0 = Math.max(0, Math.floor(G.camX / T)), x1 = Math.min(L.COLS - 1, Math.ceil((G.camX + VIEW_W) / T));
    var y0 = Math.max(0, Math.floor(G.camY / T)), y1 = Math.min(L.ROWS - 1, Math.ceil((G.camY + VIEW_H) / T));
    // water body fill behind animated surface
    for (var wx = x0; wx <= x1; wx++) {
      if (L.HAZARD[AA.Ent.tileAt(L, wx, L.GROUND_ROW)]) {
        ctx.fillStyle = '#2a6ea6';
        var wy = L.GROUND_ROW * T - Math.round(G.camY);
        ctx.fillRect(wx * T - Math.round(G.camX), wy + 8, T, VIEW_H);
      }
    }
    for (var ty = y0; ty <= y1; ty++) {
      for (var tx = x0; tx <= x1; tx++) {
        var id = L.grid[ty * L.COLS + tx];
        if (id === -1) continue;
        var dx = tx * T - Math.round(G.camX), dy = ty * T - Math.round(G.camY);
        // animated water surface: cycle wave variants
        if (L.HAZARD[id]) id = [33, 34, 35][(tx + ((G.frames / 12) | 0)) % 3];
        // bump animation offset for mystery/brick cells
        var bumpOff = 0;
        for (var b = 0; b < G.bumps.length; b++) {
          if (G.bumps[b].tx === tx && G.bumps[b].ty === ty) {
            bumpOff = -Math.round(Math.sin(G.bumps[b].t / 12 * Math.PI) * 5);
          }
        }
        AA.Assets.drawTile(ctx, id, dx, dy + bumpOff);
      }
    }
  }

  function drawSigns() {
    var L = G.level;
    L.signs.forEach(function (s) {
      var par = s.lp || 1;
      var sx = s.x - G.camX * par, sy = s.y - G.camY * par;
      if (sx < -300 || sx > VIEW_W + 300) return;
      ctx.textAlign = 'center';
      if (s.style === 'board') {
        ctx.font = '700 10px monospace';
        var w = Math.max(ctx.measureText(s.text).width, s.sub ? ctx.measureText(s.sub).width : 0) + 14;
        var h = s.sub ? 26 : 15;
        // post + board sitting above the ground line
        var bx = sx - w / 2, by = sy - h - 16;
        ctx.fillStyle = '#6b4a2b'; ctx.fillRect(Math.round(sx - 1.5), Math.round(by + h), 3, 16);
        ctx.fillStyle = 'rgba(28,30,40,0.88)'; ctx.fillRect(Math.round(bx), Math.round(by), Math.round(w), h);
        ctx.strokeStyle = '#ffcb05'; ctx.lineWidth = 1; ctx.strokeRect(Math.round(bx) + .5, Math.round(by) + .5, Math.round(w) - 1, h - 1);
        ctx.fillStyle = '#ffffff'; ctx.fillText(s.text, sx, by + 11);
        if (s.sub) { ctx.font = '700 8px monospace'; ctx.fillStyle = '#ffd966'; ctx.fillText(s.sub, sx, by + 22); }
      } else { // painted on buildings — low-fi landmark signage
        var size = s.big ? 17 : 12;
        ctx.font = '700 ' + size + 'px monospace';
        ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,20,45,0.85)';
        ctx.strokeText(s.text, sx, sy);
        ctx.fillStyle = '#ffffff'; ctx.fillText(s.text, sx, sy);
        if (s.sub) {
          ctx.font = '700 9px monospace';
          ctx.lineWidth = 2.5; ctx.strokeText(s.sub, sx, sy + 13);
          ctx.fillStyle = '#ffdd66'; ctx.fillText(s.sub, sx, sy + 13);
        }
      }
    });
    // checkpoint flags + goal flagpole (world layer)
    L.checkpoints.forEach(function (cp, i) {
      var sx = cp.x - Math.round(G.camX), sy = cp.y - Math.round(G.camY);
      ctx.fillStyle = '#8a93a2'; ctx.fillRect(sx, sy - 64, 3, 64);
      AA.Assets.drawTile(ctx, G.cpDone[i] ? 111 : 112, sx + 3, sy - 64);
    });
    var gl = L.goal, gx = Math.round(gl.x) - Math.round(G.camX), gy = Math.round(gl.y) - Math.round(G.camY);
    ctx.fillStyle = '#7a5230'; ctx.fillRect(gx, gy, 4, gl.h);
    AA.Assets.drawTile(ctx, 111, gx + 4, gy);
    AA.Assets.drawTile(ctx, 112, gx + 22, gy + 6);
    // pulsing glow so the goal reads from afar
    ctx.fillStyle = 'rgba(255,203,5,' + (0.16 + 0.1 * Math.sin(G.frames / 14)) + ')';
    ctx.fillRect(gx - 8, gy - 6, 52, gl.h + 10);
  }

  function drawEntities() {
    var L = G.level, p = G.player;
    // coins
    G.coins.forEach(function (c) {
      if (c.taken) return;
      var sx = c.x - Math.round(G.camX), sy = c.y - Math.round(G.camY);
      if (sx < -20 || sx > VIEW_W + 20) return;
      AA.Assets.drawTile(ctx, 151, sx - 9, sy - 9 + Math.round(Math.sin(G.frames / 14 + c.t) * 2));
    });
    // pickups
    G.pickups.forEach(function (k) {
      if (k.taken && k.kind !== 'chest') return;
      var sx = k.x - Math.round(G.camX), sy = k.y - Math.round(G.camY);
      var bob = Math.round(Math.sin(G.frames / 13 + k.t) * 2);
      if (k.kind === 'gem') AA.Assets.drawTile(ctx, 67, sx - 9, sy - 9 + bob);
      else if (k.kind === 'key') AA.Assets.drawTile(ctx, 27, sx - 9, sy - 9 + bob);
      else if (k.kind === 'goggles') AA.Assets.drawTile(ctx, 68, sx - 9, sy - 9 + bob);
      else if (k.kind === 'chest') {
        AA.Assets.drawTile(ctx, G.chestOpened ? 9 : 28, sx - 9, sy - 18);
      }
    });
    // enemies
    G.enemies.forEach(function (e) {
      if (!e.alive) return;
      var sx = Math.round(e.x) - Math.round(G.camX), sy = Math.round(e.y) - Math.round(G.camY);
      if (sx < -30 || sx > VIEW_W + 30) return;
      if (e.dead) {
        ctx.save();
        ctx.translate(sx + e.w / 2, sy + e.h);
        ctx.scale(1.25, Math.max(0.15, 0.5 - e.deadT * 0.03));
        AA.Assets.drawChar(ctx, e.frame, -e.w / 2 - 4, -e.h, false);
        ctx.restore();
      } else {
        AA.Assets.drawChar(ctx, e.frame, sx + (e.w - 24) / 2, sy + (e.h - 24), (e.face || e.vx) < 0);
      }
    });
    // player
    if (!(p.invuln > 0 && ((G.frames / 3 | 0) % 2))) {
      var px = Math.round(p.x + (p.w - 24) / 2) - Math.round(G.camX);
      var py = Math.round(p.y + p.h - 24) - Math.round(G.camY);
      var frame;
      if (p.dead) frame = 7;
      else if (!p.onGround) frame = 7;
      else if (Math.abs(p.vx) > 0.3) frame = ((G.frames / 7 | 0) % 2) ? 7 : 6;
      else frame = 6;
      AA.Assets.drawChar(ctx, frame, px, py, p.facing < 0);
      if (p.shield > 0) {
        var blink = p.shield < 120 && ((G.frames / 4 | 0) % 2);
        if (!blink) {
          ctx.strokeStyle = 'rgba(127,212,255,0.85)'; ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.arc(px + 12, py + 12, 16 + Math.sin(G.frames / 6), 0, Math.PI * 2); ctx.stroke();
        }
      }
    }
    // particles
    G.particles.forEach(function (pt) {
      ctx.globalAlpha = Math.max(0, pt.life / pt.max);
      ctx.fillStyle = pt.color;
      ctx.fillRect(Math.round(pt.x - G.camX), Math.round(pt.y - G.camY), pt.size, pt.size);
      ctx.globalAlpha = 1;
    });
    // popups
    ctx.textAlign = 'center'; ctx.font = '700 9px monospace';
    G.popups.forEach(function (u) {
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillText(u.text, Math.round(u.x - G.camX) + 1, Math.round(u.y - G.camY) + 1);
      ctx.fillStyle = u.color;
      ctx.fillText(u.text, Math.round(u.x - G.camX), Math.round(u.y - G.camY));
    });
  }

  function drawHUD() {
    // hearts
    for (var i = 0; i < 3; i++) AA.Assets.drawTile(ctx, i < G.player.hearts ? 44 : 46, 8 + i * 17, 8);
    // coin + count
    AA.Assets.drawTile(ctx, 151, 8, 30);
    AA.Assets.drawNumber(ctx, G.coinCount, 28, 30);
    // score
    ctx.textAlign = 'left'; ctx.font = '700 9px monospace'; ctx.fillStyle = '#fff';
    ctx.fillText('SCORE', 84, 15);
    AA.Assets.drawNumber(ctx, G.score, 84, 20);
    // key count
    if (G.keys > 0) { AA.Assets.drawTile(ctx, 27, 8, 52); ctx.fillText('× ' + G.keys, 28, 66); }
    // timer right side
    var secs = Math.floor(G.time / 60), m = Math.floor(secs / 60), s = secs % 60;
    ctx.textAlign = 'right';
    ctx.fillText('TIME', VIEW_W - 8, 15);
    AA.Assets.drawNumber(ctx, m, VIEW_W - 40, 20);
    ctx.fillText(':', VIEW_W - 28, 30);
    AA.Assets.drawNumber(ctx, s < 10 ? '0' + s : s, VIEW_W - 22, 20);
    if (bestTime !== null) { ctx.fillStyle = '#ffd966'; ctx.fillText('BEST ' + Math.floor(bestTime / 60) + ':' + ('0' + bestTime % 60).slice(-2), VIEW_W - 8, 44); }
    // shield bar
    if (G.player.shield > 0) {
      ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.fillRect(VIEW_W / 2 - 40, 8, 80, 6);
      ctx.fillStyle = '#7fd4ff'; ctx.fillRect(VIEW_W / 2 - 39, 9, 78 * (G.player.shield / 420), 4);
    }
    ctx.textAlign = 'right'; ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.font = '700 8px monospace';
    ctx.fillText(AA.Sound.isMuted() ? '[M] SOUND OFF' : '[M] SOUND ON', VIEW_W - 6, VIEW_H - 6);
  }

  // ---- overlay screens -------------------------------------------------------
  function panel(w, h) {
    ctx.fillStyle = 'rgba(10,14,26,0.82)';
    var x = (VIEW_W - w) / 2, y = (VIEW_H - h) / 2;
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = '#ffcb05'; ctx.lineWidth = 2; ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
    return { x: x, y: y };
  }

  var idleFrames = 0;
  function drawTitle() {
    ctx.fillStyle = 'rgba(6,10,22,0.55)'; ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    ctx.textAlign = 'center';
    ctx.font = '700 34px monospace';
    ctx.lineWidth = 5; ctx.strokeStyle = '#00274c';
    ctx.strokeText('MAIZE & BLUE', VIEW_W / 2, 96);
    ctx.fillStyle = '#ffcb05'; ctx.fillText('MAIZE & BLUE', VIEW_W / 2, 96);
    ctx.font = '700 11px monospace'; ctx.fillStyle = '#fff';
    ctx.fillText('A 2D PLATFORMER · DOWNTOWN ANN ARBOR, MICHIGAN', VIEW_W / 2, 118);
    ctx.font = '700 9px monospace'; ctx.fillStyle = '#cfe3ff';
    ctx.fillText('← → / A D  MOVE     SHIFT  RUN     SPACE / ↑  JUMP', VIEW_W / 2, 156);
    ctx.fillText('STOMP ENEMIES · GRAB COINS & THE LITTLE GOLD KEY', VIEW_W / 2, 172);
    ctx.fillText('FROM THE DIAG TO THE BIG HOUSE — DON\'T TOUCH THE HURON!', VIEW_W / 2, 188);
    if (((idleFrames / 30 | 0) % 2)) {
      ctx.font = '700 12px monospace'; ctx.fillStyle = '#ffcb05';
      ctx.fillText('PRESS SPACE OR TAP TO START', VIEW_W / 2, 224);
    }
    ctx.font = '700 8px monospace'; ctx.fillStyle = '#9fb3d1';
    ctx.fillText('Urban tileset © Dlou Saiyan — used with credit (required by license)', VIEW_W / 2, 268);
    ctx.fillText('Kenney "Pixel Platformer" assets — CC0 · Music & SFX generated live (Web Audio)', VIEW_W / 2, 281);
    ctx.fillText('Ann Arbor landmarks are loving low-fi parody signs, not real art.', VIEW_W / 2, 294);
    if (bestTime !== null) { ctx.fillStyle = '#ffd966'; ctx.fillText('BEST TIME ' + Math.floor(bestTime / 60) + ':' + ('0' + bestTime % 60).slice(-2), VIEW_W / 2, 316); }
  }

  function drawGameOver() {
    var p = panel(340, 150);
    ctx.textAlign = 'center';
    ctx.font = '700 24px monospace'; ctx.fillStyle = '#ff6d6d';
    ctx.fillText('GAME OVER', VIEW_W / 2, p.y + 48);
    ctx.font = '700 10px monospace'; ctx.fillStyle = '#fff';
    ctx.fillText('THE BIG HOUSE WILL HAVE TO WAIT…', VIEW_W / 2, p.y + 76);
    ctx.fillText('SCORE ' + G.score + ' · COINS ' + G.coinCount, VIEW_W / 2, p.y + 94);
    if (((G.overT / 30 | 0) % 2)) { ctx.fillStyle = '#ffcb05'; ctx.fillText('PRESS SPACE OR TAP — RESTART AT THE DIAG', VIEW_W / 2, p.y + 124); }
  }

  function drawWin() {
    var p = panel(392, 268);
    // billboard sprite first (behind text): the artist's sign belongs on the credits screen (per ASSETS.md)
    AA.Assets.drawUrban(ctx, 70, VIEW_W / 2 - 48, p.y + 196, 0.68, 'bl');
    ctx.textAlign = 'center';
    ctx.font = '700 26px monospace'; ctx.fillStyle = '#ffcb05';
    ctx.fillText('TOUCHDOWN!', VIEW_W / 2, p.y + 34);
    ctx.font = '700 10px monospace'; ctx.fillStyle = '#fff';
    ctx.fillText('YOU MADE IT FROM THE DIAG TO THE BIG HOUSE', VIEW_W / 2, p.y + 56);
    var secs = G.winSecs;
    ctx.fillText('SCORE ' + G.score + ' · COINS ' + G.coinCount + ' · TIME ' + Math.floor(secs / 60) + ':' + ('0' + secs % 60).slice(-2), VIEW_W / 2, p.y + 74);
    ctx.font = '700 8px monospace'; ctx.fillStyle = '#cfe3ff';
    ctx.fillText('THANKS FOR PLAYING · ANN ARBOR, MICHIGAN', VIEW_W / 2, p.y + 214);
    ctx.fillStyle = '#9fb3d1';
    ctx.fillText('Urban tileset © Dlou Saiyan (dlousaiyan.com) — required credit', VIEW_W / 2, p.y + 230);
    ctx.fillText('Kenney "Pixel Platformer" kit — CC0 · Procedural chiptune via Web Audio', VIEW_W / 2, p.y + 242);
    if (((G.winT / 30 | 0) % 2)) { ctx.fillStyle = '#ffcb05'; ctx.font = '700 10px monospace'; ctx.fillText('PRESS SPACE OR TAP TO PLAY AGAIN', VIEW_W / 2, p.y + 260); }
  }

  function drawPaused() {
    ctx.fillStyle = 'rgba(6,10,22,0.6)'; ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    ctx.textAlign = 'center'; ctx.font = '700 20px monospace'; ctx.fillStyle = '#fff';
    ctx.fillText('PAUSED', VIEW_W / 2, VIEW_H / 2 - 6);
    ctx.font = '700 9px monospace'; ctx.fillStyle = '#cfe3ff';
    ctx.fillText('P OR ESC TO RESUME · R TO RESTART', VIEW_W / 2, VIEW_H / 2 + 14);
  }

  function render() {
    ctx.imageSmoothingEnabled = false;
    drawSky();
    if (G) {
      drawFar();
      drawDecoLayer('mid', 0.6, 0);
      drawLandmarks();
      drawDecoLayer('back', 1, 0);
      drawTerrain();
      drawSigns();
      drawEntities();
      if (G.mode !== 'title') drawHUD();
    }
    if (!G || G.mode === 'title') drawTitle();
    else if (G.mode === 'gameover') drawGameOver();
    else if (G.mode === 'win') drawWin();
    else if (G.paused) drawPaused();
  }

  // ---- boot ------------------------------------------------------------------
  function action() { // space/tap context action
    if (!G || G.mode === 'title') { AA.Sound.ensure(); AA.Sound.startMusic(); newGame(); }
    else if (G.mode === 'gameover' && G.overT > 30) { AA.Sound.ensure(); AA.Sound.startMusic(); newGame(); }
    else if (G.mode === 'win' && G.winT > 40) { AA.Sound.ensure(); AA.Sound.startMusic(); newGame(); }
    input.jumpPressed = false; // don't let the menu-press key leak into a starting jump
  }

  function init(canvasEl) {
    canvas = canvasEl;
    ctx = canvas.getContext('2d');
    canvas.width = VIEW_W; canvas.height = VIEW_H;

    function fit() {
      var s = Math.min(window.innerWidth / VIEW_W, window.innerHeight / VIEW_H);
      canvas.style.width = Math.floor(VIEW_W * s) + 'px';
      canvas.style.height = Math.floor(VIEW_H * s) + 'px';
    }
    window.addEventListener('resize', fit); fit();

    window.addEventListener('keydown', function (ev) {
      if (ev.repeat && keyMap(ev.code)) { if (keyMap(ev.code) === 'jump') input.jumpHeld = true; ev.preventDefault(); return; }
      var k = keyMap(ev.code);
      if (k === 'jump') { input.jumpHeld = true; input.jumpPressed = true; actionIfNeeded(); }
      else if (k) input[k] = true;
      if (ev.code === 'KeyM') AA.Sound.toggleMute();
      if ((ev.code === 'KeyP' || ev.code === 'Escape') && G && G.mode === 'play') { G.paused = !G.paused; }
      if (ev.code === 'KeyR' && G && (G.mode === 'play' || G.mode === 'gameover')) { AA.Sound.ensure(); AA.Sound.startMusic(); newGame(); }
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space'].indexOf(ev.code) >= 0) ev.preventDefault();
    });
    window.addEventListener('keyup', function (ev) {
      var k = keyMap(ev.code);
      if (k === 'jump') input.jumpHeld = false;
      else if (k) input[k] = false;
    });

    function actionIfNeeded() {
      AA.Sound.ensure();
      if (!G || G.mode !== 'play') action();
    }
    canvas.addEventListener('pointerdown', function (ev) {
      // touch controls: left/right thirds move, top half jumps — touch only, not mouse clicks
      AA.Sound.ensure();
      if (!G || G.mode !== 'play') { action(); return; }
      if (ev.pointerType !== 'touch') return;
      var r = canvas.getBoundingClientRect(), x = (ev.clientX - r.left) / r.width, y = (ev.clientY - r.top) / r.height;
      if (x < 0.35) input.left = true; else if (x > 0.65) input.right = true;
      if (y < 0.5) { input.jumpPressed = true; input.jumpHeld = true; }
    });
    canvas.addEventListener('pointerup', function () { input.left = false; input.right = false; input.jumpHeld = false; });
    canvas.addEventListener('pointercancel', function () { input.left = false; input.right = false; input.jumpHeld = false; });

    // fixed-timestep loop @60fps
    var last = performance.now(), acc = 0, STEP_MS = 1000 / 60;
    function frame(now) {
      requestAnimationFrame(frame);
      var dt = Math.min(now - last, 120); last = now; acc += dt;
      var steps = 0;
      while (acc >= STEP_MS && steps < 5) {
        idleFrames++;
        if (G && !G.paused) update();
        acc -= STEP_MS; steps++;
      }
      render();
    }

    // auto-pause + release keys when the tab/window loses focus (no stuck movement)
    function blurPause() {
      input.left = input.right = input.run = input.jumpHeld = input.jumpPressed = false;
      if (G && G.mode === 'play') G.paused = true;
    }
    window.addEventListener('blur', blurPause);
    document.addEventListener('visibilitychange', function () { if (document.hidden) blurPause(); });
    canvas.addEventListener('contextmenu', function (ev) { ev.preventDefault(); });

    AA.Assets.loadAll(function () {
      newGame(); G.mode = 'title'; // live level preview behind the title card
      requestAnimationFrame(frame);
    });
  }

  // expose for headless smoke test
  AA.Game = {
    init: init,
    update: function () { update(); },
    render: function () { if (ctx) render(); },
    _state: function () { return G; },
    _input: input,
    _setCtx: function (c) { ctx = c; },
    action: action, newGame: newGame
  };

  if (typeof document !== 'undefined' && document.getElementById) {
    var el = document.getElementById('game');
    if (el) init(el);
  }
})();
