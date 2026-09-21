/* art.js — procedural pixel-art generation for "DIAG DASH: An Ann Arbor Sprint".
 *
 * The Kenney kit described in ASSETS.md (sprites/Tiles/**) is not present in this
 * workspace, so all gameplay sprites/tiles are drawn at runtime into offscreen
 * canvases from primitives. Scenery comes from the urban city tileset via
 * urban_sprites.js (art credit: Dlou Saiyan).
 *
 * Everything here exposes ART.* — canvases only, no DOM assumptions beyond
 * document.createElement('canvas'), and nothing runs until ART.build() is called.
 */
(function (global) {
  'use strict';

  var PAL = {
    ink: '#0a1424',
    inkSoft: '#16233c',
    blue: '#0f3b73',
    blueD: '#08254a',
    blueL: '#2f6fb5',
    cyan: '#49d6d6',
    maize: '#ffcb05',
    maizeD: '#c08500',
    maizeL: '#ffe45c',
    white: '#f4f7ff',
    cream: '#fff3c9',
    gray: '#8b93a5',
    grayD: '#59617280', // unused-ish
    grayS: '#596172',
    grayL: '#c2c8d4',
    concrete: '#9aa1ad',
    brick: '#a8452f',
    brickD: '#6b2317',
    brickL: '#c9614a',
    dirt: '#5a4130',
    dirtD: '#3a291d',
    dirtL: '#7b5a3c',
    grass: '#3fa14a',
    grassD: '#1f6b32',
    grassL: '#7cc468',
    red: '#e2432f',
    wood: '#8b5a2b',
    woodD: '#5c3a1c',
    woodL: '#b0793d',
    metal: '#7d8797',
    skin: '#e6b18c'
  };

  function cv(w, h) {
    var c = document.createElement('canvas');
    c.width = Math.max(1, w | 0);
    c.height = Math.max(1, h | 0);
    return c;
  }

  /* Paint helper: works in "logical pixel" units multiplied by u. */
  function mk(lw, lh, u, fn) {
    var c = cv(Math.round(lw * u), Math.round(lh * u));
    var g = c.getContext('2d');
    var api = {
      g: g,
      px: function (x, y, w, h, col) {
        g.fillStyle = col;
        g.fillRect(x * u, y * u, w * u, h * u);
        return api;
      },
      /* rounded rect (radius in logical units) */
      rr: function (x, y, w, h, r, col) {
        g.fillStyle = col;
        pathRR(g, x * u, y * u, w * u, h * u, Math.min(r, Math.min(w, h) / 2) * u);
        g.fill();
        return api;
      },
      /* ellipse by bounding box (x,y,w,h in logical units) */
      ell: function (x, y, w, h, col) {
        g.fillStyle = col;
        g.beginPath();
        g.ellipse((x + w / 2) * u, (y + h / 2) * u, Math.max(0.4, (w / 2) * u), Math.max(0.4, (h / 2) * u), 0, 0, Math.PI * 2);
        g.fill();
        return api;
      },
      /* ellipse with outline */
      oell: function (x, y, w, h, col, ocol, ow) {
        ow = ow == null ? 0.6 : ow;
        api.ell(x - ow, y - ow, w + ow * 2, h + ow * 2, ocol);
        api.ell(x, y, w, h, col);
        return api;
      },
      tri: function (pts, col) {
        g.fillStyle = col;
        g.beginPath();
        for (var i = 0; i < pts.length; i += 2) {
          if (i === 0) g.moveTo(pts[i] * u, pts[i + 1] * u);
          else g.lineTo(pts[i] * u, pts[i + 1] * u);
        }
        g.closePath();
        g.fill();
        return api;
      }
    };
    fn(api, u);
    return c;
  }

  function pathRR(g, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    g.beginPath();
    g.moveTo(x + r, y);
    g.lineTo(x + w - r, y);
    g.arcTo(x + w, y, x + w, y + r, r);
    g.lineTo(x + w, y + h - r);
    g.arcTo(x + w, y + h, x + w - r, y + h, r);
    g.lineTo(x + r, y + h);
    g.arcTo(x, y + h, x, y + h - r, r);
    g.lineTo(x, y + r);
    g.arcTo(x, y, x + r, y, r);
  }

  /* deterministic pseudo-random for texture speckles */
  function rng(seed) {
    var s = seed >>> 0;
    return function () {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  /* ------------------------------------------------------------------ */
  /* TILES (32x32, drawn at u=1 with chunky 2-unit patterns)             */
  /* ------------------------------------------------------------------ */

  function speckle(a, seed, n, cols, y0, y1) {
    var r = rng(seed);
    for (var i = 0; i < n; i++) {
      var x = Math.floor(r() * 30);
      var y = y0 + Math.floor(r() * (y1 - y0));
      a.px(x, y, 2, 2, cols[Math.floor(r() * cols.length)]);
    }
    return a;
  }

  function tileConcreteTop(a) {
    a.px(0, 0, 32, 32, PAL.concrete);
    a.px(0, 0, 32, 3, PAL.grayL); // top highlight
    a.px(0, 3, 32, 1, PAL.grayS);
    // slab seams
    a.px(0, 4, 1, 28, PAL.grayS);
    a.px(15, 6, 1, 26, '#7c8394');
    a.px(23, 12, 1, 20, '#7c8394');
    speckle(a, 11, 14, ['#8b93a5', '#a7adba', '#7c8394'], 6, 26);
    a.px(0, 30, 32, 2, PAL.grayS);
  }

  function tileConcreteFill(a) {
    a.px(0, 0, 32, 32, '#6f7684');
    speckle(a, 5, 18, ['#5d6472', '#7b8391', '#4f5663'], 0, 32);
    a.px(0, 0, 32, 1, '#5d6472');
  }

  function tileBrickTop(a) {
    // State Street style brick-paved sidewalk (top surface)
    var cols = ['#a8452f', '#9c3d2a', '#b8563d'];
    a.px(0, 0, 32, 32, PAL.brickD);
    var rows = 4, hgt = 7;
    for (var r = 0; r < rows; r++) {
      var off = (r % 2) * 8;
      for (var x = -16 + off; x < 32; x += 16) {
        a.px(x + 1, r * hgt + 1, 14, hgt - 1, cols[(x + r * 31) & 1 ? 1 : 0]);
      }
    }
    a.px(0, 0, 32, 2, PAL.brickL); // sun-warmed top edge
    speckle(a, 77, 8, ['#c9614a', '#8f3a26'], 4, 30);
  }

  function tileBrickFill(a) {
    var cols = ['#8f3a26', '#7e3120', '#a1452f'];
    a.px(0, 0, 32, 32, PAL.brickD);
    for (var r = 0; r < 4; r++) {
      var off = (r % 2) * 8;
      for (var x = -16 + off; x < 32; x += 16) {
        a.px(x + 1, r * 8 + 1, 14, 6, cols[(x + r * 13) & 1]);
      }
    }
    speckle(a, 91, 6, ['#6b2317', '#a8452f'], 0, 32);
  }

  function tileGrassTop(a) {
    a.px(0, 0, 32, 32, PAL.grass);
    a.px(0, 0, 32, 4, PAL.grassL);
    a.px(0, 4, 32, 1, PAL.grassD);
    var r = rng(42);
    for (var i = 0; i < 26; i++) {
      var x = Math.floor(r() * 30), y = 5 + Math.floor(r() * 25);
      a.px(x, y, 2, 2, r() > 0.5 ? PAL.grassD : PAL.grassL);
    }
    // blades poking up along the top edge
    for (var b = 0; b < 8; b++) {
      var bx = Math.floor(r() * 30);
      a.px(bx, 0, 2, 1 + Math.floor(r() * 2), PAL.grassL);
    }
  }

  function tileDirtFill(a) {
    a.px(0, 0, 32, 32, PAL.dirt);
    speckle(a, 23, 20, [PAL.dirtD, PAL.dirtL, '#4a3527'], 0, 32);
    // a couple of pebbles
    a.px(6, 9, 3, 3, '#8a7f72');
    a.px(21, 20, 2, 2, '#8a7f72');
  }

  function tileHedge(a) {
    a.px(0, 0, 32, 32, PAL.grassD);
    var r = rng(5);
    for (var i = 0; i < 60; i++) {
      var x = Math.floor(r() * 30), y = Math.floor(r() * 30);
      a.px(x, y, 2 + Math.floor(r() * 2), 2, r() > 0.45 ? PAL.grass : PAL.grassL);
    }
    a.px(0, 0, 32, 3, PAL.grassL);
    speckle(a, 61, 10, ['#e0784f', '#c94b6d'], 2, 30); // little berries
  }

  function tileWood(a) {
    a.px(0, 0, 32, 32, PAL.wood);
    a.px(0, 0, 32, 3, PAL.woodL);
    a.px(0, 3, 32, 1, PAL.woodD);
    a.px(0, 29, 32, 3, PAL.woodD);
    // grain
    for (var i = 0; i < 5; i++) a.px(2 + i * 6, 8 + (i % 2) * 4, 4, 1, PAL.woodD);
    a.px(0, 0, 1, 32, PAL.woodD);
    a.px(31, 0, 1, 32, PAL.woodD);
    // bolts
    a.px(3, 15, 2, 2, '#c9a86a');
    a.px(27, 15, 2, 2, '#c9a86a');
  }

  function tileBrickBlock(a) {
    var cols = ['#b34a30', '#9c3d2a'];
    a.px(0, 0, 32, 32, PAL.brickD);
    for (var r = 0; r < 4; r++) {
      var off = (r % 2) * 8;
      for (var x = -16 + off; x < 32; x += 16) {
        a.px(x + 1, r * 8 + 1, 14, 6, cols[(x + r * 7) & 1]);
      }
    }
    // bevel
    a.px(0, 0, 32, 2, PAL.brickL);
    a.px(0, 0, 2, 32, '#c9614a');
    a.px(0, 30, 32, 2, '#5e1d13');
    a.px(30, 0, 2, 32, '#5e1d13');
  }

  function drawMGlyph(a, x, y, s, col) {
    // chunky pixel "M" on a s-unit grid (s=1 -> 7x7 logical cells scaled)
    var u = s;
    function c(cx, cy, w, h) { a.px(x + cx * u, y + cy * u, w * u, h * u, col); }
    c(0, 0, 1, 8);          // left stem
    c(7, 0, 1, 8);          // right stem
    c(1, 1, 1, 1); c(2, 2, 1, 1); c(3, 3, 1, 1);   // left diagonal
    c(5, 1, 1, 1); c(4, 2, 1, 1);                   // right diagonal
  }

  function tileMBlock(a) {
    a.px(0, 0, 32, 32, PAL.blueD);
    a.px(1, 1, 30, 30, PAL.blue);
    // bevel highlights
    a.px(1, 1, 30, 2, PAL.blueL);
    a.px(1, 1, 2, 30, PAL.blueL);
    a.px(1, 30, 30, 1, '#05172f');
    a.px(30, 1, 1, 30, '#05172f');
    // corner rivets
    var r4 = [[4, 4], [26, 4], [4, 26], [26, 26]];
    for (var i = 0; i < r4.length; i++) a.px(r4[i][0] - 1, r4[i][1] - 1, 2, 2, PAL.cyan);
    // maize M
    drawMGlyph(a, 9, 8, 2, PAL.maizeD);
    drawMGlyph(a, 9, 7, 2, PAL.maize);
  }

  function tileUsedBlock(a) {
    a.px(0, 0, 32, 32, '#3c4453');
    a.px(1, 1, 30, 30, '#4d5566');
    a.px(1, 1, 30, 2, '#5f6778');
    a.px(1, 1, 2, 30, '#5f6778');
    // cracks
    a.px(9, 6, 1, 8, '#2c3240');
    a.px(10, 12, 6, 1, '#2c3240');
    a.px(20, 15, 1, 7, '#2c3240');
    a.px(14, 22, 5, 1, '#2c3240');
  }

  function tileStoneBlock(a) {
    a.px(0, 0, 32, 32, '#7a8090');
    a.px(1, 1, 30, 30, '#9aa1ad');
    a.px(1, 1, 30, 2, '#c2c8d4');
    a.px(1, 1, 2, 30, '#c2c8d4');
    a.px(1, 30, 30, 1, '#5b6270');
    a.px(30, 1, 1, 30, '#5b6270');
    speckle(a, 17, 8, ['#8b93a5', '#adb4c1'], 4, 28);
  }

  function tileWater(a) {
    a.px(0, 0, 32, 32, '#1f5fa8');
    a.px(0, 0, 32, 5, '#49d6d6');
    a.px(0, 5, 32, 1, '#2f7fc0');
    var r = rng(33);
    for (var i = 0; i < 12; i++) {
      var x = Math.floor(r() * 28), y = 8 + Math.floor(r() * 22);
      a.px(x, y, 4, 1, r() > 0.5 ? '#2f7fc0' : '#3fbfe0');
    }
  }

  /* ------------------------------------------------------------------ */
  /* PLAYER                                                              */
  /* ------------------------------------------------------------------ */

  var LEGS = {
    idle: [[3.0, 11.2, 2.0, 2.4], [5.6, 11.2, 2.0, 2.4]],
    walkA: [[2.0, 11.0, 2.2, 2.6], [5.8, 11.6, 2.0, 2.0]],
    walkB: [[5.9, 11.0, 2.2, 2.6], [3.0, 11.6, 2.0, 2.0]],
    jump: [[3.4, 10.6, 2.0, 2.0], [5.4, 10.9, 2.0, 1.7]],
    fall: [[2.2, 11.0, 2.2, 2.8], [6.0, 11.0, 2.2, 2.8]],
    win: [[3.4, 11.4, 2.0, 2.0], [5.4, 11.4, 2.0, 2.0]]
  };

  function drawPlayer(mode) {
    return mk(10, 14, 2, function (a) {
      var bob = mode === 'idle' ? 0.15 : 0;
      // legs + shoes (blue)
      var legs = LEGS[mode] || LEGS.idle;
      for (var i = 0; i < legs.length; i++) {
        var L = legs[i];
        a.px(L[0], L[1] - bob, L[2], L[3], PAL.blueD);
        a.px(L[0], L[1] + L[3] - 1.1 - bob, L[2] + 0.6, 1.1, PAL.ink); // sole
      }
      // arms
      var armY = mode === 'win' ? 3.4 : 6.2;
      var armX = mode === 'win' ? -0.4 : 0;
      a.px(0.9 + armX, armY, 1.5, 2.2, PAL.maizeD);
      a.px(7.7 - armX, armY, 1.5, 2.2, PAL.maizeD);

      // body (maize ball) with ink outline
      a.oell(1.0, 3.4, 8.0, 8.0, PAL.maize, PAL.ink, 0.7);
      a.ell(2.2, 4.6, 3.2, 3.0, PAL.maizeL); // soft highlight
      a.ell(5.0, 9.0, 3.6, 2.6, PAL.maizeD); // under-shade

      // little number "1" bib? keep clean: blue stripe across the ball
      a.px(1.8, 9.4, 6.4, 1.2, PAL.blue);

      // cap (maize-and-blue: blue cap, maize button)
      a.oell(2.0, 1.0, 5.8, 3.4, PAL.blue, PAL.ink, 0.6);
      a.px(6.2, 3.1, 3.0, 1.1, PAL.blueD); // brim to the right
      a.px(4.5, 0.4, 1.1, 1.1, PAL.maize); // button on top

      // eyes (facing right): one big, one small
      a.oell(5.4, 4.7, 2.6, 3.0, PAL.white, PAL.ink, 0.5);
      a.px(6.2, 5.4, 1.1, 1.5, PAL.ink);
      a.oell(3.1, 5.0, 1.7, 2.2, PAL.white, PAL.ink, 0.4);
      a.px(3.4, 5.5, 0.9, 1.2, PAL.ink);

      // grin
      if (mode !== 'fall') a.px(4.6, 8.6, 2.2, 0.7, '#8a5b00');
      else a.oell(4.7, 8.3, 1.9, 1.6, PAL.blueD, PAL.ink, 0.35); // whoa!
    });
  }

  /* ------------------------------------------------------------------ */
  /* ENEMIES                                                             */
  /* ------------------------------------------------------------------ */

  function drawRover(frame, tint) {
    var body = tint || '#2f4d7c';
    return mk(9, 7, 2, function (a) {
      // treads
      a.px(0.6, 5.0, 7.8, 1.9, PAL.ink);
      for (var i = 0; i < 6; i++) {
        var tx = 1.0 + i * 1.3 + (frame ? 0.6 : 0);
        if (tx < 8.2) a.px(tx, 5.4, 0.7, 1.1, '#4b5568');
      }
      // chassis
      a.oell(0.9, 1.4, 7.2, 4.2, body, PAL.ink, 0.7);
      a.ell(1.6, 2.0, 3.0, 1.6, '#5b6c8f');
      // antenna
      a.px(2.2, 0.6, 0.8, 1.4, PAL.grayS);
      a.px(1.9, 0.0, 1.4, 1.0, frame ? PAL.red : PAL.cyan);
      // eye lamp facing right
      a.oell(5.4, 2.3, 2.4, 2.2, PAL.cyan, PAL.ink, 0.5);
      a.px(6.2, 3.0, 1.0, 0.9, '#eafcff');
      // bumper spikes on the left (it bumps you from behind)
      a.tri([0.4, 3.0, -0.2, 2.2, -0.2, 3.8], PAL.grayS);
    });
  }

  function drawDrone(frame) {
    return mk(11, 7, 2, function (a) {
      // rotor
      var rw = frame ? 5.4 : 3.0;
      a.px(5.6 - rw / 2, 0.4, rw, 0.8, '#9fb0c6');
      a.px(5.2, 1.0, 1.0, 1.4, PAL.grayS);
      // body (rocket-ish pointing right)
      a.oell(1.0, 2.2, 7.0, 3.4, '#3a4c6e', PAL.ink, 0.7);
      a.tri([8.0, 2.4, 10.4, 3.9, 8.0, 5.4], PAL.red); // nose cone
      a.px(1.4, 1.6, 2.4, 1.2, PAL.red); // tail fin
      a.ell(2.2, 3.0, 2.4, 1.8, '#5b6c8f');
      // eye
      a.oell(5.9, 3.0, 2.2, 2.0, PAL.maize, PAL.ink, 0.5);
      a.px(6.6, 3.6, 1.0, 0.9, PAL.ink);
      // little claw/parcel underneath (delivery drone)
      a.px(3.4, 5.6, 2.6, 1.4, frame ? PAL.maizeD : PAL.woodL);
    });
  }

  function drawSquirrel(frame) {
    // "campus squirrel" — stompable, scurries; orange-ish tail
    return mk(9, 7, 2, function (a) {
      a.px(0.4, 2.6, 1.6, 3.4, '#a85a24'); // tail up
      a.px(0.0, 1.0, 2.2, 2.2, '#c9752f');
      a.oell(1.9, 3.2, 4.6, 3.0, '#b4632a', PAL.ink, 0.6);
      a.oell(5.2, 2.4, 3.0, 3.0, '#c9752f', PAL.ink, 0.6); // head right
      a.px(4.0, 1.8, 1.0, 1.2, '#a85a24'); // ear
      a.px(6.6, 3.2, 1.0, 1.1, PAL.white); // eye white
      a.px(7.1, 3.4, 0.7, 0.8, PAL.ink);
      a.px(7.4, 4.6, 1.2, 0.8, '#f4d9a0'); // nut in paws
      var d = frame ? 0.5 : 0;
      a.px(2.4 + d, 6.0, 1.2, 1.0, '#8a4a1c');
      a.px(4.4 - d, 6.0, 1.2, 1.0, '#8a4a1c');
    });
  }

  /* ------------------------------------------------------------------ */
  /* PICKUPS / ITEMS                                                     */
  /* ------------------------------------------------------------------ */

  function drawCoin(frame) {
    // frame 0..3 -> spin widths
    var w = [6.2, 4.2, 1.8, 4.2][frame];
    return mk(7, 7, 2, function (a) {
      var x = 3.5 - w / 2;
      a.oell(x, 0.3, w, 6.4, PAL.maize, PAL.ink, 0.5);
      if (w > 3) {
        a.px(x + w * 0.28, 1.4, Math.max(0.8, w * 0.14), 4.2, PAL.maizeD);
        drawMGlyph(a, x + w * 0.5 - (w > 5 ? 3.5 : 2), 1.4, w > 5 ? 0.9 : 0.7, PAL.blue);
      } else {
        a.px(x + 0.2, 1.0, Math.max(0.6, w * 0.4), 4.4, PAL.maizeD);
      }
    });
  }

  function drawHeart(full) {
    return mk(8, 7, 2, function (a) {
      var col = full ? PAL.red : '#5c6474';
      a.oell(0.7, 0.3, 3.2, 3.2, col, PAL.ink, 0.5);
      a.oell(4.1, 0.3, 3.2, 3.2, col, PAL.ink, 0.5);
      a.tri([0.3, 2.6, 7.7, 2.6, 4.0, 6.9], col);
      // merge outlines: redraw body outline then inner
      if (full) {
        a.px(1.8, 1.4, 1.2, 1.2, '#ff8f7a');
      } else {
        a.px(1.8, 1.4, 1.2, 1.2, '#6d7585');
      }
    });
  }

  function drawCherry(frame) {
    return mk(9, 8, 2, function (a) {
      a.px(3.6, 0.4, 0.9, 3.0, PAL.grassD); // stems
      a.px(3.6, 0.4, 3.0, 0.9, PAL.grassD);
      a.oell(1.2, 3.2, 3.4, 3.4, '#c81f3b', PAL.ink, 0.5);
      a.oell(4.4, 4.0, 3.4, 3.4, '#e23b57', PAL.ink, 0.5);
      if (!frame) { a.px(1.9, 4.0, 1.0, 1.0, '#ff9aac'); a.px(5.1, 4.8, 1.0, 1.0, '#ff9aac'); }
    });
  }

  function drawCoffee(frame) {
    return mk(9, 9, 2, function (a) {
      // steam
      var s = frame ? 0 : 1;
      a.px(3.2, 0.0 + s * 0.6, 0.9, 1.4, '#cfe3f5');
      a.px(5.0, 0.6 - s * 0.4, 0.9, 1.4, '#cfe3f5');
      // lid
      a.px(1.8, 2.0, 5.6, 1.2, PAL.blue);
      a.px(2.4, 1.3, 4.4, 0.9, PAL.blueL);
      // cup (tapered)
      for (var i = 0; i < 5; i++) {
        var wdt = 5.6 - i * 0.5;
        a.px(3.5 - wdt / 2, 3.3 + i * 1.0, wdt, 1.0, '#f4f7ff');
      }
      a.px(2.1, 4.6, 3.0, 1.0, PAL.maize); // maize band
      a.px(3.0, 6.6, 4.2, 0.9, '#d8dee9');
    });
  }

  function drawFlag() {
    return mk(13, 9, 2, function (a) {
      a.tri([0, 0, 12.4, 1.6, 0, 3.4], PAL.maize);
      a.tri([0, 3.4, 12.4, 5.0, 0, 8.4], PAL.blue);
      drawMGlyph(a, 2.0, 1.6, 0.9, PAL.blueD);
      a.px(0, 0, 1.0, 8.4, PAL.maizeL);
    });
  }

  function drawScorePop() {
    return mk(10, 6, 2, function (a) {
      a.oell(0.5, 0.5, 9.0, 5.0, '#ffffffcc', '#0a142480', 0.5);
    });
  }

  /* ------------------------------------------------------------------ */
  /* HUD bits                                                            */
  /* ------------------------------------------------------------------ */

  function drawLifeIcon() {
    return mk(9, 9, 2, function (a) {
      a.oell(1.0, 3.0, 6.0, 5.4, PAL.maize, PAL.ink, 0.6);
      a.px(2.2, 5.4, 4.6, 1.0, PAL.blue);
      a.oell(2.2, 0.8, 3.6, 2.6, PAL.blue, PAL.ink, 0.5);
      a.px(4.7, 2.6, 2.0, 0.9, PAL.blueD);
      a.oell(4.4, 3.6, 1.8, 2.0, PAL.white, PAL.ink, 0.4);
      a.px(5.1, 4.2, 0.8, 1.0, PAL.ink);
    });
  }

  /* ------------------------------------------------------------------ */
  /* BUILD                                                                */
  /* ------------------------------------------------------------------ */

  var ART = {
    PAL: PAL,
    tiles: null,
    player: null,
    enemies: null,
    items: null,
    built: false,
    build: function () {
      if (ART.built) return ART;
      var T = {};
      T.concreteTop = mk(32, 32, 1, tileConcreteTop);
      T.concreteFill = mk(32, 32, 1, tileConcreteFill);
      T.brickTop = mk(32, 32, 1, tileBrickTop);
      T.brickFill = mk(32, 32, 1, tileBrickFill);
      T.grassTop = mk(32, 32, 1, tileGrassTop);
      T.dirtFill = mk(32, 32, 1, tileDirtFill);
      T.hedge = mk(32, 32, 1, tileHedge);
      T.wood = mk(32, 32, 1, tileWood);
      T.brickBlock = mk(32, 32, 1, tileBrickBlock);
      T.mBlock = mk(32, 32, 1, tileMBlock);
      T.usedBlock = mk(32, 32, 1, tileUsedBlock);
      T.stoneBlock = mk(32, 32, 1, tileStoneBlock);
      T.water = mk(32, 32, 1, tileWater);
      ART.tiles = T;

      var P = {};
      P.idle = drawPlayer('idle');
      P.walkA = drawPlayer('walkA');
      P.walkB = drawPlayer('walkB');
      P.jump = drawPlayer('jump');
      P.fall = drawPlayer('fall');
      P.win = drawPlayer('win');
      ART.player = P;

      var E = {};
      E.rover = [drawRover(0, '#2f4d7c'), drawRover(1, '#2f4d7c')];
      E.roverRed = [drawRover(0, '#7c2f3b'), drawRover(1, '#7c2f3b')];
      E.drone = [drawDrone(0), drawDrone(1)];
      E.squirrel = [drawSquirrel(0), drawSquirrel(1)];
      ART.enemies = E;

      var I = {};
      I.coin = [drawCoin(0), drawCoin(1), drawCoin(2), drawCoin(3)];
      I.heartFull = drawHeart(true);
      I.heartEmpty = drawHeart(false);
      I.cherry = [drawCherry(0), drawCherry(1)];
      I.coffee = [drawCoffee(0), drawCoffee(1)];
      I.flag = drawFlag();
      I.pop = drawScorePop();
      I.life = drawLifeIcon();
      ART.items = I;

      ART.built = true;
      return ART;
    }
  };

  global.ART = ART;
})(typeof window !== 'undefined' ? window : globalThis);
