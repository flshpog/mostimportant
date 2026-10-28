"""Builds Yoshi's Island, the merge board, in Blender.

Run inside Blender with art/board.blend open (it borrows the tile meshes, the shops, the
start gate, the signposts and the materials from it):

    exec(open(r"<repo>/art/build_yoshi.py").read()); build()

The layout (islands, routes, spaces) comes from art/yoshi_layout.py, which also writes
packages/board-data/boards/merge.json. This script saves its work as art/board-yoshi.blend
(board.blend and the old art/board-merge.blend are never overwritten), exports the website
model apps/web/public/models/board-merge.glb and renders the Discord backdrop
packages/discord/assets/backdrop-merge.png/.json.

Everything is built from code, so it can be rebuilt from scratch after a layout change.
Props never stand on a path or between a space and the overview camera.
"""
import bpy, bmesh, importlib.util, json, math, os, random, sys
import numpy as np
from mathutils import Euler, Matrix, Vector, kdtree, noise

REPO = os.path.dirname(os.path.dirname(os.path.abspath(bpy.data.filepath)))
sys.path.insert(0, os.path.join(REPO, "art"))
import yoshi_layout as Y
importlib.reload(Y)
_spec = importlib.util.spec_from_file_location("build_board", os.path.join(REPO, "art", "build_board.py"))
bb = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(bb)
srgb = bb.srgb

WATER = Y.WATER
TAU = math.pi * 2
# the website's overview camera, in Blender coordinates (three.js (0, 31, 30))
CAMERA = Vector((0.0, -30.0, 31.0))

COLLECTIONS = ["Terrain", "Water", "Foam", "Paths", "Bridges", "Palms", "Trees", "Plants", "Flowers", "Grass", "Rocks",
               "Eggs", "Beach", "Dock", "Waterfall", "Shops", "Signposts", "Start", "Sky", "Spaces"]

# ------------------------------------------------------------------ palette (sRGB)

SAND = (0.99, 0.89, 0.64)
SAND_WET = (0.90, 0.76, 0.52)
GRASS = (0.42, 0.82, 0.30)
GRASS_LIGHT = (0.60, 0.91, 0.36)
CLIFF_A = (1.0, 0.80, 0.53)
CLIFF_B = (0.86, 0.48, 0.32)
PATH = (0.98, 0.92, 0.74)
PATH_EDGE = (0.90, 0.78, 0.56)
WOOD = (0.80, 0.55, 0.32)
WOOD_DARK = (0.62, 0.40, 0.22)
WOOD_LIGHT = (0.90, 0.70, 0.45)
ROPE = (0.93, 0.83, 0.60)
STONE = (0.93, 0.89, 0.81)
STONE_DARK = (0.80, 0.75, 0.68)
ROCK = (0.83, 0.79, 0.72)
ROCK_DARK = (0.56, 0.53, 0.52)
LEAF = (0.22, 0.66, 0.24)
LEAF_LIGHT = (0.50, 0.87, 0.32)
TRUNK_A = (0.74, 0.54, 0.34)
TRUNK_B = (0.84, 0.66, 0.43)
WHITE = (0.99, 0.98, 0.95)
EGG_GREEN = (0.36, 0.78, 0.30)
BLACK = (0.08, 0.06, 0.08)
FLOWER_COLOURS = [(0.98, 0.34, 0.45), (1.0, 0.56, 0.75), (1.0, 0.82, 0.25), (0.98, 0.55, 0.22), (0.62, 0.48, 0.98), (0.42, 0.70, 1.0)]


def mix(a, b, t):
    return tuple(x + (y - x) * t for x, y in zip(a, b))


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def sstep(e0, e1, x):
    t = max(0.0, min(1.0, (x - e0) / (e1 - e0)))
    return t * t * (3 - 2 * t)


# ------------------------------------------------------------------ mesh building

class MB:
    """Collects parts (verts, faces, a colour per vertex) into one mesh."""

    def __init__(self):
        self.v, self.f, self.col, self.sm = [], [], [], []

    def add(self, part, M=None, colour=(1, 1, 1), smooth=True):
        verts, faces = part
        base = len(self.v)
        for p in verts:
            q = M @ Vector(p) if M is not None else Vector(p)
            self.v.append(tuple(q))
            self.col.append(colour(p) if callable(colour) else colour)
        for f in faces:
            self.f.append(tuple(i + base for i in f))
            self.sm.append(smooth)
        return self

    def mesh(self, name, mat="Props"):
        if name in bpy.data.meshes:
            bpy.data.meshes.remove(bpy.data.meshes[name])
        me = bpy.data.meshes.new(name)
        me.from_pydata(self.v, [], self.f)
        me.update()
        bm = bmesh.new()
        bm.from_mesh(me)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        bm.to_mesh(me)
        bm.free()
        me.polygons.foreach_set("use_smooth", self.sm)
        layer = bb.vcol_layer(me)
        lv = np.zeros(len(me.loops), dtype=np.int32)
        me.loops.foreach_get("vertex_index", lv)
        cols = np.array([(*srgb(c), 1.0) for c in self.col], dtype=np.float32)
        layer.data.foreach_set("color", cols[lv].ravel())
        me.materials.append(bpy.data.materials[mat])
        me.update()
        return me


def T(loc=(0, 0, 0), rot=(0, 0, 0), scale=1.0):
    s = scale if isinstance(scale, (tuple, list, Vector)) else (scale, scale, scale)
    return Matrix.LocRotScale(Vector(loc), Euler(rot), Vector(s))


def sphere(seg=16, rings=10):
    v = [(0, 0, -1)]
    for j in range(1, rings):
        ph = -math.pi / 2 + math.pi * j / rings
        for i in range(seg):
            th = TAU * i / seg
            v.append((math.cos(ph) * math.cos(th), math.cos(ph) * math.sin(th), math.sin(ph)))
    v.append((0, 0, 1))
    top = len(v) - 1
    f = [(0, 1 + (i + 1) % seg, 1 + i) for i in range(seg)]
    for j in range(rings - 2):
        a, b = 1 + j * seg, 1 + (j + 1) * seg
        f += [(a + i, a + (i + 1) % seg, b + (i + 1) % seg, b + i) for i in range(seg)]
    a = 1 + (rings - 2) * seg
    f += [(a + i, a + (i + 1) % seg, top) for i in range(seg)]
    return v, f


def cyl(seg=12, r0=1.0, r1=1.0, h=1.0, rings=1, caps=True):
    v, f = [], []
    for k in range(rings + 1):
        t = k / rings
        r = r0 + (r1 - r0) * t
        for i in range(seg):
            th = TAU * i / seg
            v.append((r * math.cos(th), r * math.sin(th), h * t))
    for k in range(rings):
        a, b = k * seg, (k + 1) * seg
        f += [(a + i, a + (i + 1) % seg, b + (i + 1) % seg, b + i) for i in range(seg)]
    if caps:
        f.append(tuple(reversed(range(seg))))
        if r1 > 1e-6:
            f.append(tuple(range(rings * seg, rings * seg + seg)))
    return v, f


def box(lo, hi):
    v = [(x, y, z) for z in (lo[2], hi[2]) for y in (lo[1], hi[1]) for x in (lo[0], hi[0])]
    f = [(0, 2, 3, 1), (4, 5, 7, 6), (0, 1, 5, 4), (2, 6, 7, 3), (0, 4, 6, 2), (1, 3, 7, 5)]
    return v, f


def rounded_box(sx, sy, sz, seg=6, rings=6):
    """A pillowy box: a sphere pushed out towards its corners."""
    v, f = sphere(seg * 2, rings)
    out = []
    for x, y, z in v:
        k = 0.55
        out.append((math.copysign(abs(x) ** k, x) * sx / 2, math.copysign(abs(y) ** k, y) * sy / 2, math.copysign(abs(z) ** k, z) * sz / 2))
    return out, f


def tube(pts, radii, seg=8, caps=True):
    """A tube through the points, radius per point."""
    pts = [Vector(p) for p in pts]
    n = len(pts)
    v, f = [], []
    prev = None
    for i, p in enumerate(pts):
        t = (pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)]).normalized()
        if prev is None:
            ref = Vector((0, 0, 1)) if abs(t.z) < 0.9 else Vector((1, 0, 0))
            nrm = t.cross(ref).normalized()
        else:
            nrm = (prev - t * prev.dot(t)).normalized()
        prev = nrm
        bi = t.cross(nrm)
        r = radii[i] if isinstance(radii, (list, tuple)) else radii
        for k in range(seg):
            a = TAU * k / seg
            v.append(tuple(p + (nrm * math.cos(a) + bi * math.sin(a)) * r))
    for i in range(n - 1):
        a, b = i * seg, (i + 1) * seg
        f += [(a + k, a + (k + 1) % seg, b + (k + 1) % seg, b + k) for k in range(seg)]
    if caps:
        f.append(tuple(reversed(range(seg))))
        f.append(tuple(range((n - 1) * seg, n * seg)))
    return v, f


def torus(R=1.0, r=0.25, seg=20, sides=8):
    v, f = [], []
    for i in range(seg):
        a = TAU * i / seg
        for k in range(sides):
            b = TAU * k / sides
            v.append(((R + r * math.cos(b)) * math.cos(a), (R + r * math.cos(b)) * math.sin(a), r * math.sin(b)))
    for i in range(seg):
        for k in range(sides):
            a0, a1 = i * sides, ((i + 1) % seg) * sides
            f.append((a0 + k, a1 + k, a1 + (k + 1) % sides, a0 + (k + 1) % sides))
    return v, f


def blob(seed, seg=14, rings=9, rough=0.18):
    """A lumpy rounded rock or bush."""
    v, f = sphere(seg, rings)
    off = Vector((seed * 3.1, seed * 1.7, seed * 2.3))
    out = []
    for p in v:
        q = Vector(p)
        k = 1 + rough * noise.noise(q * 1.3 + off)
        out.append(tuple(q * k))
    return out, f


# ------------------------------------------------------------------ the land

def island_arrays():
    names = list(Y.ISLANDS)
    return names, [Y.ISLANDS[n] for n in names]


def sdf_grid(X, Yg):
    """Signed distance to the nearest shore and which island, for arrays of points."""
    names, isls = island_arrays()
    best = np.full(X.shape, 1e9)
    which = np.zeros(X.shape, dtype=np.int32)
    for k, isl in enumerate(isls):
        dx, dy = X - isl["c"][0], Yg - isl["c"][1]
        th = np.arctan2(dy, dx)
        t = th - isl["rot"]
        rx, ry = isl["r"]
        base = rx * ry / np.sqrt((ry * np.cos(t)) ** 2 + (rx * np.sin(t)) ** 2)
        wob = np.zeros(X.shape)
        for j, (fq, a) in enumerate(((2, 0.045), (3, 0.04), (5, 0.025), (7, 0.015))):
            wob += a * np.sin(fq * t + isl["seed"] * (1.7 + j * 2.3))
        d = np.hypot(dx, dy) - base * (1 + wob)
        m = d < best
        best[m] = d[m]
        which[m] = k
    return best, which


BEACH = {"beach": 2.4, "cliff": 0.9, "egg": 1.5}


class Land:
    """The height of the ground everywhere, and the things carved into it."""

    def __init__(self, curves, spaces):
        self.curves = curves
        self.spaces = spaces
        # points along every route, for distances to the paths
        self.path_kd = kdtree.KDTree(sum(len(c) for c in curves.values()) * 3)
        n = 0
        for c in curves.values():
            for a, b in zip(c, c[1:]):
                for t in (0.0, 0.33, 0.66):
                    self.path_kd.insert((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, 0), n)
                    n += 1
        self.path_kd.balance()
        names, isls = island_arrays()
        self.names = names
        rng = random.Random(11)
        # rounded hills: bumps well away from the paths
        self.hills = []
        for name, isl in Y.ISLANDS.items():
            want = {"beach": 3, "egg": 0, "islet_e": 0, "islet_w": 0, "cliff": 2}.get(name, 4)
            tries = 0
            while want and tries < 400:
                tries += 1
                a = rng.uniform(0, TAU)
                r = rng.uniform(0, 0.8) * Y.island_radius(isl, a)
                x, y = isl["c"][0] + math.cos(a) * r, isl["c"][1] + math.sin(a) * r
                if self.path_dist(x, y) < 3.0 or Y.island_sdf(isl, x, y) > -1.8:
                    continue
                if name == "egg" and math.hypot(x - EGG[0], y - EGG[1]) < 3.4:
                    continue
                if name == "cliff" and y > isl["c"][1] + 0.3:
                    continue
                self.hills.append((x, y, rng.uniform(1.4, 2.4), rng.uniform(0.5, 1.3)))
                want -= 1
        cliff = Y.ISLANDS["cliff"]
        self.cliff_y = cliff["c"][1] + 1.0          # the front of the cliff
        self.cliff_top = 4.2
        # the cliff itself is its own mesh (see build_mesa): a rounded block
        self.mesa = dict(cx=0.0, cy=self.cliff_y + 2.15, a=6.5, b=2.3, n=2.6)
        # the waterfall: halfway between two spaces on the cliff island, west of centre
        ring = [s["p"] for s in spaces if s["route"] == "ring" and abs(s["p"][1] - 13.4) < 0.6 and -6.5 < s["p"][0] < -2.0]
        ring.sort()
        fx = (ring[0][0] + ring[1][0]) / 2 if len(ring) >= 2 else -4.2
        self.fall_x = fx
        self.pond = (fx, self.cliff_y - 0.75, 1.15)
        crossing_y = 13.45
        self.stream = [(fx, self.pond[1]), (fx + 0.1, crossing_y), (fx + 0.45, 11.9), (fx + 0.7, 10.2), (fx + 0.8, 9.2)]
        self.top_stream = [(fx, self.cliff_y + 0.6), (fx - 0.4, self.cliff_y + 1.6), (fx - 1.3, self.cliff_y + 2.4)]
        self.spring = (fx - 1.6, self.cliff_y + 2.6, 0.8)

    def mesa_r(self, t):
        m = self.mesa
        base = (abs(math.cos(t) / m["a"]) ** m["n"] + abs(math.sin(t) / m["b"]) ** m["n"]) ** (-1 / m["n"])
        return base * (1 + 0.025 * math.sin(5 * t + 1.3) + 0.015 * math.sin(11 * t))

    def mesa_front(self, x):
        """The y of the cliff's front face at x."""
        m = self.mesa
        lo, hi = -math.pi + 0.01, -0.01
        for _ in range(40):
            mid = (lo + hi) / 2
            if self.mesa_r(mid) * math.cos(mid) < x - m["cx"]:
                lo = mid
            else:
                hi = mid
        t = (lo + hi) / 2
        return m["cy"] + self.mesa_r(t) * math.sin(t)

    def path_dist(self, x, y):
        _, _, d = self.path_kd.find((x, y, 0))
        return d

    def path_dist_grid(self, X, Yg):
        out = np.empty(X.shape)
        flat_x, flat_y, flat_o = X.ravel(), Yg.ravel(), out.ravel()
        for i in range(flat_x.size):
            flat_o[i] = self.path_kd.find((flat_x[i], flat_y[i], 0))[2]
        return out

    @staticmethod
    def seg_dist(X, Yg, poly):
        best = np.full(X.shape, 1e9)
        for a, b in zip(poly, poly[1:]):
            ax, ay = a
            bx, by = b
            dx, dy = bx - ax, by - ay
            L2 = dx * dx + dy * dy
            t = np.clip(((X - ax) * dx + (Yg - ay) * dy) / L2, 0, 1)
            best = np.minimum(best, np.hypot(X - ax - dx * t, Yg - ay - dy * t))
        return best

    def heights(self, X, Yg, pd=None, flatten=True):
        """Ground height for arrays of points. pd: distance to the paths (worked out if missing)."""
        d, which = sdf_grid(X, Yg)
        B = np.array([BEACH.get(n, 1.3) for n in self.names])[which]
        # beach: from the waterline up to the grass
        t = np.clip(-d / B, 0, 1)
        z = WATER + (0 - WATER) * (t * t * (3 - 2 * t))
        # under the water, slope away
        z = np.where(d > 0, WATER - 2.0 * smoothstep(0, 2.6, d) - 0.02, z)
        inland = smoothstep(0, 1.4, -d - B)
        # rolling ground and rounded hills
        hz = np.zeros(X.shape)
        for (hx, hy, r, h) in self.hills:
            q = ((X - hx) ** 2 + (Yg - hy) ** 2) / (r * r)
            hz += h * np.exp(-q * 1.6)
        rolling = np.vectorize(lambda x, y: noise.noise(Vector((x * 0.16, y * 0.16, 2.0))))(X, Yg)
        hz += np.clip(rolling + 0.25, 0, None) * 0.45
        if pd is None:
            pd = self.path_dist_grid(X, Yg)
        away = smoothstep(1.15, 2.6, pd) if flatten else 1.0
        egg_ring = smoothstep(2.4, 3.4, np.hypot(X - EGG[0], Yg - EGG[1]))
        z = z + hz * inland * away * egg_ring
        # level pads for the shops
        for s in self.spaces:
            if "plot" in s:
                px, py = s["plot"]
                pad = smoothstep(2.9, 2.1, np.hypot(X - px, Yg - py))
                z = z + (0.0 - z) * pad
        is_cliff = which == self.names.index("cliff")
        # the pond under the waterfall and the stream down to the lagoon
        sd = self.seg_dist(X, Yg, self.stream)
        pond = np.hypot(X - self.pond[0], Yg - self.pond[1]) - self.pond[2]
        cut = np.minimum(sd - 0.5, pond)
        bed = WATER - 0.35
        z = np.where(is_cliff, np.minimum(z, bed + (z - bed) * smoothstep(0, 0.55, cut)), z)
        return z, d, which

    def height(self, x, y):
        z, _, _ = self.heights(np.array([[x]]), np.array([[y]]))
        return float(z[0, 0])


