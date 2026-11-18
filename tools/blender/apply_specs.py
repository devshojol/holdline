#!/usr/bin/env python3
"""Write the gun points from tools/blender/out/specs.json into src/game/weapons/WeaponSkins.ts."""
import json, os

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
specs = json.load(open(os.path.join(ROOT, "tools/blender/out/specs.json")))
VIEW = {"spectre": 0.56, "guardian": 1.1, "operator": 1.2, "ghost": 0.55, "classic": 0.31}  # first-person lengths (m)
ORDER = ["vandal", "phantom", "spectre", "guardian", "operator", "classic", "ghost", "sheriff"]
fmt = lambda p: "null" if p is None else f"[{round(p[0], 4)}, {round(p[1], 4)}]"
out = ["// Our own guns, modelled from code in Blender (tools/blender/make_weapons.py): barrel along +Z, in metres.",
       "// Written by tools/blender/apply_specs.py from tools/blender/out/specs.json.",
       "const SKIN_SPECS: Partial<Record<WeaponId, SkinSpec>> = {"]
for k in ORDER:
    s = specs[k]
    out += [f"  // {s['name']}", f"  {k}: {{", f"    file: '{s['file']}',", "    yaw: 0,", f"    length: {s['length']},"]
    if k in VIEW:
        out.append(f"    viewLength: {VIEW[k]},")
    out += [f"    grip: {fmt(s['grip'])},", f"    handguard: {fmt(s['handguard'])},", f"    muzzle: {fmt(s['muzzle'])},", f"    sightY: {round(s['sightY'], 4)},"]
    for f in ("magNode", "boltNode", "cylinderNode"):
        if f in s:
            out.append(f"    {f}: '{s[f]}',")
    if "boltAxis" in s:
        out.append(f"    boltAxis: {fmt(s['boltAxis'])},")
    if s.get("aimThrough"):
        out.append("    aimThrough: true,")
    if "chambers" in s:
        out.append(f"    chambers: {s['chambers']},")
    out.append("  },")
out.append("};")
path = os.path.join(ROOT, "src/game/weapons/WeaponSkins.ts")
t = open(path).read()
a, b = t.index("// Our own guns"), t.index("/** The model file of a gun")
open(path, "w").write(t[:a] + "\n".join(out) + "\n\n" + t[b:])
print("WeaponSkins.ts updated")
