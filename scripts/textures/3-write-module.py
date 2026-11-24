# Turn the repeatable tile into a texture module for Foundry. Every joint is
# given a least width first, so that no two stones nearly touch.
import json, math, sys
from shapely.geometry import Polygon
from shapely import affinity
from shapely.strtree import STRtree

tile = json.load(open(sys.argv[1]))
SIZE, joint = tile['size'], tile['joint']
stones = [Polygon(p).buffer(0) for p in tile['stones']]
least = 0.8 * joint
SHIFTS = [(dx * SIZE, dy * SIZE) for dx in (-1, 0, 1) for dy in (-1, 0, 1)]
fixed = 0
for i in range(len(stones)):
    for j in range(len(stones)):
        for s in SHIFTS:
            if i == j and s == (0, 0):
                continue
            other = affinity.translate(stones[j], *s)
            if stones[i].distance(other) < least - 1e-9 and (i < j or s != (0, 0)):
                cut = stones[i].difference(other.buffer(least, join_style='mitre'))
                if cut.geom_type == 'MultiPolygon':
                    cut = max(cut.geoms, key=lambda g: g.area)
                stones[i] = cut
                fixed += 1
closest = 1e9
grid = [affinity.translate(g, *s) for g in stones for s in SHIFTS]
tree = STRtree(grid)
for i, g in enumerate(stones):
    for k in tree.query(g.buffer(3)):
        if k != i * 9 + 4:
            closest = min(closest, g.distance(grid[k]))
print('joints widened', fixed, '| thinnest joint now %.2f mm' % closest)
across = math.sqrt(sum(g.area for g in stones) / len(stones))
flat = [[round(v, 2) for xy in list(g.exterior.coords)[:-1] for v in xy] for g in stones]
body = (
    "// A road surface texture: one repeatable tile of stones. Made from the\n"
    "// drawing JJ1 by tools outside the app; the stones along the edges were\n"
    "// redrawn so that the tile repeats in both directions.\n"
    "// size: the tile is this many mm square as drawn. joint: the usual gap\n"
    "// between two stones as drawn. stone: a stone is about this far across as\n"
    "// drawn. real: what that is on a real road, for the model scales.\n"
    "// stones: each stone as x, y, x, y, ... in mm, anticlockwise or clockwise.\n"
    "export default Object.freeze({\n"
    "  id: 'cobbles',\n  name: 'Cobbles',\n"
    "  size: %s,\n  joint: %s,\n  stone: %s,\n  real: 125,\n  stones: %s,\n});\n"
) % (SIZE, round(joint, 2), round(across, 1), json.dumps(flat, separators=(',', ':')).replace('],[', '],\n    [').replace('[[', '[\n    [').replace(']]', '],\n  ]'))
open(sys.argv[2], 'w', encoding='utf-8', newline='\n').write(body)
print('stones', len(stones), 'about %.1f mm across' % across, 'bytes', len(body))
