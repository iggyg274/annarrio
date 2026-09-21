/* smoke.js — headless runtime test for the game scripts.
 * Stubs just enough DOM / Canvas / Web Audio to run boot(), then pumps real frames
 * and drives a simple bot across the level to prove it is actually playable.
 *   node smoke.js            quiet summary + PASS/FAIL
 *   node smoke.js trace      extra per-frame logging around hazards
 */
'use strict';
const fs = require('fs');
const TRACE = process.argv.includes('trace');

/* ---------- canvas / dom stubs ---------------------------------------- */
function makeCtx() {
  const noop = () => {};
  return {
    canvas: null,
    fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, globalAlpha: 1, font: '', textAlign: 'left', textBaseline: 'alphabetic',
    imageSmoothingEnabled: true, shadowColor: '', shadowBlur: 0, letterSpacing: '0px',
    save: noop, restore: noop, translate: noop, scale: noop, rotate: noop,
    beginPath: noop, closePath: noop, moveTo: noop, lineTo: noop, arcTo: noop, arc: noop,
    ellipse: noop, rect: noop, fill: noop, stroke: noop, clip: noop,
    fillRect: noop, strokeRect: noop, clearRect: noop,
    drawImage: noop, fillText: noop, strokeText: noop,
    measureText: (t) => ({ width: String(t).length * 9 }),
    createLinearGradient: () => ({ addColorStop: noop }),
    createRadialGradient: () => ({ addColorStop: noop }),
  };
}
function makeCanvas() {
  const c = { width: 0, height: 0, style: {} };
  c.getContext = () => { if (!c._ctx) { c._ctx = makeCtx(); c._ctx.canvas = c; } return c._ctx; };
  c.addEventListener = (t, f) => { (c._h = c._h || {})[t] = f; };
  return c;
}
function makeEl(id) {
  const el = { id, textContent: '', style: {}, _cls: new Set() };
  el.classList = {
    add: (c) => el._cls.add(c), remove: (c) => el._cls.delete(c),
    toggle: (c, f) => { if (f === undefined) { el._cls.has(c) ? el._cls.delete(c) : el._cls.add(c); } else { f ? el._cls.add(c) : el._cls.delete(c); } },
    contains: (c) => el._cls.has(c),
  };
  el.addEventListener = (t, f) => { (el._h = el._h || {})[t] = f; };
  return el;
}

/* window === globalThis so the scripts' `global.X = ...` assignments land where bare
   identifiers resolve */
global.window = globalThis;
const handlers = {};
globalThis.addEventListener = (t, f) => { (handlers[t] = handlers[t] || []).push(f); };

const els = { game: makeCanvas() };
['overlay', 'btn-mute', 'btn-pause', 'btn-restart', 'btn-left', 'btn-right', 'btn-jump']
  .forEach((id) => { els[id] = makeEl(id); });

global.document = {
  readyState: 'complete',
  getElementById: (id) => els[id],
  createElement: (tag) => (tag === 'canvas' ? makeCanvas() : makeEl(tag)),
  addEventListener: () => {},
};

/* Image stub: loads synchronously so the urban-tileset draw paths run in-test */
global.Image = class {
  constructor() { this.width = 0; this.height = 0; }
  set src(v) {
    this._src = v;
    if (this.onload) { this.width = 1024; this.height = 1024; this.onload(); }
  }
  get src() { return this._src; }
};

/* Web Audio stub */
class FakeParam { constructor(v) { this.value = v; } setValueAtTime() {} linearRampToValueAtTime() {} exponentialRampToValueAtTime() {} }
class FakeNode {
  constructor(kind) { this.kind = kind; this.frequency = new FakeParam(440); this.gain = new FakeParam(1); this.type = 'square'; }
  connect() { return this; } disconnect() {} start() {} stop() {}
}
global.AudioContext = class {
  constructor() { this.currentTime = 0; this.sampleRate = 44100; this.destination = new FakeNode('dest'); }
  createGain() { return new FakeNode('gain'); }
  createOscillator() { return new FakeNode('osc'); }
  createBiquadFilter() { return new FakeNode('bq'); }
  createBufferSource() { return new FakeNode('src'); }
  createBuffer(ch, len) { const d = new Float32Array(len); return { getChannelData: () => d, length: len }; }
  resume() { return Promise.resolve(); }
};

const intervalFns = [];
globalThis.setInterval = (fn) => { intervalFns.push(fn); return intervalFns.length; };
globalThis.clearInterval = () => {};
let rafCb = null;
globalThis.requestAnimationFrame = (cb) => { rafCb = cb; };

/* ---------- load the game scripts into one scope ---------------------- */
const files = ['urban_sprites.js', 'art.js', 'audio.js', 'level.js', 'game.js'];
eval(files.map((f) => fs.readFileSync(f, 'utf8')).join('\n;\n'));

