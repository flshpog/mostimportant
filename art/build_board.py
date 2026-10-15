"""Builds a board island in Blender from a layout JSON (packages/board-data/boards/*.json).

Run inside Blender with art/board.blend open (it reuses its Kit props, tile meshes and
materials):

    exec(open(r"<repo>/art/build_board.py").read()); build("merge")

It clears the main board out of the open file, builds the new island, exports the
website model (apps/web/public/models/board-<id>.glb), renders the Discord backdrop
(packages/discord/assets/backdrop-<id>.png/.json) and saves art/board-<id>.blend.
board.blend itself is never overwritten.
"""
import bpy, bmesh, json, math, os, random
from mathutils import Vector, noise
from bpy_extras.object_utils import world_to_camera_view

REPO = os.path.dirname(os.path.dirname(os.path.abspath(bpy.data.filepath)))

THEMES = {
    "day": dict(  # Yoshi's Island: bright, flowery, eggs everywhere, sea all round
        grass=(0.33, 0.75, 0.30), grass2=(0.45, 0.82, 0.32), slope=(0.55, 0.36, 0.22), path=(0.93, 0.84, 0.60),
        sea=True, sun=(1.0, 0.92, 0.80), sun_energy=4.2, world=(0.38, 0.62, 1.0),
    ),
    "night": dict(  # the underworld: purple ground, dead trees, graves, a haunted house
        grass=(0.20, 0.13, 0.30), grass2=(0.26, 0.17, 0.38), slope=(0.09, 0.06, 0.14), path=(0.36, 0.32, 0.46),
        sea=False, sun=(0.70, 0.62, 1.0), sun_energy=2.2, world=(0.10, 0.06, 0.18),
    ),
}

def srgb(c):
    return tuple((x / 12.92) if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)

def col(name):
    return bpy.data.collections[name]

def link(obj, colname):
    col(colname).objects.link(obj)
    return obj

def clear_board():
    keep = {"Kit"}
    for c in list(bpy.data.collections):
        if c.name in keep:
            continue
        for o in list(c.objects):
            if o.type == "MESH" or o.type == "EMPTY" or o.type == "CURVE" or o.type == "FONT":
                bpy.data.objects.remove(o, do_unlink=True)
    for name in ["Terrain", "Water", "Paths", "Spaces", "Bridges", "Trees", "Bushes", "Rocks", "Flowers", "Grass",
                 "Mushrooms", "Fences", "Shops", "Signposts", "Start", "Sky", "Eggs", "Graves", "House", "Lanterns"]:
        if name not in bpy.data.collections:
            c = bpy.data.collections.new(name)
            bpy.context.scene.collection.children.link(c)

def vcol_layer(me):
    layer = me.attributes["Col"] if "Col" in me.attributes else me.attributes.new("Col", "BYTE_COLOR", "CORNER")
    # the materials read the active colour layer
    me.color_attributes.active_color = layer
    me.color_attributes.render_color_index = me.color_attributes.active_color_index
    return layer

def paint(me, fn):
    """Sets every corner colour from fn(polygon, vertex index) -> linear rgb."""
    layer = vcol_layer(me)
    for poly in me.polygons:
        for li in poly.loop_indices:
            vi = me.loops[li].vertex_index
            r, g, b = fn(poly, vi)
            layer.data[li].color = (r, g, b, 1.0)

# ---------------------------------------------------------------- layout

