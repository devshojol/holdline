"""Shared by make_weapons.py and make_bots.py: the palette and the part builder.

Parts are written in the game's axes (x right, y up, z forward, metres) and turned into Blender's
on creation; the glTF exporter's Y-up conversion turns them back.
"""
import math

import bmesh
import bpy
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

# game axes -> Blender axes (a rotation; the exporter's Y-up conversion undoes it)
G2B = Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))

# ---------------------------------------------------------------- materials
PALETTE = {
    # name: (base colour, metallic, roughness, emission strength)
    "anodized": ((0.16, 0.165, 0.18), 0.65, 0.38, 0),    # black anodized aluminium (receivers, rails)
    "parkerized": ((0.19, 0.19, 0.2), 0.75, 0.48, 0),   # phosphate-finished steel (barrels, magazines)
    "blued": ((0.16, 0.18, 0.24), 0.9, 0.22, 0),          # blued steel (revolver)
    "walnut": ((0.17, 0.07, 0.03), 0.0, 0.38, 0),        # oiled wood grip
    "lens": ((0.02, 0.05, 0.09), 1.0, 0.05, 0),          # coated glass
    "dot": ((0.9, 0.95, 0.85), 0.0, 0.5, 1.0),           # painted sight dot
    "olive": ((0.085, 0.1, 0.055), 0.0, 0.6, 0),         # green polymer stock
    "fde": ((0.34, 0.26, 0.15), 0.45, 0.45, 0),          # flat dark earth coating on metal
    "tan": ((0.3, 0.23, 0.13), 0.0, 0.6, 0),             # tan polymer furniture
    "bakelite": ((0.3, 0.09, 0.025), 0.0, 0.32, 0),      # red-brown moulded magazine
    "glass": ((0.5, 0.75, 0.8), 0.0, 0.05, 0, 0.1),      # optic glass, nearly clear
    "reddot": ((1.0, 0.05, 0.02), 0.0, 0.5, 8.0),        # the aiming dot
    "void": ((0.004, 0.004, 0.004), 0.0, 1.0, 0),        # openings and slots
    "polymer": ((0.035, 0.036, 0.038), 0.0, 0.55, 0),    # black glass-filled polymer
    "frame": ((0.11, 0.12, 0.14), 0.55, 0.42, 0),     # mid-grey machined frame
    "steel": ((0.5, 0.5, 0.52), 1.0, 0.24, 0),           # bare steel (bolts, pins, triggers)
    "ceramic": ((0.80, 0.78, 0.72), 0.0, 0.36, 0),    # bone-white panels
    "rubber": ((0.02, 0.02, 0.021), 0.0, 0.95, 0),       # grips, pads
    "volt": ((0.62, 1.0, 0.08), 0.0, 0.45, 1.6),      # brand accent (lime)
    "glow": ((0.10, 0.85, 1.0), 0.0, 0.3, 4.0),       # sights, lenses (cyan)
}


# How dark the flat of each finish is next to its worn edges (1 = no edge wear).
WEAR = {"anodized": 0.45, "parkerized": 0.5, "steel": 0.8, "frame": 0.7, "blued": 0.6, "fde": 0.75}


# material name -> image used as its base colour (see camo_texture); the mesh needs UVs (Part.uv_scale)
TEXTURES = {}


def camo_texture(name, colours, seed, path, size=256):
    """A tileable four-colour camouflage pattern with a fine cloth grain, saved to `path`. Colours are linear RGB."""
    import numpy as np
    rng = np.random.default_rng(seed)
    f2 = np.fft.fftfreq(size)[:, None] ** 2 + np.fft.fftfreq(size)[None, :] ** 2

    def blobs(scale):
        n = np.real(np.fft.ifft2(np.fft.fft2(rng.standard_normal((size, size))) * np.exp(-f2 * scale * scale)))
        return (n - n.mean()) / n.std()
    a, b, c = blobs(24) + 0.5 * blobs(10), blobs(18), blobs(9)
    idx = np.zeros((size, size), int)
    idx[a > 0.1] = 1
    idx[b > 0.7] = 2
    idx[c > 1.15] = 3
    img = np.array(colours, dtype=np.float64)[idx]
    weave = 1 + 0.07 * rng.standard_normal((size, size, 1)) + 0.05 * np.sin(np.arange(size) * 2.1)[None, :, None] * np.sin(np.arange(size) * 2.1)[:, None, None]
    img = np.clip(img * weave, 0, 1) ** (1 / 2.2)  # stored sRGB
    rgba = np.concatenate([img, np.ones((size, size, 1))], axis=-1).astype(np.float32)
    old = bpy.data.images.get(name)
    if old:
        bpy.data.images.remove(old)
    image = bpy.data.images.new(name, size, size)
    image.pixels.foreach_set(rgba.ravel())
    image.filepath_raw = path
    image.file_format = "PNG"
    image.save()
    TEXTURES[name] = image
    return image


