/* =========================================================================
   Procedural character / enemy art.
   -------------------------------------------------------------------------
   The manifest in ASSETS.md points at a Kenney "Pixel Platformer" kit in
   sprites/ for the player and enemies. That directory does not exist in this
   workspace (only the urban tileset is present), so the actors are drawn here
   as small pixel-art strings and rasterised to offscreen canvases at boot.

   Per ASSETS.md's own recommendation, the player wears MAIZE with blue
   trousers so the free maize-and-blue Michigan colour joke survives.
   ========================================================================= */
(function () {
  var P = {
    '.': null,
    k: '#1b1b22', // outline
    m: '#ffcb05', // maize (jacket)
    M: '#d99b00', // maize shadow
    h: '#fff0a8', // maize highlight
    s: '#f0c39a', // skin
    S: '#c98f63', // skin shadow
    j: '#1d3f6e', // denim
    J: '#0d2240', // denim dark
    w: '#f7f7f2', // white (shoe / eye)
    b: '#3a2a1c', // hair / boot
    n: '#6b4a2a', // backpack strap
    p: '#5b3b1f', // backpack
    g: '#2b2b33', // metal
    y: '#ffcb05',
    c: '#68c6e8',
    d: '#20222c',
    e: '#8b93a8',
    o: '#ff8b2e',
    r: '#e0483c',
  };

  // 15 x 19 player, facing right. Legs live in the last two rows so the walk
  // cycle is just those two rows swapped.
  var PLAYER_BODY = [
    '.....kkkkk.....',
    '....kmmmmmk....',
    '...kmhmmmmmk...',
    '...kmmmmmmmk...',
    '...kmskkksmk...',
    '...kmskwksmk...',
    '...kkssssskk...',
    '....ksssssk....',
    '...kmmmmmmmk...',
    '..kmMmmmmmMmk..',
    '.kkmmmmmmmmmkk.',
    '.kmmmmmmmmmmmk.',
    '.kMmmmpppmmmMk.',
    '.kMmmmpppmmmMk.',
    '.kkmmmmmmmmmkk.',
    '..ksssssssssk..',
  ];
  var LEGS_A = ['..kjjjkkjjjk...', '..kJJk..kJJk...', '.kbbbk..kbbbk..'];
  var LEGS_B = ['..kjjjkkjjjk...', '.kjjjk..kjjjk..', 'kbbbk....kbbbk.'];
  var LEGS_JUMP = ['..kjjjkkjjjk...', '.kjjjk...kjjjk.', 'kbbbk.......kk.'];

  function mirror(rows) {
    return rows.map(function (r) { return r.split('').reverse().join(''); });
  }

  // ---------------------------------------------------------------------
  // Small enemies. robo = stompable ground patrol, drone = flying patrol.
  // ---------------------------------------------------------------------
  var ROBO = [
    '...kkkkkk...',
    '..kggggggk..',
    '.kggwwwwggk.',
    '.kgwkkkkwgk.',
    '.kgwkwrkwgk.',
    '.kgwkkkkwgk.',
    '.kggggggggk.',
    '..kggggggk..',
    '..kdkddkdk..',
    '.kddkddkddk.',
  ];
  var ROBO_B = [
    '...kkkkkk...',
    '..kggggggk..',
    '.kggwwwwggk.',
    '.kgwkkkkwgk.',
    '.kgwkrkwggk.',
    '.kgwkkkkwgk.',
    '.kggggggggk.',
    '..kggggggk..',
    '..kddddddk..',
    '.kdkddddkdk.',
  ];
  var DRONE = [
    '..e..........e..',
    '...e........e...',
    'kkk.e.kkkk.e.kkk',
    '.kkkkkddddkkkkk.',
    '...kddddddddk...',
    '..kddrrrrrdddk..',
    '..kddrkkkkdddk..',
    '...kddddddddk...',
    '....kkkkkkkk....',
    '......g..g......',
  ];
  var DRONE_B = [
    '...e........e...',
    '.e..e......e..e.',
    '.kkk.e.kk.e.kkk.',
    '.kkkkkddddkkkkk.',
    '...kddddddddk...',
    '..kddrrrrrdddk..',
    '..kddrkkkkdddk..',
    '...kddddddddk...',
    '....kkkkkkkk....',
    '.....gg..gg.....',
  ];
  // Rare "big" unit for the stadium stretch (from ASSETS.md's tracked-rover
  // suggestion): taller, needs to be stomped twice.
  var TANK = [
    '....kkkkkkkk....',
    '...kggggggggk...',
    '..kgwwwwwwwwgk..',
    '..kgwkkkkkkwgk..',
    '..kgwkwrrkwggk..',
    '..kgwkkkkkkwgk..',
    '.kggggggggggggk.',
    '.kgdddddddddggk.',
    '.kgdddddddddggk.',
    '.kggggggggggggk.',
    '..kddkddddkddk..',
    '.kdddkddddkdddk.',
  ];

  function pxRows(rows) {
    return rows.map(function (r) { return r.split(''); });
  }

  function build(rows, pal) {
    var h = rows.length, w = rows[0].length;
    var cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    var ctx = cv.getContext('2d');
    var img = ctx.createImageData(w, h);
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var col = pal[rows[y][x]];
        if (!col) continue;
        var c = parseInt(col.slice(1), 16);
        var i = (y * w + x) * 4;
        img.data[i] = (c >> 16) & 255;
        img.data[i + 1] = (c >> 8) & 255;
        img.data[i + 2] = c & 255;
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return cv;
  }

  function frames(body, legSets) {
    return legSets.map(function (legs) { return build(body.concat(legs), P); });
  }

  AA.SPR = {};

  // ---------------------------------------------------------------------
  // Primary path: the Kenney kit's own characters (ASSETS.md §1b).
  //   player  tile 6/7   - maize hooded runner (the recommended option)
  //   robo    tile 19/20 - small boxy rovers patrolling the pavement
  //   squat   tile 13/14 - small ground creatures
  //   drone   tile 15/16 - flying units
  //   bat     tile 24    - second flying silhouette
  //   tank    tile 22    - the larger tracked rover
  // Every entry is [frameA, frameB]; frames are pinned to the feet so the
  // character stands exactly on the tile below it.
  var KENNEY_ACTORS = {
    player: { frames: ['p_maize_a', 'p_maize_b'], scale: 1.5 },
    robo: { frames: ['e_rover_a', 'e_rover_b'], scale: 1.5 },
    squat: { frames: ['e_squat_a', 'e_squat_b'], scale: 1.3 },
    drone: { frames: ['e_drone_a', 'e_drone_b'], scale: 1.3 },
    bat: { frames: ['e_bat', 'e_bat'], scale: 1.3 },
    tank: { frames: ['e_tank_a', 'e_tank_b'], scale: 1.6 },
  };

  AA.buildActorSprites = function () {
    // --- Kevin-style procedural fallback (runs when the Kenney atlas is absent)
    var bodyR = mirror(PLAYER_BODY);
    var legsR = [mirror(LEGS_A), mirror(LEGS_B), mirror(LEGS_JUMP)];

    AA.SPR.actor = {};
    Object.keys(KENNEY_ACTORS).forEach(function (name) {
      var def = KENNEY_ACTORS[name];
      var e = AA.kenney.index[def.frames[0]];
      var s = def.scale;
      var w = e ? e.w * s : 32;
      var h = e ? e.h * s : 36;
      AA.SPR.actor[name] = {
        frames: def.frames, scale: s, w: w, h: h, kenney: true,
        draw: function (ctx, x, feetY, dir, frame, alpha) {
          var key = def.frames[frame % def.frames.length];
          var ent = AA.kenney.index[key];
          if (!ent || !AA.kenney.ready) return false;
          var dw = ent.w * s, dh = ent.h * s;
          var dx = Math.round(x - dw / 2), dy = Math.round(feetY - dh);
          ctx.save();
          if (alpha != null) ctx.globalAlpha *= alpha;
          if (dir < 0) {
            ctx.translate(dx + dw, dy);
            ctx.scale(-1, 1);
            ctx.drawImage(AA.kenney.img, ent.x, ent.y, ent.w, ent.h, 0, 0, dw, dh);
          } else {
            ctx.drawImage(AA.kenney.img, ent.x, ent.y, ent.w, ent.h, dx, dy, dw, dh);
          }
          ctx.restore();
          return true;
        },
      };
    });

    // --- procedural fallback tables (same shape the renderer expects)
    AA.SPR.player = {
      idle: [frames(PLAYER_BODY, [LEGS_A]), frames(bodyR, [mirror(LEGS_A)])],
      walk: [
        [frames(PLAYER_BODY, [LEGS_A])[0], frames(PLAYER_BODY, [LEGS_B])[0],
         frames(PLAYER_BODY, [LEGS_A])[0], frames(PLAYER_BODY, [LEGS_JUMP])[0]],
        [frames(bodyR, [legsR[0]])[0], frames(bodyR, [legsR[1]])[0],
         frames(bodyR, [legsR[0]])[0], frames(bodyR, [legsR[2]])[0]],
      ],
      jump: [frames(PLAYER_BODY, [LEGS_JUMP])[0], frames(bodyR, [mirror(LEGS_JUMP)])[0]],
      hurt: [frames(PLAYER_BODY, [LEGS_B])[0], frames(bodyR, [mirror(LEGS_B)])[0]],
    };
    AA.SPR.robo = [build(pxRows(ROBO), P), build(pxRows(ROBO_B), P)];
    AA.SPR.drone = [build(pxRows(DRONE), P), build(pxRows(DRONE_B), P)];
    AA.SPR.tank = [build(pxRows(TANK), P)];
  };

  AA.ACTOR_PAL = P;
})();
