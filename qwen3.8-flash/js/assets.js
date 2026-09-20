/* assets.js — image preloading + draw helpers. Plain script (works over file://). */
(function () {
  var AA = (typeof window !== 'undefined' ? window : globalThis);

  // ---- Kenney "Pixel Platformer" (CC0) file paths, one PNG per tile ----
  function pad4(n) { return ('000' + n).slice(-4); }
  var PATHS = {
    main: function (id) { return 'sprites/Tiles/tile_' + pad4(id) + '.png'; },
    chr:  function (id) { return 'sprites/Tiles/Characters/tile_' + pad4(id) + '.png'; },
    bg:   function (id) { return 'sprites/Tiles/Backgrounds/tile_' + pad4(id) + '.png'; }
  };

  // Which tiles we actually need — keeps preload small.
  var NEED_MAIN = [
    0, 1, 2, 3, 20, 21, 22, 23,          // grass-top ground
    40, 41, 42, 43, 60, 61, 62, 63,      // bordered dirt fill
    80, 81, 82, 83,
    100, 101, 102, 103,                  // plain dirt fill
    6,                                  // brick block
    12, 13, 14, 15,                     // red spotted blocks
    16, 17, 18, 19,                     // hedge cubes (campus greenery)
    10,                                 // mystery "!" block
    9, 28,                              // chest / locked chest
    27,                                 // key pickup
    44, 45, 46,                         // hearts: full/half/empty (HUD)
    49, 50,                             // wood planks (floating platforms)
    33, 34, 35,                         // water surface
    93, 94,                             // manhole rim / pipe segment
    111, 112,                           // checkered goal flag pieces
    151,                                // gold coin
    67,                                 // blue gem (bonus)
    68,                                 // goggles (power-up)
    153, 154, 155                       // clouds
  ];
  for (var d = 0; d <= 9; d++) NEED_MAIN.push(160 + d); // HUD digits (palette A)
  var NEED_CHR = [6, 7, 13, 14, 15, 16, 17, 18, 19, 20, 24, 25];
  var NEED_BG  = [14, 15]; // tree-line silhouettes for parallax

  var images = {};   // key -> Image
  var failed = {};   // key -> true (draw fallback box)
  var pending = -1;
  var listeners = [];

  function keyFor(kind, id) { return kind + ':' + id; }

  function flushListeners() { listeners.splice(0).forEach(function (f) { try { f(); } catch (e) {} }); }

  function loadAll(onDone) {
    if (onDone) listeners.push(onDone);
    if (pending === 0) { flushListeners(); return; } // already loaded
    if (pending > 0) return;                         // load in progress; will flush later
    var jobs = [];
    NEED_MAIN.forEach(function (id) { jobs.push(['main', id]); });
    NEED_CHR.forEach(function (id) { jobs.push(['chr', id]); });
    NEED_BG.forEach(function (id) { jobs.push(['bg', id]); });
    jobs.push(['urban', 0]); // the single urban sheet
    pending = jobs.length;

    function oneDone(key, ok) {
      if (!ok) failed[key] = true;
      pending--;
      if (pending === 0) flushListeners();
    }

    jobs.forEach(function (j) {
      var kind = j[0], id = j[1], k = keyFor(kind, id);
      var img = new Image();
      img.onload = function () { images[k] = img; oneDone(k, true); };
      img.onerror = function () { oneDone(k, false); };
      img.src = (kind === 'urban') ? 'urbantileset/urbantileset32x32.png' : PATHS[kind](id);
      img.imageSmoothingEnabled = false;
    });
  }

  function get(kind, id) { return images[keyFor(kind, id)] || null; }

  // Fallback marker so a missing file never silently breaks the picture.
  function fallbackBox(ctx, x, y, w, h) {
    ctx.fillStyle = '#e64bd6';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = '#000';
    ctx.fillRect(x + 2, y + 2, Math.max(1, w - 4), Math.max(1, h - 4));
  }

  // Kenney main tiles are 18px; characters/backgrounds are 24px.
  var TILE = 18;
  function tile(id) { return get('main', id); }

  // Draw a main-kit tile at native 18px, snapped to integers for crisp pixels.
  function drawTile(ctx, id, x, y) {
    var img = tile(id);
    if (!img) return fallbackBox(ctx, x, y, TILE, TILE);
    ctx.drawImage(img, Math.round(x), Math.round(y));
  }

  function drawChar(ctx, id, x, y, flipW) {
    var img = get('chr', id);
    if (!img) return fallbackBox(ctx, x, y, 24, 24);
    if (flipW) {
      ctx.save();
      ctx.translate(Math.round(x) + 24, Math.round(y));
      ctx.scale(-1, 1);
      ctx.drawImage(img, 0, 0);
      ctx.restore();
    } else {
      ctx.drawImage(img, Math.round(x), Math.round(y));
    }
  }

  function drawBgTile(ctx, id, x, y) {
    var img = get('bg', id);
    if (!img) return; // backgrounds are optional ambience
    ctx.drawImage(img, Math.round(x), Math.round(y));
  }

  // Urban sheet: draw sprite `id` (from AA.URBAN_RECTS) at dest, optional scale.
  // anchor: 'tl' top-left (default) or 'bl' bottom-left (x = left, y = ground line).
  function urbanSize(id, scale) {
    var r = AA.URBAN_RECTS[id]; if (!r) return null;
    scale = scale || 1;
    return { w: Math.round(r.w * scale), h: Math.round(r.h * scale) };
  }

  function drawUrban(ctx, id, x, y, scale, anchor) {
    var r = AA.URBAN_RECTS[id];
    var sheet = get('urban', 0);
    if (!r) return;
    if (!sheet) return fallbackBox(ctx, x, y, r.w * (scale || 1), r.h * (scale || 1));
    scale = scale || 1;
    var w = Math.round(r.w * scale), h = Math.round(r.h * scale);
    var dx = Math.round(x), dy = Math.round(y);
    if (anchor === 'bl') dy = Math.round(y - h);
    ctx.drawImage(sheet, r.x, r.y, r.w, r.h, dx, dy, w, h);
  }

  // HUD digits: value -> sequence of digit tiles 160..169.
  function drawNumber(ctx, value, x, y) {
    var s = String(value);
    for (var i = 0; i < s.length; i++) {
      drawTile(ctx, 160 + (+s[i]), x + i * 10, y);
    }
  }

  AA.Assets = {
    TILE: TILE,
    loadAll: loadAll,
    tile: tile,
    drawTile: drawTile,
    drawChar: drawChar,
    drawBgTile: drawBgTile,
    drawUrban: drawUrban,
    urbanSize: urbanSize,
    drawNumber: drawNumber,
    NEED: { main: NEED_MAIN, chr: NEED_CHR, bg: NEED_BG } // used by the smoke test
  };
})();
