# Asset Manifest

This file exists so a **text-only local LLM can pick the right sprites without ever looking at
an image**. Every sprite sheet in this repo has been pre-analyzed and either sliced into
individual files or indexed with exact pixel coordinates. Use the tables/paths below instead of
trying to "read" the PNGs yourself.

Human-readable labeled contact sheets (for a person, or a vision model, to sanity-check this
manifest) are in `manifest/*.png`. Ignore those if you are a text-only model — you don't need
them; everything you need is written out below.

---

## 1. Kenney "Pixel Platformer" kit (`sprites/`) — CC0, no restrictions

This is a complete, generic platformer kit and should supply **all physics/gameplay tiles**:
ground, platforms, hazards-ish items, collectibles, water, and the player/enemy characters.
It is already cut into individual files, one per tile, so **reference files by name — do not
crop the sheet yourself**:

- `sprites/Tiles/tile_0000.png` … `tile_0179.png` — 180 world tiles, 18×18px each
- `sprites/Tiles/Characters/tile_0000.png` … `tile_0026.png` — 27 characters/enemies, 24×24px each
- `sprites/Tiles/Backgrounds/tile_0000.png` … `tile_0023.png` — 24 background fills, 24×24px each

Working example level layouts already exist at `sprites/Tiled/tilemap-example-a.tmx` and
`-b.tmx` (plain CSV grids of tile IDs) — read these to understand a working tile-index layout
convention before inventing your own.

### 1a. World tiles (`sprites/Tiles/tile_NNNN.png`)

| Indices | Content | Suggested use |
|---|---|---|
| 0–3, 20–23 | Grass-top dirt block (2 tone rows × 4 edge variants) | **Primary ground/platform tile.** Use 0–3 and 20–23 for the top surface row of terrain. |
| 40–43, 60–63, 80–83 | Plain dirt fill, **bordered** (dark frame outline, discrete block) | Fill tiles underneath the grass-top row so the ground reads as solid earth. |
| 100–103 | Tan/brown dirt fill, plain (verified by pixel sampling) | More plain-dirt fill variants — **not water**, despite an earlier version of this doc saying so. |
| 4, 5, 24, 25, 29, 104 | Tan/sandy dirt variants | Alternate ground texture / path tile. |
| 6 | Brick-pattern block | Breakable-looking wall block / building brick. |
| 12–15 | Red spotted block (4 tones) | Decorative brick or a "danger" colored block. |
| 33–35, 53, 73–75 | Light-blue water-surface/wave-top block | Water hazard or decorative pool, alt shades. |
| 16–19, 36–39, 56–59, 76–79 | Green leafy hedge/bush cube (4 tone rows) | Repeatable hedge block — good campus-quad greenery. |
| 120–123, 140–143 | Orange/tan sand texture, **borderless** (seamless fill, no frame outline) | Alternate ground biome fill (e.g. a construction/dirt-lot section) — similar color to 40–43/60–63/80–83 but a different, unframed texture; don't treat them as the same tile. |
| 7, 8 | Small brown gem/pebble | Minor collectible or decoration. |
| 9 | Gold closed chest | Reward chest (closed). |
| 10 | Gold chest, "!" icon | **Mystery/bonus block** — closest thing in this kit to a Mario "?" block. |
| 11 | Gold chest, ring icon | Reward chest variant. |
| 27 | Gold key | Key collectible (pairs with tile 28, locked chest). |
| 28 | Brown chest with keyhole | Locked chest (needs the key). |
| 30, 31 | Brown chest, icon variants | More reward-chest variants. |
| 44 / 45 / 46 | Full / half / empty heart | **HUD health icons.** |
| 47, 48 | Envelope/parcel | Cute collectible — "deliver the package" flavor, or just a bonus item. |
| 49, 50, 89–92, 104–110 | Wood beam/plank/post pieces | Bridges, docks, wooden platforms. |
| 32, 51, 52, 72, 73, 89, 109, 131 | Vertical wood/metal posts | Vertical platform supports, sign posts, lamp posts. |
| 64–66, 69, 70 | Gray hook/tool shapes | Décor only — mechanical/tool motif, not required. |
| 67 | Blue diamond gem | **Primary "coin"-equivalent collectible.** |
| 68 | Goggles icon | Novelty pickup (power-up flavor). |
| 84–88 | Wooden directional signposts (arrows L/R) | Level signage — could double as "This way to the Diag →" signs. |
| 93, 113 | Big blue ring/donut shape | Manhole cover / drain / small pool — street-level decoration. |
| 94, 95, 114, 115, 132–135 | Blue pipe/tank segments | Mario-pipe-style vertical pipe, or a water tower/tank prop. |
| 96–99, 116–119, 136–139 | Small tree/bush/branch/stump bits | Scatter as ground clutter. |
| 105–108, 146, 147 | Small stool/bench/table shapes | Street furniture filler. |
| 111, 112 | Checkered flag (orange/red) | **Level-goal flagpole/flag topper.** |
| 124–127 | Cactus/small conifer sprouts | Off-theme (desert) — skip for Ann Arbor, or reuse as generic shrubbery. |
| 128, 129 | Small hooded/mushroom-head bust | Could be reskinned as a tiny NPC head, otherwise skip. |
| 130, 150 | Tall cabinet/door | Building doorway / building entrance prop. |
| 144, 145 | Snow mound / snowman | Great for an "Ann Arbor winter" easter egg or seasonal variant. |
| 151 | Gold coin | Standard coin collectible (alternative to the gem at 67). |
| 152 | Orange gem shard | Secondary collectible / rare pickup. |
| 153–155 | White clouds | Sky decoration. |
| 156 | Small gray pebble | Ground clutter. |
| 157–159 | UI glyphs: `.` `X` `%` | HUD/menu glyphs only. |
| 160–179 | Digits 0–9 (×2 palettes) | **HUD score/timer digits.** |

