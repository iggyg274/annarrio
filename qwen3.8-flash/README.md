# Maize & Blue — an Ann Arbor platformer

One playable 2D side-scroller: a stroll from **The Diag** to **Michigan Stadium**, with the
Huron River, Burton Tower's carillon, State Street delis, and The Mystery Cube in between.

## Run it

Open `index.html` in any modern browser — no build step, no server required (works over
`file://`, and is ready to be hosted as-is).

- **Move:** ← → or A / D
- **Run:** Shift
- **Jump:** Space / ↑ / W (hold for higher jumps)
- **Mute:** M · **Pause:** P / Esc · **Restart:** R
- Touch: tap left/right half to move, top half to jump.

Stomp the rovers and drones, collect coins, grab the little gold key in the river section to
open the prize chest near the stadium, and don't touch the Huron.

## Credits / licenses

- **Urban City Tileset** — © **Dlou Saiyan** (dlousaiyan.com). Used with credit as required by
  its license; may not be resold or redistributed. The artist's billboard sprite appears once
  on the win/credits screen, per the asset notes.
- **Kenney "Pixel Platformer" kit** — CC0 (kenney.nl).
- Music and sound effects are generated procedurally at runtime with the plain Web Audio API
  (the chiptune melody is reseeded every playthrough). No audio files, no libraries.

Ann Arbor landmarks appear as deliberately low-fi text signage over generic building sprites
(parody flavor) — neither asset pack contains real Ann Arbor artwork.

## Tests (optional, no browser needed)

```
npm test                 # level-data validation + headless gameplay sim + fake-AudioContext check
```

There is also an end-to-end check that drives the real game in headless Chromium
(screenshots to `test/shots/`, console-error and missing-asset detection):

```
python3 -m http.server 8765 --bind 127.0.0.1 &
PLAYWRIGHT_BROWSERS_PATH=/tmp/pw-browsers npm i -D playwright && npx playwright install chromium-headless-shell
node test/browser_check.js 8765
```

Playwright is a dev-only dependency — the game ships with zero dependencies.