# ---- surface detail: what stops a finish from looking like smooth plastic
# material name -> kind of surface. Only used when USE_SURFACES is on (the guns) and the mesh has UVs.
SURFACE_KIND = {"fde": "metal", "tan": "polymer", "bakelite": "polymer", "anodized": "metal", "parkerized": "metal", "blued": "metal", "steel": "metal", "frame": "metal",
                "polymer": "polymer", "olive": "polymer", "rubber": "polymer", "walnut": "wood"}
SURFACES = {}       # material name -> (colour, roughness/metallic, normal) images
USE_SURFACES = False
DEFAULT_UV = None   # metres per texture repeat given to new Parts
SURFACE_DIR = None  # where the generated images are saved


def _save_image(name, rgb, path, data=False):
    import numpy as np
    size = rgb.shape[0]
    rgba = np.concatenate([np.clip(rgb, 0, 1), np.ones((size, size, 1))], axis=-1).astype(np.float32)
    old = bpy.data.images.get(name)
    if old:
        bpy.data.images.remove(old)
    image = bpy.data.images.new(name, size, size)
    image.pixels.foreach_set(rgba.ravel())
    image.filepath_raw = path
    image.file_format = "PNG"
    image.save()
    if data:
        image.colorspace_settings.name = "Non-Color"
    return image


def surface_textures(name, size=256):
    """Tileable colour, roughness/metallic and normal maps for one finish: fine grain, uneven sheen, and on
    metal, scratches and scuffs worn through to brighter bare metal."""
    import numpy as np
    import os as _os
    colour, metal, rough, _ = PALETTE[name]
    kind = SURFACE_KIND[name]
    rng = np.random.default_rng(sum(map(ord, name)))
    f2 = np.fft.fftfreq(size)[:, None] ** 2 + np.fft.fftfreq(size)[None, :] ** 2

    def noise(scale, stretch=1.0):
        f = np.fft.fftfreq(size)[:, None] ** 2 * stretch + np.fft.fftfreq(size)[None, :] ** 2 / stretch
        n = np.real(np.fft.ifft2(np.fft.fft2(rng.standard_normal((size, size))) * np.exp(-f * scale * scale)))
        return (n - n.mean()) / (n.std() or 1)

    def blur(a, scale):
        return np.real(np.fft.ifft2(np.fft.fft2(a) * np.exp(-f2 * scale * scale)))

    blotch = noise(30)
    cloud = noise(70)
    scratch = np.zeros((size, size))
    if kind == "metal":
        main = rng.uniform(0, math.pi)
        for _ in range(16):                                              # handling scratches, mostly one way
            ang = main + rng.normal(0, 0.35)
            x, y = rng.uniform(0, size, 2)
            ln = rng.uniform(6, 60)
            k = rng.uniform(0.2, 0.8)
            for t in np.arange(0, ln, 0.5):
                scratch[int(y + math.sin(ang) * t) % size, int(x + math.cos(ang) * t) % size] = k
        for _ in range(5):                                              # dings
            x, y = rng.integers(0, size, 2)
            scratch[y, x] = 1.0
        scratch = np.clip(blur(scratch, 0.7) * 1.5, 0, 1)
        scuff = np.clip((cloud - 1.5) * 0.5, 0, 1)                      # rubbed patches
        wear = np.clip(scratch + scuff * 0.5, 0, 1)
        height = noise(1.2) * 0.1 + blotch * 0.04 - scratch * 0.45
        bare = np.array([0.62, 0.62, 0.64])
        col = np.array(colour)[None, None, :] * (1 + 0.05 * blotch[..., None] - 0.06 * np.clip(-cloud, 0, 2)[..., None])
        col = col * (1 - 0.5 * wear[..., None]) + bare * 0.5 * wear[..., None]
        r = rough + 0.05 * blotch + 0.06 * cloud - 0.15 * wear
        m = np.clip(metal + 0.3 * wear, 0, 1)
        strength = 1.0
    elif kind == "polymer":
        height = noise(1.6) * 0.3 + noise(4) * 0.1                      # moulded pebble grain
        scuff = np.clip((cloud - 1.2) * 0.8, 0, 1)
        col = np.array(colour)[None, None, :] * (1 + 0.08 * blotch[..., None]) + 0.05 * scuff[..., None]
        r = rough + 0.08 * blotch + 0.12 * scuff
        m = np.full((size, size), metal)
        strength = 1.0
    else:                                                               # wood: grain running along one axis
        grain = noise(3, stretch=40) * 0.7 + noise(12, stretch=14) * 0.6
        height = grain * 0.5
        col = np.array(colour)[None, None, :] * (1 + 0.3 * grain[..., None] + 0.08 * blotch[..., None])
        r = rough + 0.1 * grain
        m = np.full((size, size), metal)
        strength = 1.6
    gx = (np.roll(height, -1, axis=1) - np.roll(height, 1, axis=1)) * strength * 0.5
    gy = (np.roll(height, -1, axis=0) - np.roll(height, 1, axis=0)) * strength * 0.5
    nz = 1 / np.sqrt(gx * gx + gy * gy + 1)
    nrm = np.stack([-gx * nz * 0.5 + 0.5, -gy * nz * 0.5 + 0.5, nz * 0.5 + 0.5], axis=-1)
    orm = np.stack([np.ones((size, size)), np.clip(r, 0.06, 1), m], axis=-1)   # glTF: G roughness, B metallic
    d = SURFACE_DIR or _os.path.join(ROOT, "tools", "blender", "out")
    out = (_save_image(f"surf-{name}-col", np.clip(col, 0, 1) ** (1 / 2.2), _os.path.join(d, f"surf-{name}-col.png")),
           _save_image(f"surf-{name}-orm", orm, _os.path.join(d, f"surf-{name}-orm.png"), data=True),
           _save_image(f"surf-{name}-nrm", nrm, _os.path.join(d, f"surf-{name}-nrm.png"), data=True))
    SURFACES[name] = out
    return out