### 1b. Characters (`sprites/Tiles/Characters/tile_NNNN.png`)

| Index | Description |
|---|---|
| 0, 1 | Green round character, blue hood/visor (2 frames) |
| 2, 3 | **Blue** round character, blue hood (2 frames) |
| 4, 5 | Pink round character, pink hood (2 frames) |
| 6, 7 | **Yellow/orange** round character, orange knit cap (2 frames) |
| 8 | Gray robot head, single round eye |
| 9, 10 | Plain tan-skinned character, brown hair, no hood (2 frames) |
| 11, 12 | Framed square portrait icons (yellow/brown face) — UI/avatar use, not a world sprite |
| 13, 14 | Small squat angry creature, yellow/orange — ground enemy |
| 15–17 | Dark drone/rocket-shaped flying enemy (3 color variants) |
| 18–20 | Small boxy robot/rover, dark — ground enemy (3 variants) |
| 21–23 | Larger tracked rover/tank enemy (3 variants) |
| 24 | Bat-like flying enemy, dark wings |
| 25 | Owl-like flying enemy, orange wings |
| 26 | Small round ball-bot enemy |

**Player character options:**
1. **Recommended:** `tile_0006.png`/`tile_0007.png` (yellow/orange hood) as the walk-cycle pair —
   yellow reads as **maize**, and pairing it with the blue enemies/props elsewhere gives you a
   free maize-and-blue Michigan color joke without any new art.
2. `tile_0002.png`/`tile_0003.png` (blue hood) if you'd rather the *player* be blue and treat
   yellow as an accent/enemy color instead.
3. `tile_0009.png`/`tile_0010.png` (plain tan character, no hood) if you want a more
   "generic student" look — easiest to justify as an Ann Arbor pedestrian rather than a
   sci-fi astronaut.

**Enemy options:** the drones (15–17) or bat (24) work well as simple side-to-side or
flying patrol enemies; the rovers (18–23) work as ground-patrol "stomp" enemies in the
Goomba role.

### 1c. Backgrounds (`sprites/Tiles/Backgrounds/tile_NNNN.png`)

