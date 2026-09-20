/* ============================================================
   MAIZE & BLUE — An Ann Arbor Platformer
   Single-file HTML5 canvas game.
   Physics tiles: Kenney "Pixel Platformer" kit (CC0)
   Skyline/decor: Urban City Tileset © Dlou Saiyan (credit required)
   Audio: procedural Web Audio API chiptune (no external files)
   ============================================================ */
"use strict";

// ---------------- Constants ----------------
const TILE = 18;
const CANVAS_W = 640, CANVAS_H = 360;
const GRAVITY = 0.55;
const MAX_FALL = 10;
const PLAYER_ACC = 0.35, PLAYER_FRICTION = 0.82, PLAYER_MAXVX = 3.2;
const JUMP_VEL = -9.6;
const JUMP_CUT = 0.45; // multiply vy when jump released early
const COYOTE = 6;      // frames
const JUMP_BUFFER = 6; // frames

// ---------------- Canvas ----------------
const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
ctx.imageSmoothingEnabled = false;

// ---------------- Asset loading ----------------
const TILE_FILES = [];
for (let i = 0; i < 180; i++) {
  TILE_FILES.push("sprites/Tiles/" + String(i).padStart(4, "0") + ".png");
}
const CHAR_FILES = [];
for (let i = 0; i < 27; i++) {
  CHAR_FILES.push("sprites/Tiles/Characters/" + String(i).padStart(4, "0") + ".png");
}
const BG_FILES = [];
for (let i = 0; i < 24; i++) {
  BG_FILES.push("sprites/Tiles/Backgrounds/" + String(i).padStart(4, "0") + ".png");
}

const tiles = [];      // 180 world tile images
const chars = [];      // 27 character images
const bgs = [];        // 24 background images
let urbanImg = null;   // urban tileset sheet
let urbanManifest = null;
let loadProgress = 0, loadTotal = 0;
let allLoaded = false;

function loadAll() {
  loadTotal = TILE_FILES.length + CHAR_FILES.length + BG_FILES.length + 2; // +urban img +manifest
  const img = (src, cb) => {
    const im = new Image();
    im.onload = () => { loadProgress++; cb(im); };
    im.onerror = () => { loadProgress++; cb(null); };
    im.src = src;
  };
  TILE_FILES.forEach((f, i) => img(f, im => tiles[i] = im));
  CHAR_FILES.forEach((f, i) => img(f, im => chars[i] = im));
  BG_FILES.forEach((f, i) => img(f, im => bgs[i] = im));
  img("urbantileset/urbantileset32x32.png", im => urbanImg = im);
  fetch("manifest/urban_tileset_manifest.json")
    .then(r => r.json()).then(j => { urbanManifest = j; loadProgress++; })
    .catch(() => { loadProgress++; });
  // poll for completion
  const iv = setInterval(() => {
    if (loadProgress >= loadTotal) { allLoaded = true; clearInterval(iv); }
  }, 50);
}
loadAll();

// Check if an image is actually loaded and drawable
function imgReady(img) {
  return img && img.naturalWidth > 0;
}

function uSprite(id) {
  if (!urbanManifest) return null;
  return urbanManifest.sprites.find(s => s.id === id) || null;
}
function drawUrban(id, dx, dy, scale) {
  const s = uSprite(id);
  if (!s || !imgReady(urbanImg)) return;
  const sc = scale || 1;
  ctx.drawImage(urbanImg, s.x, s.y, s.w, s.h, dx, dy, s.w * sc, s.h * sc);
}

// ---------------- Input ----------------
const keys = {};
addEventListener("keydown", e => {
  keys[e.code] = true;
  if (["ArrowUp","ArrowDown","ArrowLeft","ArrowRight","Space"].includes(e.code)) e.preventDefault();
  if (e.code === "KeyM") audio.toggleMute();
  if (e.code === "Enter" && (game.state === "title" || game.state === "dead" || game.state === "win")) {
    audio.ensure();
    if (game.state === "title") startGame();
    else restart();
  }
});
addEventListener("keyup", e => {
  keys[e.code] = false;
  if (e.code === "Space" && game.player && game.player.vy < 0) {
    game.player.vy *= JUMP_CUT;
  }
});

