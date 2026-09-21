/* =========================================================================
   Kenney "Pixel Platformer" atlas (CC0).
   -------------------------------------------------------------------------
   ASSETS.md §1 assigns all physics/gameplay tiles, the player and the enemies
   to this kit. tools/gen_kenney.py packs the subset the game uses into one
   sheet; this module indexes it and exposes tile/character draw helpers.

   If the atlas is missing the game still runs - every helper returns false and
   the callers fall back to the procedural terrain and actors in 20_atlas.js /
   10_sprites.js.
   ========================================================================= */
(function () {
  AA.kenney = {
    img: null,
    ready: false,
    failed: false,
    index: (AA.KENNEY && AA.KENNEY.keys) || {},

    load: function (src) {
      var img = new Image();
      img.onload = function () { AA.kenney.ready = true; };
      img.onerror = function () { AA.kenney.failed = true; };
      img.src = src || (AA.KENNEY && AA.KENNEY.file) || 'build/kenney_atlas.png';
      AA.kenney.img = img;
    },

    has: function (key) { return !!(AA.kenney.index && AA.kenney.index[key]); },

    // Draw one atlas cell. align: 'topleft' (default), 'bottom' or 'center'.
    draw: function (ctx, key, x, y, scale, align, alpha) {
      var e = AA.kenney.index[key];
      if (!e || !AA.kenney.ready) return false;
      var s = scale == null ? 1 : scale;
      var w = e.w * s, h = e.h * s;
      var dx = x, dy = y;
      if (align === 'bottom') { dx = x - w / 2; dy = y - h; }
      else if (align === 'center') { dx = x - w / 2; dy = y - h / 2; }
      ctx.save();
      if (alpha != null) ctx.globalAlpha *= alpha;
      ctx.drawImage(AA.kenney.img, e.x, e.y, e.w, e.h, dx, dy, w, h);
      ctx.restore();
      return true;
    },

    // Draw one atlas cell scaled to fill an exact box (used by the HUD).
    drawFit: function (ctx, key, x, y, w, h, alpha) {
      var e = AA.kenney.index[key];
      if (!e || !AA.kenney.ready) return false;
      ctx.save();
      if (alpha != null) ctx.globalAlpha *= alpha;
      ctx.drawImage(AA.kenney.img, e.x, e.y, e.w, e.h, x, y, w, h);
      ctx.restore();
      return true;
    },
  };

  // --------------------------------------------------------------------- tiles
  // Deterministic variant pick so a tile column always looks the same.
  function variant(list, tx, ty) {
    var n = AA.tileNoise(tx, ty, 17);
    return list[Math.floor(n * list.length) % list.length];
  }

  var GRASS = ['grass1', 'grass2', 'grass3'];
  var GRASS_EDGE_L = 'grass20';
  var GRASS_EDGE_R = 'grass21';
  // Plain, unframed dirt for the ground interior: the bordered 40/41/60/80/100
  // blocks carry their own navy frame, which turns a deep terrain mass into a
  // visible grid. The framed blocks stay on the surface (as grass caps), which
  // is exactly the chunky look the kit is for.
  var DIRT = ['dirt4', 'dirt5', 'dirt24', 'dirt25'];
  var DIRT_LOT = ['sand120', 'sand121'];
  var WATER = ['water33', 'water34', 'water35'];
  var HEDGE = ['hedge16', 'hedge17', 'hedge18', 'hedge19'];
  var WOOD = ['wood49', 'wood50', 'wood51', 'wood52'];

  // Ground: grass cap over dirt fill, with left/right edge variants so the
  // terrain silhouette reads correctly at the ends of a run.
  // The world grid is 32px while Kenney's world tiles are 18px. Every cell is
  // drawn scaled to the full grid cell (nearest-neighbour, via the canvas
  // imageSmoothingEnabled = false setting) so tiles stay flush with the grid and
  // with the collision rects - no sub-cell gaps, no visible seams.
  AA.drawKenneyGround = function (ctx, tx, ty, zone, edge) {
    if (!AA.kenney.ready) return false;
    var x = tx * AA.TILE, y = ty * AA.TILE;
    var key;
    if (edge.top && edge.left) key = 'grass20';
    else if (edge.top && edge.right) key = 'grass21';
    else if (edge.top) key = variant(GRASS, tx, ty);
    else if (zone === 'build') key = variant(DIRT_LOT, tx, ty);
    else key = variant(DIRT, tx, ty);
    return AA.kenney.drawFit(ctx, key, x, y, AA.TILE, AA.TILE);
  };

  AA.drawKenneyWater = function (ctx, tx, ty, time, edge) {
    if (!AA.kenney.ready) return false;
    var x = tx * AA.TILE, y = ty * AA.TILE;
    var key = edge.top ? 'water33' : (Math.floor(time * 2 + tx) % 2 ? 'water34' : 'water35');
    return AA.kenney.draw(ctx, key, x, y, 1);
  };

  AA.drawKenneyHedge = function (ctx, tx, ty) {
    if (!AA.kenney.ready) return false;
    return AA.kenney.drawFit(ctx, variant(HEDGE, tx, ty), tx * AA.TILE, ty * AA.TILE, AA.TILE, AA.TILE);
  };

  AA.drawKenneyPlank = function (ctx, tx, ty, time) {
    if (!AA.kenney.ready) return false;
    return AA.kenney.drawFit(ctx, variant(WOOD, tx, ty),
      tx * AA.TILE, ty * AA.TILE, AA.TILE, AA.TILE);
  };

  AA.drawKenneyBrick = function (ctx, tx, ty) {
    if (!AA.kenney.ready) return false;
    return AA.kenney.drawFit(ctx, 'brick6', tx * AA.TILE, ty * AA.TILE, AA.TILE, AA.TILE);
  };
})();
