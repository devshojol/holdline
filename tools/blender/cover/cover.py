import bpy, math, random
from mathutils import Vector, Matrix, Euler
ROOT = "/Users/webappick/Documents/SHOJOL/Valorant_Aim_Lab/public/models/"
OUT = ARGS[0]; MODE = ARGS[1] if len(ARGS) > 1 else "preview"
sc = bpy.data.scenes.get("Cover") or bpy.data.scenes.new("Cover")
bpy.context.window.scene = sc
for o in list(sc.objects): bpy.data.objects.remove(o, do_unlink=True)

def imp(path):
    bpy.ops.import_scene.gltf(filepath=ROOT + path)
    return list(bpy.context.selected_objects)
def empty(name, loc):
    e = bpy.data.objects.new(name, None); e.location = loc; sc.collection.objects.link(e); return e

# ---- soldier
objs = imp("agents/ranger.glb")
arm = next(o for o in objs if o.type == "ARMATURE")
BODY_YAW = math.radians(P.get("body_yaw", -32))
arm.rotation_euler = (0, 0, BODY_YAW)
# ---- rifle
gun = empty("Gun", P.get("gun_loc", (-0.15, -0.37, 1.445)))
gun.rotation_euler = Euler(tuple(math.radians(a) for a in P.get("gun_rot", (0, -6, 8))))
for o in imp("weapons/kestrel.glb"):
    if o.type == "MESH" and o.parent is None: o.parent = gun
for o in list(sc.objects):
    if o.name.startswith("Icosphere"): bpy.data.objects.remove(o, do_unlink=True)
bpy.context.view_layer.update()

def rot(pb, axis, deg):
    """Turn a bone about an armature-space axis through its head."""
    bpy.context.view_layer.update()
    m = pb.matrix.copy(); p = m.translation.copy()
    pb.matrix = Matrix.Translation(p) @ Matrix.Rotation(math.radians(deg), 4, axis) @ Matrix.Translation(-p) @ m
    bpy.context.view_layer.update()
pb = arm.pose.bones
for name, axis, deg in P.get("bones", []):
    rot(pb[name], axis, deg)

def ik(bone, local, pole, angle):
    t = empty("T_" + bone, gun.matrix_world @ Vector(local))
    p = empty("P_" + bone, pole)
    c = pb[bone].constraints.new("IK"); c.target = t; c.chain_count = 2
    c.pole_target = p; c.pole_angle = math.radians(angle)
def hand(S, spec):
    s_ = S.lower(); B = arm.data.bones
    W = B[S + "_Hand"].head_local; M = B[S + "_Middle1"].head_local; I = B["index_01_" + s_].head_local; K = B["pinky_01_" + s_].head_local
    d0 = (M - W).normalized(); n0 = (I - W).cross(K - W).normalized()
    if (n0.x > 0) != (S == "R"): n0 = -n0
    n0 = (n0 - d0 * n0.dot(d0)).normalized()
    f0 = Matrix((d0, n0, d0.cross(n0))).transposed()
    gw = gun.matrix_world.to_3x3(); ai = arm.matrix_world.to_3x3().inverted()
    d1 = (ai @ (gw @ Vector(spec["dir"]))).normalized(); n1 = ai @ (gw @ Vector(spec["palm"]))
    n1 = (n1 - d1 * n1.dot(d1)).normalized()
    f1 = Matrix((d1, n1, d1.cross(n1))).transposed()
    R = f1 @ f0.transposed()
    knuckle = gun.matrix_world @ Vector(spec["at"])
    wrist = knuckle - (arm.matrix_world.to_3x3() @ d1) * (M - W).length
    t = empty("T_" + S, wrist); pl = empty("P_" + S, spec["pole"])
    c = pb[S + "_Elbow"].constraints.new("IK"); c.target = t; c.chain_count = 2
    c.pole_target = pl; c.pole_angle = math.radians(spec.get("pa", -90))
    bpy.context.view_layer.update()
    H = pb[S + "_Hand"]
    H.matrix = Matrix.Translation(H.matrix.translation) @ R.to_4x4() @ B[S + "_Hand"].matrix_local.to_3x3().to_4x4()
    bpy.context.view_layer.update()
    axis = d1.cross(n1)
    for f, c1 in (("index", 1.0), ("middle", 1.0), ("ring", 1.0), ("pinky", 1.0)):
        for i, deg in enumerate(spec.get("curl", (0, 0, 0))):
            name = f"{f}_0{i + 1}_{s_}"
            if name not in pb: name = f"{S}_Middle1"
            rot(pb[name], axis, deg * c1 * (spec.get("index", 1.0) if f == "index" else 1.0))
    for i, deg in enumerate(spec.get("thumb", ())):
        rot(pb[f"thumb_0{i + 1}_{s_}"], spec.get("thumb_axis", n1), deg) if isinstance(spec.get("thumb_axis", None), str) else rot(pb[f"thumb_0{i + 1}_{s_}"], n1, deg)
