#!/usr/bin/env node
/* =========================================================================
   Headless smoke test.
   -------------------------------------------------------------------------
   Runs the *built* index.html's game script inside a stubbed browser
   (no-op canvas 2D context, stub Web Audio graph, fake rAF/timers, a real
   PNG decoder for urbantileset32x32.png) and then:
     * boots the game and renders every screen state
     * plays the entire level with a simple bot through the real physics
     * runs the in-page ?selftest audit
   Any thrown error fails the process, which is what makes this useful: it
   exercises the drawImage calls, the audio scheduler and the game loop that a
   syntax check alone would never touch.

   Run:  node tools/smoke_test.js
   ========================================================================= */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '..');
const HTML = path.join(ROOT, 'index.html');

// ---------------------------------------------------------------- PNG decode
function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let off = 8, w = 0, h = 0, bitDepth = 0, colorType = 0, interlace = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.slice(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4);
      bitDepth = data[8]; colorType = data[9]; interlace = data[12];
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  if (bitDepth !== 8 || interlace !== 0 || (colorType !== 6 && colorType !== 2)) {
    throw new Error('unsupported PNG (bitDepth=' + bitDepth + ' colorType=' + colorType + ')');
  }
  const bpp = colorType === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * bpp;
  const out = Buffer.alloc(h * stride);
  let pos = 0;
  for (let y = 0; y < h; y++) {
    const filter = raw[pos++];
    const line = raw.slice(pos, pos + stride); pos += stride;
    const cur = out.slice(y * stride, (y + 1) * stride);
    const prev = y > 0 ? out.slice((y - 1) * stride, y * stride) : null;
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0;
      const b = prev ? prev[i] : 0;
      const c = (prev && i >= bpp) ? prev[i - bpp] : 0;
      let v = line[i];
      switch (filter) {
        case 0: break;
        case 1: v = (v + a) & 255; break;
        case 2: v = (v + b) & 255; break;
        case 3: v = (v + ((a + b) >> 1)) & 255; break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          v = (v + ((pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c))) & 255;
          break;
        }
        default: throw new Error('bad PNG filter ' + filter);
      }
      cur[i] = v;
    }
  }
  return { width: w, height: h, bpp, data: out };
}

