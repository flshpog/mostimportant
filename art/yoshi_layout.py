"""Yoshi's Island (the merge board): the islands, the routes and the spaces.

Plain Python (no Blender), shared by build_yoshi.py and runnable on its own:

    python art/yoshi_layout.py          # writes packages/board-data/boards/merge.json

Everything is in world metres: x to the right, y away from the default camera. A ring of
islands sits round a lagoon with the egg island in the middle. The main path loops the
ring anticlockwise from the beach; four shortcut bridges cross the lagoon in an X and
meet on the egg island.
"""
import json, math, os

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# world <-> layout pixels, same mapping as every other board (see board-data schema)
W, H, SCALE, CX, CY = 1000, 800, 0.05, 500, 400
SPACING = 2.0       # metres between spaces (the main board uses about 1.6)
WATER = -0.5        # sea level; the paths and bridge decks are at 0

# name: centre, radii, rotation, shoreline wobble seed, what lives there
ISLANDS = {
    "beach":   dict(c=(0.0, -13.9), r=(7.8, 4.5), rot=0.0, seed=1),
    "dock":    dict(c=(14.0, -9.8), r=(4.9, 3.9), rot=-0.5, seed=2),
    "islet_e": dict(c=(19.2, -0.6), r=(2.4, 2.7), rot=0.0, seed=3),
    "grove":   dict(c=(15.0, 9.8), r=(5.4, 4.6), rot=0.6, seed=4),
    "cliff":   dict(c=(0.0, 16.3), r=(8.8, 5.5), rot=0.0, seed=5),
    "jungle":  dict(c=(-15.0, 9.8), r=(5.4, 4.6), rot=-0.6, seed=6),
    "islet_w": dict(c=(-19.2, -0.6), r=(2.4, 2.7), rot=0.0, seed=7),
    "flowers": dict(c=(-14.0, -9.8), r=(4.9, 3.9), rot=0.5, seed=8),
    "egg":     dict(c=(0.0, 0.7), r=(6.6, 4.0), rot=0.0, seed=9),
}

# The ring, anticlockwise from the start on the beach.
RING = [
    (0.0, -13.2), (4.2, -12.9), (8.0, -11.9),
    (11.6, -10.2), (14.6, -8.3), (16.9, -5.2),
    (18.9, -1.8), (18.9, 1.0),
    (17.3, 5.6), (14.6, 8.6), (11.4, 11.2),
    (7.0, 13.1), (2.4, 13.6), (-2.4, 13.6), (-7.0, 13.1),
    (-11.4, 11.2), (-14.6, 8.6), (-17.3, 5.6),
    (-18.9, 1.0), (-18.9, -1.8),
    (-16.9, -5.2), (-14.6, -8.3), (-11.6, -10.2),
    (-8.0, -11.9), (-4.2, -12.9),
]
# Across the egg island's front, east to west, clear of the egg (behind it, at y = 2).
EGG_PATH = [(5.4, -0.9), (2.8, -2.0), (0.0, -2.35), (-2.8, -2.0), (-5.4, -0.9)]
# Shortcut bridges: (ring point to leave from, bends) into the egg path's first space,
# and (bends, ring point to join) out of its last.
ENTRIES = [((14.6, -8.3), [(10.2, -4.4)]), ((14.6, 8.6), [(10.2, 3.6)])]
EXITS = [([(-10.2, 3.6)], (-14.6, 8.6)), ([(-10.2, -4.4)], (-14.6, -8.3))]

# Space types: each route cycles a pattern, then the specials go where they fit the
# islands (shops by the dock and in the jungle, events on the islets and by the egg).
PATTERN = "brbgbrbbrgbbrbgb"
SHOPS = {(13.4, -9.4): "purple", (-14.8, 8.0): "pink"}
EVENTS = [(18.9, -0.4), (-18.9, -0.4), (0.0, -2.35), (0.0, 13.6)]

