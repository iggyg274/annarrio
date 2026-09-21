#!/usr/bin/env node
/* =========================================================================
   Records the canvas 2D calls the game makes for a set of representative
   frames, as JSON, so tools/render_preview.py can replay them in PIL and write
   real PNGs. Canvas state is emulated just enough to replay faithfully:
   transforms are tracked, colours are recorded as strings, and every drawing
   call is appended in order.

   Run:  node tools/render_shots.js build/render_calls.json
   ========================================================================= */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '..');
const HTML = path.join(ROOT, 'index.html');
const OUT = process.argv[2] || path.join(ROOT, 'build', 'render_calls.json');

const TILESET_KEY = 'urbantileset/urbantileset32x32.png';

// ------------------------------------------------------------------ recorder
class RecCtx {
  constructor(canvas) {
    this.canvas = canvas;
    this.ops = [];
  }
  _r(m) { return (...a) => { this.ops.push([m].concat(a)); }; }
  // gradients are recorded as the average of their colour stops
  createLinearGradient() { return this._grad(); }
  createRadialGradient() { return this._grad(); }
  _grad() {
    // A plain object: colour stops are averaged into one representative hex so
    // the PIL replayer can still show sky/water/panel tints.
    const g = {
      __grad__: true,
      __stops: [],
      addColorStop(o, c) { this.__stops.push(c); },
      get __colors() {
        if (!this.__stops.length) return '888888';
        let r = 0, g2 = 0, b = 0, n = 0;
        for (const st of this.__stops) {
          const m = /^#([0-9a-f]{6})$/i.exec(String(st));
          if (m) { r += parseInt(m[1].slice(0, 2), 16); g2 += parseInt(m[1].slice(2, 4), 16); b += parseInt(m[1].slice(4, 6), 16); n++; }
        }
        if (!n) return '888888';
        const h = (v) => Math.round(v / n).toString(16).padStart(2, '0');
        return h(r) + h(g2) + h(b);
      },
    };
    return g;
  }
  createImageData(w, h) { return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }; }
  putImageData() { }
  getImageData(x, y, w, h) { return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }; }
  measureText(t) { return { width: String(t).length * 8 }; }
  drawImage(img, ...a) {
    if (!img) throw new Error('drawImage with no source');
    this.ops.push(['drawImage', img.__key || TILESET_KEY].concat(a));
  }
  // expose the key of whatever image object is passed, for diagnostics
  imageKey(img) { return img && img.__key; }
}
// every other 2D method simply gets recorded
['save', 'restore', 'translate', 'scale', 'rotate', 'setTransform', 'resetTransform',
  'fillRect', 'strokeRect', 'clearRect', 'fillText', 'strokeText', 'beginPath', 'closePath',
  'moveTo', 'lineTo', 'arc', 'arcTo', 'ellipse', 'bezierCurveTo', 'quadraticCurveTo',
  'rect', 'fill', 'stroke', 'clip'].forEach((m) => { RecCtx.prototype[m] = function (...a) { this.ops.push([m].concat(a)); }; });

function setter(name) {
  Object.defineProperty(RecCtx.prototype, name, {
    set(v) { this.ops.push([name, v]); },
    get() { return this['_' + name]; },
  });
}
['globalAlpha', 'fillStyle', 'strokeStyle', 'lineWidth', 'font', 'textBaseline', 'textAlign', 'globalCompositeOperation'].forEach((p) => {
  let store;
  Object.defineProperty(RecCtx.prototype, p, {
    set(v) { this.ops.push([p, v]); store = v; },
    get() { return store; },
    configurable: true,
  });
});

class RecCanvas {
  constructor(w, h) { this.width = w; this.height = h; this._ctx = new RecCtx(this); }
  getContext() { return this._ctx; }
}

// ------------------------------------------------------------------- images
class ImageStub {
  // __key must be per-instance: the game loads two different atlases, and a
  // prototype-level key makes them look identical to the recorder.
  constructor() { this.width = 0; this.height = 0; this.onload = null; this.__key = '?'; }
  set src(v) {
    this.__key = v;
    const p = path.join(ROOT, v);
    const buf = fs.readFileSync(p);
    const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
    this.width = w; this.height = h;
    // Resolve synchronously so every Image is ready before the frames are
    // recorded (an async load would silently render only the first atlas).
    if (this.onload) this.onload();
  }
}

// ------------------------------------------------------------------ sandbox
const noop = () => { };
const sandbox = {
  console, Math, Date, JSON, parseInt, parseFloat, isNaN, isFinite, Object, Array, String,
  Number, Boolean, Error, TypeError, RangeError, Map, Set, Promise, Symbol,
  Uint8Array, Uint8ClampedArray, Float32Array, Proxy,
  requestAnimationFrame: noop, cancelAnimationFrame: noop, setInterval: noop,
  clearInterval: noop, setTimeout, clearTimeout: noop, Image: ImageStub,
  performance: { now: () => 0 },
  navigator: { userAgent: 'render-shots' },
  location: { search: '' },
  document: {
    createElement(tag) { if (tag === 'canvas') return new RecCanvas(64, 64); return { style: {} }; },
    getElementById: () => null, addEventListener: noop, body: { appendChild: noop },
  },
  addEventListener: noop, removeEventListener: noop,
};
sandbox.window = sandbox;
sandbox.self = sandbox;