class Layout:
    def __init__(self, board_id):
        self.data = json.load(open(os.path.join(REPO, "packages", "board-data", "boards", f"{board_id}.json"), encoding="utf8"))
        w = self.data["world"]
        ref = self.data["reference"]
        self.W, self.H = ref["width"], ref["height"]
        self.scale, self.cx, self.cy = w["scale"], w["cx"], w["cy"]
        self.theme = w.get("theme", "day")
        self.spaces = {s["id"]: s for s in self.data["spaces"]}
        self.pos = {sid: self.to_world(s["pos"]) for sid, s in self.spaces.items()}
        self.edges = [(s["id"], n) for s in self.data["spaces"] for n in s["next"]]
        # the outer loop: follow first exits from the start until we're back
        loop, cur = [], self.data["startSpace"]
        while cur not in loop:
            loop.append(cur)
            cur = self.spaces[cur]["next"][0]
        self.loop = loop
        self.poly = [self.pos[i] for i in loop]
        self.centre = sum(self.poly, Vector()) / len(self.poly)

    def to_world(self, p):
        return Vector(((p["x"] * self.W - self.cx) * self.scale, -(p["y"] * self.H - self.cy) * self.scale, 0))

    def direction(self, sid):
        a = self.pos[sid]
        b = self.pos[self.spaces[sid]["next"][0]]
        d = (b - a)
        return d.normalized() if d.length else Vector((1, 0, 0))

    def path_dist(self, p):
        best = 1e9
        for a, b in self.edges:
            A, B = self.pos[a], self.pos[b]
            AB = B - A
            t = max(0, min(1, (p - A).dot(AB) / max(AB.length_squared, 1e-9)))
            best = min(best, (A + AB * t - p).xy.length)
        return best

    def inside(self, p):
        x, y = p.x, p.y
        c = False
        n = len(self.poly)
        for i in range(n):
            a, b = self.poly[i], self.poly[(i + 1) % n]
            if (a.y > y) != (b.y > y) and x < (b.x - a.x) * (y - a.y) / (b.y - a.y + 1e-12) + a.x:
                c = not c
        return c

# ---------------------------------------------------------------- pieces

def build_terrain(L, T, margin=4.5):
    xs = [p.x for p in L.pos.values()]
    ys = [p.y for p in L.pos.values()]
    minx, maxx, miny, maxy = min(xs) - margin - 6, max(xs) + margin + 6, min(ys) - margin - 6, max(ys) + margin + 6
    nx, ny = 170, 140
    bm = bmesh.new()
    verts = []
    for j in range(ny + 1):
        row = []
        for i in range(nx + 1):
            x = minx + (maxx - minx) * i / nx
            y = miny + (maxy - miny) * j / ny
            p = Vector((x, y, 0))
            d = L.path_dist(p)
            # signed distance to the island edge: negative inside the loop
            edge = -d if L.inside(p) else d
            wobble = noise.noise(Vector((x * 0.12, y * 0.12, 3.1))) * 1.6
            out = edge - margin + wobble
            if out > 0:
                z = -min(4.0, out * 1.6)
            else:
                # gentle hills away from the paths, flat on and near them
                hill = max(0.0, min(1.0, (d - 2.0) / 4.0))
                z = hill * (0.9 * (noise.noise(Vector((x * 0.09, y * 0.09, 7.7))) + 0.35))
                z = max(z, 0.0)
            row.append(bm.verts.new((x, y, z)))
        verts.append(row)
    for j in range(ny):
        for i in range(nx):
            bm.faces.new((verts[j][i], verts[j][i + 1], verts[j + 1][i + 1], verts[j + 1][i]))
    # drop the faces that are entirely deep below (the island's underside)
    for f in [f for f in bm.faces if all(v.co.z < -3.9 for v in f.verts)]:
        bm.faces.remove(f)
    for v in [v for v in bm.verts if not v.link_faces]:
        bm.verts.remove(v)
    me = bpy.data.meshes.new("Terrain_" + L.data["id"])
    bm.to_mesh(me)
    bm.free()
    for p in me.polygons:
        p.use_smooth = False
    me.materials.append(bpy.data.materials["Terrain"])
    g1, g2, sl = srgb(T["grass"]), srgb(T["grass2"]), srgb(T["slope"])
    def shade(poly, vi):
        # by each corner's own height, so the grass blends into the cliff
        c = me.vertices[vi].co
        t = 0.5 + 0.5 * noise.noise(c * 0.18)
        grass = tuple(a + (b - a) * t for a, b in zip(g1, g2))
        k = max(0.0, min(1.0, (-c.z - 0.1) / 0.6))
        dirt = tuple(x * (0.85 + 0.15 * noise.noise(c * 0.5)) for x in sl)
        return tuple(g + (d - g) * k for g, d in zip(grass, dirt))
    paint(me, shade)
    ob = bpy.data.objects.new("Terrain", me)
    return link(ob, "Terrain")

