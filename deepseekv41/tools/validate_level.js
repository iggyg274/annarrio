/* tools/validate_level.js — offline sanity check for the level + asset wiring.
 *
 * Node-only harness (not shipped with the game): it fakes just enough of the
 * browser globals for js/assets.js and js/level.js to run, then asserts the
 * level is actually playable — spawn on solid ground, coins reachable, enemies
 * standing on real tiles, no hedge wall blocking the goal, urban sprite ids that
 * exist in the manifest, and no "do not use" sprites referenced anywhere.
 *
 *   node tools/validate_level.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
let failures = 0, checks = 0;
function ok(cond, label) {
  checks++;
  if (cond) { console.log('  ok   ' + label); }
  else { failures++; console.log('  FAIL ' + label); }
}
function section(t) { console.log('\n== ' + t + ' =='); }

// ---------------------------------------------------------------- fake browser
const win = {};
const sandbox = { window: win, console, fetch: undefined, Image: undefined,
                  Date, Math, setTimeout, clearInterval, setInterval };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

function run(file) {
  const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
  vm.runInContext(src, sandbox, { filename: file });
}

run('js/assets.js');
// assets.js only needs its own module object for TILE/CHAR constants here
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest/urban_tileset_manifest.json'), 'utf8'));
win.AAB.assets.urbanById = {};
manifest.sprites.forEach(s => { win.AAB.assets.urbanById[s.id] = s; });

run('js/level.js');

// ------------------------------------------------------------------- run build
const L = win.AAB.level.build();
const T = win.AAB.assets.TILE;
const SOLID = win.AAB.level.SOLID;
const WATER = win.AAB.level.WATER;

function tile(tx, ty) {
  if (tx < 0 || ty < 0 || tx >= L.widthTiles || ty >= L.heightTiles) return -1;
  return L.tiles[ty * L.widthTiles + tx];
}
function solid(tx, ty) { const v = tile(tx, ty); return v !== 0 && v !== -1 && SOLID[v] === true; }
function water(tx, ty) { const v = tile(tx, ty); return v !== -1 && v !== 0 && WATER[v] === true; }

section('grid');
ok(L.tiles.length === L.widthTiles * L.heightTiles, 'tile grid is ' + L.widthTiles + 'x' + L.heightTiles);
let unknown = 0;
L.tiles.forEach(v => { if (v !== 0 && (v < 0 || v > 179)) unknown++; });
ok(unknown === 0, 'every tile value is a valid Kenney index 0-179');

section('spawn + ground');
const spawnTx = Math.floor((L.spawn.x + 6) / T);
ok(solid(spawnTx, L.groundRow), 'spawn sits above solid ground at tile ' + spawnTx + ',' + L.groundRow);
ok(!water(Math.floor(L.spawn.x / T), L.groundRow + 1), 'spawn is not inside water');

section('ground integrity (no hash-pick holes in the surface row)');
let holes = [];
for (let x = 0; x < L.widthTiles; x++) {
  if (tile(x, L.heightTiles - 1) !== 0 && !solid(x, L.groundRow)) holes.push(x);
}
ok(holes.length === 0,
  holes.length ? 'surface holes at x=' + holes.slice(0, 12).join(',') : 'every ground column has a surface tile');

section('pits have floors? (fall = death, so only pits should be empty)');
let pitCount = 0;
for (let x = 0; x < L.widthTiles; x++) if (tile(x, L.heightTiles - 1) === 0) pitCount++;
ok(pitCount > 0, 'the level has at least one pit (' + pitCount + ' columns)');

section('water hazard');
let waterCols = 0;
for (let x = 0; x < L.widthTiles; x++) if (water(x, L.groundRow + 1)) waterCols++;
ok(waterCols >= 8, 'river spans ' + waterCols + ' columns of water just below the surface row');

section('walkable path to the goal (no wall taller than a jump)');
// Obstruction height = solid tiles above the surface row; a jump clears ~5 tiles.
let blocked = [];
for (let x = 0; x < L.widthTiles; x++) {
  let height = 0;
  for (let y = L.groundRow - 1; y >= 0; y--) { if (solid(x, y)) height++; else break; }
  if (height > 5) blocked.push(x + ':' + height);
}
ok(blocked.length === 0,
  blocked.length ? 'blocking walls: ' + blocked.join(' ') : 'no unclimbable wall in any column');

section('coins reachable (a standable surface within a jump below)');
let badCoins = [];
L.coins.forEach((c, i) => {
  const tx = Math.floor(c.x / T), ty = Math.floor((c.y + 4) / T);
  let surface = -1;
  for (let y = ty; y < L.heightTiles; y++) { if (solid(tx, y)) { surface = y; break; } }
  if (surface === -1) { badCoins.push(i + ' nothing solid below x=' + tx + ',y=' + ty); return; }
  const dy = surface - ty;                      // tiles of clearance to the surface
  if (dy > 6) badCoins.push(i + ' too high (dy=' + dy + ') at x=' + tx + ',y=' + ty);
});
ok(badCoins.length === 0, badCoins.length ? badCoins.join(' | ') : L.coins.length + ' coins all within reach');

section('enemies stand on solid ground / are placed sensibly');
let badEnemies = [];
L.enemies.forEach((e, i) => {
  const tx = Math.floor(e.x / T);
  if (e.patrolFrom >= e.patrolTo) badEnemies.push(i + ' bad patrol range');
  if (e.type === 'rover') {
    if (!solid(tx, L.groundRow) && !solid(tx, L.groundRow + 1)) {
      badEnemies.push(i + ' rover has no floor at x=' + tx);
    }
  } else if (e.baseY == null) {
    badEnemies.push(i + ' drone without baseY');
  }
});
ok(badEnemies.length === 0, badEnemies.length ? badEnemies.join(' | ') : L.enemies.length + ' enemies placed ok');

section('goal reachable');
const goalTx = Math.floor(L.goal.x / T);
ok(goalTx > 0 && goalTx < L.widthTiles, 'goal tile is inside the level (x=' + goalTx + ')');
let goalBlocked = false;
for (let y = 14; y >= 12; y--) if (solid(goalTx, y)) goalBlocked = true;
ok(!goalBlocked, 'no hedge/brick wall in the goal column');
ok(solid(goalTx, L.groundRow), 'goal stands on solid ground');

section('checkpoints are on solid, dry ground');
L.checkpoints.forEach((cp, i) => {
  const tx = Math.floor(cp.x / T);
  ok(solid(tx, L.groundRow) && !water(tx, L.groundRow - 1), 'checkpoint ' + (i + 1) + ' at x=' + tx);
});

section('urban sprites referenced exist and are decoration-safe');
const used = new Set();
L.buildings.forEach(b => used.add(b.urbanId));
L.props.forEach(p => { if (p.urbanId != null) used.add(p.urbanId); });
let missing = [], banned = [];
used.forEach(id => {
  const entry = win.AAB.assets.urbanById[id];
  if (!entry) { missing.push(id); return; }
  if (!win.AAB.assets.urbanUsable(entry)) banned.push(id + ' (' + entry.label + ')');
});
ok(missing.length === 0, missing.length ? 'missing ids: ' + missing.join(',') : used.size + ' urban sprite ids all exist in the manifest');
ok(banned.length === 0, banned.length ? 'banned sprites used: ' + banned.join(' | ') : 'no "do not use" swatch/billboard sprite referenced');

section('signage');
const texts = L.labels.map(l => l.text.toUpperCase());
['MICHIGAN STADIUM', 'THE DIAG', 'BURTON TOWER', 'HURON RIVER'].forEach(t =>
  ok(texts.indexOf(t) >= 0, 'Ann Arbor label present: ' + t));
ok(texts.filter(t => /DIAG/.test(t)).length >= 1, 'Diag signage');
ok(L.labels.length >= 8, L.labels.length + ' text labels total');

section('props');
ok(L.props.length > 40, L.props.length + ' decoration props placed');
let solidProps = L.props.filter(p => p.solid);
ok(solidProps.length >= 3, solidProps.length + ' solid props (pipes/signposts)');

console.log('\n' + (failures ? 'FAILED ' + failures + '/' + checks + ' checks' : 'ALL ' + checks + ' CHECKS PASSED'));
process.exit(failures ? 1 : 0);
