#!/usr/bin/env python3
"""Authoring tool: turns the ASCII chunk art + entity tables below into
src/30_level_data.js.

This exists so the level geometry is laid out as readable 12-row ASCII art and
every row is programmatically padded/validated, instead of hand-counting
hundreds of characters.  Run:  python3 tools/gen_level.py
"""
import json, os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

ROWS = 12           # playable authored rows (world is 16 rows; 12..15 solid)
CHUNK = 24
GROUND_ROW = 10     # row 10 = walkable surface; rows 11+ are solid earth

CHUNKS = [
    # 0) The Diag / Central Campus -----------------------------------------
    dict(name='diag', zone='diag', rows=[
        '........................',
        '........................',
        '........................',
        '........................',
        '........................',
        '........................',
        '........................',
        '........................',
        '........................',
        '.........HH.............',
        '........................',
        '########################',
    ]),
    # 1) State Street storefronts ------------------------------------------
    dict(name='state', zone='street', rows=[
        '........................',
        '........................',
        '........................',
        '........................',
        '........................',
        '........................',
        '........................',
        '..........BBBB..........',
        '........................',
        '........................',
        '........................',
        '########################',
    ]),
    # 2) Construction lot (the neighbourly orange barrel district) ----------
    dict(name='build', zone='build', rows=[
        '........................',
        '........................',
        '........................',
        '........................',
        '........................',
        '.......................B',
        '................BB.....B',
        '................BB.....B',
        '........................',
        '........................',
        '........................',
        '########################',
    ]),
    # 3) Huron River: an open water gap of exactly the ground height on both
    #    sides. Keeping the far bank at the SAME level (rather than a raised
    #    plank deck) matters: a deck edge 12px above the ground creates a pocket
    #    the player can wedge into on a short landing.
    dict(name='river', zone='river', rows=[
        '........................',
        '........................',
        '........................',
        '........................',
        '........................',
        '........................',
        '........................',
        '........................',
        '........................',
        '........................',
        '........................',
        '####wwww################',
    ]),
    # 4) Riverbank + Burton Tower approach --------------------------------
    dict(name='tower', zone='diag', rows=[
        '........................',
        '........................',
        '........................',
        '........................',
        '........................',
        '..........==............',
        '........................',
        '.....==.................',
        '........................',
        '........................',
        '........................',
        '########################',
    ]),
    # 5) Burton Tower plaza (climbable masonry terraces) -------------------
    dict(name='tower2', zone='street', rows=[
        '........................',
        '........................',
        '........................',
        '........................',
        '........................',
        '...................==...',
        '..............==........',
        '...........=............',
        '........................',
        '........BBBB............',
        '........................',
        '########################',
    ]),
    # 6) Stadium approach --------------------------------------------------
    dict(name='stadium', zone='stadium', rows=[
        '........................',
        '........................',
        '........................',
        '........................',
        '............BBBB........',
        '........................',
        '.....BBBB...............',
        '........................',
        '........................',
        '........................',
        '........................',
        '########################',
    ]),
    # 7) The Big House: grandstand steps up to the goal flag ---------------
    #    Every riser is <= 2 tiles so the staircase is climbable with the tuned
    #    jump arc (peak ~2.3 tiles).
    #    Riser spacing <= 2 tiles everywhere, so the whole grandstand is
    #    climbable: ground -> row 10 -> row 8 -> row 5 -> row 3, with the goal
    #    flag on the row 8 deck and bonus masonry above it.
    dict(name='goal', zone='stadium', rows=[
        '........................',   # 0
        '........................',   # 1
        '........................',   # 2
        '...........=============',  # 3   cols 179-191
        '........................',   # 4
        '.....========...........',  # 5   cols 173-180
        '........................',   # 6
        '........................',   # 7
        '........========........',  # 8   cols 176-183
        '........................',   # 9
        '...=====................',  # 10  cols 171-175
        '########################',  # 11
    ]),
]

# zone per tile column, derived from the chunk list
ZONE_OF_COL = []
for c in CHUNKS:
    ZONE_OF_COL += [c['zone']] * CHUNK
COLS = len(ZONE_OF_COL)

# ---- grid assembly ---------------------------------------------------------
grid = [['.'] * COLS for _ in range(ROWS)]
for ci, chunk in enumerate(CHUNKS):
    assert len(chunk['rows']) == ROWS, chunk['name']
    for r, line in enumerate(chunk['rows']):
        assert len(line) == CHUNK, '%s row %d is %d chars (want %d): %r' % (
            chunk['name'], r, len(line), CHUNK, line)
        for x, ch in enumerate(line):
            grid[r][ci * CHUNK + x] = ch

