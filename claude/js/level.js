// Level definition: a single hand-authored playable level, "A Tour of Ann Arbor".
// The tile grid only encodes gameplay/collision semantics (see TILE_DEFS below).
// All Ann Arbor flavor comes from decorations + on-canvas text signs layered on top,
// per ASSETS.md (neither asset pack contains real Ann Arbor landmark art).

const TILE = 32;
const COLS = 100;
const ROWS = 18;

// Tile character -> gameplay definition. `file` points at a Kenney single-tile PNG
// (sprites/Tiles/tile_NNNN.png, see ASSETS.md table 1a). `variants` lists a few
// interchangeable indices used for cheap visual variety; render code picks one
// deterministically from the column so it doesn't flicker between frames.
const TILE_DEFS = {
  'G': { variants: [0, 1, 2, 3], solid: true },              // grass-top ground
  'D': { variants: [40, 41, 42, 43], solid: true },          // dirt fill under grass
  'B': { variants: [6], solid: true },                        // brick platform block
  'P': { variants: [49, 50], solid: true },                   // wooden plank platform
  'WT': { variants: [33, 34], solid: false, hazard: true },   // water surface, wave-top (Huron River)
  'W': { variants: [35], solid: false, hazard: true },        // water fill, below the surface
  'H': { variants: [16], solid: true },                        // hedge obstacle
  'M': { variants: [10], solid: true, mystery: true },         // "?"-style bonus chest
  'M_USED': { variants: [30], solid: true },                   // spent mystery block
};

function tileFile(id) {
  return `sprites/Tiles/tile_${String(id).padStart(4, '0')}.png`;
}

// Pixel rectangles cropped from urbantileset/urbantileset32x32.png, copied from
// manifest/urban_tileset_manifest.json (do not re-guess coordinates -- see ASSETS.md).
const URBAN_RECTS = {
  treeA: { x: 9, y: 12, w: 208, h: 182 },
  treeB: { x: 9, y: 236, w: 208, h: 182 },
  lamp: { x: 995, y: 625, w: 25, h: 289 },
  storefront: { x: 734, y: 670, w: 260, h: 100 },
  mailbox: { x: 576, y: 698, w: 32, h: 45 },
  trashcan: { x: 610, y: 704, w: 28, h: 38 },
  bench: { x: 643, y: 716, w: 58, h: 25 },
  watertower: { x: 190, y: 809, w: 164, h: 121 },
  pole: { x: 513, y: 830, w: 94, h: 100 },
  windowA: { x: 488, y: 94, w: 112, h: 68 },
  windowB: { x: 616, y: 94, w: 112, h: 68 },
  windowC: { x: 744, y: 88, w: 112, h: 74 },
  skyscraper: { x: 894, y: 0, w: 100, h: 276 },
  buildingSide: { x: 223, y: 478, w: 131, h: 172 },
  hedgeStrip: { x: 399, y: 87, w: 66, h: 13 },
  potBlue: { x: 293, y: 10, w: 18, h: 29 },
  potRed: { x: 293, y: 74, w: 18, h: 29 },
};

