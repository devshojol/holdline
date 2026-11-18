"""Build the game's eight original guns in Blender and export them as GLB weapon skins.

Run inside the open Blender through the MCP addon:
    python3 tools/blender/bl.py tools/blender/make_weapons.py

Every gun is modelled from code, so the designs are ours. Parts are written in the game's own
axes (x right, y up, z along the barrel, metres) and turned into Blender's on creation, which the
glTF exporter turns back. Each gun is one joined `body` plus the moving parts the game animates as
their own nodes: `mag`, `bolt`, `cylinder`.

Writes public/models/weapons/<id>.glb, tools/blender/out/<id>.png (a side view) and
tools/blender/out/specs.json (grip, handguard, muzzle and sight points for WeaponSkins.ts).
"""
import json
import math
import os

import bmesh
import bpy
from mathutils import Matrix, Vector

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT_GLB = os.path.join(ROOT, "public", "models", "weapons")
OUT_DBG = os.path.join(ROOT, "tools", "blender", "out")
os.makedirs(OUT_GLB, exist_ok=True)
os.makedirs(OUT_DBG, exist_ok=True)

exec(open(os.path.join(ROOT, "tools", "blender", "hl_common.py")).read())
USE_SURFACES = True   # grain, scratches and uneven sheen on every finish
DEFAULT_UV = 0.085    # one texture repeat every 8.5 cm
SURFACE_DIR = OUT_DBG


# ---------------------------------------------------------------- the guns
# Each builder returns (parts, spec). Points are [y, z] like WeaponSkins.ts wants them.

def kestrel():
    """Assault rifle after the M4A1 carbine with a free-float rail: flat-top receiver, forward assist, collapsible
    stock, birdcage flash hider, curved 30-round magazine."""
    A, P, S = "anodized", "polymer", "parkerized"
    b = Part("body")
    # receivers (bore axis is y = 0)
    b.profile([(-0.118, -0.026), (-0.118, 0.018), (-0.108, 0.03), (0.108, 0.03), (0.108, -0.022), (0.066, -0.022), (0.058, -0.026)], 0.040, A, bevel=0.004)
    b.profile([(-0.122, -0.024), (0.058, -0.024), (0.066, -0.022), (0.07, -0.03), (0.07, -0.078), (0.062, -0.086), (0.006, -0.094),
               (-0.002, -0.06), (-0.012, -0.052), (-0.07, -0.052), (-0.082, -0.06), (-0.112, -0.05), (-0.126, -0.034)], 0.036, A, bevel=0.004)
    b.rail(-0.105, 0.105, 0.03, width=0.021, mat=A)
    b.box((0.05, 0.008, 0.028), (0, 0.021, -0.13), A, bevel=0.002)                              # charging handle
    b.box((0.012, 0.01, 0.014), (0.022, 0.021, -0.126), S, bevel=0.002)                         # its latch
    for z, y in ((-0.105, -0.04), (0.06, -0.034)):                                              # takedown and pivot pins
        b.tube_x(0.0042, 0.039, (0, y, z), "steel", seg=12)
    # left side (+x): selector, bolt catch
    b.tube_x(0.0055, 0.004, (0.019, -0.036, -0.064), S, seg=12)
    b.box((0.004, 0.006, 0.022), (0.0215, -0.036, -0.053), S, bevel=0.0015)
    b.box((0.004, 0.024, 0.012), (0.0195, -0.012, 0.04), S, bevel=0.0015)
    b.box((0.005, 0.012, 0.016), (0.021, -0.002, 0.04), S, bevel=0.002)
    # right side (-x): ejection port and cover, brass deflector, forward assist, magazine release
    b.box((0.003, 0.02, 0.072), (-0.0195, 0.004, 0.03), "void", bevel=0)
    b.box((0.004, 0.011, 0.074), (-0.021, -0.013, 0.03), A, bevel=0.0015)
    b.box((0.009, 0.018, 0.014), (-0.021, 0.006, -0.018), A, bevel=0.003, taper=(0.4, 1))
    b.tube(0.0065, -0.092, -0.066, y=0.012, x=-0.024, mat=S, seg=12)
    b.tube_x(0.0055, 0.005, (-0.0195, -0.04, 0.05), S, seg=12)
    # pistol grip, trigger guard, trigger
    b.profile([(-0.076, -0.05), (-0.036, -0.05), (-0.04, -0.062), (-0.052, -0.085), (-0.072, -0.15), (-0.078, -0.158),
               (-0.118, -0.152), (-0.122, -0.142), (-0.104, -0.09), (-0.094, -0.064)], 0.03, "walnut", bevel=0.007, seg=3)
    for i in range(6):                                                                          # grip texture
        t = i / 5
        b.bar((-0.062 - 0.02 * t, -0.078 - 0.058 * t), (-0.098 - 0.016 * t, -0.085 - 0.056 * t), 0.003, 0.0308, "void", bevel=0)
    b.bar((-0.036, -0.056), (-0.034, -0.09), 0.004, 0.012, A)
    b.bar((-0.034, -0.09), (0.004, -0.094), 0.004, 0.012, A)
    b.bar((-0.02, -0.052), (-0.025, -0.068), 0.005, 0.007, "steel")
    b.bar((-0.025, -0.068), (-0.02, -0.082), 0.005, 0.007, "steel")
    # barrel nut, free-float handguard with slots, top rail
    b.tube(0.019, 0.108, 0.128, y=0, mat=S, seg=20)
    b.box((0.044, 0.052, 0.275), (0, 0.004, 0.2625), A, bevel=0.012)
    b.box((0.049, 0.036, 0.235), (0, -0.008, 0.262), "walnut", bevel=0.012)                    # wooden lower handguard
    b.rail(0.13, 0.395, 0.03, width=0.021, mat=A)
    for i in range(5):
        z = 0.165 + i * 0.047
        for side in (-1, 1):
            b.box((0.003, 0.007, 0.032), (side * 0.0212, 0.021, z), "void", bevel=0)
    # barrel and muzzle device
    b.tube(0.0085, 0.39, 0.5, y=0, mat=S, seg=20)
    b.tube(0.012, 0.49, 0.497, y=0, mat="steel", seg=12)
    b.tube(0.011, 0.497, 0.552, y=0, mat=S, seg=20)
    for k in range(3):
        b.box((0.0035, 0.024, 0.026), (0, 0, 0.526), "void", bevel=0, rot=(0, 0, k * 60))
    b.tube(0.0115, 0.552, 0.556, y=0, mat=S, seg=20)
    b.tube(0.005, 0.5555, 0.5565, y=0, mat="void", seg=12)
    # buffer tube, castle nut, end plate
    b.tube(0.0145, -0.31, -0.118, y=0.004, mat=A, seg=20)
    b.tube(0.019, -0.133, -0.121, y=0.004, mat=S, seg=12)
    b.box((0.03, 0.042, 0.004), (0, -0.002, -0.136), S, bevel=0.001)
    # collapsible stock, butt pad, adjustment lever
    b.profile([(-0.175, 0.026), (-0.325, 0.026), (-0.338, 0.018), (-0.342, -0.092), (-0.334, -0.102), (-0.312, -0.1),
               (-0.262, -0.04), (-0.205, -0.022), (-0.175, -0.018)], 0.038, "walnut", bevel=0.006)
    b.profile([(-0.278, -0.036), (-0.318, -0.084), (-0.326, -0.03)], 0.0395, "void", bevel=0)
    b.profile([(-0.340, 0.02), (-0.352, 0.016), (-0.354, -0.096), (-0.342, -0.1)], 0.036, "rubber", bevel=0.003)
    b.bar((-0.2, -0.026), (-0.25, -0.036), 0.007, 0.02, S)
    # folding sights, raised
    for z in (-0.09, 0.375):
        b.box((0.02, 0.008, 0.03), (0, 0.0445, z), A, bevel=0.002)
    b.box((0.016, 0.03, 0.006), (0, 0.062, -0.085), A, bevel=0.002)
    b.tube(0.004, -0.0885, -0.0815, y=0.068, mat="void", seg=12)
    for side in (-1, 1):
        b.box((0.003, 0.03, 0.012), (side * 0.008, 0.062, 0.375), A, bevel=0.001)
    b.box((0.002, 0.022, 0.002), (0, 0.058, 0.375), "steel", bevel=0)
    m = Part("mag")
    m.profile([(0.058, -0.03), (0.06, -0.1), (0.068, -0.16), (0.082, -0.214), (0.03, -0.232), (0.018, -0.175), (0.011, -0.1), (0.01, -0.03)], 0.022, "bakelite", bevel=0.002)
    for z0, z1 in ((0.022, 0.04), (0.046, 0.064)):                                              # stamped ribs
        m.bar((z0 + 0.003, -0.06), (z0 + 0.024, -0.2), 0.006, 0.0245, "bakelite", bevel=0.0015)
    m.bar((0.026, -0.238), (0.086, -0.217), 0.008, 0.026, S, bevel=0.002)
    return [(b, (0, 0, 0)), (m, (0, -0.13, 0.045))], dict(
        grip=[-0.1, -0.082], handguard=[-0.03, 0.26], muzzle=[0.0, 0.556], sightY=0.068, magNode="mag")