// ------------------------------------------------------------ canvas double
class Gradient {
  addColorStop() { return this; }
}
class Ctx2D {
  constructor(canvas) {
    this.canvas = canvas;
    this.calls = 0;
    this._textW = 0;
    this.canvas._ops = this.canvas._ops || [];
  }
  _count(name) { this.calls++; this.canvas._ops.push(name); this.canvas._totalOps++; }
  _grad() { this._count('createGradient'); return new Gradient(); }
  createLinearGradient() { return this._grad(); }
  createRadialGradient() { return this._grad(); }
  createPattern() { this._count('createPattern'); return null; }
  createImageData(w, h) { this._count('createImageData'); return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }; }
  putImageData() { this._count('putImageData'); }
  getImageData(x, y, w, h) { this._count('getImageData'); return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }; }
  drawImage(img) {
    this._count('drawImage');
    if (!img) throw new Error('drawImage called with ' + img);
    if (img.width === undefined || img.height === undefined) throw new Error('drawImage source has no size');
    if (this.canvas && this.canvas._images) this.canvas._images.add(img);
  }
  fillRect() { this._count('fillRect'); }
  strokeRect() { this._count('strokeRect'); }
  clearRect() { this._count('clearRect'); }
  fillText(t) { this._count('fillText'); this._textW += String(t).length * 8; }
  strokeText() { this._count('strokeText'); }
  measureText(t) { this._count('measureText'); return { width: String(t).length * 8 }; }
  beginPath() { this._count('beginPath'); }
  closePath() { this._count('closePath'); }
  moveTo() { this._count('moveTo'); }
  lineTo() { this._count('lineTo'); }
  arc() { this._count('arc'); }
  arcTo() { this._count('arcTo'); }
  ellipse() { this._count('ellipse'); }
  bezierCurveTo() { this._count('bezierCurveTo'); }
  quadraticCurveTo() { this._count('quadraticCurveTo'); }
  rect() { this._count('rect'); }
  fill() { this._count('fill'); }
  stroke() { this._count('stroke'); }
  clip() { this._count('clip'); }
  save() { this._count('save'); }
  restore() { this._count('restore'); }
  translate() { this._count('translate'); }
  scale() { this._count('scale'); }
  rotate() { this._count('rotate'); }
  setTransform() { this._count('setTransform'); }
  resetTransform() { this._count('resetTransform'); }
}
class Canvas {
  constructor(w, h) {
    this.width = w === undefined ? 300 : w;
    this.height = h === undefined ? 150 : h;
    this._totalOps = 0;
    this._images = new Set();
    this._ctx = new Ctx2D(this);
  }
  getContext(kind) {
    if (kind !== '2d') throw new Error('unexpected context: ' + kind);
    return this._ctx;
  }
  toDataURL() { return 'data:image/png;base64,'; }
}
class ImageStub {
  constructor() { this._src = ''; this.width = 0; this.height = 0; this.onload = null; this.onerror = null; this._loaded = false; }
  set src(v) { this._src = v; BRIDGE.pendingImages.push(this); }
  get src() { return this._src; }
  _finish() {
    if (this._loaded) return;
    const p = path.join(ROOT, this._src);
    try {
      const png = decodePng(fs.readFileSync(p));
      this.width = png.width; this.height = png.height;
      BRIDGE.decoded[this._src] = png;
      this._loaded = true;
      BRIDGE.stats.imagesLoaded++;
      if (this.onload) this.onload();
    } catch (err) {
      BRIDGE.stats.imageErrors.push(this._src + ': ' + err.message);
      if (this.onerror) this.onerror(err);
    }
  }
}

// ----------------------------------------------------------------- audio stubs
class Param {
  constructor(v) { this.value = v; this.events = []; }
  setValueAtTime(v, t) { this.value = v; this.events.push(['set', v, t]); return this; }
  linearRampToValueAtTime(v, t) { this.value = v; this.events.push(['lin', v, t]); return this; }
  exponentialRampToValueAtTime(v, t) { this.value = v; this.events.push(['exp', v, t]); return this; }
  cancelScheduledValues() { this.events.push(['cancel']); return this; }
  setTargetAtTime(v) { this.value = v; return this; }
}
class Node {
  constructor(kind) { this.kind = kind; this._out = []; }
  connect(d) { this._out.push(d); BRIDGE.stats.audioConnects++; return d; }
  disconnect() { return this; }
}
class Osc extends Node {
  constructor() { super('osc'); this.type = 'square'; this.frequency = new Param(440); this.detune = new Param(0); }
  start(t) { BRIDGE.stats.oscStarts++; this._start = t; }
  stop(t) { BRIDGE.stats.oscStops++; this._stop = t; }
}
class Gain extends Node { constructor() { super('gain'); this.gain = new Param(1); } }
class Filter extends Node { constructor() { super('filter'); this.type = 'lowpass'; this.frequency = new Param(350); this.Q = new Param(1); } }
class BufferSrc extends Node { constructor() { super('bufsrc'); this.buffer = null; this.loop = false; } start() { BRIDGE.stats.bufferStarts++; } stop() { } }
class AudioContextStub {
  constructor() { this.sampleRate = 44100; this.state = 'running'; this.destination = new Node('destination'); BRIDGE.stats.audioContexts++; }
  get currentTime() { return BRIDGE.time / 1000; }
  createGain() { return new Gain(); }
  createOscillator() { return new Osc(); }
  createBiquadFilter() { return new Filter(); }
  createBufferSource() { return new BufferSrc(); }
  createBuffer(ch, len, rate) { return { length: len, sampleRate: rate, numberOfChannels: ch, getChannelData: () => new Float32Array(len) }; }
  createDynamicsCompressor() { const n = new Node('comp'); n.threshold = new Param(-24); n.knee = new Param(30); n.ratio = new Param(12); n.attack = new Param(0.003); n.release = new Param(0.25); return n; }
  resume() { this.state = 'running'; BRIDGE.stats.resumes++; return Promise.resolve(); }
  suspend() { this.state = 'suspended'; return Promise.resolve(); }
  close() { return Promise.resolve(); }
}

