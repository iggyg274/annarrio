/* =========================================================================
   Ann Arbor: The Platformer - core utilities and shared constants
   ========================================================================= */
window.AA = window.AA || {};

AA.TILE = 32;

// Logical render resolution. The canvas is this big and CSS-scaled up, so the
// pixel art stays crisp (imageSmoothingEnabled = false + integer-ish scale).
AA.VIEW_W = 960;
AA.VIEW_H = 540;
AA.LEVEL_ROWS = 16;

AA.PHYS = {
  gravity: 1850,        // px / s^2
  moveAccel: 2400,
  airAccel: 1500,
  friction: 2600,
  maxRun: 205,
  maxWalk: 140,
  jumpVel: -540,
  jumpCut: 0.42,        // velocity multiplier when jump is released early
  coyote: 0.10,         // s of grace after leaving a ledge
  jumpBuffer: 0.12,     // s of grace for pressing jump before landing
  maxFall: 760,
  stompBounce: -400,
  enemySpeed: 46,
  droneSpeed: 62,
};

AA.COL = {
  maize: '#ffcb05',
  maizeDark: '#c99b00',
  blue: '#00274c',
  blueMid: '#1b4a7a',
  sky: '#8fd0ee',
  ink: '#12131a',
  white: '#f7f7f2',
};

AA.clamp = function (v, a, b) { return v < a ? a : (v > b ? b : v); };
AA.lerp = function (a, b, t) { return a + (b - a) * t; };
AA.rand = function (a, b) { return a + Math.random() * (b - a); };
AA.randInt = function (a, b) { return Math.floor(a + Math.random() * (b - a + 1)); };
AA.pick = function (arr) { return arr[Math.floor(Math.random() * arr.length)]; };

// Deterministic 32-bit RNG so a level seed can reproduce the same music,
// cloud jitter and decoration wobble.
AA.makeRng = function (seed) {
  var s = (seed | 0) || 0x9e3779b9;
  return function () {
    s ^= s << 13; s >>= 0; s ^= s >>> 17; s ^= s << 5; s >>= 0;
    return ((s >>> 0) % 100000) / 100000;
  };
};

// Cheap AABB overlap used everywhere (player/enemy/coin/pickup tests).
AA.aabb = function (ax, ay, aw, ah, bx, by, bw, bh) {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
};

// Round-rect path helper (HUD panels, signs).
AA.roundRect = function (ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
};

// Chunky pixel-font-ish text: draws with letter spacing so the low-fi signage
// reads as painted-on pixel lettering rather than a modern web font.
AA.spacedText = function (ctx, text, x, y, spacing, align) {
  var chars = String(text).split('');
  var widths = [], total = 0, i;
  for (i = 0; i < chars.length; i++) {
    var w = ctx.measureText(chars[i]).width;
    widths.push(w); total += w;
  }
  total += spacing * Math.max(0, chars.length - 1);
  var cx = x;
  if (align === 'center') cx = x - total / 2;
  else if (align === 'right') cx = x - total;
  for (i = 0; i < chars.length; i++) {
    ctx.fillText(chars[i], cx, y);
    cx += widths[i] + spacing;
  }
  return total;
};

AA.fmtTime = function (t) {
  var m = Math.floor(t / 60), s = Math.floor(t % 60);
  return m + ':' + (s < 10 ? '0' : '') + s;
};

// Raw tile character at a grid cell. Out-of-bounds above is sky, out-of-bounds
// sideways is a wall, and below the last authored row the world is solid rock
// (gen_level.py emits maximal solid runs for those rows into solidRects).
AA.tileAt = function (tx, ty) {
  var L = AA.LEVEL;
  if (!L) return '.';
  if (tx < 0 || tx >= L.cols) return '#';
  if (ty < 0) return '.';
  if (ty >= L.grid.length) return '#';
  return L.grid[ty].charAt(tx);
};

AA.levelSolid = function (tx, ty) {
  return AA.tileAt(tx, ty) === '#';
};

