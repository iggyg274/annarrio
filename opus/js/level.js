'use strict';
// ---------------------------------------------------------------------------
// Level 1-1: "A Day in Ann Arbor"
// Main Street -> State Street -> The Diag -> S. University road work ->
// Huron River -> Michigan Stadium.
//
// Tile legend (collision map):
//   S sidewalk ground    G grass ground     R gravel ground (construction)
//   s/g/r one-tile-thick floating platforms of the same styles
//   H hedge block        W wooden plank     C crate (stairs)
//   X road barrier       B brick (breakable) Q mystery block   U used block
//   ~ water surface      = deep water  (hazards)
// ---------------------------------------------------------------------------

function buildLevel() {
  const W = 236;
  const H = 15;
  const map = Array.from({ length: H }, () => new Array(W).fill(null));
  const set = (x, y, c) => { if (x >= 0 && x < W && y >= 0 && y < H) map[y][x] = c; };
  const fill = (x0, x1, y0, y1, c) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) set(x, y, c); };
  const ground = (x0, x1, c) => fill(x0, x1, 12, 14, c);
  const plat = (x0, x1, y, c) => fill(x0, x1, y, y, c);
  const contents = {};
  const q = (x, y, what = 'coin') => { set(x, y, 'Q'); contents[`${x},${y}`] = what; };
  const bricks = (x0, x1, y) => fill(x0, x1, y, y, 'B');

  const ents = [];
  const coin = (x, y) => ents.push({ type: 'coin', tx: x, ty: y });
  const coins = (x0, x1, y) => { for (let x = x0; x <= x1; x++) coin(x, y); };
  const arc = (x0, x1, y) => {
    const n = x1 - x0;
    for (let x = x0; x <= x1; x++) {
      const k = (x - x0) / n;
      coin(x, Math.round(y - Math.sin(k * Math.PI) * 2));
    }
  };
  const enemy = (type, x, y = 11, extra = {}) => ents.push({ type, tx: x, ty: y, ...extra });

  const T = (n) => n * TILE;
  const deco = { mid: [], back: [], front: [] };
  const back = (x0, x1, draw) => deco.back.push({ x0, x1, draw });
  const front = (x0, x1, draw) => deco.front.push({ x0, x1, draw });

  // ======================= A. MAIN STREET (0-52) ===========================
  ground(0, 37, 'S');
  ground(41, 79, 'S');

  back(0, T(7), (c, t) => {
    R.board(['WELCOME TO ANN ARBOR', 'TREE TOWN, USA  ·  EST. 1824'], T(3.5), GROUND_Y - 60, {
      size: 7, bg: '#6b4a2f', fg: '#ffe9a8', subFg: '#f5e6c8', border: '#3b2a1c', inner: '#a57a4d', posts: 30,
    });
    R.urban(3, T(0.2), GROUND_Y, 0.5);
    R.urban(14, T(6.2), GROUND_Y, 0.5);
  });
  back(T(7), T(15), (c, t) => Deco.building({
    x: T(7), w: 136, floors: 2, win: 27, winScale: 0.34, tint: '#c9d3e6', cornice: 60, store: 65,
    sign: ['FLEETWOOD DINER', 'OPEN 24 HRS · HIPPIE HASH'], signBg: '#b91c1c', signFg: '#fff', signBorder: '#fff', signSize: 7, signY: GROUND_Y - 50,
    roof: [{ id: 69, dx: 90, s: 0.4 }],
  }));
  back(T(14), T(23), (c, t) => {
    Deco.building({
      x: T(15.2), w: 136, floors: 3, win: 26, winScale: 0.42, tint: '#e0a086', cornice: 61, store: 65, lit: true,
      sign: ['ZINGY’S DELI', 'SANDWICH LINE: ~45 MIN'], signBg: '#2d5a27', signFg: '#ffe08a', signBorder: '#f3e1b0', signSize: 7, signY: GROUND_Y - 50,
      roof: [{ id: 72, dx: 70, s: 0.3 }],
    });
    R.urban(66, T(14.2), GROUND_Y, 0.5);
  });
  back(T(22), T(33), (c, t) => {
    const top = Deco.building({
      x: T(23), w: 176, floors: 3, win: 18, winScale: 0.3, tint: '#d8b98f', cornice: 60, store: 65,
    });
    // vertical blade sign + marquee
    c.fillStyle = '#1d2340';
    c.fillRect(T(23) + 20, top + 8, 18, 92);
    c.fillStyle = '#c1121f';
    c.fillRect(T(23) + 21, top + 9, 16, 90);
    'MICHIGAN'.split('').forEach((ch, i) => R.text(ch, T(23) + 29, top + 16 + i * 10.8, { size: 9, color: (Math.floor(t * 3) + i) % 8 === 0 ? '#fff' : '#ffcb05' }));
    R.board(['MICHIGAN THEATER', 'NOW SHOWING: SUPER ANNARIO'], T(23) + 100, GROUND_Y - 70, {
      size: 7, bg: '#101628', fg: '#ffcb05', subFg: '#ffffff', border: '#ffcb05', bulbs: true, t, pad: 6,
    });
    R.urban(67, T(33.5), GROUND_Y, 0.5);
  });
  back(T(33), T(38), () => Deco.streetSign('MAIN ST', T(36), 0, '↔ LIBERTY ST'));
  back(T(40), T(53), (c, t) => {
    Deco.building({
      x: T(41.5), w: 190, floors: 2, win: 19, winScale: 0.3, tint: '#b7c5dd', cornice: 61, store: 10, lit: true,
      sign: ['ANN ARBOR ART FAIR', 'EVERY JULY · 500,000 VISITORS'], signBg: '#6d28d9', signFg: '#fde68a', signBorder: '#fff', signSize: 7,
      roof: [{ id: 46, dx: 20, s: 0.35 }, { id: 57, dx: 150, s: 0.3 }],
    });
    // bunting
    for (let i = 0; i < 14; i++) {
      const bx = T(41.5) + 6 + i * 13;
      c.fillStyle = ['#ffcb05', '#00274c', '#e11d48', '#10b981'][i % 4];
      c.beginPath();
      c.moveTo(bx, GROUND_Y - 58);
      c.lineTo(bx + 9, GROUND_Y - 58);
      c.lineTo(bx + 4.5, GROUND_Y - 50 + Math.sin(t * 3 + i) * 1.2);
      c.fill();
    }
    Deco.lamp(T(40.3));
  });

  q(10, 8, 'coin');
  bricks(13, 13, 8); q(14, 8, 'coin'); bricks(15, 15, 8); q(16, 8, 'multi'); bricks(17, 17, 8);
  q(15, 4, 'gem');
  coins(5, 7, 10);
  enemy('parkbot', 21);
  enemy('parkbot', 31);
  plat(24, 28, 9, 's');
  coins(24, 28, 7);
  arc(36, 42, 8);
  enemy('parkbot', 45);
  enemy('parkbot', 48);
  bricks(47, 49, 8); q(48, 8, 'coin');

  // ======================= B. STATE STREET (53-76) =========================
  back(T(52), T(56), () => Deco.streetSign('STATE ST', T(54), 0, 'CAMPUS →'));
  // The Cube lives in the game (interactive); its plinth sign is here.
  back(T(56), T(62), () => {
    R.board(['THE CUBE', 'REGENTS PLAZA · GIVE IT A SPIN (↑)'], T(59), GROUND_Y - 88, { size: 6, bg: '#111827', fg: '#e5e7eb', subFg: '#9ca3af', border: '#6b7280' });
  });
  back(T(61), T(75), (c, t) => Deco.building({
    x: T(62), w: 200, floors: 2, win: 26, winScale: 0.4, tint: '#e7c7a1', cornice: 60, store: 65, lit: true,
    sign: ['NICKELS ARCADE', 'SHOPS · SINCE 1918'], signBg: '#7c2d12', signFg: '#fde68a', signBorder: '#fcd34d', signSize: 7,
    roof: [{ id: 50, dx: 160, s: 0.3 }],
  }));

  plat(61, 63, 9, 's');
  plat(65, 68, 6, 's');
  coins(65, 68, 5);
  q(66, 2, 'hype');
  enemy('parkbot', 60);
  enemy('drone', 70, 7, { range: 3 });
  enemy('squirrel', 72);
  arc(73, 77, 8);

  // ======================= C. THE DIAG (77-125) ============================
  fill(74, 76, 12, 14, null);
  ground(77, 125, 'G');

  back(T(76), T(84), (c) => {
    R.urban(0, T(76), GROUND_Y, 0.5);
  });
  back(T(84), T(99), (c, t) => {
    // Hatcher Graduate Library: columns out of building side panels.
    const x = T(85);
    const w = 230;
    const top = GROUND_Y - 116;
    R.urbanFill(49, x, top + 20, w, 96, 0.5);
    c.save();
    c.globalCompositeOperation = 'multiply';
    c.fillStyle = '#e8dcc4';
    c.fillRect(x, top + 20, w, 96);
    c.restore();
    c.fillStyle = '#d6cbb3';
    c.fillRect(x - 6, top, w + 12, 22);
    c.fillStyle = '#9d927c';
    c.fillRect(x - 6, top + 20, w + 12, 3);
    for (let i = 0; i < 7; i++) R.urban(63, x + 8 + i * 32, GROUND_Y - 6, 0.62);
    c.fillStyle = '#bdb39c';
    c.fillRect(x - 10, GROUND_Y - 7, w + 20, 7);
    c.fillStyle = '#a89f89';
    c.fillRect(x - 14, GROUND_Y - 3, w + 28, 3);
    R.text('HATCHER GRADUATE LIBRARY', x + w / 2, top + 11, { size: 9, color: '#3b3322' });
  });
  back(T(76), T(88), () => {
    R.board(['THE DIAG', 'CENTRAL CAMPUS'], T(85.5), GROUND_Y - 60, {
      size: 9, bg: '#00274c', fg: '#ffcb05', subFg: '#dbe4f0', border: '#ffcb05', posts: 38, postColor: '#374151',
    });
  });
  back(T(97), T(107), (c) => {
    R.urban(29, T(96.5), GROUND_Y, 0.5, true);
    R.board(['PLEASE DON’T STEP ON THE M', 'UNLESS YOU WANT TO FAIL YOUR FIRST BLUE BOOK EXAM'], T(97.5), GROUND_Y - 40, {
      size: 6, subSize: 4, bg: '#f5efe0', fg: '#00274c', subFg: '#5b4a2a', border: '#8a6d3b', pole: 28,
    });
  });
  back(T(107), T(120), (c) => {
    R.urban(68, T(109), GROUND_Y, 0.5);
    R.urban(0, T(112), GROUND_Y, 0.5, true);
    R.board(['CAUTION: DIAG SQUIRRELS', 'THEY ARE ALREADY IN CHARGE'], T(114.5), GROUND_Y - 34, {
      size: 5, subSize: 4, bg: '#fbbf24', fg: '#111827', subFg: '#111827', border: '#111827', pole: 22,
    });
  });
  back(T(88), T(93), () => { R.urban(68, T(90.5), GROUND_Y, 0.5); R.urban(13, T(94), GROUND_Y, 0.5); });
  back(T(119), T(126), () => { R.urban(24, T(123), GROUND_Y, 0.5); R.urban(2, T(125), GROUND_Y, 0.5); });
  front(T(77), T(126), (c) => {
    for (let x = 78; x < 125; x += 3.3) R.urban((Math.floor(x) % 2) ? 6 : 7, T(x), GROUND_Y + 1, 0.5);
  });

  fill(87, 88, 10, 11, 'H');
  plat(99, 105, 9, 'g');
  coins(100, 104, 8);
  enemy('squirrel', 92);
  enemy('squirrel', 97);
  enemy('squirrel', 106);
  enemy('squirrel', 113);
  enemy('squirrel', 121);
  bricks(107, 107, 8); q(108, 8, 'coin'); bricks(109, 109, 8); q(110, 8, 'heart'); bricks(111, 111, 8);
  fill(117, 118, 9, 11, 'H');
  coins(117, 118, 7);

  // ================ D. S. UNIVERSITY ROAD WORK (126-161) ==================
  ground(126, 135, 'R');
  ground(139, 146, 'R');
  ground(151, 161, 'R');

  back(T(125), T(132), () => {
    R.board(['⚠ ROAD WORK AHEAD', 'IN PROGRESS SINCE 1824'], T(128.5), GROUND_Y - 54, {
      size: 8, bg: '#f97316', fg: '#111827', subFg: '#111827', border: '#111827', inner: '#111827', posts: 34, postColor: '#4b5563',
    });
  });
  back(T(131), T(147), (c) => {
    // A half-finished high-rise wrapped in scaffolding.
    const x = T(133);
    R.urban(12, x, GROUND_Y, 0.5);
    R.urban(12, x + 50, GROUND_Y, 0.5, true);
    for (let yy = GROUND_Y; yy > GROUND_Y - 130; yy -= 27) R.urbanFill(44, x + 100, yy - 27, 34, 27, 0.5);
    R.urban(39, x + 108, GROUND_Y, 0.5);
    R.board(['FUTURE HOME OF', 'ANOTHER HIGH-RISE'], x + 50, GROUND_Y - 100, { size: 6, bg: '#fff', fg: '#111827', subFg: '#b91c1c', border: '#111827' });
  });
  back(T(148), T(162), (c) => {
    R.urban(41, T(152), GROUND_Y, 0.5);
    R.urban(75, T(158), GROUND_Y, 0.5);
    R.board('DETOUR →', T(159.5), GROUND_Y - 32, { size: 7, bg: '#f97316', fg: '#111827', border: '#111827', posts: 18, postColor: '#4b5563' });
  });

  fill(131, 132, 11, 11, 'X');
  fill(142, 142, 10, 11, 'X');
  enemy('roller', 144);
  plat(148, 149, 10, 'W');
  coins(148, 149, 8);
  bricks(152, 156, 8); q(154, 8, 'gem'); q(154, 4, 'oneup');
  enemy('drone', 150, 6, { range: 3 });
  enemy('roller', 158);
  coins(139, 141, 9);

  // ======================== E. HURON RIVER (162-184) ======================
  fill(162, 184, 13, 13, '~');
  fill(162, 184, 14, 14, '=');
  back(T(158), T(168), () => {
    R.board(['HURON RIVER', 'ARGO CANOE LIVERY →'], T(163), GROUND_Y - 110, { size: 8, bg: '#0e4d64', fg: '#e0f2fe', subFg: '#fcd34d', border: '#e0f2fe' });
  });
  back(T(160), T(190), (c) => {
    c.fillStyle = '#6b4a2f';
    for (const px of [164.2, 166.6, 179.2, 181.6]) c.fillRect(T(px), T(px < 170 ? 11 : 10), 3, T(14) - T(px < 170 ? 11 : 10));
  });
  plat(164, 166, 10, 'W');
  plat(179, 181, 9, 'W');
  ents.push({ type: 'canoe', tx: 167, ty: 12, tx1: 176, speed: 34 });
  arc(167, 172, 8);
  coins(180, 181, 7);
  enemy('drone', 174, 6, { range: 4 });

  // ====================== F. MICHIGAN STADIUM (185-235) ===================
  ground(185, 235, 'G');
  back(T(184), T(196), (c) => {
    R.urban(29, T(184), GROUND_Y, 0.5);
    Deco.streetSign('STADIUM BLVD', T(191), 0, 'GAME DAY PARKING $60');
  });
  back(T(194), T(200), () => {
    R.board(['NO BUCKEYES', 'BEYOND THIS POINT'], T(197), GROUND_Y - 36, { size: 6, bg: '#ffcb05', fg: '#00274c', subFg: '#00274c', border: '#00274c', pole: 24 });
  });
  back(T(209), T(236), (c, t) => {
    // The Big House (famously dug mostly into the ground).
    const x = T(215);
    const w = T(236) - x;
    const top = GROUND_Y - 100;
    R.urbanFill(59, x, top + 26, w, 74, 0.5);
    c.save();
    c.globalCompositeOperation = 'multiply';
    c.fillStyle = '#c9a979';
    c.fillRect(x, top + 26, w, 74);
    c.restore();
    c.fillStyle = '#00274c';
    c.fillRect(x - 4, top + 8, w + 8, 20);
    c.fillStyle = '#ffcb05';
    c.fillRect(x - 4, top + 26, w + 8, 3);
    R.text('MICHIGAN STADIUM', x + w / 2, top + 18.5, { size: 12, color: '#ffcb05' });
    for (let i = 0; i < 4; i++) {
      const ax = x + 22 + i * 64;
      c.fillStyle = '#1b1b24';
      c.beginPath();
      c.moveTo(ax, GROUND_Y);
      c.lineTo(ax, GROUND_Y - 34);
      c.arc(ax + 16, GROUND_Y - 34, 16, Math.PI, 0);
      c.lineTo(ax + 32, GROUND_Y);
      c.fill();
      if (i !== 1) R.urban(9, ax + 7, GROUND_Y - 44, 0.5);
    }
    R.board(['THE BIG HOUSE', 'CAPACITY 107,601 · MOSTLY UNDERGROUND'], x + w / 2, top - 62, { size: 8, bg: '#111827', fg: '#ffcb05', subFg: '#e5e7eb', border: '#ffcb05', bulbs: true, t });
    // flags on the rim
    for (let i = 0; i < 5; i++) {
      const fx = x + 8 + i * 68;
      c.fillStyle = '#9ca3af';
      c.fillRect(fx, top - 18, 2, 26);
      R.tile(Math.floor(t * 2 + i) % 2 ? 111 : 112, fx, top - 20);
    }
  });

  q(193, 8, 'multi');
  enemy('squirrel', 190);
  enemy('parkbot', 198);
  coins(188, 190, 9);
  for (let i = 0; i < 6; i++) fill(202 + i, 202 + i, 11 - i, 11, 'C');
  fill(208, 208, 6, 11, 'C');
  set(213, 11, 'C');
  coins(203, 206, 4);

  const zones = [
    { x: 0, name: 'MAIN STREET', sub: 'DOWNTOWN ANN ARBOR', mood: 'downtown' },
    { x: T(52), name: 'STATE STREET', sub: 'REGENTS PLAZA', mood: 'campus' },
    { x: T(77), name: 'THE DIAG', sub: 'CENTRAL CAMPUS', mood: 'diag' },
    { x: T(126), name: 'SOUTH UNIVERSITY', sub: 'ROAD WORK (AGAIN)', mood: 'construction' },
    { x: T(160), name: 'HURON RIVER', sub: 'MIND THE CANOES', mood: 'river' },
    { x: T(185), name: 'MICHIGAN STADIUM', sub: 'THE BIG HOUSE', mood: 'stadium' },
  ];

  return {
    w: W, h: H, map, contents, ents, deco, zones,
    start: { x: T(2), y: GROUND_Y - 20 },
    checkpoint: { x: T(80), y: GROUND_Y - 20 },
    cube: { x: T(59), y: GROUND_Y },
    brassM: { x0: T(101.5), x1: T(103.5) },
    pole: { tx: 213, topTy: 3, baseTy: 11 },
    entranceX: T(215) + 102,
    timeLimit: 300,
  };
}
