# Moon south pole shot, version 2. Terrain: NASA LOLA LDEM_80S_40M and _80M. Earth: DSCOVR EPIC image. All public domain.
import os, sys, math, time, numpy as np, bpy
from mathutils import Vector
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__))); import cam2
DATA, OUT = sys.argv[1], sys.argv[2]; ARGS = sys.argv[3:]
E = lambda k, d: float(os.environ.get(k, d))
R = cam2.R; t0 = time.time()
def log(*a): print(f"[{time.time()-t0:6.1f}s]", *a, flush=True)
bpy.ops.wm.read_factory_settings(use_empty=True); scene = bpy.context.scene

class Dem:
    def __init__(s, path, n, sc): s.a = np.memmap(path, dtype="<i2", mode="r", shape=(n, n)); s.n = n; s.s = sc; s.c = (n - 1) / 2
    def cut(s, x0, x1, y0, y1):
        c0, c1 = max(int(round(x0 / s.s + s.c)), 0), min(int(round(x1 / s.s + s.c)), s.n)
        r0, r1 = max(int(round(y0 / s.s + s.c)), 0), min(int(round(y1 / s.s + s.c)), s.n)
        h = np.asarray(s.a[s.n - r1:s.n - r0, c0:c1])[::-1].astype(np.float32) * 0.0005
        return h, c0, r0