def build_sea(L, T):
    bm = bmesh.new()
    r = 80
    c = L.centre
    q = [bm.verts.new((c.x + dx * r, c.y + dy * r, -1.5)) for dx, dy in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
    bm.faces.new(q)
    me = bpy.data.meshes.new("Sea_" + L.data["id"])
    bm.to_mesh(me)
    bm.free()
    me.materials.append(bpy.data.materials["Water"])
    return link(bpy.data.objects.new("River", me), "Water")

def build_paths(L, T, width=1.35):
    bm = bmesh.new()
    seen = set()
    for a, b in L.edges:
        A, B = L.pos[a], L.pos[b]
        d = B - A
        if d.length < 1e-6:
            continue
        side = Vector((-d.y, d.x, 0)).normalized() * width / 2
        z = Vector((0, 0, 0.012))
        q = [bm.verts.new(A + side + z), bm.verts.new(B + side + z), bm.verts.new(B - side + z), bm.verts.new(A - side + z)]
        bm.faces.new(q)
    for sid, p in L.pos.items():
        ring = [bm.verts.new(p + Vector((math.cos(k * math.pi / 8) * 0.95, math.sin(k * math.pi / 8) * 0.95, 0.014))) for k in range(16)]
        bm.faces.new(ring)
    me = bpy.data.meshes.new("Paths_" + L.data["id"])
    bm.to_mesh(me)
    bm.free()
    me.materials.append(bpy.data.materials["Paths"])
    pc = srgb(T["path"])
    paint(me, lambda poly, vi: tuple(x * (0.95 + 0.05 * noise.noise(me.polygons[poly.index].center * 0.7)) for x in pc))
    return link(bpy.data.objects.new("Paths", me), "Paths")

def build_tiles(L, conf):
    variants = conf["shop"]["variants"]
    for sid, s in L.spaces.items():
        mesh = "Tile_" + s["type"]
        if s["type"] == "shop" and s.get("shop") == "pink":
            mesh = "Tile_shop_pink"
        ob = bpy.data.objects.new(f"Space {sid}", bpy.data.meshes[mesh])
        p = L.pos[sid]
        d = L.direction(sid)
        ob.location = (p.x, p.y, 0.05)
        ob.rotation_euler = (0, 0, math.atan2(d.y, d.x))
        ob["space_id"] = sid
        link(ob, "Spaces")

def place(kit, name, loc, rot=0.0, scale=1.0, colname="Trees"):
    ob = bpy.data.objects.new(name, bpy.data.meshes[kit])
    ob.location = loc
    ob.rotation_euler = (0, 0, rot)
    ob.scale = (scale, scale, scale)
    return link(ob, colname)

def outward(L, p):
    d = (p - L.centre)
    d.z = 0
    return d.normalized() if d.length else Vector((0, -1, 0))

def build_landmarks(L):
    start = L.data["startSpace"]
    p, d = L.pos[start], L.direction(start)
    rot = math.atan2(d.y, d.x) - math.pi / 2
    gate = p - d * 1.0
    place("Kit_start_gate", "Start start_gate", (gate.x, gate.y, -0.02), rot, 1.0, "Start")
    if "StartText" in bpy.data.meshes:
        place("StartText", "Start start_text", (gate.x, gate.y, -0.02), rot, 1.0, "Start")
    for sid, s in L.spaces.items():
        q = L.pos[sid]
        if s["type"] == "shop":
            o = outward(L, q)
            spot = q + o * 2.7
            kit = "Kit_shop_pink" if s.get("shop") == "pink" else "Kit_shop"
            place(kit, f"Shop {sid}", (spot.x, spot.y, -0.02), math.atan2(-o.x, o.y), 1.0, "Shops")
        if len(s["next"]) > 1:
            dd = L.direction(sid)
            side = Vector((-dd.y, dd.x, 0)) * 1.4
            spot = q + side
            place("Kit_signpost", f"Signpost {sid}", (spot.x, spot.y, -0.06), math.atan2(dd.y, dd.x) + math.pi / 2, 1.0, "Signposts")

def free_spots(L, terrain, n, min_path, min_gap, taken, rng, inside_only=False, max_z=1.4):
    """Random spots on the island, clear of paths and of each other."""
    me = terrain.data
    zs = {}
    xs = [v.co.x for v in me.vertices]
    ys = [v.co.y for v in me.vertices]
    out = []
    tries = 0
    while len(out) < n and tries < n * 250:
        tries += 1
        p = Vector((rng.uniform(min(xs), max(xs)), rng.uniform(min(ys), max(ys)), 0))
        if inside_only and not L.inside(p):
            continue
        d = L.path_dist(p)
        if d < min_path:
            continue
        z = ground(terrain, p)
        if z is None or z < -0.05 or z > max_z:
            continue
        if any((p.xy - q.xy).length < min_gap for q in taken):
            continue
        p.z = z
        taken.append(p)
        out.append(p)
    return out

def ground(terrain, p):
    ok, loc, _, _ = terrain.ray_cast(Vector((p.x, p.y, 50)), Vector((0, 0, -1)))
    return loc.z if ok else None

def recolour_mesh(src, name, fn):
    """A copy of a kit mesh with its corner colours mapped through fn(rgb) -> rgb."""
    if name in bpy.data.meshes:
        return bpy.data.meshes[name]
    me = bpy.data.meshes[src].copy()
    me.name = name
    layer = me.attributes["Col"]
    for d in layer.data:
        r, g, b, a = d.color
        d.color = (*fn((r, g, b)), a)
    return me

def egg_mesh():
    if "Kit_egg" in bpy.data.meshes:
        return bpy.data.meshes["Kit_egg"]
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=16, v_segments=10, radius=0.5)
    for v in bm.verts:
        v.co.z *= 1.3
        v.co.z += 0.62
    me = bpy.data.meshes.new("Kit_egg")
    bm.to_mesh(me)
    bm.free()
    for p in me.polygons:
        p.use_smooth = True
    me.materials.append(bpy.data.materials["Props"])
    rng = random.Random(4)
    spots = [Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(-0.7, 1))).normalized() for _ in range(7)]
    white, green = srgb((0.97, 0.95, 0.90)), srgb((0.30, 0.72, 0.30))
    def shade(poly, vi):
        c = me.polygons[poly.index].center - Vector((0, 0, 0.62))
        c.z /= 1.3
        c = c.normalized()
        return green if any(c.dot(s) > 0.9 for s in spots) else white
    paint(me, shade)
    return me

