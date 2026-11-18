"""Build the game's ten soldiers in Blender: real human bodies and faces in camouflage, with a vest, pouches,
pads and headgear, on the skeleton the game poses.

Run inside the open Blender through the MCP addon:
    python3 tools/blender/bl.py tools/blender/make_bots.py [soldier ...]

Needs the MPFB add-on (MakeHuman for Blender, https://extensions.blender.org/add-ons/mpfb/) with the
"MakeHuman system assets" pack installed. MPFB makes each soldier's body, face, hair, clothes and boots (all
CC0 assets) and gives them a skeleton with skin weights. This script then:
  - renames the skeleton's joints to the names the game poses (src/game/bots/AgentVisual.ts) and adds eye joints;
  - prints the clothes in the soldier's camouflage, which it generates;
  - fits our own gear (plate carrier, pouches, belt, pads, holster, helmet / cap / beanie / headset), modelled
    from code in the game's axes (x to the soldier's left, y up, z forward, metres), to the body's measurements.
The soldier stands on the origin facing +z. The game scales the model by its eye height, so it is left life size.

Writes public/models/agents/<id>.glb and public/models/agents/portraits/<id>.webp.
"""
import math
import os

import bmesh
import bpy
from mathutils import Matrix, Vector

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
exec(open(os.path.join(ROOT, "tools", "blender", "hl_common.py")).read())
OUT = os.path.join(ROOT, "public", "models", "agents")
os.makedirs(os.path.join(OUT, "portraits"), exist_ok=True)
os.makedirs(os.path.join(ROOT, "tools", "blender", "out"), exist_ok=True)
B2G = G2B.inverted()

# MPFB's "game_engine" skeleton -> the joint names the game poses. The left side is listed; the right is the same.
BONES = {"pelvis": "Splitter", "spine_01": "Spine2", "spine_02": "Spine3", "spine_03": "Spine4", "neck_01": "Neck", "head": "Head",
         "clavicle_l": "L_Clavicle", "upperarm_l": "L_Shoulder", "lowerarm_l": "L_Elbow", "hand_l": "L_Hand", "middle_01_l": "L_Middle1",
         "thigh_l": "L_Hip", "calf_l": "L_Knee", "foot_l": "L_Foot", "ball_l": "L_Toe"}
for k, v in list(BONES.items()):
    if k.endswith("_l"):
        BONES[k[:-2] + "_r"] = "R_" + v[2:]
J = {}  # joint name -> position (game axes), filled from each soldier's skeleton


def jp(name):
    return Vector(J[name])