# ---- entity tables (tile units unless noted) -------------------------------
# Coins: placed at (col, row) = the tile they FLOAT IN.
coins = []
def coin_row(ci, row, cols):
    for c in cols:
        coins.append([ci * CHUNK + c, row])

coin_row(0, 8, [10, 11, 12])                  # over the Diag hedge
coin_row(1, 6, [10, 11, 12, 13])              # over the crate stack
coin_row(2, 9, [8, 9, 10])                    # low, in front of the bricks
coin_row(2, 5, [21])                          # high crate reward
coin_row(3, 9, [4, 5, 6, 7])                  # approach to the river
coin_row(3, 9, [8, 9, 10, 11])                # strung over the water
coin_row(3, 8, [21, 22])                      # riverbank pair
coin_row(4, 6, [5, 6])                        # rope-bridge hop
coin_row(4, 4, [10, 11])                      # above the tower balcony planks
coin_row(5, 6, [18, 19])                      # terrace left
coin_row(5, 8, [13, 14])                      # bridge onto the terrace
coin_row(6, 5, [12, 13, 14, 15, 16, 17])      # over the stadium crates
coin_row(7, 2, [11, 12])                      # summit reward above the top deck

# Enemies: [type, spawnX(tiles), spawnY(tiles), left(tiles), right(tiles)]
enemies = [
    # Kept clear of the water crossing (cols 76-83) and of the landing spots on
    # the platform routes, so every encounter is reactable at run speed.
    ['robo', 8.0, 9.6, 6.6, 9.5],       # the Diag (never on the spawn)
    ['drone', 13.0, 7.0, 11.0, 15.5],
    ['robo', 17.0, 9.6, 16.0, 19.5],    # State Street sidewalk
    ['drone', 21.0, 6.4, 19.5, 23.0],
    ['robo', 26.5, 9.6, 25.0, 29.5],    # construction lot
    ['robo', 30.0, 9.6, 29.0, 33.5],
    ['drone', 35.0, 6.2, 33.0, 37.0],
    ['squat', 38.5, 9.6, 37.5, 41.0],
    ['squat', 57.0, 9.6, 55.5, 59.5],   # last stretch before the Huron
    ['drone', 44.0, 7.2, 42.0, 46.5],   # flies over the water
    ['robo', 48.5, 9.6, 47.0, 50.5],    # riverbank
    ['bat', 52.0, 8.0, 49.5, 54.5],
    ['robo', 65.0, 9.6, 64.0, 68.5],    # run-up to Burton Tower
    ['drone', 60.5, 6.8, 59.5, 63.5],
    ['tank', 68.5, 9.5, 67.5, 71.0],    # the big tracked unit
    ['robo', 72.0, 9.6, 71.5, 74.5],
    ['bat', 76.0, 6.0, 74.5, 79.0],     # final gauntlet, above the ground route
]

# Static decorations: [spriteId, col, row]  (x = centre of tile, y = bottom of tile)
# row is measured on the 12-row authoring grid where row 10 is the surface.
props = [
    # --- Diag ---
    [0, 3.0, 10], [29, 20.0, 10], [2, 8.0, 10], [24, 3.6, 10],
    [3, 5.0, 10], [21, 15.0, 10], [13, 22.5, 10], [23, 2.0, 10],
    [6, 6.3, 10], [7, 17.2, 10], [68, 12.0, 10],       # park bench on the Diag
    [53, 8.6, 10],
    # --- State Street ---
    [65, 30.0, 10],                                    # storefront facade strip
    [62, 29.0, 10], [62, 42.0, 10],                    # street lamps
    [66, 33.0, 10], [67, 39.5, 10], [51, 44.0, 10],
    [14, 34.0, 10], [15, 35.2, 10], [22, 37.0, 10],
    [34, 41.0, 10],                                    # railing
    [0, 46.5, 10],
    [39, 43.0, 10],                                    # long crate
    # --- construction lot ---
    [45, 50.5, 10], [40, 54.0, 10], [41, 57.5, 10],
    [43, 60.5, 10], [49, 46.0, 10],
    [67, 52.0, 10], [51, 61.5, 10], [44, 63.0, 10],
    # --- riverbank ---
    [75, 63.0, 10], [17, 65.0, 10], [7, 66.5, 10], [8, 67.5, 10],
    [72, 69.0, 10],                                    # water tower on the bank
    [68, 70.5, 10],
    # --- Burton Tower plaza ---
    [55, 74.5, 10], [64, 77.5, 10], [63, 81.0, 10],
    [13, 76.0, 10], [24, 79.0, 10], [3, 82.5, 10],
    [62, 16.0, 10],
    [48, 83.5, 10], [31, 84.2, 10],
    # --- stadium approach ---
    [50, 87.0, 10], [57, 90.0, 10], [46, 93.0, 10],
    [66, 89.0, 10], [67, 92.0, 10], [68, 94.0, 10],
    [29, 96.5, 10],
    [65, 104.0, 10],                                   # stadium box office
    [62, 101.0, 10], [62, 107.0, 10], [62, 182.0, 10],
    # --- grandstand / goal ---
    [34, 111.0, 10], [37, 113.0, 10], [35, 115.0, 10],
    [25, 118.0, 10], [33, 120.0, 10],
    [0, 122.5, 10], [29, 124.0, 10],
]