def material(name):
    mat = bpy.data.materials.get("hl_" + name)
    if mat:
        return mat
    colour, metal, rough, emit = PALETTE[name][:4]
    alpha = PALETTE[name][4] if len(PALETTE[name]) > 4 else 1.0
    mat = bpy.data.materials.new("hl_" + name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*colour, 1)
    bsdf.inputs["Metallic"].default_value = metal
    bsdf.inputs["Roughness"].default_value = rough
    if emit:
        bsdf.inputs["Emission Color"].default_value = (*colour, 1)
        bsdf.inputs["Emission Strength"].default_value = emit
    mat.diffuse_color = (*colour, 1)
    if alpha < 1:  # see-through (optic glass): exported as a blended material
        bsdf.inputs["Alpha"].default_value = alpha
        for attr_name, value in (("surface_render_method", "BLENDED"), ("blend_method", "BLEND")):
            try:
                setattr(mat, attr_name, value)
            except (AttributeError, TypeError):
                pass
    # base colour x the baked shading in the "Col" colour attribute (exported as vertex colours)
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    attr = nodes.new("ShaderNodeVertexColor")
    attr.layer_name = "Col"
    mix = nodes.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    mix.blend_type = "MULTIPLY"
    sock = {i.identifier: i for i in mix.inputs}
    sock["Factor_Float"].default_value = 1.0
    sock["A_Color"].default_value = (*colour, 1)
    links.new(attr.outputs["Color"], sock["B_Color"])
    if name in TEXTURES:
        tex = nodes.new("ShaderNodeTexImage")
        tex.image = TEXTURES[name]
        links.new(tex.outputs["Color"], sock["A_Color"])
    if USE_SURFACES and name in SURFACE_KIND:
        col, orm, nrm = SURFACES.get(name) or surface_textures(name)
        tex = nodes.new("ShaderNodeTexImage")
        tex.image = col
        links.new(tex.outputs["Color"], sock["A_Color"])
        data = nodes.new("ShaderNodeTexImage")
        data.image = orm
        sep = nodes.new("ShaderNodeSeparateColor")
        links.new(data.outputs["Color"], sep.inputs[0])
        links.new(sep.outputs[1], bsdf.inputs["Roughness"])
        links.new(sep.outputs[2], bsdf.inputs["Metallic"])
        bump = nodes.new("ShaderNodeTexImage")
        bump.image = nrm
        nmap = nodes.new("ShaderNodeNormalMap")
        links.new(bump.outputs["Color"], nmap.inputs["Color"])
        links.new(nmap.outputs["Normal"], bsdf.inputs["Normal"])
    links.new(next(o for o in mix.outputs if o.identifier == "Result_Color"), bsdf.inputs["Base Color"])
    return mat


