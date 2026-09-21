/* =========================================================================
   Renderer: parallax backdrop, terrain, props, actors, signage, HUD, screens.
   ========================================================================= */
(function () {
  var T = AA.TILE;
  var VW = AA.VIEW_W, VH = AA.VIEW_H;
  var PROP_SCALE = AA.PROP_SCALE;
  var fontLoaded = false;

  AA.PALETTE = {
    diag: { near: '#6f8f8a', far: '#93ada8', win: '#d8f2e4' },
    street: { near: '#5a6b86', far: '#8291ab', win: '#ffe6a8' },
    river: { near: '#5d7a6a', far: '#8fa896', win: '#d8f0dc' },
    build: { near: '#7a6a5e', far: '#a08f7e', win: '#ffd9a0' },
    stadium: { near: '#5e6474', far: '#8b92a3', win: '#ffeec2' },
  };

  function skyGradient(ctx, zone) {
    var g = ctx.createLinearGradient(0, 0, 0, VH);
    var s = {
      diag: ['#8fcdf0', '#d9f0fb', '#f2f7ea'],
      street: ['#7cc0ea', '#cfe8f7', '#f6ecd9'],
      river: ['#8fd6e8', '#dcf2f4', '#eef6ea'],
      build: ['#f0c98a', '#f6dfb4', '#f7eada'],
      stadium: ['#7fb6e4', '#cbdcf0', '#eee9dd'],
    }[zone] || ['#8fcdf0', '#d9f0fb', '#f2f7ea'];
    g.addColorStop(0, s[0]);
    g.addColorStop(0.55, s[1]);
    g.addColorStop(1, s[2]);
    return g;
  }

  function drawCloud(ctx, x, y, s, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(x, y, 16 * s, 0, Math.PI * 2);
    ctx.arc(x + 18 * s, y - 6 * s, 20 * s, 0, Math.PI * 2);
    ctx.arc(x + 40 * s, y + 2 * s, 15 * s, 0, Math.PI * 2);
    ctx.arc(x + 20 * s, y + 8 * s, 17 * s, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // ------------------------------------------------------------------ world
  function drawBackdrop(g, ctx) {
    var camX = g.camX, camY = g.camY;
    var zone = g.zoneAt(camX + VW * 0.5);
    ctx.fillStyle = skyGradient(ctx, zone);
    ctx.fillRect(0, 0, VW, VH);

    // sun / haze disc
    ctx.save();
    ctx.globalAlpha = 0.5;
    var sg = ctx.createRadialGradient(VW * 0.78, 86, 8, VW * 0.78, 86, 130);
    sg.addColorStop(0, 'rgba(255,244,200,1)');
    sg.addColorStop(1, 'rgba(255,244,200,0)');
    ctx.fillStyle = sg;
    ctx.fillRect(VW * 0.78 - 140, -60, 280, 280);
    ctx.restore();

    // clouds
    var cloudKeys = ['cloud153', 'cloud154', 'cloud155'];
    for (var i = 0; i < 7; i++) {
      var cx = ((i * 337 - camX * 0.08) % (VW + 300) + VW + 300) % (VW + 300) - 150;
      var cy = 40 + ((i * 53) % 90);
      var kl = cloudKeys[i % 3];
      var scale = 0.9 + (i % 3) * 0.35;
      ctx.save();
      ctx.globalAlpha = 0.72;
      if (!AA.kenney.draw(ctx, kl, cx, cy, scale, 'topleft')) drawCloud(ctx, cx, cy, 0.7 + (i % 3) * 0.25, 0.75);
      ctx.restore();
    }

    // far skyline
    var far = g.skyline[zone];
    ctx.save();
    ctx.globalAlpha = 0.5;
    tileBackdrop(ctx, far, -camX * 0.14, 340 - camY * 0.25, 0.85);
    ctx.restore();
    // near skyline
    tileBackdrop(ctx, far, -camX * 0.3, 400 - camY * 0.42, 1);
  }

  function tileBackdrop(ctx, cv, ox, oy, scale) {
    if (!cv) return;
    var w = cv.width * scale, h = cv.height * scale;
    var start = Math.floor((-ox) / w) * w + ox;
    for (var x = start; x < VW; x += w) {
      if (x + w < -20) continue;
      ctx.drawImage(cv, 0, 0, cv.width, cv.height, x, oy, w, h);
    }
  }

  function drawTerrain(g, ctx) {
    var L = AA.LEVEL;
    var x0 = Math.max(0, Math.floor(g.camX / T) - 1);
    var x1 = Math.min(L.cols - 1, Math.floor((g.camX + VW) / T) + 1);
    var y0 = 0, y1 = L.grid.length - 1;   // authored rows; below that is solid earth
    for (var ty = y0; ty <= y1; ty++) {
      for (var tx = x0; tx <= x1; tx++) {
        var ch = AA.tileAt(tx, ty);
        if (ch === '.') continue;
        var zone = g.zoneAt(tx * T);
        var edge = {
          top: !AA.levelSolid(tx, ty - 1),
          left: !AA.levelSolid(tx - 1, ty),
          right: !AA.levelSolid(tx + 1, ty),
          bottom: !AA.levelSolid(tx, ty + 1),
        };
        // Kenney art is the primary path (ASSETS.md §1); the procedural
        // painters are the fallback if the atlas is unavailable.
        var painted = false;
        if (ch === 'w') {
          painted = AA.drawKenneyWater(ctx, tx, ty, g.t, edge) ||
                    (AA.drawWaterTile(ctx, tx, ty, g.t, edge), true);
        } else if (ch === 'B') {
          painted = AA.drawKenneyBrick(ctx, tx, ty) || (AA.drawBrickTile(ctx, tx, ty), true);
        } else if (ch === '=') {
          painted = AA.drawKenneyPlank(ctx, tx, ty, g.t) || (AA.drawPlankTile(ctx, tx, ty, g.t), true);
        } else if (ch === 'H') {
          painted = AA.drawKenneyHedge(ctx, tx, ty) || (AA.drawHedge(ctx, tx * T, ty * T, T, T, g.t), true);
        } else {
          painted = AA.drawKenneyGround(ctx, tx, ty, zone, edge) ||
                    (AA.drawGroundTile(ctx, tx, ty, zone, edge, g.t), true);
        }
        if (!painted) AA.drawGroundTile(ctx, tx, ty, zone, edge, g.t);
      }
    }

    // Below the authored rows the world is solid earth: one flat fill instead
    // of thousands of individual tiles.
    var deepTop = L.grid.length * T;
    var deepH = L.worldRows * T - deepTop;
    if (deepH > 0) {
      for (var bx = x0; bx <= x1; bx++) {
        var p = AA.ZONES[g.zoneAt(bx * T)] || AA.ZONES.diag;
        ctx.fillStyle = p.soilD;
        ctx.fillRect(bx * T, deepTop, T, deepH);
        ctx.fillStyle = 'rgba(0,0,0,0.22)';
        ctx.fillRect(bx * T, deepTop, T, 3);
      }
    }
  }

  function drawAmbient(g, ctx) {
    var x0 = g.camX - 340, x1 = g.camX + VW + 140;
    for (var i = 0; i < g.ambient.length; i++) {
      var p = g.ambient[i];
      if (p.x < x0 || p.x > x1) continue;
      ctx.save();
      ctx.globalAlpha = 0.62;   // canopy is scenery: never bury the play lane
      AA.drawSprite(ctx, p.id, p.x, p.y, PROP_SCALE[p.id] || 1, { anchor: 'bottom' });
      ctx.restore();
    }
  }

  function drawProps(g, ctx) {
    var x0 = g.camX - 340, x1 = g.camX + VW + 140;
    for (var i = 0; i < g.props.length; i++) {
      var p = g.props[i];
      if (p.x < x0 || p.x > x1) continue;
      AA.drawSprite(ctx, p.id, p.x, p.y, PROP_SCALE[p.id] || 1, { anchor: 'bottom' });
    }
  }

  // ---------------------------------------------------------------- signage
  function drawLabel(ctx, text, x, y, size, color, bg) {
    ctx.save();
    ctx.font = '700 ' + size + 'px "Courier New", ui-monospace, monospace';
    ctx.textBaseline = 'middle';
    var w = ctx.measureText(text).width + 18;
    var h = size + 12;
    if (bg) {
      ctx.globalAlpha = 0.92;
      AA.roundRect(ctx, x - w / 2, y - h / 2, w, h, 4);
      ctx.fillStyle = bg;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.lineWidth = 2;
      ctx.strokeStyle = 'rgba(0,0,0,0.45)';
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    AA.spacedText(ctx, text, x + 2, y + 2, 2, 'center');
    ctx.fillStyle = color || '#fff';
    AA.spacedText(ctx, text, x, y, 2, 'center');
    ctx.restore();
  }

  function drawSign(ctx, worldX, worldY, text, fontPx, fg, bg, t) {
    var boardW = ctx.measureText(text).width;
    var bob = Math.sin(t * 1.6) * 1.4;
    var x = worldX, y = worldY + bob;
    // post
    ctx.fillStyle = '#5d3a1a';
    ctx.fillRect(x - 3, y, 6, 26);
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(x + 1, y, 2, 26);
    drawLabel(ctx, text, x, y, fontPx, fg, bg);
    // little mount brackets
    ctx.fillStyle = '#3d260f';
    ctx.fillRect(x - 6, y + 2, 12, 4);
  }

  function drawShopSign(ctx, x, y, text, fontPx, t) {
    var sway = Math.sin(t * 1.2) * 1.6;
    ctx.save();
    ctx.translate(x, y + sway);
    ctx.strokeStyle = '#4a4a52';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(-2.5, -30); ctx.lineTo(-2.5, 0); ctx.moveTo(2.5, -30); ctx.lineTo(2.5, 0); ctx.stroke();
    ctx.rotate(Math.sin(t * 1.2) * 0.02);
    ctx.font = '700 ' + fontPx + 'px "Courier New", ui-monospace, monospace';
    var w = ctx.measureText(text).width + 20;
    var h = fontPx + 14;
    ctx.globalAlpha = 0.96;
    AA.roundRect(ctx, -w / 2, -h / 2 - 18, w, h, 3);
    ctx.fillStyle = '#7a1f1a';
    ctx.fill();
    ctx.strokeStyle = '#f0d9a0';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = '#ffe9b0';
    ctx.textBaseline = 'middle';
    AA.spacedText(ctx, text, 0, -18, 1.5, 'center');
    ctx.restore();
  }

  function drawWinter(ctx, x, groundY, t) {
    // Ann Arbor winter easter egg. Kenney's snowman tile when available,
    // otherwise a small hand-drawn one in maize and blue.
    if (AA.kenney.draw(ctx, 'snowman145', x, groundY, 1.6, 'bottom')) {
      AA.kenney.draw(ctx, 'snow144', x + 30, groundY, 1.1, 'bottom', 0.9);
      return;
    }
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.beginPath(); ctx.ellipse(x, groundY - 9, 15, 9, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(x, groundY - 22, 11, 10, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(x, groundY - 34, 8, 8, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#12131a';
    ctx.fillRect(x - 4, groundY - 37, 2, 2);
    ctx.fillRect(x + 2, groundY - 37, 2, 2);
    ctx.fillStyle = '#ff8b2e';
    ctx.fillRect(x - 1, groundY - 33, 7, 3);
    ctx.fillStyle = '#00274c';
    ctx.fillRect(x - 10, groundY - 30, 20, 8);
    ctx.fillStyle = '#ffcb05';
    ctx.fillRect(x - 11, groundY - 48, 22, 5);
    ctx.fillRect(x - 7, groundY - 60, 14, 13);
    ctx.fillStyle = '#ff8b2e';
    ctx.fillRect(x - 2, groundY - 56, 4, 4);
    ctx.restore();
  }

  function drawTargets(g, ctx) {
    var x0 = g.camX - 320, x1 = g.camX + VW + 220;
    for (var i = 0; i < g.targets.length; i++) {
      var t = g.targets[i];
      var wx = t[1] * T, wy = (t[2] + 1) * T - 30;
      if (wx < x0 || wx > x1) continue;
      if (t[0] === 'sign') {
        ctx.save();
        ctx.font = '700 ' + t[4] + 'px "Courier New", ui-monospace, monospace';
        drawSign(ctx, wx, wy, t[3], t[4], t[5], t[6], g.t);
        ctx.restore();
      } else if (t[0] === 'shop') {
        drawShopSign(ctx, wx, wy - 4, t[3], t[4], g.t);
      } else if (t[0] === 'winter') {
        drawWinter(ctx, wx, (t[2] + 1) * T, g.t);
      }
    }
  }

  function drawCheckpoints(g, ctx) {
    for (var i = 0; i < g.checkpoints.length; i++) {
      var c = g.checkpoints[i];
      var x = c.x, y = c.y;
      // kiosk post with a maize lantern; university maize when claimed
      ctx.fillStyle = '#3a4250';
      ctx.fillRect(x - 3, y - 46, 6, 46);
      ctx.fillStyle = '#2a303c';
      ctx.fillRect(x - 10, y - 4, 20, 6);
      var col = c.taken ? '#ffcb05' : '#8c93a0';
      ctx.fillStyle = col;
      AA.roundRect(ctx, x - 11, y - 62, 22, 16, 3);
      ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(x - 11, y - 50, 22, 4);
      if (c.taken) {
        var pulse = 0.5 + 0.5 * Math.sin(g.t * 5);
        var gl = ctx.createRadialGradient(x, y - 54, 2, x, y - 54, 46);
        gl.addColorStop(0, 'rgba(255,203,5,' + (0.42 * pulse + 0.12) + ')');
        gl.addColorStop(1, 'rgba(255,203,5,0)');
        ctx.fillStyle = gl;
        ctx.fillRect(x - 50, y - 104, 100, 100);
      }
    }
  }

  function drawGoal(g, ctx) {
    var gx = g.goal.x, gy = g.goal.y;
    var flagDrop = 0;
    if (g.finishT > 0) flagDrop = Math.min(1, g.finishT / 1.6) * 92;
    ctx.save();
    // pole
    ctx.fillStyle = '#c9ccd4';
    ctx.fillRect(gx - 3, gy - 150, 6, 150);
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.fillRect(gx - 3, gy - 150, 2, 150);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(gx + 1, gy - 150, 2, 150);
    // banner sign
    drawLabel(ctx, 'GOAL', gx, gy - 166, 15, '#ffcb05', '#00274c');
    // ball
    ctx.fillStyle = '#ffcb05';
    ctx.beginPath(); ctx.arc(gx, gy - 152, 7, 0, Math.PI * 2); ctx.fill();
    // checkered flag
    var fy = gy - 146 + flagDrop;
    var w = 46, h = 30;
    var cells = 6, cellW = w / cells, cellH = h / 3;
    for (var r = 0; r < 3; r++) {
      for (var cIdx = 0; cIdx < cells; cIdx++) {
        ctx.fillStyle = ((r + cIdx) % 2) ? '#12131a' : '#f7f7f2';
        var wob = Math.sin(g.t * 3 + cIdx * 0.6 + r) * 2.2;
        ctx.fillRect(gx + 3 + cIdx * cellW, fy + r * cellH + wob, cellW + 0.6, cellH + 0.6);
      }
    }
    if (g.finishT > 0) {
      var gl = ctx.createRadialGradient(gx, fy + 15, 4, gx, fy + 15, 90);
      gl.addColorStop(0, 'rgba(255,203,5,0.35)');
      gl.addColorStop(1, 'rgba(255,203,5,0)');
      ctx.fillStyle = gl;
      ctx.fillRect(gx - 90, fy - 75, 180, 180);
    }
    ctx.restore();
  }

  function drawCoins(g, ctx) {
    for (var i = 0; i < g.coins.length; i++) {
      var c = g.coins[i];
      if (c.taken) continue;
      if (c.x < g.camX - 40 || c.x > g.camX + VW + 40) continue;
      var bob = Math.sin(g.t * 2.6 + c.t) * 3;
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.16)';
      ctx.beginPath(); ctx.ellipse(c.x, c.y + 16, 7, 3, 0, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      if (!AA.kenney.draw(ctx, 'gem67', c.x, c.y + bob, 1.3, 'center')) {
        var spin = Math.abs(Math.cos(g.t * 2.4 + c.t * 0.7));
        var w = 4 + spin * 12;
        ctx.save();
        ctx.translate(c.x, c.y + bob);
        ctx.fillStyle = '#2f9fd0';
        ctx.beginPath();
        ctx.moveTo(0, -11); ctx.lineTo(w / 2, 0); ctx.lineTo(0, 11); ctx.lineTo(-w / 2, 0);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#8fe6ff';
        ctx.beginPath();
        ctx.moveTo(0, -11); ctx.lineTo(w / 4, 0); ctx.lineTo(0, 11); ctx.lineTo(-w / 4, 0);
        ctx.closePath(); ctx.fill();
        ctx.restore();
      }
    }
  }

  function drawEnemies(g, ctx) {
    for (var i = 0; i < g.enemies.length; i++) {
      var e = g.enemies[i];
      if (e.x < g.camX - 80 || e.x > g.camX + VW + 80) continue;
      ctx.save();
      if (e.dead) {
        var k = AA.clamp(e.deadT / 0.5, 0, 1);
        ctx.globalAlpha = 1 - k;
        ctx.translate(e.x, e.feetY);
        ctx.scale(1 + k * 0.5, Math.max(0.12, 1 - k));
        ctx.translate(-e.x, -e.feetY);
      }
      var art = AA.SPR.actor && AA.SPR.actor[e.def.art || e.type];
      var drewArt = false;
      if (art) drewArt = art.draw(ctx, e.x, e.feetY, e.vx > 0 ? 1 : -1, Math.floor(e.anim) % 2);
      var img = null;
      if (!drewArt) img = (AA.SPR[e.type] || AA.SPR.robo)[Math.floor(e.anim) % 2];
      if (img) {
        ctx.save();
        if (e.vx > 0) {
          ctx.translate(e.x + img.width / 2, e.feetY - img.height);
          ctx.scale(-1, 1);
          ctx.drawImage(img, 0, 0);
        } else {
          ctx.drawImage(img, e.x - img.width / 2, e.feetY - img.height);
        }
        ctx.restore();
      }
      if (e.hurtT > 0) {
        ctx.globalAlpha = 0.5 + 0.5 * Math.sin(g.t * 40);
        ctx.fillStyle = '#fff';
        ctx.fillRect(e.x - img.width / 2, e.feetY - img.height, img.width, img.height);
      }
      ctx.restore();
      // drone rotor blur
      if (e.type === 'drone' && !e.dead) {
        var dw = art ? art.w : (img ? img.width : 22);
        var dh = art ? art.h : (img ? img.height : 20);
        ctx.save();
        ctx.globalAlpha = 0.35;
        ctx.fillStyle = '#dfe6f0';
        var rw = 10 + Math.sin(g.t * 40 + e.phase) * 6;
        ctx.fillRect(e.x - dw / 2 - 4, e.feetY - dh - 1, rw, 2);
        ctx.fillRect(e.x + dw / 2 - rw + 4, e.feetY - dh - 1, rw, 2);
        ctx.restore();
      }
    }
  }

  function drawPlayer(g, ctx) {
    var p = g.player;
    if (p.invuln > 0 && Math.floor(g.t * 20) % 2 === 0) return;
    var set = AA.SPR.player;
    var dirIdx = p.dir < 0 ? 1 : 0;
    var img = null;
    if (!p.onGround) img = set.jump[dirIdx];
    else if (Math.abs(p.vx) > 8) img = set.walk[dirIdx][p.anim % 4];
    else img = set.idle[dirIdx][0];
    var art = AA.SPR.actor && AA.SPR.actor.player;

    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.beginPath();
    ctx.ellipse(p.x, p.feetY + 1, 11, 3.5, 0, 0, Math.PI * 2);
    ctx.fill();
    var drewPlayer = false;
    if (art) {
      var frame = !p.onGround ? 0 : (Math.abs(p.vx) > 8 ? (p.anim % 2) : 0);
      drewPlayer = art.draw(ctx, p.x, p.feetY, p.dir, frame);
    }
    if (!drewPlayer) ctx.drawImage(img, Math.round(p.x - img.width / 2), Math.round(p.feetY - img.height));

    if (p.invuln > 0) {
      ctx.globalAlpha = 0.35;
      ctx.strokeStyle = '#ffcb05';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(p.x, p.feetY - p.h / 2, 24 + Math.sin(g.t * 12) * 2, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    // hoodie breeze
    if (Math.abs(p.vx) > 120) {
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = '#ffcb05';
      var bx = p.x - p.dir * 12;
      ctx.fillRect(bx, p.feetY - 34, 6 * -p.dir, 3);
      ctx.fillRect(bx - p.dir * 3, p.feetY - 28, 5 * -p.dir, 3);
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  function drawParticles(g, ctx) {
    for (var i = 0; i < g.particles.length; i++) {
      var q = g.particles[i];
      var a = AA.clamp(q.life / 0.6, 0, 1);
      ctx.globalAlpha = a;
      ctx.fillStyle = q.color;
      if (q.shape === 'spark') {
        ctx.fillRect(q.x - q.size, q.y - 1, q.size * 2, 2);
        ctx.fillRect(q.x - 1, q.y - q.size, 2, q.size * 2);
      } else {
        ctx.fillRect(q.x, q.y, q.size, q.size);
      }
    }
    ctx.globalAlpha = 1;
    ctx.font = '700 14px "Courier New", ui-monospace, monospace';
    ctx.textAlign = 'left';
    for (i = 0; i < g.floaters.length; i++) {
      var f = g.floaters[i];
      ctx.globalAlpha = AA.clamp(f.life, 0, 1);
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      AA.spacedText(ctx, f.text, f.x + 1, f.y + 1, 1, 'center');
      ctx.fillStyle = f.color;
      AA.spacedText(ctx, f.text, f.x, f.y, 1, 'center');
    }
    ctx.globalAlpha = 1;
  }

  // ------------------------------------------------------------------- HUD
  function heart(ctx, x, y, filled) {
    if (AA.kenney.ready) {
      var key = filled ? 'heart44' : 'heart46';
      if (AA.kenney.drawFit(ctx, key, x - 10, y - 10, 20, 20)) return;
    }
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = filled ? '#e0483c' : 'rgba(255,255,255,0.18)';
    ctx.beginPath();
    ctx.moveTo(0, 5);
    ctx.bezierCurveTo(-8, -3, -5, -10, 0, -5);
    ctx.bezierCurveTo(5, -10, 8, -3, 0, 5);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();
  }

  function drawHUD(g, ctx) {
    ctx.save();
    ctx.font = '700 15px "Courier New", ui-monospace, monospace';
    ctx.textBaseline = 'middle';

    // panel
    ctx.globalAlpha = 0.55;
    AA.roundRect(ctx, 10, 10, 300, 54, 5);
    ctx.fillStyle = '#080c14';
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = 'rgba(255,203,5,0.35)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    for (var i = 0; i < 3; i++) heart(ctx, 30 + i * 24, 28, i < g.lives);
    ctx.fillStyle = '#ffcb05';
    AA.spacedText(ctx, 'SCORE ' + ('' + g.score).padStart(6, '0'), 100, 28, 1.5, 'left');
    ctx.fillStyle = '#8fe6ff';
    AA.spacedText(ctx, 'GEMS ' + g.gems + '/' + g.coins.length, 100, 48, 1.5, 'left');
    ctx.fillStyle = '#dfe6f0';
    AA.spacedText(ctx, 'A2: ONE MORE MILE', 10, 78, 1, 'left');

    // clock + location, top right
    ctx.globalAlpha = 0.55;
    AA.roundRect(ctx, VW - 210, 10, 200, 30, 5);
    ctx.fillStyle = '#080c14';
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = 'rgba(255,203,5,0.35)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = '#f7f7f2';
    AA.spacedText(ctx, 'TIME ' + AA.fmtTime(g.timer), VW - 196, 26, 1.5, 'left');
    ctx.fillStyle = '#ffcb05';
    AA.spacedText(ctx, 'SEED ' + (g.seed % 10000), VW - 26, 26, 1.5, 'right');

    // location banner under the clock
    var zone = g.zoneAt(g.camX + VW * 0.5);
    var names = {
      diag: 'CENTRAL CAMPUS / THE DIAG',
      street: 'STATE STREET',
      river: 'HURON RIVER',
      build: 'CONSTRUCTION AHEAD',
      stadium: 'STADIUM BLVD',
    };
    ctx.fillStyle = 'rgba(8,12,20,0.74)';
    AA.roundRect(ctx, VW - 250, 46, 240, 24, 4);
    ctx.fill();
    ctx.fillStyle = '#ffe6a8';
    ctx.font = '700 12px "Courier New", ui-monospace, monospace';
    AA.spacedText(ctx, names[zone] || '', VW - 26, 58, 1.2, 'right');

    // credits line (satisfies the Dlou Saiyan attribution requirement)
    ctx.font = '700 11px "Courier New", ui-monospace, monospace';
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    AA.spacedText(ctx, 'tiles: Dlou Saiyan (urbantileset)', 10, VH - 9, 1, 'left');
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    AA.spacedText(ctx, 'tiles: Dlou Saiyan (urbantileset)', 9, VH - 10, 1, 'left');
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    AA.spacedText(ctx, 'ARROWS/WASD move  SPACE jump  P pause  M mute  R reset', VW - 9, VH - 10, 1, 'right');
    ctx.restore();
  }

  // ---------------------------------------------------------------- screens
  function dim(ctx, a) {
    ctx.fillStyle = 'rgba(4,8,16,' + a + ')';
    ctx.fillRect(0, 0, VW, VH);
  }

  function panel(ctx, x, y, w, h) {
    ctx.globalAlpha = 0.9;
    AA.roundRect(ctx, x, y, w, h, 8);
    ctx.fillStyle = '#0a1220';
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = 'rgba(255,203,5,0.5)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,203,5,0.16)';
    ctx.lineWidth = 6;
    ctx.stroke();
  }

  function drawTitle(g, ctx) {
    ctx.fillStyle = skyGradient(ctx, 'diag');
    ctx.fillRect(0, 0, VW, VH);
    drawCloud(ctx, 120, 90, 1.1, 0.6);
    drawCloud(ctx, 700, 130, 0.9, 0.5);
    drawCloud(ctx, 430, 60, 0.7, 0.4);

    // skyline silhouette
    ctx.save();
    ctx.globalAlpha = 0.85;
    tileBackdrop(ctx, g.skyline ? g.skyline.diag : null, 0, 300, 1);
    ctx.restore();

    // ground strip
    ctx.fillStyle = '#4e8c2c';
    ctx.fillRect(0, VH - 90, VW, 90);
    ctx.fillStyle = '#7fbf4a';
    ctx.fillRect(0, VH - 90, VW, 8);
    for (var i = 0; i < VW; i += 14) {
      ctx.fillStyle = i % 28 ? '#5fa63c' : '#6fb445';
      ctx.fillRect(i, VH - 96 - ((i * 7) % 5), 3, 6);
    }

    // snow
    if (g.snow) {
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      for (i = 0; i < g.snow.length; i++) ctx.fillRect(g.snow[i].x, g.snow[i].y, g.snow[i].s, g.snow[i].s);
    }

    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.font = '700 66px "Courier New", ui-monospace, monospace';
    ctx.fillStyle = 'rgba(0,39,76,0.55)';
    AA.spacedText(ctx, 'ANN ARBOR', VW / 2 + 4, 156 + 4, 6, 'center');
    ctx.fillStyle = '#ffcb05';
    AA.spacedText(ctx, 'ANN ARBOR', VW / 2, 156, 6, 'center');
    ctx.strokeStyle = 'rgba(0,39,76,0.8)';
    ctx.lineWidth = 2;
    ctx.font = '700 30px "Courier New", ui-monospace, monospace';
    ctx.fillStyle = '#00274c';
    AA.spacedText(ctx, 'THE PLATFORMER', VW / 2 + 2, 204 + 2, 8, 'center');
    ctx.fillStyle = '#f7f7f2';
    AA.spacedText(ctx, 'THE PLATFORMER', VW / 2, 204, 8, 'center');

    panel(ctx, VW / 2 - 250, 244, 500, 182);
    ctx.font = '700 16px "Courier New", ui-monospace, monospace';
    ctx.fillStyle = '#ffcb05';
    AA.spacedText(ctx, 'LEVEL 1: A2 - ONE MORE MILE', VW / 2, 282, 2, 'center');
    ctx.fillStyle = '#dfe6f0';
    ctx.font = '700 14px "Courier New", ui-monospace, monospace';
    var lines = [
      'Run the Diag, dodge campus rovers, find the gems,',
      'cross the Huron, climb Burton Tower, take the steps',
      'to the Big House and grab the checkered flag.',
    ];
    for (i = 0; i < lines.length; i++) {
      AA.spacedText(ctx, lines[i], VW / 2, 312 + i * 22, 1, 'center');
    }
    ctx.fillStyle = '#8fe6ff';
    AA.spacedText(ctx, 'SPACE / ENTER to start', VW / 2, 390, 2, 'center');
    ctx.font = '700 11px "Courier New", ui-monospace, monospace';
    ctx.fillStyle = 'rgba(255,255,255,0.72)';
    AA.spacedText(ctx, 'Music + SFX are generated live by the Web Audio API. Each run gets a new seed.', VW / 2, 414, 0.4, 'center');
    ctx.fillStyle = '#ffcb05';
    AA.spacedText(ctx, 'Art: Dlou Saiyan (urbantileset) - credit required by its licence', VW / 2, VH - 58, 0.4, 'center');
    ctx.fillStyle = 'rgba(255,255,255,0.72)';
    AA.spacedText(ctx, 'Player, enemies, terrain and sky are generated procedurally at runtime', VW / 2, VH - 40, 0.4, 'center');
  }

  function drawEndScreen(g, ctx, win) {
    dim(ctx, 0.55);
    panel(ctx, VW / 2 - 280, 74, 560, 400);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = '700 40px "Courier New", ui-monospace, monospace';
    ctx.fillStyle = win ? '#ffcb05' : '#e0483c';
    AA.spacedText(ctx, win ? 'LEVEL CLEAR!' : 'GAME OVER', VW / 2, 122, 4, 'center');
    ctx.font = '700 15px "Courier New", ui-monospace, monospace';
    ctx.fillStyle = win ? '#8fe6ff' : '#c9ccd4';
    AA.spacedText(ctx, win ? 'THE BIG HOUSE HAS NEVER LOOKED BETTER' : 'THE ROVERS WIN THIS ONE', VW / 2, 154, 2, 'center');

    var rows = [
      ['SCORE', '' + g.score],
      ['TIME', AA.fmtTime(g.timer)],
      ['GEMS', g.gems + ' / ' + g.coins.length],
      ['ROVERS STOMPED', '' + g.stomps],
      ['FALLS', '' + Math.max(0, g.deaths - (win ? 0 : 1))],
    ];
    ctx.font = '700 17px "Courier New", ui-monospace, monospace';
    for (var i = 0; i < rows.length; i++) {
      var y = 200 + i * 34;
      ctx.fillStyle = '#c9ccd4';
      AA.spacedText(ctx, rows[i][0], VW / 2 - 230, y, 2, 'left');
      ctx.fillStyle = '#f7f7f2';
      AA.spacedText(ctx, rows[i][1], VW / 2 + 230, y, 2, 'right');
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.fillRect(VW / 2 - 230, y + 14, 460, 1);
    }
    if (win) {
      var grade = g.gems >= g.coins.length && g.deaths === 0 ? 'A+  WOLVERINE PERFECT' :
        (g.gems >= g.coins.length * 0.7 ? 'A   MAIZE AND BLUE' :
          (g.gems >= g.coins.length * 0.4 ? 'B   CAMPUS REGULAR' : 'C   TOURIST'));
      ctx.fillStyle = '#ffcb05';
      AA.spacedText(ctx, 'GRADE: ' + grade, VW / 2, 386, 2, 'center');
    } else {
      ctx.fillStyle = '#ffcb05';
      AA.spacedText(ctx, 'PRESS SPACE TO RUN IT AGAIN', VW / 2, 386, 2, 'center');
    }
    ctx.font = '700 12px "Courier New", ui-monospace, monospace';
    ctx.fillStyle = 'rgba(255,255,255,0.65)';
    AA.spacedText(ctx, 'Urban tileset art (c) Dlou Saiyan - used with permission', VW / 2, 436, 1, 'center');
    AA.spacedText(ctx, 'Player, enemies, terrain and music are generated procedurally at runtime', VW / 2, 454, 1, 'center');
    if (win) {
      ctx.fillStyle = '#8fe6ff';
      AA.spacedText(ctx, 'SPACE to play again', VW / 2, 486, 2, 'center');
    }
  }

  // ------------------------------------------------------------------ entry
  AA.render = function (g) {
    var ctx = g.ctx;
    var shakeX = 0, shakeY = 0;
    if (g.shake > 0) {
      shakeX = AA.rand(-g.shake, g.shake);
      shakeY = AA.rand(-g.shake, g.shake);
    }
    var zone = g.zoneAt((g.camX || 0) + VW * 0.5);

    if (g.state === 'title') {
      drawTitle(g, ctx);
      return;
    }

    ctx.fillStyle = skyGradient(ctx, zone);
    ctx.fillRect(0, 0, VW, VH);
    ctx.save();
    ctx.translate(-Math.round(g.camX) + shakeX, -Math.round(g.camY) + shakeY);
    drawBackdrop(g, ctx);
    ctx.restore();

    ctx.save();
    ctx.translate(-Math.round(g.camX) + shakeX, -Math.round(g.camY) + shakeY);
    drawTerrain(g, ctx);
    drawAmbient(g, ctx);      // trees / buildings sit behind the ground lip
    drawProps(g, ctx);        // street furniture + crates sit in front
    drawCheckpoints(g, ctx);
    drawGoal(g, ctx);
    drawTargets(g, ctx);
    drawCoins(g, ctx);
    drawEnemies(g, ctx);
    drawPlayer(g, ctx);
    drawParticles(g, ctx);
    ctx.restore();

    // vignette + damage flash
    var vg = ctx.createRadialGradient(VW / 2, VH / 2, VH * 0.35, VW / 2, VH / 2, VH * 0.95);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(4,10,20,0.34)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, VW, VH);
    if (g.hitFlash > 0) {
      ctx.fillStyle = 'rgba(224,72,60,' + (g.hitFlash * 0.5) + ')';
      ctx.fillRect(0, 0, VW, VH);
    }

    drawHUD(g, ctx);

    if (g.paused && g.state === 'play') {
      dim(ctx, 0.5);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.font = '700 40px "Courier New", ui-monospace, monospace';
      ctx.fillStyle = '#ffcb05';
      AA.spacedText(ctx, 'PAUSED', VW / 2, VH / 2 - 10, 6, 'center');
      ctx.font = '700 14px "Courier New", ui-monospace, monospace';
      ctx.fillStyle = '#dfe6f0';
      AA.spacedText(ctx, 'P to resume   M to mute   R to reset to checkpoint', VW / 2, VH / 2 + 34, 1, 'center');
    }
    if (g.state === 'win') drawEndScreen(g, ctx, true);
    if (g.state === 'over') drawEndScreen(g, ctx, false);
  };
})();