# Solid props: sprite ids whose cropped art reads as a solid street object, so
# the player can stand on them.  Collision uses each sprite's own rect.
SOLID_PROP_IDS = {39, 40, 41, 43}
PROP_TOP_ROW = 10    # props on the surface occupy the tile band rows 9..10

checkpoints = [
    [0, 5.0, 10],      # Diag - the bench
    [1, 25.0, 10],     # State Street lamp
    [2, 47.0, 10],     # left bank, just before the Huron
    [3, 73.0, 10],     # Burton Tower plaza
    [4, 100.0, 10],    # stadium box office
]

targets = [
    ['sign', 5.5, 9.4, 'THE DIAG', 14, '#f7f7f2', '#1b3a2a'],
    ['sign', 12.6, 8.6, 'ANN ARBOR, MI', 12, '#ffcb05', '#00274c'],
    ['sign', 29.0, 8.8, 'STATE STREET', 16, '#f7f7f2', '#7a2320'],
    ['sign', 42.0, 9.4, 'GO BLUE', 16, '#ffcb05', '#00274c'],
    ['sign', 53.0, 8.9, 'ROAD WORK AHEAD', 11, '#ffd166', '#5a3a10'],
    ['sign', 74.0, 9.4, 'HURON RIVER', 18, '#dff4ff', '#12496b'],
    ['sign', 76.5, 8.2, 'BURTON TOWER', 18, '#f7f7f2', '#2b2b3a'],
    ['sign', 86.5, 8.3, 'MICHIGAN STADIUM', 26, '#ffcb05', '#00274c'],
    ['sign', 98.0, 9.2, 'THE BIG HOUSE', 18, '#f7f7f2', '#7a2320'],
    ['sign', 128.0, 9.3, 'WELCOME TO YPSILANTI', 12, '#cfe3c8', '#2d4a24'],
    ['shop', 43.0, 9.5, "ZINGERMAN'S", 13],
    ['shop', 78.5, 9.5, 'NICKELS ARCADE', 12],
    ['shop', 105.0, 9.5, 'MAIZE & BLUE BOOKS', 11],
    ['winter', 23.0, 10.0],
    ['winter', 91.5, 10.0],
]

goal = [186.0, 10.0]  # ground level at the end of the run, past the grandstand
player_spawn = [2.5, 9.0]
level_name = 'A2: ONE MORE MILE'

# ---- validate authored entities against the grid ---------------------------
def surface_within(cx, cy, max_down):
    """First standable/walkable tile below (cx, cy) within max_down rows."""
    for dy in range(1, max_down + 1):
        y = cy + dy
        if y >= ROWS:
            return y, '#'
        if y < 0:
            continue
        t = grid[y][cx]
        if t in '#=wHB':
            return y, t
    return None, None


def standable(cx, cy):
    """True when a player standing with feet on tile (cx,cy) would not be
    embedded in terrain: the feet cell and the two body cells above it must all
    be free of solid terrain."""
    for y in (cy, cy - 1, cy - 2):
        if y < 0:
            continue
        if y >= ROWS:
            return False
        if grid[y][cx] in '#=':
            return False
    return True


