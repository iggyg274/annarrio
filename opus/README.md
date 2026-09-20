# Super Annario

A one-level 2D platformer set in Ann Arbor, Michigan. It runs in any modern browser: open `index.html` (locally, or from any static web host). There's no build step and nothing external to load.

## Controls

| Action | Keys |
|---|---|
| Move | Arrow keys / A D |
| Jump (hold for higher) | Space / Z / ↑ / W |
| Run | Shift / X |
| Spin The Cube | ↑ while standing next to it |
| Pause | P / Esc |
| Mute | M |
| Credits (title screen) | C |

Touch devices get on-screen buttons.

## The level: "A Day in Tree Town"

Main Street → State Street (Regents Plaza & The Cube) → The Diag (Hatcher Library, Burton Tower, the brass M) → South University road work → Huron River (ride the Argo canoe) → Michigan Stadium.

All Ann Arbor flavor comes from level design and text signage drawn over generic sprites. It is affectionate parody with no affiliation to the University of Michigan or any business.

## Audio

All music and sound effects are generated at runtime with the Web Audio API. The music comes from a step sequencer, and each area has its own key, tempo, groove and chord progression. The lead melody is re-composed every 16 bars, so each playthrough sounds a little different.

## Files

- `index.html`: page shell, touch controls, credits line
- `js/assets.js`: image loading and urban-tileset sprite rects (from `manifest/urban_tileset_manifest.json`)
- `js/audio.js`: procedural music and sound effects
- `js/render.js`: drawing helpers (tiles, sprites, signboards, buildings)
- `js/level.js`: level layout, decorations and landmarks
- `js/game.js`: engine (input, physics, enemies, camera, HUD, screens)

## Credits

- **Urban City Tileset** © [Dlou Saiyan](https://www.dlousaiyan.com/). Used under its license; not redistributable as an asset pack.
- **Pixel Platformer** by [Kenney](https://www.kenney.nl/), CC0.
