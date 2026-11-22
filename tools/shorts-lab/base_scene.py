# Moon base test shot: NASA prototype hardware standing on the Connecting Ridge near the lunar south pole, as a real camera would record it.
# usage: python base_scene.py DATA OUT [first last count]      env: Q (ground detail 0.25..1), SPP, SCALE, EXPO, STAGE
import os, sys, math, time, numpy as np, bpy
from mathutils import Vector, Matrix
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import lunar_site as LS, terrain as TR
DATA, OUT = sys.argv[1], sys.argv[2]; ARGS = sys.argv[3:]; E = lambda k, d: float(os.environ.get(k, d)); t0 = time.time()
def log(*a): print(f"[{time.time()-t0:6.1f}s]", *a, flush=True)
CX, CY, UTC = -11.82, -12.54, (2026, 9, 6, 0, 0)          # map km on the Connecting Ridge; a real date and time
Q = E("Q", 1.0); STAGE = int(E("STAGE", 9))
bpy.ops.wm.read_factory_settings(use_empty=True); scene = bpy.context.scene
def dem(window, full, n, step): p = f"{DATA}/{window}"; return LS.Dem(p if os.path.exists(p) else f"{DATA}/{full}", n, step)      # prep_site_data.py stores small windows of the big grids
d5 = dem("dem5.npz", "ldem_875s_5m.img", 30336, 0.005); d40 = dem("dem40.npz", "ldem_80s_40m.img", 15200, 0.04); d80 = dem("dem80.npz", "ldem_80s_80m.img", 7600, 0.08)
h0 = float(TR.ndimage.gaussian_filter(d5.cut(CX - 0.1, CX + 0.1, CY - 0.1, CY + 0.1)[0], 3.0)[20, 20])
site = LS.Site(CX, CY, h0); sky = site.sky(f"{DATA}/spice", UTC); G = TR.Ground(site, d5)
log("site lat %.4f lon %.3f  sun alt %.2f  earth alt %.2f" % (site.lat, site.lon, sky["sun"]["alt"], sky["earth"]["alt"]))

# ---------- materials
def regolith():
    m = bpy.data.materials.new("regolith"); m.use_nodes = True; nt = m.node_tree; nt.nodes.clear(); N = nt.nodes.new; L = nt.links.new
    out = N("ShaderNodeOutputMaterial"); d = N("ShaderNodeBsdfDiffuse"); d.inputs["Roughness"].default_value = 1.0; geo = N("ShaderNodeNewGeometry")
    def noise(scale, detail, rough=0.6):
        n = N("ShaderNodeTexNoise"); n.inputs["Scale"].default_value = scale; n.inputs["Detail"].default_value = detail; n.inputs["Roughness"].default_value = rough; L(geo.outputs["Position"], n.inputs["Vector"]); return n
    a, b, c = noise(0.035, 6), noise(0.9, 8), noise(40.0, 6, 0.7)
    def mix(x, lo, hi):
        r = N("ShaderNodeMapRange"); r.inputs["To Min"].default_value = lo; r.inputs["To Max"].default_value = hi; L(x.outputs["Fac"], r.inputs["Value"]); return r.outputs["Result"]
    def mul(p, q):
        r = N("ShaderNodeMath"); r.operation = "MULTIPLY"; L(p, r.inputs[0]); L(q, r.inputs[1]); return r.outputs[0]
    v = mul(mul(mix(a, 0.80, 1.20), mix(b, 0.88, 1.12)), mix(c, 0.90, 1.10))
    col = N("ShaderNodeMixRGB"); col.blend_type = "MULTIPLY"; col.inputs["Fac"].default_value = 1; col.inputs["Color1"].default_value = (0.150, 0.140, 0.128, 1); L(v, col.inputs["Color2"])
    L(col.outputs["Color"], d.inputs["Color"])
    bn = N("ShaderNodeTexNoise"); bn.inputs["Scale"].default_value = 260.0; bn.inputs["Detail"].default_value = 5; L(geo.outputs["Position"], bn.inputs["Vector"])
    bp = N("ShaderNodeBump"); bp.inputs["Strength"].default_value = 0.55; bp.inputs["Distance"].default_value = 0.004; L(bn.outputs["Fac"], bp.inputs["Height"]); L(bp.outputs["Normal"], d.inputs["Normal"])
    L(d.outputs["BSDF"], out.inputs["Surface"]); return m