EGG = (0.0, 2.15)


def build_terrain(land, step=0.2):
    xs = np.arange(-23.5, 23.5 + 1e-6, step)
    ys = np.arange(-20.5, 23.5 + 1e-6, step)
    X, Yg = np.meshgrid(xs, ys)
    pd = land.path_dist_grid(X, Yg)
    Z, D, which = land.heights(X, Yg, pd)
    ny, nx = X.shape
    keep_v = Z > WATER - 0.6
    # a face stays if any corner is above the deep water
    k = keep_v[:-1, :-1] | keep_v[1:, :-1] | keep_v[:-1, 1:] | keep_v[1:, 1:]
    idx = -np.ones(X.shape, dtype=np.int64)
    used = np.zeros(X.shape, dtype=bool)
    used[:-1, :-1] |= k
    used[1:, :-1] |= k
    used[:-1, 1:] |= k
    used[1:, 1:] |= k
    idx[used] = np.arange(used.sum())
    verts = np.stack([X[used], Yg[used], Z[used]], axis=1)
    jj, ii = np.nonzero(k)
    faces = np.stack([idx[jj, ii], idx[jj, ii + 1], idx[jj + 1, ii + 1], idx[jj + 1, ii]], axis=1)
    me = bpy.data.meshes.new("Terrain_yoshi")
    me.vertices.add(len(verts))
    me.vertices.foreach_set("co", verts.ravel())
    me.loops.add(faces.size)
    me.loops.foreach_set("vertex_index", faces.ravel())
    me.polygons.add(len(faces))
    me.polygons.foreach_set("loop_start", np.arange(0, faces.size, 4))
    me.polygons.foreach_set("loop_total", np.full(len(faces), 4))
    me.update(calc_edges=True)
    me.polygons.foreach_set("use_smooth", np.ones(len(faces), dtype=bool))
    # colours per vertex
    Zu, Du, Wu = Z[used], D[used], which[used]
    names = land.names
    B = np.array([BEACH.get(n, 1.3) for n in names])[Wu]
    t = np.clip(-Du / B, 0, 1)
    nz = np.array([noise.noise(Vector((x * 0.35, y * 0.35, 1.0))) for x, y in zip(X[used], Yg[used])])
    nz2 = np.array([noise.noise(Vector((x * 1.4, y * 1.4, 4.0))) for x, y in zip(X[used], Yg[used])])
    grass = np.array(GRASS)[None] + (np.array(GRASS_LIGHT) - np.array(GRASS))[None] * np.clip(0.45 + 0.5 * nz + 0.18 * np.clip(Zu, 0, 2.5), 0, 1)[:, None]
    grass *= (0.96 + 0.05 * nz2)[:, None]
    sand = np.array(SAND)[None] * (0.97 + 0.03 * nz2)[:, None]
    wet = np.array(SAND_WET)[None]
    sand = sand + (wet - sand) * smoothstep(WATER + 0.18, WATER - 0.05, Zu)[:, None]
    g = smoothstep(0.82, 0.98, t)[:, None]
    col = sand + (grass - sand) * g
    lin = np.vectorize(lambda c: (c / 12.92) if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4)(np.clip(col, 0, 1))
    layer = bb.vcol_layer(me)
    lv = np.zeros(len(me.loops), dtype=np.int32)
    me.loops.foreach_get("vertex_index", lv)
    rgba = np.concatenate([lin, np.ones((len(lin), 1))], axis=1).astype(np.float32)
    layer.data.foreach_set("color", rgba[lv].ravel())
    me.materials.append(bpy.data.materials["Terrain"])
    ob = bpy.data.objects.new("Terrain", me)
    bb.link(ob, "Terrain")
    return ob


def water_material(name, emission=0.12, rough=0.12):
    if name in bpy.data.materials:
        return bpy.data.materials[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    vc = nt.nodes.new("ShaderNodeVertexColor")
    vc.layer_name = "Col"
    nt.links.new(vc.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Emission Color"].default_value = (1, 1, 1, 1)
    nt.links.new(vc.outputs["Color"], bsdf.inputs["Emission Color"])
    bsdf.inputs["Emission Strength"].default_value = emission
    return m


def build_water(land):
    """The sea: light turquoise in the shallows, deep blue far out."""
    fine_x = np.arange(-27.0, 27.0 + 1e-6, 0.35)
    fine_y = np.arange(-23.0, 24.0 + 1e-6, 0.35)
    xs = np.concatenate([[-140, -80, -50, -35], fine_x, [35, 50, 80, 140]])
    ys = np.concatenate([[-140, -80, -50, -32], fine_y, [32, 50, 80, 140]])
    X, Yg = np.meshgrid(xs, ys)
    D, _ = sdf_grid(X, Yg)
    shallow = np.array((0.52, 0.95, 0.90))
    mid = np.array((0.22, 0.80, 0.90))
    deep = np.array((0.09, 0.56, 0.90))
    far = np.array((0.06, 0.40, 0.82))
    d = np.clip(D, 0, None)
    col = shallow + (mid - shallow) * smoothstep(0.0, 1.8, d)[..., None]
    col = col + (deep - col) * smoothstep(1.5, 4.5, d)[..., None]
    col = col + (far - col) * smoothstep(5.0, 14.0, d)[..., None]
    # the lagoon reads a touch brighter than the open sea
    lag = smoothstep(16.0, 11.0, np.hypot(X / 1.25, Yg))
    col = col + (np.array((0.25, 0.85, 0.92)) - col) * (lag * 0.35)[..., None]
    ny, nx = X.shape
    verts = np.stack([X.ravel(), Yg.ravel(), np.full(X.size, WATER)], axis=1)
    ii, jj = np.meshgrid(np.arange(nx - 1), np.arange(ny - 1))
    a = (jj * nx + ii).ravel()
    faces = np.stack([a, a + 1, a + nx + 1, a + nx], axis=1)
    me = bpy.data.meshes.new("Water_yoshi")
    me.vertices.add(len(verts))
    me.vertices.foreach_set("co", verts.ravel())
    me.loops.add(faces.size)
    me.loops.foreach_set("vertex_index", faces.ravel())
    me.polygons.add(len(faces))
    me.polygons.foreach_set("loop_start", np.arange(0, faces.size, 4))
    me.polygons.foreach_set("loop_total", np.full(len(faces), 4))
    me.update(calc_edges=True)
    lin = np.where(col <= 0.04045, col / 12.92, ((col + 0.055) / 1.055) ** 2.4).reshape(-1, 3)
    layer = bb.vcol_layer(me)
    lv = np.zeros(len(me.loops), dtype=np.int32)
    me.loops.foreach_get("vertex_index", lv)
    rgba = np.concatenate([lin, np.ones((len(lin), 1))], axis=1).astype(np.float32)
    layer.data.foreach_set("color", rgba[lv].ravel())
    me.materials.append(water_material("Water lagoon"))
    bb.link(bpy.data.objects.new("Water", me), "Water")


def disc(r, seg=16):
    v = [(0, 0, 0)] + [(math.cos(TAU * i / seg) * r, math.sin(TAU * i / seg) * r, 0) for i in range(seg)]
    f = [(0, 1 + i, 1 + (i + 1) % seg) for i in range(seg)]
    return v, f


def ribbon(pts, width, z_edge=0.0):
    """A flat strip along points (x, y, z)."""
    pts = [Vector(p) for p in pts]
    v, f = [], []
    for i, p in enumerate(pts):
        t = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)])
        t.z = 0
        t.normalize()
        s = Vector((-t.y, t.x, 0)) * width / 2
        v += [tuple(p + s + Vector((0, 0, z_edge))), tuple(p - s + Vector((0, 0, z_edge)))]
    for i in range(len(pts) - 1):
        f.append((2 * i, 2 * i + 2, 2 * i + 3, 2 * i + 1))
    return v, f


def build_foam(land):
    """White surf round every shore, and broken wave lines further out."""
    mb = MB()
    rng = random.Random(5)
    for name, isl in Y.ISLANDS.items():
        n = int(TAU * max(isl["r"]) / 0.18)
        ph = rng.uniform(0, TAU)
        inner, outer, waves = [], [], []
        for i in range(n + 1):
            a = TAU * i / n
            r = Y.island_radius(isl, a)
            c = Vector((isl["c"][0], isl["c"][1], WATER + 0.02))
            u = Vector((math.cos(a), math.sin(a), 0))
            w = 0.30 + 0.10 * math.sin(a * 9 + ph) + 0.05 * math.sin(a * 23 + ph * 2)
            inner.append(c + u * (r - 0.12))
            outer.append(c + u * (r + w))
            waves.append((a, r, u, c))
        for i in range(n):
            q = len(mb.v)
            mb.v += [tuple(inner[i]), tuple(inner[i + 1]), tuple(outer[i + 1]), tuple(outer[i])]
            mb.col += [WHITE] * 4
            mb.f.append((q, q + 1, q + 2, q + 3))
            mb.sm.append(True)
        # broken wave lines: arcs that come and go
        for ring_off, thick in ((0.95, 0.10), (1.75, 0.08)):
            on = False
            for i in range(n):
                a, r, u, c = waves[i]
                a2, r2, u2, _ = waves[i + 1]
                lit = math.sin(a * (5 if ring_off < 1 else 7) + ph + ring_off * 3) > 0.15
                if not lit:
                    continue
                o1 = r + ring_off + 0.12 * math.sin(a * 11 + ph)
                o2 = r2 + ring_off + 0.12 * math.sin(a2 * 11 + ph)
                q = len(mb.v)
                mb.v += [tuple(c + u * o1), tuple(c + u2 * o2), tuple(c + u2 * (o2 + thick)), tuple(c + u * (o1 + thick))]
                mb.col += [WHITE] * 4
                mb.f.append((q, q + 1, q + 2, q + 3))
                mb.sm.append(True)
    # the pond and the stream get a foamy edge too
    px, py, pr = land.pond
    for i in range(40):
        a, b = TAU * i / 40, TAU * (i + 1) / 40
        q = len(mb.v)
        for (aa, rr) in ((a, pr - 0.15), (b, pr - 0.15), (b, pr - 0.45), (a, pr - 0.45)):
            mb.v.append((px + math.cos(aa) * rr, py + math.sin(aa) * rr, WATER + 0.02))
            mb.col.append(WHITE)
        mb.f.append((q, q + 1, q + 2, q + 3))
        mb.sm.append(True)
    me = mb.mesh("Foam_yoshi", "Foam")
    bb.link(bpy.data.objects.new("Foam", me), "Foam")


# ------------------------------------------------------------------ paths and bridges

def route_samples(land, curve, step=0.12):
    """Dense evenly spaced points along a curve, with the ground height under each."""
    pts = Y.resample(curve, max(2, int(Y.length(curve) / step)), closed=False)
    X = np.array([[p[0] for p in pts]])
    Yg = np.array([[p[1] for p in pts]])
    # the ground right under the path (hills flattened): tells land from water
    zb, _, _ = land.heights(X, Yg, pd=np.zeros(X.shape))
    return pts, zb[0]


def find_bridges(land):
    """Stretches of each route over water (or the stream), as lists of points."""
    spans = []
    for name, curve in land.curves.items():
        pts, z = route_samples(land, curve)
        wet = z < -0.04
        i = 0
        while i < len(pts):
            if not wet[i]:
                i += 1
                continue
            j = i
            while j < len(pts) and wet[j]:
                j += 1
            a, b = max(0, i - 4), min(len(pts) - 1, j + 3)
            if b - a > 4:
                spans.append((name, pts[a:b + 1]))
            i = j
    return spans


