#!/usr/bin/env node
// Headless test: generates many levels and plays games with a simple bot, checking
// invariants (connectivity, stairs reachable, no entity in walls, no exceptions).
// Usage: node tools/simulate.js [games=40] [maxTurns=4000]
'use strict';
const path = require('path');
const load = f => require(path.join(__dirname, '..', 'js', f));
global.window = globalThis;          // asset_data.js assigns window.ASSET_DATA
load('asset_data.js');
delete global.window;                // the game modules must not depend on a browser window
['rng.js', 'assets.js', 'data.js', 'mapgen.js', 'game.js'].forEach(load);
const DG = globalThis.DG;
DG.Assets.init(globalThis.ASSET_DATA);
DG.Assets.buildExtras();
const { T } = DG, U = DG.levelUtil;

const games = +(process.argv[2] || 40), maxTurns = +(process.argv[3] || 8000);
let fails = 0;
const fail = (msg) => { fails++; console.log('FAIL', msg); };

// 1. level generation invariants
for (let s = 1; s <= 300; s++) {
  const rng = new DG.RNG(s);
  const depth = 1 + (s % DG.MAX_DEPTH);
  let lv;
  try { lv = DG.MapGen.generate(depth, rng); } catch (e) { fail(`gen seed ${s}: ${e.message}`); continue; }
  if (!DG.MapGen.connected(lv)) fail(`level ${s} not connected`);
  const auto = DG.MapGen.autotile(lv);
  for (let y = 0; y < lv.h; y++) for (let x = 0; x < lv.w; x++) {
    const i = U.idx(lv, x, y);
    if (U.isSolid(lv, x, y)) {
      const n = U.isOpen(lv, x, y - 1), so = U.isOpen(lv, x, y + 1), e = U.isOpen(lv, x + 1, y), w = U.isOpen(lv, x - 1, y);
      if ((n && so) || (e && w)) fail(`thin wall at ${x},${y} seed ${s}`);
      if ((n || so || e || w) && (!auto[i].wall || auto[i].wall === 'void')) fail(`untiled wall ${x},${y} seed ${s}`);
    }
  }
}

// 2. bot games
function botAct(g) {
  const p = g.player, lv = g.level;
  if (p.hp < p.maxHp * 0.4) {
    const idx = p.inventory.findIndex(e => DG.ITEMS[e.kind].cls === 'potion');
    if (idx >= 0) return { type: 'use', index: idx };
  }
  if (p.nutrition < 140) {
    const idx = p.inventory.findIndex(e => e.kind === 'meat');
    if (idx >= 0) return { type: 'use', index: idx };
  }
  if (g.itemsAt(lv, p.x, p.y).length && p.inventory.length < 18) return { type: 'pickup' };
  const hostileInView = lv.monsters.some(m => m.hp > 0 && !m.peaceful && g.canSee(m.x, m.y));
  if (!hostileInView && p.hp < p.maxHp * 0.7 && p.nutrition > 200) return { type: 'search' }; // rest
  const adj = lv.monsters.find(m => m.hp > 0 && !m.peaceful && Math.max(Math.abs(m.x - p.x), Math.abs(m.y - p.y)) === 1);
  if (adj) {
    if (p.cls === 'dwarf' && p.specialCd === 0) return { type: 'special' };
    return { type: 'move', dx: adj.x - p.x, dy: adj.y - p.y };
  }
  if (p.cls === 'adventurer' && g.nearestTarget(6) && g.rng.chance(0.7)) return { type: 'special' };
  if (lv.portal && g.hasItem('chalice')) return stepTo(g, lv.portal);
  const chalice = lv.items.find(i => i.kind === 'chalice');
  if (chalice) return stepTo(g, chalice);
  // a level or two of grinding before descending further; fight what we see
  const foe = lv.monsters.find(m => m.hp > 0 && !m.peaceful && g.canSee(m.x, m.y));
  if (foe && (p.hp > p.maxHp * 0.5 || !lv.stairsDown)) return stepTo(g, foe);
  if (p.level < g.depth + 1 && lv.stairsDown && g.turn % 400 < 300) {
    const m = lv.monsters.find(m => m.hp > 0 && !m.peaceful);
    if (m) return stepTo(g, m);
  }
  if (lv.stairsDown && p.x === lv.stairsDown.x && p.y === lv.stairsDown.y) return { type: 'stairs', dir: 'down' };
  // hunt visible monsters on the boss level, else head for the stairs
  const target = lv.stairsDown || (lv.monsters.find(m => m.def.boss) || lv.monsters[0]);
  if (target) return stepTo(g, target);
  return { type: 'wait' };
}
function stepTo(g, t) {
  const lv = g.level, p = g.player;
  const d = DG.bfs(lv, t.x, t.y, (l, x, y) => U.cellAt(l, x, y) === T.FLOOR && !g.propAt(l, x, y));
  let best = null, bd = d[U.idx(lv, p.x, p.y)];
  if (bd < 0) return { type: 'wait' };
  for (const [dx, dy] of DG.DIRS8) {
    const x = p.x + dx, y = p.y + dy;
    const v = U.inb(lv, x, y) ? d[U.idx(lv, x, y)] : -1;
    if (v >= 0 && v < bd && (dx === 0 || dy === 0 || U.cellAt(lv, p.x + dx, p.y) === T.FLOOR || U.cellAt(lv, p.x, p.y + dy) === T.FLOOR)) { bd = v; best = [dx, dy]; }
  }
  return best ? { type: 'move', dx: best[0], dy: best[1] } : { type: 'wait' };
}

const results = { won: 0, died: 0, timeout: 0, depths: [], killers: {} };
for (let n = 0; n < games; n++) {
  const cls = n % 2 ? 'dwarf' : 'adventurer';
  let g;
  try {
    g = new DG.Game({ cls, seed: 1000 + n });
    let steps = 0;
    while (!g.over && steps++ < maxTurns) {
      const a = botAct(g);
      if (!g.act(a)) g.act({ type: 'wait' });
      g.takeEvents();
      const lv = g.level, p = g.player;
      if (U.cellAt(lv, p.x, p.y) !== T.FLOOR) throw new Error(`player in non-floor at ${p.x},${p.y}`);
      for (const m of lv.monsters) {
        if (m.hp > 0 && !g.passable(m, m.x, m.y)) throw new Error(`${m.name} stuck in terrain at ${m.x},${m.y}`);
        if (m.hp > 0 && m.x === p.x && m.y === p.y) throw new Error(`${m.name} on player`);
      }
    }
    results.depths.push(g.stats.maxDepth);
    if (!g.over) results.timeout++;
    else if (g.over.won) results.won++;
    else { results.died++; const k = g.stats.killedBy; results.killers[k] = (results.killers[k] || 0) + 1; }
  } catch (e) {
    fail(`game ${n} (${cls}) crashed: ${e.stack}`);
  }
}
const avg = results.depths.reduce((a, b) => a + b, 0) / Math.max(1, results.depths.length);
console.log(`bot games: ${games}  won ${results.won}  died ${results.died}  timeout ${results.timeout}  avg max depth ${avg.toFixed(1)}`);
console.log('killed by:', results.killers);
console.log(fails ? `${fails} failures` : 'all checks passed');
process.exit(fails ? 1 : 0);