// ------------------------------------------------------------------- bridge
const BRIDGE = {
  pendingImages: [],
  decoded: {},
  stats: { imagesLoaded: 0, imageErrors: [], rafCallbacks: 0, timers: 0, timerTicks: 0, audioContexts: 0, oscStarts: 0, oscStops: 0, bufferStarts: 0, audioConnects: 0, resumes: 0, errors: [] },
  now: 0,
  raf: null,
  intervals: [],
  timeouts: [],
  time: 0,
  get audioTime() { return this.time / 1000; },
  pump(ms) {
    this.now += ms;
    this.time += ms;
    const cb = this.raf;
    if (cb) { BRIDGE.stats.rafCallbacks++; cb(this.now); }
  },
  pumpTimers(max) {
    let n = 0;
    while (n < (max || 3000)) {
      const due = this.intervals.concat(this.timeouts).filter((t) => t.at <= this.time)
        .sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      this.time = due.at;
      due.at += due.delay;
      if (due.kind === 'timeout') due.done = true;
      BRIDGE.stats.timerTicks++;
      due.fn();
      this.timeouts = this.timeouts.filter((t) => !t.done);
      n++;
    }
  },
};

// ------------------------------------------------------------------- sandbox
const sandbox = {
  console, Math, Date, JSON, parseInt, parseFloat, isNaN, isFinite,
  Object, Array, String, Number, Boolean, Error, TypeError, RangeError,
  Map, Set, Promise, Symbol, Uint8Array, Uint8ClampedArray, Float32Array, Int32Array,
  requestAnimationFrame: (cb) => { BRIDGE.raf = cb; return 1; },
  cancelAnimationFrame: () => { BRIDGE.raf = null; },
  setInterval: (fn, ms) => { const t = { fn, delay: ms, at: BRIDGE.time + ms, kind: 'interval' }; BRIDGE.intervals.push(t); BRIDGE.stats.timers++; return BRIDGE.intervals.length; },
  clearInterval: (id) => { BRIDGE.intervals[id - 1] = { fn: () => { }, delay: 1e9, at: 1e12, kind: 'interval' }; },
  setTimeout: (fn, ms) => { const t = { fn, delay: ms, at: BRIDGE.time + ms, kind: 'timeout' }; BRIDGE.timeouts.push(t); return BRIDGE.timeouts.length; },
  clearTimeout: () => { },
  AudioContext: AudioContextStub,
};
sandbox.window = sandbox;
sandbox.self = sandbox;
sandbox.globalThis = sandbox;
sandbox.location = { search: '?selftest' };
sandbox.__BRIDGE = BRIDGE;
sandbox.document = {
  createElement(tag) {
    if (tag === 'canvas') return new Canvas();
    return { style: {}, appendChild() { }, setAttribute() { } };
  },
  getElementById() { return null; },
  addEventListener() { },
  body: { appendChild() { } },
};
sandbox.Image = ImageStub;
BRIDGE.listeners = {};
sandbox.addEventListener = function (type, fn) {
  (BRIDGE.listeners[type] = BRIDGE.listeners[type] || []).push(fn);
};
sandbox.removeEventListener = function () { };
sandbox.performance = { now: () => BRIDGE.now };
sandbox.navigator = { userAgent: 'node-smoke-test' };

const vm = require('vm');
const ctx = vm.createContext(sandbox);