| Index | Description | Use |
|---|---|---|
| 0–3 | Flat pale sky, 4 tones | Base sky fill |
| 4–5 | Flat warm orange/tan sky | Sunset sky option |
| 6–7 | Flat mint-green fill | Ground-color fill |
| 8–11 | Pale sky + cloud/distant-tree silhouettes | Parallax far layer |
| 12–13 | Orange sky + hill/tree silhouette | Parallax far layer (sunset variant) |
| 14–15 | Green sky-fill + tree-line silhouette | Parallax far layer (forest edge — good behind the urban skyline for Ann Arbor's tree canopy) |
| 16–19 | Flat blue-gray fill, 4 tones | Overcast sky or water fill |
| 20–21 | Flat terracotta fill | Ground/canyon color |
| 22–23 | Flat teal-green fill | Deep grass/shadow fill |

---

## 2. Urban City Tileset (`urbantileset/urbantileset32x32.png`) — restricted license, credit required

**License:** © Dlou Saiyan. You may use/modify it in this project. You may **not** resell,
redistribute, or repackage it. **You must credit "Dlou Saiyan"** somewhere reachable from the
game (an in-page credits line or README is enough).

Unlike the Kenney kit, this is **one 1024×1024 sheet with no per-tile files and no uniform
grid** — it's a scenic *building kit*: trees, building facades, windows, rooftop props, and
street furniture as irregular multi-cell sprites, not one-object-per-cell tiles. Use it as a
**background/decoration layer only** — it has no ground/road texture, so all collidable
platform geometry should still come from the Kenney kit (§1a).

Every sprite has been auto-detected and given an exact pixel rectangle in
**`manifest/urban_tileset_manifest.json`** (77 entries: `id, x, y, w, h, label, category,
suggested_use, usable_as_decoration, notes`). To draw sprite `id=62` (street lamp) in a
`<canvas>`:

```js
// look up {x, y, w, h} for the id in urban_tileset_manifest.json
ctx.drawImage(urbanImg, x, y, w, h, destX, destY, w, h);
```

### Highlights (see the JSON for the full list of 77)

| id | Label | Good for |
|---|---|---|
| 0, 29 | Large trees, full canopy | Foreground/parallax trees along the level |
| 12 | Tall skyscraper facade w/ window bands | Mid/background skyline |
| 55 | Tall teal building side panel | Background skyline |
| 65 | Storefront strip (windows + door + awning) | **A named shop front** — pair with a text-drawn sign (see §3) |
| 62 | Street lamp post | Sidewalk street furniture |
| 66 | Red USPS-style mailbox | Street furniture / Americana flavor |
| 67 | Trash can | Street furniture |
| 68 | Park bench | Street furniture — good near a "Diag" bench moment |
| 72 | Cyan water tower tank | Rooftop skyline silhouette |
| 75 | Wooden utility pole (clean, standalone) | Background street prop |
| 3–5, 14–16, 21–22, 24 | Potted plants / topiary | Sidewalk greenery scattered along the level |

### Flagged — do not use as plain decoration

- **id 70** — a rooftop billboard sprite that has the literal text **"DLOU SAIYAN"** baked into
  its pixel art. Placing it in the level will look like a stray real billboard advertising the
  artist. **Don't use it as street decoration.** It's fine to reference once on an out-of-game
  credits/about screen — that conveniently also satisfies the license's attribution requirement.
- **ids 11, 47, 73, 74, 76** — flat solid-color rectangles (black/navy/maroon). These look like
  leftover palette swatches in the source file, not finished art. Skip them, or reuse only as a
  plain fill color if you need one.
- **ids 54, 71** — the auto-detector merged several touching sprites into one blob here
  (a tree+shadow+building for 54; three poles+wires+a second water tank for 71). They're
  usable as-is as one background chunk, but if you want the pieces separately you'll need to
  manually re-crop sub-rectangles — don't trust automatic per-object slicing on these two ids.
  For a clean single utility pole or water tank, use ids 75 and 72 instead, which are already
  isolated cleanly.

---

## 3. No dedicated Ann Arbor artwork exists in either kit

Neither asset pack contains anything specific to Ann Arbor (no Burton Tower, no Michigan
Stadium/"Big House", no Diag, no block-M, no Zingerman's, etc.). **All Ann Arbor identity in
this game has to come from level design and text, not from matching sprites:**

- Draw landmark **name labels directly on the canvas** (e.g. `fillText`) over generic buildings
  — a plain building facade + a floating/painted sign reading "MICHIGAN STADIUM" or "THE DIAG"
  is how this game gets its Ann Arbor flavor.
- Use the storefront sprite (urban id 65) + a text sign for a fictional-but-flavorful shop
  reference (e.g. something Zingerman's-adjacent) rather than trying to reproduce a real logo.
- A distinctive silhouette (e.g. a tall narrow building topped with a clock/dome shape built out
  of a couple of stacked generic building sprites) plus a text label reading "BURTON TOWER" is a
  reasonable stand-in for a real landmark sprite.
- Keep any real place names as clearly stylized/parody-level references, not trademarked logos
  or exact building reproductions.

This is a deliberate constraint, not a gap to "fix" by generating new art — call it out in the
level as charming low-fi signage rather than trying to pixel-perfect real buildings.
