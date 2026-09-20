// level.js — the single Ann Arbor level, built with small helper functions.
// Coordinates in the builders are TILE units (18px). All collidable geometry
// comes from the Kenney kit; the urban tileset is decoration only.
(function () {
  'use strict';

  const T = 18;
  const W = 252, H = 22;
  const G = 17; // default ground surface row

  // Urban tileset rectangles (from manifest/urban_tileset_manifest.json), only the ids we use.
  const URBAN = {
    0:  { x: 9,   y: 12,  w: 208, h: 182 }, // big tree
    2:  { x: 258, y: 1,   w: 29,  h: 39 },  // small bush
    3:  { x: 293, y: 10,  w: 18,  h: 29 },  // potted plant blue
    10: { x: 542, y: 0,   w: 132, h: 66 },  // glass entrance strip
    12: { x: 894, y: 0,   w: 100, h: 276 }, // skyscraper facade
    13: { x: 257, y: 82,  w: 30,  h: 55 },  // topiary
    14: { x: 293, y: 74,  w: 18,  h: 29 },  // potted plant red
    17: { x: 399, y: 87,  w: 66,  h: 13 },  // low hedge strip
    18: { x: 488, y: 94,  w: 112, h: 68 },  // office window
    19: { x: 616, y: 94,  w: 112, h: 68 },  // office window variant
    23: { x: 351, y: 145, w: 34,  h: 20 },  // hedge mound
    26: { x: 510, y: 190, w: 68,  h: 68 },  // glare window square
    29: { x: 9,   y: 236, w: 208, h: 182 }, // big tree variant
    33: { x: 894, y: 286, w: 100, h: 14 },  // thin railing
    39: { x: 382, y: 350, w: 228, h: 42 },  // long red band
    46: { x: 351, y: 414, w: 163, h: 39 },  // rooftop vent fans
    55: { x: 223, y: 478, w: 131, h: 172 }, // teal side wall
    56: { x: 382, y: 510, w: 100, h: 36 },  // blue trim strip
    62: { x: 995, y: 625, w: 25,  h: 289 }, // street lamp
    63: { x: 382, y: 670, w: 68,  h: 142 }, // gray side panel A
    64: { x: 478, y: 670, w: 68,  h: 142 }, // gray side panel B
    65: { x: 734, y: 670, w: 260, h: 100 }, // storefront strip
    66: { x: 576, y: 698, w: 32,  h: 45 },  // red mailbox
    67: { x: 610, y: 704, w: 28,  h: 38 },  // trash can
    68: { x: 643, y: 716, w: 58,  h: 25 },  // park bench
    70: { x: 702, y: 798, w: 132, h: 132 }, // artist billboard — CREDITS SCREEN ONLY
    72: { x: 190, y: 809, w: 164, h: 121 }, // water tower
    75: { x: 513, y: 830, w: 94,  h: 100 }, // utility pole
  };

  // Tile flags
  const SOLID = 1, ONEWAY = 2, WATER = 4, QBLOCK = 8, BRICK = 16;

  const tiles = new Int16Array(W * H).fill(-1);
  const flags = new Uint8Array(W * H);
  const gmask = new Uint8Array(W * H); // ground kind: 0 none, 1 grass, 2 sand, 3 snow ; +16 = top row
  const decor = [];      // {id, x, y, s, layer}  layer: 'mid' (parallax), 'near' (behind tiles), 'front'
  const labels = [];     // {text, x, y, size, color, layer, bg, sub}
  const coins = [];      // {x, y, gem}
  const enemies = [];    // {type, x, y, x0, x1, ...}
  const signs = [];      // {x, y, text, tile}
  const checkpoints = [];// {x, y}
  const triggers = [];   // {x0, x1, y0, y1, id}
  const props = [];      // kenney tiles drawn as pure decoration (no collision) {t, x, y, s}
  const rects = [];      // hand drawn shapes {kind, x, y, w, h, color, ...}
  const moods = [];      // {x, mood, name}

  const idx = (x, y) => y * W + x;
  const inb = (x, y) => x >= 0 && x < W && y >= 0 && y < H;
  function set(x, y, t, f) { if (!inb(x, y)) return; tiles[idx(x, y)] = t; flags[idx(x, y)] = f || 0; }

  // ---- builders ---------------------------------------------------------
  function ground(x0, x1, top, kind) {
    const k = kind === 'sand' ? 2 : kind === 'snow' ? 3 : 1;
    for (let x = x0; x <= x1; x++) {
      for (let y = top; y < H; y++) {
        gmask[idx(x, y)] = k + (y === top ? 16 : 0);
        flags[idx(x, y)] = SOLID;
      }
    }
  }
  // 1-tile-thick floating grass block row (bordered tiles)
  function block(x0, x1, y, kind) {
    const k = kind === 'sand' ? 2 : kind === 'snow' ? 3 : 1;
    for (let x = x0; x <= x1; x++) { gmask[idx(x, y)] = k + 16; flags[idx(x, y)] = SOLID; }
  }
  function plank(x0, x1, y, posts) {
    for (let x = x0; x <= x1; x++) {
      const t = x0 === x1 ? 91 : x === x0 ? 90 : x === x1 ? 92 : 91;
      set(x, y, t, ONEWAY);
    }
    if (posts) { // decorative posts from below the plank down to `posts` row (exclusive)
      for (const x of [x0, x1]) for (let py = y + 1; py < posts; py++) props.push({ t: 89, x: x * T, y: py * T });
    }
  }
  function hedge(x0, x1, y0, y1) {
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
      let t;
      const L = x === x0, R = x === x1, Tp = y === y0, B = y === y1;
      if (x0 === x1 && y0 === y1) t = 16;
      else if (Tp) t = L ? 17 : R ? 19 : 18;
      else if (B) t = L ? 57 : R ? 59 : 58;
      else t = L ? 37 : R ? 39 : 38;
      set(x, y, t, SOLID);
    }
  }
  function brick(x, y) { set(x, y, 6, SOLID | BRICK); }
  function qblock(x, y) { set(x, y, 10, SOLID | QBLOCK); }
  function water(x0, x1, top) {
    for (let x = x0; x <= x1; x++) for (let y = top; y < H; y++) set(x, y, y === top ? 33 : 73, WATER);
  }
  function coin(x, y) { coins.push({ x: x * T + 9, y: y * T + 9, gem: false }); }
  function gem(x, y) { coins.push({ x: x * T + 9, y: y * T + 9, gem: true }); }
  function coinRow(x0, x1, y) { for (let x = x0; x <= x1; x++) coin(x, y); }
  function coinArc(x0, y, n) { // little arch of coins
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      coin(x0 + i, y - Math.round(Math.sin(t * Math.PI) * 2));
    }
  }
  function enemy(type, x, y, x0, x1, extra) {
    enemies.push(Object.assign({ type, x: x * T, y: y * T, x0: x0 * T, x1: x1 * T }, extra || {}));
  }
  function sign(x, y, text, tile) { signs.push({ x: x * T, y: y * T, text, tile: tile === undefined ? 86 : tile }); }
  function checkpoint(x, y) { checkpoints.push({ x: x * T, y: y * T }); }
  function trigger(id, x0, x1, y0, y1) { triggers.push({ id, x0: x0 * T, x1: (x1 + 1) * T, y0: y0 * T, y1: (y1 + 1) * T }); }
  // urban decor; (x,y) is the BOTTOM-LEFT corner in tile units (y = surface row) unless yPix given
  function urban(id, x, yRow, s, layer, yOff) {
    const r = URBAN[id];
    decor.push({ id, x: x * T, y: yRow * T - r.h * s + (yOff || 0), s, layer: layer || 'near' });
  }
  function label(text, x, y, o) { labels.push(Object.assign({ text, x: x * T, y: y * T, size: 10, color: '#fff', layer: 'near' }, o || {})); }
  function prop(t, x, y, s) { props.push({ t, x: x * T, y: y * T, s: s || 1 }); }
  function tree(x, y) { prop(97, x, y - 2); prop(117, x, y - 1); prop(137, x, y); } // 3-tall kenney tree, base at row y
  function mood(x, m, name) { moods.push({ x: x * T, mood: m, name }); }

  // =====================================================================
  //  SECTION A — Ann Arbor Amtrak depot / start  (x 0–34)
  // =====================================================================
  mood(0, 0, 'DEPOT STREET');
  ground(0, 34, G);
  urban(65, 3, G, 0.5);                      // storefront as the train depot
  label('ANN ARBOR DEPOT', 3.2, G - 3.4, { size: 8, bg: '#1b3a6b', color: '#ffcb05', pad: 3 });
  urban(62, 15, G, 0.4);                     // lamp
  urban(66, 16.2, G, 0.5);                   // mailbox
  urban(3, 13.5, G, 0.6);
  sign(11.3, G - 1, 'WELCOME TO ANN ARBOR');
  coinArc(12, G - 3, 5);
  brick(18, 13); qblock(19, 13); brick(20, 13);
  enemy('squirrel', 25, G - 1, 22, 31);
  coinRow(24, 27, G - 4);
  urban(67, 29, G, 0.5);
  sign(32, G - 1, 'STATE ST  →', 87);
  prop(153, 6, 3); prop(154, 7, 3); prop(155, 8, 3);

  // =====================================================================
  //  SECTION B — State Street  (x 35–75)
  // =====================================================================
  mood(35, 0, 'STATE STREET');
  ground(35, 48, G);
  ground(51, 62, G);
  ground(66, 75, G);
  // shops (urban storefront strip + painted signs)
  urban(65, 36, G, 0.5);
  label("ZINGERBERG'S DELI", 36.4, G - 3.4, { size: 8, bg: '#8b1a1a', color: '#fff', pad: 3 });
  urban(65, 52, G, 0.5);
  label('BLIMPO BURGER', 52.4, G - 3.4, { size: 8, bg: '#e0621a', color: '#fff', pad: 3 });
  urban(10, 67, G, 0.5);
  urban(26, 67, G - 1.9, 0.5); urban(26, 68.9, G - 1.9, 0.5);
  rects.push({ kind: 'marquee', x: 66.6 * T, y: (G - 5.7) * T, w: 76, h: 26, text: 'MICHIGAN THEATER', sub: 'NOW SHOWING: THIS GAME' });
  // street furniture
  urban(62, 45, G, 0.4); urban(62, 61, G, 0.4);
  urban(68, 42, G, 0.5); urban(14, 41.2, G, 0.6);
  urban(67, 57, G, 0.5); urban(3, 58.6, G, 0.6);
  urban(66, 72, G, 0.5); urban(13, 73.3, G, 0.6);
  rects.push({ kind: 'streetsign', x: 34.3 * T, y: (G - 4) * T, text: 'STATE ST' });
  // platforms / blocks
  brick(45, 12); qblock(46, 12); qblock(47, 12); brick(48, 12);
  coinArc(48, G - 3, 4);
  coinArc(63, 14, 3);
  brick(57, 12); brick(58, 12); brick(59, 12);
  coinRow(57, 59, 10);
  qblock(70, 13);
  // enemies
  enemy('parkbot', 44, G - 1, 37, 47);
  enemy('parkbot', 56, G - 1, 52, 61);
  enemy('squirrel', 70, G - 1, 67, 74);
  sign(74, G - 1, 'THE DIAG  →', 87);
  prop(153, 40, 2); prop(154, 41, 2); prop(154, 42, 2); prop(155, 43, 2);
  prop(153, 60, 4); prop(155, 61, 4);

  // =====================================================================
  //  SECTION C — The Diag  (x 76–108)
  // =====================================================================
  mood(76, 1, 'THE DIAG');
  ground(76, 108, G);
  urban(0, 76, G, 0.5);
  urban(29, 94, G, 0.5);
  urban(0, 103, G, 0.5);
  label('THE DIAG', 84, 11.3, { size: 16, color: '#ffcb05', outline: '#00274c', bg: null });
  label('please keep off the M', 85, 12.5, { size: 7, color: '#00274c', bg: null });
  hedge(80, 83, 15, 16);
  hedge(90, 93, 14, 16);
  hedge(100, 102, 15, 16);
  urban(68, 86, G, 0.5);
  urban(68, 97, G, 0.5);
  tree(89, G - 1); tree(99, G - 1);
  // the block M painted on the ground at 87..88
  rects.push({ kind: 'blockM', x: 87 * T, y: G * T });
  trigger('steppedM', 87, 88, G - 1, G - 1);
  coinArc(85, G - 4, 5);          // arch over the M — jump it!
  coinRow(80, 83, 13);
  coinRow(90, 93, 12);
  gem(92, 10);
  qblock(96, 13);
  prop(150, 96, G - 1, 0.5);      // fairy door at the tree base
  labels.push({ text: 'fairy door', x: 96 * T - 6, y: (G - 1) * T - 2, size: 5, color: '#5a3d2b', bg: null, layer: 'near' });
  enemy('squirrel', 84, G - 1, 84, 88);
  enemy('squirrel', 98, G - 1, 95, 104);
  enemy('bat', 92, 11, 88, 97);
  checkpoint(105.5, G - 1);
  sign(108, G - 1, 'BURTON TOWER  ↑', 87);
  prop(153, 96, 3); prop(154, 97, 3); prop(155, 98, 3);

  // =====================================================================
  //  SECTION D — Burton Tower / Ingalls Mall  (x 109–135)
  // =====================================================================
  mood(109, 2, 'INGALLS MALL');
  ground(109, 135, G);
  // the tower (background art) + brick rooftop you can stand on
  urban(12, 117, G, 0.7);                       // ~70px wide, ~193px tall, top at row ~6.3
  rects.push({ kind: 'belfry', x: 117 * T, y: 6 * T - 40, w: 70, h: 40 });
  for (let x = 115; x <= 124; x++) brick(x, 6);
  label('BURTON TOWER', 121.5, 8.5, { size: 10, color: '#fff', bg: '#00274c', pad: 3 });
  label('carillon • 53 bells', 121.6, 9.6, { size: 6, color: '#ffcb05', bg: null });
  // climb
  plank(110, 112, 14);
  plank(113, 115, 11);
  plank(110, 112, 8);
  coinRow(110, 112, 13); coinRow(113, 115, 10); coinRow(110, 112, 7);
  gem(119, 4); gem(120, 3); gem(121, 4);
  prop(144, 117, 5); prop(145, 123, 5);         // "it is always winter up here" snowman
  labels.push({ text: 'always winter up here', x: 118 * T, y: 3 * T, size: 5, color: '#00274c', bg: null, layer: 'near' });
  // way down
  plank(127, 129, 10);
  plank(131, 133, 13);
  coinRow(127, 129, 9); coinRow(131, 133, 12);
  enemy('bat', 114, 12, 110, 120);
  enemy('drone', 126, 2, 118, 134);
  // Ingalls Mall greenery
  hedge(112, 113, 16, 16); hedge(128, 130, 16, 16);
  urban(68, 121, G, 0.5); urban(23, 125, G, 0.5); urban(13, 133, G, 0.6);
  urban(62, 115, G, 0.4);
  label('INGALLS MALL', 118, G - 1.4, { size: 6, color: '#fff', bg: '#00274c', pad: 2 });
  sign(134, G - 1, 'HURON RIVER  →', 87);

  // =====================================================================
  //  SECTION E — Huron River / Argo Cascades  (x 136–170)
  // =====================================================================
  mood(136, 3, 'ARGO CASCADES');
  ground(136, 141, G);
  urban(65, 136, G, 0.5);
  label('ARGO CANOE & TUBE RENTAL', 136.3, G - 3.4, { size: 7, bg: '#0b6e4f', color: '#fff', pad: 3 });
  water(142, 168, G + 2);
  labels.push({ text: 'HURON RIVER', x: 150 * T, y: (G + 3.6) * T, size: 12, color: 'rgba(255,255,255,0.75)', bg: null, layer: 'front' });
  // hop across
  block(144, 145, G);
  plank(148, 150, 15, G + 2);
  block(153, 155, 16);
  plank(157, 159, 14, G + 2);
  plank(156, 157, 11);
  block(162, 164, G);
  plank(166, 167, 15, G + 2);
  ground(169, 176, G);
  coinArc(146, 14, 3); coinRow(148, 150, 13); coinArc(151, 14, 3);
  coinRow(157, 159, 12); gem(156, 9); gem(157, 9);
  coinArc(160, 14, 3); coinRow(166, 167, 13);
  enemy('bat', 151, 10, 146, 156);
  enemy('bat', 161, 9, 158, 166);
  urban(62, 139, G, 0.4);
  prop(153, 150, 3); prop(154, 151, 3); prop(155, 152, 3);
  prop(153, 165, 5); prop(155, 166, 5);

  // =====================================================================
  //  SECTION F — Nichols Arboretum, "The Arb"  (x 169–206)
  // =====================================================================
  mood(169, 4, 'THE ARB');
  checkpoint(170, G - 1);
  sign(173.5, G - 1, 'NICHOLS ARBORETUM', 86);
  ground(177, 182, G - 2);
  ground(183, 187, G - 4);
  ground(188, 192, G - 2);
  ground(193, 206, G);
  label('THE ARB', 176, 12.3, { size: 16, color: '#ffcb05', outline: '#00274c', bg: null });
  label('Nichols Arboretum est. 1907', 176, 13.6, { size: 6, color: '#fff', outline: '#00274c', bg: null });
  urban(29, 169, G, 0.55, 'near');
  urban(0, 178, G - 2, 0.55, 'near');
  urban(29, 186, G - 4, 0.55, 'near');
  urban(0, 195, G, 0.55, 'near');
  urban(29, 202, G, 0.5, 'near');
  tree(175, G - 1); tree(191, G - 3); tree(200, G - 1);
  hedge(198, 201, 15, 16);
  label('PEONY GARDEN', 197.5, 14, { size: 6, color: '#fff', bg: '#b03060', pad: 2 });
  urban(2, 204, G, 0.6); urban(23, 174, G, 0.5);
  coinArc(177, G - 5, 6); coinRow(183, 187, G - 6); coinArc(188, G - 5, 5);
  plank(184, 186, G - 7);
  gem(185, G - 9);
  coinRow(196, 203, 13);
  enemy('squirrel', 174, G - 1, 170, 176);
  enemy('squirrel', 185, G - 5, 183, 187);
  enemy('drone', 190, 6, 176, 196);
  enemy('squirrel', 199, G - 1, 194, 205);
  qblock(194, 12);
  sign(205, G - 1, 'THE BIG HOUSE  →', 87);
  prop(153, 180, 2); prop(154, 181, 2); prop(155, 182, 2);
  prop(153, 199, 4); prop(154, 200, 4); prop(155, 201, 4);

  // =====================================================================
  //  SECTION G — Michigan Stadium, "The Big House"  (x 207–251)
  // =====================================================================
  mood(207, 5, 'THE BIG HOUSE');
  ground(207, 251, G);
  // stadium facade: two rows of office-window units + trim + red band + entrance
  for (let i = 0; i < 8; i++) {
    urban(i % 2 ? 19 : 18, 213 + i * 3.11, G, 0.5);
    urban(i % 2 ? 18 : 19, 213 + i * 3.11, G - 1.9, 0.5);
  }
  for (let i = 0; i < 9; i++) urban(56, 213 + i * 2.78, G - 3.75, 0.5);
  urban(39, 219, G - 4.75, 0.5); urban(39, 225.4, G - 4.75, 0.5);
  urban(46, 222, G - 5.9, 0.5);
  urban(10, 221.5, G, 0.5);
  label('MICHIGAN STADIUM', 219.6, G - 4.95, { size: 11, color: '#ffcb05', bg: '#00274c', pad: 4 });
  label('THE BIG HOUSE  •  capacity 107,601', 220.3, G - 6.1, { size: 6, color: '#fff', bg: '#00274c', pad: 2 });
  urban(62, 210, G, 0.4); urban(62, 238, G, 0.4);
  urban(66, 211.5, G, 0.5); urban(67, 236.5, G, 0.5);
  // final gauntlet
  brick(215, 13); qblock(216, 13); qblock(217, 13); brick(218, 13);
  enemy('parkbot', 212, G - 1, 208, 219);
  enemy('parkbot', 228, G - 1, 222, 234);
  enemy('squirrel', 231, G - 1, 226, 236);
  // coins in the shape of a block M
  const M = ['X...X', 'XX.XX', 'X.X.X', 'X...X'];
  M.forEach((row, ry) => [...row].forEach((ch, rx) => { if (ch === 'X') coin(226 + rx, 9 + ry); }));
  hedge(238, 239, 16, 16);
  // goal flag
  const goalX = 244;
  rects.push({ kind: 'flagpole', x: goalX * T + 8, y: 8 * T, h: 9 * T });
  props.push({ t: 111, x: goalX * T + 10, y: 8 * T });
  label('GO BLUE!', 243.2, 6.5, { size: 10, color: '#ffcb05', bg: '#00274c', pad: 3 });
  urban(68, 247, G, 0.5);
  prop(153, 214, 2); prop(154, 215, 2); prop(155, 216, 2);
  prop(153, 240, 3); prop(154, 241, 3); prop(154, 242, 3); prop(155, 243, 3);

  // ---- resolve ground tiles from the mask (edge-aware) --------------------
  const TOP = { 1: 20, 2: 60, 3: 100 };      // grass/sand/snow top that continues downward
  const TOPB = { 1: 0, 2: 40, 3: 80 };       // bordered standalone top block
  const gAt = (x, y) => inb(x, y) ? gmask[idx(x, y)] & 15 : 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const m = gmask[idx(x, y)];
    if (!m) continue;
    const kind = m & 15, top = !!(m & 16);
    const L = gAt(x - 1, y) !== 0, R = gAt(x + 1, y) !== 0, B = gAt(x, y + 1) !== 0;
    const v = L && R ? 2 : L ? 3 : R ? 1 : 0;
    let base;
    if (top) base = B ? TOP[kind] : TOPB[kind];
    else base = B || y === H - 1 ? 120 : 140;
    tiles[idx(x, y)] = base + v;
    flags[idx(x, y)] = SOLID;
  }

  // ---- procedural mid-layer skyline (parallax) ------------------------------
  (function skyline() {
    let seed = 1234;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    let x = -60;
    const choices = [12, 55, 63, 64, 63, 12, 64, 55];
    while (x < W * T * 0.5 + 400) {
      const id = choices[Math.floor(rnd() * choices.length)];
      const r = URBAN[id];
      const s = 0.45 + rnd() * 0.25;
      decor.push({ id, x, y: G * T - r.h * s, s, layer: 'mid' });
      if (id === 63 || id === 64) {
        if (rnd() < 0.5) decor.push({ id: 72, x: x + 4, y: G * T - r.h * s - 121 * 0.35, s: 0.35, layer: 'mid' });
      }
      x += r.w * s + 10 + rnd() * 70;
      if (rnd() < 0.3) { decor.push({ id: 75, x, y: G * T - 100 * 0.6, s: 0.6, layer: 'mid' }); x += 40; }
    }
  })();

  window.LEVEL = {
    T, W, H, G, tiles, flags, decor, labels, coins, enemies, signs, checkpoints, triggers, props, rects, moods,
    URBAN, SOLID, ONEWAY, WATER, QBLOCK, BRICK,
    spawn: { x: 3 * T, y: (G - 2) * T },
    goalX: goalX * T + 8,
  };
})();
