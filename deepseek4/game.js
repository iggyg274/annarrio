/* =========================================================================
   game.js — "Ann Arbor Runner", a single-playable-level 2D platformer.
   Runs entirely in the browser via a <canvas>. Art from the bundled Kenney
   "Pixel Platformer" kit (CC0) + the Dlou Saiyan urban city tileset
   (background/signage decoration layer) + runtime-procedural Web Audio.
   ========================================================================= */
(function () {
  "use strict";

  /* ------------------------------------------------------------------ */
  /* Constants                                                           */
  /* ------------------------------------------------------------------ */
  const T = 36;            // world tiles are 36px on screen
  const COLS = 152;        // level width in tiles
  const ROWS = 15;         // level height in tiles (== canvas rows)
  const VIEWW = 960;
  const VIEWH = 540;
  const GRAVITY = 2300;
  const MAXRUN = 265;
  const ACCEL = 2400;
  const AIRACCEL = 1500;
  const FRICTION = 2600;
  const JUMPVEL = -730;
  const MAXFALL = 900;
  const SURFACE_ROW = 11;  // ground-top row

  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;

  const AUDIO = window.AudioSysInstance;

  const $ = (id) => document.getElementById(id);

  /* ------------------------------------------------------------------ */
  /* Input                                                               */
  /* ------------------------------------------------------------------ */
  const keys = {};
  let jumpPressed = false;   // edge-triggered
  let jumpQueued = 0;
  window.addEventListener("keydown", (e) => {
    const k = e.key;
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", " "].includes(k)) e.preventDefault();
    if (!keys[k]) {
      keys[k] = true;
      // allow jump buffering
      if ([" ", "w", "W", "ArrowUp"].includes(k)) jumpQueued = 5;
    }
  });
  window.addEventListener("keyup", (e) => { keys[e.key] = false; });

  /* ------------------------------------------------------------------ */
  /* Assets                                                              */
  /* ------------------------------------------------------------------ */
  const tileImg = {};         // kenney tile index -> HTMLImageElement
  function makeImg(src) {
    const img = new Image();
    img.src = src;
    return img;
  }
  function kenneyTile(n) {
    if (!tileImg[n]) tileImg[n] = makeImg(`sprites/Tiles/tile_${String(n).padStart(4, "0")}.png`);
    return tileImg[n];
  }
  function kenneyChar(n) {
    if (!tileImg["c" + n]) tileImg["c" + n] = makeImg(`sprites/Tiles/Characters/tile_${String(n).padStart(4, "0")}.png`);
    return tileImg["c" + n];
  }
  function kenneyBG(n) {
    if (!tileImg["b" + n]) tileImg["b" + n] = makeImg(`sprites/Tiles/Backgrounds/tile_${String(n).padStart(4, "0")}.png`);
    return tileImg["b" + n];
  }
  const urbanImg = makeImg("urbantileset/urbantileset32x32.png");

  // urban manifest subset (id -> {x,y,w,h}) — from manifest/urban_tileset_manifest.json
  const URBAN = {
    0:  { x: 9,   y: 12,  w: 208, h: 182 },  // large tree A
    2:  { x: 258, y: 1,   w: 29,  h: 39 },   // small bush
    10: { x: 542, y: 0,   w: 132, h: 66 },   // glass entrance doors
    12: { x: 894, y: 0,   w: 100, h: 276 },  // tall skyscraper facade
    25: { x: 318, y: 190, w: 164, h: 36 },   // small shop window strip
    29: { x: 9,   y: 236, w: 208, h: 182 },  // large tree B
    55: { x: 223, y: 478, w: 131, h: 172 },  // teal building side wall
    62: { x: 995, y: 625, w: 25,  h: 289 },  // street lamp post
    65: { x: 734, y: 670, w: 260, h: 100 },  // storefront facade strip
    66: { x: 576, y: 698, w: 32,  h: 45 },   // red USPS mailbox
    67: { x: 610, y: 704, w: 28,  h: 38 },   // trash can
    68: { x: 643, y: 716, w: 58,  h: 25 },   // park bench
    70: { x: 702, y: 798, w: 132, h: 132 },  // billboard (credits screen only!)
    72: { x: 190, y: 809, w: 164, h: 121 },  // cyan water tower tank
    75: { x: 513, y: 830, w: 94,  h: 100 }   // wooden utility pole
  };
  function drawUrban(id, dx, dy, dw, dh) {
    const r = URBAN[id];
    if (!r) return;
    ctx.drawImage(urbanImg, r.x, r.y, r.w, r.h, dx, dy, dw, dh);
  }

  function wait(img) {
    return new Promise((resolve) => {
      if (img.complete && img.naturalWidth > 0) return resolve();
      img.onload = () => resolve();
      img.onerror = () => resolve();
    });
  }

  async function loadAssets() {
    const files = [];
    // kenney world tiles actually used
    [1, 6, 9, 10, 16, 33, 42, 49, 50, 51, 111, 112, 144, 145, 151, 152, 93].forEach((n) => files.push(kenneyTile(n)));
    // characters: player 6,7 | rovers 18,19,20 | bat 24 | drone 15
    [6, 7, 18, 19, 20, 24, 15].forEach((n) => files.push(kenneyChar(n)));
    // backgrounds: 0 sky, 8-11 clouds, 14 tree line
    [0, 1, 2, 3, 8, 9, 14, 15].forEach((n) => files.push(kenneyBG(n)));
    files.push(urbanImg);
    for (const f of files) await wait(f);
  }

  /* ------------------------------------------------------------------ */
  /* Level data                                                          */
  /* ------------------------------------------------------------------ */
  // kenney tile indices used for the solid/ground map
  const GRASS_TOP = 1;
  const DIRT = 42;
  const BRICK = 6;
  const MYSTERY = 10;
  const GOLD = 9;
  const WATER = 33;
  const solidCodes = new Set([GRASS_TOP, DIRT, BRICK, MYSTERY, GOLD]);

  // ground cell helpers -------------------------------------------------
  const map = [];
  for (let r = 0; r < ROWS; r++) map.push(new Array(COLS).fill(0));

  function groundAt(col, topRow) { return map[topRow][col] === GRASS_TOP || map[topRow][col] === DIRT; }

  function layerGround(c0, c1, topRow) {
    for (let c = c0; c <= c1; c++) {
      map[topRow][c] = GRASS_TOP;
      for (let r = topRow + 1; r < ROWS; r++) map[r][c] = DIRT;
    }
  }

  // water drawn under a pit (decorative hazard basin)
  function layerWaterPit(c0, c1, topRow) {
    for (let c = c0; c <= c1; c++) for (let r = topRow; r < ROWS; r++) map[r][c] = WATER;
  }

  function putTile(c, r, code) { if (c >= 0 && c < COLS && r >= 0 && r < ROWS) map[r][c] = code; }

  /* ---- entities: coins, gems, enemies, finish ---- */
  const coins = [];   // {x,y (px), kind:'coin'|'gem', taken}
  const enemies = []; // rover ground patrols
  const flyers = [];  // flying bats/drones
  let finishFlag = null;
  const checkpoints = [];  // {x, active}
  let bumpables = {};      // key "c,r" -> {x,y,bumped}

  function addCoin(cellX, cellY, kind) {
    coins.push({ x: cellX * T + T / 2, y: cellY * T + T / 2, kind: kind || "coin", taken: false });
  }
  function addChecker(c0, c1, row) {
    for (let c = c0; c <= c1; c++) addCoin(c, row, c % 3 === 0 ? "gem" : "coin");
  }

  function worldGroundY(cellX) {
    // find top-most solid cell at column
    for (let r = 0; r < ROWS; r++) if (groundAt(cellX, r)) return r * T;
    return ROWS * T;
  }

  function addRover(cellX) {
    const gy = worldGroundY(Math.floor(cellX));
    enemies.push({ x: cellX * T, y: gy - 30, w: 40, h: 30, vx: -60, dead: false, timer: 0, frame: 0 });
  }
  function addFlyer(cellX, cellRow) {
    flyers.push({ x: cellX * T, baseY: cellRow * T, w: 40, h: 34, phase: Math.random() * 6.28, speed: 34, dead: false, vx: 0 });
  }

  /* ------------------------------------------------------------------ */
  /* Level construction                                                  */
  /* ------------------------------------------------------------------ */
  function buildLevel() {
    map.forEach((row) => row.fill(0));
    coins.length = 0; enemies.length = 0; flyers.length = 0; checkpoints.length = 0; bumpables = {};
    finishFlag = null;

    // base terrain uses the grass-top (indices 1) + dirt fill (42)
    const G = 1, D = 42;

    /* ---- Section A: The Diag (start, flat campus quad) ---- */
    layerGround(0, 34, SURFACE_ROW);
    // coin arc + blocks over the quad
    addChecker(9, 15, 8);
    putTile(19, 8, MYSTERY); bumpables["19,8"] = { x: 19 * T, y: 8 * T, bumped: false };
    putTile(24, 8, GOLD);
    addCoin(24, 7, "gem");
    addChecker(27, 33, 9);

    /* ---- Section B: gap + platform climb ---- */
    // pit 35-36, then resume 37-46; floating bricks span the gap
    putTile(35, 9, BRICK); putTile(36, 9, BRICK);
    layerGround(37, 46, SURFACE_ROW);
    putTile(41, 8, MYSTERY); bumpables["41,8"] = { x: 41 * T, y: 8 * T, bumped: false };
    addCoin(41, 7, "coin");
    addChecker(42, 46, 9);
    addRover(43);

    /* ---- Section C: State Street / Michigan Stadium + storefront ---- */
    layerGround(47, 78, SURFACE_ROW);
    addChecker(48, 54, 8);
    putTile(53, 8, BRICK); putTile(54, 8, BRICK);
    putTile(60, 8, MYSTERY); bumpables["60,8"] = { x: 60 * T, y: 8 * T, bumped: false };
    addCoin(60, 7, "gem");
    addRover(57);
    addRover(65);
    addRover(73);
    addChecker(68, 74, 9);
    // mid-level checkpoint
    checkpoints.push({ x: 71 * T + 18, active: false });

    /* ---- Section D: gap + Burton Tower climb ---- */
    // pit 79-81
    putTile(79, 10, BRICK); putTile(80, 10, BRICK); putTile(81, 10, BRICK);
    layerGround(82, 106, SURFACE_ROW);
    // little staircase of bricks up near the tower
    putTile(93, 10, BRICK); putTile(94, 9, BRICK); putTile(95, 8, BRICK);
    addChecker(95, 97, 7);
    putTile(97, 8, GOLD); addCoin(97, 7, "gem");
    addCoin(93, 9, "coin");
    addRover(100);
    addRover(105);
    addChecker(102, 104, 8);

    /* ---- Section E: Nichols Arboretum (water pit + bridge) ---- */
    layerGround(107, 118, SURFACE_ROW);
    // water pit 119-121, wooden bridge at row 10
    layerWaterPit(119, 121, 12);
    putTile(119, 10, 50); putTile(120, 10, 50); putTile(121, 10, 50);
    addChecker(119, 121, 8);
    layerGround(124, 136, SURFACE_ROW);
    putTile(125, 8, MYSTERY); bumpables["125,8"] = { x: 125 * T, y: 8 * T, bumped: false };
    addCoin(125, 7, "coin");
    addChecker(126, 133, 9);
    // flying pests over the arb
    addFlyer(121, 7);
    addFlyer(128, 6);
    addRover(131);
    addRover(128);

    /* ---- Section F: final stretch + flag ---- */
    layerGround(137, 151, SURFACE_ROW);
    putTile(139, 8, BRICK); putTile(140, 8, BRICK); putTile(141, 8, BRICK);
    putTile(142, 8, MYSTERY); bumpables["142,8"] = { x: 142 * T, y: 8 * T, bumped: false };
    addCoin(142, 7, "gem");
    addChecker(143, 145, 9);
    addRover(140);
    finishFlag = { x: 147 * T + 18, y: SURFACE_ROW * T - 6, reached: false };

    // decorative props are described in a separate module below
    buildProps();
  }

  /* ---- world-space props (draw-only, non-colliding) ---- */
  const props = [];
  function buildProps() {
    props.length = 0;
    const S = SURFACE_ROW * T; // ground-top world y for all ground sections

    // --- street furniture ---
    const bench = (cx) => { const sc = 1.1; props.push({ urban: 68, x: cx * T, y: S - 25 * sc, w: 58 * sc, h: 25 * sc }); };
    const lamp = (cx) => { const h = 210; props.push({ urban: 62, x: cx * T - 8, y: S - h, w: 25 * (h / 289), h }); };
    const mailbox = (cx) => { const sc = 0.9; props.push({ urban: 66, x: cx * T, y: S - 45 * sc, w: 32 * sc, h: 45 * sc }); };
    const trash = (cx) => { const sc = 0.9; props.push({ urban: 67, x: cx * T, y: S - 38 * sc, w: 28 * sc, h: 38 * sc }); };
    const potted = (cx, kind) => { props.push({ tile: 16, x: cx * T + 4, y: S - 36, w: 28, h: 28 }); void kind; }; // hedge bush

    bench(26); potted(29, "blue");
    lamp(70); mailbox(75); trash(78);
    bench(84);
    lamp(129); bench(134);
    trash(138);

    // --- THE DIAG sign (near start) ---
    props.push({ sign: "THE  DIAG", sub: "Campus Quad", x: 20 * T + 8, y: S - 120, w: 130, h: 84 });

    // --- Zingerman's-adjacent storefront (urban id 65) + signage ---
    const stx = 63 * T, stw = 190, sth = 78;
    props.push({ urban: 65, x: stx, y: S - sth, w: stw, h: sth });
    props.push({ sign: "ZINNER'S DELI", sub: "EST. 1982", x: stx + 6, y: S - sth - 46, w: stw - 12, h: 38 });

    // --- snowy easter egg ---
    props.push({ tile: 144, x: 132 * T, y: S - 36, w: 36, h: 36 });
    props.push({ tile: 145, x: 136 * T, y: S - 72, w: 36, h: 72 });
  }

  /* ---- parallax background decorations (drawn behind world) ---- */
  const farBG = []; // {drawAt(baseX, camX)} — anchored to world coords, scrolled slowly
  function parallaxRect(camX, factor, worldX, w, vw) {
    return worldX - camX * factor;
  }
  function buildBG() {
    farBG.length = 0;
    const S = SURFACE_ROW * T;
    // Anchored so each landmark scrolls into view during its level section
    // (screen pos = worldX - camX*f ; pick worldX so it centers near that area).
    farBG.push({ f: 0.22, kind: "stadium", worldX: 2540, groundY: S });   // section C
    farBG.push({ f: 0.26, kind: "burton", worldX: 4060, groundY: S });      // section D
    farBG.push({ f: 0.28, kind: "block", worldX: 1860, groundY: S, variant: 0 }); // STATE ST
    farBG.push({ f: 0.24, kind: "block", worldX: 5250, groundY: S, variant: 1 }); // THE ARB
    farBG.push({ f: 0.2, kind: "tower", worldX: 1120, groundY: S - 60 });   // water tower near start
  }

  /* ------------------------------------------------------------------ */
  /* Player                                                              */
  /* ------------------------------------------------------------------ */
  let lives = 3;
  let score = 0;
  let coinCount = 0;
  let player = null;
  let activeCheckpoint = null;
  let state = "loading"; // loading | menu | play | paused | dead | over | win
  let stateTimer = 0;

  function spawnPlayer(atX) {
    player = {
      x: atX, y: SURFACE_ROW * T - 46, w: 28, h: 46,
      vx: 0, vy: 0, onGround: false, face: 1,
      anim: 0, inv: 0, inWater: false, deadTimer: 0
    };
  }

  function resetRun() {
    lives = 3; score = 0; coinCount = 0;
    // reset collectibles
    for (const c of coins) c.taken = false;
    for (const e of enemies) e.dead = false;
    for (const f of flyers) f.dead = false;
    for (const k in bumpables) bumpables[k].bumped = false;
    checkpoints.forEach((c) => (c.active = false));
    activeCheckpoint = null;
    if (finishFlag) finishFlag.reached = false;
    spawnPlayer(2 * T + 8);
    camX = 0;
    coinPops.length = 0;
    props.length = 0;
    farBG.length = 0;
    buildProps();
    buildBG();
  }

  /* ------------------------------------------------------------------ */
  /* Solid/tile collision helpers                                        */
  /* ------------------------------------------------------------------ */
  function solidAtCell(c, r) {
    if (c < 0 || c >= COLS || r < 0 || r >= ROWS) return r >= ROWS ? false : false; // top open, bottom open
    const code = map[r][c];
    if (solidCodes.has(code)) return true;
    // wooden bridge tiles 49-51 are also solid
    if (code === 49 || code === 50 || code === 51) return true;
    return false;
  }

  // move an AABB by velocity, resolving against the solid grid.
  // returns ground-hit info.
  function moveEntity(e, dx, dy) {
    // horizontal
    e.x += dx;
    if (dx > 0) {
      const right = e.x + e.w;
      const c0 = Math.floor((right + 0.001) / T);
      const c1 = Math.floor((right + 0.001) / T);
      const r0 = Math.floor(e.y / T), r1 = Math.floor((e.y + e.h - 0.001) / T);
      for (let r = r0; r <= r1; r++) {
        if (solidAtCell(c1, r)) { e.x = c1 * T - e.w - 0.001; e.vx = 0; break; }
      }
    } else if (dx < 0) {
      const left = e.x;
      const c = Math.floor((left - 0.001) / T);
      const r0 = Math.floor(e.y / T), r1 = Math.floor((e.y + e.h - 0.001) / T);
      for (let r = r0; r <= r1; r++) {
        if (solidAtCell(c, r)) { e.x = (c + 1) * T + 0.001; e.vx = 0; break; }
      }
    }

    // vertical
    let grounded = false;
    e.y += dy;
    if (dy > 0) {
      const bottom = e.y + e.h;
      const c0 = Math.floor((e.x + 2) / T), c1 = Math.floor((e.x + e.w - 2) / T);
      const r = Math.floor((bottom - 0.001) / T);
      for (let c = c0; c <= c1; c++) {
        if (r < ROWS && solidAtCell(c, r)) {
          e.y = r * T - e.h - 0.001; e.vy = 0; grounded = true; break;
        }
      }
    } else if (dy < 0) {
      const top = e.y;
      const c0 = Math.floor((e.x + 2) / T), c1 = Math.floor((e.x + e.w - 2) / T);
      const r = Math.floor((top + 0.001) / T);
      for (let c = c0; c <= c1; c++) {
        if (r >= 0 && solidAtCell(c, r)) { e.y = (r + 1) * T + 0.001; e.vy = 0; bumpBlock(c, r); break; }
      }
    }
    return grounded;
  }

  function bumpBlock(c, r) {
    const code = map[r][c];
    if (code === MYSTERY) {
      const key = c + "," + r;
      const b = bumpables[key];
      if (b && !b.bumped) {
        b.bumped = true;
        // spawn a coin puff above
        coinPop(b.x + T / 2, b.y - 18, 1);
        map[r][c] = GOLD;
        AUDIO.bump();
      }
    }
    AUDIO.bump();
  }

  const coinPops = [];
  function coinPop(x, y, count) {
    for (let i = 0; i < count; i++) {
      coinPops.push({ x, y, vy: -150, t: 0, max: 0.55, taken: false });
    }
  }

  function isWater(c, r) {
    if (c < 0 || r < 0 || c >= COLS) return false;
    if (r >= ROWS) return false;
    return map[r][c] === WATER;
  }

  /* ------------------------------------------------------------------ */
  /* Update                                                              */
  /* ------------------------------------------------------------------ */
  let camX = 0;
  let bobT = 0;

  function updatePlay(dt) {
    bobT += dt;
    const p = player;
    if (!p) return;

    // input
    let dir = 0;
    if (keys["ArrowLeft"] || keys["a"] || keys["A"]) dir -= 1;
    if (keys["ArrowRight"] || keys["d"] || keys["D"]) dir += 1;
    const wantJump = jumpQueued > 0;
    if (jumpQueued > 0) jumpQueued--;

    // horizontal acceleration
    if (dir !== 0) {
      p.vx += dir * (p.onGround ? ACCEL : AIRACCEL) * dt;
      p.vx = Math.max(-MAXRUN, Math.min(MAXRUN, p.vx));
      p.face = dir;
    } else {
      const f = (p.onGround ? FRICTION : FRICTION * 0.6) * dt;
      if (Math.abs(p.vx) <= f) p.vx = 0; else p.vx -= Math.sign(p.vx) * f;
    }

    // jump
    if (wantJump && (p.onGround || p.inWater)) {
      p.vy = JUMPVEL;
      p.onGround = false;
      p.inWater = false;
      AUDIO.jump();
    }
    // variable jump: cut velocity if released early
    if (!(keys[" "] || keys["w"] || keys["W"] || keys["ArrowUp"]) && p.vy < -160) {
      p.vy = Math.max(p.vy, -160);
    }

    p.vy += GRAVITY * dt;
    if (p.vy > MAXFALL) p.vy = MAXFALL;

    // integrate with collision
    const moved = moveEntity(p, p.vx * dt, p.vy * dt);
    p.onGround = moved;

    // water check (feet in water)
    const footCell = Math.floor((p.y + p.h) / T);
    const bodyCol = Math.floor((p.x + p.w / 2) / T);
    p.inWater = isWater(bodyCol, footCell);

    // invincibility timer
    if (p.inv > 0) p.inv -= dt;

    // walk anim
    if (p.onGround && Math.abs(p.vx) > 20) p.anim += dt * 9; else p.anim = 0;

    // --- collectibles ---
    for (const c of coins) {
      if (c.taken) continue;
      const cx = c.x, cy = c.y;
      if (Math.abs(cx - (p.x + p.w / 2)) < 30 && Math.abs(cy - (p.y + p.h / 2)) < 40) {
        c.taken = true;
        if (c.kind === "gem") { score += 50; AUDIO.powerup(); }
        else { coinCount++; score += 10; AUDIO.coin(); }
      }
    }
    // coin pops
    for (let i = coinPops.length - 1; i >= 0; i--) {
      const cp = coinPops[i];
      cp.t += dt; cp.y += cp.vy * dt; cp.vy += 600 * dt;
      if (cp.t > cp.max) { // collect it
        coinCount++; score += 10; AUDIO.coin(); coinPops.splice(i, 1); continue;
      }
      const d = Math.abs(cp.x - (p.x + p.w / 2));
      if (d < 26 && Math.abs(cp.y - (p.y + p.h / 2)) < 34) {
        coinCount++; score += 10; AUDIO.coin(); coinPops.splice(i, 1);
      }
    }

    // --- enemies ---
    for (const en of enemies) {
      if (en.dead) { en.timer -= dt; if (en.timer <= 0 && en.timer > -99) {} continue; }
      en.vx = Math.sign(en.vx) * 60;
      en.x += en.vx * dt;
      // turn at walls / edges (sample below front foot)
      const frontX = en.vx > 0 ? en.x + en.w : en.x;
      const footR = Math.floor((en.y + en.h + 4) / T);
      const frontC = Math.floor(frontX / T);
      const blockC = Math.floor((en.vx > 0 ? en.x + en.w + 2 : en.x - 2) / T);
      const wall = solidAtCell(blockC, Math.floor(en.y / T)) || solidAtCell(blockC, Math.floor((en.y + en.h - 2) / T));
      if (wall) en.vx = -en.vx;
      else if (!solidAtCell(frontC, footR)) en.vx = -en.vx;
      en.frame = (bobT * 6) % 2 < 1 ? 18 : 19;

      // contact with player
      if (p.inv > 0) continue;
      if (overlap(p, en)) {
        // stomp? (player feet must be clearly above the enemy's floor line)
        const falling = p.vy > 30 && (p.y + p.h) < (en.y + en.h - 3);
        if (falling) {
          en.dead = true; en.timer = 0.4;
          score += 100; AUDIO.stomp();
          p.vy = -360;
        } else {
          hurtPlayer(p, en.x + en.w / 2);
        }
      }
    }
    for (const f of flyers) {
      if (f.dead) continue;
      f.phase += dt * 2.2;
      f.x += f.speed * Math.cos(f.phase) * dt;
      f.baseY += Math.sin(f.phase * 0.6) * 8 * dt;
      if (p.inv <= 0 && overlap(p, f)) hurtPlayer(p, f.x);
    }

    // --- checkpoints ---
    for (const cp of checkpoints) {
      if (!cp.active && p.x + p.w > cp.x) {
        cp.active = true; activeCheckpoint = cp;
        score += 25; AUDIO.checkpoint();
      }
    }

    // --- finish flag ---
    if (finishFlag && !finishFlag.reached && p.x + p.w / 2 > finishFlag.x - 18) {
      finishFlag.reached = true;
      AUDIO.fanfare();
      state = "win";
      $("winScore").textContent = score;
      $("winCoins").textContent = coinCount;
      $("overlay-win").classList.remove("hidden");
      AUDIO.stopMusic();
    }

    // --- falling out of world / down pits ---
    if (p.y > ROWS * T + 40) {
      if (!p.inWater && playerOverWater()) AUDIO.splash();
      killPlayer();
    }
    // water hazard if submerged enough
    if (p.inWater && p.y + p.h > (footYUnderWater())) {
      // count a slow dunk
      p.waterDunk = (p.waterDunk || 0) + dt;
      if (p.waterDunk > 0.5) { AUDIO.splash(); killPlayer(); }
    } else if (p.waterDunk) p.waterDunk = 0;

    // --- camera ---
    const target = Math.max(0, Math.min(p.x + p.w / 2 - VIEWW / 2, COLS * T - VIEWW));
    camX += (target - camX) * Math.min(1, dt * 6);
    camX = Math.max(0, Math.min(camX, COLS * T - VIEWW));
  }

  function playerOverWater() {
    if (!player) return false;
    const c = Math.floor((player.x + player.w / 2) / T);
    for (let r = 0; r < ROWS; r++) if (isWater(c, r)) return true;
    return false;
  }
  function footYUnderWater() {
    // returns a y threshold representing "mostly submerged"
    const c = Math.floor((player.x + player.w / 2) / T);
    for (let r = 0; r < ROWS; r++) if (map[r][c] === WATER) return (r + 0.6) * T;
    return Infinity;
  }

  function overlap(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }

  function hurtPlayer(p, fromX) {
    if (p.inv > 0) return;
    lives--;
    p.inv = 1.6;
    AUDIO.hurt();
    p.vx = (p.x + p.w / 2 < fromX ? -1 : 1) * 240;
    p.vy = -300;
    if (lives <= 0) {
      state = "dead"; stateTimer = 0.0; AUDIO.stopMusic(); AUDIO.gameover();
    }
  }

  function killPlayer() {
    lives--;
    if (lives <= 0) { AUDIO.stopMusic(); AUDIO.gameover(); startDead(); }
    else { player.inv = 1.0; respawnAfter(0.6); AUDIO.hurt(); }
  }

  function startDead() {
    state = "dead";
    stateTimer = 0;
  }

  function respawnAfter(sec) {
    // teleport to checkpoint / start after a short delay
    const spawnX = activeCheckpoint ? activeCheckpoint.x - 18 : 2 * T + 8;
    state = "respawn";
    stateTimer = sec;
    player._respawnX = spawnX;
  }

  function doRespawn() {
    const rx = player._respawnX;
    spawnPlayer(rx);
    camX = Math.max(0, Math.min(rx - VIEWW / 2, COLS * T - VIEWW));
    state = "play";
  }

  /* ------------------------------------------------------------------ */
  /* Rendering                                                           */
  /* ------------------------------------------------------------------ */
  function drawTile(img, dx, dy, sz) {
    ctx.drawImage(img, dx, dy, sz, sz);
  }

  function render() {
    ctx.clearRect(0, 0, VIEWW, VIEWH);
    ctx.imageSmoothingEnabled = false;

    // 1. sky
    const bgSky = kenneyBG(0);
    const bgs = 48;
    for (let y = 0; y < VIEWH; y += bgs)
      for (let x = 0; x < VIEWW; x += bgs)
        ctx.drawImage(bgSky, x, y, bgs, bgs);

    // 2. far parallax: cloud layer + city skyline (urban sprites + labels)
    drawClouds();
    drawFar();

    // 3. mid parallax: urban trees + utility poles
    drawMid();

    // 4. world layer: tiles
    drawWorld();

    // 5. props (world-space scenery)
    drawProps();

    // 6. entities
    drawCoins();
    drawEnemies();
    drawFlyers();
    drawFlag();
    drawPlayer();

    // 7. HUD
    drawHUD();

    // water tint handled in world draw
  }

  function drawClouds() {
    const cloud = kenneyBG(8);
    const cs = 72;
    for (let i = 0; i < 6; i++) {
      const wx = (i * 520) - camX * 0.1;
      const sx = ((wx % (VIEWW + 160)) + VIEWW + 160) % (VIEWW + 160) - 80;
      ctx.drawImage(cloud, sx, 40 + (i % 3) * 40, cs, cs);
    }
  }

  function drawFar() {
    for (const b of farBG) {
      const sx = b.worldX - camX * b.f;
      if (sx + 300 < -40 || sx > VIEWW + 40) continue;
      switch (b.kind) {
        case "stadium":
          drawBuildingStadium(sx, b.groundY);
          break;
        case "burton":
          drawBurtonTower(sx, b.groundY);
          break;
        case "block":
          drawCityBlock(sx, b.groundY, b.variant);
          break;
        case "tower":
          drawUrban(72, sx, b.groundY - 160, 210, 156); // water tower
          break;
      }
    }
    // distant tree-line silhouette at ground (Kenney bg 14)
    const treeline = kenneyBG(14);
    const ts = 96;
    const off = -((camX * 0.18) % ts);
    const gy = SURFACE_ROW * T;
    for (let x = off - ts; x < VIEWW + ts; x += ts) {
      ctx.drawImage(treeline, x, gy - 44, ts, ts);
    }
  }

  function drawGameLabel(text, x, y, cx, scale, color) {
    ctx.save();
    ctx.translate(x, y);
    ctx.font = `bold ${scale}px "Arial Black", Arial, sans-serif`;
    ctx.textAlign = "center";
    ctx.lineWidth = Math.max(2, scale / 10);
    ctx.strokeStyle = "#101820";
    ctx.strokeText(text, cx, 0);
    ctx.fillStyle = color;
    ctx.fillText(text, cx, 0);
    ctx.restore();
  }

  function drawBuildingStadium(sx, gy) {
    const h = 300, w = 250;
    drawUrban(12, sx, gy - h, w, h);           // tall facade
    drawUrban(12, sx + 150, gy - h, w * 0.7, h); // side block
    drawGameLabel("MICHIGAN STADIUM", sx + w / 2, gy - h - 30, 0, 26, "#ffcb05");
    drawGameLabel("THE BIG HOUSE", sx + w / 2, gy - h - 6, 0, 16, "#9db6e0");
  }

  function drawBurtonTower(sx, gy) {
    const w = 78, h = 340;
    // tall narrow building using teal side wall + skyscraper
    drawUrban(55, sx, gy - h, 150, h);
    drawUrban(12, sx + 40, gy - h + 60, 56, h - 60);
    // clock face at top
    ctx.beginPath();
    ctx.fillStyle = "#fffbe6"; ctx.strokeStyle = "#223"; ctx.lineWidth = 4;
    ctx.arc(sx + 70, gy - h + 44, 26, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(sx + 70, gy - h + 44); ctx.lineTo(sx + 70, gy - h + 30); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(sx + 70, gy - h + 44); ctx.lineTo(sx + 80, gy - h + 36); ctx.stroke();
    drawGameLabel("BURTON TOWER", sx + 30, gy - h - 24, 0, 26, "#ffcb05");
    drawGameLabel("CARILLON", sx + 30, gy - h - 50, 0, 16, "#c9d6ee");
  }

  function drawCityBlock(sx, gy, variant) {
    const w = 170, h = variant === 0 ? 190 : 150;
    drawUrban(variant === 0 ? 55 : 12, sx, gy - h, w, h);
    drawGameLabel(variant === 0 ? "STATE ST" : "THE ARB", sx + w / 2, gy - h - 16, 0, 20, "#dfe7f5");
  }

  function drawMid() {
    // urban trees at moderate parallax, anchored to world ground
    const trees = [ { id: 0, x: 5 * T, sc: 1.0 }, { id: 29, x: 16 * T, sc: 0.8 },
                    { id: 0, x: 28 * T, sc: 0.7 }, { id: 29, x: 90 * T, sc: 1.0 },
                    { id: 0, x: 108 * T, sc: 0.8 }, { id: 29, x: 116 * T, sc: 1.1 } ];
    for (const t of trees) {
      const sx = t.x - camX * 0.35;
      if (sx + 220 < 0 || sx > VIEWW) continue;
      const base = SURFACE_ROW * T;
      const h = 200 * t.sc, w = 220 * t.sc;
      drawUrban(t.id, sx, base - h, w, h);
    }
    // utility poles
    for (const px of [12 * T, 96 * T, 130 * T]) {
      const sx = px - camX * 0.3;
      if (sx < -120 || sx > VIEWW) continue;
      drawUrban(75, sx, SURFACE_ROW * T - 120, 120, 128);
    }
  }

  function drawWorld() {
    const c0 = Math.max(0, Math.floor(camX / T));
    const c1 = Math.min(COLS - 1, Math.floor((camX + VIEWW) / T));
    for (let c = c0; c <= c1; c++) {
      for (let r = 0; r < ROWS; r++) {
        const code = map[r][c];
        if (!code) continue;
        const x = c * T - camX, y = r * T;
        if (code === WATER) {
          // animated water
          const wav = Math.sin(bobT * 3 + c * 0.7) * 1.5;
          ctx.drawImage(kenneyTile(WATER), x, y + wav, T, T);
          ctx.fillStyle = "rgba(30,90,160,0.25)";
          ctx.fillRect(x, y + 4, T, T - 4);
          continue;
        }
        if (code === MYSTERY) {
          if (bumpables[c + "," + r] && bumpables[c + "," + r].bumped) { ctx.drawImage(kenneyTile(GOLD), x, y, T, T); }
          else { ctx.drawImage(kenneyTile(MYSTERY), x, y, T, T); }
          continue;
        }
        // bumpable solid blocks & ground draw their actual tile
        ctx.drawImage(kenneyTile(code), x, y, T, T);
      }
    }
    // grass-top highlights: draw a brighter stripe on top row grass for readability
    for (let c = c0; c <= c1; c++) {
      if (groundAt(c, SURFACE_ROW)) {
        ctx.drawImage(kenneyTile(GRASS_TOP), c * T - camX, SURFACE_ROW * T, T, 8);
      }
    }
  }

  function drawProps() {
    for (const p of props) {
      const x = p.x - camX;
      if (x + p.w < -10 || x > VIEWW + 10) continue;
      if (p.urban !== undefined) { drawUrban(p.urban, x, p.y, p.w, p.h); continue; }
      if (p.tile !== undefined) { ctx.drawImage(kenneyTile(p.tile), x, p.y, p.w, p.h); continue; }
      if (p.sign !== undefined) {
        // wooden sign board
        ctx.fillStyle = "#5b3b1e";
        ctx.fillRect(x + 4, p.y, p.w - 8, p.h);
        ctx.fillStyle = "#3a2512";
        ctx.fillRect(x + 4, p.y + p.h - 10, p.w - 8, 10); // post
        ctx.fillStyle = "#8a5a2b";
        ctx.fillRect(x, p.y, p.w, p.h);
        ctx.strokeStyle = "#5b3b1e"; ctx.lineWidth = 3;
        ctx.strokeRect(x, p.y, p.w, p.h);
        ctx.fillStyle = "#fff7e0";
        ctx.font = "bold 16px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(p.sign, x + p.w / 2, p.y + 24);
        ctx.font = "11px sans-serif";
        ctx.fillStyle = "#ffe9b0";
        ctx.fillText(p.sub || "", x + p.w / 2, p.y + p.h - 16);
      }
    }
  }

  function drawCoins() {
    for (const c of coins) {
      if (c.taken) continue;
      const x = c.x - camX;
      if (x < -24 || x > VIEWW + 24) continue;
      const b = Math.sin(bobT * 5 + c.x) * 4;
      const img = kenneyTile(c.kind === "gem" ? 152 : 151);
      // simple spin via horizontal scale
      const sc = Math.abs(Math.cos(bobT * 4 + c.x));
      const w = 26 * Math.max(0.18, sc) + 2;
      const hh = 26;
      ctx.imageSmoothingEnabled = false;
      ctx.save();
      ctx.translate(x, c.y + b);
      ctx.scale(Math.max(0.18, sc), 1);
      ctx.drawImage(img, -13, -hh / 2 - 2, 26, hh);
      ctx.restore();
    }
  }

  function drawEnemies() {
    for (const e of enemies) {
      const x = e.x - camX;
      if (x < -50 || x > VIEWW + 50) continue;
      let idx = 19;
      if (e.dead) idx = 20;
      else idx = e.frame;
      const img = kenneyChar(idx);
      ctx.drawImage(img, x - 4, e.y - 10, 48, 48);
      if (e.dead) {
        ctx.globalAlpha = Math.max(0, e.timer / 0.4);
        ctx.drawImage(img, x - 4, e.y - 10 + 12, 48, 24);
        ctx.globalAlpha = 1;
      }
    }
  }

  function drawFlyers() {
    for (const f of flyers) {
      if (f.dead) continue;
      const x = f.x - camX;
      if (x < -50 || x > VIEWW + 50) continue;
      const img = kenneyChar(f.speed > 0 ? 24 : 15);
      ctx.drawImage(img, x - 6, f.baseY - 10, 52, 44);
    }
  }

  function drawPlayer() {
    const p = player; if (!p) return;
    if (state !== "play" && state !== "respawn") return;
    if (p.inv > 0 && Math.floor(bobT * 12) % 2 === 0) return; // blink
    const img = kenneyChar(p.face > 0 ? 6 : 7);
    const x = p.x - camX - 10, y = p.y - 4;
    ctx.drawImage(img, x, y, 48, 52);
  }

  function drawFlag() {
    if (!finishFlag) return;
    const x = finishFlag.x - camX, gy = finishFlag.y;
    // pole
    ctx.fillStyle = "#d7e1ee"; ctx.fillRect(x - 2, gy - 130, 4, 134);
    // flag
    const wave = Math.sin(bobT * 6) * 3;
    ctx.save();
    ctx.translate(x, gy - 130);
    ctx.rotate(wave * 0.02);
    ctx.drawImage(kenneyTile(112), 2, -14, 34, 30);
    ctx.restore();
    drawGameLabel("FINISH", x, gy - 140, 0, 18, "#9be6ff");
  }

  function drawHUD() {
    ctx.save();
    ctx.fillStyle = "rgba(10,16,32,0.55)";
    ctx.fillRect(0, 0, VIEWW, 34);
    // hearts
    for (let i = 0; i < 3; i++) {
      const idx = i < lives ? 44 : (lives === i ? 45 : 46);
      ctx.drawImage(kenneyTile(idx), 12 + i * 30, 5, 26, 24);
    }
    ctx.fillStyle = "#fff";
    ctx.font = "bold 16px monospace";
    ctx.textAlign = "left";
    ctx.fillText("SCORE " + score, 110, 23);
    ctx.fillStyle = "#ffcb05";
    ctx.fillText("◎ " + coinCount, 250, 23);
    ctx.textAlign = "right";
    ctx.fillStyle = "#cfd8e8";
    ctx.fillText("STATE ST →", VIEWW - 14, 23);
    ctx.restore();
  }

  /* ------------------------------------------------------------------ */
  /* Main loop + state                                                   */
  /* ------------------------------------------------------------------ */
  let lastFrame = 0;
  let acc = 0;

  function frame(t) {
    const dtms = Math.min(50, t - lastFrame || 0);
    lastFrame = t;
    const dt = dtms / 1000;
    acc += dt;
    if (state === "play") {
      const step = 1 / 120;
      while (acc >= step) { updatePlay(step); acc -= step; }
    } else if (state === "respawn") {
      stateTimer -= dt;
      if (stateTimer <= 0) doRespawn();
    } else if (state === "dead") {
      stateTimer -= dt;
      if (stateTimer <= -0.6) {
        state = "over";
        $("overlay-over").classList.remove("hidden");
        AUDIO.stopMusic();
      }
    }
    render();
    requestAnimationFrame(frame);
  }

  /* ------------------------------------------------------------------ */
  /* UI wiring                                                           */
  /* ------------------------------------------------------------------ */
  function hideAllOverlays() {
    ["overlay-title", "overlay-pause", "overlay-over", "overlay-win"].forEach((id) => $(id).classList.add("hidden"));
  }

  $("btnStart").addEventListener("click", startGame);
  $("btnRetry").addEventListener("click", () => { $("overlay-over").classList.add("hidden"); resetRun(); startPlay(); });
  $("btnAgain").addEventListener("click", () => { $("overlay-win").classList.add("hidden"); resetRun(); startPlay(); });

  window.addEventListener("keydown", (e) => {
    if (state === "menu") return;
    if ((e.key === "p" || e.key === "P" || e.key === "Escape")) {
      if (state === "play") { AUDIO.stopMusic(); state = "paused"; $("overlay-pause").classList.remove("hidden"); }
      else if (state === "paused") { $("overlay-pause").classList.add("hidden"); state = "play"; AUDIO.startMusic(); }
    }
  });

  function startGame() {
    AUDIO.init(); AUDIO.resume();
    hideAllOverlays();
    resetRun();
    startPlay();
  }

  function startPlay() {
    state = "play";
    AUDIO.startMusic();
  }

  /* ------------------------------------------------------------------ */
  /* Boot                                                                */
  /* ------------------------------------------------------------------ */
  let booted = false;
  async function boot() {
    if (booted) return;
    booted = true;
    state = "loading";
    await loadAssets();
    buildLevel();
    buildBG();
    resetRun();
    state = "menu";
    requestAnimationFrame(frame);
  }
  if (document.readyState === "loading") window.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