# ---- shared pieces for the guns below (bore axis is y = 0 on every gun)
A, P, S = "anodized", "polymer", "parkerized"


def off(pts, dz=0.0, dy=0.0, k=1.0):
    return [(z * k + dz, y * k + dy) for z, y in pts]


GRIP = [(-0.04, 0), (0, 0), (-0.004, -0.012), (-0.016, -0.035), (-0.036, -0.10), (-0.042, -0.108),
        (-0.082, -0.102), (-0.086, -0.092), (-0.068, -0.04), (-0.058, -0.014)]


def pistol_grip(b, z, y, width=0.03, k=1.0, mat=P):
    """Rifle pistol grip; (z, y) is its top front corner."""
    b.profile(off(GRIP, z, y, k), width, mat, bevel=0.007, seg=3)
    for i in range(6):
        t = i / 5
        b.bar((z + k * (-0.026 - 0.02 * t), y + k * (-0.028 - 0.058 * t)), (z + k * (-0.062 - 0.016 * t), y + k * (-0.035 - 0.056 * t)), 0.004, width + 0.0015, "rubber", bevel=0.001)


def trigger_group(b, z, y, length=0.04, front=True, mat=A):
    """Trigger guard and trigger. (z, y) is the guard's rear top, under the receiver."""
    b.bar((z, y - 0.004), (z + 0.002, y - 0.038), 0.004, 0.012, mat)
    b.bar((z + 0.002, y - 0.038), (z + length, y - 0.042), 0.004, 0.012, mat)
    if front:
        b.bar((z + length, y - 0.042), (z + length + 0.006, y - 0.002), 0.004, 0.012, mat)
    b.bar((z + 0.016, y), (z + 0.011, y - 0.016), 0.005, 0.007, "steel")
    b.bar((z + 0.011, y - 0.016), (z + 0.016, y - 0.03), 0.005, 0.007, "steel")


def flip_sights(b, z_rear, z_front, y):
    """Folding iron sights, raised, standing on a rail whose top is y. Returns the sight line height."""
    for z in (z_rear, z_front):
        b.box((0.02, 0.008, 0.03), (0, y + 0.0145, z), A, bevel=0.002)
    b.box((0.016, 0.03, 0.006), (0, y + 0.032, z_rear + 0.005), A, bevel=0.002)
    b.tube(0.004, z_rear + 0.0015, z_rear + 0.0085, y=y + 0.038, mat="void", seg=12)
    for side in (-1, 1):
        b.box((0.003, 0.03, 0.012), (side * 0.008, y + 0.032, z_front), A, bevel=0.001)
    b.box((0.002, 0.022, 0.002), (0, y + 0.028, z_front), "steel", bevel=0)
    return y + 0.038