# ---------------------------------------------------------------- part builder
class Part:
    """One exported node: a bmesh that boxes, wedges and tubes are added to (game axes)."""

    def __init__(self, name):
        self.name = name
        self.bm = bmesh.new()
        self.mats = []
        # skinning (characters): bone names, and the weights given to whatever is added next:
        # a bone name, or a function of the vertex position (game axes) returning {bone: weight}
        self.bones = []
        self.skin = None
        self.weld = True
        self.uv_scale = DEFAULT_UV  # metres per texture repeat: gives the mesh box-projected UVs
        self.bm.verts.layers.deform.verify()  # made up front: adding a layer later invalidates vertex references

    def _mark(self):
        """Remember what exists, so _added() can find what the next operation creates. (Blender reuses freed
        vertex slots, so new vertices are not simply the last ones in the list.)"""
        for v in self.bm.verts:
            v.tag = True

    def _added(self):
        out = [v for v in self.bm.verts if not v.tag]
        for v in out:
            v.tag = True
        return out

    def _weigh(self, verts):
        if self.skin is None:
            return
        layer = self.bm.verts.layers.deform.verify()
        for v in verts:
            w = {self.skin: 1.0} if isinstance(self.skin, str) else self.skin(v.co)
            total = sum(w.values()) or 1.0
            for bone, k in w.items():
                if k <= 0:
                    continue
                if bone not in self.bones:
                    self.bones.append(bone)
                v[layer][self.bones.index(bone)] = k / total

    def _slot(self, mat):
        if mat not in self.mats:
            self.mats.append(mat)
        return self.mats.index(mat)

    def _finish(self, geom_verts, mat, at, rot, smooth_sides=False):
        m = Matrix.Translation(Vector(at))
        if rot:
            rx, ry, rz = (math.radians(a) for a in rot)
            m = m @ Matrix.Rotation(ry, 4, "Y") @ Matrix.Rotation(rx, 4, "X") @ Matrix.Rotation(rz, 4, "Z")
        bmesh.ops.transform(self.bm, matrix=m, verts=geom_verts)
        self._weigh(geom_verts)
        slot = self._slot(mat)
        faces = {f for v in geom_verts for f in v.link_faces}
        for f in faces:
            f.material_index = slot
            f.smooth = smooth_sides and len(f.verts) == 4 and abs(f.normal.z) < 0.5

    def box(self, size, at, mat="polymer", bevel=0.004, rot=None, taper=None):
        """size = (width x, height y, length z). taper = (x scale, y scale) of the +z end."""
        tmp = bmesh.new()
        for v in bmesh.ops.create_cube(tmp, size=1.0)["verts"]:
            v.co.x *= size[0]
            v.co.y *= size[1]
            v.co.z *= size[2]
            if taper and v.co.z > 0:
                v.co.x *= taper[0]
                v.co.y *= taper[1]
        if bevel:
            bmesh.ops.bevel(tmp, geom=list(tmp.edges), offset=min(bevel, min(size) * 0.45), segments=1, affect="EDGES", profile=0.5)
        m = Matrix.Translation(Vector(at))
        if rot:
            rx, ry, rz = (math.radians(a) for a in rot)
            m = m @ Matrix.Rotation(ry, 4, "Y") @ Matrix.Rotation(rx, 4, "X") @ Matrix.Rotation(rz, 4, "Z")
        bmesh.ops.transform(tmp, matrix=m, verts=tmp.verts)
        self._merge(tmp, mat)
        return self

    def _merge(self, tmp, mat):
        slot = self._slot(mat)
        bmesh.ops.recalc_face_normals(tmp, faces=tmp.faces)
        for f in tmp.faces:
            f.material_index = slot
        me = bpy.data.meshes.new("tmp")
        tmp.to_mesh(me)
        tmp.free()
        self._mark()
        self.bm.from_mesh(me)
        bpy.data.meshes.remove(me)
        self._weigh(self._added())

    def loft(self, rings, mat="polymer", seg=16, caps=True, wrinkle=0.0):
        """A skin over a stack of ellipses. Each ring: (centre, normal, side vector, radius along side, radius across).
        Used for limbs, torsos, heads and helmets."""
        tmp = bmesh.new()
        loops = []
        for c, n, side, ra, rb in rings:
            c, n, side = Vector(c), Vector(n).normalized(), Vector(side)
            side = (side - n * side.dot(n)).normalized()
            front = n.cross(side)
            k = len(loops)
            ring = []
            for i in range(seg):
                a = i * 2 * math.pi / seg
                # cloth: uneven folds, different on every ring
                w = 1 + wrinkle * (math.sin(i * 2.7 + k * 1.9 + c.y * 31) * 0.6 + math.sin(i * 5.3 - k * 3.1 + c.x * 17) * 0.4)
                ring.append(tmp.verts.new(c + side * (ra * w * math.cos(a)) + front * (rb * w * math.sin(a))))
            loops.append(ring)
        for a, b in zip(loops, loops[1:]):
            for i in range(seg):
                j = (i + 1) % seg
                tmp.faces.new((a[i], a[j], b[j], b[i]))
        if caps:
            tmp.faces.new(list(reversed(loops[0])))
            tmp.faces.new(loops[-1])
        self._merge(tmp, mat)
        return self

    def limb(self, p0, p1, r0, r1, mat="polymer", seg=12, rings=5, flat=1.0, side=(1, 0, 0), wrinkle=0.0):
        """A tapered round segment from p0 to p1 (arms, legs, straps). flat < 1 squashes it front to back."""
        p0, p1 = Vector(p0), Vector(p1)
        n = p1 - p0
        out = []
        for i in range(rings + 1):
            t = i / rings
            r = r0 + (r1 - r0) * t
            out.append((p0 + n * t, n, side, r, r * flat))
        return self.loft(out, mat, seg, wrinkle=wrinkle)

    def ball(self, c, radii, mat="polymer", seg=16, rings=8, y0=-1.0, y1=1.0):
        """An ellipsoid (or a slice of one between y0 and y1, in units of the vertical radius)."""
        out = []
        for i in range(rings + 1):
            t = y0 + (y1 - y0) * i / rings
            k = math.sqrt(max(1e-4, 1 - t * t))
            out.append(((c[0], c[1] + radii[1] * t, c[2]), (0, 1, 0), (1, 0, 0), radii[0] * k, radii[2] * k))
        return self.loft(out, mat, seg)

    def profile(self, pts, width, mat="polymer", x=0.0, bevel=0.003, seg=2):
        """A side outline, as (z, y) points in order, given `width` across the gun and rounded edges."""
        tmp = bmesh.new()
        a = [tmp.verts.new((x - width / 2, y, z)) for z, y in pts]
        b = [tmp.verts.new((x + width / 2, y, z)) for z, y in pts]
        tmp.faces.new(a)
        tmp.faces.new(list(reversed(b)))
        n = len(pts)
        for i in range(n):
            j = (i + 1) % n
            tmp.faces.new((a[i], b[i], b[j], a[j]))
        if bevel:
            bmesh.ops.bevel(tmp, geom=list(tmp.edges), offset=min(bevel, width * 0.45), segments=seg, affect="EDGES", profile=0.5)
        self._merge(tmp, mat)
        return self

    def bar(self, p0, p1, thick, width, mat="anodized", x=0.0, bevel=0.0012):
        """A straight bar between two (z, y) points: trigger guards, levers, ribs."""
        dz, dy = p1[0] - p0[0], p1[1] - p0[1]
        ln = math.hypot(dz, dy) or 1e-6
        uz, uy = dz / ln, dy / ln
        nz, ny = -uy * thick / 2, uz * thick / 2
        ez, ey = uz * thick / 2, uy * thick / 2
        pts = [(p0[0] - ez + nz, p0[1] - ey + ny), (p1[0] + ez + nz, p1[1] + ey + ny), (p1[0] + ez - nz, p1[1] + ey - ny), (p0[0] - ez - nz, p0[1] - ey - ny)]
        return self.profile(pts, width, mat, x=x, bevel=bevel, seg=1)

    def pipe(self, r_out, r_in, z0, z1, y=0.0, x=0.0, mat="anodized", seg=20):
        """A hollow tube along the barrel you can see through (optic bodies)."""
        tmp = bmesh.new()
        rings = []
        for r, z in ((r_out, z0), (r_out, z1), (r_in, z1), (r_in, z0)):
            rings.append([tmp.verts.new((x + r * math.cos(a), y + r * math.sin(a), z)) for a in (i * 2 * math.pi / seg for i in range(seg))])
        for k in range(4):
            a, b = rings[k], rings[(k + 1) % 4]
            for i in range(seg):
                j = (i + 1) % seg
                tmp.faces.new((a[i], a[j], b[j], b[i]))
        self._merge(tmp, mat)
        return self

    def tube(self, radius, z0, z1, y=0.0, x=0.0, mat="steel", seg=20, radius2=None, rot=None):
        """A cylinder (or cone) along the barrel from z0 to z1."""
        r = bmesh.ops.create_cone(self.bm, cap_ends=True, segments=seg, radius1=radius, radius2=radius if radius2 is None else radius2, depth=abs(z1 - z0))
        self._finish(r["verts"], mat, (x, y, (z0 + z1) / 2), rot, smooth_sides=True)
        return self

    def tube_x(self, radius, width, at, mat="steel", seg=16):
        """A cylinder across the gun (pins, scope turrets, drums)."""
        r = bmesh.ops.create_cone(self.bm, cap_ends=True, segments=seg, radius1=radius, radius2=radius, depth=width)
        self._finish(r["verts"], mat, at, (0, 90, 0), smooth_sides=False)
        for v in r["verts"]:
            for f in v.link_faces:
                f.smooth = len(f.verts) == 4
        return self

    def tube_y(self, radius, y0, y1, x, z, mat="steel", seg=16):
        r = bmesh.ops.create_cone(self.bm, cap_ends=True, segments=seg, radius1=radius, radius2=radius, depth=abs(y1 - y0))
        self._finish(r["verts"], mat, (x, (y0 + y1) / 2, z), (90, 0, 0))
        for v in r["verts"]:
            for f in v.link_faces:
                f.smooth = len(f.verts) == 4
        return self

    # ---- shared details
    def rail(self, z0, z1, y, width=0.022, mat="frame"):
        """A slotted accessory rail on top of the gun."""
        self.box((width, 0.006, z1 - z0), (0, y + 0.003, (z0 + z1) / 2), mat, bevel=0.0015)
        n = max(2, int((z1 - z0) / 0.016))
        for i in range(n):
            z = z0 + (i + 0.5) * (z1 - z0) / n
            self.box((width + 0.004, 0.005, 0.008), (0, y + 0.0085, z), mat, bevel=0.0012)
        return self

    def vents(self, z0, z1, y, half_width, count, size=(0.004, 0.012, 0.022), mat="rubber", slant=28):
        """Slanted cooling slots on both sides of a handguard."""
        for i in range(count):
            z = z0 + (i + 0.5) * (z1 - z0) / count
            for side in (-1, 1):
                self.box(size, (side * half_width, y, z), mat, bevel=0.001, rot=(slant, 0, 0))
        return self

    def stripe(self, z0, z1, y, half_width, height=0.006, mat="volt"):
        """A thin accent line along both sides."""
        for side in (-1, 1):
            self.box((0.003, height, z1 - z0), (side * half_width, y, (z0 + z1) / 2), mat, bevel=0.0008)
        return self

    def ring_grooves(self, radius, z0, z1, y, count, mat="rubber"):
        for i in range(count):
            z = z0 + (i + 0.5) * (z1 - z0) / count
            self.tube(radius, z - 0.003, z + 0.003, y=y, mat=mat)
        return self

    def trigger(self, z, y_top, mat="frame"):
        """Trigger and guard under the receiver; z is the trigger blade."""
        self.box((0.008, 0.03, 0.008), (0, y_top - 0.02, z), "steel", bevel=0.002, rot=(-14, 0, 0))
        self.box((0.014, 0.007, 0.078), (0, y_top - 0.042, z + 0.008), mat, bevel=0.002)
        self.box((0.014, 0.046, 0.007), (0, y_top - 0.021, z + 0.047), mat, bevel=0.002, rot=(-12, 0, 0))
        return self

    def grip(self, z, y_top, height=0.105, width=0.034, depth=0.044, lean=17):
        """Pistol grip leaning back from (z, y_top)."""
        c = (0, y_top - height / 2, z - math.tan(math.radians(lean)) * height / 2)
        self.box((width, height, depth), c, "rubber", bevel=0.006, rot=(lean, 0, 0))
        for i in range(4):  # grip ribs
            t = (i + 1) / 5
            self.box((width + 0.003, 0.004, depth * 0.7), (0, y_top - height * t, z - math.tan(math.radians(lean)) * height * t), "polymer", bevel=0.001, rot=(lean, 0, 0))
        self.box((width + 0.004, 0.01, depth + 0.006), (0, y_top - height - 0.002, z - math.tan(math.radians(lean)) * height), "frame", bevel=0.003, rot=(lean, 0, 0))
        return self

    def _bake_shading(self):
        """Per-corner colour = contact shadow (rays from each vertex) x edge wear (convex edges stay bright)."""
        bm = self.bm
        bm.normal_update()
        bm.verts.ensure_lookup_table()
        tree = BVHTree.FromBMesh(bm)
        col = bm.loops.layers.float_color.new("Col")
        dirs = []
        for i in range(20):  # a fixed fan of rays over the hemisphere
            t = (i + 0.5) / 20
            r, ang = math.sqrt(t), i * 2.39996
            dirs.append((r * math.cos(ang), r * math.sin(ang), math.sqrt(1 - t)))
        shade = []
        for v in bm.verts:
            n = v.normal
            t1 = n.orthogonal().normalized()
            t2 = n.cross(t1)
            o = v.co + n * 0.0015
            hit = 0
            for dx, dy, dz in dirs:
                d = t1 * dx + t2 * dy + n * dz
                if tree.ray_cast(o, d, 0.045)[0] is not None:
                    hit += 1
            ao = 1 - hit / len(dirs)
            curv = 0.0
            if v.link_edges:
                curv = sum(n.dot((v.co - e.other_vert(v).co).normalized()) for e in v.link_edges) / len(v.link_edges)
            wear = min(1.0, max(0.0, (curv - 0.12) / 0.3))
            shade.append((ao, wear))
        for f in bm.faces:
            f.smooth = True
            flat = WEAR.get(self.mats[f.material_index], 1.0)
            for loop in f.loops:
                ao, wear = shade[loop.vert.index]
                k = (0.42 + 0.58 * ao) * (flat + (1 - flat) * wear)
                loop[col] = (k, k, k, 1.0)

    def to_object(self, origin=(0, 0, 0)):
        """Create the Blender object with its origin at `origin` (game axes)."""
        if self.weld:
            bmesh.ops.remove_doubles(self.bm, verts=self.bm.verts, dist=1e-6)
        bmesh.ops.transform(self.bm, matrix=G2B @ Matrix.Translation(-Vector(origin)), verts=self.bm.verts)
        bmesh.ops.recalc_face_normals(self.bm, faces=self.bm.faces)
        self._bake_shading()
        if self.uv_scale:
            uv = self.bm.loops.layers.uv.new("UVMap")
            for f in self.bm.faces:
                n = f.normal
                ax = max(range(3), key=lambda i: abs(n[i]))
                u, v = [i for i in range(3) if i != ax]
                for loop in f.loops:
                    loop[uv].uv = (loop.vert.co[u] / self.uv_scale, loop.vert.co[v] / self.uv_scale)
        mesh = bpy.data.meshes.new(self.name)
        self.bm.to_mesh(mesh)
        self.bm.free()
        for name in self.mats:
            mesh.materials.append(material(name))
        mesh.set_sharp_from_angle(angle=math.radians(38))
        mesh.color_attributes.active_color = mesh.color_attributes["Col"]
        mesh.color_attributes.render_color_index = mesh.color_attributes.find("Col")
        obj = bpy.data.objects.new(self.name, mesh)
        for bone in self.bones:
            obj.vertex_groups.new(name=bone)
        obj.location = G2B @ Vector(origin)
        bpy.context.scene.collection.objects.link(obj)
        wn = obj.modifiers.new("weighted-normals", "WEIGHTED_NORMAL")
        wn.keep_sharp = True
        return obj
