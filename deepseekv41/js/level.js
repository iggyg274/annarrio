/* level.js — the single playable level: a low-fi Ann Arbor, Michigan.
 *
 * Design notes (see ASSETS.md §3): neither asset pack contains real Ann Arbor
 * imagery, so every landmark reference is *text signage drawn over generic
 * sprites* — a storefront facade plus a painted-on sign, a stack of generic
 * building panels plus a "BURTON TOWER" label. No new pixel art is invented to
 * imitate a real building, and nothing here reproduces a trademarked logo.
 *
 * Collision geometry comes entirely from the Kenney kit (ASSETS.md §1a); the
 * urban tileset (© Dlou Saiyan) is used strictly as a decoration layer, and the
 * flagged sprites (id 70 billboard, ids 11/47/73/74/76 swatches) are never drawn.
 *
 * Tile values in the grid are raw Kenney tile indices (tile_NNNN.png), NOT the
 * Tiled gids from sprites/Tiled/*.tmx (those are offset by firstgid 28).
 */
(function (global) {
  'use strict';

  var AAB = global.AAB = global.AAB || {};
  var T = AAB.assets.TILE;      // 18 px world tile

  // ------------------------------------------------------ tile index vocabulary

  var tiles = {
    // NOTE: Kenney grass-top indices are 0..3, but index 0 doubles as this grid's
    // "empty" marker, so 0 is excluded from the random picker (1/2/3 are the same
    // block with different edge treatments). Using 0 here would carve holes.
    grass:      [1, 2, 3],                    // grass-top dirt block (primary ground surface)
    grassEdgeL: 1,
    grassEdgeR: 3,
    dirt:       [40, 41, 42, 43],             // bordered dirt fill under the grass row
    dirtAlt:    [60, 61, 62, 63],
    dirtTan:    [100, 101, 102, 103],         // plain tan/brown fill ("not water")
    sand:       [120, 121, 122, 123],         // borderless construction-lot fill
    brick:      6,                            // breakable-looking building brick
    hedge:      [16, 17, 18, 19],             // campus-quad hedge cube
    water:      [33, 34, 35],                 // light-blue water surface/wave-top
    wood:       [49, 50, 51, 52],             // plank/platform pieces
    coin:       151,                          // gold coin collectible
    gem:        67,                           // blue diamond gem
    mystery:    10,                           // gold chest w/ "!" — the Mario "?" block
    usedBlock:  11,
    heartFull:  44,
    flag:       111,                          // orange/red checkered flag (goal topper)
    signpost:   84,                           // wooden arrow signpost
    pipe:       94,                           // blue pipe/tank segment (Mario-pipe stand-in)
    manhole:    93,                           // big blue ring = manhole cover
    snowman:    145,                          // Ann Arbor winter easter egg
    cloud:      153
  };

  // Tiles the player collides with.
  var SOLID = {};
  [].concat(tiles.grass, tiles.dirt, tiles.dirtAlt, tiles.dirtTan, tiles.sand,
            tiles.hedge, tiles.wood, [tiles.brick]).forEach(function (n) { SOLID[n] = true; });
  // Index 0 is the grid's empty marker, never a tile — keep it out of SOLID.
  SOLID[0] = false;

  // Tiles that kill the player on contact.
  var WATER = {};
  tiles.water.forEach(function (n) { WATER[n] = true; });

  // ----------------------------------------------------------------- dimensions

  var W = 176;              // tiles wide  (3168 px)
  var H = 20;               // tiles tall  (360 px)
  var GROUND = 15;          // default ground surface row
  var FLOOR = H - 1;        // bottom row — always earth

  // ------------------------------------------------------------------ level data

  var L = {
    name: 'ANN ARBOR, MICHIGAN — LEVEL 1',
    widthTiles: W,
    heightTiles: H,
    widthPx: W * T,
    heightPx: H * T,
    groundRow: GROUND,
    spawn: { x: 3 * T, y: 12 * T },
    checkpoints: [{ x: 620, y: 12 * T }, { x: 1780, y: 12 * T }],
    goal: { x: 166 * T, poleTopY: 6 * T, flagTile: tiles.flag },
    tiles: null,        // number[H][W], 0 = empty
    props: [],          // decoration sprites (urban tileset + Kenney kit props)
    buildings: [],      // parallax skyline (urban sprites, decoration only)
    labels: [],         // on-canvas Ann Arbor text signage
    coins: [],
    enemies: [],
    mysteryBlocks: []
  };

  // --------------------------------------------------------------- tile helpers

  function pick(list, x, y) {
    var h = (x * 73856093 ^ y * 19349663) >>> 0;
    return list[h % list.length];
  }

  function put(x, y, v) {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    L.tiles[y * W + x] = v;
  }

  function clear(x, y) { put(x, y, 0); }

  /** Solid ground slab: grass surface row + bordered earth fill down to the floor. */
  function ground(x0, x1, top, fillKind) {
    for (var x = x0; x <= x1; x++) {
      var topTile = (x === x0) ? tiles.grassEdgeL
                  : (x === x1) ? tiles.grassEdgeR
                  : pick(tiles.grass, x, top);
      put(x, top, topTile);
      for (var y = top + 1; y <= FLOOR; y++) {
        var fill = fillKind === 'sand' ? pick(tiles.sand, x, y)
                 : fillKind === 'tan' ? pick(tiles.dirtTan, x, y)
                 : (y === top + 1 ? pick(tiles.dirt, x, y) : pick(tiles.dirtAlt, x, y));
        put(x, y, fill);
      }
    }
  }

  /** Fill a rectangle with one tile value. */
  function rect(x0, y0, x1, y1, v) {
    for (var y = y0; y <= y1; y++) for (var x = x0; x <= x1; x++) put(x, y, v);
  }

  /** Clear a rectangle back to empty (carves pits). */
  function hole(x0, y0, x1, y1) {
    for (var y = y0; y <= y1; y++) for (var x = x0; x <= x1; x++) clear(x, y);
  }

  /** Floating plank platform. */
  function platform(x0, x1, y) { rect(x0, y, x1, y, tiles.wood[0]); }

  function hedgeRow(x0, x1, y) {
    for (var x = x0; x <= x1; x++) put(x, y, pick(tiles.hedge, x, y));
  }

  function waterRect(x0, y, x1, bottom) {
    for (var yy = y; yy <= bottom; yy++) {
      var shade = tiles.water[Math.min(tiles.water.length - 1, yy - y)];
      for (var xx = x0; xx <= x1; xx++) put(xx, yy, shade);
    }
  }

  // -------------------------------------------------------------- prop placement

  function prop(kind, x, groundTopRow, opts) {
    opts = opts || {};
    var p = { kind: kind, x: x, groundTopRow: groundTopRow };
    for (var k in opts) p[k] = opts[k];
    L.props.push(p);
    return p;
  }

  /** Urban prop by manifest id (ASSETS.md §2), 0.5 scale = half the 32px sheet cell. */
  function urbanProp(id, x, groundTopRow, opts) {
    opts = opts || {};
    opts.urbanId = id;
    opts.scale = opts.scale == null ? 0.5 : opts.scale;
    return prop('urban', x, groundTopRow, opts);
  }

  /** Parallax skyline building: decoration only, no collision. */
  function building(id, x, baselineY, opts) {
    opts = opts || {};
    var b = { urbanId: id, x: x, baselineY: baselineY, scale: opts.scale == null ? 0.5 : opts.scale,
              scroll: opts.scroll == null ? 0.42 : opts.scroll };
    L.buildings.push(b);
    return b;
  }

  function label(text, x, y, opts) {
    opts = opts || {};
    var lb = { text: text, x: x, y: y };
    for (var k in opts) lb[k] = opts[k];
    L.labels.push(lb);
    return lb;
  }

  function coin(x, y) { L.coins.push({ x: x, y: y, r: 9, kind: 'coin', taken: false }); }
  function gem(x, y) { L.coins.push({ x: x, y: y, r: 9, kind: 'gem', taken: false }); }

  function enemy(type, x, patrolFrom, patrolTo, opts) {
    opts = opts || {};
    L.enemies.push({
      type: type,
      x: x,
      patrolFrom: patrolFrom,
      patrolTo: patrolTo,
      baseY: opts.baseY == null ? null : opts.baseY,
      amp: opts.amp || 0,
      phase: opts.phase || 0
    });
  }

  function mystery(tx, ty, reward) {
    L.mysteryBlocks.push({ tx: tx, ty: ty, used: false, reward: reward || 'coin' });
  }

  // ------------------------------------------------------------------ build level

  function build() {
    L.tiles = new Array(W * H);
    for (var i = 0; i < L.tiles.length; i++) L.tiles[i] = 0;

    // ===================== §1 · HURON STREET (residential Ann Arbor) ===========
    ground(0, 29, 15);

    // a borderless construction-lot / dirt-lot section (ASSETS.md §1a sand fill)
    ground(30, 38, 15, 'sand');

    ground(39, 48, 15);

    // --- road-works pit in the street: a real jump ---
    hole(44, 15, 47, FLOOR);
    coin(44 * T + 9, 13 * T + 4);
    coin(45 * T + 9, 13 * T + 4);
    coin(46 * T + 9, 13 * T + 4);

    ground(49, 58, 15);

    // ===================== §2 · THE DIAG (campus quad) =========================
    ground(59, 92, 15);
    hedgeRow(60, 66, 14);
    hedgeRow(60, 66, 13);
    hedgeRow(85, 91, 14);

    // the Diag's leafy middle: a raised quad terrace you climb onto
    ground(74, 80, 13);
    hedgeRow(74, 80, 12);
    coin(75 * T + 9, 11 * T + 4);
    coin(77 * T + 9, 11 * T + 4);
    coin(79 * T + 9, 11 * T + 4);
    mystery(77, 9, 'gem');

    ground(93, 108, 15);

    // --- campus sidewalk gap you clear from a plank platform ---
    hole(101, 15, 104, FLOOR);
    platform(100, 105, 12);
    coin(101 * T + 9, 11 * T + 4);
    coin(103 * T + 9, 11 * T + 4);

    // ===================== §3 · STATE STREET (storefronts) =====================
    ground(109, 140, 15);

    // --- brick wall you hop over, with a mystery block floating above it ---
    rect(118, 12, 121, 14, tiles.brick);
    mystery(120, 9, 'coin');
    coin(118 * T + 9, 11 * T + 4);
    coin(120 * T + 9, 11 * T + 4);
    coin(122 * T + 9, 11 * T + 4);

    // --- deli stoop: a little raised shop entrance ---
    ground(127, 133, 14);
    rect(127, 13, 133, 13, tiles.brick);

    ground(134, 140, 15);

    // ===================== §4 · MICHIGAN STADIUM ===============================
    ground(141, 158, 15);

    // the stadium is a generic brick facade (ASSETS.md §3); low enough to hop over,
    // so the walk to the Big House is never blocked
    rect(160, 12, 165, 14, tiles.brick);
    coin(160 * T + 9, 11 * T + 4);
    coin(163 * T + 9, 11 * T + 4);

    // --- a Big-House-sized gap with one plank bridge ---
    ground(159, 178, 15);
    hole(170, 15, 174, FLOOR);
    platform(171, 173, 12);
    coin(172 * T + 9, 11 * T + 4);

    // ===================== §5 · HURON RIVER ====================================
    ground(179, 196, 15);

    // the river itself: a water hazard you cannot stand in
    hole(197, 15, 206, FLOOR);
    waterRect(197, 15, 206, FLOOR);

    // dock you walk onto, then floating planks across the water
    rect(197, 14, 198, 14, tiles.wood[0]);
    platform(201, 203, 12);
    coin(201 * T + 9, 11 * T + 4);
    coin(203 * T + 9, 11 * T + 4);

    ground(207, 228, 15);
    hedgeRow(212, 218, 14);

    // ===================== §6 · BURTON TOWER + TOWER GROUNDS ===================
    ground(229, 250, 15);
    hedgeRow(230, 236, 14);

    // the tower is stacked out of generic building panels (ASSETS.md §3 idea)
    rect(238, 11, 241, 14, tiles.brick);
    rect(238, 7, 241, 10, tiles.brick);
    coin(238 * T + 9, 6 * T + 4);
    coin(241 * T + 9, 6 * T + 4);

    ground(251, 272, 15);
    hedgeRow(251, 258, 14);
    platform(252, 254, 12);
    coin(253 * T + 9, 11 * T + 4);
    platform(256, 258, 10);
    coin(257 * T + 9, 9 * T + 4);

    // --- the final gap before the finish banner ---
    hole(264, 15, 267, FLOOR);
    platform(264, 267, 12);
    coin(265 * T + 9, 11 * T + 4);
    coin(267 * T + 9, 11 * T + 4);

    // ===================== §7 · GO BLUE PLAZA (goal) ===========================
    return L;
  }

  // ----------------------------------------------------- decoration (props etc.)

  function decorate() {
    // ---------------- urban street furniture / greenery (ASSETS.md §2 highlights)
    var trees   = [0, 29];      // large trees, full canopy
    var lamps   = [62];         // tall street lamp post
    var benches = [68];         // park bench — good near a "Diag" bench moment
    var bushes  = [2];          // small round bush
    var hedges  = [23];         // wide low hedge mound
    var mailboxes = [66];       // red USPS-style mailbox
    var cans    = [67];         // dark trash can
    var plants  = [3, 4, 14, 15, 21, 22];   // potted plants / topiary
    var topiary = [13, 24];     // conical topiary trees
    var poles   = [75];         // wooden utility pole

    var i;
    // Huron Street: residential street trees and lamps
    for (i = 0; i < 4; i++) urbanProp(trees[i % 2], 30 + i * 60, 15, { scale: 0.5 + (i % 2) * 0.06 });
    urbanProp(lamps[0], 8 * T, 15);
    urbanProp(lamps[0], 21 * T, 15);
    urbanProp(bushes[0], 16 * T, 15);
    urbanProp(plants[0], 52 * T, 15);
    urbanProp(cans[0], 57 * T, 15);
    urbanProp(poles[0], 12 * T, 15);
    urbanProp(mailboxes[0], 36 * T, 15);

    // The Diag: benches, topiary, campus greenery
    urbanProp(benches[0], 62 * T, 15);
    urbanProp(benches[0], 88 * T, 15);
    urbanProp(topiary[0], 70 * T, 15);
    urbanProp(topiary[1], 83 * T, 15);
    urbanProp(bushes[0], 68 * T, 15);
    urbanProp(hedges[0], 90 * T, 15);
    urbanProp(trees[1], 96 * T, 15, { scale: 0.62 });
    urbanProp(lamps[0], 76 * T, 13);         // lamp on the raised terrace
    urbanProp(plants[1], 94 * T, 15);

    // State Street: storefront row + street furniture
    urbanProp(mailboxes[0], 112 * T, 15);
    urbanProp(cans[0], 117 * T, 15);
    urbanProp(benches[0], 126 * T, 15);
    urbanProp(plants[2], 135 * T, 15);
    urbanProp(lamps[0], 110 * T, 15);
    urbanProp(lamps[0], 138 * T, 15);
    urbanProp(bushes[0], 140 * T, 15);

    // Michigan Stadium approach: trees along the walk, a water-tank silhouette
    for (i = 0; i < 3; i++) urbanProp(trees[i % 2], 142 * T + i * 70, 15, { scale: 0.5 });
    urbanProp(benches[0], 152 * T, 15);
    urbanProp(lamps[0], 156 * T, 15);

    // Huron River: bank trees, dock-side props, a utility pole
    urbanProp(trees[1], 180 * T, 15, { scale: 0.66 });
    urbanProp(poles[0], 186 * T, 15);
    urbanProp(plants[3], 192 * T, 15);
    urbanProp(bushes[0], 196 * T, 15);

    // Burton Tower grounds: topiary + a snowman easter egg (Ann Arbor winter)
    urbanProp(topiary[0], 232 * T, 15);
    urbanProp(topiary[1], 246 * T, 15);
    urbanProp(hedges[0], 250 * T, 15);
    urbanProp(benches[0], 256 * T, 15);
    urbanProp(trees[0], 260 * T, 15, { scale: 0.7 });

    // GO BLUE plaza: lamps and a final bench
    urbanProp(lamps[0], 270 * T, 15);
    urbanProp(benches[0], 274 * T, 15);
    urbanProp(trees[0], 280 * T, 15, { scale: 0.72 });
    urbanProp(topiary[1], 288 * T, 15);

    // ---------------- Kenney kit props (world tiles used as objects) ----------------
    // Mario-pipe-style stand-in: the blue pipe/tank segment, solid + hoppable
    prop('pipe', 24 * T, 15, { solid: true, w: 3 * T, h: 6 * T });
    prop('pipe', 137 * T, 15, { solid: true, w: 3 * T, h: 4 * T });

    // manhole cover / drain in the street (ASSETS.md §1a id 93)
    prop('manhole', 50 * T, 15);

    // wooden signposts double as Ann Arbor signage posts
    prop('signpost', 60 * T, 15, { solid: true, w: T, h: 2 * T });
    prop('signpost', 109 * T, 15, { solid: true, w: T, h: 2 * T });
    prop('signpost', 229 * T, 15, { solid: true, w: T, h: 2 * T });

    // a winter easter egg on the river bank
    prop('snowman', 210 * T, 15);

    // ---------------- parallax skyline (urban building kit, decoration only) ------
    var BASE = 14 * T + 2;      // skyline sits just above the ground line
    building(12, 20, BASE, { scale: 0.55 });            // tall skyscraper facade strip
    building(55, 40, BASE, { scale: 0.5 });             // tall teal building side panel
    building(65, 120, BASE, { scale: 0.42 });           // storefront facade strip
    building(63, 300, BASE, { scale: 0.5 });
    building(64, 420, BASE, { scale: 0.5 });
    building(72, 560, BASE, { scale: 0.5 });            // cyan water tower tank
    building(12, 700, BASE, { scale: 0.5 });
    building(55, 820, BASE, { scale: 0.48 });
    building(65, 900, BASE, { scale: 0.4 });
    building(75, 1040, BASE, { scale: 0.6 });           // wooden utility pole
    building(63, 1160, BASE, { scale: 0.5 });
    building(64, 1280, BASE, { scale: 0.5 });
    building(12, 1400, BASE, { scale: 0.5 });
    building(55, 1520, BASE, { scale: 0.46 });
    building(72, 1640, BASE, { scale: 0.5 });
    building(65, 1720, BASE, { scale: 0.4 });
    building(63, 1880, BASE, { scale: 0.5 });
    building(64, 2020, BASE, { scale: 0.5 });
    building(75, 2160, BASE, { scale: 0.6 });
    building(12, 2300, BASE, { scale: 0.52 });
    building(55, 2480, BASE, { scale: 0.48 });
    building(65, 2560, BASE, { scale: 0.42 });
    building(72, 2680, BASE, { scale: 0.5 });
    building(63, 2820, BASE, { scale: 0.5 });
    building(64, 2960, BASE, { scale: 0.5 });
    building(12, 3040, BASE, { scale: 0.5 });

    // ---------------- on-canvas Ann Arbor signage (ASSETS.md §3) -----------------
    label('WELCOME TO ANN ARBOR', 4 * T, 10 * T, { size: 13, color: '#ffe08a', scroll: 1 });
    label('HURON STREET', 12 * T, 12 * T, { size: 10, color: '#ffdca8', scroll: 1 });
    label('MAIZE & BLUE COFFEE', 20 * T, 12 * T, { size: 10, color: '#ffdca8', scroll: 1 });
    label('THE DIAG', 64 * T, 7 * T, { size: 15, color: '#fff1c1', scroll: 0.42 });
    label('LAW QUAD →', 92 * T, 12 * T, { size: 10, color: '#ffdca8', scroll: 1 });
    label('STATE STREET', 112 * T, 12 * T, { size: 11, color: '#ffdca8', scroll: 1 });
    label('FARMER’S MARKET', 96 * T, 6 * T, { size: 12, color: '#fff1c1', scroll: 0.42 });
    label('MICHIGAN STADIUM', 160 * T, 8 * T, { size: 14, color: '#fff1c1', scroll: 1 });
    label('BIG HOUSE', 160 * T, 6 * T, { size: 12, color: '#ffe08a', scroll: 1 });
    label('HURON RIVER', 184 * T, 13 * T, { size: 12, color: '#9fe4ff', scroll: 1 });
    label('BURTON TOWER', 238 * T, 5 * T, { size: 14, color: '#fff1c1', scroll: 1 });
    label('GO BLUE PLAZA', 268 * T, 13 * T, { size: 12, color: '#ffe08a', scroll: 1 });
    label('GO BLUE!', 172 * T, 12 * T, { size: 12, color: '#ffe08a', scroll: 1 });
    label('CAMPUS — 2 MI', 148 * T, 12 * T, { size: 10, color: '#ffdca8', scroll: 1 });
    label('NO PARKING 2AM–6AM', 30 * T, 6 * T, { size: 10, color: '#ff9b8a', scroll: 0.42 });
    label('LOW-FI SIGNAGE — PARODY ONLY', 4 * T, 4 * T, { size: 9, color: '#cfe4f7', scroll: 0.42 });

    // ---------------- clouds (Kenney background fill, parallax) -------------------
    for (i = 0; i < 7; i++) {
      prop('cloud', 40 + i * 460, 0, { cloudY: 14 + (i % 3) * 22, scroll: 0.3, tileIndex: tiles.cloud });
    }

    // ---------------- collectibles ----------------------------------------------
    // street coins
    coin(6 * T + 9, 13 * T + 4);
    coin(9 * T + 9, 13 * T + 4);
    coin(14 * T + 9, 13 * T + 4);
    coin(16 * T + 9, 13 * T + 4);
    coin(24 * T + 9, 13 * T + 4);
    coin(26 * T + 9, 12 * T + 4);
    coin(34 * T + 9, 13 * T + 4);
    coin(40 * T + 9, 13 * T + 4);
    coin(52 * T + 9, 12 * T + 4);
    coin(56 * T + 9, 13 * T + 4);

    // Diag coins on the terrace + hedge tops
    coin(66 * T + 9, 12 * T + 4);
    coin(72 * T + 9, 12 * T + 4);
    gem(80 * T + 9, 12 * T + 4);
    coin(86 * T + 9, 13 * T + 4);

    // sidewalk gap + State Street
    coin(105 * T + 9, 11 * T + 4);
    coin(110 * T + 9, 13 * T + 4);
    coin(116 * T + 9, 13 * T + 4);
    coin(124 * T + 9, 13 * T + 4);
    coin(128 * T + 9, 12 * T + 4);
    coin(131 * T + 9, 12 * T + 4);
    gem(133 * T + 9, 11 * T + 4);

    // stadium walk
    coin(144 * T + 9, 13 * T + 4);
    coin(150 * T + 9, 13 * T + 4);
    coin(156 * T + 9, 12 * T + 4);
    coin(166 * T + 9, 13 * T + 4);
    coin(175 * T + 9, 13 * T + 4);
    coin(178 * T + 9, 12 * T + 4);

    // river bank + far side
    coin(188 * T + 9, 13 * T + 4);
    coin(194 * T + 9, 13 * T + 4);
    coin(208 * T + 9, 13 * T + 4);
    coin(214 * T + 9, 13 * T + 4);
    coin(220 * T + 9, 12 * T + 4);
    coin(226 * T + 9, 13 * T + 4);

    // tower grounds + plaza
    coin(236 * T + 9, 13 * T + 4);
    coin(244 * T + 9, 13 * T + 4);
    coin(262 * T + 9, 13 * T + 4);
    coin(270 * T + 9, 13 * T + 4);
    coin(272 * T + 9, 12 * T + 4);

    // ---------------- enemies ---------------------------------------------------
    // rovers patrol the ground (the Goomba role); drones fly overhead
    enemy('rover', 13 * T, 10 * T, 18 * T);
    enemy('rover', 33 * T, 30 * T, 37 * T);
    enemy('rover', 62 * T, 59 * T, 68 * T);
    enemy('rover', 90 * T, 86 * T, 92 * T);
    enemy('rover', 112 * T, 109 * T, 116 * T);
    enemy('rover', 131 * T, 127 * T, 138 * T);
    enemy('rover', 150 * T, 141 * T, 157 * T);
    enemy('rover', 186 * T, 179 * T, 195 * T);
    enemy('rover', 215 * T, 207 * T, 227 * T);
    enemy('rover', 245 * T, 229 * T, 250 * T);

    enemy('drone', 46 * T, 44 * T, 48 * T, { baseY: 11 * T, amp: 1.5 * T, phase: 0 });
    enemy('drone', 78 * T, 74 * T, 82 * T, { baseY: 8 * T, amp: 1.2 * T, phase: 1.4 });
    enemy('drone', 103 * T, 100 * T, 106 * T, { baseY: 9 * T, amp: 1.0 * T, phase: 2.2 });
    enemy('drone', 121 * T, 118 * T, 124 * T, { baseY: 7 * T, amp: 1.4 * T, phase: 3.1 });
    enemy('drone', 172 * T, 170 * T, 174 * T, { baseY: 9 * T, amp: 1.3 * T, phase: 0.7 });
    enemy('drone', 202 * T, 197 * T, 207 * T, { baseY: 8 * T, amp: 1.6 * T, phase: 2.6 });
    enemy('drone', 266 * T, 264 * T, 268 * T, { baseY: 9 * T, amp: 1.2 * T, phase: 4.0 });
  }

  function buildAll() {
    build();
    decorate();
    return L;
  }

  AAB.level = {
    TILES: tiles,
    SOLID: SOLID,
    WATER: WATER,
    W: W,
    H: H,
    GROUND: GROUND,
    FLOOR: FLOOR,
    build: buildAll,
    data: null
  };
})(window);