REG = regolith()
if STAGE >= 3: exec(open(f"{HERE}/base_props.py").read())
def add_grid(name, P, mat, hole=None, XY=None):
    """P: (ny, nx, 3) local metres. hole: (u0, u1, v0, v1) footprint of a finer grid whose faces are dropped here (XY gives the plan coordinates to test)."""
    ny, nx, _ = P.shape; me = bpy.data.meshes.new(name); me.vertices.add(ny * nx); me.vertices.foreach_set("co", np.ascontiguousarray(P, np.float32).reshape(-1))
    idx = np.arange(ny * nx, dtype=np.int32).reshape(ny, nx); q = np.stack([idx[:-1, :-1], idx[:-1, 1:], idx[1:, 1:], idx[1:, :-1]], -1).reshape(-1, 4)
    if hole is not None:
        X, Y = XY; xc = (X[:-1, :-1] + X[1:, 1:]) / 2; yc = (Y[:-1, :-1] + Y[1:, 1:]) / 2
        q = q[~((xc > hole[0]) & (xc < hole[1]) & (yc > hole[2]) & (yc < hole[3])).reshape(-1)]
    nq = len(q); me.loops.add(nq * 4); me.loops.foreach_set("vertex_index", q.reshape(-1)); me.polygons.add(nq); me.polygons.foreach_set("loop_start", np.arange(0, nq * 4, 4, dtype=np.int32))
    me.update(calc_edges=True); me.shade_smooth(); me.materials.append(mat); ob = bpy.data.objects.new(name, me); scene.collection.objects.link(ob); log(name, P.shape[:2], "faces", nq); return ob

# ---------- ground: three modelled levels near the camera, three real levels beyond
LEV = [("g0", -6.0, 10.0, -1.5, 14.5, 0.01 / Q), ("g1", -40.0, 40.0, -10.0, 70.0, 0.05 / Q), ("g2", -240.0, 240.0, -60.0, 420.0, 0.30 / Q)]
if STAGE < 2: LEV = LEV[1:]
HG = {}
for i, (name, u0, u1, v0, v1, res) in enumerate(LEV):
    U, V, H, nc = G.grid(u0, u1, v0, v1, res); HG[name] = (u0, v0, res, H); P = G.to_local(U, V, H); log(name, "craters", nc)
    hole = None
    if i > 0: pn, a0, a1, b0, b1, pr = LEV[i - 1]; hole = (a0 + res, a1 - res, b0 + res, b1 - res)
    add_grid(name, P, REG, hole, (U, V)); del U, V, P
gl = LEV[-1]
X, Y, P = TR.far_grid(site, d5, CX - 3.0, CX + 3.0, CY - 1.5, CY + 4.5, 1, 2.0); m = 0.006
add_grid("r5", P, REG, (CX + gl[1] / 1000 + m, CX + gl[2] / 1000 - m, CY + gl[3] / 1000 + m, CY + gl[4] / 1000 - m), (X, Y))
X, Y, P = TR.far_grid(site, d40, CX - 32, CX + 32, CY - 32, CY + 32, 1, 0.8); add_grid("r40", P, REG, (CX - 3.0 + 0.05, CX + 3.0 - 0.05, CY - 1.5 + 0.05, CY + 4.5 - 0.05), (X, Y))
X, Y, P = TR.far_grid(site, d80, -300, 300, -300, 300, 6); add_grid("r480", P, REG, (CX - 32 + 0.5, CX + 32 - 0.5, CY - 32 + 0.5, CY + 32 - 0.5), (X, Y)); del X, Y, P
def ground_z(u, v):
    for name in ("g0", "g1", "g2"):
        if name not in HG: continue
        u0, v0, res, H = HG[name]; fi, fj = (u - u0) / res, (v - v0) / res
        if 1 <= fi < H.shape[1] - 2 and 1 <= fj < H.shape[0] - 2:
            i, j = int(fi), int(fj); a, b = fi - i, fj - j; h = (H[j, i] * (1 - a) + H[j, i + 1] * a) * (1 - b) + (H[j + 1, i] * (1 - a) + H[j + 1, i + 1] * a) * b
            return G.to_local(np.array([[u]]), np.array([[v]]), np.array([[h]]))[0, 0]
    raise ValueError("outside the detailed ground")