# ---------------------------------------------------------------- our gear
def torso_gear(kit, m):
    """Plate carrier, pouches, sling and belt kit. Modelled on a reference torso, then moved onto this body's
    measured chest and hips (`m`)."""
    F, C, H, W = kit + "_fabric", kit + "_carrier", kit + "_helmet", kit + "_webbing"
    b = Part("torso-gear")
    b.weld = False
    b.uv_scale = 0.55
    up, sx = (0, 1, 0), (1, 0, 0)
    # plate carrier and its load, carried by the chest
    b.skin = "Spine3"
    b.box((0.3, 0.33, 0.06), (0, 1.255, 0.105), C, bevel=0.02)
    b.box((0.3, 0.34, 0.05), (0, 1.255, -0.1), C, bevel=0.02)
    for side in (-1, 1):
        b.box((0.03, 0.15, 0.21), (side * 0.168, 1.17, 0.002), C, bevel=0.008)                 # cummerbund
        b.box((0.034, 0.03, 0.05), (side * 0.172, 1.2, 0.04), W, bevel=0.004)
    for i in range(3):                                                                          # magazine pouches
        x = (i - 1) * 0.088
        b.box((0.076, 0.15, 0.038), (x, 1.165, 0.148), C, bevel=0.008)
        b.box((0.078, 0.05, 0.042), (x, 1.225, 0.149), C, bevel=0.006)
        b.box((0.024, 0.03, 0.004), (x, 1.215, 0.171), W, bevel=0.001)
    b.box((0.17, 0.085, 0.032), (0, 1.335, 0.146), C, bevel=0.01)                               # admin pouch
    b.box((0.09, 0.03, 0.004), (0, 1.39, 0.137), kit + "_patch", bevel=0.001)                   # name tape
    b.box((0.07, 0.13, 0.05), (0.118, 1.3, -0.148), C, bevel=0.01)                              # radio pouch
    b.tube_y(0.004, 1.36, 1.5, 0.135, -0.15, "rubber", seg=8)                                   # antenna
    b.box((0.2, 0.25, 0.045), (-0.03, 1.25, -0.146), C, bevel=0.014)                            # hydration carrier
    for i in range(3):                                                                          # webbing rows, front and back
        b.box((0.27, 0.012, 0.004), (0, 1.385 - i * 0.03, 0.1365), W, bevel=0.001)
    for i in range(8):
        b.box((0.27, 0.012, 0.004), (0, 1.39 - i * 0.034, -0.1265), W, bevel=0.001)
    for side in (-1, 1):
        for i in range(3):
            b.box((0.004, 0.012, 0.18), (side * 0.1845, 1.215 - i * 0.034, 0.002), W, bevel=0.001)
    b.limb((-0.13, 1.46, -0.07), (0.17, 1.06, 0.1), 0.02, 0.02, W, seg=8, rings=6, flat=0.2, side=(0.6, 0.6, 0))   # rifle sling
    b.skin = "Spine4"
    for side in (-1, 1):
        b.box((0.06, 0.032, 0.23), (side * 0.1, 1.445, 0.0), C, bevel=0.01)                     # shoulder straps
        b.box((0.075, 0.03, 0.12), (side * 0.11, 1.455, 0.0), C, bevel=0.012)                   # shoulder pads
    b.skin = "Splitter"
    for side in (-1, 1):
        b.box((0.05, 0.11, 0.09), (side * 0.185, 0.96, 0.03), C, bevel=0.012)                   # belt pouches
    b.box((0.11, 0.09, 0.05), (0.0, 0.97, -0.125), C, bevel=0.014)                              # rear pouch

    for v in b.bm.verts:  # from the reference torso onto this one
        x, y, z = v.co
        part = m["chest"] if y > 1.08 else m["hips"]
        ref_y, ref_w, ref_front, ref_back = (1.25, 0.185, 0.125, -0.115) if y > 1.08 else (0.98, 0.18, 0.115, -0.115)
        v.co = Vector((x * part["w"] / ref_w, y + part["y"] - ref_y, z + (part["front"] - ref_front if z > 0 else part["back"] - ref_back)))
    hips = m["hips"]
    b.skin = "Splitter"
    b.loft([((0, y, (hips["front"] + hips["back"]) / 2), up, sx, hips["w"] + 0.008, (hips["front"] - hips["back"]) / 2 + 0.008)
            for y in (hips["y"] + 0.03, hips["y"] + 0.075)], W, seg=22, caps=False)             # belt
    return b


def limb_gear(kit):
    """Knee pads with their straps, and the pistol holster on the right thigh."""
    W = kit + "_webbing"
    b = Part("limb-gear")
    b.weld = False
    b.uv_scale = 0.55
    for side in ("L", "R"):
        s = 1 if side == "L" else -1
        kn, ankle = jp(side + "_Knee"), jp(side + "_Foot")
        shin = (ankle - kn).normalized()
        b.skin = side + "_Knee"
        b.ball(kn + shin * 0.02 + Vector((0, 0, 0.055)), (0.058, 0.075, 0.028), kit + "_pad", seg=12, rings=6)
        b.limb(kn + shin * 0.05 + Vector((0, 0, -0.012)), kn + shin * 0.075 + Vector((0, 0, -0.012)), 0.07, 0.068, W, seg=14, rings=1)
    hip, knee = jp("R_Hip"), jp("R_Knee")
    thigh = (knee - hip).normalized()
    b.skin = "R_Hip"
    at = hip + thigh * 0.16 + Vector((-0.085, 0, 0.02))
    b.box((0.04, 0.17, 0.085), at, "polymer", bevel=0.012)
    b.box((0.03, 0.06, 0.05), at + Vector((-0.004, 0.1, -0.03)), "parkerized", bevel=0.006)     # pistol grip showing
    for d in (0.11, 0.2):
        b.limb(hip + thigh * d, hip + thigh * (d + 0.028), 0.1 - d * 0.1, 0.098 - d * 0.1, W, seg=14, rings=1)
    return b


