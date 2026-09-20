/* entities.js — player/enemy/pickup behavior + tile collision. No canvas calls here. */
(function () {
  var AA = (typeof window !== 'undefined' ? window : globalThis);

  var GRAV = 0.5, TERM_VY = 10.5;
  var WALK = 2.7, RUN = 3.9, ACC = 0.42, AIR_ACC = 0.28;
  var JUMP_V = -9.6, JUMP_CUT = 0.55, COYOTE = 6, BUFFER = 7; // cut floor keeps a tap-jump clearing one tile (~28px apex)

  function tileAt(level, tx, ty) {
    if (tx < 0 || tx >= level.COLS) return 100;   // world side walls are solid dirt
    if (ty < 0) return -1;                          // open sky above
    if (ty >= level.ROWS) return -1;                // below = pit (handled as death)
    return level.grid[ty * level.COLS + tx];
  }
  function isSolid(level, tx, ty) { return level.SOLID[tileAt(level, tx, ty)] === true; }

  // AABB vs tile grid. e: {x,y,w,h,vx,vy}. Returns collision flags + head-bump cells.
  function moveEntity(level, e) {
    var res = { hitX: false, landed: false, bumped: [], floorBelow: false };
    var T = level.TILE;

    // --- horizontal ---
    e.x += e.vx;
    var top = Math.floor(e.y / T), bot = Math.floor((e.y + e.h - 1) / T);
    if (e.vx > 0) {
      var tx = Math.floor((e.x + e.w - 1) / T);
      for (var ty = top; ty <= bot; ty++) if (isSolid(level, tx, ty)) { e.x = tx * T - e.w; e.vx = 0; res.hitX = true; break; }
    } else if (e.vx < 0) {
      var tx2 = Math.floor(e.x / T);
      for (var ty2 = top; ty2 <= bot; ty2++) if (isSolid(level, tx2, ty2)) { e.x = (tx2 + 1) * T; e.vx = 0; res.hitX = true; break; }
    }

    // --- vertical ---
    e.y += e.vy;
    var left = Math.floor(e.x / T), right = Math.floor((e.x + e.w - 1) / T);
    if (e.vy > 0) {
      var tyb = Math.floor((e.y + e.h - 1) / T);
      for (var tx3 = left; tx3 <= right; tx3++) if (isSolid(level, tx3, tyb)) { e.y = tyb * T - e.h; e.vy = 0; res.landed = true; break; }
    } else if (e.vy < 0) {
      var tyt = Math.floor(e.y / T);
      for (var tx4 = left; tx4 <= right; tx4++) if (isSolid(level, tx4, tyt)) { e.y = (tyt + 1) * T; e.vy = 0; res.bumped.push([tx4, tyt]); }
    }

    // ground probe just under feet (edge detection for walkers)
    var footY = Math.floor((e.y + e.h + 2) / T);
    var fx = e.vx >= 0 ? Math.floor((e.x + e.w + 2) / T) : Math.floor((e.x - 2) / T);
    res.floorBelow = isSolid(level, fx, footY);
    return res;
  }

  // ---- player --------------------------------------------------------------
  function makePlayer(spawn) {
    return {
      kind: 'player', x: spawn.x, y: spawn.y, vx: 0, vy: 0, w: 13, h: 22,
      facing: 1, onGround: false, coyote: 0, jbuf: 0, animT: 0,
      hearts: 3, invuln: 0, shield: 0, dead: false, deadT: 0, spawnX: spawn.x, spawnY: spawn.y
    };
  }

  function updatePlayer(p, input, level) {
    var out = { jumped: false, landedNow: false, bumpedCells: [] };
    if (p.dead) {
      p.deadT++;
      if (p.deadT === 1) p.vy = -8;
      p.vy = Math.min(p.vy + GRAV, TERM_VY);
      p.y += p.vy;
      return out;
    }

    var maxv = input.run ? RUN : WALK;
    var acc = p.onGround ? ACC : AIR_ACC;
    if (input.left)  { p.vx = Math.max(p.vx - acc, -maxv); p.facing = -1; }
    else if (input.right) { p.vx = Math.min(p.vx + acc, maxv); p.facing = 1; }
    else if (p.onGround) { p.vx *= 0.82; if (Math.abs(p.vx) < 0.06) p.vx = 0; }

    // jump buffering + coyote time
    p.jbuf = input.jumpPressed ? BUFFER : Math.max(0, p.jbuf - 1);
    p.coyote = p.onGround ? COYOTE : Math.max(0, p.coyote - 1);
    if (p.jbuf > 0 && p.coyote > 0) {
      p.vy = JUMP_V; p.jbuf = 0; p.coyote = 0; p.onGround = false; out.jumped = true;
    }
    if (!input.jumpHeld && p.vy < JUMP_V * JUMP_CUT) p.vy = JUMP_V * JUMP_CUT; // variable height

    p.vy = Math.min(p.vy + GRAV, TERM_VY);
    var wasGround = p.onGround;
    var res = moveEntity(level, p);
    p.onGround = res.landed;
    if (res.landed && !wasGround) out.landedNow = true;
    out.bumpedCells = res.bumped;

    if (p.invuln > 0) p.invuln--;
    if (p.shield > 0) p.shield--;
    p.animT += Math.abs(p.vx) * 0.12 + 0.02;
    return out;
  }

  // ---- enemies ---------------------------------------------------------------
  var ENEMY_DEFS = {
    rover: { w: 16, h: 15, spd: 0.8,  frames: [18, 19, 20] },
    grunt: { w: 14, h: 13, spd: 0.55, frames: [13, 14] },
    drone: { w: 18, h: 14, spd: 1.2,  frames: [15], fly: true },
    owl:   { w: 20, h: 16, spd: 0.9,  frames: [25], fly: true },
    bat:   { w: 18, h: 14, spd: 1.5,  frames: [24], fly: true }
  };

  function makeEnemy(spec, idx) {
    var d = ENEMY_DEFS[spec.kind];
    return {
      kind: spec.kind, def: d, x: spec.x - d.w / 2, y: spec.y - d.h, vx: d.spd * (idx % 2 ? -1 : 1), vy: 0,
      w: d.w, h: d.h, baseX: spec.x - d.w / 2, baseY: spec.y - d.h,
      range: spec.range || 0, spd: spec.spd || d.spd, t: idx * 1.7,
      frame: d.frames[idx % d.frames.length], dead: false, deadT: 0, alive: true
    };
  }

  function updateEnemy(e, level) {
    if (!e.alive) return;
    e.t += 1 / 60;
    if (e.dead) { // squashed: brief squash anim then gone
      e.deadT++;
      if (e.deadT > 18) e.alive = false;
      return;
    }
    if (e.def.fly) {
      var amp = e.kind === 'drone' ? 0.6 : 1.0;
      e.x = e.baseX + Math.sin(e.t * e.spd) * e.range;
      e.y = e.baseY + Math.sin(e.t * e.spd * 2.3) * 5 * amp - (e.kind === 'bat' ? Math.abs(Math.sin(e.t * 1.1)) * 14 : 0);
      if (Math.cos(e.t * e.spd) > 0) e.face = 1; else e.face = -1;
    } else {
      var prevVx = e.vx;
      var res = moveEntity(level, e);
      if (res.hitX) e.vx = -prevVx;                       // wall — turn around
      else if (!res.floorBelow && Math.abs(e.vx) > 0.01) e.vx = -e.vx; // ledge — turn around
      e.face = e.vx >= 0 ? 1 : -1;
    }
  }

  function squash(e) { e.dead = true; e.deadT = 0; }

  // ---- pickups / particles / popups ------------------------------------------
  function makePickup(kind, x, y) { return { kind: kind, x: x, y: y, t: Math.random() * 6, taken: false }; }

  function burst(list, x, y, color, n, spd) {
    for (var i = 0; i < n; i++) {
      var a = Math.random() * Math.PI * 2, s = (0.5 + Math.random()) * (spd || 1.6);
      list.push({ x: x, y: y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 0.8, life: 24 + Math.random() * 14, max: 38, color: color, size: 2 + (Math.random() * 2 | 0) });
    }
  }

  function updateParticles(list) {
    for (var i = list.length - 1; i >= 0; i--) {
      var p = list[i];
      p.x += p.vx; p.y += p.vy; p.vy += 0.12; p.life--;
      if (p.life <= 0) list.splice(i, 1);
    }
  }

  function updatePopups(list) {
    for (var i = list.length - 1; i >= 0; i--) {
      var u = list[i];
      u.y -= 0.6; u.life--;
      if (u.life <= 0) list.splice(i, 1);
    }
  }

  AA.Ent = {
    GRAV: GRAV, tileAt: tileAt, isSolid: isSolid, moveEntity: moveEntity,
    makePlayer: makePlayer, updatePlayer: updatePlayer,
    makeEnemy: makeEnemy, updateEnemy: updateEnemy, squash: squash,
    makePickup: makePickup, burst: burst, updateParticles: updateParticles, updatePopups: updatePopups
  };
})();