# ---------- sky: the Sun and Earth where they really were
sd = Vector(sky["sun"]["dir"]); sl = bpy.data.lights.new("sun", "SUN"); sl.energy = E("SUN", 10.0); sl.angle = 2 * math.asin(695700.0 / sky["sun"]["dist"])
sun = bpy.data.objects.new("sun", sl); scene.collection.objects.link(sun); sun.rotation_mode = "QUATERNION"; sun.rotation_quaternion = sd.to_track_quat("Z", "Y")
def earth():
    ED = 2.0e6; re = 6371.0 / sky["earth"]["dist"] * ED; nlat, nlon = 181, 361; la = np.radians(np.linspace(-90, 90, nlat)); lo = np.radians(np.linspace(-180, 180, nlon)); LO, LA = np.meshgrid(lo, la)
    Pe = np.stack([np.cos(LA) * np.cos(LO), np.cos(LA) * np.sin(LO), np.sin(LA)], -1) @ sky["earth_rot"].T * re + np.array(sky["earth"]["dir"]) * ED
    me = bpy.data.meshes.new("earth"); me.vertices.add(nlat * nlon); me.vertices.foreach_set("co", Pe.astype(np.float32).reshape(-1))
    idx = np.arange(nlat * nlon, dtype=np.int32).reshape(nlat, nlon); q = np.stack([idx[:-1, :-1], idx[:-1, 1:], idx[1:, 1:], idx[1:, :-1]], -1).reshape(-1); nq = (nlat - 1) * (nlon - 1)
    me.loops.add(nq * 4); me.loops.foreach_set("vertex_index", q); me.polygons.add(nq); me.polygons.foreach_set("loop_start", np.arange(0, nq * 4, 4, dtype=np.int32)); me.update(calc_edges=True); me.shade_smooth()
    uv = np.stack([(LO / (2 * np.pi) + 0.5), (LA / np.pi + 0.5)], -1).reshape(-1, 2)[q]; me.uv_layers.new(name="uv").data.foreach_set("uv", uv.astype(np.float32).reshape(-1))
    m = bpy.data.materials.new("earth"); m.use_nodes = True; nt = m.node_tree; nt.nodes.clear(); N = nt.nodes.new; L = nt.links.new
    out = N("ShaderNodeOutputMaterial"); d = N("ShaderNodeBsdfDiffuse"); tex = N("ShaderNodeTexImage"); tex.image = bpy.data.images.load(f"{DATA}/earthglobal/earth_2026-09-06.png"); tex.extension = "EXTEND"
    g = N("ShaderNodeGamma"); g.inputs["Gamma"].default_value = 1.0; L(tex.outputs["Color"], g.inputs["Color"]); L(g.outputs["Color"], d.inputs["Color"]); L(d.outputs["BSDF"], out.inputs["Surface"])
    me.materials.append(m); ob = bpy.data.objects.new("earth", me); scene.collection.objects.link(ob); ob.visible_shadow = False; return ob
earth()
w = bpy.data.worlds.new("space"); scene.world = w; w.use_nodes = True; w.node_tree.nodes["Background"].inputs["Color"].default_value = (0, 0, 0, 1); w.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.0

# ---------- camera
cd = bpy.data.cameras.new("cam"); cd.sensor_fit = "VERTICAL"; cd.sensor_height = 36; cd.lens = E("LENS", 28); cd.clip_start = 0.05; cd.clip_end = 1.0e7
cam = bpy.data.objects.new("cam", cd); scene.collection.objects.link(cam); scene.camera = cam
def wobble(T, seed, amp):
    """slow, small drift of a camera carried by a person (modelled): a few sine waves between 0.3 and 2.2 Hz"""
    r = np.random.default_rng(seed); f = r.uniform(0.3, 2.2, 5); ph = r.uniform(0, 6.28, 5); a = r.uniform(0.4, 1.0, 5) / f ** 0.8; return amp * float((a * np.sin(2 * math.pi * f * T + ph)).sum()) / 2.2
def cam_pose(t):
    T = t * E("DUR", 5.0); k = E("SHAKE", 1.0); u, v = E("CAMU", 0.0) + E("DOLLYX", 1.2) * t, E("CAMV", 0.0) + E("DOLLYY", 0.5) * t; p = ground_z(u, v)
    pos = Vector((p[0] + k * wobble(T, 1, 0.008), p[1] + k * wobble(T, 2, 0.008), ground_z(E("CAMU", 0.0), E("CAMV", 0.0))[2] + E("CAMH", 1.65) + k * wobble(T, 3, 0.012)))
    yaw = math.radians(E("YAW", -5.0) + E("PAN", -1.5) * t + k * wobble(T, 4, 0.22)); pitch = math.radians(E("PITCH", -19.0) + k * wobble(T, 5, 0.22)); d = Vector((math.sin(yaw) * math.cos(pitch), math.cos(yaw) * math.cos(pitch), math.sin(pitch)))
    q = d.to_track_quat("-Z", "Y"); roll = math.radians(k * wobble(T, 6, 0.25)); return pos, q @ Matrix.Rotation(roll, 4, "Z").to_quaternion()
