#!/usr/bin/env python3
"""Build build/kenney_atlas.png from the Kenney "Pixel Platformer" kit.

ASSETS.md §1 says the Kenney kit should supply all the physics/gameplay tiles
(ground, objects, hazards, the player and enemies) while the Dlou Saiyan urban
tileset stays the decoration layer. The kit ships as 231 individual PNGs, which
would be 231 requests; this packs the subset the game actually uses into one
sheet that src/55_kenney.js can draw from with a static index.

Two things are normalised while packing, both of which matter for tiling:

  * World tiles keep their native 18x18 pixels (the game repeats them, so
    scaling up would look chunky and uneven at grid boundaries).
  * Many Kenney tiles have transparent pixels inside the block (index 40/41, the
    "bordered dirt fill", is mostly transparent). Left alone, the sky would show
    through the ground in stripes. Each tile is therefore composited over the
    dirt tone it belongs to, then forced opaque.

Run:  python3 tools/gen_kenney.py
"""
import json, os
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SPR = os.path.join(ROOT, 'sprites')

# --- tile vocabulary (indices straight from ASSETS.md §1a/§1b) --------------
# key -> (source relative path, backdrop colour or None)
KENNEY = {
    # ground / platforms
    'grass1': ('Tiles/tile_0001.png', '#8a5a30'),
    'grass2': ('Tiles/tile_0002.png', '#8a5a30'),
    'grass3': ('Tiles/tile_0003.png', '#8a5a30'),
    'grass20': ('Tiles/tile_0020.png', '#8a5a30'),
    'grass21': ('Tiles/tile_0021.png', '#8a5a30'),
    'dirt40': ('Tiles/tile_0040.png', '#7a4a28'),
    'dirt41': ('Tiles/tile_0041.png', '#7a4a28'),
    'dirt60': ('Tiles/tile_0060.png', '#7a4a28'),
    'dirt100': ('Tiles/tile_0100.png', '#7a4a28'),
    'sand120': ('Tiles/tile_0120.png', '#c08a4a'),
    'sand121': ('Tiles/tile_0121.png', '#c08a4a'),
    # plain (unframed) dirt for the interior of the ground mass, so deep terrain
    # does not read as a grid of separate blocks
    'dirt4': ('Tiles/tile_0004.png', None),
    'dirt5': ('Tiles/tile_0005.png', None),
    'dirt24': ('Tiles/tile_0024.png', None),
    'dirt25': ('Tiles/tile_0025.png', None),
    'brick6': ('Tiles/tile_0006.png', None),
    'spotted12': ('Tiles/tile_0012.png', None),
    # water
    'water33': ('Tiles/tile_0033.png', '#2f7fb8'),
    'water34': ('Tiles/tile_0034.png', '#2f7fb8'),
    'water35': ('Tiles/tile_0035.png', '#2f7fb8'),
    # campus greenery
    'hedge16': ('Tiles/tile_0016.png', '#2f6a24'),
    'hedge17': ('Tiles/tile_0017.png', '#2f6a24'),
    'hedge18': ('Tiles/tile_0018.png', '#2f6a24'),
    'hedge19': ('Tiles/tile_0019.png', '#2f6a24'),
    'bush96': ('Tiles/tile_0096.png', None),
    'tree97': ('Tiles/tile_0097.png', None),
    'stump98': ('Tiles/tile_0098.png', None),
    'grassTuft': ('Tiles/tile_0126.png', None),
    # wood / docks
    'wood49': ('Tiles/tile_0049.png', '#7a4f26'),
    'wood50': ('Tiles/tile_0050.png', '#7a4f26'),
    'wood51': ('Tiles/tile_0051.png', '#7a4f26'),
    'wood52': ('Tiles/tile_0052.png', '#7a4f26'),
    'post89': ('Tiles/tile_0089.png', None),
    'sign84': ('Tiles/tile_0084.png', None),
    'sign85': ('Tiles/tile_0085.png', None),
    # collectibles / pickups
    'gem67': ('Tiles/tile_0067.png', None),
    'coin151': ('Tiles/tile_0151.png', None),
    'gem152': ('Tiles/tile_0152.png', None),
    'parcel47': ('Tiles/tile_0047.png', None),
    'goggles68': ('Tiles/tile_0068.png', None),
    # goal / blocks / HUD
    'flag111': ('Tiles/tile_0111.png', None),
    'flag112': ('Tiles/tile_0112.png', None),
    'mystery10': ('Tiles/tile_0010.png', None),
    'heart44': ('Tiles/tile_0044.png', None),
    'heart45': ('Tiles/tile_0045.png', None),
    'heart46': ('Tiles/tile_0046.png', None),
    'cloud153': ('Tiles/tile_0153.png', None),
    'cloud154': ('Tiles/tile_0154.png', None),
    'cloud155': ('Tiles/tile_0155.png', None),
    'pipe94': ('Tiles/tile_0094.png', None),
    'manhole93': ('Tiles/tile_0093.png', None),
    'snowman145': ('Tiles/tile_0145.png', None),
    'snow144': ('Tiles/tile_0144.png', None),
    'chest9': ('Tiles/tile_0009.png', None),
    # characters / enemies (24x24)
    'p_blue_a': ('Tiles/Characters/tile_0002.png', None),
    'p_blue_b': ('Tiles/Characters/tile_0003.png', None),
    'p_maize_a': ('Tiles/Characters/tile_0006.png', None),
    'p_maize_b': ('Tiles/Characters/tile_0007.png', None),
    'p_plain_a': ('Tiles/Characters/tile_0009.png', None),
    'p_plain_b': ('Tiles/Characters/tile_0010.png', None),
    'e_squat_a': ('Tiles/Characters/tile_0013.png', None),
    'e_squat_b': ('Tiles/Characters/tile_0014.png', None),
    'e_drone_a': ('Tiles/Characters/tile_0015.png', None),
    'e_drone_b': ('Tiles/Characters/tile_0016.png', None),
    'e_drone_c': ('Tiles/Characters/tile_0017.png', None),
    'e_rover_a': ('Tiles/Characters/tile_0018.png', None),
    'e_rover_b': ('Tiles/Characters/tile_0019.png', None),
    'e_rover_c': ('Tiles/Characters/tile_0020.png', None),
    'e_tank_a': ('Tiles/Characters/tile_0021.png', None),
    'e_tank_b': ('Tiles/Characters/tile_0022.png', None),
    'e_bat': ('Tiles/Characters/tile_0024.png', None),
    'e_owl': ('Tiles/Characters/tile_0025.png', None),
    # background fills / parallax
    'sky0': ('Tiles/Backgrounds/tile_0000.png', None),
    'sky16': ('Tiles/Backgrounds/tile_0016.png', None),
    'treeline14': ('Tiles/Backgrounds/tile_0014.png', None),
    'treeline15': ('Tiles/Backgrounds/tile_0015.png', None),
    'hills8': ('Tiles/Backgrounds/tile_0008.png', None),
    'hills9': ('Tiles/Backgrounds/tile_0009.png', None),
    'greenery16': ('Tiles/Backgrounds/tile_0016.png', None),
    'sunset4': ('Tiles/Backgrounds/tile_0004.png', None),
}