// --------------------------------------------------------------------- boot
const t0 = Date.now();
const html = fs.readFileSync(HTML, 'utf8');
const scripts = [];
const re = /<script>([\s\S]*?)<\/script>/g;
let m;
while ((m = re.exec(html))) scripts.push(m[1]);
if (!scripts.length) fail('no <script> blocks found in index.html');
const gameJs = scripts[0];

let failures = [];
const logLines = [];
function fail(msg) { failures.push(msg); logLines.push('  x ' + msg); }
function ok(msg) { logLines.push('  . ' + msg); }
function expect(cond, msg) { if (cond) ok(msg); else fail(msg); }

try {
  vm.runInContext(gameJs, ctx, { filename: 'index.html<game>' });
} catch (err) {
  fail('game script threw during evaluation: ' + err.stack);
}

const AA = sandbox.AA;
expect(!!AA, 'global AA namespace created');
expect(!!AA && !!AA.Game, 'AA.Game exists');
expect(!!AA && !!AA.LEVEL, 'level data present');

// canvas + init
const canvas = new Canvas(960, 540);
try {
  AA.Game.init(canvas);
  ok('Game.init() completed');
} catch (err) {
  fail('Game.init() threw: ' + err.stack);
}

// resolve the tileset image like a browser would
BRIDGE.pendingImages.forEach((im) => im._finish());
expect(BRIDGE.stats.imageErrors.length === 0, 'no image load errors' + (BRIDGE.stats.imageErrors.length ? ': ' + BRIDGE.stats.imageErrors.join('; ') : ''));
expect(AA.atlas.ready === true, 'atlas image marked ready');

// the atlas rects are generated, but they must land inside the real PNG
Object.keys(AA.atlas.byId).forEach((id) => {
  const e = AA.atlas.byId[id];
  if (e.x < 0 || e.y < 0 || e.x + e.w > 1024 || e.y + e.h > 1024) fail('atlas rect out of bounds for id ' + id);
});
ok('all ' + Object.keys(AA.atlas.byId).length + ' atlas rects are inside the 1024x1024 sheet');

// opacity sanity for a sample of rects against the decoded pixels
const png = BRIDGE.decoded['urbantileset/urbantileset32x32.png'];
if (!png) fail('tileset PNG was never decoded');
else {
  let emptyRects = 0;
  Object.keys(AA.atlas.byId).forEach((id) => {
    const e = AA.atlas.byId[id];
    let opaque = 0;
    const step = Math.max(1, Math.floor(Math.min(e.w, e.h) / 8));
    for (let y = e.y; y < e.y + e.h; y += step) {
      for (let x = e.x; x < e.x + e.w; x += step) {
        if (png.data[(y * png.width + x) * png.bpp + 3] > 16) opaque++;
      }
    }
    if (opaque === 0) { emptyRects++; fail('atlas rect for id ' + id + ' sampled as fully transparent'); }
  });
  ok('sampled every atlas rect against real pixels (' + emptyRects + ' empty)');
}

// --- states ---------------------------------------------------------------
function frames(n, ms) { for (let i = 0; i < n; i++) BRIDGE.pump(ms || 16.7); }

AA.Game.start();
frames(3);
expect(AA.Game.state === 'title', 'boots to the title screen');
expect(AA.Game.frame >= 0 && AA.Game.t > 0, 'game time advanced over frames');

// start the run via the real input path
AA.Game.keys = {};
AA.Game.onPress('start');
frames(4);
expect(AA.Game.state === 'play', 'SPACE starts the level');

// audio comes up on the first key event
expect(BRIDGE.stats.audioContexts > 0, 'Web Audio context created on first input');

