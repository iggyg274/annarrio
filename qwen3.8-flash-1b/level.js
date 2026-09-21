/* level.js — one playable level: "DIAG DASH", an Ann Arbor sprint.
 * Pure data + generation (no DOM). The Kenney kit isn't in this workspace, so all
 * collidable geometry uses tiles drawn by art.js; scenery/landmarks come from the
 * urban city tileset via URBAN rects (art credit: Dlou Saiyan) plus on-canvas TEXT
 * labels, per ASSETS.md §3.
 */
(function (global) {
  'use strict';

  var TILE = 32;
  var COLS = 164;          /* world width in tiles = 5248 px */
  var ROWS = 17;           /* 544 px tall */
  var TOP = 14;            /* ground surface row */

  /* tile codes */
  var T_EMPTY = 0, T_CONC_TOP = 1, T_CONC_FILL = 2, T_BRICK_TOP = 3, T_BRICK_FILL = 4,
      T_GRASS_TOP = 5, T_DIRT = 6, T_HEDGE = 7, T_WOOD = 8, T_BRICKBLOCK = 9,
      T_MBLOCK = 10, T_USED = 11, T_STONE = 12;

  function makeLevel() {
    var grid = new Int16Array(COLS * ROWS);
    function set(tx, ty, v) {
      if (tx < 0 || tx >= COLS || ty < 0 || ty >= ROWS) return;
      grid[ty * COLS + tx] = v;
    }
    function span(x0, x1, ty, v) { for (var x = x0; x <= x1; x++) set(x, ty, v); }
    function ground(x0, x1, topRow, surface, fill) {
      for (var ty = topRow; ty < ROWS; ty++) {
        var v = (ty === topRow) ? surface : fill;
        span(x0, x1, ty, v);
      }
    }
    function pit(x0, x1) {
      for (var ty = 0; ty < ROWS; ty++) span(x0, x1, ty, T_EMPTY);
    }
    function rect(x0, y0, x1, y1, v) {
      for (var ty = y0; ty <= y1; ty++) span(x0, x1, ty, v);
    }

    /* ---------------- terrain ---------------------------------------- */
    /* 1. Kerry Square — brick sidewalk downtown start */
    ground(0, 24, TOP, T_BRICK_TOP, T_BRICK_FILL);
    /* 2. The Diag — grass lawns */
    ground(27, 50, TOP, T_GRASS_TOP, T_DIRT);
    /* 3. Michigan Avenue — brick again */
    ground(51, 76, TOP, T_BRICK_TOP, T_BRICK_FILL);
    /* 4. Campus / Burton Memorial Tower */
    ground(77, 100, TOP, T_GRASS_TOP, T_DIRT);
    /* 5. The Big House — grass + bleachers */
    ground(101, 127, TOP, T_GRASS_TOP, T_DIRT);
    /* 6. Arts Fest on State Street */
    ground(128, 142, TOP, T_BRICK_TOP, T_BRICK_FILL);
    /* 7. Finish stretch */
    ground(143, COLS - 1, TOP, T_BRICK_TOP, T_BRICK_FILL);

    /* gaps (bottomless streets): carved after ground so they cut through everything */
    pit(25, 26);   /* crossing Campus Loop traffic */
    pit(38, 39);
    pit(46, 47);
    pit(72, 74);

    /* Diag staircases (hedge blocks) */
    rect(30, 13, 32, 13, T_HEDGE);
    rect(32, 12, 34, 13, T_HEDGE);
    rect(48, 13, 50, 13, T_HEDGE);

    /* Michigan Ave: awning platforms + bumpables */
    rect(63, 8, 66, 8, T_WOOD);
    set(54, 11, T_MBLOCK); set(57, 11, T_MBLOCK);
    rect(60, 10, 62, 10, T_BRICKBLOCK);
    set(65, 6, T_STONE);

    /* Burton Memorial Tower: an optional high route over the campus green.
       The tower itself is scenery; nothing here blocks the walk below it. */
    rect(82, 12, 84, 12, T_STONE);     /* first step up */
    rect(86, 10, 88, 10, T_WOOD);      /* mid platform */
    rect(90, 8, 93, 8, T_WOOD);        /* high ledge under the bells */
    set(85, 10, T_MBLOCK); set(91, 6, T_MBLOCK);
    rect(95, 11, 98, 11, T_WOOD);      /* way back down */

    /* The Big House: bleacher steps */
    rect(104, 13, 107, 13, T_STONE);
    rect(108, 12, 111, 13, T_STONE);
    rect(112, 11, 115, 13, T_STONE);
    rect(116, 10, 119, 13, T_STONE);
    set(114, 8, T_MBLOCK); set(117, 8, T_MBLOCK);

    /* Arts Fest: the Block M (four tall — you can actually climb it) + scaffolding */
    var MROWS = ['X.....X', 'XX...XX', 'X.X.X.X', 'X..X..X'];
    for (var r = 0; r < MROWS.length; r++) {
      for (var c = 0; c < 7; c++) {
        if (MROWS[r][c] === 'X') set(128 + c, 10 + r, (r === 0) ? T_STONE : T_BRICKBLOCK);
      }
    }
    rect(136, 9, 140, 9, T_WOOD);
    rect(137, 6, 139, 6, T_WOOD);

    /* finish: goal plateau */
    rect(150, 13, 153, 13, T_STONE);
    rect(158, 10, 162, 13, T_STONE);   /* the Champion Building plinth */

    /* ---------------- what's inside the ? blocks ---------------------- */
    var blocks = {};
    function blk(tx, ty, item) { blocks[ty * COLS + tx] = item; }
    blk(54, 11, 'coin'); blk(57, 11, 'heart');
    blk(85, 10, 'coin'); blk(91, 6, 'cherry');
    blk(114, 8, 'coin'); blk(117, 8, 'coin');

    /* ---------------- pickups ----------------------------------------- */
    var pickups = [];
    function coin(tx, ty) { pickups.push({ type: 'coin', tx: tx, ty: ty }); }
    function item(type, tx, ty) { pickups.push({ type: type, tx: tx, ty: ty }); }

    /* Kerry Square coins */
    coin(8, 12); coin(10, 12); coin(13, 11); coin(14, 11); coin(15, 11);
    item('coffee', 17, 12);
    /* pit arcs (x=25..26) */
    coin(25, 10); coin(26, 9);
    /* Diag */
    coin(30, 11); coin(31, 10); coin(32, 10); coin(34, 9); coin(35, 9);
    item('cherry', 33, 10);
    coin(38, 10); coin(39, 9);
    coin(41, 12); coin(42, 12); coin(43, 12);
    coin(46, 10); coin(47, 9);
    item('heart', 49, 11);
    /* Michigan Ave */
    coin(52, 12); coin(55, 10); coin(56, 10); coin(58, 10); coin(59, 10);
    coin(61, 9); coin(64, 7); coin(65, 5); coin(66, 7);
    coin(67, 8); coin(69, 8); coin(71, 12);
    coin(72, 10); coin(73, 9); coin(74, 10);
    /* Burton route */
    coin(83, 11); coin(84, 11); coin(87, 9); coin(88, 9);
    coin(90, 7); coin(92, 7); coin(91, 5);
    item('cherry', 89, 7);
    coin(96, 10); coin(97, 10); coin(98, 10); coin(100, 12);
    /* Big House steps */
    coin(104, 12); coin(106, 12); coin(108, 11); coin(110, 11);
    coin(112, 10); coin(115, 10); coin(116, 9); coin(119, 9);
    coin(120, 8); coin(121, 8);
    /* Block M + scaffolding */
    coin(128, 9); coin(131, 9); coin(134, 9);
    coin(127, 12); coin(135, 12);
    coin(136, 8); coin(138, 5); coin(140, 8);
    item('coffee', 139, 5);
    coin(141, 12); coin(142, 12);
    coin(143, 10); coin(144, 9);
    /* finish */
    coin(146, 12); coin(148, 12); coin(150, 12); coin(152, 12); coin(153, 12);

    /* ---------------- enemies ----------------------------------------- */
    var enemies = [];
    function enemy(kind, tx0, tx1, ty, opts) {
      var e = { kind: kind, x0: tx0 * TILE, x1: tx1 * TILE, y: ty * TILE };
      if (opts) for (var k in opts) e[k] = opts[k];
      enemies.push(e);
    }
    enemy('rover', 14, 20, TOP);
    enemy('squirrel', 30, 35, 12);
    enemy('rover', 40, 44, TOP);
    enemy('squirrel', 48, 50, 13);
    enemy('drone', 62, 70, 9, { bob: true });
    enemy('roverRed', 55, 60, TOP);
    enemy('rover', 78, 84, TOP);
    enemy('drone', 88, 95, 6, { bob: true });
    enemy('drone', 92, 100, 10, { bob: true });
    enemy('rover', 105, 107, 13);
    enemy('rover', 108, 111, 12);
    enemy('roverRed', 112, 115, 11);
    enemy('drone', 116, 121, 7, { bob: true });
    enemy('squirrel', 129, 133, TOP);
    enemy('rover', 136, 140, 9);
    enemy('drone', 145, 149, 10, { bob: true });

    /* ---------------- signs (on-canvas text over generic art) --------- */
    function px(tx) { return tx * TILE; }
    var signs = [
      { text: 'KERRY SQUARE', sub: 'DOWNTOWN ANN ARBOR', x: px(4), y: 150, size: 26, layer: 'mid' },
      { text: 'THE DIAG', sub: 'CENTRAL CAMPUS · KEEP OFF THE GRASS', x: px(30), y: 138, size: 30, layer: 'mid' },
      { text: 'SING-A-MAN\'S SANDWICH SHOPPE', sub: '"THE BEST SINCE NOBODY"', x: px(52), y: 214, size: 17, layer: 'front', panel: true },
      { text: 'MICHIGAN AVENUE', sub: 'SHOP TILT · PARKING: GOOD LUCK', x: px(63), y: 138, size: 22, layer: 'mid' },
      { text: 'BURTON MEMORIAL TOWER', sub: 'CARILLON · PLAYS THE WEEKLY CHIME', x: px(79), y: 104, size: 20, layer: 'mid' },
      { text: 'MICHIGAN STADIUM', sub: '"THE BIG HOUSE" · 107,601 SEATS', x: px(103), y: 152, size: 24, layer: 'mid' },
      { text: 'THE BLOCK M', sub: 'CLIMB IT. IT IS TRADITION.', x: px(127), y: 190, size: 20, layer: 'front', panel: true },
      { text: 'ARTS FLYERS!', sub: 'STATE STREET ART FAIR', x: px(135), y: 138, size: 22, layer: 'mid' },
      { text: 'FINISH LINE', sub: 'ELSYE STREET', x: px(146), y: 170, size: 24, layer: 'mid' },
      { text: 'THE CHAMPION BUILDING', sub: 'THANK A MORON FOR THE RAIN?', x: px(157), y: 206, size: 15, layer: 'front', panel: true }
    ];

    /* ---------------- urban-tileset decoration ------------------------ */
    var decor = [];
    function dec(id, xPx, yBottom, opts) {
      var d = { id: id, x: xPx, yBottom: yBottom };
      if (opts) for (var k in opts) d[k] = opts[k];
      decor.push(d);
    }
    var GROUND_Y = TOP * TILE; /* surface line everything stands on */

    /* far layer: skyline blocks. Heights come from the sprite's own aspect so
       rooftop props can sit on top of them. */
    var FAR = [
      { id: 12, tx: 5, s: 0.9 }, { id: 55, tx: 17, s: 0.85 }, { id: 12, tx: 33, s: 0.75 },
      { id: 63, tx: 44, s: 0.95 }, { id: 12, tx: 66, s: 0.85 }, { id: 64, tx: 79, s: 0.8 },
      { id: 12, tx: 93, s: 0.7 }, { id: 55, tx: 106, s: 0.95 }, { id: 63, tx: 126, s: 0.8 },
      { id: 12, tx: 145, s: 0.75 }, { id: 64, tx: 155, s: 0.9 }, { id: 55, tx: 162, s: 0.8 }
    ];
    var roofs = []; /* {x0,x1,top} for rooftop props */
    FAR.forEach(function (b) {
      var u = URB[b.id];
      var s = b.s;
      var w = u.w * s, h = u.h * s;
      var x = px(b.tx);
      dec(b.id, x, GROUND_Y, { layer: 'far', scale: s });
      roofs.push({ x0: x, x1: x + w, top: GROUND_Y - h, id: b.id });
    });
    function roofTopAt(tx) {
      var x = px(tx);
      for (var i = 0; i < roofs.length; i++) {
        if (x >= roofs[i].x0 && x <= roofs[i].x1) return roofs[i].top;
      }
      return null;
    }

    /* mid layer: storefronts, stadium facades, rooftop props */
    dec(65, px(52), GROUND_Y, { layer: 'mid' });                        /* storefront strip */
    dec(40, px(52) + 4, GROUND_Y - 100 + 44, { layer: 'mid' });         /* awning band */
    dec(25, px(57), GROUND_Y - 96, { layer: 'mid' });                   /* upper window row */
    dec(10, px(68), GROUND_Y, { layer: 'mid' });                        /* glass entrance */
    dec(63, px(68), GROUND_Y - 42, { layer: 'mid', scale: 0.9 });       /* upper facade */
    dec(54, px(101), GROUND_Y, { layer: 'mid', scale: 0.85 });          /* tree+facade chunk */
    dec(72, px(116), GROUND_Y - 138, { layer: 'mid' });                 /* water tower behind the Big House */
    dec(75, px(146), GROUND_Y, { layer: 'mid' });                       /* utility pole */
    var rt = roofTopAt(93);
    if (rt != null) dec(46, px(93) + 8, rt, { layer: 'mid' });          /* rooftop vent fans */
    rt = roofTopAt(106);
    if (rt != null) dec(69, px(106) + 20, rt, { layer: 'mid' });        /* rooftop AC box */
    rt = roofTopAt(155);
    if (rt != null) dec(72, px(155) + 8, rt + 4, { layer: 'mid', scale: 0.8 });

    /* front layer: street furniture & greenery along the walk */
    var FRONT = [
      [0, 3, 0.72], [62, 9, 0.62], [68, 11, 1], [67, 15, 1],
      [29, 28, 0.8], [0, 41, 0.65], [17, 43, 1], [23, 44, 1],
      [68, 49, 1], [0, 60, 0.6], [62, 66, 0.62], [66, 70, 1],
      [3, 53, 1], [14, 58, 1], [24, 76, 1], [0, 86, 0.55],
      [29, 99, 0.7], [0, 101, 0.8], [62, 130, 0.62], [51, 134, 1],
      [0, 140, 0.7], [68, 148, 1], [62, 152, 0.62], [2, 155, 1],
      [43, 160, 1.6]
    ];
    FRONT.forEach(function (f) {
      dec(f[0], px(f[1]), GROUND_Y, { layer: 'front', scale: f[2] || 1 });
    });
    /* the Champion Building's front door sits on the finish wall */
    decor.push({ id: 9, x: px(159), yBottom: GROUND_Y + TILE, layer: 'front' });

    var spawn = { x: 4 * TILE, y: (TOP - 1) * TILE };
    var goalX = 152 * TILE;   /* flagpole */

    return {
      TILE: TILE, COLS: COLS, ROWS: ROWS, TOP: TOP,
      W: COLS * TILE, H: ROWS * TILE,
      codes: { T_EMPTY: T_EMPTY, T_CONC_TOP: T_CONC_TOP, T_CONC_FILL: T_CONC_FILL,
               T_BRICK_TOP: T_BRICK_TOP, T_BRICK_FILL: T_BRICK_FILL, T_GRASS_TOP: T_GRASS_TOP,
               T_DIRT: T_DIRT, T_HEDGE: T_HEDGE, T_WOOD: T_WOOD, T_BRICKBLOCK: T_BRICKBLOCK,
               T_MBLOCK: T_MBLOCK, T_USED: T_USED, T_STONE: T_STONE },
      grid: grid, blocks: blocks, pickups: pickups, enemies: enemies,
      signs: signs, decor: decor, spawn: spawn, goalX: goalX
    };
  }

  global.LEVEL = { make: makeLevel };
})(typeof window !== 'undefined' ? window : globalThis);