def build_paths(land):
    """Sandy paths on the land (bridges carry them over the water)."""
    mb = MB()
    lift = {"ring": 0.02, "egg": 0.024, "entry0": 0.028, "entry1": 0.032, "exit0": 0.036, "exit1": 0.04}
    width = 1.5
    for name, curve in land.curves.items():
        pts, z = route_samples(land, curve, step=0.15)
        on = [zz > -0.06 for zz in z]
        run = []
        for i, p in enumerate(pts + [None]):
            if p is not None and on[i]:
                run.append(p)
                continue
            if len(run) > 1:
                zl = lift.get(name, 0.02)
                body = [(x, y, zl) for x, y in run]
                # a soft darker rim, then the light centre
                mb.add(ribbon(body, width), colour=PATH_EDGE, smooth=True)
                mb.add(ribbon([(x, y, zl + 0.004) for x, y in run], width - 0.22), colour=PATH, smooth=True)
            run = []
    for s in land.spaces:
        x, y = s["p"]
        if land.height_noflat(x, y) > -0.06:
            mb.add(disc(1.0, 24), T((x, y, 0.045)), PATH_EDGE)
            mb.add(disc(0.86, 24), T((x, y, 0.049)), PATH)
    me = mb.mesh("Paths_yoshi", "Paths")
    bb.link(bpy.data.objects.new("Paths", me), "Paths")


def frames(pts):
    """(point, along, across) for a list of points."""
    pts = [Vector((p[0], p[1], 0)) for p in pts]
    out = []
    for i, p in enumerate(pts):
        t = pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]
        t.normalize()
        out.append((p, t, Vector((-t.y, t.x, 0))))
    return out


def along(pts, step):
    """Evenly spaced points along a polyline."""
    n = max(2, int(Y.length(pts) / step) + 1)
    return Y.resample(pts, n, closed=False)


def sag(a, b, droop, n=10):
    a, b = Vector(a), Vector(b)
    return [a.lerp(b, i / n) - Vector((0, 0, droop * math.sin(math.pi * i / n))) for i in range(n + 1)]


def bridge_plank(mb, pts, rng, half=0.9):
    for p, t, s in frames(along(pts, 0.25)):
        yaw = rng.uniform(-0.04, 0.04)
        c = mix(WOOD, WOOD_LIGHT, rng.uniform(0, 0.6))
        M = Matrix.Translation(p + Vector((0, 0, -0.045))) @ Matrix(((t.x, s.x, 0), (t.y, s.y, 0), (0, 0, 1))).to_4x4() @ Matrix.Rotation(yaw, 4, "Z")
        mb.add(rounded_box(0.21, half * 2, 0.09, 4, 4), M, c, smooth=False)
    fr = frames(along(pts, 0.4))
    for side in (-1, 1):
        beam = [tuple(p + s * side * (half - 0.08) + Vector((0, 0, -0.13))) for p, t, s in fr]
        mb.add(tube(beam, 0.07, 6), colour=WOOD_DARK)
    posts = frames(along(pts, 1.35))
    for side in (-1, 1):
        tops = []
        for p, t, s in posts:
            base = p + s * side * (half + 0.05)
            mb.add(cyl(8, 0.075, 0.07, 0.55 - WATER + 0.3), T(base + Vector((0, 0, WATER - 0.3))), WOOD_DARK)
            mb.add(sphere(8, 5), T(base + Vector((0, 0, 0.56)), scale=0.085), WOOD)
            tops.append(base + Vector((0, 0, 0.47)))
        for a, b in zip(tops, tops[1:]):
            mb.add(tube(sag(a, b, 0.07), 0.025, 5, caps=False), colour=ROPE)


def bridge_rope(mb, pts, rng, half=0.85):
    for p, t, s in frames(along(pts, 0.32)):
        c = mix(WOOD_LIGHT, WOOD, rng.uniform(0, 0.7))
        yaw = rng.uniform(-0.06, 0.06)
        M = Matrix.Translation(p + Vector((0, 0, -0.04))) @ Matrix(((t.x, s.x, 0), (t.y, s.y, 0), (0, 0, 1))).to_4x4() @ Matrix.Rotation(yaw, 4, "Z")
        mb.add(rounded_box(0.2, half * 2 - rng.uniform(0, 0.12), 0.07, 4, 4), M, c, smooth=False)
    fr = frames(along(pts, 0.3))
    for side in (-1, 1):
        under = [tuple(p + s * side * (half - 0.15) + Vector((0, 0, -0.1))) for p, t, s in fr]
        mb.add(tube(under, 0.03, 5), colour=ROPE)
    ends = [frames(pts)[0], frames(pts)[-1]]
    mids = frames(along(pts, max(2.0, Y.length(pts) / max(1, round(Y.length(pts) / 2.4)))))
    for side in (-1, 1):
        tops = []
        for k, (p, t, s) in enumerate(mids):
            tall = k == 0 or k == len(mids) - 1
            base = p + s * side * (half + 0.06)
            h = 0.75 if tall else 0.5
            mb.add(cyl(8, 0.09, 0.08, h - WATER + 0.3), T(base + Vector((0, 0, WATER - 0.3))), WOOD_DARK)
            mb.add(cyl(8, 0.1, 0.0, 0.12), T(base + Vector((0, 0, h))), WOOD)
            tops.append(base + Vector((0, 0, h - 0.08)))
        for a, b in zip(tops, tops[1:]):
            rail = sag(a, b, 0.22, 12)
            mb.add(tube(rail, 0.03, 5, caps=False), colour=ROPE)
            # hanging ropes from the rail to the deck edge
            for q in rail[2:-2:2]:
                low = Vector((q.x, q.y, -0.05))
                mb.add(tube([q, low], 0.014, 4, caps=False), colour=ROPE)


def bridge_log(mb, pts, rng, half=0.9):
    for p, t, s in frames(along(pts, 0.25)):
        r = 0.115
        M = Matrix.Translation(p + Vector((0, 0, -r))) @ Matrix(((t.x, s.x, 0), (t.y, s.y, 0), (0, 0, 1))).to_4x4()
        L = half * 2 + rng.uniform(-0.08, 0.12)
        # a log lying across the deck: bark round the sides, light rings on the cut ends
        across = M @ Matrix(((1, 0, 0), (0, 0, 1), (0, 1, 0))).to_4x4() @ Matrix.Translation((0, 0, -L / 2))
        mb.add(cyl(10, r, r, L, 1, caps=False), across, mix(WOOD_DARK, WOOD, rng.uniform(0.2, 0.7)))
        for z in (0.0, L):
            mb.add(disc(r, 10), across @ Matrix.Translation((0, 0, z)), WOOD_LIGHT)
            mb.add(torus(r * 0.55, 0.012, 12, 3), across @ Matrix.Translation((0, 0, z)), WOOD)
    # side rails: logs on stumps
    posts = frames(along(pts, 1.5))
    for side in (-1, 1):
        tops = []
        for p, t, s in posts:
            base = p + s * side * (half + 0.02)
            mb.add(cyl(9, 0.12, 0.11, 0.4 - WATER + 0.3), T(base + Vector((0, 0, WATER - 0.3))), WOOD_DARK)
            mb.add(cyl(9, 0.105, 0.105, 0.01), T(base + Vector((0, 0, 0.4))), WOOD_LIGHT)
            tops.append(base + Vector((0, 0, 0.36)))
        rail = [tops[0]] + tops[1:]
        if len(rail) > 1:
            mb.add(tube(rail, 0.07, 8), colour=WOOD)


def bridge_stone(mb, pts, rng, half=0.95):
    L = Y.length(pts)
    n_arch = max(1, round(L / 3.0))
    fr = frames(along(pts, 0.2))
    total = len(fr) - 1
    prof = []
    for i, (p, t, s) in enumerate(fr):
        u = i / total * n_arch
        k = u - math.floor(u)
        # arch underside: high in the middle of each arch, down to the water at the piers
        arch = math.sqrt(max(0.0, 1 - (2 * k - 1) ** 2))
        bottom = WATER - 0.3 + arch * (-0.22 - (WATER - 0.3))
        prof.append((p, s, bottom))
    # the body: a solid strip with the arch cut into its underside
    v, f = [], []
    for p, s, bottom in prof:
        for side in (-1, 1):
            v.append(tuple(p + s * side * half + Vector((0, 0, bottom))))
            v.append(tuple(p + s * side * half + Vector((0, 0, -0.02))))
    for i in range(len(prof) - 1):
        a, b = 4 * i, 4 * (i + 1)
        f += [(a, b, b + 1, a + 1), (a + 3, b + 3, b + 2, a + 2), (a + 1, b + 1, b + 3, a + 3), (a, a + 2, b + 2, b)]
    f += [(0, 1, 3, 2), (4 * total, 4 * total + 2, 4 * total + 3, 4 * total + 1)]
    mb.add((v, f), colour=lambda q: STONE_DARK if q[2] < -0.3 else STONE, smooth=False)
    # a paved top
    for p, t, s in frames(along(pts, 0.42)):
        M = Matrix.Translation(p + Vector((0, 0, -0.01))) @ Matrix(((t.x, s.x, 0), (t.y, s.y, 0), (0, 0, 1))).to_4x4()
        mb.add(rounded_box(0.38, half * 2 - 0.02, 0.06, 4, 4), M, mix(STONE, WHITE, rng.uniform(0, 0.5)), smooth=False)
    # low parapets of rounded blocks, and a lamp-less ball on each end
    for side in (-1, 1):
        blocks = frames(along(pts, 0.5))
        for k, (p, t, s) in enumerate(blocks):
            M = Matrix.Translation(p + s * side * (half - 0.1) + Vector((0, 0, 0.12))) @ Matrix(((t.x, s.x, 0), (t.y, s.y, 0), (0, 0, 1))).to_4x4()
            mb.add(rounded_box(0.46, 0.2, 0.28, 4, 4), M, STONE if k % 2 else STONE_DARK)
        for p, t, s in (blocks[0], blocks[-1]):
            mb.add(cyl(10, 0.17, 0.17, 0.4), T(p + s * side * (half - 0.1)), STONE_DARK)
            mb.add(sphere(10, 7), T(p + s * side * (half - 0.1) + Vector((0, 0, 0.52)), scale=0.15), WHITE)


STYLES = {"plank": bridge_plank, "rope": bridge_rope, "log": bridge_log, "stone": bridge_stone}
SHORTCUT_STYLE = {"entry0": "stone", "entry1": "rope", "exit0": "plank", "exit1": "log"}
RING_STYLES = ["plank", "rope", "log", "plank", "rope", "log", "plank", "rope", "log"]