def head_gear(kit, headgear, headset, hd):
    """Helmet, cap or beanie, and the headset, fitted to the measured head (`hd`)."""
    F, C, H, W = kit + "_fabric", kit + "_carrier", kit + "_helmet", kit + "_webbing"
    b = Part("head-gear")
    b.weld = False
    b.uv_scale = 0.55
    up, sx = (0, 1, 0), (1, 0, 0)
    b.skin = "Head"
    hd = hd or dict(top=1.755, cz=0.0, rw=0.078, rd=0.098, eye=1.63)
    top, cz, rw, rd, eye = hd["top"], hd["cz"], hd["rw"], hd["rd"], hd["eye"]
    brow = eye + 0.04
    if headgear == "helmet":
        cy = eye + 0.028                                                                        # rim just above the brows
        ry = top - cy + 0.032
        hx, hz = rw + 0.032, rd + 0.03
        b.ball((0, cy, cz - 0.004), (hx, ry, hz), H, seg=24, rings=9, y0=0.0, y1=1.0)            # shell with a cloth cover
        b.loft([((0, y, cz - 0.004), up, sx, hx + 0.002, hz + 0.002) for y in (cy - 0.014, cy + 0.004)], "rubber", seg=24)   # edge trim
        b.box((0.05, 0.04, 0.014), (0, cy + ry * 0.5, cz + hz * 0.88), "polymer", bevel=0.004)   # night-vision mount
        for side in (-1, 1):
            b.box((0.012, 0.022, 0.11), (side * (hx - 0.002), cy + 0.022, cz - 0.01), "polymer", bevel=0.004)         # accessory rail
            b.limb((side * (hx - 0.012), cy - 0.01, cz + 0.02), (side * 0.05, eye - 0.118, cz + 0.06), 0.006, 0.006, W, seg=6, rings=3, flat=0.3, side=(0, 0, 1))   # chin strap
        b.box((0.09, 0.012, 0.018), (0, eye - 0.124, cz + 0.068), W, bevel=0.004)
        b.box((0.07, 0.05, 0.004), (0, cy + ry * 0.45, cz - hz * 0.93), kit + "_patch", bevel=0.001, rot=(-20, 0, 0))   # helmet patch
    elif headgear == "cap":
        cy = brow + 0.018
        b.ball((0, cy, cz), (rw + 0.01, top - cy + 0.012, rd + 0.012), F, seg=20, rings=7, y0=0.0, y1=1.0)
        b.loft([((0, y, cz), up, sx, rw + 0.0115, rd + 0.0135) for y in (cy - 0.012, cy + 0.006)], F, seg=20)        # band
        b.box((0.15, 0.008, 0.085), (0, cy - 0.004, cz + rd + 0.045), F, bevel=0.004, rot=(8, 0, 0))                 # peak
    elif headgear == "beanie":
        cy = brow + 0.02
        b.ball((0, cy, cz), (rw + 0.009, top - cy + 0.014, rd + 0.011), "wool", seg=20, rings=8, y0=-0.12, y1=1.0)
        b.loft([((0, y, cz), up, sx, rw + 0.012, rd + 0.014) for y in (cy - 0.022, cy + 0.008)], "wool", seg=20)     # turned-up edge
    if headset or headgear == "helmet":                                                         # ear protection with a microphone
        for side in (-1, 1):
            b.box((0.03, 0.074, 0.058), (side * (rw + 0.02), eye - 0.008, cz - 0.012), "polymer", bevel=0.013)
        if headgear != "helmet":
            b.loft([((0, top + 0.004 - 0.02 * abs(k), cz - 0.012), (1, 0, 0) if k == 0 else (1, 0.9 * (1 if k < 0 else -1), 0), (0, 0, 1), 0.012, 0.004)
                    if False else ((k * (rw + 0.02) / 3, top + 0.03 - 0.0125 * k * k, cz - 0.012), (1, 0, 0), (0, 0, 1), 0.014, 0.005) for k in (-3, -2, -1, 0, 1, 2, 3)],
                   "polymer", seg=8)                                                            # head band
        b.limb((rw + 0.012, eye - 0.035, cz + 0.01), (0.045, eye - 0.062, cz + rd * 0.95), 0.0035, 0.0035, "rubber", seg=6, rings=3)
        b.ball((0.04, eye - 0.063, cz + rd * 0.97), (0.01, 0.008, 0.01), "rubber", seg=8, rings=4)
    return b


