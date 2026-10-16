// Level generation (NetHack-style rooms + corridors) and 3/4-view wall autotiling.
//
// The elthenassets tilesets are drawn in 3/4 view: a wall that has floor to its south shows
// a brick FACE, and the tile above that face is the wall's CAP (dark top + stone ledge).
// Vertical walls are thin strips; the bottom edge of a room is a thin ledge. The autotiler
// below picks, for every solid cell, which piece of the tileset's `wall_frame`/`enclosure`
// stamp (or of the `wall_corner_*` / `wall_step_*` stamps) fits its neighbourhood.
(function (root) {
  'use strict';
  const DG = root.DG = root.DG || {};

  const T = DG.T = { ROCK: 0, FLOOR: 1, PIT: 2, WATER: 3 };
  const W = 60, H = 40;

  function makeLevel(depth, theme) {
    return {
      depth, theme, w: W, h: H,
      cells: new Uint8Array(W * H),         // T.*
      floorKind: new Array(W * H).fill(null), // terrain name for floor cells
      roomId: new Int16Array(W * H).fill(-1),
      lit: new Uint8Array(W * H),
      rooms: [], features: [], decor: [], wallDecor: [],
      traps: [], items: [], monsters: [], props: [],
      seen: new Uint8Array(W * H), visible: new Uint8Array(W * H),
      stairsUp: null, stairsDown: null,
    };
  }

  const idx = (lv, x, y) => y * lv.w + x;
  const inb = (lv, x, y) => x >= 0 && y >= 0 && x < lv.w && y < lv.h;
  const cellAt = (lv, x, y) => inb(lv, x, y) ? lv.cells[idx(lv, x, y)] : T.ROCK;
  const isOpen = (lv, x, y) => cellAt(lv, x, y) !== T.ROCK;
  const isSolid = (lv, x, y) => !isOpen(lv, x, y);

  DG.levelUtil = { idx, inb, cellAt, isOpen, isSolid };

  // ------------------------------------------------------------------------------------
  function generate(depth, rng, opts) {
    if (depth >= DG.MAX_DEPTH) return generateArena(depth, rng);
    for (let attempt = 0; attempt < 30; attempt++) {
      const lv = tryGenerate(depth, rng, opts || {});
      if (lv) return lv;
    }
    throw new Error('level generation failed');
  }

  function tryGenerate(depth, rng, opts) {
    const lv = makeLevel(depth, 'dungeon');
    // 1. rooms
    const rooms = [];
    const want = rng.int(7, 10);
    for (let tries = 0; tries < 400 && rooms.length < want; tries++) {
      const w = rng.int(4, 11), h = rng.int(3, 7);
      const x = rng.int(2, W - w - 3), y = rng.int(4, H - h - 3);
      const r = { x, y, w, h };
      // margin: 3 rows above (cap, face, rock), 2 elsewhere
      if (rooms.some(o => x - 3 < o.x + o.w && o.x - 3 < x + w && y - 4 < o.y + o.h && o.y - 4 < y + h)) continue;
      rooms.push(r);
    }
    if (rooms.length < 5) return null;
    rooms.sort((a, b) => a.x - b.x);
    rooms.forEach((r, i) => {
      r.id = i;
      r.kind = 'stone';
      r.lit = rng.chance(Math.max(0.35, 0.95 - depth * 0.08));
      if (rng.chance(0.22)) r.kind = 'dirt';
      for (let yy = r.y; yy < r.y + r.h; yy++) for (let xx = r.x; xx < r.x + r.w; xx++) {
        const i2 = idx(lv, xx, yy);
        lv.cells[i2] = T.FLOOR; lv.floorKind[i2] = r.kind; lv.roomId[i2] = i; lv.lit[i2] = r.lit ? 1 : 0;
      }
    });
    lv.rooms = rooms;

    // 2. corridors: chain neighbours, then a few extra loops
    const center = r => ({ x: rng.int(r.x, r.x + r.w - 1), y: rng.int(r.y, r.y + r.h - 1) });
    for (let i = 0; i + 1 < rooms.length; i++) dig(lv, center(rooms[i]), center(rooms[i + 1]), rng);
    for (let k = rng.int(1, 3); k > 0; k--) {
      const a = rng.pick(rooms), b = rng.pick(rooms);
      if (a !== b) dig(lv, center(a), center(b), rng);
    }

    // 3. pits inside some big stone rooms (before fix-up so walls stay consistent)
    if (!opts.noPits) for (const r of rooms) {
      if (r.kind === 'stone' && r.w >= 7 && r.h >= 5 && rng.chance(0.35)) placePit(lv, r, rng);
    }
    fixThinWalls(lv);
    if (!connected(lv)) return null;

    // 4. stairs
    const start = rng.pick(rooms);
    lv.stairsUp = randomFree(lv, start, rng);
    let far = null, best = -1;
    const dist = bfs(lv, lv.stairsUp.x, lv.stairsUp.y, passableForGen);
    for (const r of rooms) {
      if (r === start) continue;
      const p = randomFree(lv, r, rng);
      if (!p) continue;
      const d = dist[idx(lv, p.x, p.y)];
      if (d > best) { best = d; far = p; }
    }
    if (!far) return null;
    lv.stairsDown = far;
    lv.startRoom = start;
    return lv;
  }

  function dig(lv, a, b, rng) {
    let x = a.x, y = a.y;
    const carve = () => {
      const i = idx(lv, x, y);
      if (lv.cells[i] === T.ROCK) { lv.cells[i] = T.FLOOR; lv.floorKind[i] = 'stone'; }
    };
    const horizFirst = rng.chance(0.5);
    const stepX = () => { while (x !== b.x) { x += Math.sign(b.x - x); carve(); } };
    const stepY = () => { while (y !== b.y) { y += Math.sign(b.y - y); carve(); } };
    if (horizFirst) { stepX(); stepY(); } else { stepY(); stepX(); }
  }

  function placePit(lv, r, rng) {
    // plus or rectangle shaped chasm, at least 1 cell from the room's walls
    const cx = r.x + Math.floor(r.w / 2), cy = r.y + Math.floor(r.h / 2);
    const cells = [];
    const rect = (x0, y0, w, h) => { for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) cells.push([x, y]); };
    if (rng.chance(0.5) && r.w >= 8 && r.h >= 6) {
      rect(cx - 2, cy - 1, 4, 2); rect(cx - 1, cy - 2, 2, 4);
    } else {
      const w = Math.min(r.w - 4, rng.int(2, 4)), h = Math.min(r.h - 3, rng.int(2, 3));
      rect(cx - Math.floor(w / 2), cy - Math.floor(h / 2), w, h);
    }
    // must leave a 1-cell walkway around (inside the room)
    for (const [x, y] of cells) {
      if (x <= r.x || x >= r.x + r.w - 1 || y <= r.y || y >= r.y + r.h - 1) return;
    }
    for (const [x, y] of cells) lv.cells[idx(lv, x, y)] = T.PIT;
    r.hasPit = true;
  }

  // Solid cells with open space on both opposite sides cannot be drawn with the tileset
  // (walls are 2 tiles tall in 3/4 view); open them up.
  function fixThinWalls(lv) {
    let changed = true;
    while (changed) {
      changed = false;
      for (let y = 1; y < lv.h - 1; y++) for (let x = 1; x < lv.w - 1; x++) {
        if (!isSolid(lv, x, y)) continue;
        const ns = walk(lv, x, y - 1) && walk(lv, x, y + 1);
        const ew = walk(lv, x - 1, y) && walk(lv, x + 1, y);
        if (ns || ew) {
          const i = idx(lv, x, y);
          lv.cells[i] = T.FLOOR;
          lv.floorKind[i] = neighbourFloorKind(lv, x, y) || 'stone';
          changed = true;
        }
      }
      // keep the outer border solid and 2 rows free at the top
      for (let x = 0; x < lv.w; x++) { lv.cells[idx(lv, x, 0)] = T.ROCK; lv.cells[idx(lv, x, lv.h - 1)] = T.ROCK; lv.cells[idx(lv, x, 1)] = T.ROCK; }
      for (let y = 0; y < lv.h; y++) { lv.cells[idx(lv, 0, y)] = T.ROCK; lv.cells[idx(lv, lv.w - 1, y)] = T.ROCK; }
    }
  }
  const walk = (lv, x, y) => { const c = cellAt(lv, x, y); return c === T.FLOOR; };
  function neighbourFloorKind(lv, x, y) {
    for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
      const k = inb(lv, x + dx, y + dy) && lv.floorKind[idx(lv, x + dx, y + dy)];
      if (k) return k;
    }
    return null;
  }

  function passableForGen(lv, x, y) { return cellAt(lv, x, y) === T.FLOOR; }

  function bfs(lv, sx, sy, passable) {
    const dist = new Int32Array(lv.w * lv.h).fill(-1);
    const q = [[sx, sy]]; dist[idx(lv, sx, sy)] = 0;
    for (let h = 0; h < q.length; h++) {
      const [x, y] = q[h];
      const d = dist[idx(lv, x, y)];
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx, ny = y + dy;
        if (!inb(lv, nx, ny) || dist[idx(lv, nx, ny)] >= 0 || !passable(lv, nx, ny)) continue;
        if (dx && dy && !passable(lv, x + dx, y) && !passable(lv, x, y + dy)) continue; // no squeezing
        dist[idx(lv, nx, ny)] = d + 1;
        q.push([nx, ny]);
      }
    }
    return dist;
  }
  DG.bfs = bfs;

  function connected(lv) {
    let s = null, total = 0;
    for (let y = 0; y < lv.h; y++) for (let x = 0; x < lv.w; x++) if (walk(lv, x, y)) { total++; if (!s) s = [x, y]; }
    if (!s) return false;
    const d = bfs(lv, s[0], s[1], passableForGen);
    let reached = 0;
    for (let i = 0; i < d.length; i++) if (d[i] >= 0) reached++;
    return reached === total;
  }

  function randomFree(lv, r, rng, avoid) {
    for (let t = 0; t < 60; t++) {
      const x = rng.int(r.x, r.x + r.w - 1), y = rng.int(r.y, r.y + r.h - 1);
      if (cellAt(lv, x, y) !== T.FLOOR) continue;
      if (avoid && avoid(x, y)) continue;
      return { x, y };
    }
    return null;
  }
  DG.randomFree = randomFree;

  // ------------------------------------------------------------------------------------
  // Depth 8: the Witch's arena (arena tileset: sand, battlements, pools).
  function generateArena(depth, rng) {
    const lv = makeLevel(depth, 'arena');
    const r = { x: 12, y: 8, w: 36, h: 22, id: 0, kind: 'sand', lit: true };
    lv.rooms = [r];
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) {
      const i = idx(lv, x, y);
      lv.cells[i] = T.FLOOR; lv.floorKind[i] = 'sand'; lv.roomId[i] = 0; lv.lit[i] = 1;
    }
    // entry hall from the south with the ladder
    for (let y = r.y + r.h; y < r.y + r.h + 5; y++) for (let x = 28; x < 32; x++) {
      const i = idx(lv, x, y);
      lv.cells[i] = T.FLOOR; lv.floorKind[i] = 'sand'; lv.lit[i] = 1; lv.roomId[i] = 0;
    }
    // four pools and four pillar blocks, symmetric
    const pools = [[17, 12], [39, 12], [17, 23], [39, 23]];
    for (const [px, py] of pools) for (let y = py; y < py + 2; y++) for (let x = px; x < px + 3; x++) lv.cells[idx(lv, x, y)] = T.WATER;
    fixThinWalls(lv);
    lv.stairsUp = { x: 29, y: r.y + r.h + 3 };
    lv.stairsDown = null;
    lv.startRoom = r;
    lv.bossSpot = { x: 29, y: r.y + 3 };
    return lv;
  }

  // ------------------------------------------------------------------------------------
  // Autotiling. Returns per-cell draw info: { base: 'void'|'floor', wall: key|null,
  // overlay: key|null, shadow: bool, floorKind } where keys are looked up in the theme.
  function autotile(lv) {
    const out = new Array(lv.w * lv.h);
    const S = (x, y) => isSolid(lv, x, y);
    const O = (x, y) => inb(lv, x, y) && isOpen(lv, x, y);
    const face = (x, y) => S(x, y) && O(x, y + 1);
    const cap = (x, y) => S(x, y) && face(x, y + 1);
    // free-standing pillars are drawn whole with the tower_block stamp, not autotiled
    const P = (x, y) => !!(lv.pillar && inb(lv, x, y) && lv.pillar[idx(lv, x, y)]);

    for (let y = 0; y < lv.h; y++) for (let x = 0; x < lv.w; x++) {
      const i = idx(lv, x, y);
      const info = { base: 'void', wall: null, overlay: null, shadow: false, floorKind: null };
      out[i] = info;
      if (O(x, y)) {
        info.base = 'floor';
        info.floorKind = lv.floorKind[i] || 'stone';
        if (S(x, y + 1) && !face(x, y + 1) && !P(x, y + 1)) {
          // ledge of the wall below, drawn at the bottom of this floor tile
          const b = wallKey(x, y + 1);
          info.overlay = b === 'innerNE' ? 'bandStepE' : b === 'innerNW' ? 'bandStepW' : 'band';
        }
        if (face(x, y - 1) && !P(x, y - 1)) info.shadow = true;
        continue;
      }
      const key = wallKey(x, y);
      info.wall = key;
      if (key && key !== 'void') {
        info.base = 'floor';
        info.floorKind = neighbourFloorKind(lv, x, y) || diagFloorKind(lv, x, y) || 'stone';
      }
    }
    return out;

    function wallKey(x, y) {
      const n = O(x, y - 1), s = O(x, y + 1), e = O(x + 1, y), w = O(x - 1, y);
      const ne = O(x + 1, y - 1), nw = O(x - 1, y - 1), se = O(x + 1, y + 1), sw = O(x - 1, y + 1);
      if (s) { // brick face
        if (e && !w) return 'faceEndE';
        if (w && !e) return 'faceEndW';
        return 'faceN';
      }
      if (face(x, y + 1)) { // cap above a face
        if (e && !w) return 'capCornerE';
        if (w && !e) return 'capCornerW';
        return 'capN';
      }
      if (n) {
        if (e && !w) return 'innerNE';
        if (w && !e) return 'innerNW';
        return 'botS';
      }
      if (e && !w) return (S(x, y + 1) && S(x + 1, y + 1) && !face(x + 1, y + 1)) ? 'sideWb' : 'sideW';
      if (w && !e) return (S(x, y + 1) && S(x - 1, y + 1) && !face(x - 1, y + 1)) ? 'sideEb' : 'sideE';
      if (se && face(x + 1, y)) return 'faceNW';
      if (sw && face(x - 1, y)) return 'faceNE';
      if (ne && !nw) return 'botSW';
      if (nw && !ne) return 'botSE';
      if (ne && nw) return 'botS';
      if (se && !sw) return 'faceNW';
      if (sw && !se) return 'faceNE';
      // two away: the cap at the top of a side wall
      if (cap(x + 1, y) && O(x + 1, y + 2)) return 'capNW';
      if (cap(x - 1, y) && O(x - 1, y + 2)) return 'capNE';
      return 'void';
    }
  }

  function diagFloorKind(lv, x, y) {
    for (const [dx, dy] of [[1, 1], [-1, 1], [1, -1], [-1, -1], [1, 2], [-1, 2]]) {
      const k = inb(lv, x + dx, y + dy) && lv.floorKind[idx(lv, x + dx, y + dy)];
      if (k) return k;
    }
    return null;
  }

  // Corner terrain for pit / water auto-tiling: a vertex is "special" if any of its 4
  // cells is. Returns "TL,TR,BR,BL" with terrain names.
  function cornerKey(lv, x, y, special, base) {
    const v = (vx, vy) => { // vertex at top-left of cell (vx,vy)
      for (const [dx, dy] of [[-1, -1], [0, -1], [-1, 0], [0, 0]]) {
        if (cellAt(lv, vx + dx, vy + dy) === special.cell) return special.name;
      }
      return base;
    };
    return [v(x, y), v(x + 1, y), v(x + 1, y + 1), v(x, y + 1)].join(',');
  }

  DG.MapGen = { generate, autotile, cornerKey, W, H, makeLevel, fixThinWalls, connected };
})(typeof window !== 'undefined' ? window : globalThis);
