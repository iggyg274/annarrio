# Ann Arbor: The Platformer — Level 1, "A2: One More Mile"

A single playable level of a 2D Mario-style platformer set in Ann Arbor, Michigan.
It runs in a browser straight from `index.html` — no build step, no server, no
libraries, no external audio files.

**To play: open `index.html` in a browser and press Space.**

```
Arrows / WASD   move
Space / W / Up  jump (hold longer to jump higher)
P or Escape     pause
M               mute
R               reset to the last checkpoint
```

Click the page once if the music has not started — browsers only allow audio to
begin after a user gesture.

---

## The level

One continuous 192-tile (6144 px) side-scrolling level, five zones, ending at a
checkered flag. Ann Arbor identity comes from **level design plus text labels
painted over generic building sprites** (per `ASSETS.md` §3 — neither asset pack
contains any actual Ann Arbor artwork):

| Zone | What is there |
|---|---|
| **Central Campus / The Diag** | Openers on the quad: hedges to hop, a bench, a "Zingerman's"-adjacent storefront sign, "THE DIAG" and "ANN ARBOR, MI" signage |
| **State Street** | Street lamps, mailboxes, trash cans, storefront facades, "STATE STREET" / "GO BLUE" signs, crate platforms |
| **Construction lot** | Brick stacks to climb, crates, "ROAD WORK AHEAD", sand-lot ground fill |
| **Huron River** | A water gap you jump (water is fatal on contact), dock planks, "HURON RIVER" sign, a water tower, a "NICKELS ARCADE" sign |
| **Burton Tower plaza** | Stacked generic building panels standing in for the tower, terraced platforms, "BURTON TOWER" label |
| **Stadium Blvd / The Big House** | "MICHIGAN STADIUM", "THE BIG HOUSE", a climbable grandstand staircase, the "GOAL" flag on the ground at the end of the run, and "WELCOME TO YPSILANTI" past the finish |

Details baked in:

* **Player** — Kenney's maize-hooded runner (`tile_0006/0007`), the option
  `ASSETS.md` recommends for the free maize-and-blue Michigan colour joke.
* **Enemies** — ground "campus rovers" (`robo`), "hedge crawlers" (`squat`),
  flying "survey drones" (`drone`) and "night fliers" (`bat`), plus one bigger
  tracked unit (`tank`) that takes two stomps.
* **Gems** — 37 blue gems; a grade of `A+  WOLVERINE PERFECT` needs all of them
  with no falls.
* **Hazards** — water is fatal on contact; pits and enemies cost one of three
  hearts and send you back to the last checkpoint (there are five).
* **Two Ann Arbor winter easter eggs** — a snowman in maize and blue.
* **Music** — a seeded generative chiptune sequencer that changes chord
  progression and feel per zone (campus → street → river → construction →
  stadium → victory), so the soundtrack moves as you run. Each playthrough gets a
  new seed (shown in the HUD) and therefore new melodic variation.

---

## Credits and licensing (please keep this)

