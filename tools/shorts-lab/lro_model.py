# NASA's Lunar Reconnaissance Orbiter model (github.com/nasa/NASA-3D-Resources, "Lunar Reconnaissance Orbiter (A)"),
# dressed for a close view. The shapes are NASA's. The model ships with flat colours only, so the surface finishes
# (crinkled blanket foil, solar cells, paint, bare metal) are ours, following the colour each part has in the model.
import math, bpy, numpy as np
from mathutils import Vector, Matrix
SCALE = 4.3 / 32.26                                         # the model's solar array is 32.26 units long; the real one is 4.3 m

def _nodes(name):
    m = bpy.data.materials.new(name); m.use_nodes = True; nt = m.node_tree; nt.nodes.clear(); N, L = nt.nodes.new, nt.links.new
    out = N("ShaderNodeOutputMaterial"); b = N("ShaderNodeBsdfPrincipled"); L(b.outputs["BSDF"], out.inputs["Surface"]); tc = N("ShaderNodeTexCoord"); return m, nt, N, L, b, tc
def foil(name, color, rough=0.26, crinkle=1.0, scale=6.5):
    """thermal blanket: a thin metal-coated film, fitted by hand, so it lies in soft pillows with creases between them and reflects in patches"""
    m, nt, N, L, b, tc = _nodes(name); b.inputs["Metallic"].default_value = 1.0
    def vor(sc_, smooth):
        v = N("ShaderNodeTexVoronoi"); v.feature = "SMOOTH_F1"; v.inputs["Scale"].default_value = sc_; v.inputs["Smoothness"].default_value = smooth; L(tc.outputs["Object"], v.inputs["Vector"]); return v.outputs["Distance"]
    def noise(sc_, detail):
        n = N("ShaderNodeTexNoise"); n.inputs["Scale"].default_value = sc_; n.inputs["Detail"].default_value = detail; L(tc.outputs["Object"], n.inputs["Vector"]); return n.outputs["Fac"]
    def math_(op, a, c):
        n = N("ShaderNodeMath"); n.operation = op
        for i, v in enumerate((a, c)):
            if isinstance(v, (int, float)): n.inputs[i].default_value = v
            else: L(v, n.inputs[i])
        return n.outputs[0]
    big = noise(scale * 0.33, 2); h = math_("ADD", math_("ADD", math_("MULTIPLY", vor(scale, 0.35), 0.55), math_("MULTIPLY", vor(scale * 2.7, 0.5), 0.16)), math_("MULTIPLY", big, 0.9))
    bp = N("ShaderNodeBump"); bp.inputs["Strength"].default_value = 0.42 * crinkle; bp.inputs["Distance"].default_value = 0.03; L(h, bp.inputs["Height"]); L(bp.outputs["Normal"], b.inputs["Normal"])
    rr = N("ShaderNodeMapRange"); rr.inputs["To Min"].default_value = rough * 0.75; rr.inputs["To Max"].default_value = rough * 1.3; L(noise(scale * 2.0, 4), rr.inputs["Value"]); L(rr.outputs["Result"], b.inputs["Roughness"])
    tint = N("ShaderNodeMapRange"); tint.inputs["To Min"].default_value = 0.88; tint.inputs["To Max"].default_value = 1.05; L(big, tint.inputs["Value"])
    mix = N("ShaderNodeMixRGB"); mix.blend_type = "MULTIPLY"; mix.inputs["Fac"].default_value = 1.0; mix.inputs["Color1"].default_value = (*color, 1); L(tint.outputs["Result"], mix.inputs["Color2"]); L(mix.outputs["Color"], b.inputs["Base Color"]); return m
def metal(name, color, rough, metallic=1.0, grain=0.25):
    m, nt, N, L, b, tc = _nodes(name); b.inputs["Metallic"].default_value = metallic; b.inputs["Base Color"].default_value = (*color, 1)
    n = N("ShaderNodeTexNoise"); n.inputs["Scale"].default_value = 300.0; n.inputs["Detail"].default_value = 5; L(tc.outputs["Object"], n.inputs["Vector"])
    r = N("ShaderNodeMapRange"); r.inputs["To Min"].default_value = rough * (1 - grain); r.inputs["To Max"].default_value = rough * (1 + grain); L(n.outputs["Fac"], r.inputs["Value"]); L(r.outputs["Result"], b.inputs["Roughness"]); return m
def paint(name, color, rough=0.55):
    m, nt, N, L, b, tc = _nodes(name); b.inputs["Base Color"].default_value = (*color, 1); b.inputs["Roughness"].default_value = rough
    n = N("ShaderNodeTexNoise"); n.inputs["Scale"].default_value = 180.0; n.inputs["Detail"].default_value = 6; L(tc.outputs["Object"], n.inputs["Vector"]); bp = N("ShaderNodeBump"); bp.inputs["Strength"].default_value = 0.08; bp.inputs["Distance"].default_value = 0.001; L(n.outputs["Fac"], bp.inputs["Height"]); L(bp.outputs["Normal"], b.inputs["Normal"]); return m
