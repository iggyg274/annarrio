/* level.js — one hand-built level: "A Stroll From The Diag To The Big House".
   Terrain uses Kenney tiles (18px grid); urban kit sprites are decoration layers only.
   Ann Arbor identity comes from text labels drawn over generic buildings (per ASSETS.md). */
(function () {
  var AA = (typeof window !== 'undefined' ? window : globalThis);

  var TILE = 18, COLS = 238, ROWS = 24;
  var G = 19; // ground surface row index

  // Tile-id classification (Kenney main kit ids)
  var SOLID = {};
  [0, 1, 2, 3, 20, 21, 22, 23, 40, 41, 42, 43, 60, 61, 62, 63, 80, 81, 82, 83,
   100, 101, 102, 103, 6, 12, 13, 14, 15, 16, 17, 18, 19, 10, 28, 49, 50, 94, 93
  ].forEach(function (id) { SOLID[id] = true; });
  var HAZARD = { 33: true, 34: true, 35: true }; // water surfaces

  function buildLevel() {
    var grid = new Int16Array(COLS * ROWS).fill(-1);
    function set(tx, ty, id) {
      if (tx >= 0 && tx < COLS && ty >= 0 && ty < ROWS) grid[ty * COLS + tx] = id;
    }
    function rect(x0, y0, x1, y1, id) {
      for (var y = y0; y <= y1; y++) for (var x = x0; x <= x1; x++) set(x, y, id);
    }
    function hash(a, b) { return ((a * 73 + b * 151) >>> 2) % 4; }

    // grass top + bordered strata + plain dirt below
    function ground(x0, x1, top) {
      for (var x = x0; x <= x1; x++) {
        set(x, top, [0, 1, 2, 3][hash(x, top)]);
        if (top + 1 < ROWS) set(x, top + 1, [40, 41, 42, 43][hash(x, top + 1)]);
        if (top + 2 < ROWS) set(x, top + 2, [60, 61, 62, 63][hash(x, top + 2)]);
        for (var y = top + 3; y < ROWS; y++) set(x, y, [100, 101, 102, 103][hash(x, y)]);
      }
    }
    function water(x0, x1) { // remove terrain, paint animated surface row
      for (var x = x0; x <= x1; x++) for (var y = G; y < ROWS; y++) set(x, y, -1);
      for (var x2 = x0; x2 <= x1; x2++) set(x2, G, [33, 34, 35][x2 % 3]);
    }

    var coins = [], enemies = [], pickups = [], decos = [], signs = [];
    var mystery = {}; // "tx,ty" -> 'coin' | 'heart' | 'goggles'

    function coinRow(x0, x1, ty) { for (var x = x0; x <= x1; x++) coins.push({ x: x * TILE + 9, y: ty * TILE + 9 }); }
    function coinArc(cx, topTy, n) {
      var span = n - 1;
      for (var i = 0; i < n; i++) {
        var t = span ? (i / span) * 2 - 1 : 0;
        coins.push({ x: cx * TILE + 9, y: (topTy + 3.2 * t * t) * TILE + 9 });
      }
    }
    function sign(tx, text, sub, style) { signs.push({ x: tx * TILE, y: G * TILE, text: text, sub: sub || '', style: style || 'board' }); }
    function paint(tx, ty, text, sub, big, lp) { signs.push({ x: tx * TILE, y: ty * TILE, text: text, sub: sub || '', style: 'paint', big: !!big, lp: lp || 1 }); }
    function deco(layer, urbanId, tx, scale, anchorRight) { decos.push({ layer: layer, id: urbanId, x: tx * TILE, y: G * TILE, scale: scale || 1, ar: !!anchorRight }); }

    // ============ SECTION A — THE DIAG (campus green) ======================
    ground(3, 40, G);
    sign(5.2, 'WELCOME TO ANN ARBOR', 'EST. 1824 · GO BLUE!');
    sign(9.6, 'THE DIAG', 'CENTRAL CAMPUS SINCE 1837');
    deco('fg', 68, 12.6, 0.65);           // park bench
    deco('fg', 3, 15.4, 1);               // potted plant (blue)
    deco('fg', 14, 16.2, 1);              // potted plant (red)
    deco('fg', 62, 19.2, 0.42);           // street lamp
    rect(23, G - 1, 23, G - 1, 16);       // hedge steps up
    rect(24, G - 2, 25, G - 1, 17);
    coinRow(23, 25, G - 4);
    set(27, G - 6, 10); mystery['27,' + (G - 6)] = 'coin';
    coinArc(30, G - 7, 5);
    enemies.push({ kind: 'rover', x: 34 * TILE, y: G * TILE });
    deco('fg', 67, 37.2, 0.7);            // trash can

    // ============ SECTION B — THE MYSTERY CUBE =============================
    ground(44, 62, G);
    rect(50, G - 3, 53, G - 1, 6);        // pedestal (brick)
    set(50, G - 4, 12); set(51, G - 4, 13); set(52, G - 4, 14); set(53, G - 4, 15);
    paint(51.6, G - 7, 'THE MYSTERY CUBE', 'NOBODY KNOWS WHAT IT MEANS');
    sign(45, 'WASHTENAW & MAIN', '');
    enemies.push({ kind: 'rover', x: 47 * TILE, y: G * TILE });
    enemies.push({ kind: 'grunt', x: 57 * TILE, y: G * TILE });
    rect(60, G - 4, 61, G - 1, 94);       // little blue pipe landmark
    coinRow(60, 61, G - 6);

    // pit 63..68 with a plank island
    rect(65, G - 4, 66, G - 4, 49);
    coinRow(65, 66, G - 6);

    // ============ SECTION C — STATE STREET =================================
    ground(69, 100, G);
    deco('back', 65, 71, 1);              // storefront strip (windows + door + awning)
    paint(78.2, G - 3.6, "ZANGERMAN'S DELI", 'SANDWICH QUEUE: ALWAYS', true);
    sign(69.6, 'STATE STREET', 'SHOPPING DISTRICT');
    set(75, G - 6, 10); mystery['75,' + (G - 6)] = 'coin';
    set(76, G - 6, 10); mystery['76,' + (G - 6)] = 'heart';
    set(77, G - 6, 10); mystery['77,' + (G - 6)] = 'goggles';
    coinRow(80, 83, G - 3);
    enemies.push({ kind: 'grunt', x: 82 * TILE, y: G * TILE });
    deco('fg', 66, 85.4, 0.65);           // red mailbox
    deco('fg', 62, 87.6, 0.42);           // lamp
    deco('fg', 68, 91.4, 0.65);           // bench
    enemies.push({ kind: 'rover', x: 95 * TILE, y: G * TILE });

    // pit 101..105 with a drone over it
    enemies.push({ kind: 'drone', x: 103 * TILE, y: (G - 4) * TILE, range: 2.6 * TILE, spd: 1.2 });

    // ============ SECTION D — BURTON TOWER =================================
    ground(106, 138, G);
    // climbable plank zig-zag toward a gem bonus
    rect(120, G - 4, 121, G - 4, 50);
    rect(124, G - 6, 125, G - 6, 50);
    rect(120, G - 8, 121, G - 8, 50);
    coinRow(120, 121, G - 6);
    coinRow(124, 125, G - 8);
    pickups.push({ kind: 'gem', x: 120.9 * TILE, y: (G - 10) * TILE });
    enemies.push({ kind: 'rover', x: 130 * TILE, y: G * TILE });
    enemies.push({ kind: 'grunt', x: 134 * TILE, y: G * TILE });

    // ============ SECTION E — HURON RIVER ===================================
    ground(139, 142, G);                  // left bank
    water(143, 165);                      // hazard!
    ground(166, COLS - 1, G);              // right bank
    rect(146, G - 2, 147, G - 2, 49);     // stepping stones
    rect(151, G - 3, 152, G - 3, 50);
    rect(156, G - 2, 157, G - 2, 49);
    rect(161, G - 3, 162, G - 3, 50);
    pickups.push({ kind: 'key', x: 156.9 * TILE, y: (G - 4) * TILE });
    coinRow(151, 152, G - 5);
    enemies.push({ kind: 'owl', x: 150 * TILE, y: (G - 5) * TILE, range: 3 * TILE, spd: 0.9 });
    enemies.push({ kind: 'bat', x: 160 * TILE, y: (G - 7) * TILE, range: 2.4 * TILE, spd: 1.5 });
    paint(154, G - 3.4, 'HURON RIVER', 'GALLUP PARK THIS WAY →');
    sign(140, 'WATCH YOUR STEP', '');

    // ============ SECTION F — THE BIG HOUSE =================================
    ground(166, COLS - 1, G);
    pickups.push({ kind: 'chest', x: 170 * TILE + 9, y: G * TILE });
    sign(170.5, 'PRIZE CHEST', 'REQUIRES A LITTLE GOLD KEY');
    enemies.push({ kind: 'rover', x: 178 * TILE, y: G * TILE });
    coinArc(182, G - 5, 5);
    rect(212, G - 2, 213, G - 1, 6);      // brick obstacle
    coinRow(212, 213, G - 4);
    enemies.push({ kind: 'rover', x: 190 * TILE, y: G * TILE });
    enemies.push({ kind: 'drone', x: 198 * TILE, y: (G - 5) * TILE, range: 2.6 * TILE, spd: 1.4 });
    enemies.push({ kind: 'grunt', x: 206 * TILE, y: G * TILE });
    coinRow(218, 223, G - 3);

    // ============ CHECKPOINT + GOAL =========================================
    var checkpoints = [{ x: 99 * TILE, y: G * TILE, px: 99 * TILE, py: (G - 2) * TILE }];
    var goal = { x: 228 * TILE, y: (G - 8) * TILE, w: 4 * TILE, h: 8 * TILE };

    // ============ DECOR LAYERS (parallax + foreground) ======================
    // 'far' p=0.35, 'mid' p=0.6, 'landmark' p=0.78 — see game.js draw order.
    deco('far', 72, 60, 0.8);             // cyan water tower
    [6, 30, 52, 84, 112, 146, 176, 208].forEach(function (tx, i) {
      deco('far', i % 2 ? 29 : 0, tx, i % 3 === 0 ? 0.9 : 0.7);
    });
    [14, 42, 74, 106, 134, 172, 214].forEach(function (tx) { deco('mid', 75, tx, 0.55); });
    // Burton Memorial Tower: stacked generic panels + drawn clock/dome in game.js
    decos.push({ layer: 'landmark', id: 63, x: 116 * TILE, y: G * TILE + 2, scale: 1 });
    decos.push({ layer: 'landmark', id: 64, x: 116 * TILE, y: (G - 8) * TILE, scale: 1 });
    paint(119.6, G - 13.2, 'BURTON MEMORIAL TOWER', 'CARILLON OF THE STAGES', false, 0.78);
    // Michigan Stadium facade: skyscraper bands + shingle blocks
    [0, 1, 2].forEach(function (i) { decos.push({ layer: 'landmark', id: 12, x: (186 + i * 5.6) * TILE, y: (G + 1) * TILE, scale: 1 }); });
    decos.push({ layer: 'landmark', id: 59, x: 183 * TILE, y: (G + 1) * TILE, scale: 0.9 });
    decos.push({ layer: 'landmark', id: 49, x: 204 * TILE, y: (G + 1) * TILE, scale: 0.9 });
    paint(196.5, G - 13.6, 'MICHIGAN STADIUM', 'THE BIG HOUSE · 107,601 ROWDY FANS', true, 0.78);

    return {
      TILE: TILE, COLS: COLS, ROWS: ROWS, GROUND_ROW: G,
      W: COLS * TILE, H: ROWS * TILE,
      grid: grid, SOLID: SOLID, HAZARD: HAZARD, mystery: mystery,
      coins: coins, enemies: enemies, pickups: pickups, decos: decos, signs: signs,
      checkpoints: checkpoints, goal: goal,
      spawn: { x: 4 * TILE, y: (G - 2) * TILE },
      burtonZone: { x0: 113 * TILE, x1: 121 * TILE },
      water: [{ x0: 143, x1: 165 }]
    };
  }

  AA.LEVEL = { buildLevel: buildLevel, TILE: TILE, SOLID: SOLID, HAZARD: HAZARD };
})();