const vm = require('vm');
const ctx = vm.createContext(sandbox);
const html = fs.readFileSync(HTML, 'utf8');
const gameJs = /<script>([\s\S]*?)<\/script>/.exec(html)[1];
vm.runInContext(gameJs, ctx, { filename: 'index.html<game>' });

const AA = sandbox.AA;
const G = AA.Game;
const canvas = new RecCanvas(AA.VIEW_W, AA.VIEW_H);
G.init(canvas);

const SHOTS = [
  ['01_title', 'title', 'AA.Game.state = "title";'],
  ['02_diag', 'play', 'AA.Game.resetRun(); AA.Game.state="play"; AA.Game.camX = 0; AA.Game.player.x = 200; AA.Game.player.feetY = 352;'],
  ['03_state_street', 'play', 'AA.Game.resetRun(); AA.Game.state="play"; AA.Game.camX = 29*32 - 320; AA.Game.player.x = AA.Game.camX + 360; AA.Game.player.feetY = 352;'],
  ['04_construction', 'play', 'AA.Game.resetRun(); AA.Game.state="play"; AA.Game.camX = 50*32 - 200; AA.Game.player.x = AA.Game.camX + 260; AA.Game.player.feetY = 352;'],
  ['05_huron', 'play', 'AA.Game.resetRun(); AA.Game.state="play"; AA.Game.camX = 72*32 - 140; AA.Game.player.x = AA.Game.camX + 170; AA.Game.player.feetY = 352;'],
  ['06_burton_tower', 'play', 'AA.Game.resetRun(); AA.Game.state="play"; AA.Game.camX = 78*32 - 100; AA.Game.player.x = AA.Game.camX + 230; AA.Game.player.feetY = 352;'],
  ['07_stadium', 'play', 'AA.Game.resetRun(); AA.Game.state="play"; AA.Game.camX = 96*32 - 200; AA.Game.player.x = AA.Game.camX + 300; AA.Game.player.feetY = 352;'],
  ['08_grandstand', 'play', 'AA.Game.resetRun(); AA.Game.state="play"; AA.Game.camX = AA.LEVEL.cols*32 - 960; AA.Game.player.x = AA.Game.camX + 690; AA.Game.player.feetY = 352;'],
  ['13_player', 'play', 'AA.Game.resetRun(); AA.Game.state="play"; AA.Game.camX = 50*32 - 240; AA.Game.player.x = 50*32 + 100; AA.Game.player.feetY = 352; AA.Game.player.dir = 1; AA.Game.player.vx = 120; AA.Game.player.animT = 0.2;'],
  ['11_actors', 'play', 'AA.Game.resetRun(); AA.Game.state="play"; AA.Game.camX = 14*32; AA.Game.player.x = 16*32; AA.Game.player.feetY = 352; AA.Game.player.dir = 1;'],
  ['12_river', 'play', 'AA.Game.resetRun(); AA.Game.state="play"; AA.Game.camX = 74*32 - 60; AA.Game.player.x = AA.Game.camX + 90; AA.Game.player.feetY = 352;'],
  ['09_win', 'win', 'AA.Game.resetRun(); AA.Game.state="win"; AA.Game.score=4820; AA.Game.timer=84.5; AA.Game.gems=AA.Game.coins.length; AA.Game.stomps=7; AA.Game.deaths=0;'],
  ['10_game_over', 'over', 'AA.Game.resetRun(); AA.Game.state="over"; AA.Game.score=1250; AA.Game.timer=52.2; AA.Game.gems=9;'],
];

// Diagnostic: confirm which atlases the image registry hands out.
console.log('atlas keys: ' + [
  'index atlas: ' + (AA.atlas.img && AA.atlas.img.__key),
  'kenney atlas: ' + (AA.kenney.img && AA.kenney.img.__key),
  'kenney keys: ' + Object.keys(AA.kenney.index).length,
  'kenney ready: ' + AA.kenney.ready,
].join(' | '));

const shots = [];
for (const [name, , setup] of SHOTS) {
  G.ctx = canvas.getContext('2d');
  G.ctx.ops.length = 0;
  G.t = 10;
  G.player.setupDone = true;
  vm.runInContext(setup, ctx, { filename: 'setup' });
  AA.render(G);
  shots.push([name, canvas.getContext('2d').ops.slice()]);
  console.log('  recorded ' + name + ' (' + canvas.getContext('2d').ops.length + ' calls)');
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify({
  width: AA.VIEW_W, height: AA.VIEW_H, tilesetKey: TILESET_KEY,
  kenneyKey: (AA.KENNEY && AA.KENNEY.file) || 'build/kenney_atlas.png', shots,
}));
console.log('wrote ' + path.relative(ROOT, OUT));