// ---------------- Audio (procedural Web Audio) ----------------
const audio = {
  ctx: null, master: null, musicGain: null, sfxGain: null,
  muted: false, musicOn: false,
  step: 0, nextNoteTime: 0, timer: null,
  // 8-bar loop, 120 BPM, 8th notes. Key of C major with a little twist.
  // Chord progression: C  Am  F  G  (classic)
  // Melody (MIDI notes, 0 = rest):
  melody: [
    72,0,74,76, 79,0,76,74,   // bar 1: C
    72,0,76,79, 81,0,79,76,   // bar 2: Am (use A notes)
    74,0,77,79, 84,0,79,77,   // bar 3: F
    76,0,79,81, 83,0,81,79,   // bar 4: G
    72,0,74,76, 79,0,76,74,   // bar 5: C
    72,0,76,79, 81,0,79,76,   // bar 6: Am
    74,0,77,79, 84,0,79,77,   // bar 7: F
    76,0,79,81, 83,84,86,83   // bar 8: G -> resolve up
  ],
  bass: [
    48,48,55,48, 45,45,52,45,   // C
    45,45,52,45, 45,45,52,45,   // Am
    41,41,48,41, 41,41,48,41,   // F
    43,43,50,43, 43,43,50,43,   // G
    48,48,55,48, 45,45,52,45,
    45,45,52,45, 45,45,52,45,
    41,41,48,41, 41,41,48,41,
    43,43,50,43, 43,43,50,43
  ],
  // Arpeggio pattern (relative semitones from chord root)
  arpPattern: [0, 4, 7, 12, 7, 4],
  ensure() {
    if (this.ctx) { if (this.ctx.state === "suspended") this.ctx.resume(); return; }
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.master = this.ctx.createGain(); this.master.gain.value = 0.5;
    this.master.connect(this.ctx.destination);
    this.musicGain = this.ctx.createGain(); this.musicGain.gain.value = 0.35;
    this.musicGain.connect(this.master);
    this.sfxGain = this.ctx.createGain(); this.sfxGain.gain.value = 0.6;
    this.sfxGain.connect(this.master);
  },
  midiToFreq(m) { return 440 * Math.pow(2, (m - 69) / 12); },
  playNote(freq, time, dur, type, gain, dest) {
    if (!this.ctx) return;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(gain, time);
    g.gain.exponentialRampToValueAtTime(0.001, time + dur);
    o.connect(g); g.connect(dest || this.musicGain);
    o.start(time); o.stop(time + dur + 0.02);
  },
  startMusic() {
    this.ensure();
    if (this.musicOn) return;
    this.musicOn = true;
    this.step = 0;
    this.nextNoteTime = this.ctx.currentTime + 0.1;
    const tick = () => {
      if (!this.musicOn) return;
      const spb = 60 / 120 / 2; // 8th note at 120bpm
      while (this.nextNoteTime < this.ctx.currentTime + 0.2) {
        const s = this.step % 64;
        const m = this.melody[s];
        if (m) this.playNote(this.midiToFreq(m), this.nextNoteTime, spb * 0.9, "square", 0.18);
        const b = this.bass[s];
        if (b) this.playNote(this.midiToFreq(b), this.nextNoteTime, spb * 1.8, "triangle", 0.22);
        // arpeggio: play on every 8th, chord root shifts per bar
        const bar = Math.floor(s / 8);
        const chordRoots = [48, 45, 41, 43]; // C A F G
        const root = chordRoots[bar % 4];
        const arpNote = root + this.arpPattern[this.step % this.arpPattern.length];
        this.playNote(this.midiToFreq(arpNote), this.nextNoteTime, spb * 0.5, "triangle", 0.08);
        // hi-hat: short noise on off-beats
        if (this.step % 2 === 1) this.hat(this.nextNoteTime);
        this.nextNoteTime += spb;
        this.step++;
      }
      this.timer = setTimeout(tick, 25);
    };
    tick();
  },
  stopMusic() { this.musicOn = false; if (this.timer) clearTimeout(this.timer); },
  hat(time) {
    if (!this.ctx) return;
    const buf = this.ctx.createBuffer(1, 220, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    const src = this.ctx.createBufferSource(); src.buffer = buf;
    const g = this.ctx.createGain(); g.gain.value = 0.05;
    const f = this.ctx.createBiquadFilter(); f.type = "highpass"; f.frequency.value = 6000;
    src.connect(f); f.connect(g); g.connect(this.musicGain);
    src.start(time);
  },
  sfx(type) {
    this.ensure();
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.connect(g); g.connect(this.sfxGain);
    if (type === "jump") {
      o.type = "square";
      o.frequency.setValueAtTime(300, t);
      o.frequency.exponentialRampToValueAtTime(600, t + 0.1);
      g.gain.setValueAtTime(0.2, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
      o.start(t); o.stop(t + 0.15);
    } else if (type === "coin") {
      o.type = "square";
      o.frequency.setValueAtTime(900, t);
      o.frequency.setValueAtTime(1200, t + 0.05);
      g.gain.setValueAtTime(0.15, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
      o.start(t); o.stop(t + 0.15);
    } else if (type === "stomp") {
      o.type = "triangle";
      o.frequency.setValueAtTime(200, t);
      o.frequency.exponentialRampToValueAtTime(60, t + 0.15);
      g.gain.setValueAtTime(0.3, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
      o.start(t); o.stop(t + 0.2);
    } else if (type === "hurt") {
      o.type = "sawtooth";
      o.frequency.setValueAtTime(200, t);
      o.frequency.exponentialRampToValueAtTime(80, t + 0.3);
      g.gain.setValueAtTime(0.25, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
      o.start(t); o.stop(t + 0.35);
    } else if (type === "powerup") {
      o.type = "square";
      o.frequency.setValueAtTime(500, t);
      o.frequency.setValueAtTime(700, t + 0.08);
      o.frequency.setValueAtTime(900, t + 0.16);
      g.gain.setValueAtTime(0.15, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
      o.start(t); o.stop(t + 0.3);
    } else if (type === "win") {
      o.type = "square";
      [523, 659, 784, 1047].forEach((f, i) => {
        const o2 = this.ctx.createOscillator();
        const g2 = this.ctx.createGain();
        o2.type = "square"; o2.frequency.value = f;
        g2.gain.setValueAtTime(0.15, t + i * 0.12);
        g2.gain.exponentialRampToValueAtTime(0.001, t + i * 0.12 + 0.2);
        o2.connect(g2); g2.connect(this.sfxGain);
        o2.start(t + i * 0.12); o2.stop(t + i * 0.12 + 0.2);
      });
      return;
    }
  },
  toggleMute() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.5;
  }
};

// ---------------- Level data ----------------
// Tile IDs (Kenney world tiles, 0-indexed):
//  0-3: grass-top dirt (top row)
//  40-43, 60-63, 80-83: bordered dirt fill
//  6: brick
//  10: mystery "?" chest
//  67: blue diamond gem (coin)
//  151: gold coin
//  111: checkered flag (goal)
//  84-88: wooden signposts
//  16-19: hedge
//  130: tall cabinet/door
//  94-95: pipe
const T = {
  EMPTY: 0,
  GRASS: 1,      // top surface
  DIRT: 2,       // fill
  BRICK: 3,
  QUESTION: 4,   // mystery block
  HEDGE: 5,
  PIPE: 6,
  DOOR: 7,
  SIGN: 8
};

// Level is a grid of tile IDs. We'll build it as a 2D array.
// Width: ~180 tiles, Height: 20 tiles.
const LW = 180, LH = 20;
let level = [];

function buildLevel() {
  level = [];
  for (let y = 0; y < LH; y++) {
    level[y] = [];
    for (let x = 0; x < LW; x++) level[y][x] = T.EMPTY;
  }
  const set = (x, y, t) => { if (x >= 0 && x < LW && y >= 0 && y < LH) level[y][x] = t; };
  const ground = (x0, x1, yTop) => {
    for (let x = x0; x <= x1; x++) {
      set(x, yTop, T.GRASS);
      for (let y = yTop + 1; y < LH; y++) set(x, y, T.DIRT);
    }
  };
  const platform = (x0, x1, y) => {
    for (let x = x0; x <= x1; x++) set(x, y, T.BRICK);
  };

  // --- Section 1: Start (cols 0-25) ---
  ground(0, 25, 16);
  // A few question blocks
  set(8, 12, T.QUESTION);
  set(9, 12, T.QUESTION);
  set(10, 12, T.QUESTION);
  // Signpost
  set(15, 15, T.SIGN);
  // Hedge decoration
  for (let x = 20; x < 24; x++) set(x, 15, T.HEDGE);

  // --- Section 2: The Diag (cols 26-55) ---
  ground(26, 55, 16);
  // Gap
  // Platform over gap
  platform(30, 34, 13);
  // More question blocks
  set(38, 12, T.QUESTION);
  set(39, 12, T.QUESTION);
  // Bench area (decoration, no collision)
  // Gap with pipes
  set(45, 14, T.PIPE);
  set(45, 15, T.PIPE);
  set(46, 14, T.PIPE);
  set(46, 15, T.PIPE);
  platform(48, 52, 12);

  // --- Section 3: Michigan Stadium (cols 56-90) ---
  ground(56, 90, 16);
  // Stairs up (1 tile rise per column)
  for (let i = 0; i < 4; i++) {
    for (let y = 16 - i; y <= 16; y++) set(60 + i, y, T.DIRT);
  }
  // Stadium platform at row 12
  for (let x = 64; x <= 76; x++) {
    for (let y = 12; y <= 16; y++) set(x, y, T.DIRT);
    set(x, 11, T.GRASS);
  }
  // Question blocks on platform
  set(68, 8, T.QUESTION);
  set(69, 8, T.QUESTION);
  set(70, 8, T.QUESTION);
  // Stairs down (1 tile drop per column)
  for (let i = 0; i < 4; i++) {
    for (let y = 12 + i + 1; y <= 16; y++) set(77 + i, y, T.DIRT);
  }
  // Gap
  // Pipes
  set(85, 13, T.PIPE);
  set(85, 14, T.PIPE);
  set(85, 15, T.PIPE);
  set(86, 13, T.PIPE);
  set(86, 14, T.PIPE);
  set(86, 15, T.PIPE);

  // --- Section 4: Burton Tower (cols 91-120) ---
  ground(91, 120, 16);
  // Tall tower structure (cols 100-101, rows 5-16)
  for (let y = 5; y <= 16; y++) {
    set(100, y, T.BRICK);
    set(101, y, T.BRICK);
  }
  // Tower top platform
  platform(98, 104, 4);
  // Question block on top
  set(101, 1, T.QUESTION);
  // Climbing platforms to reach the tower top
  platform(93, 95, 13);   // step 1: ground(16) -> 13
  platform(96, 98, 10);   // step 2: 13 -> 10
  platform(93, 95, 7);    // step 3: 10 -> 7
  platform(96, 98, 4);    // step 4: 7 -> 4 (tower top level)
  // Floating platforms after the tower
  platform(108, 111, 13);
  platform(114, 117, 11);
  // Pipes
  set(119, 14, T.PIPE);
  set(119, 15, T.PIPE);

  // --- Section 5: Zingerman's / Main St (cols 121-150) ---
  ground(121, 150, 16);
  // Storefront area
  // Question blocks
  set(125, 12, T.QUESTION);
  set(126, 12, T.QUESTION);
  set(127, 12, T.QUESTION);
  // Hedge
  for (let x = 130; x < 134; x++) set(x, 15, T.HEDGE);
  // Gap
  // Platform
  platform(136, 140, 13);
  // More hedges
  for (let x = 143; x < 147; x++) set(x, 15, T.HEDGE);

  // --- Section 6: Final stretch to goal (cols 151-179) ---
  ground(151, 179, 16);
  // Gentle stairs up (1 tile rise per column)
  for (let i = 0; i < 5; i++) {
    for (let y = 16 - i; y <= 16; y++) set(158 + i, y, T.DIRT);
  }
  // Landing at row 12
  for (let x = 163; x <= 168; x++) {
    for (let y = 12; y <= 16; y++) set(x, y, T.DIRT);
    set(x, 11, T.GRASS);
  }
  // Goal flag on the landing
  set(170, 10, T.DOOR);
  set(170, 9, T.DOOR);
  // Question blocks above the landing
  set(165, 8, T.QUESTION);
  set(166, 8, T.QUESTION);
  set(167, 8, T.QUESTION);
}

// ---------------- Entities ----------------
function makePlayer(x, y) {
  return {
    x, y, w: 16, h: 22,
    vx: 0, vy: 0,
    onGround: false,
    facing: 1,
    frame: 0, frameTimer: 0,
    coyote: 0, jumpBuffer: 0,
    invuln: 0,
    dead: false
  };
}

function makeEnemy(x, y, type) {
  // type: "rover" (ground), "drone" (flying)
  return {
    x, y, w: 20, h: 18,
    vx: type === "drone" ? 0.5 : 0.8,
    vy: 0,
    type,
    onGround: false,
    frame: 0, frameTimer: 0,
    dead: false,
    deadTimer: 0,
    patrolLeft: x - 40, patrolRight: x + 40,
    baseY: y
  };
}

function makeCoin(x, y) {
  return { x, y, w: 12, h: 12, collected: false, bob: Math.random() * Math.PI * 2 };
}

// ---------------- Game state ----------------
const game = {
  state: "title", // title, playing, dead, win
  player: null,
  enemies: [],
  coins: [],
  score: 0,
  lives: 3,
  coinsCollected: 0,
  totalCoins: 0,
  camera: { x: 0, y: 0 },
  time: 0,
  questionBlocks: {}, // "x,y" -> { used: bool, popTimer: 0 }
  particles: [],
  signs: [] // { x, y, text, w }
};

function startGame() {
  game.state = "playing";
  game.score = 0;
  game.lives = 3;
  game.coinsCollected = 0;
  game.time = 0;
  game.particles = [];
  game.questionBlocks = {};
  buildLevel();
  placeEntities();
  game.player = makePlayer(3 * TILE, 14 * TILE);
  audio.startMusic();
}

function restart() {
  startGame();
}

function placeEntities() {
  game.enemies = [];
  game.coins = [];
  game.signs = [];

  // Enemies
  game.enemies.push(makeEnemy(30 * TILE, 15 * TILE, "rover"));
  game.enemies.push(makeEnemy(40 * TILE, 15 * TILE, "rover"));
  game.enemies.push(makeEnemy(42 * TILE, 15 * TILE, "rover"));
  game.enemies.push(makeEnemy(65 * TILE, 10 * TILE, "rover"));
  game.enemies.push(makeEnemy(70 * TILE, 10 * TILE, "rover"));
  game.enemies.push(makeEnemy(80 * TILE, 15 * TILE, "rover"));
  game.enemies.push(makeEnemy(95 * TILE, 15 * TILE, "rover"));
  game.enemies.push(makeEnemy(105 * TILE, 15 * TILE, "rover"));
  game.enemies.push(makeEnemy(110 * TILE, 12 * TILE, "rover"));
  game.enemies.push(makeEnemy(115 * TILE, 10 * TILE, "rover"));
  game.enemies.push(makeEnemy(125 * TILE, 15 * TILE, "rover"));
  game.enemies.push(makeEnemy(135 * TILE, 15 * TILE, "rover"));
  game.enemies.push(makeEnemy(145 * TILE, 15 * TILE, "rover"));
  game.enemies.push(makeEnemy(160 * TILE, 15 * TILE, "rover"));
  // Drones (flying)
  game.enemies.push(makeEnemy(50 * TILE, 10 * TILE, "drone"));
  game.enemies.push(makeEnemy(88 * TILE, 9 * TILE, "drone"));
  game.enemies.push(makeEnemy(112 * TILE, 8 * TILE, "drone"));
  game.enemies.push(makeEnemy(140 * TILE, 9 * TILE, "drone"));
  game.enemies.push(makeEnemy(165 * TILE, 7 * TILE, "drone"));

  // Coins (scattered)
  const coinPositions = [
    [10, 11], [11, 11], [12, 11],
    [31, 12], [32, 12], [33, 12],
    [38, 11], [39, 11],
    [49, 11], [50, 11], [51, 11],
    [66, 10], [67, 10], [68, 10], [69, 10], [70, 10], [71, 10], [72, 10], [73, 10], [74, 10],
    [68, 7], [69, 7], [70, 7],
    [99, 2], [100, 2], [101, 2], [102, 2], [103, 2],
    [101, -1], // on top of tower
    [109, 12], [110, 12],
    [115, 10], [116, 10],
    [125, 11], [126, 11], [127, 11],
    [137, 12], [138, 12], [139, 12],
    [158, 15], [159, 14], [160, 13], [161, 12],
    [164, 10], [165, 10], [166, 10], [167, 10],
    [165, 7], [166, 7], [167, 7]
  ];
  coinPositions.forEach(([cx, cy]) => {
    game.coins.push(makeCoin(cx * TILE + 3, cy * TILE + 3));
  });
  game.totalCoins = game.coins.length;

  // Signs (Ann Arbor landmarks)
  game.signs = [
    { x: 2 * TILE, y: 10 * TILE, text: "WELCOME TO ANN ARBOR", size: 14 },
    { x: 28 * TILE, y: 11 * TILE, text: "THE DIAG", size: 16 },
    { x: 60 * TILE, y: 6 * TILE, text: "MICHIGAN STADIUM", size: 16 },
    { x: 98 * TILE, y: 1 * TILE, text: "BURTON TOWER", size: 14 },
    { x: 122 * TILE, y: 11 * TILE, text: "MAIN STREET", size: 14 },
    { x: 126 * TILE, y: 9 * TILE, text: "GINGER'S BAGELS", size: 12 },
    { x: 140 * TILE, y: 11 * TILE, text: "THE PLAZA", size: 14 },
    { x: 165 * TILE, y: 5 * TILE, text: "GO WOLVERINES!", size: 16 }
  ];
}

// ---------------- Collision ----------------
function solidAt(tx, ty) {
  if (tx < 0 || tx >= LW) return true;
  if (ty < 0) return false;
  if (ty >= LH) return false;
  const t = level[ty][tx];
  return t === T.GRASS || t === T.DIRT || t === T.BRICK || t === T.QUESTION || t === T.PIPE || t === T.DOOR || t === T.HEDGE;
}

function rectHitsSolid(x, y, w, h) {
  const x0 = Math.floor(x / TILE), x1 = Math.floor((x + w - 1) / TILE);
  const y0 = Math.floor(y / TILE), y1 = Math.floor((y + h - 1) / TILE);
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      if (solidAt(tx, ty)) return true;
    }
  }
  return false;
}

function moveEntity(e, dt) {
  // Horizontal
  e.x += e.vx;
  if (rectHitsSolid(e.x, e.y, e.w, e.h)) {
    if (e.vx > 0) {
      e.x = Math.floor((e.x + e.w) / TILE) * TILE - e.w - 0.01;
    } else if (e.vx < 0) {
      e.x = (Math.floor(e.x / TILE) + 1) * TILE + 0.01;
    }
    e.vx = 0;
  }
  // Vertical
  e.y += e.vy;
  e.onGround = false;
  if (rectHitsSolid(e.x, e.y, e.w, e.h)) {
    if (e.vy > 0) {
      e.y = Math.floor((e.y + e.h) / TILE) * TILE - e.h - 0.01;
      e.vy = 0;
      e.onGround = true;
    } else if (e.vy < 0) {
      e.y = (Math.floor(e.y / TILE) + 1) * TILE + 0.01;
      e.vy = 0;
      // Hit question block from below?
      hitQuestionBelow(e);
    }
  }
}

function hitQuestionBelow(e) {
  // Check tiles just above the entity's head
  const headY = Math.floor((e.y - 1) / TILE);
  const x0 = Math.floor(e.x / TILE), x1 = Math.floor((e.x + e.w - 1) / TILE);
  for (let tx = x0; tx <= x1; tx++) {
    if (headY >= 0 && headY < LH && level[headY][tx] === T.QUESTION) {
      const key = tx + "," + headY;
      const qb = game.questionBlocks[key] || { used: false, popTimer: 0 };
      if (!qb.used) {
        qb.used = true;
        qb.popTimer = 15;
        game.questionBlocks[key] = qb;
        // Spawn coin
        game.score += 100;
        game.coinsCollected++;
        audio.sfx("coin");
        spawnParticles(tx * TILE + TILE / 2, headY * TILE, "#ffd700", 6);
      }
      break;
    }
  }
}

function spawnParticles(x, y, color, n) {
  for (let i = 0; i < n; i++) {
    game.particles.push({
      x, y,
      vx: (Math.random() - 0.5) * 4,
      vy: -Math.random() * 4 - 1,
      life: 30,
      color
    });
  }
}

// ---------------- Update ----------------
function update() {
  if (game.state !== "playing") return;
  game.time++;

  const p = game.player;
  if (p.dead) {
    p.deadTimer++;
    if (p.deadTimer > 60) {
      game.lives--;
      if (game.lives <= 0) {
        game.state = "dead";
        audio.stopMusic();
      } else {
        p.dead = false;
        p.deadTimer = 0;
        p.x = 3 * TILE; p.y = 14 * TILE;
        p.vx = 0; p.vy = 0;
        p.invuln = 90;
        game.camera.x = 0;
      }
    }
    return;
  }

  // Input
  if (keys["ArrowLeft"] || keys["KeyA"]) {
    p.vx -= PLAYER_ACC;
    p.facing = -1;
  } else if (keys["ArrowRight"] || keys["KeyD"]) {
    p.vx += PLAYER_ACC;
    p.facing = 1;
  } else {
    p.vx *= PLAYER_FRICTION;
    if (Math.abs(p.vx) < 0.1) p.vx = 0;
  }
  p.vx = Math.max(-PLAYER_MAXVX, Math.min(PLAYER_MAXVX, p.vx));

  // Jump
  if (p.onGround) p.coyote = COYOTE;
  else if (p.coyote > 0) p.coyote--;
  if (keys["Space"] || keys["ArrowUp"] || keys["KeyW"]) {
    if (p.jumpBuffer === 0) p.jumpBuffer = JUMP_BUFFER;
  }
  if (p.jumpBuffer > 0) p.jumpBuffer--;
  if ((keys["Space"] || keys["ArrowUp"] || keys["KeyW"]) && (p.onGround || p.coyote > 0) && p.jumpBuffer > 0) {
    p.vy = JUMP_VEL;
    p.onGround = false;
    p.coyote = 0;
    p.jumpBuffer = 0;
    audio.sfx("jump");
  }

  // Gravity
  p.vy += GRAVITY;
  if (p.vy > MAX_FALL) p.vy = MAX_FALL;

  moveEntity(p);

  // Fell off bottom
  if (p.y > LH * TILE + 100) {
    p.dead = true;
    p.deadTimer = 0;
    audio.sfx("hurt");
    return;
  }

  // Animation
  p.frameTimer++;
  if (Math.abs(p.vx) > 0.3) {
    if (p.frameTimer > 8) { p.frame = (p.frame + 1) % 2; p.frameTimer = 0; }
  } else {
    p.frame = 0;
  }
  if (p.invuln > 0) p.invuln--;

  // Question block pop timers
  for (const key in game.questionBlocks) {
    const qb = game.questionBlocks[key];
    if (qb.popTimer > 0) qb.popTimer--;
  }

  // Enemies
  for (const e of game.enemies) {
    if (e.dead) {
      e.deadTimer++;
      continue;
    }
    if (e.type === "rover") {
      e.vy += GRAVITY;
      if (e.vy > MAX_FALL) e.vy = MAX_FALL;
      moveEntity(e);
      // Patrol: reverse at edges or walls
      if (e.onGround) {
        const aheadX = e.vx > 0 ? e.x + e.w + 2 : e.x - 2;
        const belowY = e.y + e.h + 2;
        if (!solidAt(Math.floor(aheadX / TILE), Math.floor(belowY / TILE))) {
          e.vx *= -1;
        }
      }
      if (e.vx === 0) e.vx = 0.8 * (Math.random() > 0.5 ? 1 : -1);
    } else if (e.type === "drone") {
      e.x += e.vx;
      e.y = e.baseY + Math.sin(game.time * 0.05 + e.x * 0.01) * 20;
      if (e.x < e.patrolLeft || e.x > e.patrolRight) e.vx *= -1;
    }
    e.frameTimer++;
    if (e.frameTimer > 10) { e.frame = (e.frame + 1) % 2; e.frameTimer = 0; }

    // Player collision
    if (!p.dead && p.invuln === 0 &&
        p.x < e.x + e.w && p.x + p.w > e.x &&
        p.y < e.y + e.h && p.y + p.h > e.y) {
      // Stomp?
      if (p.vy > 0 && p.y + p.h - e.y < 12) {
        e.dead = true;
        e.deadTimer = 0;
        p.vy = -6;
        game.score += 200;
        audio.sfx("stomp");
        spawnParticles(e.x + e.w / 2, e.y + e.h / 2, "#888", 8);
      } else {
        p.dead = true;
        p.deadTimer = 0;
        audio.sfx("hurt");
      }
    }
  }

  // Coins
  for (const c of game.coins) {
    if (c.collected) continue;
    c.bob += 0.1;
    if (p.x < c.x + c.w && p.x + p.w > c.x &&
        p.y < c.y + c.h && p.y + p.h > c.y) {
      c.collected = true;
      game.score += 50;
      game.coinsCollected++;
      audio.sfx("coin");
      spawnParticles(c.x + c.w / 2, c.y + c.h / 2, "#4488ff", 5);
    }
  }

  // Goal check (flag at col 170, rows 9-10; landing at row 11)
  const goalX = 169 * TILE;
  if (p.x + p.w > goalX && p.y + p.h > 8 * TILE && p.y < 12 * TILE) {
    game.state = "win";
    game.score += 1000;
    audio.stopMusic();
    audio.sfx("win");
  }

  // Particles
  for (const pt of game.particles) {
    pt.x += pt.vx;
    pt.y += pt.vy;
    pt.vy += 0.2;
    pt.life--;
  }
  game.particles = game.particles.filter(pt => pt.life > 0);

  // Camera
  const targetX = p.x - CANVAS_W / 2 + p.w / 2;
  const targetY = p.y - CANVAS_H / 2 + p.h / 2;
  game.camera.x += (targetX - game.camera.x) * 0.1;
  game.camera.y += (targetY - game.camera.y) * 0.1;
  game.camera.x = Math.max(0, Math.min(LW * TILE - CANVAS_W, game.camera.x));
  game.camera.y = Math.max(0, Math.min(LH * TILE - CANVAS_H, game.camera.y));
}

// ---------------- Rendering ----------------
function draw() {
  // Sky
  ctx.fillStyle = "#7ec8e3";
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  if (!allLoaded) {
    // Loading screen
    ctx.textAlign = "center";
    ctx.font = "bold 18px 'Courier New', monospace";
    ctx.fillStyle = "#1a3a6b";
    ctx.fillText("Loading...", CANVAS_W / 2, CANVAS_H / 2 - 10);
    ctx.font = "14px 'Courier New', monospace";
    ctx.fillStyle = "#333";
    const pct = Math.round((loadProgress / loadTotal) * 100);
    ctx.fillText(pct + "%", CANVAS_W / 2, CANVAS_H / 2 + 15);
    // Progress bar
    ctx.fillStyle = "#ccc";
    ctx.fillRect(CANVAS_W / 2 - 100, CANVAS_H / 2 + 30, 200, 12);
    ctx.fillStyle = "#1a3a6b";
    ctx.fillRect(CANVAS_W / 2 - 100, CANVAS_H / 2 + 30, 200 * (loadProgress / loadTotal), 12);
    return;
  }

  if (game.state === "title") {
    drawTitle();
    return;
  }

  const cx = Math.round(game.camera.x);
  const cy = Math.round(game.camera.y);

  // Parallax background layers
  drawBackground(cx, cy);

  // Urban skyline (mid-ground, parallax 0.5)
  ctx.save();
  ctx.translate(-Math.round(cx * 0.5), -Math.round(cy * 0.3));
  drawSkyline();
  ctx.restore();

  // Foreground decorations (parallax 1.0)
  ctx.save();
  ctx.translate(-cx, -cy);
  drawForegroundDecor();

  // Level tiles
  const x0 = Math.max(0, Math.floor(cx / TILE));
  const x1 = Math.min(LW - 1, Math.ceil((cx + CANVAS_W) / TILE));
  const y0 = Math.max(0, Math.floor(cy / TILE));
  const y1 = Math.min(LH - 1, Math.ceil((cy + CANVAS_H) / TILE));
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      const t = level[ty][tx];
      if (t === T.EMPTY) continue;
      const px = tx * TILE, py = ty * TILE;
      if (t === T.GRASS) {
        const left = tx > 0 && level[ty][tx - 1] === T.GRASS;
        const right = tx < LW - 1 && level[ty][tx + 1] === T.GRASS;
        const idx = (!left && !right) ? 0 : (!left ? 1 : (!right ? 2 : 3));
        if (imgReady(tiles[idx])) {
          ctx.drawImage(tiles[idx], px, py);
        } else {
          ctx.fillStyle = "#3daa5c";
          ctx.fillRect(px, py, TILE, TILE);
          ctx.fillStyle = "#2d7a3f";
          ctx.fillRect(px, py + TILE - 4, TILE, 4);
        }
      } else if (t === T.DIRT) {
        if (imgReady(tiles[40])) {
          ctx.drawImage(tiles[40], px, py);
        } else {
          ctx.fillStyle = "#8b5e3c";
          ctx.fillRect(px, py, TILE, TILE);
        }
      } else if (t === T.BRICK) {
        if (imgReady(tiles[6])) {
          ctx.drawImage(tiles[6], px, py);
        } else {
          ctx.fillStyle = "#b5734a";
          ctx.fillRect(px, py, TILE, TILE);
          ctx.strokeStyle = "#8b5a3a";
          ctx.strokeRect(px + 0.5, py + 0.5, TILE - 1, TILE - 1);
        }
      } else if (t === T.QUESTION) {
        const key = tx + "," + ty;
        const qb = game.questionBlocks[key];
        const pop = qb && qb.popTimer > 0 ? Math.sin(qb.popTimer * 0.5) * 3 : 0;
        if (imgReady(tiles[10])) {
          ctx.drawImage(tiles[10], px, py - pop);
        } else {
          ctx.fillStyle = "#ffd700";
          ctx.fillRect(px, py - pop, TILE, TILE);
          ctx.fillStyle = "#fff";
          ctx.font = "bold 12px monospace";
          ctx.textAlign = "center";
          ctx.fillText("?", px + TILE / 2, py - pop + 14);
        }
      } else if (t === T.HEDGE) {
        if (imgReady(tiles[16])) {
          ctx.drawImage(tiles[16], px, py);
        } else {
          ctx.fillStyle = "#2d8a3f";
          ctx.fillRect(px, py, TILE, TILE);
        }
      } else if (t === T.PIPE) {
        if (imgReady(tiles[94])) {
          ctx.drawImage(tiles[94], px, py);
        } else {
          ctx.fillStyle = "#4488cc";
          ctx.fillRect(px, py, TILE, TILE);
        }
      } else if (t === T.DOOR) {
        if (imgReady(tiles[130])) {
          ctx.drawImage(tiles[130], px, py);
        } else {
          ctx.fillStyle = "#665544";
          ctx.fillRect(px, py, TILE, TILE);
        }
      } else if (t === T.SIGN) {
        if (imgReady(tiles[84])) {
          ctx.drawImage(tiles[84], px, py);
        } else {
          ctx.fillStyle = "#aa8855";
          ctx.fillRect(px, py, TILE, TILE);
        }
      }
    }
  }

  // Signs (text labels)
  ctx.textAlign = "center";
  for (const s of game.signs) {
    if (s.x < cx - 200 || s.x > cx + CANVAS_W + 200) continue;
    ctx.font = "bold " + s.size + "px 'Courier New', monospace";
    // Background
    const tw = ctx.measureText(s.text).width;
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(s.x - tw / 2 - 6, s.y - s.size, tw + 12, s.size + 10);
    ctx.fillStyle = "#fff";
    ctx.fillText(s.text, s.x, s.y);
  }

  // Coins
  for (const c of game.coins) {
    if (c.collected) continue;
    if (c.x < cx - 20 || c.x > cx + CANVAS_W + 20) continue;
    const bobY = Math.sin(c.bob) * 2;
    if (imgReady(tiles[67])) {
      ctx.drawImage(tiles[67], c.x, c.y + bobY);
    } else {
      ctx.fillStyle = "#4488ff";
      ctx.beginPath();
      ctx.arc(c.x + 6, c.y + 6 + bobY, 5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Enemies
  for (const e of game.enemies) {
    if (e.x < cx - 40 || e.x > cx + CANVAS_W + 40) continue;
    if (e.dead) {
      if (e.deadTimer < 20) {
        ctx.globalAlpha = 1 - e.deadTimer / 20;
        drawEnemy(e);
        ctx.globalAlpha = 1;
      }
      continue;
    }
    drawEnemy(e);
  }

  // Player
  if (!game.player.dead) {
    drawPlayer(game.player);
  } else {
    // Dead player: rotate
    ctx.save();
    ctx.translate(game.player.x + game.player.w / 2, game.player.y + game.player.h / 2);
    ctx.rotate(game.player.deadTimer * 0.2);
    if (imgReady(chars[6])) {
      ctx.drawImage(chars[6], -game.player.w / 2, -game.player.h / 2);
    } else {
      ctx.fillStyle = "#ffcc00";
      ctx.fillRect(-game.player.w / 2, -game.player.h / 2, game.player.w, game.player.h);
    }
    ctx.restore();
  }

  // Particles
  for (const pt of game.particles) {
    ctx.fillStyle = pt.color;
    ctx.fillRect(pt.x, pt.y, 3, 3);
  }

  ctx.restore();

  // HUD
  drawHUD();

  // Win/Dead overlays
  if (game.state === "win") drawWin();
  if (game.state === "dead") drawDead();
}

function drawPlayer(p) {
  if (p.invuln > 0 && Math.floor(p.invuln / 4) % 2 === 0) return; // flicker
  const img = chars[p.frame === 0 ? 6 : 7];
  if (imgReady(img)) {
    ctx.save();
    if (p.facing < 0) {
      ctx.translate(p.x + p.w, p.y);
      ctx.scale(-1, 1);
      ctx.drawImage(img, 0, 0, p.w, p.h);
    } else {
      ctx.drawImage(img, p.x, p.y, p.w, p.h);
    }
    ctx.restore();
  } else {
    // Fallback: yellow circle with a simple face
    ctx.fillStyle = "#ffcc00";
    ctx.beginPath();
    ctx.arc(p.x + p.w / 2, p.y + p.h / 2, p.w / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#000";
    ctx.fillRect(p.x + 4, p.y + 6, 3, 3);
    ctx.fillRect(p.x + p.w - 7, p.y + 6, 3, 3);
  }
}

function drawEnemy(e) {
  if (e.type === "rover") {
    const img = chars[e.frame === 0 ? 18 : 19];
    if (imgReady(img)) {
      ctx.save();
      if (e.vx < 0) {
        ctx.translate(e.x + e.w, e.y);
        ctx.scale(-1, 1);
        ctx.drawImage(img, 0, 0, e.w, e.h);
      } else {
        ctx.drawImage(img, e.x, e.y, e.w, e.h);
      }
      ctx.restore();
    } else {
      ctx.fillStyle = "#555";
      ctx.fillRect(e.x, e.y, e.w, e.h);
      ctx.fillStyle = "#f00";
      ctx.fillRect(e.x + 3, e.y + 3, 4, 4);
      ctx.fillRect(e.x + e.w - 7, e.y + 3, 4, 4);
    }
  } else if (e.type === "drone") {
    const img = chars[15];
    if (imgReady(img)) {
      ctx.save();
      if (e.vx < 0) {
        ctx.translate(e.x + e.w, e.y);
        ctx.scale(-1, 1);
        ctx.drawImage(img, 0, 0, e.w, e.h);
      } else {
        ctx.drawImage(img, e.x, e.y, e.w, e.h);
      }
      ctx.restore();
    } else {
      ctx.fillStyle = "#333";
      ctx.beginPath();
      ctx.ellipse(e.x + e.w / 2, e.y + e.h / 2, e.w / 2, e.h / 2, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawSkyline() {
  if (!urbanImg) return;
  // Draw a repeating skyline pattern
  const pattern = [
    { id: 12, x: 0, y: 100, s: 1.2 },
    { id: 55, x: 140, y: 140, s: 1.0 },
    { id: 72, x: 280, y: 80, s: 1.0 },
    { id: 12, x: 380, y: 120, s: 1.1 },
    { id: 65, x: 500, y: 180, s: 1.0 },
    { id: 12, x: 700, y: 100, s: 1.2 },
    { id: 55, x: 840, y: 150, s: 1.0 },
    { id: 72, x: 980, y: 90, s: 1.0 },
    { id: 12, x: 1100, y: 110, s: 1.1 },
    { id: 65, x: 1250, y: 190, s: 1.0 },
    { id: 12, x: 1450, y: 100, s: 1.2 },
    { id: 55, x: 1600, y: 140, s: 1.0 },
  ];
  for (const b of pattern) {
    drawUrban(b.id, b.x, b.y, b.s);
  }
  // Trees
  drawUrban(0, 50, 200, 0.8);
  drawUrban(29, 400, 210, 0.7);
  drawUrban(0, 750, 200, 0.8);
  drawUrban(29, 1150, 210, 0.7);
  drawUrban(0, 1550, 200, 0.8);
  // Street lamps
  drawUrban(62, 200, 230, 0.9);
  drawUrban(62, 600, 230, 0.9);
  drawUrban(62, 1000, 230, 0.9);
  drawUrban(62, 1400, 230, 0.9);
  // Utility poles
  drawUrban(75, 350, 220, 0.8);
  drawUrban(75, 900, 220, 0.8);
  drawUrban(75, 1300, 220, 0.8);
  // Benches
  drawUrban(68, 300, 260, 1.0);
  drawUrban(68, 800, 260, 1.0);
  drawUrban(68, 1200, 260, 1.0);
  // Mailbox
  drawUrban(66, 500, 255, 1.0);
  drawUrban(66, 1100, 255, 1.0);
  // Trash can
  drawUrban(67, 700, 255, 1.0);
  drawUrban(67, 1300, 255, 1.0);
}

function drawForegroundDecor() {
  // Potted plants along the ground
  const spots = [5, 22, 35, 52, 75, 95, 118, 132, 148, 165];
  for (const sx of spots) {
    const px = sx * TILE;
    if (px < game.camera.x - 50 || px > game.camera.x + CANVAS_W + 50) continue;
    drawUrban(3, px, 15 * TILE + 2, 1.0);
    drawUrban(14, px + 20, 15 * TILE + 2, 1.0);
  }
  // Hedges (urban)
  drawUrban(17, 28 * TILE, 15 * TILE + 10, 1.0);
  drawUrban(17, 60 * TILE, 15 * TILE + 10, 1.0);
  drawUrban(17, 100 * TILE, 15 * TILE + 10, 1.0);
  drawUrban(17, 130 * TILE, 15 * TILE + 10, 1.0);
  // Topiary
  drawUrban(24, 40 * TILE, 14 * TILE, 1.0);
  drawUrban(13, 80 * TILE, 14 * TILE, 1.0);
  drawUrban(24, 120 * TILE, 14 * TILE, 1.0);
}

function drawBackground(cx, cy) {
  // Far background: sky + tree line silhouette (parallax 0.2)
  const px = Math.round(cx * 0.2);
  const py = Math.round(cy * 0.1);
  if (imgReady(bgs[14])) {
    for (let x = -px % 24; x < CANVAS_W; x += 24) {
      ctx.drawImage(bgs[14], x, CANVAS_H - 80 - py, 24, 80);
    }
  } else {
    // Fallback: simple tree line
    ctx.fillStyle = "#4a7a5a";
    for (let x = -px % 40; x < CANVAS_W; x += 40) {
      ctx.beginPath();
      ctx.moveTo(x, CANVAS_H - py);
      ctx.lineTo(x + 20, CANVAS_H - 60 - py);
      ctx.lineTo(x + 40, CANVAS_H - py);
      ctx.fill();
    }
  }
  // Clouds
  if (imgReady(bgs[153])) {
    for (let i = 0; i < 5; i++) {
      const cloudX = ((i * 200 - px * 0.5) % (CANVAS_W + 200)) - 100;
      const cloudY = 30 + (i % 3) * 25 - py;
      ctx.drawImage(bgs[153], cloudX, cloudY, 36, 18);
    }
  } else {
    // Fallback: simple clouds
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    for (let i = 0; i < 5; i++) {
      const cloudX = ((i * 200 - px * 0.5) % (CANVAS_W + 200)) - 100;
      const cloudY = 30 + (i % 3) * 25 - py;
      ctx.beginPath();
      ctx.ellipse(cloudX + 18, cloudY + 9, 18, 9, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawHUD() {
  ctx.textAlign = "left";
  ctx.font = "bold 14px 'Courier New', monospace";
  ctx.fillStyle = "rgba(0,0,0,0.5)";
  ctx.fillRect(8, 8, 200, 22);
  ctx.fillStyle = "#fff";
  ctx.fillText("SCORE " + String(game.score).padStart(6, "0"), 14, 24);
  // Coins
  if (imgReady(tiles[67])) {
    ctx.drawImage(tiles[67], 160, 10, 12, 12);
  } else {
    ctx.fillStyle = "#4488ff";
    ctx.beginPath();
    ctx.arc(166, 16, 6, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = "#fff";
  ctx.fillText("×" + game.coinsCollected, 176, 24);
  // Lives
  for (let i = 0; i < game.lives; i++) {
    if (imgReady(tiles[44])) {
      ctx.drawImage(tiles[44], 8 + i * 18, 34, 14, 14);
    } else {
      ctx.fillStyle = "#ff4444";
      ctx.beginPath();
      ctx.arc(15 + i * 18, 41, 6, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // Mute indicator
  if (audio.muted) {
    ctx.fillStyle = "#ff4444";
    ctx.fillText("MUTED (M)", 480, 24);
  }
}

function drawTitle() {
  ctx.fillStyle = "#7ec8e3";
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  // Skyline (drawUrban already checks imgReady)
  drawUrban(12, 50, 150, 1.5);
  drawUrban(55, 200, 180, 1.2);
  drawUrban(72, 350, 130, 1.2);
  drawUrban(12, 450, 160, 1.4);
  drawUrban(65, 550, 220, 1.0);
  drawUrban(0, 20, 220, 1.0);
  drawUrban(29, 480, 230, 0.9);
  ctx.textAlign = "center";
  ctx.font = "bold 36px 'Courier New', monospace";
  ctx.fillStyle = "#1a3a6b";
  ctx.fillText("MAIZE & BLUE", CANVAS_W / 2, 80);
  ctx.font = "bold 18px 'Courier New', monospace";
  ctx.fillStyle = "#fff";
  ctx.fillText("An Ann Arbor Platformer", CANVAS_W / 2, 110);
  ctx.font = "14px 'Courier New', monospace";
  ctx.fillStyle = "#333";
  ctx.fillText("Arrow keys / WASD to move, Space to jump", CANVAS_W / 2, 160);
  ctx.fillText("Stomp enemies, collect gems, reach the goal!", CANVAS_W / 2, 180);
  ctx.font = "bold 16px 'Courier New', monospace";
  ctx.fillStyle = "#1a3a6b";
  if (Math.floor(Date.now() / 500) % 2 === 0) {
    ctx.fillText("Press ENTER to start", CANVAS_W / 2, 240);
  }
  ctx.font = "11px 'Courier New', monospace";
  ctx.fillStyle = "#666";
  ctx.fillText("M to mute • Urban tileset © Dlou Saiyan • Kenney CC0", CANVAS_W / 2, 340);
}

function drawWin() {
  ctx.fillStyle = "rgba(0,0,0,0.6)";
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  ctx.textAlign = "center";
  ctx.font = "bold 32px 'Courier New', monospace";
  ctx.fillStyle = "#ffd700";
  ctx.fillText("YOU WIN!", CANVAS_W / 2, 120);
  ctx.font = "18px 'Courier New', monospace";
  ctx.fillStyle = "#fff";
  ctx.fillText("Score: " + game.score, CANVAS_W / 2, 160);
  ctx.fillText("Coins: " + game.coinsCollected + " / " + game.totalCoins, CANVAS_W / 2, 185);
  ctx.font = "bold 16px 'Courier New', monospace";
  ctx.fillStyle = "#1a3a6b";
  if (Math.floor(Date.now() / 500) % 2 === 0) {
    ctx.fillText("Press ENTER to play again", CANVAS_W / 2, 250);
  }
}

function drawDead() {
  ctx.fillStyle = "rgba(0,0,0,0.6)";
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  ctx.textAlign = "center";
  ctx.font = "bold 32px 'Courier New', monospace";
  ctx.fillStyle = "#ff4444";
  ctx.fillText("GAME OVER", CANVAS_W / 2, 120);
  ctx.font = "18px 'Courier New', monospace";
  ctx.fillStyle = "#fff";
  ctx.fillText("Score: " + game.score, CANVAS_W / 2, 160);
  ctx.font = "bold 16px 'Courier New', monospace";
  ctx.fillStyle = "#1a3a6b";
  if (Math.floor(Date.now() / 500) % 2 === 0) {
    ctx.fillText("Press ENTER to try again", CANVAS_W / 2, 250);
  }
}

// ---------------- Main loop ----------------
function loop() {
  update();
  draw();
  requestAnimationFrame(loop);
}
loop();