def build_bridges(land):
    spans = find_bridges(land)
    rng = random.Random(3)
    ring_k = 0
    for k, (route, pts) in enumerate(spans):
        mid = pts[len(pts) // 2]
        d, isl = Y.land_sdf(*mid)
        if d < 0 and isl == "cliff":
            style = "stone"
        elif route in SHORTCUT_STYLE:
            style = SHORTCUT_STYLE[route]
        else:
            style = RING_STYLES[ring_k % len(RING_STYLES)]
            ring_k += 1
        mb = MB()
        STYLES[style](mb, pts, rng)
        me = mb.mesh(f"Bridge_{k}_{style}", "Wood")
        bb.link(bpy.data.objects.new(f"Bridge {k} {style}", me), "Bridges")
    return spans


# ------------------------------------------------------------------ props (kit meshes)

KITS_BUILT = set()


def kit(name, build_fn):
    if name in KITS_BUILT and name in bpy.data.meshes:
        return bpy.data.meshes[name]
    KITS_BUILT.add(name)
    if name in bpy.data.meshes:
        bpy.data.meshes.remove(bpy.data.meshes[name])
    mb = MB()
    build_fn(mb)
    return mb.mesh(name)


def frond(mb, base, ang, length, rise, droop, width, rng, leaflets=13, M=None):
    """A palm frond: a drooping rib with leaflets down both sides."""
    d = Vector((math.cos(ang), math.sin(ang), 0))
    side = Vector((-d.y, d.x, 0))

    def rib(u):
        return base + d * (length * u) + Vector((0, 0, rise * math.sin(math.pi * u * 0.8) - droop * u * u))
    pts = [rib(i / 12) for i in range(13)]
    mb.add(tube(pts, [0.035 * (1 - i / 13) + 0.008 for i in range(13)], 4, caps=False), M, (0.42, 0.62, 0.22))
    for k in range(leaflets):
        u0 = 0.08 + 0.88 * k / leaflets
        u1 = u0 + 0.9 / leaflets
        w = width * math.sin(math.pi * min(1, u0 + 0.05)) ** 0.6 + 0.05
        for sgn in (-1, 1):
            a = rib(u0)
            b = rib(u1)
            tip = rib(min(1, u1 + 0.07)) + side * sgn * w - Vector((0, 0, 0.12 + 0.18 * w))
            c0 = mix(LEAF, LEAF_LIGHT, u0 * 0.8 + rng.uniform(-0.1, 0.1))
            c1 = mix(LEAF, LEAF_LIGHT, min(1, u0 + 0.35))
            q = len(mb.v)
            for p, c in ((a, c0), (b, c0), (tip, c1)):
                mb.v.append(tuple(M @ p) if M is not None else tuple(p))
                mb.col.append(c)
            mb.f.append((q, q + 1, q + 2))
            mb.sm.append(False)


def palm(variant):
    rng = random.Random(40 + variant)
    h = (3.1, 3.7, 4.3, 2.6)[variant]
    lean = (0.9, 1.3, 0.6, 1.0)[variant]

    def build(mb):
        # trunk: a curving stack of ridged segments
        n = 11
        pts = []
        for i in range(n + 1):
            u = i / n
            pts.append(Vector((lean * u * u, 0, h * u)))
        for i in range(n):
            a, b = pts[i], pts[i + 1]
            r0 = 0.2 - 0.08 * i / n
            r1 = 0.2 - 0.08 * (i + 1) / n
            seg = tube([a, a.lerp(b, 0.75), b], [r0 * 1.12, r0 * 0.98, r1 * 0.9], 10, caps=True)
            mb.add(seg, colour=TRUNK_A if i % 2 else TRUNK_B)
        top = pts[-1]
        # a tuft where the fronds come out
        mb.add(sphere(10, 7), T(top + Vector((0, 0, 0.05)), scale=(0.22, 0.22, 0.17)), (0.45, 0.62, 0.24))
        fr = 9
        for k in range(fr):
            ang = TAU * k / fr + rng.uniform(-0.15, 0.15)
            L = rng.uniform(1.7, 2.2)
            frond(mb, top + Vector((0, 0, 0.08)), ang, L, rng.uniform(0.35, 0.55), rng.uniform(1.1, 1.5), rng.uniform(0.42, 0.52), rng)
        # a few short fronds sticking up in the middle
        for k in range(4):
            ang = TAU * k / 4 + 0.4
            frond(mb, top + Vector((0, 0, 0.1)), ang, 1.0, 0.7, 0.5, 0.3, rng, 8)
        for k in range(4 if variant != 3 else 3):
            a = TAU * k / 4 + rng.uniform(-0.3, 0.3)
            c = (0.48, 0.32, 0.17) if (k + variant) % 3 else (0.50, 0.66, 0.22)
            mb.add(sphere(10, 7), T(top + Vector((math.cos(a) * 0.2, math.sin(a) * 0.2, -0.15)), scale=0.14), c)
    return kit(f"Kit_palm_{variant}", build), h, lean


def fruit_tree(kind):
    """A round fruit tree: apples dotted over the canopy, or melons hanging under it."""
    rng = random.Random(70 + kind)

    def build(mb):
        mb.add(cyl(10, 0.2, 0.13, 1.5, 3), colour=TRUNK_A)
        for a in (0.6, 2.8, 4.6):
            mb.add(tube([(0, 0, 1.1), (math.cos(a) * 0.5, math.sin(a) * 0.5, 1.7)], [0.09, 0.05], 6), colour=TRUNK_A)
        blobs = [((0, 0, 2.2), 1.15)] + [((math.cos(a) * 0.75, math.sin(a) * 0.75, 1.95 + rng.uniform(-0.1, 0.25)), rng.uniform(0.7, 0.85)) for a in np.linspace(0, TAU, 6, endpoint=False) + rng.uniform(0, 1)]
        blobs.append(((0, 0, 2.85), 0.75))
        for c, r in blobs:
            mb.add(blob(rng.random() * 10, 14, 9, 0.08), T(c, scale=r), lambda p: mix(LEAF, LEAF_LIGHT, 0.35 + 0.55 * max(0, p[2])))
        if kind == 0:
            # apples on the outside of the canopy
            for k in range(16):
                a = rng.uniform(0, TAU)
                el = rng.uniform(-0.5, 0.7)
                c, r = blobs[0]
                p = Vector((math.cos(a) * math.cos(el), math.sin(a) * math.cos(el), math.sin(el))) * (r * 1.06 + 0.3) + Vector(c)
                p.z = max(p.z, 1.6)
                mb.add(sphere(10, 7), T(p, scale=0.15), (0.95, 0.20, 0.22))
                mb.add(cyl(4, 0.015, 0.015, 0.08), T(p + Vector((0, 0, 0.13))), (0.35, 0.25, 0.1))
                mb.add(sphere(6, 4), T(p + Vector((0.05, 0, 0.2)), scale=(0.07, 0.035, 0.02)), LEAF)
        else:
            # melons hanging below
            for k in range(5):
                a = TAU * k / 5 + rng.uniform(-0.2, 0.2)
                hang = Vector((math.cos(a) * 0.95, math.sin(a) * 0.95, 1.55))
                mb.add(tube([hang + Vector((0, 0, 0.45)), hang + Vector((0, 0, 0.12))], 0.02, 4), colour=(0.30, 0.50, 0.15))
                mel = sphere(14, 9)
                mb.add(mel, T(hang - Vector((0, 0, 0.12)), (0.2, 0, a), (0.26, 0.24, 0.3)),
                       lambda p: (0.20, 0.55, 0.18) if math.sin(math.atan2(p[1], p[0]) * 7) > 0.25 else (0.55, 0.85, 0.35))
    return kit(f"Kit_fruit_tree_{kind}", build)


def banana_plant(variant):
    rng = random.Random(90 + variant)

    def build(mb):
        mb.add(cyl(8, 0.12, 0.09, 0.8), colour=(0.45, 0.62, 0.25))
        n = 6 + variant
        for k in range(n):
            a = TAU * k / n + rng.uniform(-0.2, 0.2)
            d = Vector((math.cos(a), math.sin(a), 0))
            s = Vector((-d.y, d.x, 0))
            L = rng.uniform(1.1, 1.5)
            v, f = [], []
            for i in range(9):
                u = i / 8
                c = Vector((0, 0, 0.7)) + d * (L * u) + Vector((0, 0, 0.9 * math.sin(math.pi * u * 0.6) - 0.6 * u * u))
                w = 0.32 * math.sin(math.pi * min(1, u * 1.05)) ** 0.7
                v += [tuple(c + s * w - Vector((0, 0, w * 0.25))), tuple(c), tuple(c - s * w - Vector((0, 0, w * 0.25)))]
            for i in range(8):
                a0 = 3 * i
                f += [(a0, a0 + 3, a0 + 4, a0 + 1), (a0 + 1, a0 + 4, a0 + 5, a0 + 2)]
            mb.add((v, f), colour=lambda p: mix(LEAF, LEAF_LIGHT, min(1, max(0, p[2] - 0.4))), smooth=True)
    return kit(f"Kit_banana_{variant}", build)


def fern():
    rng = random.Random(95)

    def build(mb):
        for k in range(9):
            frond(mb, Vector((0, 0, 0.05)), TAU * k / 9 + rng.uniform(-0.2, 0.2), rng.uniform(0.7, 0.9), 0.45, 0.55, 0.2, rng, 9)
    return kit("Kit_fern", build)


def round_bush(variant, flowers):
    rng = random.Random(100 + variant)

    def build(mb):
        parts = [((0, 0, 0.35), 0.5), ((0.35, 0.1, 0.25), 0.38), ((-0.3, 0.15, 0.25), 0.36), ((0.05, -0.25, 0.22), 0.34)]
        for c, r in parts:
            mb.add(blob(rng.random() * 9, 12, 8, 0.1), T(c, scale=r), lambda p: mix(LEAF, LEAF_LIGHT, 0.3 + 0.5 * max(0, p[2])))
        if flowers:
            col = FLOWER_COLOURS[variant % len(FLOWER_COLOURS)]
            for k in range(7):
                a = rng.uniform(0, TAU)
                el = rng.uniform(0.0, 1.0)
                c, r = parts[k % len(parts)]
                n = Vector((math.cos(a) * math.cos(el), math.sin(a) * math.cos(el), math.sin(el)))
                p = Vector(c) + n * r * 1.02
                hibiscus(mb, p, n, 0.14, col)
    return kit(f"Kit_tbush_{variant}_{int(flowers)}", build)


def hibiscus(mb, p, n, size, col):
    """Five round petals and a yellow centre, facing along n."""
    rot = Vector((0, 0, 1)).rotation_difference(n).to_matrix().to_4x4()
    for k in range(5):
        a = TAU * k / 5
        M = Matrix.Translation(p) @ rot @ Matrix.Translation((math.cos(a) * size * 0.75, math.sin(a) * size * 0.75, 0.02)) @ Matrix.Rotation(a, 4, "Z") @ Matrix.Diagonal((size * 0.8, size * 0.55, size * 0.18, 1))
        mb.add(sphere(8, 5), M, col)
    mb.add(sphere(6, 4), Matrix.Translation(p) @ rot @ T((0, 0, size * 0.2), scale=size * 0.3), (1.0, 0.92, 0.4))


def smiley_flower(variant):
    """A Yoshi's Island flower: coloured petals round a face."""
    rng = random.Random(120 + variant)

    def build(mb):
        h = 0.9 + 0.15 * variant
        stem = [Vector((0, 0, 0)), Vector((0.05, 0, h * 0.5)), Vector((0, 0.05, h))]
        mb.add(tube(stem, 0.05, 6), colour=(0.30, 0.68, 0.25))
        for a, z in ((0.3, 0.25), (3.4, 0.45)):
            d = Vector((math.cos(a), math.sin(a), 0.35))
            mb.add(sphere(10, 6), T(Vector((0, 0, h * z)) + d * 0.22, (0.3, 0, a), (0.3, 0.12, 0.04)), LEAF_LIGHT)
        head = Vector((0, 0.05, h + 0.05))
        tilt = Matrix.Rotation(-1.1, 4, "X")   # face the camera (towards -y), a bit upwards
        petals = [FLOWER_COLOURS[(variant + k) % len(FLOWER_COLOURS)] for k in range(5)] if variant % 2 else [FLOWER_COLOURS[variant % 3]] * 5
        for k in range(5):
            a = TAU * k / 5 + math.pi / 2
            M = Matrix.Translation(head) @ tilt @ Matrix.Translation((math.cos(a) * 0.27, math.sin(a) * 0.27, 0)) @ Matrix.Rotation(a, 4, "Z") @ Matrix.Diagonal((0.2, 0.16, 0.07, 1))
            mb.add(sphere(10, 6), M, petals[k])
        mb.add(sphere(14, 8), Matrix.Translation(head) @ tilt @ T((0, 0, 0.04), scale=(0.2, 0.2, 0.08)), (1.0, 0.95, 0.75))
        for sx in (-1, 1):
            mb.add(sphere(8, 6), Matrix.Translation(head) @ tilt @ T((sx * 0.065, 0.03, 0.1), scale=(0.03, 0.05, 0.02)), BLACK)
            mb.add(sphere(6, 4), Matrix.Translation(head) @ tilt @ T((sx * 0.12, -0.04, 0.09), scale=(0.035, 0.025, 0.01)), (1.0, 0.55, 0.6))
        smile = [Matrix.Translation(head) @ tilt @ Vector((math.cos(a) * 0.07, -0.02 + math.sin(a) * 0.05, 0.11)) for a in np.linspace(math.pi * 1.15, math.pi * 1.85, 6)]
        mb.add(tube(smile, 0.012, 4), colour=BLACK)
    return kit(f"Kit_smiley_{variant}", build)


def egg_point(R, H, q):
    """A unit direction on the egg's sphere -> the point on the egg's surface."""
    k = 1 - 0.13 * q.z
    return Vector((q.x * R * k, q.y * R * k, (q.z + 1) / 2 * H))


def egg_parts(mb, R, H, spots, spot_col, seg=40, rings=28, M=None):
    """A white egg plus its spots, each spot a separate cap sitting just off the shell
    so the edges stay round and crisp."""
    v, f = sphere(seg, rings)
    mb.add(([tuple(egg_point(R, H, Vector(p))) for p in v], f), M, WHITE)
    for k, (d, r) in enumerate(spots):
        d = Vector(d).normalized()
        a = d.orthogonal().normalized()
        b = d.cross(a)
        rings_s, segs = 5, max(16, int(seg * 0.6))
        verts = [tuple(egg_point(R, H, d) * 1.0 + egg_point(R, H, d).normalized() * 0)]
        lift = 0.004 + 0.006 * R * (1 + k * 0.15)
        pts = [d]
        for i in range(1, rings_s + 1):
            ang = r * i / rings_s
            for j in range(segs):
                t = TAU * j / segs
                pts.append((d * math.cos(ang) + (a * math.cos(t) + b * math.sin(t)) * math.sin(ang)).normalized())
        verts = []
        for q in pts:
            p = egg_point(R, H, q)
            n = Vector((p.x / (R * R), p.y / (R * R), (p.z - H / 2) / (H * H / 4))).normalized()
            verts.append(tuple(p + n * lift))
        faces = [(0, 1 + j, 1 + (j + 1) % segs) for j in range(segs)]
        for i in range(rings_s - 1):
            a0, b0 = 1 + i * segs, 1 + (i + 1) * segs
            faces += [(a0 + j, b0 + j, b0 + (j + 1) % segs, a0 + (j + 1) % segs) for j in range(segs)]
        mb.add((verts, faces), M, spot_col)


FAN_EGGS = ["Kit_yegg_green", "Kit_yegg_blue", "Kit_yegg_pink", "Kit_yegg_yellow"]


def small_eggs():
    """The little eggs dotted round the islands: Yanez-Designs' fan-made Yoshi eggs from
    Sketchfab (CC BY 4.0, credit in docs/CREDITS.md), appended from art/yoshi-eggs.blend.
    Falls back to code-built eggs if that file is missing."""
    path = os.path.join(REPO, "art", "yoshi-eggs.blend")
    if os.path.exists(path):
        missing = [n for n in FAN_EGGS if n not in bpy.data.meshes]
        if missing:
            with bpy.data.libraries.load(path, link=False) as (src, dst):
                dst.meshes = missing
        # green is the classic: give it two goes in the draw
        return [bpy.data.meshes[n] for n in FAN_EGGS + FAN_EGGS[:1]]
    return [egg_kit(f"Kit_egg_{k}", c, seed=k) for k, c in enumerate([EGG_GREEN, (0.95, 0.30, 0.35), (0.35, 0.60, 1.0), (1.0, 0.80, 0.2), (1.0, 0.55, 0.75)])]


def egg_kit(name, spot_col, R=0.3, H=0.75, seed=1, seg=24, rings=16):
    rng = random.Random(seed)
    spots = [((rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(-0.6, 0.9)), rng.uniform(0.22, 0.34)) for _ in range(7)]

    def build(mb):
        egg_parts(mb, R, H, spots, spot_col, seg, rings)
    return kit(name, build)


def giant_egg():
    """The centrepiece: a huge white egg with big green spots."""
    spots = [((0.0, -1.0, 0.35), 0.38), ((-0.75, -0.55, -0.35), 0.33), ((0.7, -0.6, -0.25), 0.3), ((0.15, -0.75, -0.75), 0.24),
             ((-0.45, -0.5, 0.85), 0.27), ((0.6, -0.3, 0.65), 0.22), ((1.0, 0.2, 0.1), 0.34), ((-1.0, 0.25, 0.2), 0.33),
             ((0.2, 1.0, 0.0), 0.4), ((-0.3, 0.6, 0.9), 0.3), ((0.6, 0.6, -0.6), 0.28), ((-0.6, 0.7, -0.55), 0.3), ((0, 0, 1), 0.22)]

    def build(mb):
        egg_parts(mb, 2.3, 5.8, spots, EGG_GREEN, 72, 48)
    return kit("Kit_egg_giant", build)


def rock_kit(variant):
    rng = random.Random(130 + variant)

    def build(mb):
        mb.add(blob(variant * 3.3 + 1, 14, 9, 0.22), T((0, 0, 0.18), scale=(0.55, 0.45, 0.42)),
               lambda p: mix(ROCK_DARK, ROCK, 0.25 + 0.75 * max(0, p[2])))
        if variant % 2:
            mb.add(blob(variant * 1.1 + 5, 10, 7, 0.2), T((0.45, 0.2, 0.08), scale=(0.3, 0.28, 0.22)), lambda p: mix(ROCK_DARK, ROCK, 0.25 + 0.75 * max(0, p[2])))
        # a cap of moss on some
        if variant in (0, 3):
            mb.add(blob(variant + 9, 12, 6, 0.15), T((0.02, 0, 0.42), scale=(0.36, 0.3, 0.12)), mix(GRASS, GRASS_LIGHT, 0.5))
    return kit(f"Kit_trock_{variant}", build)


def sea_rock_kit(variant):
    def build(mb):
        mb.add(blob(variant * 2.7 + 3, 14, 9, 0.25), T((0, 0, WATER + 0.05), scale=(0.9, 0.75, 0.75)),
               lambda p: mix(ROCK_DARK, ROCK, 0.15 + 0.85 * max(0, p[2])))
        mb.add(blob(variant * 1.9 + 7, 10, 7, 0.25), T((0.75, 0.3, WATER), scale=(0.45, 0.4, 0.4)), lambda p: mix(ROCK_DARK, ROCK, 0.15 + 0.85 * max(0, p[2])))
        if variant == 1:
            mb.add(blob(4, 12, 6, 0.15), T((0, 0, WATER + 0.72), scale=(0.5, 0.42, 0.14)), mix(GRASS, GRASS_LIGHT, 0.5))
        # foam hugging the rock
        mb.add(torus(0.9, 0.07, 24, 5), T((0.1, 0.05, WATER + 0.01), scale=(1.05, 0.9, 0.3)), WHITE)
    return kit(f"Kit_searock_{variant}", build)


def umbrella_kit(variant):
    cols = [((1.0, 0.36, 0.42), WHITE), ((0.35, 0.72, 1.0), WHITE), ((1.0, 0.80, 0.25), (1.0, 0.45, 0.30))][variant]

    def build(mb):
        mb.add(cyl(6, 0.035, 0.035, 2.0), T((0, 0, 0), (0.12, 0, 0)), WHITE)
        top = Vector((0, -0.24, 1.98))
        n = 12
        # separate wedges so the stripes stay crisp
        for i in range(n * 2):
            a0, a1 = TAU * i / (n * 2), TAU * (i + 1) / (n * 2)
            tri = [tuple(top + Vector((0, 0, 0.05))), tuple(top + Vector((math.cos(a0) * 1.15, math.sin(a0) * 1.15, -0.42))),
                   tuple(top + Vector((math.cos(a1) * 1.15, math.sin(a1) * 1.15, -0.42)))]
            mb.add((tri, [(0, 1, 2)]), colour=cols[(i // 2) % 2], smooth=False)
        mb.add(sphere(6, 4), T(top + Vector((0, 0, 0.08)), scale=0.06), cols[0])
        # a towel underneath
        mb.add(box((-0.45, -1.1, 0.0), (0.45, 0.4, 0.03)), colour=cols[0] if variant != 1 else (0.98, 0.6, 0.75), smooth=False)
        for k in range(3):
            y0 = -1.0 + k * 0.5
            mb.add(box((-0.46, y0, 0.0), (0.46, y0 + 0.12, 0.032)), colour=WHITE, smooth=False)
    return kit(f"Kit_umbrella_{variant}", build)


def beach_ball_kit():
    def build(mb):
        cols = [(1.0, 0.3, 0.3), WHITE, (0.3, 0.6, 1.0), WHITE, (1.0, 0.85, 0.25), WHITE]
        mb.add(sphere(18, 12), T((0, 0, 0.25), scale=0.25), lambda p: cols[int(((math.atan2(p[1], p[0]) + math.pi) / TAU) * 6) % 6])
    return kit("Kit_beach_ball", build)


def sandcastle_kit():
    def build(mb):
        c = (0.97, 0.84, 0.58)
        mb.add(cyl(14, 0.62, 0.55, 0.42), colour=c)
        for a in range(4):
            ang = TAU * a / 4 + 0.4
            p = (math.cos(ang) * 0.55, math.sin(ang) * 0.55, 0)
            mb.add(cyl(10, 0.2, 0.18, 0.62), T(p), c)
            mb.add(cyl(10, 0.2, 0.0, 0.25), T((p[0], p[1], 0.62)), (0.94, 0.78, 0.5))
        mb.add(cyl(12, 0.3, 0.27, 0.85), colour=c)
        mb.add(cyl(12, 0.3, 0.0, 0.35), T((0, 0, 0.85)), (0.94, 0.78, 0.5))
        mb.add(tube([(0, 0, 1.15), (0, 0, 1.45)], 0.012, 4), colour=WHITE)
        mb.add(((((0, 0, 1.45), (0.22, 0.02, 1.38), (0, 0, 1.3))), [(0, 1, 2)]), colour=(1.0, 0.3, 0.35), smooth=False)
        mb.add(box((-0.14, -0.58, 0), (0.14, -0.5, 0.25)), colour=(0.7, 0.55, 0.38), smooth=False)
    return kit("Kit_sandcastle", build)


def starfish_kit(col):
    def build(mb):
        v = [(0, 0, 0.06)]
        for i in range(10):
            a = TAU * i / 10 + math.pi / 2
            r = 0.26 if i % 2 == 0 else 0.1
            v.append((math.cos(a) * r, math.sin(a) * r, 0.02))
        f = [(0, 1 + i, 1 + (i + 1) % 10) for i in range(10)]
        mb.add((v, f), colour=col, smooth=False)
    return kit(f"Kit_starfish_{int(col[1] * 10)}", build)


def shell_kit():
    def build(mb):
        v = [(0, -0.1, 0.02)]
        for i in range(9):
            a = math.pi * 0.15 + math.pi * 0.7 * i / 8
            v.append((math.cos(a) * 0.16, math.sin(a) * 0.16 - 0.1, 0.02 + 0.05 * math.sin(math.pi * i / 8)))
        f = [(0, 1 + i, 2 + i) for i in range(8)]
        mb.add((v, f), colour=lambda p: (1.0, 0.82, 0.80) if int((math.atan2(p[1] + 0.1, p[0])) * 9) % 2 else (1.0, 0.92, 0.88), smooth=False)
    return kit("Kit_shell", build)


def tiki_torch_kit():
    def build(mb):
        mb.add(cyl(6, 0.05, 0.04, 1.3), colour=(0.55, 0.38, 0.2))
        for z in (0.3, 0.7):
            mb.add(cyl(8, 0.065, 0.065, 0.05), T((0, 0, z)), (0.40, 0.26, 0.14))
        mb.add(cyl(10, 0.09, 0.13, 0.28), T((0, 0, 1.25)), (0.82, 0.62, 0.36))
    flame = MB()
    flame.add(sphere(8, 6), T((0, 0, 1.6), scale=(0.1, 0.1, 0.17)), (1.0, 0.7, 0.2))
    me = flame.mesh("Kit_tiki_flame", bb.glow_material().name)
    return kit("Kit_tiki_torch", build), me


def hammock_kit(span):
    def build(mb):
        pts = sag((-span / 2, 0, 1.1), (span / 2, 0, 1.1), 0.55, 14)
        v, f = [], []
        for i, p in enumerate(pts):
            w = 0.35 * math.sin(math.pi * i / 14) ** 0.5 + 0.03
            v += [(p.x, -w, p.z + w * 0.4), (p.x, 0, p.z), (p.x, w, p.z + w * 0.4)]
        for i in range(14):
            a = 3 * i
            f += [(a, a + 3, a + 4, a + 1), (a + 1, a + 4, a + 5, a + 2)]
        mb.add((v, f), colour=lambda p: (1.0, 0.45, 0.5) if int((p[0] + span) * 3) % 2 else (1.0, 0.86, 0.4))
    return kit("Kit_hammock", build)


def crate_kit():
    def build(mb):
        mb.add(rounded_box(0.6, 0.6, 0.55), T((0, 0, 0.275)), WOOD_LIGHT)
        for z in (0.1, 0.45):
            mb.add(box((-0.31, -0.31, z - 0.04), (0.31, 0.31, z + 0.04)), colour=WOOD_DARK, smooth=False)
        for k in range(4):
            a = TAU * k / 4 + 0.5
            mb.add(sphere(10, 7), T((math.cos(a) * 0.14, math.sin(a) * 0.14, 0.62), scale=0.13), (0.95, 0.22, 0.25) if k % 2 else (1.0, 0.6, 0.2))
    return kit("Kit_crate", build)


def barrel_kit():
    def build(mb):
        prof = [(0.0, 0.25), (0.15, 0.29), (0.35, 0.31), (0.55, 0.29), (0.7, 0.25)]
        v, f = [], []
        for z, r in prof:
            for i in range(14):
                a = TAU * i / 14
                v.append((math.cos(a) * r, math.sin(a) * r, z))
        for k in range(len(prof) - 1):
            a, b = 14 * k, 14 * (k + 1)
            f += [(a + i, a + (i + 1) % 14, b + (i + 1) % 14, b + i) for i in range(14)]
        f.append(tuple(reversed(range(14))))
        f.append(tuple(range(14 * (len(prof) - 1), 14 * len(prof))))
        mb.add((v, f), colour=lambda p: WOOD_DARK if abs(p[2] - 0.15) < 0.01 or abs(p[2] - 0.55) < 0.01 else WOOD)
    return kit("Kit_barrel", build)


def melon_patch_kit():
    rng = random.Random(150)

    def build(mb):
        for k in range(5):
            a = TAU * k / 5 + rng.uniform(-0.3, 0.3)
            r = rng.uniform(0.25, 0.6)
            p = (math.cos(a) * r, math.sin(a) * r, 0.17)
            mb.add(sphere(14, 9), T(p, (0, 0, a), (0.3, 0.24, 0.2)),
                   lambda q: (0.20, 0.55, 0.18) if math.sin(math.atan2(q[2], q[1]) * 6) > 0.2 else (0.55, 0.85, 0.35))
            for j in range(2):
                b = a + rng.uniform(-1.2, 1.2)
                mb.add(sphere(8, 5), T((p[0] + math.cos(b) * 0.3, p[1] + math.sin(b) * 0.3, 0.04), (0, 0, b), (0.22, 0.14, 0.03)), LEAF)
        vine = [(math.cos(t) * (0.2 + t * 0.08), math.sin(t) * (0.2 + t * 0.08), 0.03) for t in np.linspace(0, 9, 30)]
        mb.add(tube(vine, 0.02, 4), colour=(0.30, 0.6, 0.2))
    return kit("Kit_melon_patch", build)


def nest_kit():
    """A ring of big leaves and straw the giant egg sits in."""
    rng = random.Random(160)

    def build(mb):
        mb.add(torus(2.0, 0.45, 36, 10), T((0, 0, 0.12), scale=(1, 1, 0.55)), lambda p: mix((0.93, 0.78, 0.45), (0.85, 0.66, 0.36), 0.5 + 0.5 * math.sin(math.atan2(p[1], p[0]) * 23)))
        for k in range(14):
            a = TAU * k / 14 + rng.uniform(-0.1, 0.1)
            d = Vector((math.cos(a), math.sin(a), 0))
            s = Vector((-d.y, d.x, 0))
            v, f = [], []
            L = rng.uniform(1.3, 1.7)
            for i in range(8):
                u = i / 7
                c = d * (1.9 + L * u) + Vector((0, 0, 0.3 + 0.35 * math.sin(math.pi * u * 0.8) - 0.4 * u * u))
                w = 0.42 * math.sin(math.pi * min(1, u * 1.05)) ** 0.6
                v += [tuple(c + s * w - Vector((0, 0, 0.08 * w))), tuple(c + Vector((0, 0, 0.05))), tuple(c - s * w - Vector((0, 0, 0.08 * w)))]
            for i in range(7):
                q = 3 * i
                f += [(q, q + 3, q + 4, q + 1), (q + 1, q + 4, q + 5, q + 2)]
            col = mix(LEAF, LEAF_LIGHT, rng.uniform(0.2, 0.7))
            mb.add((v, f), colour=lambda p, col=col: mix(col, LEAF_LIGHT, 0.2), smooth=True)
    return kit("Kit_nest", build)


def cloud_kit(variant):
    rng = random.Random(170 + variant)

    def build(mb):
        puffs = [((0, 0, 0), 1.0)] + [((rng.uniform(-1.6, 1.6), rng.uniform(-0.6, 0.6), rng.uniform(-0.2, 0.3)), rng.uniform(0.55, 0.85)) for _ in range(5)]
        for c, r in puffs:
            mb.add(sphere(16, 10), T(c, scale=(r, r, r * 0.8)), lambda p: mix((0.86, 0.92, 1.0), WHITE, 0.5 + 0.5 * p[2]))
    return kit(f"Kit_tcloud_{variant}", build)


def hut_kit(shop_colour=None):
    """A round hut on stilts: bamboo walls, a thatched roof."""
    def build(mb):
        mb.add(cyl(18, 1.3, 1.3, 0.12), T((0, 0, 0)), WOOD)
        for k in range(26):
            a = TAU * k / 26
            mb.add(cyl(6, 0.09, 0.09, 1.25), T((math.cos(a) * 1.0, math.sin(a) * 1.0, 0.1)), mix((0.86, 0.78, 0.45), (0.74, 0.66, 0.36), k % 2))
        mb.add(box((-0.35, -1.12, 0.1), (0.35, -0.9, 1.0)), colour=(0.35, 0.22, 0.12), smooth=False)
        mb.add(cyl(18, 1.15, 1.15, 0.1), T((0, 0, 1.3)), (0.74, 0.66, 0.36))
        straw = lambda p: mix((0.96, 0.84, 0.50), (0.84, 0.66, 0.36), 0.5 + 0.5 * math.sin(math.atan2(p[1], p[0]) * 40))
        mb.add(cyl(40, 1.85, 0.05, 1.45, 4, caps=True), T((0, 0, 1.3)), straw)
        # a ragged fringe round the eaves
        v, f = [], []
        n = 48
        for i in range(n):
            a = TAU * i / n
            drop = 0.28 if i % 2 else 0.18
            v += [(math.cos(a) * 1.82, math.sin(a) * 1.82, 1.32), (math.cos(a) * 1.95, math.sin(a) * 1.95, 1.32 - drop)]
        for i in range(n):
            j = (i + 1) % n
            f.append((2 * i, 2 * j, 2 * j + 1, 2 * i + 1))
        mb.add((v, f), colour=(0.86, 0.70, 0.40), smooth=False)
        mb.add(torus(1.0, 0.06, 24, 6), T((0, 0, 2.05), scale=(0.62, 0.62, 1)), (0.62, 0.42, 0.22))
        mb.add(sphere(8, 5), T((0, 0, 2.78), scale=0.12), (0.95, 0.4, 0.4))
    return kit("Kit_hut", build)


def boat_kit():
    def build(mb):
        v, f = sphere(16, 10)
        hull = [(x * 1.0, y * 0.45, min(z, 0.15) * 0.4 if z < 0 else 0.06) for x, y, z in v]
        mb.add((hull, f), colour=lambda p: (0.95, 0.42, 0.38) if p[2] < -0.12 else WOOD)
        mb.add(box((-0.1, -0.38, 0.0), (0.1, 0.38, 0.08)), colour=WOOD_LIGHT, smooth=False)
        mb.add(box((0.45, -0.3, 0.0), (0.6, 0.3, 0.08)), colour=WOOD_LIGHT, smooth=False)
        mb.add(tube([(-0.2, 0.3, 0.12), (0.5, 0.7, 0.05)], 0.025, 4), colour=WOOD_LIGHT)
    return kit("Kit_rowboat", build)


def lifebuoy_kit():
    def build(mb):
        mb.add(torus(0.22, 0.07, 20, 8), colour=lambda p: (1.0, 0.3, 0.3) if int((math.atan2(p[1], p[0]) + math.pi) / TAU * 8) % 2 else WHITE)
    return kit("Kit_lifebuoy", build)


# ------------------------------------------------------------------ placing things

class Placer:
    """Keeps props off the paths, off each other and out of the camera's view of every space."""

    def __init__(self, land, terrain, mesa=None):
        self.land = land
        self.terrain = terrain
        self.mesa = mesa
        self.taken = [(s["p"][0], s["p"][1], 0.9) for s in land.spaces]
        # shop plots: nothing else goes near a shop
        self.taken += [(s["plot"][0], s["plot"][1], 2.3) for s in land.spaces if "plot" in s]
        self.spaces = [Vector((s["p"][0], s["p"][1], 0.3)) for s in land.spaces]

    def hit(self, x, y):
        best = None
        for ob in (self.terrain, self.mesa):
            if ob is None:
                continue
            ok, loc, nrm, _ = ob.ray_cast(Vector((x, y, 50)), Vector((0, 0, -1)))
            if ok and (best is None or loc.z > best[0]):
                best = (loc.z, nrm.z)
        return best

    def ground(self, x, y):
        h = self.hit(x, y)
        return h[0] if h else None

    def flat(self, x, y, limit=0.82):
        h = self.hit(x, y)
        return h is not None and h[1] >= limit

    def hides_a_space(self, x, y, r, z0, z1):
        """True if a cylinder (x, y, radius r, heights z0..z1) stands between a space and the camera."""
        c = Vector((x, y))
        gz = max(0.0, self.ground(x, y) or 0.0)
        z0, z1 = z0 + gz, z1 + gz
        for s in self.spaces:
            to = CAMERA - s
            flat = to.xy.length
            up = to.z / flat              # height gained per metre towards the camera
            u = to.xy.normalized()
            # the bit of the ray that is between heights z0 and z1
            h0 = max(0.0, (z0 - s.z) / up)
            h1 = max(0.0, (z1 - s.z) / up)
            if h1 <= 0:
                continue
            a = s.xy + u * h0
            b = s.xy + u * h1
            ab = b - a
            t = 0.0 if ab.length_squared < 1e-9 else max(0.0, min(1.0, (c - a).dot(ab) / ab.length_squared))
            if (a + ab * t - c).length < r + 0.35:
                return True
        return False

    def ok(self, x, y, r, path=1.0, zmin=-0.05, zmax=99, occl=None, water=False):
        if self.land.path_dist(x, y) < r + path:
            return False
        if any((x - a) ** 2 + (y - b) ** 2 < (r + rr) ** 2 for a, b, rr in self.taken):
            return False
        z = self.ground(x, y)
        if z is None:
            return False
        if not water and (z < zmin or z > zmax):
            return False
        if water and z > WATER - 0.1:
            return False
        if not water and not self.flat(x, y):
            return False
        if occl is not None and self.hides_a_space(x, y, *occl):
            return False
        return True

    def take(self, x, y, r):
        self.taken.append((x, y, r))


def put(mesh, name, loc, rot=0.0, scale=1.0, colname="Plants", tilt=(0.0, 0.0)):
    ob = bpy.data.objects.new(name, mesh if isinstance(mesh, bpy.types.Mesh) else bpy.data.meshes[mesh])
    ob.location = loc
    ob.rotation_euler = (tilt[0], tilt[1], rot)
    ob.scale = (scale, scale, scale) if not isinstance(scale, tuple) else scale
    bb.link(ob, colname)
    return ob


def island_points(isl, rng, inner=0.0, outer=1.0):
    while True:
        a = rng.uniform(0, TAU)
        r = math.sqrt(rng.uniform(inner * inner, outer * outer)) * Y.island_radius(isl, a)
        yield isl["c"][0] + math.cos(a) * r, isl["c"][1] + math.sin(a) * r, a


def scatter(pl, rng, islands, count, r, fn, tries=60, **kw):
    """Calls fn(x, y, z, a) for up to `count` free spots on the given islands."""
    placed = 0
    for _ in range(count * tries):
        if placed >= count:
            break
        name = rng.choice(islands)
        isl = Y.ISLANDS[name]
        x, y, a = next(island_points(isl, rng))
        if not pl.ok(x, y, r, **kw):
            continue
        z = pl.ground(x, y)
        fn(x, y, z, a)
        pl.take(x, y, r)
        placed += 1
    return placed


def lean_out(isl, x, y):
    return math.atan2(y - isl["c"][1], x - isl["c"][0])


def place_palm(pl, kits, x, y, z, toward, name, scale=1.0):
    mesh, h, lean = kits
    put(mesh, name, (x, y, z - 0.05), toward, scale, "Palms")


def build_props(land, terrain, spans, conf, rng, mesa=None):
    pl = Placer(land, terrain, mesa)
    # bridges count as taken ground
    for route, pts in spans:
        for p in pts[::4]:
            pl.take(p[0], p[1], 1.1)

    # ---- landmarks: start gate, shops, signposts
    L = bb.Layout("merge")
    start = L.data["startSpace"]
    p, d = L.pos[start], L.direction(start)
    gate = p - d * 1.0
    rot = math.atan2(d.y, d.x) - math.pi / 2
    put("Kit_start_gate", "Start start_gate", (gate.x, gate.y, 0.0), rot, 1.0, "Start")
    put("StartText", "Start start_text", (gate.x, gate.y, 0.0), rot, 1.0, "Start")
    pl.take(gate.x, gate.y, 1.4)
    for sid, s in L.spaces.items():
        q = L.pos[sid]
        dd = L.direction(sid)
        side = Vector((-dd.y, dd.x, 0))
        if s["type"] == "shop":
            # the plot yoshi_layout picked: flat, clear of the paths, door facing the space
            plot = next(t["plot"] for t in land.spaces if t["id"] == sid)
            u = (q - Vector((plot[0], plot[1], 0))).normalized()
            kitname = "Kit_shop_pink" if s.get("shop") == "pink" else "Kit_shop"
            put(kitname, f"Shop {sid}", (plot[0], plot[1], -0.02), math.atan2(u.x, -u.y), 1.0, "Shops")
        if len(s["next"]) > 1:
            for sgn in (1, -1):
                spot = q + side * sgn * 1.45
                if pl.ok(spot.x, spot.y, 0.3, path=0.0, occl=(0.4, 0.0, 1.4)):
                    break
            put("Kit_signpost", f"Signpost {sid}", (spot.x, spot.y, (pl.ground(spot.x, spot.y) or 0) - 0.06), math.atan2(dd.y, dd.x) + math.pi / 2, 1.0, "Signposts")
            pl.take(spot.x, spot.y, 0.5)

    # ---- the giant egg on its nest
    ex, ey = EGG
    gz = pl.ground(ex, ey) or 0
    put(nest_kit(), "Nest", (ex, ey, gz - 0.05), 0.3, 1.0, "Eggs")
    put(giant_egg(), "Egg Giant", (ex, ey, gz + 0.05), 0.2, 1.0, "Eggs", tilt=(0.06, -0.05))
    pl.take(ex, ey, 3.6)

    palms = [palm(k) for k in range(4)]
    fruit = [fruit_tree(0), fruit_tree(1)]
    bananas = [banana_plant(k) for k in range(2)]
    fern_m = fern()
    bushes = [round_bush(k, True) for k in range(4)] + [round_bush(4, False), round_bush(5, False)]
    smileys = [smiley_flower(k) for k in range(4)]
    eggs = small_eggs()
    rocks = [rock_kit(k) for k in range(4)]
    sea_rocks = [sea_rock_kit(k) for k in range(3)]
    grass = [bb.recolour_mesh(f"Kit_grass_{k}", f"Kit_grass_trop_{k}", lambda c: (c[0] * 0.9, min(1, c[1] * 1.12), c[2] * 0.7)).name for k in range(3)]

    def palm_at(x, y, z, a, isl, i, scale=None):
        k = rng.randrange(4)
        h = palms[k][1]
        # lean out to sea, but never towards a space: try a few directions
        base = lean_out(isl, x, y)
        for da in (0, 0.5, -0.5, 1.0, -1.0, 1.6, -1.6, math.pi):
            ang = base + da
            lean = palms[k][2]
            cx, cy = x + math.cos(ang) * lean, y + math.sin(ang) * lean
            if pl.hides_a_space(cx, cy, 1.9, h - 0.9, h + 0.6) or pl.hides_a_space(x, y, 0.3, 0, h):
                continue
            # seen from straight above (the Discord image) the crown mustn't cover a space
            if land.path_dist(cx, cy) < 1.7 or any(math.hypot(cx - q.x, cy - q.y) < 2.5 for q in pl.spaces):
                continue
            put(palms[k][0], f"tree_palm_{i}", (x, y, z - 0.05), ang, scale or rng.uniform(0.9, 1.12), "Palms")
            return True
        return False

    # ---- fruit trees on the grove, a couple on the cliff top and egg island
    n_tree = 0
    for name, want in (("grove", 8), ("cliff", 3), ("egg", 2), ("flowers", 2), ("jungle", 1), ("dock", 1)):
        isl = Y.ISLANDS[name]
        for _ in range(900):
            if want <= 0:
                break
            x, y, a = next(island_points(isl, rng, 0, 0.85))
            if not pl.ok(x, y, 1.1, path=1.2, occl=(1.1, 1.3, 3.0)):
                continue
            k = 1 if (name == "grove" and n_tree % 2) or name == "egg" else 0
            put(fruit[k], f"tree_fruit_{n_tree}", (x, y, pl.ground(x, y) - 0.05), rng.uniform(0, TAU), rng.uniform(0.75, 0.9), "Trees")
            pl.take(x, y, 1.0)
            n_tree += 1
            want -= 1

    # ---- palms round every shore, leaning out over the water
    n_palm = 0
    for name, isl in Y.ISLANDS.items():
        want = {"beach": 7, "dock": 6, "islet_e": 3, "islet_w": 3, "grove": 3, "cliff": 5, "jungle": 9, "flowers": 5, "egg": 6}[name]
        for _ in range(want * 40):
            if want <= 0:
                break
            a = rng.uniform(0, TAU)
            r = Y.island_radius(isl, a) - rng.uniform(0.9, 2.2)
            x, y = isl["c"][0] + math.cos(a) * r, isl["c"][1] + math.sin(a) * r
            if not pl.ok(x, y, 0.9, path=1.1, zmin=-0.25):
                continue
            if name == "egg" and math.hypot(x - ex, y - ey) < 3.8:
                continue
            if palm_at(x, y, pl.ground(x, y), a, isl, n_palm):
                pl.take(x, y, 1.0)
                n_palm += 1
                want -= 1
    # the jungle gets a thick inner grove of palms too
    isl = Y.ISLANDS["jungle"]
    extra = 0
    for _ in range(2000):
        if extra >= 9:
            break
        x, y, a = next(island_points(isl, rng, 0, 0.95))
        if pl.ok(x, y, 0.75, path=1.0, zmin=-0.2) and palm_at(x, y, pl.ground(x, y), a, isl, n_palm, rng.uniform(0.75, 1.0)):
            pl.take(x, y, 0.8)
            n_palm += 1
            extra += 1

    # ---- the cliff top: a grove of palms and fruit trees, behind everything
    cl = Y.ISLANDS["cliff"]
    for i in range(400):
        if i > 0 and len([o for o in bpy.data.collections["Palms"].objects if o.location.z > 3]) >= 9:
            break
        x, y, a = next(island_points(cl, rng, 0, 0.95))
        z = pl.ground(x, y)
        if z is None or z < land.cliff_top - 0.3 or not pl.ok(x, y, 0.9, path=2.0, zmin=-1, zmax=99):
            continue
        if math.hypot(x - land.spring[0], y - land.spring[1]) < 1.4 or land.seg_dist(np.array([x]), np.array([y]), land.top_stream)[0] < 0.8:
            continue
        if rng.random() < 0.75:
            k = rng.randrange(4)
            put(palms[k][0], f"tree_palm_top_{i}", (x, y, z - 0.05), rng.uniform(0, TAU), rng.uniform(0.9, 1.15), "Palms")
            pl.take(x, y, 1.0)
        else:
            put(fruit[rng.randrange(2)], f"tree_fruit_top_{i}", (x, y, z - 0.05), rng.uniform(0, TAU), rng.uniform(0.8, 0.95), "Trees")
            pl.take(x, y, 1.3)

    # ---- jungle undergrowth: bananas and ferns
    def banana(x, y, z, a):
        put(bananas[rng.randrange(2)], f"bush_banana_{len(bpy.data.collections['Plants'].objects)}", (x, y, z - 0.05), rng.uniform(0, TAU), rng.uniform(0.8, 1.1), "Plants")
    scatter(pl, rng, ["jungle"], 9, 0.8, banana, path=0.7, occl=(0.9, 0, 1.4))
    scatter(pl, rng, ["cliff", "grove", "egg", "islet_e", "islet_w"], 7, 0.8, banana, path=0.7, occl=(0.9, 0, 1.4))

    def fern_at(x, y, z, a):
        put(fern_m, f"fern_{len(bpy.data.collections['Plants'].objects)}", (x, y, z - 0.02), rng.uniform(0, TAU), rng.uniform(0.8, 1.2), "Plants")
    scatter(pl, rng, ["jungle"], 14, 0.55, fern_at, path=0.45, occl=(0.6, 0, 0.6))
    scatter(pl, rng, list(Y.ISLANDS), 30, 0.5, fern_at, path=0.45, occl=(0.55, 0, 0.6))

    # ---- flowering bushes everywhere, smiley flowers and eggs on the flower island
    def bush(x, y, z, a):
        put(rng.choice(bushes), f"bush_{len(bpy.data.collections['Plants'].objects)}", (x, y, z - 0.05), rng.uniform(0, TAU), rng.uniform(0.8, 1.25), "Plants")
    scatter(pl, rng, list(Y.ISLANDS), 70, 0.55, bush, path=0.5, occl=(0.6, 0, 0.9))
    scatter(pl, rng, ["flowers", "egg", "jungle", "grove"], 22, 0.55, bush, path=0.5, occl=(0.6, 0, 0.9))

    def smiley(x, y, z, a):
        put(rng.choice(smileys), f"smiley_{len(bpy.data.collections['Flowers'].objects)}", (x, y, z - 0.03), rng.uniform(-0.35, 0.35), rng.uniform(0.9, 1.2), "Flowers")
    scatter(pl, rng, ["flowers"], 10, 0.4, smiley, path=0.35, occl=(0.45, 0, 1.3))
    scatter(pl, rng, ["egg", "grove", "beach", "cliff", "dock"], 12, 0.4, smiley, path=0.35, occl=(0.45, 0, 1.3))
    # a ring of smiley flowers round the egg's nest
    for k in range(9):
        a = math.pi * 0.05 + math.pi * 0.9 * k / 8   # the back half only
        x, y = ex + math.cos(a) * 4.0, ey + math.sin(a) * 3.2
        if pl.ok(x, y, 0.35, path=0.4):
            put(smileys[k % 4], f"smiley_egg_{k}", (x, y, pl.ground(x, y) - 0.03), rng.uniform(-0.3, 0.3), 1.15, "Flowers")
            pl.take(x, y, 0.35)

    def small_egg(x, y, z, a):
        ob = put(rng.choice(eggs), f"Egg {len(bpy.data.collections['Eggs'].objects)}", (x, y, z - 0.03), rng.uniform(0, TAU), rng.uniform(0.8, 1.3), "Eggs",
                 tilt=(rng.uniform(-0.2, 0.2), rng.uniform(-0.2, 0.2)))
    scatter(pl, rng, ["flowers"], 9, 0.35, small_egg, path=0.35, occl=(0.35, 0, 1.0))
    scatter(pl, rng, ["egg", "grove", "beach", "jungle", "cliff", "dock", "islet_e", "islet_w"], 16, 0.35, small_egg, path=0.35, occl=(0.35, 0, 1.0))

    # ---- the beach: umbrellas, towels, a sandcastle, a hammock, torches, shells
    umbrellas = [umbrella_kit(k) for k in range(3)]
    def umbrella(x, y, z, a):
        put(umbrellas[rng.randrange(3)], f"umbrella_{len(bpy.data.collections['Beach'].objects)}", (x, y, z - 0.02), rng.uniform(-0.6, 0.6), 1.0, "Beach")
    scatter(pl, rng, ["beach"], 4, 1.2, umbrella, path=1.0, zmin=-0.35, zmax=0.05, occl=(1.2, 1.4, 2.2))
    scatter(pl, rng, ["egg", "dock"], 2, 1.2, umbrella, path=1.0, zmin=-0.35, zmax=0.05, occl=(1.2, 1.4, 2.2))
    castle = sandcastle_kit()
    scatter(pl, rng, ["beach"], 2, 0.75, lambda x, y, z, a: put(castle, f"sandcastle_{x:.0f}", (x, y, z - 0.03), rng.uniform(-0.4, 0.4), 0.9, "Beach"),
            path=0.8, zmin=-0.35, zmax=0.05, occl=(0.75, 0, 1.4))
    ball = beach_ball_kit()
    scatter(pl, rng, ["beach", "egg"], 3, 0.3, lambda x, y, z, a: put(ball, f"beach_ball_{x:.0f}", (x, y, z), rng.uniform(0, TAU), 1.0, "Beach"), path=0.4, zmin=-0.4, zmax=0.1)
    stars = [starfish_kit((1.0, 0.55, 0.35)), starfish_kit((1.0, 0.42, 0.55)), starfish_kit((1.0, 0.78, 0.30))]
    shell = shell_kit()
    def sea_bits(x, y, z, a):
        if rng.random() < 0.5:
            put(rng.choice(stars), f"starfish_{len(bpy.data.collections['Beach'].objects)}", (x, y, z + 0.005), rng.uniform(0, TAU), rng.uniform(0.8, 1.2), "Beach")
        else:
            put(shell, f"shell_{len(bpy.data.collections['Beach'].objects)}", (x, y, z + 0.005), rng.uniform(0, TAU), rng.uniform(0.9, 1.4), "Beach")
    scatter(pl, rng, list(Y.ISLANDS), 34, 0.2, sea_bits, path=0.3, zmin=-0.42, zmax=-0.08)
    torch, flame = tiki_torch_kit()
    def tiki(x, y, z, a):
        put(torch, f"tiki_{x:.1f}_{y:.1f}", (x, y, z - 0.05), 0, 1.0, "Beach")
        put(flame, f"tiki_flame_{x:.1f}_{y:.1f}", (x, y, z - 0.05), 0, 1.0, "Beach")
    for sid in [s for s in L.spaces][::7]:
        q = L.pos[sid]
        dd = L.direction(sid)
        side = Vector((-dd.y, dd.x, 0))
        if side.y < 0:
            side = -side
        spot = q + side * 1.35
        if pl.ok(spot.x, spot.y, 0.2, path=0.45, zmin=-0.3, occl=(0.25, 0, 1.7)):
            tiki(spot.x, spot.y, pl.ground(spot.x, spot.y), 0)
            pl.take(spot.x, spot.y, 0.3)

    # a hammock strung between two palms on the beach
    bx, by = Y.ISLANDS["beach"]["c"]
    for off in (-4.5, 4.5, -2.5, 2.5):
        hx, hy = bx + off, by - 2.2
        if pl.ok(hx, hy, 1.6, path=0.9, zmin=-0.3, occl=(1.4, 0, 1.6)):
            hz = pl.ground(hx, hy)
            put(hammock_kit(2.4), "hammock", (hx, hy, hz), 0.0, 1.0, "Beach")
            for sx in (-1.4, 1.4):
                put(palms[3][0], f"tree_palm_h{sx}", (hx + sx, hy, (pl.ground(hx + sx, hy) or hz) - 0.05), math.pi / 2 if sx > 0 else -math.pi / 2, 0.95, "Palms")
            pl.take(hx, hy, 1.9)
            break

    # ---- the dock: a pier out to a hut on stilts, a rowboat, crates and barrels
    build_dock(pl, land, rng)
    crate, barrel = crate_kit(), barrel_kit()
    scatter(pl, rng, ["dock", "grove"], 5, 0.45, lambda x, y, z, a: put(crate, f"crate_{x:.1f}", (x, y, z - 0.02), rng.uniform(0, TAU), 1.0, "Dock"), path=0.4, occl=(0.45, 0, 0.8))
    scatter(pl, rng, ["dock", "beach"], 4, 0.4, lambda x, y, z, a: put(barrel, f"barrel_{x:.1f}", (x, y, z - 0.02), rng.uniform(0, TAU), 1.0, "Dock"), path=0.4, zmin=-0.3, occl=(0.4, 0, 0.8))
    patch = melon_patch_kit()
    scatter(pl, rng, ["grove"], 3, 0.8, lambda x, y, z, a: put(patch, f"melons_{x:.1f}", (x, y, z), rng.uniform(0, TAU), 1.0, "Plants"), path=0.5)
    scatter(pl, rng, ["flowers", "egg"], 2, 0.8, lambda x, y, z, a: put(patch, f"melons_{x:.1f}", (x, y, z), rng.uniform(0, TAU), 1.0, "Plants"), path=0.5)

    # ---- rocks on land and out in the sea
    scatter(pl, rng, list(Y.ISLANDS), 18, 0.5, lambda x, y, z, a: put(rng.choice(rocks), f"rock_{x:.1f}_{y:.1f}", (x, y, z - 0.08), rng.uniform(0, TAU), rng.uniform(0.6, 1.3), "Rocks"),
            path=0.6, zmin=-0.45, occl=(0.55, 0, 0.7))
    n = 0
    for _ in range(600):
        if n >= 11:
            break
        x, y = rng.uniform(-23, 23), rng.uniform(-18, 20)
        d, _ = Y.land_sdf(x, y)
        if not (0.8 < d < 3.5) or land.path_dist(x, y) < 2.0:
            continue
        if any((x - a) ** 2 + (y - b) ** 2 < 2.2 ** 2 for a, b, _ in pl.taken):
            continue
        if pl.hides_a_space(x, y, 1.0, 0, 0.6):
            continue
        put(rng.choice(sea_rocks), f"rock_sea_{n}", (x, y, 0), rng.uniform(0, TAU), rng.uniform(0.6, 1.1), "Rocks")
        pl.take(x, y, 1.0)
        n += 1

    # ---- ground cover: little flowers and grass tufts
    for i in range(320):
        isl = Y.ISLANDS[rng.choice(list(Y.ISLANDS))]
        x, y, a = next(island_points(isl, rng))
        z = pl.ground(x, y)
        if z is None or z < -0.03 or land.path_dist(x, y) < 1.05:
            continue
        put(f"Kit_flowers_{rng.randrange(4)}", f"flowers_{i}", (x, y, z - 0.02), rng.uniform(0, TAU), rng.uniform(0.8, 1.2), "Flowers")
    for i in range(800):
        isl = Y.ISLANDS[rng.choice(list(Y.ISLANDS))]
        x, y, a = next(island_points(isl, rng))
        z = pl.ground(x, y)
        if z is None or z < -0.02 or land.path_dist(x, y) < 0.95:
            continue
        put(rng.choice(grass), f"grass_{i}", (x, y, z - 0.02), rng.uniform(0, TAU), rng.uniform(1.0, 1.6), "Grass")

    # ---- clouds drifting round the edges
    clouds = [cloud_kit(k) for k in range(3)]
    for i, (x, y, z, s) in enumerate([(-24, 17, 7, 1.3), (25, 15, 8, 1.1), (-27, -8, 6, 1.2), (27, -4, 6.5, 1.4), (-20, -21, 5, 1.0),
                                      (21, -21, 5.5, 1.2), (8, 25, 9, 1.5), (-10, 26, 9, 1.3), (30, 6, 7, 1.0), (-31, 4, 7, 1.1)]):
        ob = put(clouds[i % 3], f"Cloud {i}", (x, y, z), rng.uniform(0, TAU), s, "Sky")
        ob.visible_shadow = False

    # ---- on the water: lily pads in the shallows, floaties in the lagoon, sailboats out at sea
    pads = [lily_kit(k) for k in range(3)]
    n = 0
    for _ in range(3000):
        if n >= 46:
            break
        x, y = rng.uniform(-22, 22), rng.uniform(-17, 19)
        d, _ = Y.land_sdf(x, y)
        if not (0.35 < d < 1.6) or land.path_dist(x, y) < 1.4:
            continue
        if any((x - a) ** 2 + (y - b) ** 2 < 0.55 ** 2 for a, b, _ in pl.taken):
            continue
        put(rng.choice(pads), f"lily_{n}", (x, y, WATER + 0.012), rng.uniform(0, TAU), rng.uniform(0.7, 1.2), "Plants")
        pl.take(x, y, 0.4)
        n += 1
    px, py, pr = land.pond
    for k in range(4):
        a = 1.1 + k * 1.5
        put(pads[k % 3], f"lily_pond_{k}", (px + math.cos(a) * pr * 0.55, py + math.sin(a) * pr * 0.5, WATER + 0.012), a, 0.7, "Plants")
    floatie = floatie_kit()
    for k, (x, y) in enumerate([(-7.5, -5.2), (8.2, 4.6), (-4.0, 7.0)]):
        if Y.land_sdf(x, y)[0] > 0.8 and land.path_dist(x, y) > 1.6 and not pl.hides_a_space(x, y, 0.5, 0, 0.4):
            put(floatie, f"floatie_{k}", (x, y, WATER + 0.02), rng.uniform(0, TAU), 1.0, "Beach", tilt=(rng.uniform(-0.08, 0.08), rng.uniform(-0.08, 0.08)))
    boat = sailboat_kit()
    for k, (x, y, rot) in enumerate([(-20.5, -16.5, 0.5), (21.5, 14.5, 2.6), (-22.0, 15.0, -0.4)]):
        if not pl.hides_a_space(x, y, 1.2, 0, 2.8):
            put(boat, f"sailboat_{k}", (x, y, WATER), rot, 1.0, "Dock")
    return pl


def lily_kit(variant):
    rng = random.Random(180 + variant)

    def build(mb):
        v = [(0, 0, 0)]
        n = 18
        for i in range(n + 1):
            a = 0.35 + (TAU - 0.7) * i / n          # a notch cut out of the pad
            v.append((math.cos(a) * 0.38, math.sin(a) * 0.38, 0))
        f = [(0, 1 + i, 2 + i) for i in range(n)]
        mb.add((v, f), colour=lambda p: mix((0.30, 0.70, 0.28), (0.52, 0.86, 0.36), min(1, math.hypot(p[0], p[1]) / 0.38)), smooth=False)
        if variant == 0:
            for k in range(8):
                a = TAU * k / 8
                M = T((0.05, 0.05, 0.05)) @ Matrix.Rotation(a, 4, "Z") @ Matrix.Translation((0.08, 0, 0)) @ Matrix.Rotation(-0.6, 4, "Y") @ Matrix.Diagonal((0.11, 0.05, 0.03, 1))
                mb.add(sphere(8, 5), M, (1.0, 0.62, 0.80))
            mb.add(sphere(6, 4), T((0.05, 0.05, 0.08), scale=0.04), (1.0, 0.9, 0.35))
    return kit(f"Kit_lily_{variant}", build)


def floatie_kit():
    def build(mb):
        mb.add(torus(0.42, 0.17, 24, 10), colour=lambda p: (1.0, 0.55, 0.72) if int((math.atan2(p[1], p[0]) + math.pi) / TAU * 10) % 2 else WHITE)
    return kit("Kit_floatie", build)


def sailboat_kit():
    def build(mb):
        v, f = sphere(18, 10)
        hull = [(x * 1.3, y * 0.5, (z * 0.45 if z < 0 else 0.0) + 0.12) for x, y, z in v]
        mb.add((hull, f), colour=lambda p: (0.98, 0.98, 0.95) if p[2] > -0.12 else (0.35, 0.62, 1.0))
        mb.add(box((-1.0, -0.38, 0.12), (1.0, 0.38, 0.16)), colour=WOOD_LIGHT, smooth=False)
        mb.add(cyl(8, 0.04, 0.035, 2.6), T((0.15, 0, 0.12)), WOOD)
        # a striped sail
        for k in range(5):
            z0, z1 = 0.4 + k * 0.42, 0.4 + (k + 1) * 0.42
            w0, w1 = 1.05 * (1 - k / 5.2), 1.05 * (1 - (k + 1) / 5.2)
            quad = ([(0.2, 0.02, z0), (0.2 + w0, 0.02, z0), (0.2 + w1, 0.02, z1), (0.2, 0.02, z1)], [(0, 1, 2, 3)])
            mb.add(quad, colour=(1.0, 0.45, 0.45) if k % 2 else WHITE, smooth=False)
        mb.add(((((0.1, 0.02, 2.55), (0.1, 0.02, 2.75), (0.45, 0.02, 2.65))), [(0, 1, 2)]), colour=(1.0, 0.85, 0.25), smooth=False)
    return kit("Kit_sailboat", build)


def build_dock(pl, land, rng):
    isl = Y.ISLANDS["dock"]
    a = -0.2    # out to the east, towards the open sea, clear of the shop
    r = Y.island_radius(isl, a)
    u = Vector((math.cos(a), math.sin(a), 0))
    s = Vector((-u.y, u.x, 0))
    c = Vector((isl["c"][0], isl["c"][1], 0))
    start = c + u * (r - 1.6)
    end = c + u * (r + 3.8)
    mb = MB()
    length = (end - start).length
    k = 0
    for t in np.arange(0, length, 0.26):
        p = start + u * t
        M = Matrix.Translation(p + Vector((0, 0, 0.12))) @ Matrix(((u.x, s.x, 0), (u.y, s.y, 0), (0, 0, 1))).to_4x4()
        mb.add(rounded_box(0.22, 1.5, 0.08, 4, 4), M, mix(WOOD, WOOD_LIGHT, rng.uniform(0, 0.6)), smooth=False)
    for t in np.arange(0.4, length, 1.2):
        for sgn in (-1, 1):
            p = start + u * t + s * sgn * 0.8
            mb.add(cyl(8, 0.09, 0.09, 0.6 - WATER + 0.3), T(p + Vector((0, 0, WATER - 0.3))), WOOD_DARK)
            mb.add(sphere(8, 5), T(p + Vector((0, 0, 0.62)), scale=0.1), WOOD)
    # the hut's platform at the end
    hp = end + u * 1.3
    mb.add(cyl(20, 1.75, 1.75, 0.12), T(hp + Vector((0, 0, 0.08))), WOOD)
    for k in range(8):
        aa = TAU * k / 8
        mb.add(cyl(8, 0.1, 0.1, 0.25 - WATER + 0.3), T(hp + Vector((math.cos(aa) * 1.55, math.sin(aa) * 1.55, WATER - 0.3))), WOOD_DARK)
    me = mb.mesh("Dock_pier", "Wood")
    bb.link(bpy.data.objects.new("Dock pier", me), "Dock")
    put(hut_kit(), "House hut", (hp.x, hp.y, 0.2), math.atan2(u.y, u.x) + math.pi / 2 + math.pi, 1.0, "Dock")
    put(boat_kit(), "rowboat", tuple(end + s * 1.5 + Vector((0, 0, WATER + 0.12))), math.atan2(u.y, u.x) + 0.3, 1.0, "Dock")
    put(lifebuoy_kit(), "lifebuoy", tuple(start + u * 2.2 + s * 0.93 + Vector((0, 0, 0.5))), math.atan2(u.y, u.x), 1.0, "Dock", tilt=(math.pi / 2, 0))
    put(barrel_kit() if "Kit_barrel" not in bpy.data.meshes else bpy.data.meshes["Kit_barrel"], "barrel_pier", tuple(end - u * 0.6 + s * 0.45 + Vector((0, 0, 0.16))), 0.3, 0.8, "Dock")
    for p in (start, end, hp):
        pl.take(p.x, p.y, 1.8)


def build_mesa(land):
    """The cliff: a rounded block with layered stripes down its sides and a grassy cap
    that bulges over the edge, like the hills in Yoshi's Island. A stream runs across
    the top from a spring to the waterfall."""
    m = land.mesa
    top = land.cliff_top
    n = 120
    rng = random.Random(21)
    mb = MB()
    ang = [TAU * i / n for i in range(n)]
    rad = [land.mesa_r(t) for t in ang]
    cx, cy = m["cx"], m["cy"]

    def ring(scale, z, bulge=0.0):
        return [(cx + math.cos(t) * (r * scale + bulge), cy + math.sin(t) * (r * scale + bulge), z) for t, r in zip(ang, rad)]

    def band(r0, r1, colour, smooth=True):
        q = len(mb.v)
        mb.v += [tuple(p) for p in r0] + [tuple(p) for p in r1]
        mb.col += [colour] * (2 * n)
        for i in range(n):
            j = (i + 1) % n
            mb.f.append((q + i, q + j, q + n + j, q + n + i))
            mb.sm.append(smooth)

    # strata: bands from the cap down into the water, each bulging a little differently
    z = top - 0.38
    k = 0
    while z > WATER - 0.8:
        h = 0.5 + 0.12 * math.sin(k * 2.3)
        z1 = max(WATER - 0.8, z - h)
        b0 = 0.05 * math.sin(k * 1.7 + 0.5)
        c = CLIFF_A if k % 2 == 0 else CLIFF_B
        band(ring(1.0, z, b0 - 0.02), ring(1.0, z - 0.06, b0 + 0.03), c)
        band(ring(1.0, z - 0.06, b0 + 0.03), ring(1.0, z1 + 0.06, b0 + 0.03), c)
        band(ring(1.0, z1 + 0.06, b0 + 0.03), ring(1.0, z1, b0 - 0.02), c)
        z = z1
        k += 1
    # the grassy cap: a rounded lip hanging over the edge, then the top
    dark = mix(GRASS, (0.2, 0.5, 0.2), 0.45)
    band(ring(1.0, top - 0.38, -0.02), ring(1.0, top - 0.42, 0.14), dark)
    band(ring(1.0, top - 0.42, 0.14), ring(1.0, top - 0.2, 0.2), mix(GRASS, (0.2, 0.5, 0.2), 0.3))
    band(ring(1.0, top - 0.2, 0.2), ring(1.0, top - 0.04, 0.12), GRASS)
    band(ring(1.0, top - 0.04, 0.12), ring(0.96, top, 0.0), GRASS)
    # the top: rings in to the middle, gently rolling
    prev = ring(0.96, top, 0.0)
    for sc in (0.85, 0.7, 0.55, 0.4, 0.25, 0.1):
        cur = [(x, y, top + 0.12 * noise.noise(Vector((x * 0.35, y * 0.35, 3.0))) * (1 - sc)) for x, y, _ in ring(sc, 0, 0.0)]
        q = len(mb.v)
        mb.v += [tuple(p) for p in prev] + [tuple(p) for p in cur]
        mb.col += [mix(GRASS, GRASS_LIGHT, 0.4 + 0.4 * noise.noise(Vector((p[0] * 0.3, p[1] * 0.3, 1.0)))) for p in prev + cur]
        for i in range(n):
            j = (i + 1) % n
            mb.f.append((q + i, q + j, q + n + j, q + n + i))
            mb.sm.append(True)
        prev = cur
    q = len(mb.v)
    mb.v.append((cx, cy, top))
    mb.col.append(GRASS_LIGHT)
    for i in range(n):
        mb.f.append((q - n + i, q - n + (i + 1) % n, q))
        mb.sm.append(True)
    ob = bpy.data.objects.new("Terrain cliff", mb.mesh("Cliff_yoshi", "Terrain"))
    bb.link(ob, "Terrain")
    # the spring and the stream across the top to the waterfall's lip
    wb = MB()
    fx = land.fall_x
    lip = land.mesa_front(fx)
    sx, sy, sr = land.spring
    ctrl = [(fx, lip + 0.15), (fx - 0.2, lip + 0.9), (fx - 0.8, lip + 1.6), (sx, sy)]
    pts = [(x, y, top + 0.04) for x, y in Y.catmull(ctrl, False, 8)]
    wb.add(ribbon(pts, 0.9), colour=(0.45, 0.90, 0.95))
    wb.add(disc(sr + 0.15, 24), T((sx, sy, top + 0.045)), (0.38, 0.86, 0.95))
    wob = bpy.data.objects.new("Water spring", wb.mesh("Water_spring", water_material("Water lagoon").name))
    bb.link(wob, "Water")
    land.top_stream = [p[:2] for p in pts]
    # pebbles along both banks and round the spring
    rk = MB()
    for p, t, s in frames(along(land.top_stream, 0.45))[1:-1]:
        for sgn in (-1, 1):
            q = p + s * sgn * 0.52
            rk.add(blob(rng.random() * 9, 10, 6, 0.2), T((q.x, q.y, top + 0.02), scale=(0.17, 0.15, 0.11) if rng.random() < 0.7 else (0.24, 0.2, 0.15)),
                   lambda v: mix(ROCK_DARK, ROCK, 0.3 + 0.7 * max(0, v[2])))
    for a in np.linspace(0, TAU, 11, endpoint=False):
        if abs(math.atan2(math.sin(a - 4.4), math.cos(a - 4.4))) < 0.5:
            continue   # the gap where the stream leaves
        rk.add(blob(a * 3, 12, 8, 0.2), T((sx + math.cos(a) * (sr + 0.3), sy + math.sin(a) * (sr + 0.3), top), scale=(0.3, 0.26, 0.24)),
               lambda v: mix(ROCK_DARK, ROCK, 0.3 + 0.7 * max(0, v[2])))
    bb.link(bpy.data.objects.new("rock_stream", rk.mesh("Stream_rocks")), "Rocks")
    return ob


def build_rainbow(land):
    """A soft rainbow arching over the cliff top, behind the waterfall."""
    mb = MB()
    cx, cy = land.fall_x + 3.2, land.cliff_y + 3.4
    base = land.cliff_top - 0.4
    bands = [(1.0, 0.45, 0.50), (1.0, 0.68, 0.40), (1.0, 0.90, 0.45), (0.55, 0.88, 0.50), (0.45, 0.72, 1.0), (0.70, 0.55, 0.95)]
    for k, c in enumerate(bands):
        r0 = 5.6 - k * 0.24
        r1 = r0 - 0.24
        v, f = [], []
        n = 48
        for i in range(n + 1):
            a = math.pi * i / n
            for r in (r0, r1):
                v += [(cx + math.cos(a) * r, cy - 0.06, base + math.sin(a) * r), (cx + math.cos(a) * r, cy + 0.06, base + math.sin(a) * r)]
        for i in range(n):
            q, w = 4 * i, 4 * (i + 1)
            f += [(q, w, w + 2, q + 2), (q + 1, q + 3, w + 3, w + 1), (q, q + 1, w + 1, w), (q + 2, w + 2, w + 3, q + 3)]
        mb.add((v, f), colour=c, smooth=True)
    # each foot of the rainbow sits in a little cloud
    for sx in (-1, 1):
        for j in range(5):
            mb.add(sphere(12, 8), T((cx + sx * 5.0 + random.Random(j).uniform(-0.7, 0.7), cy + random.Random(j + 9).uniform(-0.5, 0.5), base + 0.2 + j % 2 * 0.25),
                                    scale=random.Random(j + 3).uniform(0.45, 0.75)), WHITE)
    ob = bpy.data.objects.new("Rainbow", mb.mesh("Rainbow_yoshi"))
    ob.visible_shadow = False
    bb.link(ob, "Sky")


def build_waterfall(land):
    fx = land.fall_x
    top = land.cliff_top - 0.12
    lip_y = land.mesa_front(fx) + 0.1
    base_y = land.pond[1] + 0.35
    mb = MB()
    cols, rows = 9, 18
    v, f = [], []
    rng = random.Random(9)
    phase = [rng.uniform(0, 1) for _ in range(cols + 1)]
    for j in range(rows + 1):
        u = j / rows
        y = lip_y - (lip_y - base_y) * (1 - (1 - u) ** 2.2) - 0.1 * math.sin(math.pi * u)
        z = top - (top - WATER) * u ** 1.25
        for i in range(cols + 1):
            w = 0.62 + 0.18 * u
            x = fx + (i / cols - 0.5) * 2 * w
            v.append((x, y - 0.05 * math.sin(math.pi * i / cols), z))
    for j in range(rows):
        for i in range(cols):
            a = j * (cols + 1) + i
            f.append((a, a + 1, a + cols + 2, a + cols + 1))

    def colour(p):
        i = round((p[0] - fx + 0.8) / 1.6 * cols)
        stripe = math.sin(i * 2.1 + p[2] * 0.7) > 0.2
        low = sstep(WATER + 1.2, WATER, p[2])
        base = (0.70, 0.94, 1.0) if stripe else (0.88, 0.98, 1.0)
        return mix(base, WHITE, low * 0.8)
    mb.add((v, f), colour=colour, smooth=True)
    me = mb.mesh("Waterfall_yoshi", water_material("Waterfall", emission=0.35, rough=0.25).name)
    bb.link(bpy.data.objects.new("Waterfall", me), "Waterfall")
    # splash: white puffs where it lands, and a few at the lip
    sp = MB()
    for k in range(14):
        a = TAU * k / 14
        r = rng.uniform(0.35, 0.8)
        sp.add(sphere(10, 7), T((fx + math.cos(a) * r, base_y - 0.15 + math.sin(a) * r * 0.6, WATER + 0.05), scale=rng.uniform(0.18, 0.32)), WHITE)
    for k in range(5):
        sp.add(sphere(8, 6), T((fx + rng.uniform(-0.55, 0.55), lip_y - 0.05, top + 0.02), scale=rng.uniform(0.1, 0.16)), WHITE)
    bb.link(bpy.data.objects.new("Waterfall foam", sp.mesh("Waterfall_foam", "Foam")), "Waterfall")
    # boulders framing the pond and the spring
    rk = MB()
    px, py, pr = land.pond
    for a in np.linspace(0.3, math.pi - 0.3, 5):
        x, y = px + math.cos(a) * (pr + 0.35), py + math.sin(a) * (pr + 0.1)
        if land.path_dist(x, y) < 1.2:
            continue
        rk.add(blob(a * 7, 12, 8, 0.2), T((x, y, land.height(x, y) - 0.05), scale=(0.35, 0.3, 0.3)), lambda p: mix(ROCK_DARK, ROCK, 0.3 + 0.7 * max(0, p[2])))
    bb.link(bpy.data.objects.new("rock_waterfall", rk.mesh("Waterfall_rocks")), "Rocks")


# ------------------------------------------------------------------ the whole thing

def clear():
    for o in list(bpy.data.objects):
        if o.type in ("CAMERA", "LIGHT"):
            continue
        if any(c.name == "Kit" for c in o.users_collection):
            continue
        bpy.data.objects.remove(o, do_unlink=True)
    scene = bpy.context.scene
    for c in list(scene.collection.children):
        if c.name != "Kit":
            scene.collection.children.unlink(c)
    for c in list(bpy.data.collections):
        if c.name != "Kit" and c.users == 0:
            bpy.data.collections.remove(c)
    for name in COLLECTIONS:
        c = bpy.data.collections.get(name) or bpy.data.collections.new(name)
        if c.name not in scene.collection.children:
            scene.collection.children.link(c)


def export():
    glb = os.path.join(REPO, "apps", "web", "public", "models", "board-merge.glb")
    bpy.ops.object.select_all(action="DESELECT")
    for c in COLLECTIONS:
        if c == "Spaces":
            continue
        for o in bb.col(c).all_objects:
            if o.type == "MESH":
                o.select_set(True)
    import io, contextlib
    with contextlib.redirect_stdout(io.StringIO()):
        bpy.ops.export_scene.gltf(filepath=glb, export_format="GLB", use_selection=True, export_draco_mesh_compression_enable=True,
                                  export_draco_mesh_compression_level=7, export_apply=True, export_yup=True, export_vertex_color="MATERIAL",
                                  export_lights=False, export_cameras=False)
    bpy.ops.object.select_all(action="DESELECT")
    return glb


def stage(upto="all", seed=7):
    """Builds the scene (without exporting). upto: 'land' stops after the terrain and water."""
    Y.write()
    board, spaces, curves, ids = Y.layout()
    for s in spaces:
        s["id"] = ids[spaces.index(s)]
    conf = json.load(open(os.path.join(REPO, "packages", "board-data", "season-config.json"), encoding="utf8"))
    rng = random.Random(seed)
    clear()
    KITS_BUILT.clear()
    land = Land(curves, spaces)
    land.height_noflat = lambda x, y: float(land.heights(np.array([[x]]), np.array([[y]]), pd=np.zeros((1, 1)))[0][0, 0])
    terrain = build_terrain(land)
    build_water(land)
    build_foam(land)
    build_paths(land)
    spans = build_bridges(land)
    bb.build_tiles(bb.Layout("merge"), conf)
    bpy.context.view_layer.update()
    if upto == "land":
        return land
    mesa = build_mesa(land)
    bpy.context.view_layer.update()
    build_waterfall(land)
    build_rainbow(land)
    build_props(land, terrain, spans, conf, rng, mesa)
    bb.setup_light(bb.THEMES["day"])
    return land


def build(seed=7):
    name = os.path.basename(bpy.data.filepath)
    assert name in ("board.blend", "board-yoshi.blend"), "open art/board.blend first"
    if name == "board.blend":
        bpy.ops.wm.save_as_mainfile(filepath=os.path.join(REPO, "art", "board-yoshi.blend"))
    stage("all", seed)
    glb = export()
    bb.render_backdrop(bb.Layout("merge"))
    bpy.ops.wm.save_mainfile()
    return f"merge: glb {os.path.getsize(glb) // 1024} KB"