def scope(b, z0, z1, y, tube=0.015, objective=0.022, ocular=0.019, rail_y=0.03):
    """A telescopic sight from z0 (eyepiece) to z1 (objective lens), centred at height y. Returns its top."""
    mid = (z0 + z1) / 2
    for z in (mid - 0.045, mid + 0.04):                                   # rings and bases
        b.box((0.022, y - rail_y - 0.004, 0.016), (0, (y + rail_y) / 2 + 0.004, z), A, bevel=0.002)
        b.tube(tube + 0.004, z - 0.008, z + 0.008, y=y, mat=A, seg=20)
    b.tube(tube, z0 + 0.05, z1 - 0.07, y=y, mat=A, seg=20)
    b.tube(tube, z1 - 0.075, z1 - 0.045, y=y, mat=A, seg=20, radius2=objective)
    b.tube(objective, z1 - 0.045, z1, y=y, mat=A, seg=24)
    b.tube(tube, z0 + 0.03, z0 + 0.052, y=y, mat=A, seg=20, radius2=tube)
    b.tube(ocular, z0, z0 + 0.04, y=y, mat=A, seg=24)
    b.tube(ocular + 0.0015, z0 + 0.03, z0 + 0.04, y=y, mat="rubber", seg=24)      # zoom ring
    b.tube(objective - 0.003, z1 - 0.001, z1 + 0.0006, y=y, mat="lens", seg=24)
    b.tube(ocular - 0.003, z0 - 0.0006, z0 + 0.001, y=y, mat="lens", seg=24)
    b.tube_y(0.009, y + tube - 0.002, y + tube + 0.014, 0, mid, A)                # elevation turret
    b.tube_x(0.009, 2 * tube + 0.026, (0, y, mid), A)                             # windage and parallax
    return y + tube + 0.014


def muzzle_brake(b, z, r=0.0085, mat=S):
    """A ported brake screwed onto a barrel that ends at z. Returns the muzzle z."""
    b.tube(r + 0.0035, z - 0.012, z - 0.004, y=0, mat="steel", seg=12)
    b.box((0.03, 0.022, 0.05), (0, 0, z + 0.022), mat, bevel=0.005)
    for i in range(3):
        b.box((0.031, 0.011, 0.008), (0, 0, z + 0.008 + i * 0.014), "void", bevel=0)
    b.tube(0.0055, z + 0.0465, z + 0.0475, y=0, mat="void", seg=12)
    return z + 0.047


def halcyon():
    """Suppressed carbine after the AAC Honey Badger: AR-pattern receivers, short round handguard flush with a
    fat suppressor, two-rod sliding stock, red dot."""
    b = Part("body")
    b.profile([(-0.12, -0.024), (-0.12, 0.02), (-0.11, 0.03), (0.2, 0.03), (0.2, -0.02), (0.075, -0.02), (0.068, -0.024)], 0.04, A, bevel=0.004)
    b.profile([(-0.124, -0.022), (0.068, -0.022), (0.072, -0.03), (0.07, -0.08), (0.016, -0.086), (0.012, -0.056), (0.0, -0.05),
               (-0.07, -0.05), (-0.082, -0.058), (-0.114, -0.048), (-0.128, -0.032)], 0.036, P, bevel=0.004)
    b.rail(-0.105, 0.195, 0.03, width=0.021, mat=A)
    b.box((0.05, 0.008, 0.028), (0, 0.021, -0.132), A, bevel=0.002)                             # charging handle
    b.box((0.012, 0.01, 0.014), (0.022, 0.021, -0.128), S, bevel=0.002)
    b.box((0.004, 0.024, 0.012), (0.0195, -0.012, 0.04), S, bevel=0.0015)                       # bolt catch
    b.tube(0.0065, -0.092, -0.066, y=0.012, x=-0.024, mat=S, seg=12)                            # forward assist
    b.box((0.009, 0.018, 0.014), (-0.021, 0.006, -0.02), A, bevel=0.003, taper=(0.4, 1))        # brass deflector
    for z, y in ((-0.105, -0.038), (0.062, -0.034)):
        b.tube_x(0.0042, 0.039, (0, y, z), "steel", seg=12)
    b.tube_x(0.0055, 0.004, (0.019, -0.034, -0.062), S, seg=12)
    b.box((0.004, 0.006, 0.022), (0.0215, -0.034, -0.051), S, bevel=0.0015)
    b.box((0.003, 0.018, 0.06), (-0.0195, 0.006, 0.04), "void", bevel=0)                        # ejection port
    b.tube_x(0.0055, 0.005, (-0.0195, -0.04, 0.055), S, seg=12)
    pistol_grip(b, -0.03, -0.05)
    trigger_group(b, -0.03, -0.052, 0.04, front=False, mat=P)
    # round handguard, suppressor
    b.tube(0.0255, 0.2, 0.35, y=0.002, mat=A, seg=20)
    b.tube(0.027, 0.2, 0.212, y=0.002, mat=S, seg=20)
    for i in range(3):
        z = 0.24 + i * 0.04
        for side in (-1, 1):
            b.box((0.003, 0.007, 0.028), (side * 0.0248, 0.002, z), "void", bevel=0)
        b.box((0.007, 0.003, 0.028), (0, -0.0228, z), "void", bevel=0)
    b.tube(0.0238, 0.345, 0.575, y=0.002, mat=S, seg=24)
    b.tube(0.0244, 0.36, 0.364, y=0.002, mat="void", seg=24)
    b.tube(0.0244, 0.372, 0.376, y=0.002, mat="void", seg=24)
    b.tube(0.021, 0.575, 0.582, y=0.002, mat="steel", seg=24)
    b.tube(0.006, 0.5815, 0.5825, y=0, mat="void", seg=12)
    # sliding wire stock
    for side in (-1, 1):
        b.tube(0.0048, -0.325, -0.11, y=0.004, x=side * 0.016, mat="steel", seg=10)
    b.box((0.042, 0.03, 0.022), (0, 0.004, -0.128), A, bevel=0.004)
    b.profile([(-0.318, 0.03), (-0.332, 0.026), (-0.336, -0.085), (-0.326, -0.092), (-0.316, -0.06), (-0.314, 0.0)], 0.04, P, bevel=0.005)
    b.profile([(-0.334, 0.024), (-0.343, 0.02), (-0.345, -0.082), (-0.336, -0.088)], 0.038, "rubber", bevel=0.003)
    # red dot sight
    b.box((0.03, 0.012, 0.05), (0, 0.045, 0.0), A, bevel=0.003)
    b.pipe(0.0175, 0.0148, -0.03, 0.035, y=0.067, mat=A, seg=24)                                # hollow: you aim through it
    b.tube(0.0148, 0.0296, 0.0302, y=0.067, mat="glass", seg=24)
    b.tube(0.0016, 0.0288, 0.0294, y=0.067, mat="reddot", seg=12)                               # the dot, on the front glass
    b.tube_y(0.006, 0.083, 0.093, 0, 0.0, A, seg=12)
    b.tube_x(0.006, 0.01, (0.0215, 0.067, 0.012), A, seg=12)
    m = Part("mag")
    m.profile([(0.064, -0.03), (0.066, -0.1), (0.074, -0.16), (0.088, -0.21), (0.04, -0.228), (0.026, -0.172), (0.019, -0.1), (0.018, -0.03)], 0.024, P, bevel=0.003)
    for i in range(4):
        m.bar((0.026 + i * 0.004, -0.075 - i * 0.03), (0.062 + i * 0.004, -0.07 - i * 0.03), 0.004, 0.0255, "rubber", bevel=0.001)
    m.bar((0.036, -0.234), (0.092, -0.214), 0.008, 0.027, P, bevel=0.002)
    return [(b, (0, 0, 0)), (m, (0, -0.12, 0.045))], dict(
        grip=[-0.1, -0.076], handguard=[-0.03, 0.27], muzzle=[0.0, 0.582], sightY=0.067, aimThrough=True, magNode="mag")