def set_cam(t):
    cam.rotation_mode = "QUATERNION"; cam.location, cam.rotation_quaternion = cam_pose(t)
if STAGE >= 3: build_props()

# ---------- render
scene.render.engine = "CYCLES"; cy = scene.cycles; cy.device = "CPU"; cy.samples = int(E("SPP", 48)); cy.use_adaptive_sampling = True; cy.adaptive_threshold = 0.015; cy.use_denoising = True
cy.max_bounces = 6; cy.diffuse_bounces = 3; cy.glossy_bounces = 3; cy.transmission_bounces = 4; cy.caustics_reflective = False; cy.caustics_refractive = False; scene.render.use_persistent_data = True
sc = E("SCALE", 1.0); scene.render.resolution_x, scene.render.resolution_y = int(1080 * sc), int(1920 * sc); scene.render.resolution_percentage = 100
scene.view_settings.view_transform = "AgX"
for look in ("AgX - Base Contrast", "Base Contrast", "None"):
    try: scene.view_settings.look = look; break
    except Exception: pass
scene.view_settings.exposure = E("EXPO", 0.0)
if E("EXR", 1):                                  # scene-linear frames; the camera response is applied afterwards in comp_real.py
    scene.render.image_settings.file_format = "OPEN_EXR"; scene.render.image_settings.color_depth = "16"; scene.render.image_settings.exr_codec = "ZIP"; EXT = "exr"
else: scene.render.image_settings.file_format = "PNG"; scene.render.image_settings.color_depth = "16"; EXT = "png"
if E("TOP", 0):
    def set_cam(t):
        cd.type = "ORTHO"; cd.ortho_scale = E("TOPW", 120.0); c = ground_z(0, 0); cam.location = Vector((E("TOPU", 0.0), E("TOPV", 30.0), c[2] + 500)); cam.rotation_mode = "QUATERNION"; cam.rotation_quaternion = (1, 0, 0, 0)
    scene.render.resolution_x = scene.render.resolution_y = int(E("TOPPX", 900))
a_, b_, nf = (int(ARGS[0]), int(ARGS[1]), int(ARGS[2])) if ARGS else (0, 0, 1)
log("scene built")
BLUR = E("BLUR", 1) > 0 and not E("TOP", 0)
if BLUR:                                                     # a real shutter stays open for half of each frame, so moving things smear slightly
    scene.render.use_motion_blur = True; scene.render.motion_blur_shutter = 0.5; bpy.context.preferences.edit.keyframe_new_interpolation_type = "LINEAR"
def key(ob, frame):
    ob.rotation_mode = "QUATERNION"; ob.keyframe_insert("location", frame=frame); ob.keyframe_insert("rotation_quaternion", frame=frame)
for i in range(a_, b_ + 1):
    t = i / max(nf - 1, 1)
    if BLUR:
        movers = [cam] + [globals()[k] for k in ("SEV", "SEV2") if k in globals()]
        for o in movers: o.animation_data_clear()
        prev = {}
        for j in (i - 1, i + 1, i):                           # the frame itself last, so the scene is left in its state
            tj = j / max(nf - 1, 1); set_cam(tj)
            if "animate" in globals(): animate(tj, j)
            for o in movers:
                o.rotation_mode = "QUATERNION"                 # the camera was posed through location and rotation; the rovers through their matrix
                q, loc = (o.rotation_quaternion.copy(), o.location.copy()) if o is cam else (o.matrix_world.to_quaternion(), o.matrix_world.to_translation())
                if o in prev and prev[o].dot(q) < 0: q.negate()
                prev[o] = q.copy(); o.location = loc; o.rotation_quaternion = q; key(o, j)
        scene.frame_set(i)
    else:
        set_cam(t)
        if "animate" in globals(): animate(t, i)
    scene.render.filepath = f"{OUT}/f_{i:04d}.{EXT}"; bpy.ops.render.render(write_still=True); log("frame", i)
