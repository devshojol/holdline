import bpy
OUT = ARGS[0]; MODE = ARGS[1]
old = bpy.data.scenes.get("CoverText")
if old: bpy.data.scenes.remove(old)
sc = bpy.data.scenes.new("CoverText")
font = bpy.data.fonts.load("/System/Library/Fonts/Supplemental/DIN Condensed Bold.ttf", check_existing=True)
def emit(name, color):
    m = bpy.data.materials.new(name); m.use_nodes = True; nt = m.node_tree; nt.nodes.clear()
    e = nt.nodes.new("ShaderNodeEmission"); e.inputs[0].default_value = (*color, 1)
    o = nt.nodes.new("ShaderNodeOutputMaterial"); nt.links.new(e.outputs[0], o.inputs[0]); return m
def text(body, mat):
    c = bpy.data.curves.new(body, "FONT"); c.body = body; c.font = font; c.space_character = 1.06
    o = bpy.data.objects.new(body, c); sc.collection.objects.link(o); c.materials.append(mat); return o
a = text("HOLD", emit("TWhite", (0.94, 0.93, 0.9))); b = text("LINE", emit("TAmber", (0.92, 0.37, 0.02)))
cd = bpy.data.cameras.new("TCam"); cd.type = "ORTHO"; cam = bpy.data.objects.new("TCam", cd); sc.collection.objects.link(cam); sc.camera = cam
cam.location = (0, 0, 10)
sc.render.engine = "CYCLES"; sc.cycles.samples = 16; sc.render.film_transparent = True
sc.view_settings.view_transform = "Standard"; sc.render.image_settings.file_format = "PNG"; sc.render.image_settings.color_mode = "RGBA"
bpy.context.window.scene = sc; bpy.context.view_layer.update()
wa, wb, h = a.dimensions.x, b.dimensions.x, a.dimensions.y
gap = 0.035
# name: (W, H, text width as a share of W, centre x, centre y from the top)
LAY = {"landscape": (1920, 1080, 0.44, 0.735, 0.52), "portrait": (800, 1200, 0.84, 0.5, 0.855), "square": (800, 800, 0.84, 0.5, 0.84)}
k = 1.0 if MODE == "final" else 0.4
for name, (W, H, share, cx, cy) in LAY.items():
    sc.render.resolution_x = int(W * k); sc.render.resolution_y = int(H * k); sc.render.resolution_percentage = 100
    cd.ortho_scale = max(W, H)
    s = W * share / (wa + gap + wb)
    x0 = (cx - 0.5) * W - (wa + gap + wb) * s / 2; y0 = (0.5 - cy) * H - h * s / 2
    a.scale = b.scale = (s, s, s); a.location = (x0, y0, 0); b.location = (x0 + (wa + gap) * s, y0, 0)
    sc.render.filepath = f"{OUT}/{name}-text-{MODE}.png"; bpy.ops.render.render(write_still=True)
bpy.context.window.scene = bpy.data.scenes["Cover"]
print("text done", wa, wb, h)