def hornet():
    """Submachine gun after the H&K MP5A3: round-topped stamped receiver, cocking tube over the barrel,
    hooded front sight, drum rear sight, curved magazine, retractable stock on two rails, pushed in."""
    b = Part("body")
    b.profile([(-0.15, -0.02), (-0.15, 0.022), (-0.142, 0.034), (0.11, 0.034), (0.11, -0.02)], 0.04, A, bevel=0.009, seg=3)
    b.box((0.042, 0.05, 0.012), (0, 0.006, -0.156), S, bevel=0.004)                             # end cap
    b.box((0.003, 0.016, 0.055), (-0.0205, 0.012, 0.03), "void", bevel=0)                       # ejection port
    # cocking tube, handle and slot
    b.tube(0.0115, 0.105, 0.3, y=0.026, mat=A, seg=16)
    b.box((0.003, 0.006, 0.12), (0.0112, 0.03, 0.2), "void", bevel=0)
    b.tube_x(0.0045, 0.03, (0.022, 0.03, 0.235), S, seg=10)
    b.tube_x(0.0075, 0.012, (0.04, 0.03, 0.235), P, seg=12)
    b.tube(0.0125, 0.295, 0.303, y=0.026, mat=S, seg=16)
    # barrel with three-lug muzzle
    b.tube(0.0075, 0.105, 0.325, y=0, mat=S, seg=16)
    b.tube(0.0095, 0.3, 0.312, y=0, mat="steel", seg=12)
    b.tube(0.0046, 0.3245, 0.3255, y=0, mat="void", seg=12)
    # hooded front sight
    b.box((0.014, 0.036, 0.014), (0, 0.024, 0.286), A, bevel=0.003)
    b.tube(0.0145, 0.279, 0.293, y=0.058, mat=A, seg=20)
    b.tube(0.0115, 0.2785, 0.2935, y=0.058, mat="void", seg=20)
    b.box((0.002, 0.012, 0.0155), (0, 0.05, 0.286), "steel", bevel=0)
    # drum rear sight
    b.box((0.026, 0.008, 0.03), (0, 0.037, -0.112), A, bevel=0.002)
    b.tube_x(0.0105, 0.022, (0, 0.05, -0.112), S, seg=16)
    b.tube(0.0035, -0.1235, -0.1005, y=0.053, mat="void", seg=10)
    # slim polymer handguard
    b.profile([(0.112, -0.032), (0.112, 0.013), (0.268, 0.013), (0.276, 0.0), (0.27, -0.026), (0.25, -0.036), (0.13, -0.038)], 0.044, P, bevel=0.01)
    for i in range(3):
        for side in (-1, 1):
            b.box((0.003, 0.006, 0.03), (side * 0.0215, -0.012, 0.15 + i * 0.042), "void", bevel=0)
    # trigger housing with integral grip, magazine well, paddle release
    b.profile([(-0.138, -0.018), (0.03, -0.018), (0.03, -0.05), (-0.03, -0.056), (-0.05, -0.05), (-0.138, -0.04)], 0.036, P, bevel=0.004)
    pistol_grip(b, -0.05, -0.05, width=0.03, k=0.98)
    trigger_group(b, -0.048, -0.054, 0.074, front=False, mat=P)
    b.profile([(0.03, -0.018), (0.086, -0.018), (0.086, -0.062), (0.03, -0.062)], 0.034, A, bevel=0.003)
    b.box((0.012, 0.02, 0.006), (0, -0.07, 0.027), S, bevel=0.002, rot=(20, 0, 0))
    b.tube_x(0.0055, 0.004, (0.019, -0.03, -0.085), S, seg=12)                                  # selector
    b.box((0.004, 0.006, 0.022), (0.0215, -0.03, -0.074), S, bevel=0.0015)
    for z in (-0.125, 0.02, 0.1):
        b.tube_x(0.004, 0.0415, (0, -0.012, z), "steel", seg=12)
    # retractable stock, pushed in: only the butt plate shows (its rails are inside the receiver)
    # the stock is pushed in: fully out, its two rails ran past the camera as bars across the screen
    b.profile(off([(-0.332, 0.032), (-0.346, 0.028), (-0.352, -0.07), (-0.342, -0.08), (-0.33, -0.05)], 0.162), 0.054, P, bevel=0.005)
    b.profile(off([(-0.35, 0.026), (-0.358, 0.022), (-0.36, -0.066), (-0.352, -0.07)], 0.162), 0.05, "rubber", bevel=0.003)
    m = Part("mag")
    m.profile([(0.08, -0.04), (0.082, -0.1), (0.09, -0.165), (0.102, -0.22), (0.07, -0.232), (0.056, -0.172), (0.048, -0.1), (0.046, -0.04)], 0.022, S, bevel=0.002)
    m.bar((0.066, -0.07), (0.084, -0.215), 0.006, 0.0245, S, bevel=0.0015)
    m.bar((0.067, -0.238), (0.106, -0.224), 0.008, 0.026, S, bevel=0.002)
    return [(b, (0, 0, 0)), (m, (0, -0.13, 0.07))], dict(
        grip=[-0.104, -0.094], handguard=[-0.038, 0.19], muzzle=[0.0, 0.3255], sightY=0.059, magNode="mag")