hand("R", P["right"]); hand("L", P["left"])
for m in bpy.data.materials:
    if m.use_nodes:
        for n in m.node_tree.nodes:
            if n.type == "NORMAL_MAP":
                src = n.inputs["Color"].links[0].from_node if n.inputs["Color"].links else None
                if src and getattr(src, "image", None) and src.image.name.startswith("camo"):
                    for l in list(n.outputs[0].links): m.node_tree.links.remove(l)
# ---- backdrop
def emit(name, color, strength):
    m = bpy.data.materials.new(name); m.use_nodes = True; nt = m.node_tree; nt.nodes.clear()
    e = nt.nodes.new("ShaderNodeEmission"); e.inputs[0].default_value = (*color, 1); e.inputs[1].default_value = strength
    o = nt.nodes.new("ShaderNodeOutputMaterial"); nt.links.new(e.outputs[0], o.inputs[0]); return m
bpy.ops.mesh.primitive_plane_add(size=40, location=(0, P.get("wall_y", 3.2), 1.5), rotation=(math.radians(90), 0, 0))
back = bpy.context.object
m = bpy.data.materials.new("Wall"); m.use_nodes = True
bs = m.node_tree.nodes["Principled BSDF"]; bs.inputs["Base Color"].default_value = (0.03, 0.026, 0.024, 1); bs.inputs["Roughness"].default_value = 0.95
back.data.materials.append(m)
gl = bpy.data.lights.new("Glow", "SPOT"); gl.energy = P.get("glow", 9000); gl.color = (1.0, 0.34, 0.035); gl.spot_size = math.radians(P.get("glow_cone", 95)); gl.spot_blend = 1.0; gl.shadow_soft_size = 0.5
go = bpy.data.objects.new("Glow", gl); sc.collection.objects.link(go); go.location = P.get("glow_at", (0.0, 0.9, 1.5))
go.rotation_euler = (math.radians(-90), 0, 0)
# ---- sparks
random.seed(7)
sm = emit("Spark", (1.0, 0.42, 0.06), 60)
bpy.ops.mesh.primitive_uv_sphere_add(radius=1, segments=8, ring_count=6)
base = bpy.context.object; base.data.materials.append(sm); base.hide_render = True; base.hide_viewport = True
for i in range(P.get("sparks", 90)):
    o = bpy.data.objects.new("spark", base.data); sc.collection.objects.link(o)
    o.location = (random.uniform(-3.2, 3.2), random.uniform(0.6, 3.8), random.uniform(0.3, 2.9))
    s = random.uniform(0.0015, 0.004); o.scale = (s, s, s * random.uniform(1, 3))
    o.visible_shadow = False

# ---- lights
def light(name, kind, loc, aim, energy, color, size=1.0):
    d = bpy.data.lights.new(name, kind); d.energy = energy; d.color = color
    if kind == "AREA": d.size = size
    o = bpy.data.objects.new(name, d); sc.collection.objects.link(o); o.location = loc
    o.rotation_euler = (Vector(aim) - Vector(loc)).to_track_quat("-Z", "Y").to_euler(); return o