* **Urban City Tileset — art © Dlou Saiyan.** Used with permission for this
  project. **Credit is required** and is given: on the title screen footer, on
  the in-game HUD footer, on the end screen, in the page footer of `index.html`,
  and here. The licence does **not** allow reselling, redistributing or
  repackaging the tileset into other asset packs, even modified.
  (<https://www.dlousaiyan.com/>)
* Sprite id `70` (a rooftop billboard with the artist's own name baked into the
  pixels) is deliberately **not placed in the level** — `tools/gen_atlas.py`
  excludes it, along with the flat solid-colour swatches (`11, 47, 73, 74, 76`)
  that `ASSETS.md` flags as unfinished art.

### Which asset pack does what

`sprites/` (Kenney "Pixel Platformer", CC0) and `urbantileset/` (© Dlou Saiyan)
are both used, exactly as `ASSETS.md` splits them:

| Layer | Source |
|---|---|
| Player, enemies | **Kenney** characters — `tile_0006/0007` (maize hooded runner, the option `ASSETS.md` recommends), rovers `0019/0020`, ground creatures `0013/0014`, flyers `0015/0016/0024`, tracked unit `0021/0022` |
| Ground, grass caps, dirt fill, brick, water, hedges, plank platforms | **Kenney** world tiles (`0001–0003`, `0004/0005`, `0020/0021`, `0006`, `0033–0035`, `0016–0019`, `0049–0052`, `0120–0123`) |
| Collectible gems, hearts, clouds, snowman, crate, signpost, flag | **Kenney** props |
| Buildings, storefronts, trees, street furniture, skyline | **Dlou Saiyan urban tileset**, drawn from `manifest/urban_tileset_manifest.json` rects |
| Landmark names ("MICHIGAN STADIUM", "THE DIAG", …) | Canvas `fillText` over those generic sprites, per `ASSETS.md` §3 |
| Music and all twelve sound effects | Generated at runtime with the Web Audio API |
| Sky gradient, parallax haze, terrain depth fill | Canvas gradients |

The Kenney kit ships as 231 loose PNGs. `tools/gen_kenney.py` packs the 80 the
game uses into one sheet (`build/kenney_atlas.png`) so there are not 231 image
requests, and it forces each world tile opaque over its own dirt tone — several
of the kit's tiles (e.g. the "bordered dirt fill" at index 40/41) contain
transparent pixels that would otherwise let the sky show through the ground.

If any of that art is missing the game still runs: `AA.kenney.ready` stays false,
every Kenney draw returns false, and the renderer falls back to the procedural
terrain and actors, which are still in the source for exactly that reason. The
generated atlas is committed, so the game works from a fresh checkout without
running any tooling.

---

## Files

```
index.html                 the whole game: built, self-contained, open this
index.template.html        page shell with /*__CSS__*/ and //__GAME_JS__ markers
src/                       editable sources, concatenated into index.html
  00_util.js               constants, math, tile accessors, the A2 colour palette
  10_sprites.js            actor sprite atlas (Kenney characters + procedural fallback)
  15_scales.js             on-screen draw scale per tileset sprite id
  20_atlas.js              urban tileset loading + procedural terrain/water/hedge art
  kenney_atlas_data.js     GENERATED sprite rects into build/kenney_atlas.png
  55_kenney.js             Kenney atlas access + tile/actor draw helpers
  30_level_data.js         GENERATED level: ASCII grid -> tiles, gems, enemies, props, signage
  atlas_data.js            GENERATED trimmed sprite rects from the urban PNG pixels
  40_audio.js              Web Audio chiptune sequencer + 12 sound effects
  50_engine.js             fixed-step simulation: player, enemies, collisions, particles, state
  60_render.js             parallax backdrop, terrain, props, actors, signage, HUD, screens
  70_selftest.js           in-page audit + auto-playing bot (runs with ?selftest)
  90_style.css             page chrome
build/preview/             inspected screenshots written by the preview tool
tools/                     build + verification tooling (not needed to play)
  gen_atlas.py             reads the real PNG, writes src/atlas_data.js (enforces the do-not-use list)
  gen_kenney.py            packs the Kenney kit subset into build/kenney_atlas.png
  gen_level.py             ASCII chunk art -> src/30_level_data.js, validates reachability
  build.py                 src/*.js + css -> index.html
  smoke_test.js            headless browser stub: plays the level, renders every screen
  render_shots.js          records canvas calls for the preview renderer
  render_preview.py        replays those calls in PIL -> build/preview/*.png
urbantileset/, manifest/  the provided assets (read-only inputs)
```

### Rebuilding

```bash
python3 tools/gen_atlas.py     # regenerate urban sprite rects from the PNG
python3 tools/gen_kenney.py    # repack the Kenney atlas from sprites/
python3 tools/gen_level.py     # regenerate the level from the ASCII art in that file
python3 tools/build.py         # rebuild index.html
```

`gen_level.py` is the level editor: the geometry is 12 rows × 8 chunks of
readable ASCII, and it enforces the design invariants mechanically — every gem
must sit in a reachable pocket, ground enemies must stand on terrain, the goal
and spawn must have ground under them, and no "do not use" sprite id may appear.

### Verifying

```bash
node tools/smoke_test.js           # boots the built game in a stubbed browser and plays it
python3 tools/render_preview.py --raw   # writes build/preview/*.png so you can look at it
```

`smoke_test.js` is the real safety net: it decodes the tileset, boots the game,
drives the real keyboard-event path (move/jump/pause/mute/restart), plays the
level end-to-end with a reflex bot (eight attempts, each restarting from the
furthest checkpoint with a fresh life pool), runs the same audit the page exposes
at `index.html?selftest`, renders every screen state, sweeps the camera across
the whole level, and exercises the audio scheduler and all twelve sound effects.
It fails the process on any thrown error or failed expectation.

### In-page self test

`index.html?selftest` runs the audit and an auto-playing bot in the browser and
prints the pass/fail table on the canvas and to the console. It checks the level
data invariants, the atlas contents, the Kenney integration, the stomp/damage/
water mechanics, and that the reflex bot can actually reach the flag.

---

## How it works, briefly

* **Canvas** 960×540, CSS-scaled with `image-rendering: pixelated`; all art is
  drawn at 32 px tile size with nearest-neighbour scaling.
* **Simulation** fixed 1/60 s steps with an accumulator, so physics are identical
  on any refresh rate. Tuned for a ~2.3-tile jump (a 2-tile riser is always
  climbable, which is what the grandstand staircase is built from).
* **Collision** the level's solid tiles are merged into maximal horizontal runs at
  generate time, so the world is six collision rects instead of thousands of
  tiles; the player is moved with swept axis resolution plus a small step-up.
  Stomp checks run *before* the vertical sweep, because otherwise landing on an
  enemy's head would zero the vertical velocity and register as a side hit.
* **Backdrop** five pre-rendered skylines (one per zone) parallaxed in two layers,
  each topped with a tree-canopy silhouette — Ann Arbor is a tree town.
* **Audio** a 16-step-per-bar sequencer scheduled ahead on the Web Audio clock,
  regenerating each bar from the current chord with a seeded RNG; square/
  triangle/saw leads, triangle bass, noise percussion, plus quick oscillator
  blips for jump/coin/stomp/hurt/checkpoint/win/game-over.