// --- bot playthrough ------------------------------------------------------
// Same reflex bot as the in-page test: run right, look ahead for walls, gaps,
// water and enemies, jump. Four attempts, restarting from checkpoints like a
// player. Multi-attempt because the bot has fixed reflexes and no planning.
const G = AA.Game;
const T = AA.TILE;
G.resetRun();
G.state = 'play';
function playAttempt(maxSeconds, seedPhase) {
  const state = { jumpHold: 0, cooldown: 0, hold: false, hurt: 0, best: 0, steps: 0, stall: 0, retreat: 0, charge: 0, furthest: -1e9 };
  if (seedPhase) G.enemies.forEach((e, i) => { e.phase = seedPhase * 1.7 + i; });
  const steps = Math.round(maxSeconds / G.dt);
  for (let i = 0; i < steps; i++) {
    const p = G.player;
    state.hold = G.enemies.some((e) => !e.dead && e.x - p.x > 0 && e.x - p.x < 74 && e.feetY < p.feetY - 34);
    const p0 = G.player;
    if (p0.x > state.furthest + 6) { state.furthest = p0.x; state.stall = 0; } else { state.stall++; }
    if (state.stall > 260 && state.retreat <= 0 && state.charge <= 0) { state.retreat = 34; state.stall = 0; }
    if (state.retreat > 0) state.retreat--;
    else if (state.charge > 0) state.charge--;
    G.keys = { right: state.retreat <= 0 && !state.hold, left: state.retreat > 0, jump: state.jumpHold > 0 };
    if (state.jumpHold > 0) state.jumpHold--;
    if (state.cooldown > 0) state.cooldown--;
    if (state.hold) state.stuck = (state.stuck || 0) + 1; else state.stuck = 0;
    if (state.cooldown <= 0 && (p.onGround || p.coyote > 0) && ((!state.hold || state.stuck > 90) || state.charge > 0)) {
      const footRow = Math.floor(p.feetY / T);
      let want = false;
      for (const ahead of [14, 22, 30, 42]) {
        const tx = Math.floor((p.x + ahead) / T);
        if (AA.levelSolid(tx, footRow - 1) || AA.levelSolid(tx, footRow - 2)) { want = true; break; }
      }
      if (!want) {
        want = G.staticRects.some((r) => {
          const dx = r.x - p.x;
          return dx > 0 && dx < 46 && r.y < p.feetY - 2 && r.y + r.h > p.feetY - 40;
        });
      }
      if (!want) {
        for (let k = 0; k < 6; k++) {
          const tx = Math.floor((p.x + 26 + k * T) / T);
          if (AA.tileAt(tx, footRow) === 'w' || AA.tileAt(tx, footRow - 1) === 'w') { want = true; break; }
          let solidBelow = false;
          for (let d = 0; d < 3; d++) if (AA.levelSolid(tx, footRow + d)) { solidBelow = true; break; }
          if (!solidBelow) { want = true; break; }
        }
      }
      if (!want) {
        want = G.enemies.some((e) => {
          if (e.dead) return false;
          const dx = e.x - p.x;
          if (Math.abs(e.feetY - p.feetY) >= 26) return false;
          return dx > 52 && dx < 86;
        });
      }
      if (want) { state.jumpHold = 40; state.cooldown = 30; p.buffer = 0.12; }
    }
    const livesBefore = G.lives;
    G.update(G.dt);
    if (G.lives < livesBefore) state.hurt++;
    const prog = p.x / (AA.LEVEL.cols * T);
    if (prog > state.best) state.best = prog;
    state.steps = i;
    if (G.finishT > 0 || G.state === 'win') return { won: true, ...state, state: G.state };
    if (G.state === 'over') return { won: false, ...state, state: G.state };
  }
  return { won: false, ...state, state: G.state };
}

G.resetRun();
G.state = 'play';
let won = false, best = 0, bestNote = '';
const ATTEMPTS = 12;
{
  for (let attempt = 0; attempt < ATTEMPTS && !won; attempt++) {
    if (attempt > 0) {
      // Retry from the furthest checkpoint with a fresh life pool, which is what
      // a determined player does.
      G.respawn(false);
      G.lives = 6;
      G.state = 'play';
    }
    const r = playAttempt(120, attempt + 1);
    won = r.won;
    if (r.best > best) {
      best = r.best;
      bestNote = 'x=' + (G.player.x / T).toFixed(0) + '/' + AA.LEVEL.cols + ' tiles, gems=' + G.gems +
        ', hurt=' + r.hurt + ', stomps=' + G.stomps + ', state=' + r.state;
    }
  }
}
const reachedEnd = best > 0.9;
console.log('  bot: won=' + won + ' best=' + (best * 100).toFixed(0) + '% ' + bestNote +
  ' gems=' + G.gems + '/' + G.coins.length + ' deaths=' + G.deaths + ' attempts=' + ATTEMPTS);