def cells(name, color):
    """solar cells: dark blue glass over a grid of cells with thin metal lines between them"""
    m, nt, N, L, b, tc = _nodes(name); b.inputs["Roughness"].default_value = 0.12; b.inputs["Metallic"].default_value = 0.35
    for k in ("Coat Weight", "Clearcoat"):
        if k in b.inputs: b.inputs[k].default_value = 1.0; break
    br = N("ShaderNodeTexBrick"); br.offset = 0.0; br.inputs["Scale"].default_value = 1.0; br.inputs["Brick Width"].default_value = 0.080; br.inputs["Row Height"].default_value = 0.040; br.inputs["Mortar Size"].default_value = 0.0007
    br.inputs["Mortar Smooth"].default_value = 0.0; br.inputs["Color1"].default_value = (*color, 1); br.inputs["Color2"].default_value = (color[0] * 0.85, color[1] * 0.9, color[2] * 1.06, 1); br.inputs["Mortar"].default_value = (0.16, 0.16, 0.18, 1)
    L(tc.outputs["Object"], br.inputs["Vector"]); L(br.outputs["Color"], b.inputs["Base Color"])
    fl = N("ShaderNodeTexBrick"); fl.offset = 0.0; fl.inputs["Scale"].default_value = 1.0; fl.inputs["Brick Width"].default_value = 0.080; fl.inputs["Row Height"].default_value = 0.0020; fl.inputs["Mortar Size"].default_value = 0.00025   # the fine collector lines on each cell
    L(tc.outputs["Object"], fl.inputs["Vector"]); bp = N("ShaderNodeBump"); bp.inputs["Strength"].default_value = 0.25; bp.inputs["Distance"].default_value = 0.002; L(fl.outputs["Fac"], bp.inputs["Height"]); L(bp.outputs["Normal"], b.inputs["Normal"]); return m

def finish_for(name):
    n = name.lower()
    if "solarpanel-" in n and n.split("solarpanel-")[1][:1].isdigit(): return ("cells", (0.012, 0.022, 0.085))
    if "solarpanel-bak" in n: return ("paint", (0.05, 0.05, 0.06))
    if "black" in n: return ("paint_black", (0.012, 0.012, 0.013))
    if "mainbox" in n or "gold" in n: return ("foil_gold", (1.0, 0.72, 0.30))
    if "bronze" in n or "thermal" in n: return ("foil_bronze", (0.90, 0.66, 0.38))
    if "silver" in n: return ("foil_silver", (0.93, 0.93, 0.94))
    if "dish" in n: return ("paint_white", (0.86, 0.86, 0.84))
    if "radiator" in n: return ("paint_white", (0.86, 0.86, 0.84))
    if "grey" in n: return ("metal_grey", (0.55, 0.55, 0.57))
    if n == "default": return ("foil_silver", (0.93, 0.93, 0.94))          # the body panels the model leaves plain are blanketed on the real spacecraft
    return ("paint_white", (0.80, 0.80, 0.78))
ARRAY_AT = (-1.26, 0.0, -0.95); BOOM_AT = (-0.27, -0.87, -0.95)       # where the solar array's gimbal and the antenna boom meet the body, read off NASA's assembled model (B)
def load(path):
    """returns (root, parts). Body axes as in the model: +X is the instrument side (toward the Moon in flight), +Z the long axis of the body.
    The model ships with its solar array, antenna boom, gimbal and dish as loose layers; they are put where NASA's assembled model (B) has them."""
    sc = bpy.context.scene; before = set(sc.objects); bpy.ops.import_scene.gltf(filepath=path); new = [o for o in sc.objects if o not in before]; meshes = sorted([o for o in new if o.type == "MESH"], key=lambda o: o.name)
    lib = {"cells": cells("lro_cells", (0.006, 0.010, 0.040)), "paint": paint("lro_dark", (0.05, 0.05, 0.06)), "paint_black": paint("lro_black", (0.012, 0.012, 0.013), 0.7), "foil_gold": foil("lro_gold", (1.0, 0.72, 0.30)),
           "foil_bronze": foil("lro_bronze", (0.90, 0.66, 0.38), 0.32, 0.8), "foil_silver": foil("lro_silver", (0.93, 0.93, 0.94), 0.24, 0.9), "paint_white": paint("lro_white", (0.86, 0.86, 0.84)), "metal_grey": metal("lro_grey", (0.55, 0.55, 0.57), 0.38)}
    root = bpy.data.objects.new("lro", None); sc.collection.objects.link(root); parts = dict(zip(("bus", "boom", "gimbal", "dish", "array"), meshes))
    for o in meshes:
        for i, m in enumerate(o.data.materials):
            if m: o.data.materials[i] = lib[finish_for(m.name)[0]]
        M = o.matrix_world.copy(); o.parent = None; o.data.transform(Matrix.Scale(SCALE, 4) @ M); o.matrix_world = Matrix.Identity(4); o.parent = root; o.rotation_mode = "QUATERNION"
    for o in new:
        if o.type != "MESH": bpy.data.objects.remove(o)
    am = parts["array"].data                                                # the array is three flat panels: shade it flat so the glass reflects evenly
    if "custom_normal" in am.attributes: am.attributes.remove(am.attributes["custom_normal"])
    am.shade_flat(); am.update()
    side = Matrix.Rotation(math.radians(90), 4, "X").to_quaternion()      # the boom layer is modelled standing up; on the spacecraft it points out of the -Y side
    parts["boom"].location = BOOM_AT; parts["boom"].rotation_quaternion = side
    parts["gimbal"].location = (BOOM_AT[0], BOOM_AT[1] - 1.96, BOOM_AT[2]); parts["gimbal"].rotation_quaternion = side
    parts["dish"].location = (BOOM_AT[0], BOOM_AT[1] - 1.96 - 0.32, BOOM_AT[2]); parts["dish"].rotation_quaternion = side; parts["array"].location = ARRAY_AT
    return root, parts
def point(parts, sun_body, earth_body):
    """turn the solar array about its own axis to face the Sun, and the dish to face Earth; both directions are given in body axes"""
    s = Vector(sun_body); parts["array"].rotation_quaternion = Matrix.Rotation(math.atan2(-s.y, s.z), 4, "X").to_quaternion()
    parts["dish"].rotation_quaternion = Vector((0, 0, 1)).rotation_difference(Vector(earth_body).normalized())