def wobble(seed, theta):
    """A smooth shoreline wiggle round an island, about +-10%."""
    s = 0.0
    for k, (f, a) in enumerate(((2, 0.045), (3, 0.04), (5, 0.025), (7, 0.015))):
        s += a * math.sin(f * theta + seed * (1.7 + k * 2.3))
    return s


def island_radius(isl, theta):
    """Distance from the island's centre to its shore along world angle theta."""
    t = theta - isl["rot"]
    rx, ry = isl["r"]
    base = rx * ry / math.sqrt((ry * math.cos(t)) ** 2 + (rx * math.sin(t)) ** 2)
    return base * (1 + wobble(isl["seed"], t))


def island_sdf(isl, x, y):
    """Roughly the signed distance to the shore: negative on land."""
    dx, dy = x - isl["c"][0], y - isl["c"][1]
    return math.hypot(dx, dy) - island_radius(isl, math.atan2(dy, dx))


def land_sdf(x, y):
    """(distance, island name) for the nearest island."""
    return min((island_sdf(isl, x, y), name) for name, isl in ISLANDS.items())


def catmull(pts, closed, steps=40):
    """A smooth curve through the points, as a dense polyline."""
    n = len(pts)
    out = []
    segs = n if closed else n - 1
    for i in range(segs):
        p0 = pts[(i - 1) % n] if closed or i > 0 else pts[0]
        p1 = pts[i % n]
        p2 = pts[(i + 1) % n]
        p3 = pts[(i + 2) % n] if closed or i + 2 < n else pts[-1]
        for s in range(steps):
            t = s / steps
            t2, t3 = t * t, t * t * t
            out.append(tuple(0.5 * (2 * p1[k] + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2
                                     + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3) for k in range(2)))
    if not closed:
        out.append(pts[-1])
    return out


def resample(poly, n, closed):
    """n points evenly spaced along a polyline (for a closed one, the first is poly[0])."""
    pts = poly + [poly[0]] if closed else poly
    seg = [math.dist(pts[i], pts[i + 1]) for i in range(len(pts) - 1)]
    total = sum(seg)
    count = n if closed else n
    step = total / (n if closed else n - 1)
    out, i, acc = [], 0, 0.0
    for k in range(count):
        target = k * step
        while i < len(seg) - 1 and acc + seg[i] < target:
            acc += seg[i]
            i += 1
        t = (target - acc) / seg[i] if seg[i] else 0
        a, b = pts[i], pts[i + 1]
        out.append((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t))
    return out


def length(poly):
    return sum(math.dist(poly[i], poly[i + 1]) for i in range(len(poly) - 1))


def build_graph():
    """Spaces (id, world pos, next ids) and the dense curves the paths follow."""
    ring_curve = catmull(RING, closed=True)
    ring_len = length(ring_curve + [ring_curve[0]])
    n_ring = round(ring_len / SPACING)
    ring = resample(ring_curve, n_ring, closed=True)

    spaces = []  # dicts: id, p, next(list of indices), route

    def add(p, route):
        spaces.append(dict(p=p, next=[], route=route))
        return len(spaces) - 1

    ring_ids = [add(p, "ring") for p in ring]
    for i, sid in enumerate(ring_ids):
        spaces[sid]["next"].append(ring_ids[(i + 1) % len(ring_ids)])

    def nearest_ring(pt):
        return min(ring_ids, key=lambda i: math.dist(spaces[i]["p"], pt))

    egg_curve = catmull(EGG_PATH, closed=False)
    egg = resample(egg_curve, max(2, round(length(egg_curve) / SPACING) + 1), closed=False)
    egg_ids = [add(p, "egg") for p in egg]
    for a, b in zip(egg_ids, egg_ids[1:]):
        spaces[a]["next"].append(b)

    curves = {"ring": ring_curve + [ring_curve[0]], "egg": egg_curve}

    def chain(a, bends, b, name):
        """Spaces strung between two existing spaces through the bends."""
        pa, pb = spaces[a]["p"], spaces[b]["p"]
        curve = catmull([pa] + bends + [pb], closed=False)
        n = max(1, round(length(curve) / SPACING))
        pts = resample(curve, n + 1, closed=False)[1:-1]
        ids = [add(p, name) for p in pts]
        seq = [a] + ids + [b]
        for x, y in zip(seq, seq[1:]):
            spaces[x]["next"].append(y)
        curves[name] = curve
        return ids

    for k, (start, bends) in enumerate(ENTRIES):
        chain(nearest_ring(start), bends, egg_ids[0], f"entry{k}")
    for k, (bends, end) in enumerate(EXITS):
        chain(egg_ids[-1], bends, nearest_ring(end), f"exit{k}")
    return spaces, ring_ids, egg_ids, curves


