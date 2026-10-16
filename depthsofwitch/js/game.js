// Game rules: turns, energy, FOV, combat, monsters, items, levels. No DOM access here, so the
// whole game can be simulated headless (see tools/simulate.js).
(function (root) {
  'use strict';
  const DG = root.DG = root.DG || {};
  const { T } = DG;
  const U = DG.levelUtil;
  const DIRS8 = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]];
  const SPEED = 12;

  function hash(x, y, z) {
    let h = (x * 374761393 + y * 668265263 + z * 2147483647) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return (h ^ (h >>> 16)) >>> 0;
  }
  DG.hash = hash;
  const cheb = (ax, ay, bx, by) => Math.max(Math.abs(ax - bx), Math.abs(ay - by));

  class Game {
    constructor(opts) {
      opts = opts || {};
      this.seed = opts.seed != null ? opts.seed : (Date.now() & 0x7fffffff);
      this.rng = new DG.RNG(this.seed);
      this.nextId = 1;
      this.levels = {};
      this.events = [];
      this.messages = [];
      this.turn = 0;
      this.over = null;   // {won, reason}
      this.prompt = null; // pending UI prompt (set by UI)
      this.stats = { kills: 0, maxDepth: 1, killedBy: null };
      this.setupIdentification();
      this.player = this.makePlayer(opts.cls || 'adventurer');
      this.depth = 0;
      this.changeLevel(1, 'down');
      this.msg(`Welcome, ${this.player.clsDef.name}! Somewhere below waits the Witch of the Pit and her Golden Chalice.`, 'good');
      this.msg('Arrow keys / hjklyubn to move, ? for help.', 'info');
    }

    // ---------------------------------------------------------------- utilities
    get level() { return this.levels[this.depth]; }
    msg(text, cls) {
      this.messages.push({ text, cls: cls || '', turn: this.turn });
      if (this.messages.length > 200) this.messages.shift();
    }
    emit(e) { this.events.push(e); }
    takeEvents() { const e = this.events; this.events = []; return e; }

    setupIdentification() {
      const potions = Object.keys(DG.ITEMS).filter(k => DG.ITEMS[k].cls === 'potion');
      const pe = this.rng.shuffle(Object.keys(DG.POTION_EFFECTS).slice());
      const scrolls = Object.keys(DG.ITEMS).filter(k => DG.ITEMS[k].cls === 'scroll');
      const se = this.rng.shuffle(Object.keys(DG.SCROLL_EFFECTS).slice());
      this.effectOf = {};
      potions.forEach((k, i) => { this.effectOf[k] = pe[i % pe.length]; });
      scrolls.forEach((k, i) => { this.effectOf[k] = se[i % se.length]; });
      this.known = {};
    }
    itemName(kind, qty) {
      const d = DG.ITEMS[kind];
      let n = d.name;
      if ((d.cls === 'potion' || d.cls === 'scroll') && this.known[kind]) {
        const eff = this.effectOf[kind];
        const en = (d.cls === 'potion' ? DG.POTION_EFFECTS : DG.SCROLL_EFFECTS)[eff].name;
        n = `${d.cls} of ${en} (${d.name})`;
      }
      if (qty > 1) n = `${qty} x ${n}`;
      return n;
    }

    makePlayer(cls) {
      const c = DG.CLASSES[cls];
      const p = {
        id: this.nextId++, isPlayer: true, cls, clsDef: c, name: 'you',
        sheet: c.sheet, anims: c.anims, x: 0, y: 0, facing: 1,
        hp: c.hp, maxHp: c.hp, level: 1, xp: 0,
        toHit: c.toHit, defense: c.defense, damage: c.damage, dmgBonus: c.dmgBonus,
        speed: SPEED, energy: SPEED,
        inventory: [], gold: 0, nutrition: 1100,
        status: {}, specialCd: 0, regen: 0,
      };
      this.addToInventory(p, 'meat', 1);
      if (cls === 'dwarf') this.addToInventory(p, 'bomb', 2);
      else this.addToInventory(p, 'potion_red_small', 1);
      return p;
    }

    addToInventory(p, kind, qty) {
      if (kind === 'gold') { p.gold += qty; return; }
      const e = p.inventory.find(i => i.kind === kind);
      if (e) e.qty += qty; else p.inventory.push({ kind, qty });
    }
    removeFromInventory(p, kind, n) {
      const i = p.inventory.findIndex(e => e.kind === kind);
      if (i < 0) return false;
      p.inventory[i].qty -= (n || 1);
      if (p.inventory[i].qty <= 0) p.inventory.splice(i, 1);
      return true;
    }
    hasItem(kind) { return this.player.inventory.some(e => e.kind === kind); }

    // ---------------------------------------------------------------- levels
    changeLevel(depth, how) {
      const p = this.player;
      if (this.level) this.level.monsters = this.level.monsters.filter(m => m.hp > 0);
      this.depth = depth;
      this.stats.maxDepth = Math.max(this.stats.maxDepth, depth);
      if (!this.levels[depth]) this.levels[depth] = this.buildLevel(depth);
      const lv = this.level;
      let spot;
      if (how === 'down') spot = lv.stairsUp;
      else if (how === 'up') spot = lv.stairsDown;
      else spot = this.randomFreeCell(lv);
      if (this.monsterAt(spot.x, spot.y)) {
        const m = this.monsterAt(spot.x, spot.y);
        const alt = this.freeNear(spot.x, spot.y);
        if (alt) { m.x = alt.x; m.y = alt.y; }
      }
      p.x = spot.x; p.y = spot.y;
      this.emit({ type: 'level', depth });
      if (depth === DG.MAX_DEPTH && !lv.announced) {
        lv.announced = true;
        this.msg('You climb down into a vast sand-floored arena. The air smells of brimstone.', 'warn');
      } else if (how === 'fall') {
        this.msg('You fall through a trap door!', 'warn');
      }
      this.computeFOV();
    }

    buildLevel(depth) {
      const lv = DG.MapGen.generate(depth, this.rng);
      lv.monsters = []; lv.items = []; lv.traps = []; lv.props = []; lv.decor = []; lv.wallDecor = [];
      lv.towers = []; lv.pillar = new Uint8Array(lv.w * lv.h);
      this.placeTowers(lv);
      this.decorate(lv);
      if (lv.theme === 'arena') this.populateArena(lv);
      else this.populate(lv);
      return lv;
    }

    placeTowers(lv) {
      // Large rooms may hold a free-standing pillar, drawn with the tileset's tower_block stamp.
      for (const r of lv.rooms) {
        if (lv.theme === 'arena') break;
        if (r.w < 9 || r.h < 8 || r.hasPit || !this.rng.chance(0.35)) continue;
        const x = this.rng.int(r.x + 2, r.x + r.w - 5), y = this.rng.int(r.y + 2, r.y + r.h - 5);
        lv.towers.push({ x, y });
      }
      if (lv.theme === 'arena') for (const [x, y] of [[21, 13], [36, 13], [21, 20], [36, 20]]) lv.towers.push({ x, y });
      for (const t of lv.towers) {
        for (let y = t.y; y < t.y + 3; y++) for (let x = t.x; x < t.x + 3; x++) {
          const i = U.idx(lv, x, y);
          lv.cells[i] = T.ROCK; lv.pillar[i] = 1;
        }
      }
      // pillars must not cut the level apart or cover stairs
      lv.towers = lv.towers.filter(t => {
        const covers = (p) => p && p.x >= t.x && p.x < t.x + 3 && p.y >= t.y && p.y < t.y + 3;
        if (covers(lv.stairsUp) || covers(lv.stairsDown) || covers(lv.bossSpot)) { this.unTower(lv, t); return false; }
        return true;
      });
      if (!DG.MapGen.connected(lv)) { for (const t of lv.towers) this.unTower(lv, t); lv.towers = []; }
    }
    unTower(lv, t) {
      for (let y = t.y; y < t.y + 3; y++) for (let x = t.x; x < t.x + 3; x++) {
        const i = U.idx(lv, x, y);
        lv.cells[i] = T.FLOOR; lv.pillar[i] = 0;
      }
    }

    decorate(lv) {
      const rng = this.rng, ex = DG.Assets.extras;
      const D = 'elthen.dungeon', AR = 'elthen.arena';
      const isFloor = (x, y) => U.cellAt(lv, x, y) === T.FLOOR;
      const free = (x, y) => isFloor(x, y) && !this.propAt(lv, x, y) &&
        !(lv.stairsUp && lv.stairsUp.x === x && lv.stairsUp.y === y) &&
        !(lv.stairsDown && lv.stairsDown.x === x && lv.stairsDown.y === y);
      const face = (x, y) => U.isSolid(lv, x, y) && !lv.pillar[U.idx(lv, x, y)] && U.isOpen(lv, x, y + 1);

      // room styles
      for (const r of lv.rooms) {
        r.style = 'plain';
        if (lv.theme === 'arena') continue;
        if (r.kind === 'stone' && lv.depth >= 2 && rng.chance(0.18) && !r.hasPit) r.style = 'slab';
        else if (lv.depth >= 2 && rng.chance(0.2) && r.w >= 5 && r.h >= 4) r.style = 'crypt';
        else if (rng.chance(0.2)) r.style = 'hall';
        if (r.style === 'slab') for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) {
          if (isFloor(x, y)) lv.floorKind[U.idx(lv, x, y)] = 'slab';
        }
      }
      // crypts: rows of gravestones
      for (const r of lv.rooms) {
        if (r.style !== 'crypt') continue;
        for (let y = r.y + 1; y < r.y + r.h - 1; y += 2) for (let x = r.x + 1; x < r.x + r.w - 1; x += 2) {
          if (free(x, y) && rng.chance(0.55)) {
            lv.props.push({ x, y, type: 'grave', blocks: true, sheet: D, rect: rng.pick(ex.gravestones) });
          }
        }
        // keep rooms connected
        if (!this.propsKeepConnected(lv)) lv.props = lv.props.filter(p => p.type !== 'grave' || !inRoom(r, p));
      }
      // halls: benches and candles along the north wall
      for (const r of lv.rooms) {
        if (r.style !== 'hall') continue;
        for (let x = r.x + 1; x + 1 < r.x + r.w - 1; x += 3) {
          if (free(x, r.y) && free(x + 1, r.y) && face(x, r.y - 1) && face(x + 1, r.y - 1) && rng.chance(0.6)) {
            lv.props.push({ x, y: r.y, w: 2, type: 'bench', blocks: true, sheet: D, rect: ex.bench });
          }
        }
        if (!this.propsKeepConnected(lv)) lv.props = lv.props.filter(p => p.type !== 'bench' || !inRoom(r, p));
      }
      function inRoom(r, p) { return p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h; }

      // floor scatter
      for (let y = 0; y < lv.h; y++) for (let x = 0; x < lv.w; x++) {
        if (!free(x, y)) continue;
        const roll = rng.next();
        if (lv.theme === 'arena') {
          if (roll < 0.05) lv.decor.push({ x, y, sheet: AR, tile: rng.pick(ex.arenaGrass) });
          else if (roll < 0.07) lv.decor.push({ x, y, sheet: AR, tile: rng.pick(ex.arenaRubble) });
          else if (roll < 0.08) lv.decor.push({ x, y, sheet: AR, tile: rng.pick(ex.arenaBones) });
          continue;
        }
        const kind = lv.floorKind[U.idx(lv, x, y)];
        if (roll < 0.035 && kind === 'stone') lv.decor.push({ x, y, sheet: D, tile: rng.pick(ex.rubble) });
        else if (roll < 0.05) lv.decor.push({ x, y, sheet: D, tile: rng.pick(ex.pebbles) });
        else if (roll < 0.06) lv.decor.push({ x, y, sheet: D, rect: rng.pick([ex.bones, ex.skull]) });
        else if (roll < 0.064 && lv.depth >= 3) lv.decor.push({ x, y, sheet: D, tile: rng.pick(ex.chainsFloor) });
        else if (roll < 0.068 && face(x, y - 1)) lv.decor.push({ x, y, sheet: D, rect: ex.candle, light: true });
      }
      // wall decoration on brick faces
      for (let y = 1; y < lv.h - 1; y++) for (let x = 1; x < lv.w - 1; x++) {
        if (!face(x, y) || !face(x - 1, y) || !face(x + 1, y)) continue;
        const rid = lv.roomId[U.idx(lv, x, y + 1)];
        const room = rid >= 0 ? lv.rooms[rid] : null;
        const lit = room && room.lit;
        const h = hash(x, y, lv.depth) % 100;
        if (lit && x % 4 === (lv.depth % 4) && h < 70) lv.wallDecor.push({ x, y, type: 'torch' });
        else if (lit && h < 8) lv.wallDecor.push({ x, y, type: 'banner' });
        else if (lv.theme !== 'arena' && h < 14) lv.wallDecor.push({ x, y, type: 'vines', rect: ex.vines[h % 2] });
      }
    }

    propsKeepConnected(lv) {
      const s = lv.stairsUp;
      const pass = (l, x, y) => U.cellAt(l, x, y) === T.FLOOR && !this.propAt(l, x, y);
      const d = DG.bfs(lv, s.x, s.y, pass);
      for (let y = 0; y < lv.h; y++) for (let x = 0; x < lv.w; x++) {
        if (pass(lv, x, y) && d[U.idx(lv, x, y)] < 0) return false;
      }
      return true;
    }

    populate(lv) {
      const rng = this.rng, depth = lv.depth;
      const avoidStart = (x, y) => lv.startRoom && x >= lv.startRoom.x && x < lv.startRoom.x + lv.startRoom.w &&
        y >= lv.startRoom.y && y < lv.startRoom.y + lv.startRoom.h;
      // monsters
      const n = 2 + Math.ceil(depth * 0.8) + rng.int(0, 2);
      for (let i = 0; i < n; i++) {
        const type = this.pickMonsterType(depth);
        if (!type) break;
        const def = DG.MONSTERS[type];
        const spot = this.randomFreeCell(lv, avoidStart);
        if (!spot) continue;
        const count = def.group ? rng.int(def.group[0], def.group[1]) : 1;
        this.spawnMonster(lv, type, spot.x, spot.y, { asleep: rng.chance(0.6) });
        for (let k = 1; k < count; k++) {
          const p = this.freeNear(spot.x, spot.y, lv);
          if (p) this.spawnMonster(lv, type, p.x, p.y, { asleep: rng.chance(0.6) });
        }
      }
      // items
      const ni = rng.int(4, 7);
      for (let i = 0; i < ni; i++) {
        const spot = this.randomFreeCell(lv);
        if (spot) this.dropItem(lv, spot.x, spot.y, this.randomItemKind(), 1);
      }
      for (let i = rng.int(2, 4); i > 0; i--) {
        const spot = this.randomFreeCell(lv);
        if (spot) this.dropItem(lv, spot.x, spot.y, 'gold', rng.int(5, 15) + depth * rng.int(2, 6));
      }
      // chests
      for (let i = rng.int(0, 2); i > 0; i--) {
        const r = rng.pick(lv.rooms);
        const spot = DG.randomFree(lv, r, rng, (x, y) => !this.cellFree(lv, x, y) || this.isStairs(lv, x, y));
        if (!spot) continue;
        const ex = DG.Assets.extras;
        const chest = { x: spot.x, y: spot.y, type: 'chest', blocks: true, sheet: 'elthen.dungeon', rect: ex.chest,
                        locked: rng.chance(0.45), contents: [] };
        for (let k = rng.int(2, 3); k > 0; k--) chest.contents.push({ kind: this.randomItemKind(), qty: 1 });
        chest.contents.push({ kind: 'gold', qty: rng.int(15, 40) + depth * 8 });
        lv.props.push(chest);
        if (!this.propsKeepConnected(lv)) lv.props.pop();
        else if (chest.locked && rng.chance(0.7)) { // usually a key somewhere on the level
          const ks = this.randomFreeCell(lv);
          if (ks) this.dropItem(lv, ks.x, ks.y, 'key', 1);
        }
      }
      // traps
      const nt = 2 + Math.floor(depth / 2) + rng.int(0, 2);
      for (let i = 0; i < nt; i++) {
        const spot = this.randomFreeCell(lv, (x, y) => avoidStart(x, y) || this.itemsAt(lv, x, y).length > 0);
        if (!spot) continue;
        let type = rng.pick(['spikes', 'spikes', 'spikes', 'trapdoor', 'portal']);
        if (type === 'trapdoor' && depth >= DG.MAX_DEPTH - 1) type = 'spikes';
        lv.traps.push({ x: spot.x, y: spot.y, type, hidden: type !== 'portal' });
      }
    }

    populateArena(lv) {
      const b = lv.bossSpot;
      const witch = this.spawnMonster(lv, 'witch', b.x, b.y, { asleep: true });
      witch.boss = true;
      for (const [type, k] of [['imp', 2], ['bat', 3]]) {
        for (let i = 0; i < k; i++) {
          const s = this.randomFreeCell(lv, (x, y) => y > lv.stairsUp.y - 6);
          if (s) this.spawnMonster(lv, type, s.x, s.y, { asleep: true });
        }
      }
      for (let i = 0; i < 4; i++) {
        const s = this.randomFreeCell(lv);
        if (s) this.dropItem(lv, s.x, s.y, i < 2 ? this.randomItemKind() : 'gold', i < 2 ? 1 : this.rng.int(30, 60));
      }
    }

    pickMonsterType(depth) {
      const types = Object.keys(DG.MONSTERS).filter(k => {
        const d = DG.MONSTERS[k];
        return d.freq > 0 && depth >= d.depth[0] && depth <= d.depth[1];
      });
      return this.rng.weighted(types, k => DG.MONSTERS[k].freq);
    }
    randomItemKind() {
      const kinds = Object.keys(DG.ITEMS).filter(k => DG.ITEMS[k].freq > 0);
      return this.rng.weighted(kinds, k => DG.ITEMS[k].freq);
    }

    spawnMonster(lv, type, x, y, opts) {
      const def = DG.MONSTERS[type];
      let sheet = def.sheet, anims = def.anims, name = def.name;
      if (type === 'rival') { // the hero you did not pick, gone bad
        const other = this.player.cls === 'dwarf' ? 'adventurer' : 'dwarf';
        const c = DG.CLASSES[other];
        sheet = c.sheet; anims = c.anims; name = `renegade ${other === 'dwarf' ? 'dwarf' : 'adventurer'}`;
      }
      const hp = this.rng.roll(def.hp) + Math.max(0, lv.depth - def.depth[0]);
      const m = {
        id: this.nextId++, type, def, name, sheet, anims, x, y, facing: this.rng.chance(0.5) ? 1 : -1,
        hp, maxHp: hp, energy: this.rng.int(0, SPEED - 1), speed: def.speed,
        awake: !(opts && opts.asleep), peaceful: !!def.peaceful, summonCd: 3,
      };
      lv.monsters.push(m);
      return m;
    }

    dropItem(lv, x, y, kind, qty) {
      const ex = lv.items.find(i => i.x === x && i.y === y && i.kind === kind);
      if (ex) ex.qty += qty;
      else lv.items.push({ id: this.nextId++, x, y, kind, qty });
    }
    itemsAt(lv, x, y) { return lv.items.filter(i => i.x === x && i.y === y); }
    propAt(lv, x, y) { return lv.props.find(p => p.y === y && (p.x === x || (p.w === 2 && p.x + 1 === x))); }
    monsterAt(x, y, lv) { return (lv || this.level).monsters.find(m => m.hp > 0 && m.x === x && m.y === y); }
    trapAt(lv, x, y) { return lv.traps.find(t => t.x === x && t.y === y); }
    isStairs(lv, x, y) {
      return (lv.stairsUp && lv.stairsUp.x === x && lv.stairsUp.y === y) ||
             (lv.stairsDown && lv.stairsDown.x === x && lv.stairsDown.y === y);
    }
    cellFree(lv, x, y) {
      return U.cellAt(lv, x, y) === T.FLOOR && !this.propAt(lv, x, y) && !this.monsterAt(x, y, lv) &&
        !(this.player && lv === this.level && this.player.x === x && this.player.y === y);
    }
    randomFreeCell(lv, avoid) {
      for (let t = 0; t < 500; t++) {
        const x = this.rng.int(1, lv.w - 2), y = this.rng.int(1, lv.h - 2);
        if (!this.cellFree(lv, x, y) || this.isStairs(lv, x, y) || this.trapAt(lv, x, y)) continue;
        if (avoid && avoid(x, y)) continue;
        return { x, y };
      }
      return null;
    }
    freeNear(x, y, lv) {
      lv = lv || this.level;
      for (let r = 1; r < 6; r++) {
        const opts = [];
        for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          if (this.cellFree(lv, x + dx, y + dy) && !this.isStairs(lv, x + dx, y + dy)) opts.push({ x: x + dx, y: y + dy });
        }
        if (opts.length) return this.rng.pick(opts);
      }
      return null;
    }

    // ---------------------------------------------------------------- FOV
    opaque(lv, x, y) { return U.isSolid(lv, x, y); }

    computeFOV() {
      const lv = this.level, p = this.player;
      lv.visible.fill(0);
      const blind = p.status.blind > 0;
      const maxR = blind ? 1 : 14;
      const darkR2 = blind ? 2 : 5; // radius ~2 in the dark
      const mark = (x, y) => {
        if (!U.inb(lv, x, y)) return;
        const dx = x - p.x, dy = y - p.y, d2 = dx * dx + dy * dy;
        const i = U.idx(lv, x, y);
        if (d2 <= darkR2 || (!blind && lv.lit[i])) lv.visible[i] = 1;
      };
      mark(p.x, p.y);
      for (let oct = 0; oct < 8; oct++) this.castLight(lv, p.x, p.y, 1, 1.0, 0.0, maxR, oct, mark);
      // light also spills onto walls next to visible lit floor; caps above visible faces
      for (let y = 1; y < lv.h - 1; y++) for (let x = 1; x < lv.w - 1; x++) {
        const i = U.idx(lv, x, y);
        if (lv.visible[i] || !U.isSolid(lv, x, y)) continue;
        if (this.wallLitBy(lv, x, y)) lv.visible[i] = 1;
      }
      for (let y = lv.h - 2; y >= 1; y--) for (let x = 0; x < lv.w; x++) {
        const i = U.idx(lv, x, y);
        if (U.isSolid(lv, x, y) && !lv.visible[i] && lv.visible[U.idx(lv, x, y + 1)] && U.isSolid(lv, x, y + 1)) {
          // the cap row (and the strip above vertical walls) is visible when the face below is
          const below = U.idx(lv, x, y + 1);
          if (U.isOpen(lv, x, y + 2) || U.isOpen(lv, x - 1, y + 1) || U.isOpen(lv, x + 1, y + 1)) lv.visible[i] = 1;
          else if (lv.visible[below] && (U.isOpen(lv, x - 1, y + 2) || U.isOpen(lv, x + 1, y + 2))) lv.visible[i] = 1;
        }
      }
      if (lv.revealAll) lv.visible.fill(1); // debug
      for (let i = 0; i < lv.visible.length; i++) if (lv.visible[i]) lv.seen[i] = 1;
    }
    wallLitBy(lv, x, y) {
      // a solid cell is visible when a visible open cell touches it and the solid cell itself
      // is in line of sight (we approximate: any 8-neighbour visible floor)
      for (const [dx, dy] of DIRS8) {
        const nx = x + dx, ny = y + dy;
        if (U.inb(lv, nx, ny) && U.isOpen(lv, nx, ny) && lv.visible[U.idx(lv, nx, ny)]) return true;
      }
      return false;
    }
    // recursive shadowcasting (Björn Bergström)
    castLight(lv, cx, cy, row, start, end, radius, oct, mark) {
      if (start < end) return;
      const mult = [[1, 0, 0, -1, -1, 0, 0, 1], [0, 1, -1, 0, 0, -1, 1, 0], [0, 1, 1, 0, 0, -1, -1, 0], [1, 0, 0, 1, -1, 0, 0, -1]];
      const xx = mult[0][oct], xy = mult[1][oct], yx = mult[2][oct], yy = mult[3][oct];
      let newStart = 0;
      for (let j = row; j <= radius; j++) {
        let dx = -j - 1, blocked = false;
        const dy = -j;
        while (dx <= 0) {
          dx++;
          const X = cx + dx * xx + dy * xy, Y = cy + dx * yx + dy * yy;
          const lSlope = (dx - 0.5) / (dy + 0.5), rSlope = (dx + 0.5) / (dy - 0.5);
          if (start < rSlope) continue;
          if (end > lSlope) break;
          if (dx * dx + dy * dy < radius * radius) mark(X, Y);
          const op = this.opaque(lv, X, Y);
          if (blocked) {
            if (op) { newStart = rSlope; continue; }
            blocked = false; start = newStart;
          } else if (op && j < radius) {
            blocked = true;
            this.castLight(lv, cx, cy, j + 1, start, lSlope, radius, oct, mark);
            newStart = rSlope;
          }
        }
        if (blocked) break;
      }
    }
    los(x0, y0, x1, y1) {
      const lv = this.level;
      let dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1, err = dx - dy;
      let x = x0, y = y0;
      while (!(x === x1 && y === y1)) {
        const e2 = 2 * err;
        if (e2 > -dy) { err -= dy; x += sx; }
        if (e2 < dx) { err += dx; y += sy; }
        if (x === x1 && y === y1) break;
        if (this.opaque(lv, x, y)) return false;
      }
      return true;
    }
    canSee(x, y) { return !!this.level.visible[U.idx(this.level, x, y)]; }

    // ---------------------------------------------------------------- player actions
    // All return true when the action took game time.
    act(action) {
      if (this.over) return false;
      const p = this.player;
      let took = false;
      switch (action.type) {
        case 'move': took = this.playerMove(action.dx, action.dy); break;
        case 'wait': took = true; break;
        case 'search': took = this.search(); break;
        case 'pickup': took = this.pickup(); break;
        case 'stairs': took = this.useStairs(action.dir); break;
        case 'use': took = this.useItem(action.index); break;
        case 'drop': took = this.dropFromInventory(action.index); break;
        case 'special': took = this.special(); break;
      }
      if (took) {
        p.energy -= SPEED;
        this.processWorld();
      }
      this.computeFOV();
      return took;
    }

    playerMove(dx, dy) {
      const p = this.player, lv = this.level;
      const nx = p.x + dx, ny = p.y + dy;
      if (dx) p.facing = dx > 0 ? 1 : -1;
      const m = this.monsterAt(nx, ny);
      if (m) {
        if (m.peaceful) this.msg(`You attack the peaceful ${m.name}!`, 'warn');
        this.attack(p, m);
        return true;
      }
      const prop = this.propAt(lv, nx, ny);
      if (prop) return this.bumpProp(prop);
      const c = U.cellAt(lv, nx, ny);
      if (c === T.PIT) { this.msg('A dark chasm blocks your way.', 'info'); return false; }
      if (c === T.WATER) { this.msg('The pool is too deep to wade through.', 'info'); return false; }
      if (c !== T.FLOOR) return false;
      if (dx && dy && U.cellAt(lv, p.x + dx, p.y) !== T.FLOOR && U.cellAt(lv, p.x, p.y + dy) !== T.FLOOR) return false;
      p.x = nx; p.y = ny;
      this.emit({ type: 'move', id: p.id, x: nx, y: ny });
      this.afterPlayerStep();
      return true;
    }

    afterPlayerStep() {
      const p = this.player, lv = this.level;
      const items = this.itemsAt(lv, p.x, p.y);
      // auto-pickup gold
      for (const it of items.filter(i => i.kind === 'gold')) {
        p.gold += it.qty;
        lv.items.splice(lv.items.indexOf(it), 1);
        this.msg(`You pick up ${it.qty} gold pieces.`, 'gold');
        this.emit({ type: 'pickup', x: p.x, y: p.y, kind: 'gold' });
      }
      const rest = this.itemsAt(lv, p.x, p.y);
      if (rest.length === 1) this.msg(`You see here ${this.itemName(rest[0].kind, rest[0].qty)}. (g to pick up)`);
      else if (rest.length > 1) this.msg(`There are ${rest.length} items here. (g to pick up)`);
      if (lv.stairsDown && lv.stairsDown.x === p.x && lv.stairsDown.y === p.y) this.msg('There is a ladder leading down here. (> to descend)');
      if (lv.stairsUp && lv.stairsUp.x === p.x && lv.stairsUp.y === p.y && this.depth > 1) this.msg('There is a ladder leading up here. (< to climb)');
      if (lv.portal && lv.portal.x === p.x && lv.portal.y === p.y) this.enterPortal();
      const trap = this.trapAt(lv, p.x, p.y);
      if (trap) this.triggerTrap(trap);
    }

    bumpProp(prop) {
      const p = this.player, lv = this.level;
      if (prop.type === 'chest') {
        if (prop.locked) {
          if (this.hasItem('key')) {
            this.removeFromInventory(p, 'key', 1);
            prop.locked = false;
            this.msg('You unlock the chest with your golden key.', 'good');
          } else if (this.rng.chance(0.25)) {
            prop.locked = false;
            this.msg('You force the lock open with a loud CRACK!', 'warn');
            this.makeNoise(p.x, p.y, 10);
          } else {
            this.msg('The chest is locked. You bash at the lock...', 'info');
            this.makeNoise(p.x, p.y, 6);
            return true;
          }
        }
        this.msg('You open the chest.', 'good');
        for (const c of prop.contents) {
          const spot = this.cellFreeForItem(prop.x, prop.y);
          this.dropItem(lv, spot.x, spot.y, c.kind, c.qty);
        }
        lv.props.splice(lv.props.indexOf(prop), 1);
        this.emit({ type: 'effect', kind: 'sparkle', x: prop.x, y: prop.y });
        return true;
      }
      if (prop.type === 'grave') { this.msg(this.rng.pick(['The gravestone reads: "Here lies a fool who woke the Witch."', 'The inscription is worn away.', 'R.I.P. - killed by a ratfolk axeman.', 'Here lies an unlucky dwarf. Bring bombs.']), 'info'); return false; }
      if (prop.type === 'bench') { this.msg('A sturdy wooden bench.', 'info'); return false; }
      return false;
    }
    cellFreeForItem(x, y) {
      const lv = this.level;
      const opts = [];
      for (const [dx, dy] of DIRS8) if (U.cellAt(lv, x + dx, y + dy) === T.FLOOR && !this.propAt(lv, x + dx, y + dy)) opts.push({ x: x + dx, y: y + dy });
      return opts.length ? this.rng.pick(opts) : { x: this.player.x, y: this.player.y };
    }

    search() {
      const p = this.player, lv = this.level;
      let found = false;
      for (const t of lv.traps) {
        if (t.hidden && cheb(t.x, t.y, p.x, p.y) <= 1 && this.rng.chance(0.4)) {
          t.hidden = false; found = true;
          this.msg(`You find a ${t.type === 'trapdoor' ? 'trap door' : 'spike trap'}.`, 'warn');
        }
      }
      if (!found && this.rng.chance(0.05)) this.msg('You search but find nothing.');
      return true;
    }

    pickup() {
      const p = this.player, lv = this.level;
      const items = this.itemsAt(lv, p.x, p.y);
      if (!items.length) { this.msg('There is nothing here to pick up.'); return false; }
      for (const it of items) {
        if (p.inventory.length >= 20 && !p.inventory.find(e => e.kind === it.kind)) { this.msg('Your pack is full.', 'warn'); break; }
        this.addToInventory(p, it.kind, it.qty);
        lv.items.splice(lv.items.indexOf(it), 1);
        this.msg(`You pick up ${this.itemName(it.kind, it.qty)}.`, it.kind === 'chalice' ? 'good' : '');
        this.emit({ type: 'pickup', x: p.x, y: p.y, kind: it.kind });
        if (it.kind === 'chalice') this.msg('The Golden Chalice! Now step into the green portal to escape.', 'good');
      }
      return true;
    }

    dropFromInventory(index) {
      const p = this.player, e = p.inventory[index];
      if (!e) return false;
      this.dropItem(this.level, p.x, p.y, e.kind, 1);
      this.msg(`You drop ${this.itemName(e.kind, 1)}.`);
      this.removeFromInventory(p, e.kind, 1);
      return true;
    }

    useStairs(dir) {
      const p = this.player, lv = this.level;
      if (dir === 'down') {
        if (!lv.stairsDown || lv.stairsDown.x !== p.x || lv.stairsDown.y !== p.y) { this.msg("You can't go down here."); return false; }
        this.emit({ type: 'anim', id: p.id, role: 'climb' });
        this.changeLevel(this.depth + 1, 'down');
        this.msg(`You climb down to depth ${this.depth}.`);
        return true;
      }
      if (!lv.stairsUp || lv.stairsUp.x !== p.x || lv.stairsUp.y !== p.y) { this.msg("You can't go up here."); return false; }
      if (this.depth === 1) {
        if (this.hasItem('chalice')) { this.win('You climb out of the dungeon with the Golden Chalice!'); return true; }
        this.msg('You will not leave without the Golden Chalice.', 'info');
        return false;
      }
      this.changeLevel(this.depth - 1, 'up');
      this.msg(`You climb up to depth ${this.depth}.`);
      return true;
    }

    useItem(index) {
      const p = this.player, e = p.inventory[index];
      if (!e) return false;
      const d = DG.ITEMS[e.kind];
      switch (d.cls) {
        case 'food':
          this.removeFromInventory(p, e.kind, 1);
          p.nutrition = Math.min(1600, p.nutrition + d.nutrition);
          this.heal(p, d.heal);
          this.msg('You eat the hunk of meat. Delicious!', 'good');
          return true;
        case 'potion': this.removeFromInventory(p, e.kind, 1); this.quaff(e.kind); return true;
        case 'scroll': this.removeFromInventory(p, e.kind, 1); this.readScroll(e.kind); return true;
        case 'bomb': return this.throwBomb(e.kind);
        case 'key': this.msg('Walk into a locked chest to use the key.', 'info'); return false;
        case 'chalice': this.msg('The Golden Chalice glitters. It is warm to the touch.', 'good'); return false;
      }
      return false;
    }

    quaff(kind) {
      const p = this.player, eff = this.effectOf[kind];
      const wasKnown = this.known[kind];
      this.known[kind] = true;
      switch (eff) {
        case 'healing': {
          const amt = this.rng.roll('2d8') + p.level * 2;
          if (p.hp + amt > p.maxHp) p.maxHp += 1;
          this.heal(p, amt);
          delete p.status.poison;
          this.msg('You feel much better.', 'good');
          this.emit({ type: 'effect', kind: 'heal', x: p.x, y: p.y });
          break;
        }
        case 'poison':
          p.status.poison = 8;
          this.msg('Yuck! That tasted foul. You feel sick.', 'bad');
          break;
        case 'haste':
          p.status.haste = 30; p.speed = 18;
          this.msg('You feel quick!', 'good');
          break;
        case 'insight': {
          const lv = this.level;
          for (let i = 0; i < lv.seen.length; i++) if (lv.cells[i] !== T.ROCK || this.nearOpen(lv, i)) lv.seen[i] = 1;
          for (const t of lv.traps) t.hidden = false;
          this.msg('A vision of the level fills your mind!', 'good');
          break;
        }
      }
      if (!wasKnown) this.msg(`(That was a ${this.itemName(kind)}.)`, 'info');
    }
    nearOpen(lv, i) {
      const x = i % lv.w, y = Math.floor(i / lv.w);
      for (let dy = -2; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (U.isOpen(lv, x + dx, y + dy)) return true;
      return false;
    }

    readScroll(kind) {
      const p = this.player, eff = this.effectOf[kind];
      const wasKnown = this.known[kind];
      this.known[kind] = true;
      if (eff === 'teleport') {
        const s = this.randomFreeCell(this.level);
        this.emit({ type: 'effect', kind: 'teleport', x: p.x, y: p.y });
        p.x = s.x; p.y = s.y;
        this.emit({ type: 'teleport', id: p.id, x: s.x, y: s.y });
        this.msg('Your surroundings blur... you are somewhere else!', 'info');
      } else if (eff === 'hexblast') {
        this.computeFOV();
        const targets = this.level.monsters.filter(m => m.hp > 0 && this.canSee(m.x, m.y));
        this.msg(targets.length ? 'Purple shards burst out of the scroll!' : 'Purple shards sparkle harmlessly in the air.', 'good');
        for (const m of targets) {
          this.emit({ type: 'effect', kind: 'hex', x: m.x, y: m.y });
          this.damage(m, this.rng.roll('2d6') + this.depth, p, 'hex');
        }
      }
      if (!wasKnown) this.msg(`(That was a ${this.itemName(kind)}.)`, 'info');
    }

    nearestTarget(range) {
      const p = this.player;
      let best = null, bd = 1e9;
      for (const m of this.level.monsters) {
        if (m.hp <= 0 || m.peaceful || !this.canSee(m.x, m.y)) continue;
        const d = cheb(p.x, p.y, m.x, m.y);
        if (d <= range && d < bd && this.los(p.x, p.y, m.x, m.y)) { bd = d; best = m; }
      }
      return best;
    }

    throwBomb(kind) {
      const p = this.player;
      const t = this.nearestTarget(7);
      if (!t) { this.msg('There is no target in sight to throw at.', 'info'); return false; }
      this.removeFromInventory(p, kind, 1);
      p.facing = t.x >= p.x ? 1 : -1;
      this.msg(`You hurl a bomb at the ${t.name}!`);
      this.emit({ type: 'projectile', kind: 'bomb', from: { x: p.x, y: p.y }, to: { x: t.x, y: t.y } });
      this.explode(t.x, t.y, DG.ITEMS.bomb.damage, p);
      return true;
    }

    explode(x, y, dmg, source) {
      const lv = this.level;
      this.emit({ type: 'effect', kind: 'explosion', x, y });
      this.makeNoise(x, y, 12);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const m = this.monsterAt(x + dx, y + dy);
        if (m) this.damage(m, this.rng.roll(dmg), source, 'explosion');
        const p = this.player;
        if (p.x === x + dx && p.y === y + dy) this.damage(p, Math.ceil(this.rng.roll(dmg) / 2), source, 'explosion');
      }
      void lv;
    }

    special() {
      const p = this.player, sp = p.clsDef.special;
      if (p.specialCd > 0) { this.msg(`${sp.name} is not ready (${p.specialCd} turns).`, 'info'); return false; }
      if (p.cls === 'adventurer') {
        const t = this.nearestTarget(sp.range);
        if (!t) { this.msg('No target in range.', 'info'); return false; }
        p.facing = t.x >= p.x ? 1 : -1;
        this.emit({ type: 'anim', id: p.id, role: 'shoot' });
        this.emit({ type: 'projectile', kind: 'arrow', from: { x: p.x, y: p.y }, to: { x: t.x, y: t.y } });
        const hit = this.rng.int(1, 20) + p.toHit + p.level + 1 >= 10 + t.def.defense;
        if (hit) {
          this.msg(`Your arrow hits the ${t.name}.`);
          this.damage(t, this.rng.roll(sp.damage) + Math.floor(p.level / 2), p, 'arrow');
        } else {
          this.msg(`Your arrow misses the ${t.name}.`);
          this.emit({ type: 'miss', id: t.id });
          this.wake(t);
        }
        if (t.peaceful) t.peaceful = false;
        return true;
      }
      // dwarf whirlwind
      const targets = this.level.monsters.filter(m => m.hp > 0 && cheb(m.x, m.y, p.x, p.y) === 1);
      if (!targets.length) { this.msg('There is nothing next to you to hit.', 'info'); return false; }
      this.emit({ type: 'anim', id: p.id, role: 'spin' });
      this.msg('You spin around with your axe!', 'good');
      for (const m of targets) {
        m.peaceful = false;
        this.damage(m, this.rng.roll(sp.damage) + Math.floor(p.level / 2), p, 'axe');
      }
      p.specialCd = sp.cooldown;
      return true;
    }

    // ---------------------------------------------------------------- combat
    attackerStats(a) {
      if (a.isPlayer) return { toHit: a.toHit + a.level, dmg: a.damage, bonus: a.dmgBonus + Math.floor(a.level / 2) };
      return { toHit: a.def.toHit + Math.floor(this.depth / 3), dmg: a.def.damage, bonus: Math.floor(Math.max(0, this.depth - a.def.depth[0]) / 3) };
    }
    defenseOf(d) { return d.isPlayer ? d.defense + Math.floor(d.level / 3) : d.def.defense; }

    attack(a, d) {
      const st = this.attackerStats(a);
      if (a.x !== d.x) a.facing = d.x > a.x ? 1 : -1;
      this.emit({ type: 'attack', id: a.id, x: d.x, y: d.y });
      const roll = this.rng.int(1, 20);
      const hit = roll === 20 || (roll !== 1 && roll + st.toHit >= 10 + this.defenseOf(d));
      if (!d.isPlayer) { this.wake(d); d.peaceful = false; }
      if (!hit) {
        if (a.isPlayer) this.msg(`You miss the ${d.name}.`);
        else if (d.isPlayer) this.msg(`The ${a.name} misses.`);
        this.emit({ type: 'miss', id: d.id });
        return;
      }
      let dmg = Math.max(1, this.rng.roll(st.dmg) + st.bonus);
      if (roll === 20) dmg = Math.floor(dmg * 1.5) + 1;
      if (a.isPlayer) this.msg(roll === 20 ? `You land a crushing blow on the ${d.name}!` : `You hit the ${d.name}.`, roll === 20 ? 'good' : '');
      else if (d.isPlayer) this.msg(`The ${a.name} hits!`, 'bad');
      this.damage(d, dmg, a, 'melee');
      if (!a.isPlayer && d.isPlayer && a.def.inks && d.hp > 0 && this.rng.chance(a.def.inks)) {
        d.status.blind = 4;
        this.msg(`The ${a.name} squirts ink in your eyes! You can't see!`, 'bad');
      }
    }

    damage(target, amount, source, how) {
      target.hp -= amount;
      this.emit({ type: 'hurt', id: target.id, amount, x: target.x, y: target.y });
      if (target.isPlayer) {
        if (target.hp <= 0) {
          const by = source && !source.isPlayer ? source.name : (how === 'explosion' ? 'your own bomb' : how);
          this.stats.killedBy = by;
          this.emit({ type: 'die', id: target.id });
          this.over = { won: false, reason: `Killed by ${/^[aeiou]/i.test(by) ? 'an' : 'a'} ${by} on depth ${this.depth}.` };
          this.msg('You die...', 'bad');
        }
        return;
      }
      if (target.hp > 0) return;
      this.killMonster(target, source);
    }

    killMonster(m, source) {
      const lv = this.level;
      m.hp = 0;
      this.emit({ type: 'die', id: m.id });
      if (source && source.isPlayer) {
        this.stats.kills++;
        this.msg(`You kill the ${m.name}!`, 'good');
        this.gainXp(m.def.xp + this.depth);
      } else this.msg(`The ${m.name} dies.`);
      for (const [kind, chance] of (m.def.drops || [])) {
        if (!this.rng.chance(chance)) continue;
        if (kind === 'gold') this.dropItem(lv, m.x, m.y, 'gold', this.rng.int(5, 20) + this.depth * 3);
        else if (kind === 'potion') this.dropItem(lv, m.x, m.y, this.rng.pick(['potion_red', 'potion_blue', 'potion_red_small', 'potion_blue_small']), 1);
        else this.dropItem(lv, m.x, m.y, kind, 1);
      }
      if (m.def.boss) {
        this.msg('The Witch of the Pit shrieks and crumbles to dust! A green portal swirls open.', 'good');
        lv.portal = { x: m.x, y: m.y };
        this.emit({ type: 'effect', kind: 'portal', x: m.x, y: m.y });
        // the chalice must not sit on the portal itself
        const it = lv.items.find(i => i.kind === 'chalice');
        if (it) { const s = this.freeNear(m.x, m.y) || { x: m.x, y: m.y + 1 }; it.x = s.x; it.y = s.y; }
      }
    }

    gainXp(n) {
      const p = this.player;
      p.xp += n;
      while (p.level < DG.XP_LEVELS.length && p.xp >= DG.XP_LEVELS[p.level]) {
        p.level++;
        const g = this.rng.roll(p.clsDef.hpPerLevel);
        p.maxHp += g; p.hp += g;
        this.msg(`Welcome to experience level ${p.level}!`, 'good');
        this.emit({ type: 'anim', id: p.id, role: 'cheer' });
        this.emit({ type: 'effect', kind: 'levelup', x: p.x, y: p.y });
      }
    }

    heal(e, n) { e.hp = Math.min(e.maxHp, e.hp + n); }
    wake(m) { if (m && !m.awake) { m.awake = true; } }
    makeNoise(x, y, r) {
      for (const m of this.level.monsters) if (m.hp > 0 && cheb(m.x, m.y, x, y) <= r) m.awake = true;
    }

    triggerTrap(t) {
      const p = this.player;
      if (t.type === 'spikes') {
        const wasHidden = t.hidden;
        t.hidden = false;
        if (!wasHidden && this.rng.chance(0.5)) { this.msg('You carefully step over the spikes.', 'info'); return; }
        this.msg('Spikes shoot out of the floor!', 'bad');
        this.emit({ type: 'effect', kind: 'spikes', x: t.x, y: t.y });
        this.damage(p, this.rng.roll('1d6') + Math.floor(this.depth / 2), null, 'spike trap');
      } else if (t.type === 'trapdoor') {
        t.hidden = false;
        this.changeLevel(this.depth + 1, 'fall');
      } else if (t.type === 'portal') {
        this.msg('You step into the shimmering purple portal...', 'info');
        const s = this.randomFreeCell(this.level);
        this.emit({ type: 'effect', kind: 'teleport', x: p.x, y: p.y });
        p.x = s.x; p.y = s.y;
        this.emit({ type: 'teleport', id: p.id, x: s.x, y: s.y });
      }
    }

    enterPortal() {
      if (this.hasItem('chalice')) this.win('You step into the portal clutching the Golden Chalice, and emerge in the sunlight!');
      else this.msg('The portal hums, but it will not take you without the Golden Chalice.', 'info');
    }

    win(reason) {
      this.over = { won: true, reason };
      this.msg(reason, 'good');
      this.emit({ type: 'anim', id: this.player.id, role: 'cheer' });
    }

    score() {
      const p = this.player;
      return p.gold + p.xp * 2 + this.stats.maxDepth * 50 + (this.over && this.over.won ? 1000 : 0);
    }

    // ---------------------------------------------------------------- world simulation
    processWorld() {
      const p = this.player;
      let guard = 0;
      this.pathCache = null;
      while (p.energy < SPEED && !this.over && guard++ < 100) {
        for (const m of this.level.monsters) {
          if (m.hp <= 0) continue;
          m.energy += m.speed;
          while (m.energy >= SPEED && m.hp > 0 && !this.over) {
            m.energy -= SPEED;
            this.monsterAct(m);
          }
        }
        this.level.monsters = this.level.monsters.filter(m => m.hp > 0);
        p.energy += p.speed;
        this.turnTick();
      }
    }

    turnTick() {
      const p = this.player;
      this.turn++;
      // hunger
      p.nutrition--;
      if (p.nutrition === 150) this.msg('You are getting hungry.', 'warn');
      if (p.nutrition === 50) this.msg('You feel weak from hunger!', 'bad');
      if (p.nutrition <= 0 && this.turn % 4 === 0) this.damage(p, 1, null, 'starvation');
      // regen
      if (p.hp < p.maxHp && p.nutrition > 0) {
        p.regen += 1;
        if (p.regen >= Math.max(4, 16 - p.level)) { p.regen = 0; p.hp++; }
      }
      // statuses
      if (p.status.poison) {
        if (this.turn % 2 === 0 && p.hp > 1) { p.hp--; this.emit({ type: 'hurt', id: p.id, amount: 1, x: p.x, y: p.y, quiet: true }); }
        if (--p.status.poison <= 0) { delete p.status.poison; this.msg('You feel less sick.', 'good'); }
      }
      if (p.status.haste && --p.status.haste <= 0) { delete p.status.haste; p.speed = SPEED; this.msg('You feel yourself slow down.', 'info'); }
      if (p.status.blind && --p.status.blind <= 0) { delete p.status.blind; this.msg('You can see again.', 'good'); }
      if (p.specialCd > 0) p.specialCd--;
      // occasional wandering monster
      if (this.level.theme !== 'arena' && this.turn % 80 === 0 && this.rng.chance(0.5)) {
        const type = this.pickMonsterType(this.depth);
        const s = this.randomFreeCell(this.level, (x, y) => this.canSee(x, y) || cheb(x, y, p.x, p.y) < 8);
        if (type && s) { const m = this.spawnMonster(this.level, type, s.x, s.y, {}); m.awake = !m.peaceful; }
      }
    }

    passable(m, x, y) {
      const c = U.cellAt(this.level, x, y);
      if (c === T.ROCK) return false;
      if (c === T.PIT && !m.def.flying) return false;
      if (c === T.WATER && !m.def.flying && !m.def.swims) return false;
      if (this.propAt(this.level, x, y)) return false;
      return true;
    }
    distMap(flying) {
      if (!this.pathCache) this.pathCache = {};
      const k = flying ? 'f' : 'w';
      if (!this.pathCache[k]) {
        const p = this.player, lv = this.level;
        const fake = { def: { flying } };
        this.pathCache[k] = DG.bfs(lv, p.x, p.y, (l, x, y) => this.passable(fake, x, y));
      }
      return this.pathCache[k];
    }

    monsterAct(m) {
      const p = this.player, lv = this.level, d = m.def;
      const dist = cheb(m.x, m.y, p.x, p.y);
      const sees = this.canSee(m.x, m.y) && this.los(m.x, m.y, p.x, p.y);
      if (!m.awake) {
        if (sees && this.rng.chance(lv.lit[U.idx(lv, m.x, m.y)] ? 0.5 : 0.25)) {
          m.awake = true;
          if (d.boss) this.msg('The Witch of the Pit cackles: "Another snack for my pets!"', 'bad');
        } else return;
      }
      if (m.peaceful) { if (this.rng.chance(0.5)) this.wander(m); return; }

      // boss tricks
      if (d.summons && sees && --m.summonCd <= 0) {
        m.summonCd = d.summons.every;
        const n = this.rng.int(d.summons.count[0], d.summons.count[1]);
        let made = 0;
        for (let i = 0; i < n; i++) {
          const s = this.freeNear(m.x, m.y);
          if (s) { const b = this.spawnMonster(lv, d.summons.monster, s.x, s.y, {}); b.energy = 0; made++; this.emit({ type: 'effect', kind: 'hex', x: s.x, y: s.y }); }
        }
        if (made) { this.msg('The Witch whistles, and bats pour out of her sleeves!', 'warn'); this.emit({ type: 'attack', id: m.id, x: p.x, y: p.y }); return; }
      }
      if (d.blink && m.hp < m.maxHp / 2 && dist <= 1 && this.rng.chance(0.3)) {
        const s = this.randomFreeCell(lv, (x, y) => cheb(x, y, p.x, p.y) < 4 || cheb(x, y, p.x, p.y) > 9);
        if (s) {
          this.emit({ type: 'effect', kind: 'teleport', x: m.x, y: m.y });
          m.x = s.x; m.y = s.y;
          this.emit({ type: 'teleport', id: m.id, x: s.x, y: s.y });
          this.msg('The Witch vanishes in a puff of purple smoke!', 'warn');
          return;
        }
      }

      // melee / reach
      if (dist === 1 && this.canStepDiag(m.x, m.y, p.x, p.y)) { this.attack(m, p); return; }
      if (d.reach && dist === 2 && this.reachLine(m, p)) {
        this.msg(`The ${m.name} lashes out with its long tongue!`, 'warn');
        this.attack(m, p);
        return;
      }
      // ranged
      if (d.ranged && sees && dist <= d.ranged.range && dist > 1 && this.rng.chance(d.ranged.chance)) {
        m.facing = p.x >= m.x ? 1 : -1;
        this.emit({ type: 'attack', id: m.id, x: p.x, y: p.y });
        this.emit({ type: 'projectile', kind: d.ranged.projectile, from: { x: m.x, y: m.y }, to: { x: p.x, y: p.y }, sheet: m.sheet });
        const st = this.attackerStats(m);
        if (this.rng.int(1, 20) + st.toHit >= 10 + this.defenseOf(p)) {
          this.msg(`The ${m.name} ${d.ranged.verb} you!`, 'bad');
          this.damage(p, this.rng.roll(d.ranged.damage), m, d.ranged.projectile);
        } else {
          this.msg(`The ${m.name} ${d.ranged.verb} you, but misses.`);
          this.emit({ type: 'miss', id: p.id });
        }
        return;
      }
      if (d.ranged && d.ranged.keepAway && sees && dist < d.ranged.keepAway && this.rng.chance(0.7)) {
        if (this.stepAway(m)) return;
      }
      if (d.erratic && this.rng.chance(d.erratic)) { this.wander(m); return; }
      this.stepToward(m);
    }

    canStepDiag(x0, y0, x1, y1) {
      if (x0 === x1 || y0 === y1) return true;
      const lv = this.level;
      return U.isOpen(lv, x1, y0) || U.isOpen(lv, x0, y1);
    }
    reachLine(m, p) {
      const dx = p.x - m.x, dy = p.y - m.y;
      if (!(dx === 0 || dy === 0 || Math.abs(dx) === Math.abs(dy))) return false;
      const mx = m.x + Math.sign(dx), my = m.y + Math.sign(dy);
      return U.isOpen(this.level, mx, my) && !this.monsterAt(mx, my);
    }

    moveMonster(m, x, y) {
      if (x !== m.x) m.facing = x > m.x ? 1 : -1;
      m.x = x; m.y = y;
      this.emit({ type: 'move', id: m.id, x, y });
    }
    freeFor(m, x, y) {
      return this.passable(m, x, y) && !this.monsterAt(x, y) && !(this.player.x === x && this.player.y === y) &&
        this.canStepDiag(m.x, m.y, x, y);
    }
    wander(m) {
      const opts = DIRS8.map(([dx, dy]) => ({ x: m.x + dx, y: m.y + dy })).filter(c => this.freeFor(m, c.x, c.y));
      if (opts.length) { const c = this.rng.pick(opts); this.moveMonster(m, c.x, c.y); }
    }
    stepToward(m) {
      const lv = this.level, p = this.player;
      const dm = this.distMap(!!m.def.flying);
      const here = dm[U.idx(lv, m.x, m.y)];
      let best = null, bestD = here >= 0 ? here : 1e9, ties = [];
      for (const [dx, dy] of DIRS8) {
        const x = m.x + dx, y = m.y + dy;
        if (!this.freeFor(m, x, y)) continue;
        let dd = dm[U.idx(lv, x, y)];
        if (dd < 0) dd = 1e9 - 1 + cheb(x, y, p.x, p.y);
        if (here < 0) dd = cheb(x, y, p.x, p.y) + 1e8;
        if (dd < bestD) { bestD = dd; ties = [{ x, y }]; }
        else if (dd === bestD) ties.push({ x, y });
      }
      if (ties.length) best = this.rng.pick(ties);
      if (best) this.moveMonster(m, best.x, best.y);
    }
    stepAway(m) {
      const p = this.player;
      let best = null, bd = cheb(m.x, m.y, p.x, p.y);
      for (const [dx, dy] of DIRS8) {
        const x = m.x + dx, y = m.y + dy;
        if (!this.freeFor(m, x, y)) continue;
        const d = cheb(x, y, p.x, p.y);
        if (d > bd) { bd = d; best = { x, y }; }
      }
      if (best) { this.moveMonster(m, best.x, best.y); return true; }
      return false;
    }

    // what the player knows is around (used by UI running)
    interestingAround() {
      const p = this.player, lv = this.level;
      if (lv.monsters.some(m => m.hp > 0 && !m.peaceful && this.canSee(m.x, m.y))) return true;
      if (this.itemsAt(lv, p.x, p.y).length) return true;
      if (this.isStairs(lv, p.x, p.y)) return true;
      return false;
    }
  }

  DG.Game = Game;
  DG.DIRS8 = DIRS8;
})(typeof window !== 'undefined' ? window : globalThis);