def arbiter():
    """Marksman rifle after the Knight's SR-25 / M110: AR-10 pattern receivers, long rail handguard, 20-round
    magazine, fixed stock with a cheek piece, scope and bipod."""
    A, P = "fde", "tan"  # the whole rifle is flat dark earth; the scope and barrel stay black
    b = Part("body")
    b.profile([(-0.13, -0.028), (-0.13, 0.02), (-0.12, 0.032), (0.125, 0.032), (0.125, -0.024), (0.085, -0.024), (0.076, -0.028)], 0.043, A, bevel=0.004)
    b.profile([(-0.134, -0.026), (0.076, -0.026), (0.086, -0.024), (0.09, -0.032), (0.09, -0.078), (0.082, -0.086), (0.012, -0.092),
               (0.006, -0.062), (-0.006, -0.054), (-0.078, -0.054), (-0.09, -0.062), (-0.122, -0.052), (-0.138, -0.036)], 0.039, A, bevel=0.004)
    b.rail(-0.115, 0.12, 0.032, width=0.021, mat=A)
    b.box((0.052, 0.008, 0.03), (0, 0.023, -0.142), A, bevel=0.002)
    for z, y in ((-0.115, -0.042), (0.078, -0.036)):
        b.tube_x(0.0045, 0.042, (0, y, z), "steel", seg=12)
    b.tube_x(0.0055, 0.004, (0.0205, -0.038, -0.07), S, seg=12)
    b.box((0.004, 0.006, 0.022), (0.023, -0.038, -0.059), S, bevel=0.0015)
    b.box((0.004, 0.026, 0.013), (0.021, -0.012, 0.05), S, bevel=0.0015)
    b.box((0.003, 0.022, 0.085), (-0.021, 0.004, 0.04), "void", bevel=0)
    b.box((0.004, 0.011, 0.087), (-0.0225, -0.014, 0.04), A, bevel=0.0015)
    b.box((0.009, 0.018, 0.014), (-0.0225, 0.006, -0.016), A, bevel=0.003, taper=(0.4, 1))
    b.tube_x(0.0055, 0.005, (-0.021, -0.042, 0.062), S, seg=12)
    pistol_grip(b, -0.04, -0.054, width=0.031, k=1.04, mat=P)
    trigger_group(b, -0.04, -0.056, 0.046, front=False, mat=A)
    # long handguard
    b.tube(0.02, 0.125, 0.145, y=0, mat=S, seg=20)
    b.box((0.042, 0.05, 0.36), (0, 0.006, 0.325), A, bevel=0.012)
    b.rail(0.15, 0.5, 0.032, width=0.021, mat=A)
    for i in range(7):
        z = 0.18 + i * 0.047
        for side in (-1, 1):
            b.box((0.003, 0.007, 0.032), (side * 0.0202, 0.006, z), "void", bevel=0)
        b.box((0.007, 0.003, 0.032), (0, -0.0182, z), "void", bevel=0)
    # heavy barrel and brake
    b.tube(0.0098, 0.5, 0.665, y=0, mat=S, seg=20)
    muzzle = muzzle_brake(b, 0.665, 0.0098)
    # precision stock: tube, body, adjustable cheek piece and butt pad
    b.tube(0.0145, -0.2, -0.13, y=0.004, mat=A, seg=20)
    b.tube(0.019, -0.146, -0.134, y=0.004, mat=S, seg=12)
    b.profile([(-0.17, 0.022), (-0.37, 0.022), (-0.384, 0.014), (-0.388, -0.1), (-0.378, -0.108), (-0.33, -0.104), (-0.25, -0.05),
               (-0.2, -0.034), (-0.17, -0.02)], 0.04, P, bevel=0.007)
    b.profile([(-0.3, -0.045), (-0.36, -0.092), (-0.37, -0.04)], 0.0415, "void", bevel=0)
    b.profile([(-0.205, 0.022), (-0.212, 0.04), (-0.325, 0.04), (-0.332, 0.022)], 0.034, P, bevel=0.006, seg=3)       # cheek piece
    for z in (-0.24, -0.3):
        b.tube_x(0.006, 0.045, (0, 0.012, z), S, seg=12)
    b.profile([(-0.386, 0.016), (-0.398, 0.012), (-0.4, -0.102), (-0.388, -0.106)], 0.038, "rubber", bevel=0.003)
    b.box((0.04, 0.016, 0.03), (0, -0.026, 0.47), S, bevel=0.004)                               # bipod, folded back
    for side in (-1, 1):
        b.tube(0.005, 0.28, 0.465, y=-0.034, x=side * 0.015, mat=S, seg=10)
        b.tube(0.0075, 0.275, 0.3, y=-0.034, x=side * 0.015, mat="rubber", seg=10)
    top = scope(b, -0.115, 0.165, 0.062, tube=0.015, objective=0.0215, ocular=0.019, rail_y=0.038)
    m = Part("mag")
    m.profile([(0.082, -0.03), (0.084, -0.13), (0.08, -0.138), (0.024, -0.142), (0.02, -0.134), (0.016, -0.03)], 0.025, P, bevel=0.003)
    for i in range(3):
        m.bar((0.028, -0.07 - i * 0.022), (0.076, -0.068 - i * 0.022), 0.004, 0.0265, "rubber", bevel=0.001)
    return [(b, (0, 0, 0)), (m, (0, -0.09, 0.05))], dict(
        grip=[-0.106, -0.088], handguard=[-0.028, 0.3], muzzle=[0.0, muzzle], sightY=top, magNode="mag")


