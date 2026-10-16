# Depths of the Witch

A small turn-based roguelike in the spirit of NetHack, drawn entirely with the sprite sheets
and tilesets of the sibling asset library [`../elthenassets`](../elthenassets/README.md).

**Goal:** climb down 8 levels, kill the *Witch of the Pit* in her sand arena, take her
**Golden Chalice**, and leave through the green portal she leaves behind (or climb all the way
back up to depth 1).

## Running

Open `index.html` in a browser (double-click it; no server or build step is needed). It has
been tested in Firefox. Everything is plain HTML, CSS and JavaScript.

## Playing

| key | action |
|---|---|
| arrows, `hjkl yubn`, numpad | move / attack (diagonals allowed) |
| Shift + direction (or `HJKL…`) | run |
| mouse click | travel there (as Adventurer: click a visible foe to shoot it) |
| `.` / `5` | wait a turn |
| `s` | search for hidden traps nearby |
| `g` / `,` | pick up |
| `>` / `<` | climb down / up a ladder |
| `x` | travel to the known ladder down |
| `f` | class special |
| `i` use item, `q` quaff, `r` read, `e` eat, `t` throw bomb, `d` drop | |
| `?` | help |

The game has these NetHack-like rules:

- **Turns and speed.** Everything uses an energy system (player speed 12). Bats are faster
  than you and ratfolk are slower. A haste potion makes you faster.
- **Field of view.** Lit rooms are fully visible when you are in them. In dark rooms and
  corridors you only see about 2 squares. Explored areas stay on the map, dimmed.
- **Identification.** The 4 potion colours and 2 scroll types get random effects each game.
  Potions can be healing, sickness, speed or clairvoyance. Scrolls can be teleportation or
  hex blast. You learn what an item does by using it.
- **Hunger.** You must eat (meat), or you will grow weak and then starve.
- **Traps.** Spike traps and trap doors are hidden until you find them with `s` or step on
  them. A trap door drops you a level. Purple portals are visible and teleport you.
- **Chests.** Walk into a chest to open it. A locked chest (shown with a padlock) needs a
  golden key, or you can bash it, which makes noise.
- **Monsters** may be asleep (shown with a *z*), and they wake up when they see you or hear
  noise. Pigs are peaceful unless you attack them. A wandering monster sometimes appears.
- **Experience levels** give more HP, accuracy and damage. When you die you see a score
  screen, and the best runs are kept in `localStorage`.

### Classes (from the two character sheets)

| class | sheet | special (`f`) |
|---|---|---|
| Adventurer | `elthen.adventurer` | bow shot at the nearest visible foe (its `attack_bow` animation) |
| Dwarf | `elthen.dwarf` | whirlwind spin hitting every adjacent foe, 10-turn cooldown (its `attack_spin` animation); starts with 2 bombs |

### Monsters (each one comes from a catalog sprite, and its powers come from that sprite)

| monster | sheet | depth | behaviour (from the art / catalog tags) |
|---|---|---|---|
| cave bat | `elthen.bat` | 1-5 | `flying`, fast and erratic, comes in small groups; red-eyed `fly_aggro` animation when awake |
| giant frog | `elthen.frog` | 1-4 | hops around erratically |
| wild pig | `elthen.pig` | 1-6 | `passive`, so peaceful until attacked; drops meat |
| ratfolk axeman | `elthen.ratfolk_axe` | 2-7 | sturdy melee fighter in pairs; drops gold |
| akaname | `elthen.akaname` | 3-8 | its long tongue (attack animation) reaches 2 squares |
| gloomtopus | `elthen.octopus` | 3-8 | floats over chasms; squirts ink that blinds you |
| fire imp | `elthen.imp` | 4-8 | `fire`, `ranged`: keeps its distance and throws its fireball |
| renegade | whichever hero you *didn't* pick | 5-8 | a strong humanoid that drops loot |
| Witch of the Pit | `elthen.witch` (`boss`) | 8 | casts hexes, summons bats, blinks away when hurt |

### How the dungeon is built from the assets

Levels are made of NetHack-style rooms and corridors, plus chasms and pillars. They are
drawn in the tilesets' 3/4 view by an autotiler (`js/mapgen.js` `autotile`). The autotiler
picks each wall piece from the tileset's labelled **stamps** in the catalog:

- `wall_frame` (or `enclosure` in the arena) provides caps, brick faces, side strips and bottom ledges.
- `wall_corner_nw` / `ne` provide the face and cap pieces that end where they meet floor.
- `wall_step_left` / `right` provide the inside corners.
- `wall_run*` give random variety in straight runs. The rare named faces (`wall_crack_rubble`, `wall_alcove`, `wall_slot`) appear occasionally.
- `tower_block` is used for free-standing pillars.

Other parts also come from catalog data:

- **Floors** use the terrain fill tiles (`stone`, `dirt`, `sand`). Some rooms use the `floor_slab` stamp.
- **Chasms** use the `pit` terrain. The tiles with a stone lip go on the top edge.
- **The depth-8 arena** uses the whole `elthen.arena` tileset, including the `pool` stamp for water.
- **Props** (ladders, gravestones, benches, chests with padlocks, candles, bones, rubble, chains, vines, spikes, cracked floor for found trap doors) are catalog tiles, stamps and regions, looked up by name or tag.
- **Wall decoration** uses `elthen.torch` and `elthen.banner`. Wall shadows come from `elthen.shadows`.
- **Items** are regions and animations in `elthen.dungeon_collectables`.
- **Effects** come from `elthen.hex`, `elthen.green_portal`, `elthen.purple_portal` and the bomb explosion.
- **All characters** are animated with the catalog's animation frames, timings, anchors and facing. Attack, hurt and death animations play when the matching game event happens.

## Files

```
index.html, style.css        page and layout
js/asset_data.js             GENERATED: the part of elthenassets/catalog.json the game uses
assets/elthen/*.png          COPIED: sprite sheets from elthenassets/assets
js/rng.js                    seeded RNG and dice
js/assets.js                 catalog access and tileset "themes" built from stamps, tiles and terrains
js/data.js                   classes, monsters, items (all point at catalog ids)
js/mapgen.js                 level generator and 3/4-view wall autotiler
js/game.js                   rules: turns, FOV, combat, AI, items, traps (no DOM; runs in node)
js/render.js                 canvas renderer: tiles, sprites, animations, effects
js/main.js                   input, HUD, inventory, minimap, title and game-over screens
tools/import_assets.py       refreshes asset_data.js and the PNG copies from ../elthenassets
tools/simulate.js            headless test: map invariants plus a bot playing many games
tools/browser_check.js       dev tool: drives headless Firefox, saves screenshots and console errors
```

### Refreshing assets

```bash
python3 tools/import_assets.py      # needs Pillow; reads ../elthenassets/assets/catalog.json
node tools/simulate.js 40           # 300 generated levels + 40 bot games, exits non-zero on failure
```

The importer only reads `../elthenassets`, and that repository is never modified. Two sheets are
still `draft` in the asset catalog: `elthen.ratfolk_axe` and `elthen.akaname`. Their animation
rows are named `row0…`, so the importer gives them game-side labels
(idle/run/attack/hurt/die). I chose those labels by looking at the frames. The importer also
works around a catalog quirk: some brick tiles in the `pit_room` stamp are tagged as stone floor.
It drops "fill" tiles that don't look like their terrain's sample tile.

### Debug URL parameters

`index.html?autostart=1&class=dwarf&seed=42&depth=8&reveal=1&zoom=1` starts a game immediately,
jumps to a depth, reveals the map and sets the zoom.
