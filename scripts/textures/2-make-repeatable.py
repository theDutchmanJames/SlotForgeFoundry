# Make a stone pattern repeatable: keep the stones that lie wholly inside the
# tile, drop the ones the edges cut, and fill the band they leave (which wraps
# round the edges) with new stones that fit between the kept ones.
import json, math, random, sys
import numpy as np
from scipy.spatial import Voronoi
from shapely.geometry import Polygon, MultiPolygon, Point, box
from shapely.ops import unary_union
from shapely import affinity

src, out = sys.argv[1], sys.argv[2]
SIZE = 200.0
data = json.load(open(src))
pt = (data['rect'][2] - 2.0) / SIZE  # points per mm; the page has a 1 pt margin
to_mm = lambda p: ((p[0] - 1.0) / pt, SIZE - (p[1] - 1.0) / pt)

# The drawing is one filled shape, the joints, with the stones as its holes.
network = None
for path in data['drawings'][0]['paths']:
    if len(path) < 3:
        continue
    poly = Polygon([to_mm(p) for p in path]).buffer(0)
    network = poly if network is None else network.symmetric_difference(poly)
tile = box(0, 0, SIZE, SIZE)
network = network.intersection(tile)
stones = [g for g in tile.difference(network).geoms if g.area > 0.5]
joint = 2 * network.area / sum(g.length for g in stones)
whole = [g for g in stones if g.exterior.distance(tile.exterior) > 0.05]
print('stones', len(stones), 'whole', len(whole), 'cut by an edge', len(stones) - len(whole))
print('joint width about %.2f mm' % joint, 'mean stone %.1f mm across' % math.sqrt(np.mean([g.area for g in whole])))

SHIFTS = [(dx * SIZE, dy * SIZE) for dx in (-1, 0, 1) for dy in (-1, 0, 1)]
moved = lambda g, s: affinity.translate(g, s[0], s[1])
half = joint / 2
kept9 = unary_union([moved(g, s).buffer(half, join_style='mitre') for g in whole for s in SHIFTS])
# The band to fill, seen in the middle tile and wrapped round its edges.
free9 = box(-SIZE, -SIZE, 2 * SIZE, 2 * SIZE).difference(kept9)
band = free9.intersection(box(-SIZE / 2, -SIZE / 2, 1.5 * SIZE, 1.5 * SIZE))

# Seeds for the new stones: spread through the band, as far apart as the
# drawn stones are, and repeated in every neighbouring tile.
random.seed(7)
spacing = 0.92 * math.sqrt(np.mean([g.area for g in whole]))
central = free9.intersection(tile)
seeds, reach = [], []
def torus(a, b):
    dx = abs(a[0] - b[0]); dy = abs(a[1] - b[1])
    return math.hypot(min(dx, SIZE - dx), min(dy, SIZE - dy))
tries = 0
while tries < 60000:
    tries += 1
    q = (random.uniform(0, SIZE), random.uniform(0, SIZE))
    if not central.contains(Point(q)):
        continue
    # Stones of mixed sizes, as in the drawing: every seed keeps its own distance.
    r = spacing * random.uniform(0.7, 1.55)
    if all(torus(q, s) >= (r + rs) / 2 for s, rs in zip(seeds, reach)):
        seeds.append(q); reach.append(r)

def cells(seeds):
    pts = np.array([(x + sx, y + sy) for (x, y) in seeds for (sx, sy) in SHIFTS])
    vor = Voronoi(pts)
    result = []
    for i in range(len(seeds)):
        k = i * len(SHIFTS) + 4  # the copy in the middle tile
        region = vor.regions[vor.point_region[k]]
        if -1 in region or not region:
            result.append(None); continue
        cell = Polygon(vor.vertices[region]).intersection(free9)
        # The piece of the band this seed stands in.
        if isinstance(cell, MultiPolygon):
            home = [g for g in cell.geoms if g.buffer(0.01).contains(Point(pts[k]))]
            cell = home[0] if home else max(cell.geoms, key=lambda g: g.area)
        result.append(cell if cell.geom_type == 'Polygon' and cell.area > 0 else None)
    return result

for _ in range(1):  # settle the new stones a little, without making them all alike
    seeds = [((c.centroid.x) % SIZE, (c.centroid.y) % SIZE) if c else s for s, c in zip(seeds, cells(seeds))]

made = []
for c in cells(seeds):
    if c is None:
        continue
    stone = c.buffer(-half, join_style='mitre')
    if isinstance(stone, MultiPolygon):
        stone = max(stone.geoms, key=lambda g: g.area)
    if stone.is_empty or stone.area < 12 or stone.minimum_rotated_rectangle.area > 6 * stone.area:
        continue
    made.append(stone.simplify(0.05))
print('new stones in the band', len(made))

# One copy of every stone, placed so its centre lies in the tile.
def home(g):
    c = g.centroid
    return affinity.translate(g, -math.floor(c.x / SIZE) * SIZE, -math.floor(c.y / SIZE) * SIZE)
final = [home(g) for g in whole] + [home(g) for g in made]

# --- checks: laid side by side, no stone meets another, and the pattern
# covers the plane as densely at the seams as in the middle.
grid = [moved(g, s) for g in final for s in SHIFTS]
from shapely.strtree import STRtree
tree = STRtree(grid)
closest, clashes = 1e9, 0
for i, g in enumerate(final):
    a = grid[i * 9 + 4]
    for j in tree.query(a.buffer(joint * 2)):
        if j == i * 9 + 4:
            continue
        d = a.distance(grid[j])
        closest = min(closest, d)
        if d < 0.3 * joint:
            clashes += 1
cover = lambda region: unary_union([g for g in grid if g.intersects(region)]).intersection(region).area / region.area
middle = box(50, 50, 150, 150)
seam = box(SIZE - 25, 0, SIZE + 25, SIZE).union(box(0, SIZE - 25, SIZE, SIZE + 25))
print('closest two stones come: %.2f mm' % closest, '| pairs closer than a third of a joint:', clashes)
print('stone cover in the middle %.1f%%, across the seams %.1f%%' % (100 * cover(middle), 100 * cover(seam)))
print('stones in the tile', len(final), '(drawn', len(whole), '+ new', len(made), ')')

json.dump({
    'name': 'JJ1 cobbles', 'size': SIZE, 'joint': round(joint, 3), 'drawn': len(whole),
    'stones': [[[round(x, 3), round(y, 3)] for x, y in list(g.exterior.coords)[:-1]] for g in final],
}, open(out, 'w'))