# ---------------------------------------------------------------- kits and soldiers
# id: (name, four camouflage colours (base, second, dark, light), carrier, webbing, pads, face wrap, patch). Linear RGB.
KITS = {
    "ranger": ("Ranger", [(0.13, 0.12, 0.065), (0.075, 0.09, 0.04), (0.04, 0.035, 0.022), (0.24, 0.2, 0.12)],
               (0.16, 0.13, 0.075), (0.11, 0.09, 0.055), (0.03, 0.03, 0.026), (0.05, 0.05, 0.04), (0.45, 0.4, 0.25)),
    "shade": ("Shade", [(0.05, 0.052, 0.058), (0.03, 0.03, 0.034), (0.015, 0.015, 0.017), (0.085, 0.088, 0.095)],
              (0.045, 0.046, 0.05), (0.03, 0.03, 0.034), (0.02, 0.02, 0.022), (0.035, 0.035, 0.04), (0.5, 0.08, 0.06)),
    "dune": ("Dune", [(0.36, 0.28, 0.17), (0.24, 0.17, 0.095), (0.13, 0.09, 0.05), (0.5, 0.42, 0.28)],
             (0.27, 0.2, 0.11), (0.2, 0.15, 0.085), (0.08, 0.065, 0.04), (0.2, 0.16, 0.1), (0.15, 0.2, 0.12)),
    "slate": ("Slate", [(0.16, 0.17, 0.185), (0.09, 0.095, 0.105), (0.04, 0.042, 0.047), (0.27, 0.28, 0.3)],
              (0.06, 0.062, 0.068), (0.045, 0.046, 0.05), (0.025, 0.025, 0.028), (0.05, 0.052, 0.058), (0.85, 0.6, 0.1)),
    "tide": ("Tide", [(0.055, 0.08, 0.13), (0.03, 0.045, 0.085), (0.015, 0.02, 0.04), (0.13, 0.16, 0.21)],
             (0.1, 0.105, 0.11), (0.07, 0.072, 0.078), (0.03, 0.03, 0.033), (0.04, 0.05, 0.065), (0.75, 0.75, 0.75)),
    "frost": ("Frost", [(0.5, 0.52, 0.54), (0.32, 0.34, 0.36), (0.14, 0.15, 0.16), (0.7, 0.72, 0.74)],
              (0.3, 0.31, 0.33), (0.2, 0.21, 0.22), (0.08, 0.085, 0.09), (0.3, 0.31, 0.33), (0.1, 0.25, 0.55)),
}
PALETTE["glove"] = ((0.05, 0.045, 0.035), 0.0, 0.85, 0)
PALETTE["boot"] = ((0.07, 0.052, 0.035), 0.0, 0.85, 0)
PALETTE["lens"] = ((0.03, 0.05, 0.07), 0.5, 0.1, 0)
for n_kit, (kit, (_, camo, carrier, webbing, pad, wrap, patch)) in enumerate(KITS.items()):
    PALETTE[f"{kit}_fabric"] = ((1, 1, 1), 0.0, 0.95, 0)   # coloured by the camouflage texture
    PALETTE[f"{kit}_helmet"] = ((1, 1, 1), 0.0, 0.9, 0)
    for part, colour, rough in (("carrier", carrier, 0.92), ("webbing", webbing, 0.9), ("pad", pad, 0.7), ("wrap", wrap, 0.95), ("patch", patch, 0.9)):
        PALETTE[f"{kit}_{part}"] = (colour, 0.0, rough, 0)


PALETTE["wool"] = ((0.03, 0.032, 0.036), 0.0, 0.98, 0)