def monarch():
    """Bolt-action sniper rifle after the Accuracy International Arctic Warfare: green thumbhole stock around a
    steel action, long fluted barrel with a two-chamber brake, large scope, bipod at the fore-end tip."""
    O = "olive"
    b = Part("body")
    # one-piece thumbhole stock
    b.profile([(-0.47, 0.014), (-0.27, 0.018), (-0.225, -0.004), (-0.2, -0.012), (0.42, -0.012), (0.432, -0.02), (0.432, -0.044), (0.42, -0.052),
               (0.13, -0.056), (0.122, -0.066), (0.03, -0.07), (0.022, -0.056), (-0.03, -0.056), (-0.052, -0.072), (-0.07, -0.15), (-0.078, -0.158),
               (-0.47, -0.135), (-0.478, -0.125)], 0.048, O, bevel=0.008)
    b.profile([(-0.122, -0.048), (-0.18, -0.042), (-0.212, -0.068), (-0.2, -0.108), (-0.142, -0.118), (-0.114, -0.09)], 0.0495, "void", bevel=0)   # thumbhole
    b.profile([(-0.3, 0.018), (-0.306, 0.04), (-0.42, 0.04), (-0.428, 0.016)], 0.036, O, bevel=0.007, seg=3)           # cheek piece
    for z in (-0.33, -0.4):
        b.tube_x(0.006, 0.05, (0, 0.006, z), S, seg=12)
    b.profile([(-0.476, 0.014), (-0.484, 0.012), (-0.486, -0.128), (-0.478, -0.132)], 0.05, S, bevel=0.002)            # spacer
    b.profile([(-0.484, 0.012), (-0.5, 0.008), (-0.502, -0.126), (-0.486, -0.13)], 0.046, "rubber", bevel=0.004)       # butt pad
    for i in range(5):                                                                          # fore-end grip grooves
        for side in (-1, 1):
            b.box((0.003, 0.02, 0.006), (side * 0.0242, -0.034, 0.2 + i * 0.03), "void", bevel=0)
    for z in (-0.15, 0.1, 0.36):                                                                # stock bolts
        b.tube_x(0.005, 0.0495, (0, -0.034, z), S, seg=10)
    # action, barrel
    b.tube(0.0175, -0.2, 0.15, y=0, mat=S, seg=24)
    b.box((0.003, 0.014, 0.085), (-0.0165, 0.004, 0.02), "void", bevel=0)
    b.box((0.014, 0.003, 0.085), (-0.008, 0.0165, 0.02), "void", bevel=0)
    b.tube(0.0205, 0.15, 0.158, y=0, mat="steel", seg=24)
    b.tube(0.0135, 0.158, 0.74, y=0, mat=S, seg=20, radius2=0.011)
    for k in range(6):
        ang = k * math.pi / 3 + math.pi / 6
        b.box((0.0035, 0.0035, 0.3), (math.cos(ang) * 0.0122, math.sin(ang) * 0.0122, 0.47), "void", bevel=0, rot=(0, 0, math.degrees(ang)))
    b.rail(-0.19, 0.14, 0.0175, width=0.021, mat=A)
    # two-chamber muzzle brake
    b.tube(0.0145, 0.728, 0.736, y=0, mat="steel", seg=12)
    b.tube(0.0185, 0.736, 0.8, y=0, mat=S, seg=20)
    for z in (0.752, 0.778):
        b.box((0.04, 0.016, 0.014), (0, 0, z), "void", bevel=0)
    b.tube(0.0065, 0.7995, 0.8005, y=0, mat="void", seg=12)
    trigger_group(b, -0.05, -0.056, 0.066, front=False, mat=S)
    # bipod folded back from the fore-end tip
    b.box((0.05, 0.02, 0.03), (0, -0.056, 0.425), S, bevel=0.004)
    for side in (-1, 1):
        b.tube(0.0055, 0.2, 0.42, y=-0.07, x=side * 0.017, mat=S, seg=10)
        b.tube(0.008, 0.195, 0.225, y=-0.07, x=side * 0.017, mat="rubber", seg=10)
    top = scope(b, -0.19, 0.2, 0.058, tube=0.017, objective=0.029, ocular=0.022, rail_y=0.0235)
    bolt = Part("bolt")
    bolt.tube(0.0115, -0.262, -0.08, y=0, mat="steel", seg=16)
    bolt.tube(0.0135, -0.262, -0.24, y=0, mat=S, seg=16)
    bolt.tube_x(0.0048, 0.045, (-0.035, -0.008, -0.215), "steel", seg=10)
    bolt.ball((-0.066, -0.012, -0.215), (0.012, 0.012, 0.012), P, seg=12, rings=6)              # ball knob
    m = Part("mag")
    m.profile([(0.118, -0.05), (0.118, -0.096), (0.112, -0.102), (0.04, -0.106), (0.034, -0.098), (0.034, -0.05)], 0.03, S, bevel=0.003)
    return [(b, (0, 0, 0)), (bolt, (0, 0, -0.215)), (m, (0, -0.08, 0.076))], dict(
        grip=[-0.112, -0.09], handguard=[-0.056, 0.3], muzzle=[0.0, 0.8005], sightY=top,
        magNode="mag", boltNode="bolt", boltAxis=[0.0, -0.215])


