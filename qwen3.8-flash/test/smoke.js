/* Headless smoke test: loads the game scripts with minimal stubs, validates level data,
   then simulates frames (physics, pickups, stomps, water death, goal) to catch runtime errors.
   Run: node test/smoke.js */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// ---- stubs -------------------------------------------------------------------
// Synchronous Image stub: onload fires during `src =` assignment (assets.js sets onload first).
global.Image = class { set src(v) { this._src = v; if (this.onload) this.onload(); } };
global.document = undefined; // game.js boot guard skips DOM init
let fails = 0, checks = 0;
function ok(cond, msg) { checks++; if (!cond) { fails++; console.error('FAIL:', msg); } }

// canvas 2d stub: no-op methods, sensible return values
const ctxStub = new Proxy({
  measureText: (t) => ({ width: String(t).length * 6 }),
  createLinearGradient: () => ({ addColorStop() {} })
}, {
  get(t, p) { if (p in t) return t[p]; return () => undefined; },
  set() { return true; }
});

// ---- load game scripts (same order as index.html) -----------------------------
const root = path.join(__dirname, '..');
for (const f of ['js/urban_rects.js', 'js/assets.js', 'js/audio.js', 'js/level.js', 'js/entities.js', 'js/game.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(root, f), 'utf8'), { filename: f });
}
const AA = globalThis.AA;
ok(AA && AA.Game && AA.LEVEL && AA.Assets && AA.Ent && AA.URBAN_RECTS, 'namespaces defined');

// ---- level data validation -----------------------------------------------------
const L = AA.LEVEL.buildLevel();
ok(L.grid.length === L.COLS * L.ROWS, 'grid size');
const tileAt = (x, y) => L.grid[y * L.COLS + x];
ok(!L.SOLID[tileAt(4, 17)], 'spawn cell not solid');
ok(L.SOLID[tileAt(4, L.GROUND_ROW)], 'ground under spawn is solid');

// every mystery key must point at a real "!" block (id 10)
for (const key of Object.keys(L.mystery)) {
  const [tx, ty] = key.split(',').map(Number);
  ok(tileAt(tx, ty) === 10, `mystery key ${key} points at id 10 (found ${tileAt(tx, ty)})`);
}

// all tile ids used in the grid must be preloaded by assets.js
const need = new Set(AA.Assets.NEED.main);
const used = new Set();
for (let i = 0; i < L.grid.length; i++) if (L.grid[i] !== -1) used.add(L.grid[i]);
for (const id of used) ok(need.has(id), `tile id ${id} used in level is preloaded`);

// urban decor ids must exist in the generated rect table
for (const d of L.decos) ok(!!AA.URBAN_RECTS[d.id], `deco urban id ${d.id} exists in URBAN_RECTS`);

// coins / pickups / enemies inside world bounds; coin cells not embedded in solids
for (const c of L.coins) {
  ok(c.x > 0 && c.x < L.W && c.y > 0 && c.y < L.H, 'coin in bounds');
  ok(!L.SOLID[tileAt(Math.floor(c.x / 18), Math.floor(c.y / 18))], `coin at ${c.x},${c.y} not inside solid`);
}
for (const e of L.enemies) {
  ok(e.x > 0 && e.x < L.W, 'enemy in bounds');
  if (e.kind === 'rover' || e.kind === 'grunt') {
    ok(L.SOLID[tileAt(Math.floor(e.x / 18), L.GROUND_ROW)] || L.SOLID[tileAt(Math.floor(e.x / 18), L.GROUND_ROW - 0)], `ground enemy ${e.kind}@${e.x} stands on ground`);
  }
}
for (const s of L.signs) ok(s.text && s.x > 0 && s.x < L.W, 'sign sane');

// goal reachable: column at goal has solid ground below
ok(L.SOLID[tileAt(Math.floor(L.goal.x / 18), L.GROUND_ROW)], 'goal on solid ground');

// regression: loadAll must invoke the FIRST caller's callback once all images resolve
let cbFired = 0;
AA.Assets.loadAll(() => cbFired++);
ok(cbFired === 1, 'loadAll fires callback for first caller');
AA.Assets.loadAll(() => cbFired++); // already-loaded path
ok(cbFired === 2, 'loadAll fires callback when already loaded');

// ---- simulated gameplay ---------------------------------------------------------
AA.Game._setCtx(ctxStub);
AA.Game.newGame();
const inp = AA.Game._input;

function frames(n) { for (let i = 0; i < n; i++) { AA.Game.update(); AA.Game.render(); } }
function revive(g, x, y) { const p = g.player; p.dead = false; p.deadT = 0; p.hearts = 3; p.invuln = 0; p.vx = 0; p.vy = 0; p.x = x; p.y = y; }

// let the player settle on the ground
frames(60);
let g = AA.Game._state();
ok(Math.abs(g.player.y + g.player.h - L.GROUND_ROW * 18) < 2, 'player settled on ground');
ok(!g.player.dead, 'player alive after settling');

// title overlay renders over the live level preview without errors
g.mode = 'title'; AA.Game.render(); g.mode = 'play';

// tap-jump (one-frame press, no hold) must still clear a tile (18px)
{
  const y0 = g.player.y; // standing on flat ground at spawn
  inp.jumpPressed = true; inp.jumpHeld = false;
  AA.Game.update(); // fires the jump, applies the variable-height cut
  let apex = y0;
  for (let i = 0; i < 30 && g.player.vy < 0; i++) { AA.Game.update(); apex = Math.min(apex, g.player.y); }
  ok(y0 - apex >= 20, `tap-jump clears a tile (rise=${(y0 - apex).toFixed(1)}px)`);
}

// run right with periodic jumps (~40s sim) — hearts pinned so we test traversal, not dying
inp.right = true; inp.run = true;
let maxX = 0;
for (let i = 0; i < 2400; i++) {
  inp.jumpPressed = (i % 50 === 0);
  inp.jumpHeld = (i % 50) < 16;
  AA.Game.update();
  if (i % 7 === 0) AA.Game.render();
  g = AA.Game._state();
  g.player.hearts = 99; // god-mode for the autopilot run
  maxX = Math.max(maxX, g.player.x);
}
ok(g.mode === 'play' || g.mode === 'win', 'autopilot run ended in play/win mode (got: ' + g.mode + ')');
g.mode = 'play'; // safety if autopilot actually reached the goal
ok(Number.isFinite(g.player.x) && Number.isFinite(g.player.y), 'player position finite');
ok(maxX > 30 * 18, `autopilot progressed right (maxX=${Math.round(maxX)})`);

// not embedded in a solid tile?
{
  const p = g.player;
  const cx = Math.floor((p.x + p.w / 2) / 18), cyTop = Math.floor((p.y + 2) / 18), cyBot = Math.floor((p.y + p.h - 2) / 18);
  ok(!L.SOLID[tileAt(cx, cyTop)] && !L.SOLID[tileAt(cx, cyBot)], 'player not stuck inside terrain');
}

// stomp test: drop onto a currently-alive rover where it actually is
{
  const e = g.enemies.find(e => e.kind === 'rover' && e.alive && !e.dead);
  ok(!!e, 'a rover is still alive to stomp');
  if (e) {
    revive(g, e.x + e.w / 2 - 6, e.y - g.player.h - 8); // start just above its head, shallow overlap on contact
    g.player.vy = 2;
    const before = g.score;
    for (let i = 0; i < 12 && g.score === before; i++) AA.Game.update();
    ok(g.score >= before + 200, 'stomp scored 200');
    ok(e.dead || !e.alive, 'rover squashed');
  }
}

// mystery block test: jump into a freshly re-planted "!" block from below
{
  const key = Object.keys(L.mystery)[0];
  const [tx, ty] = key.split(',').map(Number);
  const Mg = g.level; // the game's own grid (autopilot may have consumed blocks)
  Mg.grid[ty * Mg.COLS + tx] = 10;
  inp.right = false; inp.run = false; frames(4); // stop sliding first, so we jump straight up under it
  revive(g, tx * 18 + 2, (ty + 3) * 18);
  frames(20); // settle under it
  g.player.vy = -9; inp.jumpPressed = false;
  inp.jumpHeld = true; // hold jump so the variable-height cut doesn't nerf the hop
  const coinsBefore = g.coinCount, scoreBefore = g.score;
  let popped = false;
  for (let i = 0; i < 60; i++) { AA.Game.update(); if (Mg.grid[ty * Mg.COLS + tx] === 6) { popped = true; break; } }
  ok(popped, 'mystery block converted to brick after bump');
  const content = L.mystery[key];
  if (content === 'coin') ok(g.coinCount > coinsBefore || g.score > scoreBefore, 'mystery coin awarded');
}

// water death test: drop into the Huron, expect heart loss + respawn at last checkpoint
{
  revive(g, 154 * 18, (L.GROUND_ROW - 1) * 18);
  g.player.vy = 1;
  const heartsBefore = g.player.hearts;
  for (let i = 0; i < 12 && g.player.hearts === heartsBefore; i++) AA.Game.update();
  ok(g.player.hearts === heartsBefore - 1, 'water cost one heart');
  frames(5);
  ok(Math.abs(g.player.y - g.respawn.y) < 40 && Math.abs(g.player.x - g.respawn.x) < 40, 'respawned at checkpoint point');
}

// goal test: nudge into the goal flag => win
{
  g = AA.Game._state();
  revive(g, L.goal.x - 8, (L.GROUND_ROW - 2) * 18);
  frames(5);
  ok(g.mode === 'win', 'reaching goal triggers win');
}

// restart via action()
g.overT = 999; g.winT = 999;
AA.Game.action(); // from win -> new game
ok(AA.Game._state().mode === 'play', 'action() restarts after win');

console.log(`\n${checks - fails}/${checks} checks passed`);
process.exit(fails ? 1 : 0);