# Reachability is a level-design invariant, so it is enforced mechanically
# rather than by eye: a gem must sit in an open pocket with walkable headroom
# directly above a surface within REACH_DOWN rows. Anything authored higher is
# nudged down into that pocket; anything with nowhere sensible to live is
# dropped loudly rather than left floating out of reach.
REACH_DOWN = 4
nudged, dropped = [], []
kept = []
for c in sorted(coins):
    cx, cy = c
    placed = None
    for cand in range(cy, min(cy + REACH_DOWN + 1, ROWS)):
        if grid[cand][cx] != '.':
            break
        surf, _t = surface_within(cx, cand, REACH_DOWN)
        if surf is None:
            continue
        if standable(cx, surf - 1) and (surf - 1) - cand <= REACH_DOWN - 1:
            placed = cand
            break
    if placed is None:
        dropped.append((cx, cy))
    else:
        if placed != cy:
            nudged.append((cx, cy, placed))
        kept.append([cx, placed])
coins = kept
if dropped:
    print('WARNING: dropped %d unreachable gem(s): %s' % (len(dropped), dropped))

for (cx, cy) in coins:
    assert 0 <= cx < COLS and 0 <= cy < ROWS, 'coin out of bounds %s' % ((cx, cy),)
    assert grid[cy][cx] == '.', 'coin at %s is inside tile %r' % ((cx, cy), grid[cy][cx])
    surf = surface_within(cx, cy, REACH_DOWN)[0]
    assert surf is not None, 'coin at %s is out of reach' % ((cx, cy),)
    assert standable(cx, surf - 1), 'coin at %s has no standing room under it' % ((cx, cy),)
for e in enemies:
    assert 0 <= e[1] < COLS and 0 <= e[3] and e[4] < COLS, 'enemy out of bounds %s' % (e,)
    assert e[3] < e[4], 'enemy patrol range inverted %s' % (e,)
gx, gy = int(goal[0]), int(goal[1])
assert grid[gy][gx] == '.', 'goal is embedded in a tile: %r' % grid[gy][gx]
assert surface_within(gx, gy, REACH_DOWN)[0] is not None, 'goal has no ground under it'
sx, sy = int(player_spawn[0]), int(player_spawn[1])
assert grid[sy][sx] == '.', 'spawn is embedded in a tile: %r' % grid[sy][sx]
assert surface_within(sx, sy, REACH_DOWN)[0] is not None, 'spawn has no ground under it'
for p in props:
    assert 0 <= p[1] < COLS and 0 <= p[2] <= GROUND_ROW, 'prop out of bounds %s' % (p,)

# ---- emit ------------------------------------------------------------------
def tile_is_solid(tx, ty):
    if tx < 0 or tx >= COLS:
        return True              # world edges are walls
    if ty < 0:
        return False
    if ty >= ROWS:
        return True              # everything below the authored rows is earth
    ch = grid[ty][tx]
    return ch in '#'


# Merge each row's solid cells into maximal horizontal runs -> few collision
# rects, and ledges are detected from the run ends.
solid_rects = []
for r in range(ROWS, 16):
    solid_rects.append([0, r, COLS, 1])
for r in range(ROWS):
    x = 0
    while x < COLS:
        if tile_is_solid(x, r):
            x0 = x
            while x < COLS and tile_is_solid(x, r):
                x += 1
            solid_rects.append([x0, r, x - x0, 1])
        else:
            x += 1

data = {
    'name': level_name,
    'cols': COLS,
    'rows': ROWS,
    'worldRows': 16,
    'groundRow': GROUND_ROW,
    'tile': 32,
    'spawn': player_spawn,
    'goal': goal,
    'zones': ZONE_OF_COL,
    'grid': [''.join(r) for r in grid],
    'solidRects': solid_rects,
    'coins': coins,
    'enemies': enemies,
    'props': props,
    'solidPropIds': sorted(SOLID_PROP_IDS),
    'checkpoints': checkpoints,
    'targets': targets,
}

out = os.path.join(ROOT, 'src', '30_level_data.js')
with open(out, 'w') as f:
    f.write('/* GENERATED by tools/gen_level.py - edit the ASCII art there, not here. */\n')
    f.write('window.AA = window.AA || {}; AA.LEVEL = ')
    json.dump(data, f, separators=(',', ':'))
    f.write(';\n')

print('level: %s  %d x %d tiles (%d px wide)' % (level_name, COLS, ROWS, COLS * 32))
print('solid rects: %d | coins: %d | enemies: %d | props: %d | targets: %d | checkpoints: %d'
      % (len(solid_rects), len(coins), len(enemies), len(props), len(targets), len(checkpoints)))
if nudged:
    print('nudged %d gem(s) down onto a supported row: %s'
          % (len(nudged), ', '.join('col %d row %d->%d' % n for n in nudged)))
print('wrote %s (%d bytes)' % (out, os.path.getsize(out)))