# The ten soldiers. sex: 0 female .. 1 male; age: 0.4 young .. 0.9 old; race: (asian, caucasian, african).
# skin, hair and brows are assets of the MakeHuman system pack; hair is left off under headgear.
SOLDIERS = {
    "ranger": dict(name="Ranger", kit="ranger", sex=1.0, age=0.5, race=(0, 1, 0), skin="young_caucasian_male", hair=None, brows="eyebrow001", headgear="helmet"),
    "shade": dict(name="Shade", kit="shade", sex=1.0, age=0.62, race=(0, 0, 1), skin="middleage_african_male", hair=None, brows="eyebrow006", headgear="beanie"),
    "dune": dict(name="Dune", kit="dune", sex=0.0, age=0.45, race=(0, 1, 0), skin="young_caucasian_female", hair="ponytail01", brows="eyebrow003", headgear="none", headset=True),
    "slate": dict(name="Slate", kit="slate", sex=1.0, age=0.52, race=(1, 0, 0), skin="young_asian_male", hair="short02", brows="eyebrow002", headgear="none", headset=True),
    "tide": dict(name="Tide", kit="tide", sex=0.0, age=0.5, race=(0, 0, 1), skin="young_african_female", hair="afro01", brows="eyebrow004", headgear="none"),
    "frost": dict(name="Frost", kit="frost", sex=1.0, age=0.72, race=(0, 1, 0), skin="middleage_caucasian_male", hair=None, brows="eyebrow008", headgear="helmet", weight=0.6),
    "ember": dict(name="Ember", kit="shade", sex=0.0, age=0.48, race=(1, 0, 0), skin="young_asian_female", hair="bob02", brows="eyebrow005", headgear="none"),
    "grove": dict(name="Grove", kit="ranger", sex=1.0, age=0.44, race=(0, 0, 1), skin="young_african_male", hair=None, brows="eyebrow007", headgear="cap"),
    "flint": dict(name="Flint", kit="slate", sex=1.0, age=0.88, race=(0, 1, 0), skin="old_caucasian_male", hair="short04", brows="eyebrow010", headgear="none", headset=True, weight=0.45),
    "moss": dict(name="Moss", kit="dune", sex=1.0, age=0.64, race=(1, 0, 0), skin="middleage_asian_male", hair=None, brows="eyebrow009", headgear="cap"),
}


def kit_textures(kit):
    camo = KITS[kit][1]
    path = os.path.join(ROOT, "tools", "blender", "out", f"camo-{kit}.png")
    image = camo_texture(f"camo-{kit}", camo, 11 + list(KITS).index(kit), path)
    TEXTURES[f"{kit}_fabric"] = image
    TEXTURES[f"{kit}_helmet"] = image
    return image