def grave_mesh(kind):
    name = f"Kit_grave_{kind}"
    if name in bpy.data.meshes:
        return bpy.data.meshes[name]
    bm = bmesh.new()
    if kind == 0:  # a rounded headstone
        bmesh.ops.create_cube(bm, size=1.0)
        for v in bm.verts:
            v.co.x *= 0.7
            v.co.y *= 0.18
            v.co.z = (v.co.z + 0.5) * 0.75
        top = bmesh.ops.create_cone(bm, cap_ends=True, segments=10, radius1=0.35, radius2=0.35, depth=0.18)
        bmesh.ops.rotate(bm, verts=top["verts"], cent=(0, 0, 0), matrix=__import__("mathutils").Matrix.Rotation(math.pi / 2, 3, "X"))
        bmesh.ops.translate(bm, verts=top["verts"], vec=(0, 0, 0.75))
    else:  # a cross
        a = bmesh.ops.create_cube(bm, size=1.0)
        for v in a["verts"]:
            v.co.x *= 0.16
            v.co.y *= 0.16
            v.co.z = (v.co.z + 0.5) * 1.1
        b = bmesh.ops.create_cube(bm, size=1.0)
        for v in b["verts"]:
            v.co.x *= 0.6
            v.co.y *= 0.15
            v.co.z = v.co.z * 0.15 + 0.78
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(bpy.data.materials["Props"])
    stone = srgb((0.48, 0.45, 0.56))
    paint(me, lambda poly, vi: tuple(x * (0.85 + 0.15 * (me.polygons[poly.index].normal.z)) for x in stone))
    return me

def glow_material():
    if "Glow" in bpy.data.materials:
        return bpy.data.materials["Glow"]
    m = bpy.data.materials.new("Glow")
    m.use_nodes = True
    nt = m.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Base Color"].default_value = (1.0, 0.72, 0.25, 1)
    bsdf.inputs["Emission Color"].default_value = (1.0, 0.62, 0.18, 1)
    bsdf.inputs["Emission Strength"].default_value = 4.0
    return m

def box(bm, lo, hi):
    r = bmesh.ops.create_cube(bm, size=1.0)
    for v in r["verts"]:
        v.co.x = lo[0] if v.co.x < 0 else hi[0]
        v.co.y = lo[1] if v.co.y < 0 else hi[1]
        v.co.z = lo[2] if v.co.z < 0 else hi[2]
    return r

