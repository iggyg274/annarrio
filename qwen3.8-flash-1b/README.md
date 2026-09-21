# DIAG DASH — An Ann Arbor Sprint (World 1-1)

A single playable level of a 2D browser platformer, built in this directory only.
Open `index.html` and play — nothing is fetched from the network.

## Run it

```
open index.html            # or double-click it, or serve the folder statically
```

No build step, no modules, no dependencies: plain classic `<script>` files so it works
straight off the filesystem (`file://`) as well as over HTTP.

## Controls

| Action | Keys |
|---|---|
| Move | ← → or A D |
| Hurry (run faster) | hold Shift or Z |
| Jump (hold longer = higher) | Space / ↑ / X |
| Pause | P |
| Mute | M |
| Restart | R |

Touch buttons appear on touch devices.

## The level

One long eastward sprint through a pixel-art Ann Arbor: Kerry Square → the Diag →
Michigan Avenue → Burton Memorial Tower → the Big House → the Arts Flyers and the Block M →
flagpole at Elsey Street. Coins, hearts, cherries, espresso (FURY: faster legs, brick
smashing, a double jump), stomppable campus rovers, squirrels and delivery drones, four
street-canyon gaps, and six checkpoints.

## Assets — read this if you are a text-only model

* **City scenery**: `urbantileset/urbantileset32x32.png`, addressed by exact pixel rects in
  `urban_sprites.js` (generated from `manifest/urban_tileset_manifest.json`). The flat
  colour-swatch ids ASSETS.md flags (`11, 47, 73, 74, 76`) are not used anywhere; id `70`
  (the artist's rooftop billboard) appears **only** on the title/credits screen.
* **Gameplay art**: `art.js` draws every collidable tile, character, pickup and HUD icon at
  runtime into offscreen canvases. The Kenney kit that ASSETS.md §1 promises
  (`sprites/Tiles/**`) is **not present in this workspace**, so those sprites could not be
  referenced by file name as the manifest instructs; they are generated procedurally instead,
  in a maize-and-blue palette. Nothing outside this directory is read.
* **Ann Arbor references**: no Ann Arbor-specific artwork exists in either pack, so every
  landmark is generic building/sign art plus an on-canvas text label (`fillText`), per
  ASSETS.md §3 — deliberate low-fi signage/parody, not real logos or reproductions.

### Credit (required by the tileset license)

City art © **Dlou Saiyan** ([dlousaiyan.com](https://www.dlousaiyan.com/)) — used with
permission. The tileset may be used and modified in this project but must not be resold,
redistributed, or repackaged. The credit appears on the in-game title screen and in the page
footer of `index.html`.

## Audio

`audio.js` makes everything procedurally with the plain Web Audio API: a seeded
step-sequenced chiptune (bass, arpeggio, hats, plus a random-walk pentatonic lead over an
Am–F–C–G progression, so the melody varies per playthrough) and oscillator/noise-envelope
sound effects for jump, coin, stomp, bump, brick, power-up, hurt, death, flag and win. No
MIDI, no audio files, no libraries.

## Dev tools (not needed to play)

```
node validate.js     # checks level geometry: pickups not buried, blocks not entombed, gaps jumpable
node smoke.js        # headless run: stubs DOM/Canvas/WebAudio, drives a bot to the flag, PASS/FAIL
node smoke.js trace  # same, with per-frame logging around the hazard zones
```

`smoke.js` currently finishes the level in ~17 s of game time with 24/76 coins — i.e. the
level is provably traversable end to end.