A = (-0.05, -0.15, 1.45)
light("Key", "AREA", (1.5, -2.2, 2.3), A, P.get("key", 260), (1.0, 0.93, 0.84), 1.6)
light("Fill", "AREA", (-2.0, -2.0, 1.2), A, P.get("fill", 45), (0.62, 0.74, 1.0), 2.5)
light("RimR", "AREA", (-1.7, 1.6, 2.1), A, P.get("rim", 700), (1.0, 0.5, 0.12), 0.9)
light("RimL", "AREA", (1.9, 1.5, 1.7), A, P.get("rim", 700) * 0.7, (1.0, 0.56, 0.16), 0.9)
w = bpy.data.worlds.new("CoverWorld"); w.use_nodes = True
w.node_tree.nodes["Background"].inputs[0].default_value = (0.02, 0.018, 0.016, 1); sc.world = w

# ---- camera
cd = bpy.data.cameras.new("Cam"); cam = bpy.data.objects.new("Cam", cd); sc.collection.objects.link(cam); sc.camera = cam
cam.location = P.get("cam", (0.75, -2.1, 1.42)); look = Vector(P.get("look", (-0.03, -0.25, 1.47)))
cam.rotation_euler = (look - cam.location).to_track_quat("-Z", "Y").to_euler()
cd.dof.use_dof = True; cd.dof.aperture_fstop = P.get("fstop", 2.8)
cd.dof.focus_distance = (Vector(P.get("focus", (0.0, -0.2, 1.62))) - cam.location).length

sc.render.engine = "CYCLES"; sc.cycles.device = "GPU"
try:
    pr = bpy.context.preferences.addons["cycles"].preferences; pr.compute_device_type = "METAL"; pr.get_devices()
    for d in pr.devices: d.use = True
except Exception as e: print("gpu", e)
sc.cycles.use_denoising = True
sc.view_settings.view_transform = "AgX"; sc.view_settings.look = "AgX - Medium High Contrast"
sc.render.film_transparent = False
sc.render.image_settings.file_format = "PNG"

if MODE == "debug":
    w.node_tree.nodes["Background"].inputs[0].default_value = (0.7, 0.7, 0.7, 1); back.hide_render = True
    cd.dof.use_dof = False; cd.type = "ORTHO"; cd.ortho_scale = 1.5
    sc.render.resolution_x = sc.render.resolution_y = 420; sc.cycles.samples = 12
    g0 = gun.matrix_world @ Vector((0, -0.08, -0.03))
    for name, off, sc_ in (("front", (0, -4, 0), 1.5), ("top", (0, 0, 4), 1.5), ("handR", (-3, -0.6, 0.3), 0.55), ("handL", (3, -0.8, -0.6), 0.55), ("handF", (-0.8, -3, -0.8), 0.55), ("handU", (0.3, -0.5, -3), 0.55)):
        big = sc_ > 1; tgt = Vector((0, -0.3, 1.3)) if big else g0
        cam.location = tgt + Vector(off); cd.ortho_scale = sc_
        cam.rotation_euler = (tgt - cam.location).to_track_quat("-Z", "Y").to_euler()
        sc.render.filepath = f"{OUT}/dbg-{name}.png"; bpy.ops.render.render(write_still=True)
    P["shots"] = {}
SHOTS = P["shots"] if MODE == "final" else {k: v for k, v in P["shots"].items() if k in ARGS[2:]} if MODE != "debug" else {}
for name, (w_, h_, lens, sx, sy) in SHOTS.items():
    k = 1.0 if MODE == "final" else 0.4
    sc.render.resolution_x = int(w_ * k); sc.render.resolution_y = int(h_ * k); sc.render.resolution_percentage = 100
    sc.cycles.samples = 256 if MODE == "final" else 48
    cd.lens = lens; cd.shift_x = sx; cd.shift_y = sy; cd.sensor_fit = "AUTO"
    sc.render.filepath = f"{OUT}/{name}-{MODE}.png"
    bpy.ops.render.render(write_still=True)
    print("wrote", sc.render.filepath)