def house_meshes():
    """A small haunted house: walls, a steep roof, a crooked tower, lit windows."""
    if "Kit_house" in bpy.data.meshes:
        return bpy.data.meshes["Kit_house"], bpy.data.meshes["Kit_house_windows"]
    bm = bmesh.new()
    box(bm, (-2.0, -1.5, 0), (2.0, 1.5, 2.6))                  # walls
    roof = bmesh.ops.create_cone(bm, cap_ends=True, segments=4, radius1=3.2, radius2=0.0, depth=2.6)
    bmesh.ops.rotate(bm, verts=roof["verts"], cent=(0, 0, 0), matrix=__import__("mathutils").Matrix.Rotation(math.pi / 4, 3, "Z"))
    bmesh.ops.scale(bm, vec=(1.0, 0.75, 1.0), verts=roof["verts"])
    bmesh.ops.translate(bm, verts=roof["verts"], vec=(0, 0, 3.9))
    box(bm, (1.2, -0.9, 0), (2.6, 0.5, 4.6))                   # tower
    cap = bmesh.ops.create_cone(bm, cap_ends=True, segments=6, radius1=1.15, radius2=0.0, depth=2.0)
    bmesh.ops.translate(bm, verts=cap["verts"], vec=(1.9, -0.2, 5.6))
    box(bm, (-0.4, -1.56, 0), (0.4, -1.5, 1.4))                 # door
    me = bpy.data.meshes.new("Kit_house")
    bm.to_mesh(me)
    bm.free()
    me.materials.append(bpy.data.materials["Props"])
    wall, roofc, door = srgb((0.30, 0.22, 0.40)), srgb((0.13, 0.08, 0.18)), srgb((0.10, 0.06, 0.08))
    def shade(poly, vi):
        c = me.polygons[poly.index].center
        n = me.polygons[poly.index].normal
        if c.y < -1.52 and abs(c.x) < 0.45 and c.z < 1.45:
            return door
        if c.z > 2.65 or (n.z > 0.2 and c.z > 2.5):
            return roofc
        return tuple(x * (0.8 + 0.2 * abs(n.x)) for x in wall)
    paint(me, shade)
    # windows: small glowing panes on the front and the tower
    bm = bmesh.new()
    for (x, z) in [(-1.3, 1.6), (0.9, 1.6), (-1.3, 0.6), (1.9, 3.4)]:
        y = -1.53 if x < 1.5 else -0.93
        box(bm, (x - 0.32, y - 0.03, z - 0.35), (x + 0.32, y + 0.0, z + 0.35))
    wm = bpy.data.meshes.new("Kit_house_windows")
    bm.to_mesh(wm)
    bm.free()
    wm.materials.append(glow_material())
    return me, wm

def lantern_meshes():
    if "Kit_lantern" in bpy.data.meshes:
        return bpy.data.meshes["Kit_lantern"], bpy.data.meshes["Kit_lantern_light"]
    bm = bmesh.new()
    box(bm, (-0.06, -0.06, 0), (0.06, 0.06, 1.5))
    box(bm, (-0.2, -0.2, 1.5), (0.2, 0.2, 1.58))
    box(bm, (-0.22, -0.22, 1.98), (0.22, 0.22, 2.06))
    me = bpy.data.meshes.new("Kit_lantern")
    bm.to_mesh(me)
    bm.free()
    me.materials.append(bpy.data.materials["Props"])
    dark = srgb((0.12, 0.10, 0.14))
    paint(me, lambda p, v: dark)
    bm = bmesh.new()
    box(bm, (-0.16, -0.16, 1.58), (0.16, 0.16, 1.98))
    lm = bpy.data.meshes.new("Kit_lantern_light")
    bm.to_mesh(lm)
    bm.free()
    lm.materials.append(glow_material())
    return me, lm

