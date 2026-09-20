'use strict';
// ---------------------------------------------------------------------------
// Asset loading. Kenney "Pixel Platformer" tiles are loaded as individual
// per-tile files; the Dlou Saiyan urban tileset is one sheet cropped with the
// exact rects from manifest/urban_tileset_manifest.json (copied below so the
// game also works from file:// where fetch() of JSON is blocked).
// ---------------------------------------------------------------------------

const TILE = 18;

// id: [x, y, w, h]  — from manifest/urban_tileset_manifest.json
const URBAN = {
  0: [9, 12, 208, 182],     // large tree
  2: [258, 1, 29, 39],      // round bush
  3: [293, 10, 18, 29],     // potted plant, blue pot
  6: [390, 24, 16, 12],     // grass tuft
  7: [421, 24, 17, 12],     // grass tuft wide
  9: [478, 24, 36, 42],     // dark double window/door
  10: [542, 0, 132, 66],    // glass entrance door strip
  12: [894, 0, 100, 276],   // tall skyscraper strip
  13: [257, 82, 30, 55],    // topiary in pot
  14: [293, 74, 18, 29],    // potted plant, red pot
  17: [399, 87, 66, 13],    // long low hedge strip
  18: [488, 94, 112, 68],   // large window, orange trim
  19: [616, 94, 112, 68],   // large window variant
  23: [351, 145, 34, 20],   // wide low hedge mound
  24: [256, 178, 31, 55],   // topiary, red pot
  25: [318, 190, 164, 36],  // storefront window strip
  26: [510, 190, 68, 68],   // square glare window
  27: [606, 190, 100, 68],  // wide glare window
  29: [9, 236, 208, 182],   // large tree variant
  33: [894, 286, 100, 14],  // thin railing/beam
  34: [254, 302, 100, 22],  // railing segment
  39: [382, 350, 228, 42],  // long red-orange block (container)
  40: [638, 350, 68, 42],   // short red-orange block (awning)
  41: [734, 350, 100, 42],  // garage door block
  44: [926, 368, 68, 54],   // ladder / scaffold
  45: [286, 414, 36, 36],   // electrical box
  46: [351, 414, 163, 39],  // rooftop vent fans
  49: [670, 414, 100, 100], // blue-gray shingle/brick texture
  50: [817, 414, 62, 189],  // rooftop chiller stack
  55: [223, 478, 131, 172], // tall teal building side
  56: [382, 510, 100, 36],  // blue wall trim strip
  57: [528, 531, 64, 126],  // utility/water-tank stack
  59: [670, 542, 100, 100], // blue shingle texture variant
  60: [382, 574, 100, 36],  // purple-blue trim bar
  61: [798, 606, 68, 36],   // dark blue trim bar
  62: [995, 625, 25, 289],  // street lamp
  63: [382, 670, 68, 142],  // building side panel A
  64: [478, 670, 68, 142],  // building side panel B
  65: [734, 670, 260, 100], // storefront facade
  66: [576, 698, 32, 45],   // red mailbox
  67: [610, 704, 28, 38],   // trash can
  68: [643, 716, 58, 25],   // park bench
  69: [574, 766, 68, 46],   // rooftop AC box
  70: [702, 798, 132, 132], // "DLOU SAIYAN" billboard — CREDITS SCREEN ONLY
  72: [190, 809, 164, 121], // water tower tank
  75: [513, 830, 94, 100],  // utility pole
};

// Kenney world tiles actually used by the game.
const TILE_IDS = [
  0, 1, 2, 3, 6, 9, 10, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 32, 33,
  36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 52, 53, 56, 57,
  58, 59, 60, 61, 62, 63, 67, 68, 73, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85,
  100, 101, 102, 103, 111, 112, 120, 121, 122, 123, 151, 152, 153, 154, 155,
  160, 161, 162, 163, 164, 165, 166, 167, 168, 169,
];
const CHAR_IDS = [6, 7, 11, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23];

const Assets = {
  tiles: {},
  chars: {},
  urban: null,
  loaded: 0,
  total: 0,

  load(onProgress) {
    const pad = (n) => String(n).padStart(4, '0');
    const jobs = [];
    const add = (src, store, key) => {
      jobs.push(new Promise((resolve) => {
        const img = new Image();
        img.onload = () => { store[key] = img; this.loaded++; onProgress && onProgress(this.loaded / this.total); resolve(); };
        img.onerror = () => { console.warn('Missing asset', src); this.loaded++; resolve(); };
        img.src = src;
      }));
    };
    for (const i of TILE_IDS) add(`sprites/Tiles/tile_${pad(i)}.png`, this.tiles, i);
    for (const i of CHAR_IDS) add(`sprites/Tiles/Characters/tile_${pad(i)}.png`, this.chars, i);
    add('urbantileset/urbantileset32x32.png', this, 'urban');
    this.total = jobs.length;
    return Promise.all(jobs);
  },
};
