# Super Ann Arbor

A single-level 2D browser platformer set in a low-fi, parody-signage version of Ann Arbor, Michigan.
Open `index.html` in a browser (or serve this folder over http) and press Enter.

**Route:** Ann Arbor Depot → State Street → The Diag (keep off the M) → Burton Tower / Ingalls Mall →
Huron River / Argo Cascades → Nichols Arboretum → Michigan Stadium ("The Big House").

**Controls:** arrows / WASD to move, Space / Up / W to jump (hold for a higher jump), M to mute, R to restart.
Stomp enemies, bump the `!` chests from below, collect coins and blue gems, hit the checkpoints, reach the flag.

## Files

- `index.html` — page + touch controls
- `game.js` — engine (physics, rendering, HUD, screens)
- `level.js` — the level, built from small helper functions
- `audio.js` — procedural chiptune music + sound effects using the Web Audio API (no audio files)

The music is a seeded step-sequencer: each run picks a key and generates 4-bar phrases (A A B A form)
over chord progressions that change per section of the level. Sound effects are oscillator/noise blips.

## Credits

- **Pixel Platformer** kit by [Kenney](https://www.kenney.nl) — CC0.
- **Urban City Tileset** © **Dlou Saiyan** — used with credit as required by its license; may not be
  resold, redistributed, or repackaged.
- No Ann Arbor-specific artwork exists in either pack; all landmarks are generic sprites plus painted
  text signs, on purpose.