def scatter_day(L, terrain, rng):
    taken = [p.copy() for p in L.pos.values()]
    rounds = [m for m in ("Kit_tree_round_0", "Kit_tree_round_1", "Kit_tree_round_2", "Kit_tree_round_3")]
    for i, p in enumerate(free_spots(L, terrain, 34, 2.6, 2.4, taken, rng)):
        place(rng.choice(rounds), f"tree_round_{i}", p, rng.uniform(0, 6.28), rng.uniform(0.85, 1.15), "Trees")
    for i, p in enumerate(free_spots(L, terrain, 50, 1.7, 1.3, taken, rng)):
        place(f"Kit_bush_{rng.randrange(4)}", f"bush_{i}", p, rng.uniform(0, 6.28), rng.uniform(0.7, 1.1), "Bushes")
    for i, p in enumerate(free_spots(L, terrain, 110, 1.2, 0.9, taken, rng)):
        place(f"Kit_flowers_{rng.randrange(4)}", f"flowers_{i}", p, rng.uniform(0, 6.28), rng.uniform(0.9, 1.3), "Flowers")
    for i, p in enumerate(free_spots(L, terrain, 260, 1.0, 0.5, taken, rng)):
        place(f"Kit_grass_{rng.randrange(3)}", f"grass_{i}", p, rng.uniform(0, 6.28), rng.uniform(1.1, 1.6), "Grass")
    for i, p in enumerate(free_spots(L, terrain, 14, 1.6, 1.2, taken, rng)):
        place(rng.choice(["Kit_mushroom_small_red", "Kit_mushroom_small_brown"]), f"mushroom_small_{i}", p, rng.uniform(0, 6.28), rng.uniform(0.9, 1.3), "Mushrooms")
    for i, p in enumerate(free_spots(L, terrain, 10, 2.0, 2.0, taken, rng)):
        place(f"Kit_rock_{rng.randrange(4)}", f"rock_{i}", (p.x, p.y, p.z - 0.3), rng.uniform(0, 6.28), rng.uniform(0.8, 1.2), "Rocks")
    # Yoshi eggs: lots of small ones, a few giants
    egg = egg_mesh()
    for i, p in enumerate(free_spots(L, terrain, 24, 1.8, 1.8, taken, rng)):
        ob = bpy.data.objects.new(f"Egg {i}", egg)
        ob.location = p
        ob.rotation_euler = (rng.uniform(-0.25, 0.25), rng.uniform(-0.25, 0.25), rng.uniform(0, 6.28))
        s = rng.uniform(1.1, 1.8)
        ob.scale = (s, s, s)
        link(ob, "Eggs")
    for i, p in enumerate(free_spots(L, terrain, 5, 3.2, 4.5, taken, rng, max_z=3)):
        ob = bpy.data.objects.new(f"Egg Giant {i}", egg)
        ob.location = p
        ob.rotation_euler = (rng.uniform(-0.12, 0.12), rng.uniform(-0.12, 0.12), rng.uniform(0, 6.28))
        ob.scale = (3.2, 3.2, 3.2)
        link(ob, "Eggs")
    for i, p in enumerate(free_spots(L, terrain, 4, 3.4, 5.0, taken, rng, max_z=3)):
        place(rng.choice(["Kit_mushroom_giant_red", "Kit_mushroom_green", "Kit_mushroom_tall_red", "Kit_mushroom_orange"]), f"Mushroom Giant {i}", p, rng.uniform(0, 6.28), rng.uniform(0.9, 1.1), "Mushrooms")
    # clouds round the island
    for i in range(12):
        a = i / 12 * 6.28 + rng.uniform(-0.2, 0.2)
        r = rng.uniform(34, 44)
        place(f"Kit_cloud_{rng.randrange(3)}", f"Cloud {i}", (L.centre.x + math.cos(a) * r, L.centre.y + math.sin(a) * r * 0.75, rng.uniform(-2, 4)), rng.uniform(0, 6.28), rng.uniform(1.2, 2.0), "Sky")