def assign_types(spaces, ring_ids, egg_ids):
    types = {}
    k = 0
    for route in ["ring", "egg", "entry0", "entry1", "exit0", "exit1"]:
        for i, s in enumerate(spaces):
            if s["route"] == route:
                types[i] = {"b": "blue", "r": "red", "g": "green"}[PATTERN[k % len(PATTERN)]]
                k += 1
    types[ring_ids[0]] = "start"
    # forks, merges and their neighbours stay blue so the signposts sit by a plain space
    merges = {j for s in spaces for j in s["next"] if sum(j in t["next"] for t in spaces) > 1}
    for i, s in enumerate(spaces):
        if len(s["next"]) > 1 or i in merges:
            types[i] = "blue"
    for i in ring_ids[1:3]:
        types[i] = "blue"

    def nearest(pt):
        return min(range(len(spaces)), key=lambda i: math.dist(spaces[i]["p"], pt))

    shops = {nearest(pt): v for pt, v in SHOPS.items()}
    for pt in EVENTS:
        types[nearest(pt)] = "event"
    for i in shops:
        types[i] = "shop"
    return types, shops


def to_pos(p):
    return {"x": round((p[0] / SCALE + CX) / W, 4), "y": round((CY - p[1] / SCALE) / H, 4)}


def layout():
    spaces, ring_ids, egg_ids, curves = build_graph()
    types, shops = assign_types(spaces, ring_ids, egg_ids)
    # ids follow the ring first, then the shortcuts, so s01 is the start
    ids = {i: f"s{k + 1:02d}" for k, i in enumerate(range(len(spaces)))}
    out = []
    for i, s in enumerate(spaces):
        sp = {"id": ids[i], "type": types[i], "pos": to_pos(s["p"]), "next": [ids[j] for j in s["next"]]}
        if i in shops:
            sp["passEffect"] = True
            sp["shop"] = shops[i]
        out.append(sp)
    board = {
        "id": "merge",
        "name": "Yoshi's Island",
        "reference": {"image": "", "width": W, "height": H},
        "world": {"scale": SCALE, "cx": CX, "cy": CY, "tileY": 0.05, "model": "models/board-merge.glb", "theme": "day"},
        "startSpace": ids[ring_ids[0]],
        "bridges": [],
        "spaces": out,
    }
    return board, spaces, curves, ids


def write():
    board, spaces, _, _ = layout()
    path = os.path.join(REPO, "packages", "board-data", "boards", "merge.json")
    with open(path, "w", encoding="utf8", newline="\n") as f:
        f.write("{\n")
        for k in ("id", "name", "reference", "world", "startSpace", "bridges"):
            f.write(f'  {json.dumps(k)}: {json.dumps(board[k])},\n')
        f.write('  "spaces": [\n')
        f.write(",\n".join("    " + json.dumps(s) for s in board["spaces"]))
        f.write("\n  ]\n}\n")
    from collections import Counter
    print(len(board["spaces"]), "spaces", dict(Counter(s["type"] for s in board["spaces"])))
    return path


if __name__ == "__main__":
    write()
