/* assets.js — asset registry + draw helpers for ANN ARBOR BROTHERS.
 *
 * Everything here is plain ES5-ish script (no modules) so the game runs when
 * index.html is opened straight off the filesystem (file:// protocol), where
 * <script type="module"> is blocked by CORS.
 *
 * Asset facts come from ASSETS.md / manifest/urban_tileset_manifest.json — the
 * game never "looks" at a PNG to decide what it is:
 *   sprites/Tiles/tile_NNNN.png            18x18 world tiles        (Kenney, CC0)
 *   sprites/Tiles/Characters/tile_NNNN.png 24x24 characters/enemies (Kenney, CC0)
 *   sprites/Tiles/Backgrounds/tile_NNNN.png 24x24 background fills  (Kenney, CC0)
 *   urbantileset/urbantileset32x32.png     irregular sprites, pixel rects in the JSON
 */
(function (global) {
  'use strict';

  var TILE = 18;          // Kenney world tile size in source pixels
  var CHAR = 24;          // Kenney character tile size in source pixels
  var BG   = 24;          // Kenney background tile size in source pixels
  var URBAN_TILE = 32;    // urban sheet cell size (props are scaled off this)

  var AAB = global.AAB = global.AAB || {};

  var A = AAB.assets = {
    images: {},           // key -> Image
    urban: null,          // the 1024x1024 urban sheet Image
    manifest: null,       // parsed urban_tileset_manifest.json
    urbanById: {},        // id -> manifest entry
    missing: [],          // paths that failed to load
    failedHard: false,    // set when a *critical* asset is missing
    error: ''
  };

  var manifestPath = 'manifest/urban_tileset_manifest.json';

  // ---------------------------------------------------------------- image load

  function loadImage(src) {
    return new Promise(function (resolve) {
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { A.missing.push(src); resolve(null); };
      img.src = src;
    });
  }

  // ------------------------------------------------------------- asset listing

  function tilePath(n) {
    return 'sprites/Tiles/tile_' + pad4(n) + '.png';
  }
  function charPath(n) {
    return 'sprites/Tiles/Characters/tile_' + pad4(n) + '.png';
  }
  function bgPath(n) {
    return 'sprites/Tiles/Backgrounds/tile_' + pad4(n) + '.png';
  }
  function pad4(n) {
    var s = String(n);
    while (s.length < 4) s = '0' + s;
    return s;
  }

  // The full Kenney kit is 180 + 27 + 24 small files. We load the whole thing so
  // any tile can be referenced by index without a per-tile whitelist to maintain.
  function buildQueue() {
    var q = [];
    var i;
    for (i = 0; i < 180; i++) q.push({ key: 't' + i, src: tilePath(i), kind: 'tile' });
    for (i = 0; i < 27; i++) q.push({ key: 'c' + i, src: charPath(i), kind: 'char' });
    for (i = 0; i < 24; i++) q.push({ key: 'b' + i, src: bgPath(i), kind: 'bg' });
    return q;
  }

  // ------------------------------------------------------------------- loading

  /**
   * Load everything the game needs.
   * @param {(done:number, total:number, label:string) => void} onProgress
   * @returns {Promise<void>}
   */
  function load(onProgress) {
    var queue = buildQueue();
    var total = queue.length + 2;   // + urban sheet + manifest
    var done = 0;
    function tick(label) {
      done++;
      if (onProgress) onProgress(done, total, label);
    }

    // The manifest is optional-but-wanted: without it we simply have no urban props.
    var manifestPromise = fetch(manifestPath)
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (json) {
        A.manifest = json;
        var list = (json && json.sprites) || [];
        for (var i = 0; i < list.length; i++) A.urbanById[list[i].id] = list[i];
        tick('urban manifest');
      })
      .catch(function (err) {
        A.error = 'urban manifest unavailable (' + (err && err.message) + ') — running without city decoration';
        console.warn('[assets] ' + A.error);
        tick('urban manifest (skipped)');
      });

    var urbanPromise = loadImage('urbantileset/urbantileset32x32.png')
      .then(function (img) {
        A.urban = img;
        if (!img) A.error = 'urban tileset sheet unavailable — running without city decoration';
        tick('urban sheet');
      });

    // Kenney files load in small batches: file:// browsers dislike 200 at once.
    var batchPromise = (function runBatches() {
      var i = 0;
      function nextBatch() {
        if (i >= queue.length) return Promise.resolve();
        var slice = queue.slice(i, i + 12);
        i += 12;
        return Promise.all(slice.map(function (item) {
          return loadImage(item.src).then(function (img) {
            if (img) A.images[item.key] = img;
            tick(item.src);
          });
        })).then(nextBatch);
      }
      return nextBatch();
    })();

    return Promise.all([manifestPromise, urbanPromise, batchPromise]).then(function () {
      // Critical assets: the physics tiles and the player/enemy sprites.
      var critical = ['t0', 't1', 't20', 't40', 't60', 't80', 't6', 't16', 't67',
                      't151', 't111', 'c6', 'c7', 'c18', 'c15'];
      var miss = critical.filter(function (k) { return !A.images[k]; });
      if (miss.length) {
        A.failedHard = true;
        A.error = 'critical sprite files missing: ' + miss.join(', ');
      }
      return A;
    });
  }

  // ------------------------------------------------------------- draw helpers

  /** Draw a Kenney world tile (18x18 source) by index, at (x,y) in canvas pixels. */
  function tile(ctx, n, x, y, scale) {
    var img = A.images['t' + n];
    if (!img) return false;
    scale = scale || 3;
    var w = TILE * scale;
    ctx.drawImage(img, 0, 0, TILE, TILE, x | 0, y | 0, w, w);
    return true;
  }

  /** Draw a Kenney character/enemy sprite (24x24 source) by index. */
  function chr(ctx, n, x, y, scale, flipX) {
    var img = A.images['c' + n];
    if (!img) return false;
    scale = scale || 3;
    var w = CHAR * scale;
    ctx.save();
    if (flipX) {
      ctx.translate(x + w, y);
      ctx.scale(-1, 1);
      ctx.drawImage(img, 0, 0, CHAR, CHAR, 0, 0, w, w);
    } else {
      ctx.drawImage(img, 0, 0, CHAR, CHAR, x | 0, y | 0, w, w);
    }
    ctx.restore();
    return true;
  }

  /** Draw a Kenney background fill (24x24 source) stretched to w/h canvas pixels. */
  function bgFill(ctx, n, x, y, w, h) {
    var img = A.images['b' + n];
    if (!img) return false;
    ctx.drawImage(img, 0, 0, BG, BG, x | 0, y | 0, w, h);
    return true;
  }

  /** Draw a background fill tiled across a rect (for parallax bands). */
  function bgRepeat(ctx, n, x, y, w, h, tilePx) {
    var img = A.images['b' + n];
    if (!img) return false;
    tilePx = tilePx || 72;
    for (var ty = 0; ty < Math.ceil(h / tilePx); ty++) {
      for (var tx = 0; tx < Math.ceil(w / tilePx); tx++) {
        ctx.drawImage(img, 0, 0, BG, BG,
          (x + tx * tilePx) | 0, (y + ty * tilePx) | 0, tilePx, tilePx);
      }
    }
    return true;
  }

  /** True if an urban manifest entry is decoration-safe (ASSETS.md "do not use" flags). */
  function urbanUsable(entry) {
    if (!entry) return false;
    if (entry.usable_as_decoration === false) return false;
    if (entry.category === 'filler') return false;            // flat color swatches
    if (/DLOU SAIYAN/i.test(entry.label || '')) return false;  // artist-name billboard
    if (/solid (black|navy|maroon|dark|color)/i.test(entry.label || '')) return false;
    return true;
  }

  /**
   * Draw an urban tileset sprite by manifest id.
   * @param {number} id
   * @param {number} x,y destination in canvas pixels
   * @param {number} scale  1 = native 32px cell scale. 0.5 => half native.
   * @returns {boolean} true if drawn
   */
  function urban(ctx, id, x, y, scale) {
    var entry = A.urbanById[id];
    var img = A.urban;
    if (!entry || !img) return false;
    if (!urbanUsable(entry)) return false;
    scale = scale == null ? 0.5 : scale;
    var w = Math.max(1, Math.round(entry.w * scale));
    var h = Math.max(1, Math.round(entry.h * scale));
    ctx.drawImage(img, entry.x, entry.y, entry.w, entry.h, x | 0, y | 0, w, h);
    return true;
  }

  /** Measured destination size of an urban sprite at a given scale. */
  function urbanSize(id, scale) {
    var entry = A.urbanById[id];
    if (!entry) return { w: 0, h: 0 };
    scale = scale == null ? 0.5 : scale;
    return { w: Math.max(1, Math.round(entry.w * scale)), h: Math.max(1, Math.round(entry.h * scale)) };
  }

  // -------------------------------------------------------------------- public

  AAB.assets.load = load;
  AAB.assets.tile = tile;
  AAB.assets.chr = chr;
  AAB.assets.bgFill = bgFill;
  AAB.assets.bgRepeat = bgRepeat;
  AAB.assets.urban = urban;
  AAB.assets.urbanSize = urbanSize;
  AAB.assets.urbanUsable = urbanUsable;
  AAB.assets.TILE = TILE;
  AAB.assets.CHAR = CHAR;
  AAB.assets.BG = BG;
  AAB.assets.URBAN_TILE = URBAN_TILE;
})(window);