def scatter_night(L, terrain, rng):
    taken = [p.copy() for p in L.pos.values()]
    # dead trees: the pines drained to a dark purple-grey (by brightness, so no green survives)
    def dark(rgb):
        l = (rgb[0] + rgb[1] + rgb[2]) / 3
        return (l * 0.55 + 0.05, l * 0.42 + 0.03, l * 0.75 + 0.08)
    dead = [recolour_mesh(f"Kit_tree_pine_{k}", f"Kit_tree_dead2_{k}", dark).name for k in range(3)]
    for i, p in enumerate(free_spots(L, terrain, 26, 2.4, 2.4, taken, rng)):
        place(rng.choice(dead), f"tree_dead_{i}", p, rng.uniform(0, 6.28), rng.uniform(0.8, 1.2), "Trees")
    rocks = [recolour_mesh(f"Kit_rock_{k}", f"Kit_rock_night_{k}", lambda c: (c[0] * 0.55, c[1] * 0.5, c[2] * 0.7)).name for k in range(4)]
    for i, p in enumerate(free_spots(L, terrain, 16, 1.8, 1.8, taken, rng)):
        place(rng.choice(rocks), f"rock_{i}", (p.x, p.y, p.z - 0.3), rng.uniform(0, 6.28), rng.uniform(0.8, 1.3), "Rocks")
    grass = [recolour_mesh(f"Kit_grass_{k}", f"Kit_grass_night_{k}", lambda c: (c[0] * 0.5 + 0.08, c[1] * 0.35, c[2] * 0.6 + 0.1)).name for k in range(3)]
    for i, p in enumerate(free_spots(L, terrain, 160, 1.0, 0.5, taken, rng)):
        place(rng.choice(grass), f"grass_{i}", p, rng.uniform(0, 6.28), rng.uniform(1.1, 1.6), "Grass")
    mush = [recolour_mesh(k, k + "_night", lambda c: (c[2] * 0.8 + 0.15, c[1] * 0.4, c[0] * 0.9 + 0.1)).name for k in ("Kit_mushroom_small_red", "Kit_mushroom_small_brown")]
    for i, p in enumerate(free_spots(L, terrain, 16, 1.4, 1.0, taken, rng)):
        place(rng.choice(mush), f"mushroom_small_{i}", p, rng.uniform(0, 6.28), rng.uniform(0.9, 1.4), "Mushrooms")
    # graves, in little clusters
    for i, p in enumerate(free_spots(L, terrain, 24, 1.5, 1.2, taken, rng)):
        ob = bpy.data.objects.new(f"Grave {i}", grave_mesh(rng.randrange(2)))
        ob.location = (p.x, p.y, p.z - 0.05)
        ob.rotation_euler = (rng.uniform(-0.12, 0.12), rng.uniform(-0.1, 0.1), rng.uniform(0, 6.28))
        s = rng.uniform(0.8, 1.15)
        ob.scale = (s, s, s)
        link(ob, "Graves")
    # the haunted house: the open spot inside the loop furthest from any path
    best, best_d = None, -1
    for _ in range(400):
        p = Vector((rng.uniform(L.centre.x - 12, L.centre.x + 12), rng.uniform(L.centre.y - 9, L.centre.y + 9), 0))
        if not L.inside(p):
            continue
        d = L.path_dist(p)
        if d > best_d:
            best, best_d = p, d
    walls, windows = house_meshes()
    s = max(0.6, min(1.15, (best_d - 1.2) / 3.2))
    g = ground(terrain, best) or 0
    toward = (L.pos[L.data["startSpace"]] - best)
    rot = math.atan2(-toward.x, toward.y) + math.pi
    for mesh, name in ((walls, "House"), (windows, "House windows")):
        ob = bpy.data.objects.new(name, mesh)
        ob.location = (best.x, best.y, g - 0.05)
        ob.rotation_euler = (0, 0, rot)
        ob.scale = (s, s, s)
        link(ob, "House")
    taken.append(best)
    # lanterns along the path
    post, light = lantern_meshes()
    for k, sid in enumerate(L.loop[2::4]):
        q = L.pos[sid]
        d = L.direction(sid)
        side = Vector((-d.y, d.x, 0)) * (1.25 if k % 2 else -1.25)
        spot = q + side
        for mesh, name in ((post, f"Lantern {k}"), (light, f"Lantern light {k}")):
            ob = bpy.data.objects.new(name, mesh)
            ob.location = (spot.x, spot.y, (ground(terrain, spot) or 0) - 0.02)
            link(ob, "Lanterns")

def setup_light(T):
    sun = bpy.data.objects["Sun"]
    sun.data.color = T["sun"]
    sun.data.energy = T["sun_energy"]
    w = bpy.context.scene.world
    bg = next(n for n in w.node_tree.nodes if n.type == "BACKGROUND")
    bg.inputs[0].default_value = (*T["world"], 1)

INCLUDE = ["Terrain", "Water", "Paths", "Bridges", "Trees", "Bushes", "Rocks", "Flowers", "Grass", "Mushrooms", "Fences",
           "Shops", "Signposts", "Start", "Sky", "Eggs", "Graves", "House", "Lanterns"]