# ---------------------------------------------------------------- the person
def make_person(c, camo):
    """One soldier from MPFB: body, face, hair, a long-sleeved shirt, trousers and boots, on a skeleton. Returns (skeleton, meshes,
    eye positions). The suit is printed in `camo`."""
    from bl_ext.user_default.mpfb.services.humanservice import HumanService
    from bl_ext.user_default.mpfb.services.locationservice import LocationService
    from bl_ext.user_default.mpfb.services.targetservice import TargetService
    data = LocationService.get_user_data()
    macro = TargetService.get_default_macro_info_dict()
    macro.update(gender=c["sex"], age=c["age"], muscle=0.7, weight=c.get("weight", 0.5), height=0.5, proportions=0.6)
    macro["race"] = dict(zip(("asian", "caucasian", "african"), [float(v) for v in c["race"]]))
    base = HumanService.create_human(scale=0.1, macro_detail_dict=macro, feet_on_ground=True)
    HumanService.set_character_skin(os.path.join(data, "skins", c["skin"], c["skin"] + ".mhmat"), base, skin_type="GAMEENGINE", material_instances=False)
    rig = HumanService.add_builtin_rig(base, "game_engine", import_weights=True)
    meshes = [base]
    for kind, name, typ in (("eyes", "low-poly", "Eyes"), ("eyebrows", c["brows"], "Eyebrows"), ("eyelashes", "eyelashes01", "Eyelashes"),
                            ("hair", c.get("hair"), "Hair"), ("clothes", "male_casualsuit01", "Clothes"), ("clothes", "shoes04", "Clothes")):
        if name:
            meshes.append(HumanService.add_mhclo_asset(os.path.join(data, kind, name, name + ".mhclo"), base, asset_type=typ, material_type="GAMEENGINE", subdiv_levels=0))
    TargetService.bake_targets(base)
    groups = {g.name: g.index for g in base.vertex_groups}

    def centre(name):
        pts = [v.co for v in base.data.vertices if any(g.group == groups[name] for g in v.groups)]
        return sum(pts, Vector()) / len(pts)
    eyes = {"L": centre("helper-l-eye"), "R": centre("helper-r-eye")}
    if eyes["L"].x < eyes["R"].x:  # the soldier's left is +x
        eyes = {"L": eyes["R"], "R": eyes["L"]}
    for obj in meshes:
        # masks hide the helper geometry and the skin under the clothes: make that permanent
        for mod in [m for m in obj.modifiers if m.type != "ARMATURE"]:
            if mod.type == "MASK":
                with bpy.context.temp_override(object=obj, active_object=obj, selected_objects=[obj]):
                    bpy.ops.object.modifier_apply(modifier=mod.name)
            else:
                obj.modifiers.remove(mod)
        mesh = obj.data
        if "Col" not in mesh.color_attributes:               # the gear's baked shading layer: plain white here
            layer = mesh.color_attributes.new("Col", "FLOAT_COLOR", "CORNER")
            layer.data.foreach_set("color", [1.0] * (4 * len(layer.data)))
        for poly in mesh.polygons:
            poly.use_smooth = True
        if mesh.uv_layers:
            mesh.uv_layers[0].name = "UVMap"
        for slot in obj.material_slots:
            nodes = slot.material.node_tree.nodes
            for node in nodes:
                if node.type != "TEX_IMAGE" or not node.image:
                    continue
                if "casualsuit" in slot.material.name:       # shirt and trousers, printed in the soldier's camouflage
                    node.image = camo
                    mapping = nodes.new("ShaderNodeMapping")
                    coords = nodes.new("ShaderNodeTexCoord")
                    mapping.inputs["Scale"].default_value = (5, 5, 5)
                    slot.material.node_tree.links.new(coords.outputs["UV"], mapping.inputs["Vector"])
                    slot.material.node_tree.links.new(mapping.outputs["Vector"], node.inputs["Vector"])
                elif max(node.image.size) > 1024:
                    node.image.scale(1024, 1024)
    return rig, meshes, eyes


def game_skeleton(rig, eyes):
    """Give the skeleton the joint names the game looks for, add the two eye joints, and note where every joint is."""
    bpy.context.view_layer.objects.active = rig
    rig.select_set(True)
    for old, new in BONES.items():
        rig.data.bones[old].name = new                       # vertex groups on the meshes follow the rename
    bpy.ops.object.mode_set(mode="EDIT")
    for side, at in eyes.items():
        bone = rig.data.edit_bones.new(side + "_Eyeball")
        bone.head = at
        bone.tail = at + Vector((0, 0, 0.03))
        bone.parent = rig.data.edit_bones["Head"]
    bpy.ops.object.mode_set(mode="OBJECT")
    J.clear()
    for bone in rig.data.bones:
        J[bone.name] = tuple(B2G @ (rig.matrix_world @ bone.head_local))