def block(a, k):
    if k == 1: return a
    h, w = (a.shape[0] // k) * k, (a.shape[1] // k) * k
    return a[:h, :w].reshape(h // k, k, w // k, k).mean((1, 3))
def smooth(x, a, b): t = np.clip((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t)
def patch(dem, x0, x1, y0, y1, k=1, trench=None):
    h, c0, r0 = dem.cut(x0, x1, y0, y1); h = block(h, k); st = dem.s * k
    xs = (c0 + (np.arange(h.shape[1]) + 0.5) * k - 0.5 - dem.c) * dem.s; ys = (r0 + (np.arange(h.shape[0]) + 0.5) * k - 0.5 - dem.c) * dem.s
    gy, gx = np.gradient(h, st); slope = np.degrees(np.arctan(np.hypot(gx, gy)))
    alb = (1 + 0.60 * smooth(slope, 14, 31)).astype(np.float32)          # steep, fresh slopes are brighter on the Moon
    X, Y = np.meshgrid(xs, ys)
    if trench:
        tx, ty0, ty1 = trench; h = np.where((np.abs(X) < tx) & (Y > ty0) & (Y < ty1), h - 3.0, h)
    rst = np.sqrt(X * X + Y * Y) + 1e-9; c = 2 * np.arctan(rst / (2 * R)); r = R + h
    P = np.stack([r * np.sin(c) * X / rst, r * np.sin(c) * Y / rst, r * np.cos(c) - R], -1).astype(np.float32)
    return P, alb
def add_grid(name, PA, mat):
    P, alb = PA; ny, nx, _ = P.shape
    me = bpy.data.meshes.new(name); me.vertices.add(ny * nx); me.vertices.foreach_set("co", P.reshape(-1))
    idx = np.arange(ny * nx, dtype=np.int32).reshape(ny, nx)
    q = np.stack([idx[:-1, :-1], idx[:-1, 1:], idx[1:, 1:], idx[1:, :-1]], -1).reshape(-1); nq = (ny - 1) * (nx - 1)
    me.loops.add(nq * 4); me.loops.foreach_set("vertex_index", q)
    me.polygons.add(nq); me.polygons.foreach_set("loop_start", np.arange(0, nq * 4, 4, dtype=np.int32))
    me.update(calc_edges=True); me.shade_smooth()
    me.attributes.new("alb", "FLOAT", "POINT").data.foreach_set("value", alb.reshape(-1))
    ob = bpy.data.objects.new(name, me); scene.collection.objects.link(ob); me.materials.append(mat); log(name, P.shape)

def moon_material():
    m = bpy.data.materials.new("regolith"); m.use_nodes = True; nt = m.node_tree; nt.nodes.clear(); N = nt.nodes.new; L = nt.links.new
    def mth(op, a, b=None, clamp=False):
        n = N("ShaderNodeMath"); n.operation = op; n.use_clamp = clamp
        for i, v in enumerate((a, b)):
            if v is None: continue
            if isinstance(v, (int, float)): n.inputs[i].default_value = v
            else: L(v, n.inputs[i])
        return n.outputs[0]
    out = N("ShaderNodeOutputMaterial"); d = N("ShaderNodeBsdfDiffuse"); d.inputs["Roughness"].default_value = 1.0
    tc = N("ShaderNodeTexCoord"); co = tc.outputs["Object"]
    def noise(scale, detail, rough=0.55):
        n = N("ShaderNodeTexNoise"); n.inputs["Scale"].default_value = scale; n.inputs["Detail"].default_value = detail; n.inputs["Roughness"].default_value = rough
        L(co, n.inputs["Vector"]); return n.outputs["Fac"]
    att = N("ShaderNodeAttribute"); att.attribute_name = "alb"
    lo = mth("ADD", mth("MULTIPLY", noise(0.035, 5), 0.42), 0.79)          # broad tone patches, 0.79-1.21
    mid = mth("ADD", mth("MULTIPLY", noise(1.3, 6), 0.28), 0.86)           # ~1 km mottling
    fine = mth("ADD", mth("MULTIPLY", noise(22.0, 4, 0.7), 0.16), 0.92)    # grain of the soil
    k = mth("MULTIPLY", mth("MULTIPLY", mth("MULTIPLY", att.outputs["Fac"], lo), mid), fine)
    col = N("ShaderNodeMixRGB"); col.blend_type = "MULTIPLY"; col.inputs["Fac"].default_value = 1; col.inputs["Color1"].default_value = (0.158, 0.147, 0.133, 1)
    cmb = N("ShaderNodeCombineColor"); L(k, cmb.inputs[0]); L(k, cmb.inputs[1]); L(k, cmb.inputs[2]); L(cmb.outputs[0], col.inputs["Color2"]); L(col.outputs["Color"], d.inputs["Color"])
    def craters(scale):       # one random bowl-and-rim crater per Voronoi cell, below the resolution of the elevation data
        v = N("ShaderNodeTexVoronoi"); v.inputs["Scale"].default_value = scale; L(co, v.inputs["Vector"])
        sp = N("ShaderNodeSeparateColor"); L(v.outputs["Color"], sp.inputs[0])
        rc = mth("ADD", mth("MULTIPLY", sp.outputs[0], 0.26), 0.16); t = mth("DIVIDE", v.outputs["Distance"], rc)
        bowl = mth("MINIMUM", mth("SUBTRACT", mth("MULTIPLY", t, t), 1.0), 0.0)
        tt = mth("DIVIDE", mth("SUBTRACT", t, 1.0), 0.28); rim = mth("EXPONENT", mth("MULTIPLY", mth("MULTIPLY", tt, tt), -1.0))
        prof = mth("ADD", mth("MULTIPLY", bowl, 0.20), mth("MULTIPLY", rim, 0.045))
        return mth("MULTIPLY", mth("MULTIPLY", prof, mth("MULTIPLY", rc, 2.0 / scale)), mth("GREATER_THAN", sp.outputs[1], 0.42))
    hgt = mth("ADD", mth("ADD", craters(4.5), craters(11.0)), mth("ADD", craters(27.0), mth("MULTIPLY", noise(9.0, 9, 0.62), 0.012)))
    bump = N("ShaderNodeBump"); bump.inputs["Strength"].default_value = E("BUMP", 0.8); bump.inputs["Distance"].default_value = 1.0
    L(hgt, bump.inputs["Height"]); L(bump.outputs["Normal"], d.inputs["Normal"]); L(d.outputs["BSDF"], out.inputs["Surface"]); return m

def earth_material(img_path, re, gain):
    m = bpy.data.materials.new("earth"); m.use_nodes = True; nt = m.node_tree; nt.nodes.clear(); N = nt.nodes.new; L = nt.links.new
    out = N("ShaderNodeOutputMaterial"); d = N("ShaderNodeBsdfDiffuse"); tc = N("ShaderNodeTexCoord"); mp = N("ShaderNodeMapping")
    mp.inputs["Rotation"].default_value = (math.radians(90), 0, 0); mp.inputs["Scale"].default_value = (-0.5 / re, 1, 0.5 / re); mp.inputs["Location"].default_value = (0.5, 0.5, 0)
    tex = N("ShaderNodeTexImage"); tex.image = bpy.data.images.load(img_path); tex.extension = "CLIP"; tex.interpolation = "Cubic"
    g = N("ShaderNodeMixRGB"); g.blend_type = "MULTIPLY"; g.inputs["Fac"].default_value = 1; g.inputs["Color2"].default_value = (gain, gain, gain, 1)
    L(tc.outputs["Object"], mp.inputs["Vector"]); L(mp.outputs["Vector"], tex.inputs["Vector"]); L(tex.outputs["Color"], g.inputs["Color1"]); L(g.outputs["Color"], d.inputs["Color"]); L(d.outputs["BSDF"], out.inputs["Surface"]); return m
def air_material(sun_dir):     # thin blue line of atmosphere on the sunlit limb
    m = bpy.data.materials.new("air"); m.use_nodes = True; nt = m.node_tree; nt.nodes.clear(); N = nt.nodes.new; L = nt.links.new
    out = N("ShaderNodeOutputMaterial"); tr = N("ShaderNodeBsdfTransparent"); em = N("ShaderNodeEmission"); add = N("ShaderNodeAddShader")
    lw = N("ShaderNodeLayerWeight"); lw.inputs["Blend"].default_value = 0.5; geo = N("ShaderNodeNewGeometry")
    dot = N("ShaderNodeVectorMath"); dot.operation = "DOT_PRODUCT"; dot.inputs[1].default_value = sun_dir; L(geo.outputs["Normal"], dot.inputs[0])
    lit = N("ShaderNodeMapRange"); lit.inputs["From Min"].default_value = 0.0; lit.inputs["From Max"].default_value = 0.30; L(dot.outputs["Value"], lit.inputs["Value"])
    p = N("ShaderNodeMath"); p.operation = "POWER"; p.inputs[1].default_value = 7.0; L(lw.outputs["Facing"], p.inputs[0])
    mu = N("ShaderNodeMath"); mu.operation = "MULTIPLY"; L(p.outputs[0], mu.inputs[0]); L(lit.outputs["Result"], mu.inputs[1])
    mu2 = N("ShaderNodeMath"); mu2.operation = "MULTIPLY"; mu2.inputs[1].default_value = E("AIR", 3.0); L(mu.outputs[0], mu2.inputs[0])
    em.inputs["Color"].default_value = (0.25, 0.52, 1.0, 1); L(mu2.outputs[0], em.inputs["Strength"])
    L(tr.outputs[0], add.inputs[0]); L(em.outputs[0], add.inputs[1]); L(add.outputs[0], out.inputs["Surface"]); return m

mm = moon_material()
d80 = Dem(f"{DATA}/ldem_80s_80m.img", 7600, 0.08); d40 = Dem(f"{DATA}/ldem_80s_40m.img", 15200, 0.04)
add_grid("core40", patch(d40, -24, 24, -200, -90), mm)
add_grid("near80", patch(d80, -60, 60, -230, -48, 1, trench=(22.5, -198.5, -91.5)), mm)
add_grid("far80", patch(d80, -46, 46, -52, 230), mm)
add_grid("wide480", patch(d80, -304, 304, -304, 304, 6, trench=(43, -227, 227)), mm)

PHI, BETA = E("PHI", 125), -1.5
p, b = math.radians(PHI), math.radians(BETA); s = Vector((math.cos(b) * math.sin(p), math.cos(b) * math.cos(p), -math.sin(b)))
RE, DE = 6371.0, 384400.0
bpy.ops.mesh.primitive_uv_sphere_add(segments=192, ring_count=96, radius=RE, location=(0, DE, -R)); earth = bpy.context.object; bpy.ops.object.shade_smooth()
earth.data.materials.append(earth_material(f"{DATA}/earth/earth_disk.png", RE, E("EGAIN", 0.42)))
bpy.ops.mesh.primitive_uv_sphere_add(segments=192, ring_count=96, radius=RE * 1.016, location=(0, DE, -R)); air = bpy.context.object; bpy.ops.object.shade_smooth()
air.data.materials.append(air_material(tuple(s))); air.visible_shadow = False

w = bpy.data.worlds.new("fill"); scene.world = w; w.use_nodes = True
bg = w.node_tree.nodes["Background"]; bg.inputs["Color"].default_value = (0.50, 0.66, 1.0, 1); bg.inputs["Strength"].default_value = E("AMB", 0.07)   # faint cool fill so shadows keep their shape
sd = bpy.data.lights.new("sun", "SUN"); sd.energy = 8.0; sd.angle = math.radians(0.53); sun = bpy.data.objects.new("sun", sd); scene.collection.objects.link(sun)
sun.rotation_mode = "QUATERNION"; sun.rotation_quaternion = s.to_track_quat("Z", "Y")

cd = bpy.data.cameras.new("cam"); cd.sensor_fit = "VERTICAL"; cd.sensor_height = 36; cd.lens = 18 / math.tan(math.radians(cam2.FOV / 2)); cd.clip_start = 1; cd.clip_end = 2e6
cam = bpy.data.objects.new("cam", cd); scene.collection.objects.link(cam); scene.camera = cam
def set_cam(t):
    pos, d, up, right = cam2.cam_basis(t); cam.location = Vector(pos); cam.rotation_mode = "QUATERNION"; cam.rotation_quaternion = Vector(d).to_track_quat("-Z", "Y")

scene.render.engine = "CYCLES"; cy = scene.cycles; cy.device = "CPU"; cy.use_adaptive_sampling = True; cy.adaptive_threshold = 0.02; cy.use_denoising = True
cy.max_bounces = 4; cy.diffuse_bounces = 4; cy.transparent_max_bounces = 4; cy.samples = int(E("SPP", 64))
scene.render.use_persistent_data = True; scene.render.film_transparent = True
scene.render.image_settings.file_format = "PNG"; scene.render.image_settings.color_mode = "RGBA"; scene.render.image_settings.color_depth = "16"
scene.view_settings.view_transform = "AgX"
for look in ("AgX - Medium High Contrast", "Medium High Contrast"):
    try: scene.view_settings.look = look; break
    except Exception: pass
scene.view_settings.exposure = E("EXPO", 0.8)
sc = E("SCALE", 1.0); scene.render.resolution_x, scene.render.resolution_y = int(cam2.W * sc), int(cam2.H * sc)
a, b_, nf = int(ARGS[0]), int(ARGS[1]), int(ARGS[2]); log("scene built")
for i in range(a, b_ + 1):
    set_cam(i / (nf - 1)); scene.render.filepath = f"{OUT}/f_{i:04d}.png"; bpy.ops.render.render(write_still=True); log("frame", i)