def export(L):
    board_id = L.data["id"]
    glb = os.path.join(REPO, "apps", "web", "public", "models", f"board-{board_id}.glb")
    bpy.ops.object.select_all(action="DESELECT")
    for c in INCLUDE:
        for o in col(c).all_objects:
            if o.type == "MESH":
                o.select_set(True)
    import io, contextlib
    with contextlib.redirect_stdout(io.StringIO()):
        bpy.ops.export_scene.gltf(filepath=glb, export_format="GLB", use_selection=True, export_draco_mesh_compression_enable=True,
                                  export_draco_mesh_compression_level=7, export_apply=True, export_yup=True, export_vertex_color="MATERIAL",
                                  export_lights=False, export_cameras=False)
    bpy.ops.object.select_all(action="DESELECT")
    return glb

def render_backdrop(L, ratio=2):
    board_id = L.data["id"]
    scene = bpy.context.scene
    cam = bpy.data.objects["DiscordCam"]
    xs = [p.x for p in L.pos.values()]
    ys = [p.y for p in L.pos.values()]
    W, H = 1000 * ratio, 720 * ratio
    cx, cy = (max(xs) + min(xs)) / 2, (max(ys) + min(ys)) / 2
    prev = scene.camera
    scene.camera = cam
    scene.render.resolution_x, scene.render.resolution_y, scene.render.resolution_percentage = W, H, 100
    # frame the whole island (terrain edge included) with a little margin: start
    # roughly, then correct the zoom and the offset from where it actually lands
    cam.data.shift_x = cam.data.shift_y = 0
    cam.location = (cx, cy - 13.8, 58.46)
    cam.data.ortho_scale = 50
    terrain = bpy.data.objects["Terrain"]
    pts = [terrain.matrix_world @ v.co for v in terrain.data.vertices if v.co.z > -1.2][::7]
    for _ in range(4):
        bpy.context.view_layer.update()
        vs = [world_to_camera_view(scene, cam, p) for p in pts]
        x0, x1 = min(v.x for v in vs), max(v.x for v in vs)
        y0, y1 = min(v.y for v in vs), max(v.y for v in vs)
        span = max(x1 - x0, y1 - y0)
        cam.data.ortho_scale *= span / 0.94
        cam.data.shift_x += ((x0 + x1) / 2 - 0.5) * (1 if span else 0)
        cam.data.shift_y += ((y0 + y1) / 2 - 0.5) * 720 / 1000
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    assets = os.path.join(REPO, "packages", "discord", "assets")
    scene.render.filepath = os.path.join(assets, f"backdrop-{board_id}.png")
    bpy.ops.render.render(write_still=True)
    spaces = {}
    for o in col("Spaces").objects:
        v = world_to_camera_view(scene, cam, o.location + Vector((0, 0, 0.27)))
        spaces[o["space_id"]] = [round(v.x * W, 1), round((1 - v.y) * H, 1)]
    json.dump({"layout": board_id, "image": f"backdrop-{board_id}.png", "width": W, "height": H, "pixelRatio": ratio,
               "pxPerMetre": round(W / cam.data.ortho_scale, 3), "spaces": spaces},
              open(os.path.join(assets, f"backdrop-{board_id}.json"), "w"), indent=1)
    scene.render.film_transparent = False
    scene.render.image_settings.color_mode = "RGB"
    scene.camera = prev

def build(board_id, seed=7):
    assert os.path.basename(bpy.data.filepath) == "board.blend", "open art/board.blend first"
    L = Layout(board_id)
    T = THEMES[L.theme]
    conf = json.load(open(os.path.join(REPO, "packages", "board-data", "season-config.json"), encoding="utf8"))
    rng = random.Random(seed)
    # work on a copy: never overwrite board.blend
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(REPO, "art", f"board-{board_id}.blend"))
    clear_board()
    terrain = build_terrain(L, T)
    if T["sea"]:
        build_sea(L, T)
    build_paths(L, T)
    build_tiles(L, conf)
    build_landmarks(L)
    bpy.context.view_layer.update()
    (scatter_day if L.theme == "day" else scatter_night)(L, terrain, rng)
    setup_light(T)
    glb = export(L)
    render_backdrop(L)
    bpy.ops.wm.save_mainfile()
    return f"{board_id}: glb {os.path.getsize(glb) // 1024} KB"