def _pistol(front, suppressed):
    """Striker-fired service pistol. `front` is the slide's front face z; the bore is y = 0."""
    b = Part("body")
    # slide: flat sides, rounded top, serrations, ejection port
    b.profile([(-0.09, -0.012), (-0.09, 0.017), (-0.086, 0.022), (front - 0.006, 0.022), (front, 0.015), (front, -0.012)], 0.026, S, bevel=0.0035)
    for i in range(7):
        b.box((0.0268, 0.022, 0.0022), (0, 0.004, -0.082 + i * 0.0055), "void", bevel=0, rot=(-12, 0, 0))
    b.box((0.003, 0.012, 0.034), (-0.0125, 0.01, 0.018), "void", bevel=0)
    b.box((0.014, 0.003, 0.034), (-0.006, 0.0212, 0.018), "void", bevel=0)
    b.box((0.012, 0.009, 0.03), (-0.004, 0.0165, 0.018), "steel", bevel=0.001)                  # barrel hood in the port
    # frame, dust cover with rail, beavertail
    b.profile([(-0.092, -0.012), (front - 0.002, -0.012), (front - 0.002, -0.026), (0.036, -0.031), (-0.03, -0.031), (-0.046, -0.036),
               (-0.092, -0.03), (-0.103, -0.024), (-0.1, -0.016)], 0.0275, P, bevel=0.003)
    for i in range(3):
        b.box((0.029, 0.003, 0.006), (0, -0.0285, 0.05 + i * 0.012), "void", bevel=0)
    b.box((0.003, 0.005, 0.03), (0.0142, -0.015, 0.002), S, bevel=0.001)                        # slide stop
    b.box((0.003, 0.004, 0.012), (0.0142, -0.019, 0.045), S, bevel=0.001)                       # takedown lever
    b.tube_x(0.0032, 0.0295, (0, -0.037, -0.044), S, seg=12)                                    # magazine release
    # grip
    b.profile([(-0.092, -0.03), (-0.042, -0.031), (-0.05, -0.07), (-0.064, -0.128), (-0.1, -0.121), (-0.105, -0.112), (-0.098, -0.07)], 0.0285, P, bevel=0.006, seg=3)
    b.profile([(-0.086, -0.045), (-0.056, -0.046), (-0.07, -0.115), (-0.094, -0.11), (-0.09, -0.07)], 0.0295, "rubber", bevel=0.001, seg=1)
    # trigger guard and trigger
    b.bar((0.036, -0.031), (0.034, -0.06), 0.005, 0.013, P)
    b.bar((0.034, -0.06), (-0.02, -0.066), 0.005, 0.013, P)
    b.bar((-0.02, -0.066), (-0.04, -0.058), 0.005, 0.013, P)
    b.bar((0.002, -0.031), (-0.004, -0.046), 0.005, 0.007, "steel")
    b.bar((-0.004, -0.046), (0.002, -0.058), 0.005, 0.007, "steel")
    # muzzle end: barrel and guide rod
    end = front + (0.022 if suppressed else 0.004)
    b.tube(0.0068, front - 0.004, end, y=0, mat="steel", seg=16)
    b.tube(0.0036, front - 0.004, front + 0.0012, y=-0.0085, mat="steel", seg=10)
    sight_h = 0.012 if suppressed else 0.0055
    b.box((0.004, sight_h, 0.007), (0, 0.022 + sight_h / 2, front - 0.012), "steel", bevel=0.001)
    for side in (-1, 1):
        b.box((0.006, sight_h, 0.008), (side * 0.006, 0.022 + sight_h / 2, -0.082), "steel", bevel=0.001)
    b.box((0.0015, 0.0015, 0.0005), (0, 0.022 + sight_h - 0.0018, front - 0.0157), "dot", bevel=0)
    if suppressed:
        b.profile([(-0.09, 0.004), (-0.098, 0.016), (-0.106, 0.016), (-0.104, 0.006), (-0.094, -0.012)], 0.008, "steel", bevel=0.0015)   # hammer
        b.tube_x(0.004, 0.0295, (0, -0.014, -0.06), S, seg=10)                                  # control lever
        b.box((0.003, 0.005, 0.024), (0.0145, -0.013, -0.048), S, bevel=0.001)
        b.tube(0.0085, end - 0.004, end + 0.006, y=0, mat="steel", seg=12)                      # mount
        b.tube(0.0165, end + 0.004, end + 0.168, y=0, mat=S, seg=24)
        for i in range(8):
            b.tube(0.0169, end + 0.012 + i * 0.004, end + 0.0135 + i * 0.004, y=0, mat="void", seg=24)
        b.tube(0.015, end + 0.168, end + 0.173, y=0, mat="steel", seg=24)
        end += 0.173
    b.tube(0.0046, end - 0.0006, end + 0.0006, y=0, mat="void", seg=12)
    m = Part("mag")
    m.profile([(-0.052, -0.04), (-0.066, -0.12), (-0.096, -0.114), (-0.082, -0.04)], 0.02, S, bevel=0.002)
    m.profile([(-0.06, -0.127), (-0.063, -0.137), (-0.102, -0.13), (-0.104, -0.119)], 0.0295, P, bevel=0.003)
    return [(b, (0, 0, 0)), (m, (0, -0.085, -0.072))], dict(
        grip=[-0.078, -0.072], handguard=None, muzzle=[0.0, end + 0.0006], sightY=0.022 + sight_h, magNode="mag")


def pilot():
    """Service pistol after the Glock 17: blocky slide, polymer frame, no external hammer."""
    return _pistol(0.1, False)


def whisper():
    """Suppressed pistol after the H&K USP Tactical: exposed hammer, control lever, threaded barrel,
    tall sights that clear the suppressor."""
    return _pistol(0.112, True)


def magnate():
    """Heavy double-action revolver after the Colt Python: blued steel, ventilated rib, full underlug barrel,
    walnut grip, six-shot cylinder that turns."""
    B = "blued"
    cy = -0.019  # cylinder axis; the top chamber lines up with the bore at y = 0
    b = Part("body")
    b.profile([(-0.05, 0.008), (-0.05, 0.017), (0.024, 0.017), (0.024, 0.008)], 0.018, B, bevel=0.002)                # top strap
    b.profile([(-0.05, 0.017), (-0.032, 0.017), (-0.032, -0.046), (-0.05, -0.05), (-0.064, -0.022), (-0.062, 0.006)], 0.03, B, bevel=0.004)
    b.profile([(0.014, 0.017), (0.042, 0.017), (0.042, -0.03), (0.032, -0.046), (0.014, -0.046)], 0.024, B, bevel=0.003)
    b.profile([(-0.04, -0.043), (0.032, -0.043), (0.03, -0.052), (0.0, -0.054), (-0.04, -0.052)], 0.018, B, bevel=0.002)
    b.tube(0.0052, -0.036, 0.016, y=cy, mat="steel", seg=10)                                    # cylinder pin
    # barrel with full underlug, rib and ramp sight
    b.tube(0.0088, 0.04, 0.166, y=0, mat=B, seg=20)
    b.profile([(0.042, 0.004), (0.166, 0.004), (0.166, -0.024), (0.156, -0.03), (0.042, -0.03)], 0.016, B, bevel=0.005)
    b.profile([(0.042, 0.0075), (0.166, 0.0075), (0.166, 0.0155), (0.042, 0.0155)], 0.009, B, bevel=0.001)
    for i in range(4):                                                                          # vents in the rib
        b.box((0.0095, 0.0035, 0.02), (0, 0.0105, 0.062 + i * 0.027), "void", bevel=0)
    b.profile([(0.13, 0.015), (0.162, 0.015), (0.162, 0.026), (0.154, 0.026)], 0.004, B, bevel=0.0005, seg=1)
    b.tube(0.0057, 0.1655, 0.1667, y=0, mat="void", seg=12)
    b.tube(0.0035, 0.045, 0.1, y=-0.021, x=0.0, mat="steel", seg=10)                            # ejector rod
    # rear sight, hammer, cylinder latch
    for side in (-1, 1):
        b.box((0.005, 0.006, 0.01), (side * 0.005, 0.02, -0.044), B, bevel=0.001)
    b.profile([(-0.052, 0.01), (-0.058, 0.03), (-0.07, 0.034), (-0.072, 0.028), (-0.064, 0.02), (-0.062, 0.0)], 0.008, "steel", bevel=0.0015)
    b.box((0.004, 0.01, 0.014), (0.0165, -0.012, -0.046), B, bevel=0.002)
    # trigger guard, trigger
    b.bar((0.002, -0.054), (0.004, -0.08), 0.005, 0.012, B)
    b.bar((0.004, -0.08), (-0.036, -0.086), 0.005, 0.012, B)
    b.bar((-0.036, -0.086), (-0.052, -0.07), 0.005, 0.012, B)
    b.bar((-0.016, -0.052), (-0.02, -0.066), 0.005, 0.007, "steel")
    b.bar((-0.02, -0.066), (-0.014, -0.078), 0.005, 0.007, "steel")
    # walnut grip with a steel medallion
    b.profile([(-0.04, -0.052), (-0.052, -0.048), (-0.066, -0.022), (-0.08, -0.03), (-0.086, -0.07), (-0.104, -0.125), (-0.098, -0.137),
               (-0.06, -0.133), (-0.052, -0.123), (-0.054, -0.085)], 0.03, "walnut", bevel=0.008, seg=3)
    b.tube_x(0.005, 0.0315, (0, -0.06, -0.068), "steel", seg=12)
    c = Part("cylinder")
    c.tube(0.0215, -0.031, 0.0125, y=cy, mat=B, seg=24)
    for k in range(6):
        ang = k * math.pi / 3
        f = ang + math.pi / 6                                                                   # stop notches between chambers
        c.box((0.005, 0.003, 0.007), (math.cos(f) * 0.0208, cy + math.sin(f) * 0.0208, -0.022), "void", bevel=0, rot=(0, 0, math.degrees(f) - 90))
        c.tube(0.0056, 0.012, 0.0132, y=cy + math.sin(ang + math.pi / 2) * 0.0135, x=math.cos(ang + math.pi / 2) * 0.0135, mat="void", seg=10)
    c.tube(0.0218, -0.031, -0.027, y=cy, mat="steel", seg=24)                                   # rear rim
    return [(b, (0, 0, 0)), (c, (0, cy, 0.0))], dict(
        grip=[-0.09, -0.076], handguard=None, muzzle=[0.0, 0.1667], sightY=0.027,
        cylinderNode="cylinder", chambers=6)