def close_hands(rig, body):
    """Curl the fingers of both hands and make that the rest pose, so the hands close round the gun: the game
    poses arms and legs but leaves fingers as they are. Each finger joint is turned towards the palm; the mesh
    takes the curled shape and the skeleton's rest pose is set to match."""
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode="POSE")
    for side in ("l", "r"):
        S = side.upper()
        hand = rig.pose.bones[f"{S}_Hand"]
        index, pinky = rig.pose.bones[f"index_01_{side}"], rig.pose.bones[f"pinky_01_{side}"]
        along = (rig.pose.bones[f"{S}_Middle1"].head - hand.head).normalized()
        across = (index.head - pinky.head).normalized()        # towards the thumb
        palm = (along.cross(across) if side == "l" else across.cross(along)).normalized()
        for finger, bends in (("index", (38, 62, 48)), ("middle", (42, 66, 50)), ("ring", (46, 68, 52)), ("pinky", (50, 70, 52)), ("thumb", (14, 22, 26))):
            for n, deg in enumerate(bends, 1):
                name = f"{S}_Middle1" if finger == "middle" and n == 1 else f"{finger}_0{n}_{side}"
                bone = rig.pose.bones.get(name)
                if bone is None:
                    continue
                direction = (bone.tail - bone.head).normalized()
                # the thumb closes across the palm, towards the fingers
                axis = direction.cross(palm if finger != "thumb" else (palm - across * 0.8).normalized())
                if axis.length < 1e-5:
                    continue
                pivot = Matrix.Translation(bone.head)
                bone.matrix = pivot @ Matrix.Rotation(math.radians(deg), 4, axis.normalized()) @ pivot.inverted() @ bone.matrix
                bpy.context.view_layer.update()
    bpy.ops.object.mode_set(mode="OBJECT")
    for mod in [m for m in body.modifiers if m.type == "ARMATURE"]:  # bake the curl into the mesh
        with bpy.context.temp_override(object=body, active_object=body, selected_objects=[body]):
            bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode="POSE")
    bpy.ops.pose.armature_apply(selected=False)                 # and make it the skeleton's rest pose
    bpy.ops.object.mode_set(mode="OBJECT")
    body.modifiers.new("rig", "ARMATURE").object = rig


def measure(meshes):
    """Chest and hip size and the head's size, from the dressed body (game axes)."""
    pts = [B2G @ (o.matrix_world @ v.co) for o in meshes for v in o.data.vertices]

    def ring(y0, y1, reach):
        ps = [p for p in pts if y0 < p.y < y1 and abs(p.x) < reach]
        return dict(y=(y0 + y1) / 2, w=max(abs(p.x) for p in ps), front=max(p.z for p in ps), back=min(p.z for p in ps))
    hip, eye = jp("Splitter").y, jp("L_Eyeball").y
    arm = jp("L_Shoulder").x
    chest = jp("L_Shoulder").y - 0.17                         # the middle of the plate carrier
    m = dict(chest=ring(chest - 0.08, chest + 0.06, arm - 0.02), hips=ring(hip - 0.03, hip + 0.05, 0.3))
    m["chest"]["y"] = chest
    m["hips"]["y"] = hip
    head = [B2G @ (meshes[0].matrix_world @ v.co) for v in meshes[0].data.vertices]
    skull = [p for p in head if p.y > eye + 0.035]
    m["head"] = dict(top=max(p.y for p in skull), cz=(max(p.z for p in skull) + min(p.z for p in skull)) / 2,
                     rw=max(abs(p.x) for p in skull), rd=(max(p.z for p in skull) - min(p.z for p in skull)) / 2, eye=eye)
    return m


# ---------------------------------------------------------------- scene, pictures, export
def clear_scene():
    if bpy.context.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    for block in (bpy.data.meshes, bpy.data.armatures):
        for d in list(block):
            if not d.users:
                block.remove(d)
    for m in list(bpy.data.materials):
        if m.name.startswith("hl_") or not m.users:
            bpy.data.materials.remove(m)
    for img in list(bpy.data.images):
        if not img.users:
            bpy.data.images.remove(img)


def picture(path, target, offset, scale, size, transparent):
    scene = bpy.context.scene
    extra = []
    cam_data = bpy.data.cameras.new("preview")
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = scale
    cam = bpy.data.objects.new("preview", cam_data)
    centre = G2B @ Vector(target)
    cam.location = centre + G2B @ Vector(offset)
    cam.rotation_euler = (centre - cam.location).to_track_quat("-Z", "Y").to_euler()
    extra.append(cam)
    for name, loc, energy, size_l in (("key", (-1.2, 1.2, 2.0), 45, 1.5), ("fill", (1.6, 0.3, 1.6), 14, 2.5), ("rim", (0.6, 1.2, -1.8), 40, 1.2)):
        ld = bpy.data.lights.new(name, "AREA")
        ld.energy, ld.size = energy, size_l
        lo = bpy.data.objects.new(name, ld)
        lo.location = centre + G2B @ Vector(loc)
        lo.rotation_euler = (centre - lo.location).to_track_quat("-Z", "Y").to_euler()
        extra.append(lo)
    for o in extra:
        scene.collection.objects.link(o)
    scene.camera = cam
    world = scene.world or bpy.data.worlds.new("World")
    scene.world = world
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (0.5, 0.52, 0.55, 1)
    world.node_tree.nodes["Background"].inputs[1].default_value = 0.6
    scene.render.engine = "BLENDER_EEVEE"
    scene.view_settings.view_transform = "Standard"
    scene.render.resolution_x, scene.render.resolution_y = size
    scene.render.film_transparent = transparent
    scene.render.image_settings.file_format = "WEBP" if path.endswith(".webp") else "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    scene.render.image_settings.file_format = "PNG"
    for o in extra:
        bpy.data.objects.remove(o, do_unlink=True)


