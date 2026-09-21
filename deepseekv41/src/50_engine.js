/* =========================================================================
   Game engine: fixed-step simulation.
   ========================================================================= */
(function () {
  var T = AA.TILE;
  var PH = AA.PHYS;


  var ENEMY_DEF = {
    robo: { w: 22, h: 22, hp: 1, score: 100, fly: false, art: 'robo', label: 'campus rover' },
    squat: { w: 20, h: 18, hp: 1, score: 120, fly: false, art: 'squat', label: 'hedge crawler' },
    tank: { w: 28, h: 26, hp: 2, score: 240, fly: false, art: 'tank', label: 'big rover' },
    drone: { w: 22, h: 20, hp: 1, score: 150, fly: true, art: 'drone', label: 'survey drone' },
    bat: { w: 20, h: 18, hp: 1, score: 160, fly: true, art: 'bat', label: 'night flier' },
  };

  var Game = {
    state: 'title',
    t: 0,
    dt: 1 / 60,
    acc: 0,
    seed: 1,
    zoneOfCol: null,

    init: function (canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.frame = 0;
      this.seed = (Math.random() * 1e9) | 0;
      AA.Audio.setSeed(this.seed);
      this.zoneOfCol = AA.LEVEL.zones;
      this.buildSkyline();
      this.buildRects();
      this.setMoodFromCamera();
      this.resetRun();
      AA.buildActorSprites();
      AA.atlas.load('urbantileset/urbantileset32x32.png');
      AA.kenney.load();
      if (this.missingProps && this.missingProps.length && AA.atlas.ready && window.console && console.warn) {
        console.warn('level references sprite ids missing from the atlas:', this.missingProps);
      }
      this.bindInput();
    },

    // ---------------------------------------------------------------- setup
    buildSkyline: function () {
      this.skyline = {};
      var self = this;
      ['diag', 'street', 'river', 'build', 'stadium'].forEach(function (z) {
        self.skyline[z] = AA.buildSkyline(z, AA.makeRng(self.seed + z.length * 977));
      });
    },

    buildRects: function () {
      var L = AA.LEVEL;
      this.tileRects = L.solidRects.map(function (r) {
        return { x: r[0] * T, y: r[1] * T, w: r[2] * T, h: r[3] * T };
      });
      this.props = [];
      this.ambient = [];
      this.staticRects = [];
      var solidIds = {};
      L.solidPropIds.forEach(function (id) { solidIds[id] = true; });
      // Sprites tall enough to read as scenery (trees, buildings, utility
      // stacks) are drawn BEHIND the terrain so the ground hides their base and
      // they never obstruct the platforming lane.
      var AMBIENT_BACK = {
        0: 1, 29: 1, 12: 1, 49: 1, 50: 1, 54: 1, 55: 1, 57: 1, 58: 1, 59: 1,
        63: 1, 64: 1, 71: 1, 72: 1, 75: 1,
      };
      this.missingProps = [];
      for (var i = 0; i < L.props.length; i++) {
        var p = L.props[i];
        var e = AA.atlas.byId[p[0]];
        if (!e) {
          // Never silently drop scenery: a sprite id that is not in the
          // generated atlas means the level and the tileset drifted apart.
          this.missingProps.push(p[0]);
          continue;
        }
        var s = AA.PROP_SCALE[p[0]] || 1;
        // Author row = the tile the prop's base sits on. Backdrop props (trees,
        // buildings) anchor one row lower so the terrain deliberately hides
        // their footings; street furniture sits exactly on the surface.
        var back = AMBIENT_BACK[p[0]] && !solidIds[p[0]];
        var cx = p[1] * T, by = (p[2] + 1 + (back ? 1 : 0)) * T;
        var prop = { id: p[0], x: cx, y: by, w: e.w * s, h: e.h * s, cluster: e.cluster };
        if (back) this.ambient.push(prop);
        else this.props.push(prop);
        if (solidIds[p[0]]) {
          // These street crates read as solid, so they collide - but a
          // full-height box would be an invisible wall, because the sprite art
          // is taller than the block it depicts. The collision top is inset so
          // it becomes a knee-high ledge you can hop (or step) onto instead.
          prop.solid = true;
          var collideH = Math.min(prop.h, 26);
          this.staticRects.push({
            x: cx - prop.w / 2, y: by - collideH, w: prop.w, h: collideH, prop: true,
          });
        }
      }
    },

    resetRun: function () {
      var L = AA.LEVEL;
      this.lives = 3;
      this.score = 0;
      this.gems = 0;
      this.timer = 0;
      this.stomps = 0;
      this.deaths = 0;
      this.finishT = 0;
      this.shake = 0;
      this.hitFlash = 0;
      this.paused = false;
      this.goalTouched = false;
      this.buildWorld();
    },

    buildWorld: function () {
      var L = AA.LEVEL;
      this.player = {
        x: L.spawn[0] * T, feetY: (L.spawn[1] + 1) * T,
        // The Kenney character is 24x24 drawn at 1.5x (36px). A 32px-tall
        // collision box centred in that sprite keeps the art and the hitbox
        // agreeing while still fitting comfortably in one tile of headroom.
        w: 16, h: 32, vx: 0, vy: 0,
        onGround: false, dir: 1, coyote: 0, buffer: 0,
        invuln: 0, anim: 0, animT: 0, jumping: false, wasJumping: false,
        stepDust: 0,
      };
      this.camX = 0;
      this.camY = 0;
      this.particles = [];
      this.floaters = [];

      this.coins = L.coins.map(function (c) {
        return { x: c[0] * T + T / 2, y: c[1] * T + T / 2, w: 18, h: 18, taken: false, t: Math.random() * 6 };
      });
      this.enemies = [];
      for (var i = 0; i < L.enemies.length; i++) {
        var e = L.enemies[i], def = ENEMY_DEF[e[0]];
        var rng = AA.makeRng(this.seed + i * 7919);
        this.enemies.push({
          type: e[0], def: def,
          x: e[1] * T, feetY: (e[2] + 1) * T,
          w: def.w, h: def.h, vx: (rng() < 0.5 ? -1 : 1) * PH.enemySpeed,
          vy: 0, hp: def.hp, dead: false, deadT: 0,
          left: e[3] * T, right: e[4] * T,
          phase: rng() * Math.PI * 2, home: e[2] * T + T,
          anim: 0, hurtT: 0, discovered: false,
        });
      }
      this.checkpoints = L.checkpoints.map(function (c, i) {
        return { idx: i, x: c[1] * T, y: (c[2] + 1) * T, taken: false, glow: 0 };
      });
      this.targets = L.targets.map(function (t) { return t.slice(); });
      this.spawn = { x: L.spawn[0] * T, feetY: (L.spawn[1] + 1) * T };
      this.goal = { x: L.goal[0] * T, y: L.goal[1] * T, flag: 1 };
      this.confettiDone = false;
    },

    bindInput: function () {
      var self = this;
      var map = {
        ArrowLeft: 'left', KeyA: 'left',
        ArrowRight: 'right', KeyD: 'right',
        ArrowUp: 'jump', KeyW: 'jump', Space: 'jump',
        KeyR: 'restart', KeyM: 'mute', KeyP: 'pause', Escape: 'pause',
        Enter: 'start', NumpadEnter: 'start',
      };
      window.addEventListener('keydown', function (ev) {
        var a = map[ev.code];
        if (!a) return;
        if (ev.code === 'Space' || ev.code.indexOf('Arrow') === 0) ev.preventDefault();
        if (!AA.Audio.ready) { AA.Audio.ensure(); AA.Audio.resume(); }
        if (self.keys[a]) return;
        self.keys[a] = true;
        self.onPress(a);
      });
      window.addEventListener('keyup', function (ev) {
        var a = map[ev.code];
        if (a) self.keys[a] = false;
      });
      window.addEventListener('blur', function () { self.keys = {}; });
      window.addEventListener('pointerdown', function () {
        if (!AA.Audio.ready) AA.Audio.ensure();
        AA.Audio.resume();
        self.onPress('start');
      });
      this.keys = {};
    },

    onPress: function (a) {
      if (a === 'mute') {
        this.muted = !this.muted;
        AA.Audio.ensure();
        AA.Audio.setMuted(this.muted);
        AA.Audio.sfx('select');
        return;
      }
      if (this.state === 'play') {
        if (a === 'pause') { this.paused = !this.paused; AA.Audio.sfx('select'); }
        else if (a === 'restart') { this.deaths++; this.respawn(true); }
      } else if (this.state === 'title' || this.state === 'over') {
        if (a === 'start' || a === 'jump') {
          AA.Audio.ensure();
          AA.Audio.sfx('select');
          this.resetRun();
          this.state = 'play';
          AA.Audio.setMood(this.currentMood || 'campus');
        }
      } else if (this.state === 'win') {
        if (a === 'start' || a === 'jump') {
          AA.Audio.sfx('select');
          this.resetRun();
          this.state = 'play';
          AA.Audio.setMood('campus');
        }
      }
    },

    // ------------------------------------------------------------- geometry
    rectsOverlapping: function (x, y, w, h, out) {
      var list = this.staticRects;
      for (var i = 0; i < this.tileRects.length; i++) {
        var r = this.tileRects[i];
        if (x < r.x + r.w && x + w > r.x && y < r.y + r.h && y + h > r.y) out.push(r);
      }
      for (i = 0; i < list.length; i++) {
        r = list[i];
        if (x < r.x + r.w && x + w > r.x && y < r.y + r.h && y + h > r.y) out.push(r);
      }
      return out;
    },

    tileSolid: function (tx, ty) {
      if (tx < 0 || tx >= AA.LEVEL.cols || ty >= AA.LEVEL.worldRows) return true;
      if (ty < 0) return false;
      return AA.levelSolid(tx, ty);
    },

    // Move an AABB through the world with swept axis resolution.
    moveBody: function (b, dx, dy, hit) {
      var self = this;
      var EPS = 0.01, list = [];
      var bx = b.x - b.w / 2, by = b.feetY - b.h, bw = b.w, bh = b.h;

      if (dx !== 0) {
        bx += dx;
        list.length = 0;
        self.rectsOverlapping(bx, by, bw, bh, list);
        for (var i = 0; i < list.length; i++) {
          var r = list[i];
          if (dx > 0) bx = Math.min(bx, r.x - bw - EPS);
          else bx = Math.max(bx, r.x + r.w + EPS);
        }
        if (list.length) { if (hit) hit.side = true; b.vx = 0; }
      }
      if (dy !== 0) {
        by += dy;
        list.length = 0;
        self.rectsOverlapping(bx, by, bw, bh, list);
        for (i = 0; i < list.length; i++) {
          r = list[i];
          if (dy > 0) {
            by = Math.min(by, r.y - bh - EPS);
            if (hit) hit.ground = true;
            b.onGround = true;
          } else {
            by = Math.max(by, r.y + r.h + EPS);
            if (hit) hit.ceil = true;
          }
        }
        if (list.length) b.vy = 0;
      }
      b.x = bx + bw / 2;
      b.feetY = by + bh;
    },

    // Give the player a small step-up so a 32px prop edge is walkable.
    stepUp: function (p) {
      var bx = p.x - p.w / 2, by = p.feetY - p.h;
      var list = this.rectsOverlapping(p.x - p.w / 2, p.feetY - 4, p.w, 12, []);
      for (var i = 0; i < list.length; i++) {
        var top = list[i].y;
        var rise = by + p.h - top;
        if (rise > 0 && rise <= 10) {
          var probe = this.rectsOverlapping(bx, top - p.h + 1, p.w, p.h, []);
          if (!probe.length) { p.feetY = top + 1; p.onGround = true; return true; }
        }
      }
      return false;
    },

    // ------------------------------------------------------------ particles
    burst: function (x, y, opts) {
      var n = opts.count || 8;
      for (var i = 0; i < n; i++) {
        this.particles.push({
          x: x + AA.rand(-opts.spread, opts.spread),
          y: y + AA.rand(-opts.spread * 0.4, opts.spread * 0.4),
          vx: AA.rand(-opts.speed, opts.speed),
          vy: AA.rand(-opts.speed * 1.2, opts.speed * 0.2),
          life: AA.rand(0.35, opts.life || 0.8),
          max: 1, size: opts.size || 3,
          color: AA.pick(opts.colors),
          grav: opts.grav == null ? 620 : opts.grav,
          shape: opts.shape || 'square',
        });
      }
    },

    floatText: function (x, y, text, color) {
      this.floaters.push({ x: x, y: y, text: text, color: color || AA.COL.maize, life: 0.9 });
    },

    // ------------------------------------------------------------- gameplay
    hurtPlayer: function (reason) {
      var p = this.player;
      if (p.invuln > 0 || this.state !== 'play') return;
      p.invuln = 1.6;
      this.lives--;
      this.deaths++;
      this.shake = 10;
      this.hitFlash = 0.35;
      AA.Audio.sfx(reason === 'water' ? 'splash' : 'hurt');
      if (reason === 'water') {
        this.burst(p.x, p.feetY - 10, { count: 16, spread: 12, speed: 130, colors: ['#9fd8f0', '#dff4ff', '#4f93c0'], grav: 700 });
        AA.Audio.sfx('splash');
      } else {
        this.burst(p.x, p.feetY - 20, { count: 12, spread: 10, speed: 110, colors: ['#ffcb05', '#ff8b2e', '#f7f7f2'], grav: 700 });
      }
      if (this.lives <= 0) {
        this.lives = 0;
        this.state = 'over';
        AA.Audio.setMood('campus');
        AA.Audio.sfx('over');
        return;
      }
      this.respawn(false);
    },

    respawn: function (manual) {
      var p = this.player;
      var best = this.spawn;
      for (var i = 0; i < this.checkpoints.length; i++) {
        if (this.checkpoints[i].taken) best = { x: this.checkpoints[i].x, feetY: this.checkpoints[i].y };
      }
      p.x = best.x; p.feetY = best.feetY - 2;
      p.vx = 0; p.vy = 0; p.invuln = Math.max(p.invuln, 1.2);
      this.camX = AA.clamp(p.x - AA.VIEW_W * 0.4, 0, AA.LEVEL.cols * T - AA.VIEW_W);
      if (manual) AA.Audio.sfx('select');
    },

    inWater: function (p) {
      if (p.feetY < AA.LEVEL.groundRow * T) return false;
      var tx = Math.floor(p.x / T);
      var ty = Math.floor((p.feetY - 4) / T);
      return AA.tileAt(tx, ty) === 'w';
    },

    // ------------------------------------------------------------- update
    update: function (dt) {
      this.t += dt;
      if (this.shake > 0) this.shake = Math.max(0, this.shake - dt * 40);
      if (this.hitFlash > 0) this.hitFlash = Math.max(0, this.hitFlash - dt);

      if (this.state === 'title') { this.updateParticles(dt); this.updateSnow(dt); return; }
      if (this.state === 'win' || this.state === 'over') {
        this.updateParticles(dt);
        if (this.state === 'win') this.finishT += dt;
        return;
      }
      if (this.paused) return;

      this.timer += dt;
      this.updatePlayer(dt);
      this.updateCoins(dt);
      this.updateCheckpoints(dt);
      this.updateGoal(dt);
      this.updateParticles(dt);
      this.updateCamera(dt);
      this.setMoodFromCamera();

      if (this.finishT > 0) {
        this.finishT += dt;
        if (this.finishT > 2.4 && !this.confettiDone) {
          this.confettiDone = true;
          for (var i = 0; i < 5; i++) {
            this.burst(this.player.x + AA.rand(-90, 90), this.player.feetY - 80, {
              count: 12, spread: 26, speed: 190, life: 1.6, size: 4, grav: 420,
              colors: ['#ffcb05', '#00274c', '#f7f7f2', '#1b4a7a'],
            });
          }
          AA.Audio.sfx('win');
        }
        if (this.finishT > 3.2) {
          this.state = 'win';
          AA.Audio.setMood('win');
        }
      }
    },

    updatePlayer: function (dt) {
      var p = this.player, k = this.keys;
      if (p.invuln > 0) p.invuln -= dt;

      var want = 0;
      if (k.left) want -= 1;
      if (k.right) want += 1;
      var accel = p.onGround ? PH.moveAccel : PH.airAccel;
      var target = want * PH.maxRun;

      if (want !== 0) {
        p.vx += accel * want * dt;
        // over-speed decays gently instead of snapping
        if (Math.abs(p.vx) > PH.maxRun) p.vx = AA.lerp(p.vx, target, 4 * dt);
        p.dir = want;
      } else if (p.onGround) {
        var fr = PH.friction * dt;
        if (Math.abs(p.vx) <= fr) p.vx = 0; else p.vx -= Math.sign(p.vx) * fr;
      } else {
        p.vx *= (1 - 0.6 * dt);
      }

      // Jump buffering is derived from key STATE, not from the keydown event,
      // so it behaves identically for held keys, re-presses and synthetic input.
      p.buffer -= dt;
      var pressJump = !!k.jump;
      if (pressJump && !p.prevJump) p.buffer = PH.jumpBuffer;
      p.prevJump = pressJump;

      if (p.onGround) p.coyote = PH.coyote; else p.coyote -= dt;

      if (p.buffer > 0 && p.coyote > 0) {
        p.vy = PH.jumpVel;
        p.onGround = false;
        p.coyote = 0;
        p.buffer = 0;
        p.jumping = true;
        p.animT = 0;
        AA.Audio.sfx('jump');
        this.burst(p.x, p.feetY, { count: 5, spread: 6, speed: 60, life: 0.35, size: 3, colors: ['#d9d2bd', '#f7f7f2'], grav: 300 });
      }
      if (p.jumping && !pressJump && p.vy < 0) {
        p.vy *= PH.jumpCut;
        p.jumping = false;
      }

      p.vy = Math.min(p.vy + PH.gravity * dt, PH.maxFall);

      // Enemy interactions run BEFORE the vertical sweep. A head-bonk has to be
      // able to trigger a stomp, and if the ground/ceiling pass ran first it
      // would already have zeroed p.vy, turning every landing into a side hit.
      this.updateEnemies(dt, p.vy);
      if (this.state !== 'play') return;

      var wasGround = p.onGround;
      p.onGround = false;
      var hit = { ground: false, ceil: false, side: false };
      this.moveBody(p, p.vx * dt, p.vy * dt, hit);
      if (!p.onGround && wasGround) { /* walked off a ledge */ }
      if (hit.ceil) { p.vy = 40; p.jumping = false; }
      if (p.onGround && !wasGround) {
        if (p.vy > 180) {
          this.burst(p.x, p.feetY, { count: 4, spread: 8, speed: 40, life: 0.3, size: 2, colors: ['#d9d2bd'], grav: 200 });
          AA.Audio.sfx('land');
        }
        p.jumping = false;
      }
      if (p.onGround) this.stepUp(p);

      // animation
      var speed = Math.abs(p.vx);
      if (!p.onGround) { p.anim = 3; p.animT = 0.1; }
      else if (speed > 8) {
        p.animT += dt * (0.6 + speed / PH.maxRun * 1.6);
        p.anim = [0, 1, 0, 2][Math.floor(p.animT * 6) % 4];
      } else { p.anim = 0; p.animT = 0; }

      // footprint dust on soft zones
      if (p.onGround && speed > 90) {
        p.stepDust -= dt;
        if (p.stepDust <= 0) {
          p.stepDust = 0.14;
          this.burst(p.x - p.dir * 6, p.feetY - 1, { count: 2, spread: 3, speed: 26, life: 0.32, size: 2, colors: ['#d9d2bd', '#bfae8e'], grav: -40 });
        }
      }

      // water / pit
      if (this.inWater(p)) { this.hurtPlayer('water'); return; }
      if (p.feetY > AA.LEVEL.worldRows * T + 80) { this.hurtPlayer('pit'); return; }
      if (p.x < 8) p.x = 8;
      if (p.x > AA.LEVEL.cols * T - 8) p.x = AA.LEVEL.cols * T - 8;
    },

    updateEnemies: function (dt, incomingVy) {
      var p = this.player;
      var pvy = incomingVy == null ? p.vy : incomingVy;
      for (var i = 0; i < this.enemies.length; i++) {
        var e = this.enemies[i];
        if (e.dead) { e.deadT += dt; continue; }
        if (e.hurtT > 0) e.hurtT -= dt;
        e.anim += dt * 6;

        if (e.def.fly) {
          e.x += e.vx * dt;
          if (e.x < e.left) { e.x = e.left; e.vx = Math.abs(e.vx); }
          if (e.x > e.right) { e.x = e.right; e.vx = -Math.abs(e.vx); }
          e.phase += dt * 2.6;
          e.feetY = e.home + Math.sin(e.phase) * 22;
        } else {
          e.vy = Math.min(e.vy + PH.gravity * dt, PH.maxFall);
          var hit = { ground: false };
          this.moveBody(e, e.vx * dt, e.vy * dt, hit);
          if (hit.side) e.vx = -e.vx;
          // turn at ledges so ground units stay on their platform
          var aheadX = e.x + Math.sign(e.vx) * (e.w / 2 + 4);
          var belowFeet = Math.floor((e.feetY + 6) / T);
          if (e.onGround && !this.tileSolid(Math.floor(aheadX / T), belowFeet)) e.vx = -e.vx;
          if (e.x < e.left) { e.x = e.left; e.vx = Math.abs(e.vx); }
          if (e.x > e.right) { e.x = e.right; e.vx = -Math.abs(e.vx); }
        }

        if (e.hp <= 0) continue;
        if (e.hurtT > 0) continue;

        // player interaction
        var px = p.x - p.w / 2, py = p.feetY - p.h;
        var ex = e.x - e.w / 2, ey = e.feetY - e.h;
        if (AA.aabb(px, py, p.w, p.h, ex, ey, e.w, e.h)) {
          // Head-bonk counts as a stomp when the player is travelling down
          // and their feet are at or above the enemy's midline (slightly
          // forgiving, so a running landing on a walking enemy still connects).
          var stomping = pvy > 60 && p.feetY <= ey + e.h * 0.5 + 6;
          if (stomping) {
            e.hp--;
            p.vy = PH.stompBounce;
            p.jumping = true;
            this.stomps++;
            this.shake = 5;
            if (e.hp <= 0) {
              e.dead = true;
              this.score += e.def.score;
              this.floatText(e.x, ey, '+' + e.def.score, AA.COL.maize);
              AA.Audio.sfx(e.type === 'tank' ? 'boss' : 'stomp');
              this.burst(e.x, e.feetY - e.h / 2, {
                count: 14, spread: 9, speed: 140, life: 0.7, size: 3, grav: 700,
                colors: ['#8b93a8', '#20222c', '#ff8b2e', '#f7f7f2'],
              });
            } else {
              e.hurtT = 0.5;
              AA.Audio.sfx('stomp');
              this.burst(e.x, e.feetY - e.h / 2, { count: 6, spread: 6, speed: 90, colors: ['#ffcb05', '#8b93a8'] });
            }
          } else {
            this.hurtPlayer('enemy');
            return;
          }
        }
      }
    },

    updateCoins: function (dt) {
      var p = this.player;
      var px = p.x - p.w / 2, py = p.feetY - p.h;
      for (var i = 0; i < this.coins.length; i++) {
        var c = this.coins[i];
        if (c.taken) continue;
        c.t += dt;
        if (AA.aabb(px, py, p.w, p.h, c.x - 9, c.y - 9, 18, 18)) {
          c.taken = true;
          this.gems++;
          this.score += 50;
          AA.Audio.sfx('coin');
          this.burst(c.x, c.y, { count: 7, spread: 5, speed: 80, life: 0.5, size: 3, grav: 260, colors: ['#7fe3ff', '#dff4ff', '#ffcb05'], shape: 'spark' });
          this.floatText(c.x, c.y - 8, '+50', '#8fe6ff');
        }
      }
    },

    updateCheckpoints: function (dt) {
      var p = this.player;
      for (var i = 0; i < this.checkpoints.length; i++) {
        var c = this.checkpoints[i];
        if (c.glow > 0) c.glow -= dt;
        if (!c.taken && Math.abs(p.x - c.x) < 26 && Math.abs(p.feetY - c.y) < 46) {
          c.taken = true;
          c.glow = 2;
          this.score += 25;
          AA.Audio.sfx('checkpoint');
          this.floatText(c.x, c.y - 54, 'CHECKPOINT', AA.COL.maize);
          this.burst(c.x, c.y - 60, { count: 14, spread: 10, speed: 90, life: 0.9, size: 3, grav: -30, colors: ['#ffcb05', '#f7f7f2', '#7fe3ff'] });
        }
      }
    },

    updateGoal: function (dt) {
      if (this.goalTouched || this.finishT > 0) return;
      var p = this.player;
      var gx = this.goal.x, gy = this.goal.y;
      // Generous flag trigger: a player brushing the pole anywhere along its
      // height, or landing on the deck it stands on, finishes the level.
      var onFlag = AA.aabb(p.x - p.w / 2, p.feetY - p.h, p.w, p.h, gx - 26, gy - 128, 56, 134);
      if (onFlag) {
        this.goalTouched = true;
        this.finishT = 0.001;
        this.score += 1000 + Math.max(0, 900 - Math.floor(this.timer)) * 2;
        this.floatText(p.x, p.feetY - 70, 'LEVEL CLEAR!', AA.COL.maize);
        this.shake = 6;
      }
    },

    updateParticles: function (dt) {
      for (var i = this.particles.length - 1; i >= 0; i--) {
        var q = this.particles[i];
        q.life -= dt;
        if (q.life <= 0) { this.particles.splice(i, 1); continue; }
        q.vy += q.grav * dt;
        q.x += q.vx * dt;
        q.y += q.vy * dt;
        q.vx *= (1 - 0.9 * dt);
      }
      for (i = this.floaters.length - 1; i >= 0; i--) {
        var f = this.floaters[i];
        f.life -= dt;
        f.y -= 26 * dt;
        if (f.life <= 0) this.floaters.splice(i, 1);
      }
    },

    updateSnow: function (dt) {
      if (!this.snow) {
        this.snow = [];
        for (var i = 0; i < 90; i++) {
          this.snow.push({ x: Math.random() * AA.VIEW_W, y: Math.random() * AA.VIEW_H, s: AA.rand(1, 3), v: AA.rand(18, 46), p: Math.random() * 6 });
        }
      }
      for (i = 0; i < this.snow.length; i++) {
        var f = this.snow[i];
        f.y += f.v * dt;
        f.x += Math.sin(this.t + f.p) * 12 * dt;
        if (f.y > AA.VIEW_H) { f.y = -4; f.x = Math.random() * AA.VIEW_W; }
      }
    },

    updateCamera: function (dt) {
      var p = this.player;
      var targetX = p.x - AA.VIEW_W * 0.42 + p.vx * 0.22;
      var maxX = Math.max(0, AA.LEVEL.cols * T - AA.VIEW_W);
      targetX = AA.clamp(targetX, 0, maxX);
      this.camX = AA.lerp(this.camX, targetX, Math.min(1, dt * 6));
      var targetY = AA.clamp(p.feetY - AA.VIEW_H * 0.62, -80, AA.LEVEL.worldRows * T - AA.VIEW_H + 40);
      this.camY = AA.lerp(this.camY, targetY, Math.min(1, dt * 4));
    },

    zoneAt: function (px) {
      var c = AA.clamp(Math.floor(px / T), 0, this.zoneOfCol.length - 1);
      return this.zoneOfCol[c];
    },

    setMoodFromCamera: function () {
      var z = this.zoneAt(this.camX + AA.VIEW_W * 0.45);
      this.currentMood = z;
      if (this.state === 'play' && AA.Audio.moodName !== z) AA.Audio.setMood(z);
    },

    // ---------------------------------------------------------------- frame
    frameUpdate: function (dt) {
      this.acc += dt;
      var steps = 0;
      while (this.acc >= this.dt && steps < 5) {
        this.update(this.dt);
        this.acc -= this.dt;
        steps++;
      }
      if (steps === 5) this.acc = 0;
    },

    loop: function (now) {
      var self = this;
      var dt = Math.min(0.1, (now - (this.lastNow || now)) / 1000);
      this.lastNow = now;
      this.frameUpdate(dt);
      AA.render(this);
      window.requestAnimationFrame(function (t) { self.loop(t); });
    },

    start: function () {
      var self = this;
      AA.Audio.setSeed(this.seed);
      window.requestAnimationFrame(function (t) { self.loop(t); });
    },
  };

  AA.Game = Game;
  AA.ENEMY_DEF = ENEMY_DEF;
})();