COLS = 16
PAD = 1


def main():
    keys = sorted(KENNEY.keys())
    # uniform cell: world tiles are 18px, characters 24px -> use 24 so nothing
    # needs to be resampled on the way into the sheet.
    CELL = 24
    rows = (len(keys) + COLS - 1) // COLS
    sheet = Image.new('RGBA', (COLS * CELL + PAD, rows * CELL + PAD), (0, 0, 0, 0))
    index = {}
    missing = []

    for k, key in enumerate(keys):
        rel, backdrop = KENNEY[key]
        path = os.path.join(SPR, rel)
        if not os.path.exists(path):
            missing.append(rel)
            continue
        im = Image.open(path).convert('RGBA')
        if backdrop:
            flat = Image.new('RGBA', im.size, backdrop + 'ff' if len(backdrop) == 6 else backdrop)
            # a soft grain so the forced-opaque fill is not a flat colour slab
            for y in range(im.size[1]):
                for x in range(im.size[0]):
                    if im.getpixel((x, y))[3] < 250:
                        r, g, b, a = im.getpixel((x, y))
                        jitter = ((x * 7 + y * 13) % 5) * 3
                        base = Image.new('RGBA', (1, 1), backdrop + 'ff' if len(backdrop) == 6 else backdrop)
                        br, bg, bb, _ = base.getpixel((0, 0))
                        cand = (max(0, br - jitter), max(0, bg - jitter), max(0, bb - jitter), 255)
                        flat.putpixel((x, y), cand)
            flat.alpha_composite(im)
            im = flat
        col = k % COLS
        row = k // COLS
        sheet.paste(im, (col * CELL + PAD, row * CELL + PAD), im)
        index[key] = {
            'x': col * CELL + PAD, 'y': row * CELL + PAD,
            'w': im.size[0], 'h': im.size[1], 'cell': CELL,
        }

    if missing:
        raise SystemExit('missing Kenney files: %s' % ', '.join(missing))

    out_png = os.path.join(ROOT, 'build', 'kenney_atlas.png')
    os.makedirs(os.path.dirname(out_png), exist_ok=True)
    sheet.save(out_png)

    out_js = os.path.join(ROOT, 'src', 'kenney_atlas_data.js')
    with open(out_js, 'w') as f:
        f.write('/* GENERATED by tools/gen_kenney.py from the Kenney "Pixel Platformer" kit\n')
        f.write('   in sprites/ (CC0). Pixel rects into build/kenney_atlas.png. */\n')
        f.write('window.AA = window.AA || {}; AA.KENNEY = ')
        json.dump({'file': 'build/kenney_atlas.png', 'keys': index}, f, separators=(',', ':'))
        f.write(';\n')

    print('packed %d sprites into %dx%d (%d KB)'
          % (len(index), sheet.size[0], sheet.size[1], os.path.getsize(out_png) // 1024))
    print('wrote %s' % os.path.relpath(out_js, ROOT))


if __name__ == '__main__':
    main()