/* ---------- drive it -------------------------------------------------- */
function key(type, k) { (handlers[type] || []).forEach((f) => f({ key: k, preventDefault() {} })); }
let frames = 0;
function frame() {
  frames++;
  if (!rafCb) throw new Error('no animation callback registered');
  const cb = rafCb; rafCb = null;
  cb(frames * 16.67);
}
const D = globalThis.__DIAG;
if (!D) throw new Error('debug hook missing: game.js did not expose __DIAG');
const TILE = 32, PW = 20, PH = 26, WORLD_H = 17 * TILE;
let maxVx = 0, slips = 0, lastY = 0, hits = 0, lastHearts = 3, deaths = 0, lastLives = 3;

for (let i = 0; i < 4; i++) frame();                      /* title screen */
key('keydown', 'Enter');                                   /* start */
frame();
const s0 = D.snapshot();
if (s0.state !== 'playing') throw new Error('could not start the game');

key('keydown', 'ArrowRight');
key('keydown', 'Shift');          /* hold hurry the whole run */
let jumpHold = 0, bigJump = false;
let reached = null, result = null;

for (let i = 0; i < 12000 && !reached; i++) {
  const s = D.snapshot();
  if (s.state === 'end' || s.state === 'over') { reached = s.state; result = s; break; }
  if (s.state !== 'playing') { frame(); continue; }

  maxVx = Math.max(maxVx, Math.abs(s.vx));
  if (s.y > WORLD_H - 20 && lastY <= WORLD_H - 20) slips++;
  if (s.hearts < lastHearts) hits++;
  if (s.lives < lastLives) deaths++;
  lastY = s.y; lastHearts = s.hearts; lastLives = s.lives;

  /* bot: run right, jump holes / walls, and stomp anything in front of it */
  let wantJump = false, big = false;
  const feetRow = Math.floor((s.y + PH + 1) / TILE);
  const colMid = Math.floor((s.x + PW / 2) / TILE);
  if (s.onGround) {
    let holeAhead = false;
    for (let d = 1; d <= 3; d++) if (!D.tile(colMid + d, feetRow)) holeAhead = true;
    if (holeAhead) { wantJump = true; big = true; }
    const headRow = Math.floor((s.y + PH / 2) / TILE);
    if (D.tile(colMid + 1, headRow)) wantJump = true;
  }
  for (const e of D.enemyList()) {
    const dx = e.x - s.x;
    if (dx > 6 && dx < 44 && Math.abs(e.y - (s.y + PH)) < 50) wantJump = true;
  }
  if (wantJump && jumpHold === 0 && (s.onGround || s.vy > -100)) { jumpHold = big ? 26 : 16; bigJump = big; }
  if (jumpHold > 0) {
    key('keydown', ' ');
    jumpHold--;
    if (jumpHold === 0) key('keyup', ' ');
  }
  if (TRACE && ((s.x > 700 && s.x < 950) || (s.x > 1150 && s.x < 1350) || (s.x > 2200 && s.x < 2500))) {
    console.log('x', Math.round(s.x), 'y', Math.round(s.y), 'gnd', s.onGround, 'vy', Math.round(s.vy), 'vx', Math.round(s.vx), 'wJ', wantJump);
  }
  frame();
}

/* exercise the remaining states so their render paths run too */
for (let i = 0; i < 10; i++) frame();
key('keyup', 'ArrowRight');
key('keydown', 'r'); frame();
const restarted = D.snapshot().state;
els['btn-pause']._h.click({ preventDefault() {} }); frame();
const paused = D.snapshot().state;
els['btn-pause']._h.click({ preventDefault() {} }); frame();
els['btn-mute']._h.click({ preventDefault() {} }); frame();
els['btn-mute']._h.click({ preventDefault() {} }); frame();

const r = result || D.snapshot();
console.log('--- smoke ---');
console.log('finished:', reached || 'TIMEOUT', '| frames:', frames);
console.log('coins:', r.coins + '/' + r.totalCoins, '| score:', r.score, '| time:', r.elapsed.toFixed(1) + 's');
console.log('lives left:', r.lives, '| hits:', hits, '| pit slips:', slips, '| deaths:', deaths);
console.log('max |vx|:', Math.round(maxVx), '| reached x:', Math.round(r.x));
console.log('restart ->', restarted, '| pause click ->', paused, '| overlay hidden while playing:', els['overlay']._cls.has('hidden'));

const ok = reached === 'end' && r.coins > 0 && restarted === 'playing' && paused === 'paused';
console.log(ok ? 'PASS' : 'FAIL');
process.exit(ok ? 0 : 1);