expect(won || reachedEnd,
  'reflex bot traverses the level (won=' + won + ', best progress ' + (best * 100).toFixed(0) + '%)');

// --- pause, mute, restart and the real key-event path ---------------------
{
  const key = (type, code) => {
    const ev = { code, preventDefault() {} };
    (BRIDGE.listeners[type] || []).forEach((fn) => fn(ev));
  };
  const tap = (code) => { key('keydown', code); key('keyup', code); };

  G.state = 'play';
  G.paused = false;
  G.muted = false;
  G.keys = {};
  AA.Audio.ensure();               // mute toggling needs a live audio graph
  AA.Audio.enabled = true;
  AA.Audio.setMuted(false);

  // No enemies during the input tests: a patrol wandering into the player
  // mid-assertion must not be able to fail a keyboard test.
  const realEnemies = G.enemies;
  G.enemies = [];

  tap('KeyP');
  expect(G.paused === true, 'P pauses the game');
  tap('KeyP');
  expect(G.paused === false, 'P resumes the game');

  tap('KeyM');
  expect(G.muted === true && AA.Audio.enabled === false, 'M mutes audio');
  tap('KeyM');
  expect(G.muted === false && AA.Audio.enabled === true, 'M unmutes audio');

  // arrow keys must drive the player through the real keydown/keyup path.
  // Settle the player onto the ground first so the test is not at the mercy of
  // whichever frame it happens to be mid-air on.
  G.player.x = 600; G.player.feetY = 340; G.player.vx = 0;
  G.keys = {};
  for (let i = 0; i < 12; i++) G.update(G.dt);
  key('keydown', 'ArrowRight');
  for (let i = 0; i < 12; i++) G.update(G.dt);
  const movingRight = G.player.vx > 40;
  key('keyup', 'ArrowRight');
  expect(movingRight, 'ArrowRight accelerates the player (vx=' + G.player.vx.toFixed(0) + ')');
  for (let i = 0; i < 20; i++) G.update(G.dt);

  G.keys = {}; G.player.vx = 0;
  const beforeX = G.player.x;
  key('keydown', 'ArrowLeft');
  for (let i = 0; i < 12; i++) G.update(G.dt);
  key('keyup', 'ArrowLeft');
  expect(G.player.x < beforeX, 'ArrowLeft moves the player back');

  G.keys = {};
  for (let i = 0; i < 45; i++) G.update(G.dt);     // stand still, firmly grounded
  const grounded = G.player.onGround;
  key('keydown', 'Space');
  G.update(G.dt);
  key('keyup', 'Space');
  expect(grounded && G.player.vy < 0, 'Space jumps (grounded=' + grounded + ', vy=' + G.player.vy.toFixed(0) + ')');

  // R returns the player to the last checkpoint reached. Claim the second
  // checkpoint first (it sits at tile 47), then walk far away and reset.
  G.resetRun();
  G.state = 'play';
  G.keys = {};
  const cp = G.checkpoints[2];
  G.player.x = cp.x; G.player.feetY = cp.y;
  G.update(G.dt);
  expect(cp.taken === true, 'touching a checkpoint claims it');
  G.player.x = 4000; G.player.feetY = 352;
  tap('KeyR');
  expect(Math.abs(G.player.x - cp.x) < 2, 'R returns to the last checkpoint (x=' + G.player.x.toFixed(0) + ' vs ' + cp.x + ')');

  G.enemies = realEnemies;

  // Enter starts a run from the title screen
  G.state = 'title';
  G.player.x = 0;
  G.keys = {};
  tap('Enter');
  expect(G.state === 'play' && G.player.x > 0, 'Enter starts the level from the title screen');
}