function buildLevel() {
  // grid[row][col]
  const grid = [];
  for (let r = 0; r < ROWS; r++) grid.push(new Array(COLS).fill('.'));

  const fillRow = (x1, x2, row, ch) => { for (let x = x1; x <= x2; x++) grid[row][x] = ch; };
  const setGround = (x1, x2) => { fillRow(x1, x2, 15, 'G'); fillRow(x1, x2, 16, 'D'); fillRow(x1, x2, 17, 'D'); };
  const setWater = (x1, x2) => { fillRow(x1, x2, 15, 'WT'); fillRow(x1, x2, 16, 'W'); fillRow(x1, x2, 17, 'W'); };
  const setTile = (x, row, ch) => { grid[row][x] = ch; };

  // ---- Section 1: Welcome to Ann Arbor (col 0-5) ----
  setGround(0, 5);

  // pit (col 6-7)

  // ---- Section 2: The Diag (col 8-19) ----
  setGround(8, 19);
  setTile(13, 14, 'H');
  setTile(17, 14, 'H');

  // pit (col 20-21)

  // ---- Section 3: climb to Burton Tower plateau (col 20-34) ----
  // Gentle staircase: each step is only 1 tile higher and 1-2 tiles away, so
  // a plain run-jump always clears it (no jump needs to be both max-height and
  // max-distance at once).
  fillRow(22, 23, 14, 'B');
  fillRow(25, 26, 13, 'B');
  for (let r = 12; r <= 17; r++) fillRow(28, 34, r, 'B');
  setTile(30, 10, 'M'); // one clear tile above the plateau's standing surface (row 11)

  // pit (col 35-36)

  // ---- Section 4: Huron River crossing (col 37-54) ----
  setWater(37, 54);
  fillRow(38, 39, 14, 'P');
  fillRow(42, 44, 14, 'P');
  fillRow(46, 47, 13, 'P');
  fillRow(49, 51, 14, 'P');
  fillRow(53, 54, 14, 'P');

  // ---- Section 5: State Street (col 55-69) ----
  setGround(55, 69);
  setTile(64, 13, 'B'); // little ledge for the secret envelope (only 2 tiles up -- easy hop)

  // pit (col 70-71)

  // ---- Section 6: Michigan Stadium approach (col 72-92) ----
  setGround(72, 77);
  // pit 78-79
  fillRow(80, 83, 13, 'B');
  // pit 84
  fillRow(85, 89, 11, 'B');
  setTile(87, 9, 'M'); // one clear tile above the platform's standing surface (row 10)
  // pit 90-92

  // ---- Section 7: Finish line (col 93-99) ----
  setGround(93, 99);

  return {
    grid, cols: COLS, rows: ROWS, tile: TILE,
    spawn: { col: 1, row: 15 },
    worldWidth: COLS * TILE,
    worldHeight: ROWS * TILE,

    // Non-solid background/foreground decoration (urban tileset + kenney backgrounds).
    // layer 'far' scrolls slower than the world (parallax); layer 'near' scrolls 1:1.
    decorations: [
      { layer: 'far', sprite: 'treeA', x: 60, y: 200, scale: 0.55 },
      { layer: 'far', sprite: 'treeB', x: 330, y: 210, scale: 0.5 },
      { layer: 'near', sprite: 'bench', x: 470, y: 448, scale: 1 },
      { layer: 'near', sprite: 'potBlue', x: 300, y: 452, scale: 1.1 },
      { layer: 'near', sprite: 'potRed', x: 560, y: 452, scale: 1.1 },
      { layer: 'far', sprite: 'treeA', x: 610, y: 205, scale: 0.5 },

      // Burton Tower backdrop (col ~28-34 => x 896-1088)
      { layer: 'far', sprite: 'skyscraper', x: 940, y: 40, scale: 0.9 },
      { layer: 'far', sprite: 'watertower', x: 1030, y: 150, scale: 0.55 },

      // State Street storefront row (col 55-69 => x 1760-2208)
      { layer: 'near', sprite: 'lamp', x: 1790, y: 300, scale: 0.85 },
      { layer: 'far', sprite: 'storefront', x: 1900, y: 340, scale: 1.05 },
      { layer: 'near', sprite: 'mailbox', x: 2130, y: 435, scale: 1 },
      { layer: 'near', sprite: 'trashcan', x: 2170, y: 440, scale: 1 },
      { layer: 'far', sprite: 'treeB', x: 2230, y: 220, scale: 0.45 },

      // Michigan Stadium approach (col 72-92 => x 2304-2944)
      { layer: 'far', sprite: 'windowA', x: 2500, y: 120, scale: 1.3 },
      { layer: 'far', sprite: 'windowB', x: 2650, y: 120, scale: 1.3 },
      { layer: 'far', sprite: 'windowC', x: 2800, y: 110, scale: 1.3 },
      { layer: 'far', sprite: 'buildingSide', x: 2450, y: 60, scale: 1.0 },

      // Finish plaza
      { layer: 'near', sprite: 'pole', x: 3060, y: 340, scale: 0.7 },
      { layer: 'far', sprite: 'treeA', x: 3150, y: 200, scale: 0.5 },
    ],

    // Text signage -- this is where the Ann Arbor identity actually comes from.
    signs: [
      { x: 40, y: 420, lines: ['WELCOME TO', 'ANN ARBOR'], color: '#ffcb05' },
      { x: 300, y: 420, lines: ['THE DIAG'], color: '#00274c' },
      { x: 940, y: 250, lines: ['BURTON TOWER'], color: '#ffcb05', tower: true },
      { x: 1180, y: 420, lines: ['HURON RIVER', '(no swimming!)'], color: '#eef0ff' },
      { x: 1780, y: 420, lines: ['STATE STREET'], color: '#ffcb05' },
      { x: 1930, y: 320, lines: ["ZINGERMAN'S", 'DELICATESSEN'], color: '#fff' },
      { x: 2450, y: 250, lines: ['MICHIGAN STADIUM'], color: '#ffcb05', tower: true },
      { x: 2600, y: 420, lines: ['"THE BIG HOUSE"'], color: '#00274c' },
      { x: 2980, y: 420, lines: ['FINISH LINE', 'GO BLUE!'], color: '#ffcb05' },
    ],

    // Collectibles: {type, col, row}. `col`/`row` give top-left grid cell for placement.
    items: [
      ...rowOfCoins(2, 4, 12),
      ...rowOfCoins(9, 11, 12),
      { type: 'coin', col: 15, row: 11 },
      { type: 'coin', col: 16, row: 11 },
      { type: 'gem', col: 30, row: 11 },
      ...rowOfCoins(38, 39, 13),
      ...rowOfCoins(42, 44, 13),
      { type: 'coin', col: 46, row: 12 },
      { type: 'coin', col: 47, row: 12 },
      ...rowOfCoins(49, 51, 13),
      ...rowOfCoins(58, 61, 12),
      { type: 'envelope', col: 64, row: 12 },
      { type: 'gem', col: 67, row: 12 },
      { type: 'heart', col: 73, row: 13 },
      { type: 'coin', col: 81, row: 12 },
      { type: 'coin', col: 82, row: 12 },
      { type: 'gem', col: 86, row: 10 },
      ...rowOfCoins(95, 98, 12),
    ],

    // Enemies: type 'ground' patrols along the floor, 'flying' patrols a horizontal
    // band in the air with a gentle vertical bob.
    enemies: [
      { type: 'ground', minCol: 16, maxCol: 19, row: 15, startCol: 16 },
      { type: 'ground', minCol: 61, maxCol: 66, row: 15, startCol: 61 },
      { type: 'flying', minCol: 58, maxCol: 68, row: 6, startCol: 58 },
      { type: 'ground', minCol: 73, maxCol: 76, row: 15, startCol: 73, tough: true },
      { type: 'flying', minCol: 85, maxCol: 89, row: 7, startCol: 85 },
    ],

    // Goal flag position (grid cell of the pole's base row).
    goal: { col: 97, row: 15 },
  };
}

function rowOfCoins(x1, x2, row) {
  const arr = [];
  for (let x = x1; x <= x2; x++) arr.push({ type: 'coin', col: x, row });
  return arr;
}