def fix_alpha(path):
    """MPFB's materials all come out of the exporter as blended. Blended skin and cloth sort badly (the inside of
    the mouth shows through the face), so everything is made solid except hair, eyebrows and eyelashes, which
    are cut-out. Done by rewriting the material list in the GLB."""
    import json, struct
    raw = open(path, "rb").read()
    size = struct.unpack("<I", raw[12:16])[0]
    doc = json.loads(raw[20:20 + size])
    for mat in doc["materials"]:
        name = mat["name"]
        if not name.startswith("Human."):
            continue
        if any(k in name for k in ("eyebrow", "eyelash", "short", "bob", "afro", "ponytail", "braid", "long")):
            mat["alphaMode"] = "MASK"
            mat["alphaCutoff"] = 0.35
            mat["doubleSided"] = True
        else:
            mat.pop("alphaMode", None)
    text = json.dumps(doc, separators=(",", ":")).encode()
    text += b" " * (-len(text) % 4)
    rest = raw[20 + size:]
    open(path, "wb").write(raw[:8] + struct.pack("<I", 12 + 8 + len(text) + len(rest)) + struct.pack("<I", len(text)) + b"JSON" + text + rest)


def build(who):
    c = SOLDIERS[who]
    kit = c["kit"]
    clear_scene()
    rig, meshes, eyes = make_person(c, kit_textures(kit))
    game_skeleton(rig, eyes)
    m = measure(meshes)
    gear = [p.to_object() for p in (torso_gear(kit, m), limb_gear(kit), head_gear(kit, c["headgear"], c.get("headset", False), m["head"]))]
    for g in gear:
        g.modifiers.remove(g.modifiers["weighted-normals"])
    body = meshes[0]
    everything = [body, *meshes[1:], *gear]
    with bpy.context.temp_override(active_object=body, object=body, selected_objects=everything, selected_editable_objects=everything):
        bpy.ops.object.join()
    body.name = "body"
    body.parent = rig
    if not any(mod.type == "ARMATURE" for mod in body.modifiers):
        body.modifiers.new("rig", "ARMATURE").object = rig
    close_hands(rig, body)
    bpy.context.view_layer.update()
    eye = m["head"]["eye"]
    dbg = os.path.join(ROOT, "tools", "blender", "out")
    picture(os.path.join(dbg, f"bot-{who}.png"), (0, eye * 0.55, 0), (-1.6, 0.35, 3.0), 2.1, (900, 1300), False)
    picture(os.path.join(OUT, "portraits", f"{who}.webp"), (0, eye - 0.03, 0.02), (-0.7, 0.08, 2.2), 0.46, (384, 480), True)
    for o in bpy.data.objects:
        o.select_set(o in (rig, body))
    bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, who + ".glb"), export_format="GLB", use_selection=True, export_yup=True,
                              export_apply=False, export_animations=False, export_cameras=False, export_lights=False,
                              export_skins=True, export_vertex_color="MATERIAL", export_image_format="WEBP")
    fix_alpha(os.path.join(OUT, who + ".glb"))
    print(f"{who:8s} tris {sum(len(p.vertices) - 2 for p in body.data.polygons)}  bones {len(rig.data.bones)}  eye {eye:.3f}")


for who in [a for a in globals().get("ARGS", []) if a in SOLDIERS] or list(SOLDIERS):
    build(who)