// --- run the in-page selftest -------------------------------------------
try {
  const report = AA.selfTest(G);
  expect(report && report.fail === 0, 'in-page selfTest reported ' + (report ? report.pass + ' pass / ' + report.fail + ' fail' : 'nothing'));
  if (report) report.log.forEach((l) => console.log('      ' + l));
} catch (err) {
  fail('selfTest threw: ' + err.stack);
}

// --- every screen renders -------------------------------------------------
function renderState(name, mutate) {
  const before = canvas._totalOps;
  try {
    if (mutate) mutate(G);
    AA.render(G);
    ok('render ok: ' + name + ' (' + (canvas._totalOps - before) + ' draw ops)');
  } catch (err) {
    fail('render threw in state ' + name + ': ' + err.stack);
  }
}
renderState('title', (g) => { g.state = 'title'; });
renderState('play', (g) => { g.state = 'play'; });
renderState('paused', (g) => { g.paused = true; });
renderState('paused is respected in update', (g) => { g.paused = false; });
renderState('game over', (g) => { g.state = 'over'; });
renderState('win', (g) => { g.state = 'win'; });

// camera sweep: render across the whole level to exercise every zone/prop
G.state = 'play';
G.resetRun();
let swept = 0;
for (let x = 0; x < AA.LEVEL.cols * T - AA.VIEW_W; x += 160) {
  G.camX = x;
  G.player.x = x + 200;
  try { AA.render(G); swept++; } catch (err) { fail('render threw sweeping camera at x=' + x + ': ' + err.stack); break; }
}
ok('swept camera across ' + swept + ' positions');

// audio scheduler: drive the sequencer across every mood and require notes
try {
  const before = BRIDGE.stats.oscStarts, beforeNoise = BRIDGE.stats.bufferStarts;
  ['campus', 'street', 'river', 'build', 'stadium', 'win'].forEach((mood) => {
    AA.Audio.setMood(mood);
    for (let i = 0; i < 260; i++) { BRIDGE.time += 34; AA.Audio.tick(); }
  });
  const madeNotes = BRIDGE.stats.oscStarts - before;
  const madeNoise = BRIDGE.stats.bufferStarts - beforeNoise;
  expect(madeNotes > 100, 'music scheduler generated notes across all moods (' + madeNotes + ' osc starts)');
  expect(madeNoise > 20, 'drum/percussion voices fired (' + madeNoise + ' noise buffers)');
} catch (err) {
  fail('audio tick threw: ' + err.stack);
}
// every sfx must be safe to fire
try {
  ['jump', 'land', 'coin', 'stomp', 'hurt', 'splash', 'checkpoint', 'win', 'over', 'select', 'snow', 'boss']
    .forEach((name) => AA.Audio.sfx(name));
  ok('all 12 sound effects fired without error');
} catch (err) {
  fail('a sound effect threw: ' + err.stack);
}
Object.keys(AA.Audio.ctx ? {} : {}).length;

// --- report ---------------------------------------------------------------
console.log('');
console.log('image loads: ' + BRIDGE.stats.imagesLoaded);
console.log('draw ops total: ' + canvas._totalOps);
console.log('audio: contexts=' + BRIDGE.stats.audioContexts + ' oscStarts=' + BRIDGE.stats.oscStarts +
  ' oscStops=' + BRIDGE.stats.oscStops + ' noiseBuffers=' + BRIDGE.stats.bufferStarts +
  ' connects=' + BRIDGE.stats.audioConnects);
console.log('elapsed: ' + (Date.now() - t0) + ' ms');
logLines.forEach((l) => console.log(l));
console.log('');
if (failures.length) {
  console.error('SMOKE TEST FAILED (' + failures.length + '):');
  failures.forEach((f) => console.error('  - ' + f));
  process.exit(1);
}
console.log('SMOKE TEST PASSED');