# game weapon id -> (builder, display name)
GUNS = {
    "vandal": (kestrel, "Kestrel"),
    "phantom": (halcyon, "Halcyon"),
    "spectre": (hornet, "Hornet"),
    "guardian": (arbiter, "Arbiter"),
    "operator": (monarch, "Monarch"),
    "classic": (pilot, "Pilot"),
    "ghost": (whisper, "Whisper"),
    "sheriff": (magnate, "Magnate"),
}


# ---------------------------------------------------------------- scene, preview, export
def clear_scene():
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    for m in list(bpy.data.meshes):
        if not m.users:
            bpy.data.meshes.remove(m)
    for m in list(bpy.data.materials):
        if m.name.startswith("hl_"):
            bpy.data.materials.remove(m)
    SURFACES.clear()


def render_side_view(path, zmin, zmax, ymin, ymax):
    """A lit three-quarter picture of the gun's left side."""
    scene = bpy.context.scene
    extra = []
    cam_data = bpy.data.cameras.new("preview")
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = max(zmax - zmin, (ymax - ymin) * 2.4) * 1.15
    cam = bpy.data.objects.new("preview", cam_data)
    centre = G2B @ Vector((0, (ymin + ymax) / 2, (zmin + zmax) / 2))
    cam.location = centre + Vector((2.0, -0.9, 0.5))
    cam.rotation_euler = (centre - cam.location).to_track_quat("-Z", "Y").to_euler()
    extra.append(cam)
    for name, loc, energy, size in (("key", (1.5, -1.2, 1.6), 45, 1.2), ("fill", (1.6, 1.4, 0.3), 12, 2.0), ("rim", (-1.5, 0.4, 1.2), 40, 1.0)):
        ld = bpy.data.lights.new(name, "AREA")
        ld.energy, ld.size = energy, size
        lo = bpy.data.objects.new(name, ld)
        lo.location = centre + Vector(loc)
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
    for engine in ("BLENDER_EEVEE", "BLENDER_EEVEE_NEXT", "BLENDER_WORKBENCH"):
        try:
            scene.render.engine = engine
            break
        except TypeError:
            continue
    scene.view_settings.view_transform = "Standard"
    scene.render.resolution_x, scene.render.resolution_y = 1600, 700
    scene.render.film_transparent = False
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    for o in extra:
        bpy.data.objects.remove(o, do_unlink=True)


def build(gun_id):
    builder, title = GUNS[gun_id]
    clear_scene()
    parts, spec = builder()
    objs = [p.to_object(origin) for p, origin in parts]
    los, his = [], []
    for o in objs:
        for corner in o.bound_box:
            w = G2B.inverted() @ (o.matrix_basis @ Vector(corner))
            los.append(w)
    zmin, zmax = min(v.z for v in los), max(v.z for v in los)
    ymin, ymax = min(v.y for v in los), max(v.y for v in los)
    bpy.context.view_layer.update()
    render_side_view(os.path.join(OUT_DBG, title.lower() + ".png"), zmin, zmax, ymin, ymax)
    for o in bpy.data.objects:
        o.select_set(o in objs)
    bpy.ops.export_scene.gltf(filepath=os.path.join(OUT_GLB, title.lower() + ".glb"), export_format="GLB", use_selection=True,
                              export_yup=True, export_apply=True, export_animations=False, export_cameras=False, export_lights=False,
                              export_vertex_color="MATERIAL", export_image_format="WEBP")
    tris = sum(len(o.data.loop_triangles) or sum(len(p.vertices) - 2 for p in o.data.polygons) for o in objs)
    spec = dict(file=f"models/weapons/{title.lower()}.glb", name=title, yaw=0, length=round(zmax - zmin, 4), **spec)
    print(f"{gun_id:9s} {title:8s} length {zmax - zmin:.3f} m  z {zmin:.3f}..{zmax:.3f}  tris {tris}")
    return spec


ids = [a for a in globals().get("ARGS", []) if a in GUNS] or list(GUNS)
specs_path = os.path.join(OUT_DBG, "specs.json")
specs = json.load(open(specs_path)) if os.path.exists(specs_path) else {}
for gun_id in ids:
    specs[gun_id] = build(gun_id)
json.dump(specs, open(specs_path, "w"), indent=2)
