# "The Sun almost never sets on a few ridges at the Moon's south pole": one real month of sunlight seen from above.
# Real: the terrain (NASA LOLA elevation) and the Sun's direction and size for every frame (JPL DE421 ephemeris and lunar orientation).
# Not real: the viewpoint. No spacecraft hovers above the pole; this is a time-lapse from a fixed point, with everything sped up together.
# usage: python pole_light.py DATA OUT [first last count]     env: SPP, SUB (sun positions averaged per frame), SCALE, DAYS, START (y,m,d)
import os, sys, math, time, numpy as np, bpy
from mathutils import Vector
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import lunar_site as LS, terrain as TR
DATA, OUT = sys.argv[1], sys.argv[2]; ARGS = sys.argv[3:]; E = lambda k, d: float(os.environ.get(k, d)); t0 = time.time()
def log(*a): print(f"[{time.time()-t0:6.1f}s]", *a, flush=True)
CX, CY = -11.82, -12.54                                   # the Connecting Ridge site (map km from the pole)
START = tuple(int(v) for v in os.environ.get("START", "2026,10,1").split(",")); DAYS = E("DAYS", 29.53)
bpy.ops.wm.read_factory_settings(use_empty=True); scene = bpy.context.scene
def dem(window, full, n, step): p = f"{DATA}/{window}"; return LS.Dem(p if os.path.exists(p) else f"{DATA}/{full}", n, step)
d5 = dem("dem5.npz", "ldem_875s_5m.img", 30336, 0.005); d40 = dem("dem40.npz", "ldem_80s_40m.img", 15200, 0.04); d80 = dem("dem80.npz", "ldem_80s_80m.img", 7600, 0.08)
h0 = float(TR.ndimage.gaussian_filter(d5.cut(CX - 0.1, CX + 0.1, CY - 0.1, CY + 0.1)[0], 3.0)[20, 20]); site = LS.Site(CX, CY, h0)

# the Sun's direction for every sub-frame, from the ephemeris
a_, b_, nf = (int(ARGS[0]), int(ARGS[1]), int(ARGS[2])) if ARGS else (0, 0, 1); SUB = int(E("SUB", 3))
from skyfield.api import Loader, PlanetaryConstants
load = Loader(f"{DATA}/spice"); eph = load("de421.bsp"); ts = load.timescale(builtin=True); pc = PlanetaryConstants()
pc.read_text(load("moon_080317.tf")); pc.read_text(load("pck00008.tpc")); pc.read_binary(load("moon_pa_de421_1900-2050.bpc")); fr = pc.build_frame_named("MOON_ME_DE421"); obs = eph["moon"] + pc.build_latlon_degrees(fr, site.lat, site.lon)
A = np.array([[0, 1.0, 0], [1.0, 0, 0], [0, 0, -1.0]])
def sun_at(frame_float):
    t = ts.utc(START[0], START[1], START[2], 24.0 * DAYS * frame_float / max(nf - 1, 1)); ap = obs.at(t).observe(eph["sun"]).apparent(); v = np.array(ap.frame_xyz(fr).km); d = np.linalg.norm(v)
    return site.B @ (A @ (v / d)), d, t

# ground: every level is measured terrain; only a fine surface grain is added in the shader
m = bpy.data.materials.new("regolith"); m.use_nodes = True; nt = m.node_tree; nt.nodes.clear(); N = nt.nodes.new; L = nt.links.new
out = N("ShaderNodeOutputMaterial"); dif = N("ShaderNodeBsdfDiffuse"); dif.inputs["Roughness"].default_value = 1.0; geo = N("ShaderNodeNewGeometry")
n1 = N("ShaderNodeTexNoise"); n1.inputs["Scale"].default_value = 0.00035; n1.inputs["Detail"].default_value = 10; L(geo.outputs["Position"], n1.inputs["Vector"])
mr = N("ShaderNodeMapRange"); mr.inputs["To Min"].default_value = 0.86; mr.inputs["To Max"].default_value = 1.14; L(n1.outputs["Fac"], mr.inputs["Value"])
col = N("ShaderNodeMixRGB"); col.blend_type = "MULTIPLY"; col.inputs["Fac"].default_value = 1; col.inputs["Color1"].default_value = (0.150, 0.140, 0.128, 1); L(mr.outputs["Result"], col.inputs["Color2"]); L(col.outputs["Color"], dif.inputs["Color"]); L(dif.outputs["BSDF"], out.inputs["Surface"])
def add_grid(name, P, hole=None, XY=None):
    ny, nx, _ = P.shape; me = bpy.data.meshes.new(name); me.vertices.add(ny * nx); me.vertices.foreach_set("co", np.ascontiguousarray(P, np.float32).reshape(-1))
    idx = np.arange(ny * nx, dtype=np.int32).reshape(ny, nx); q = np.stack([idx[:-1, :-1], idx[:-1, 1:], idx[1:, 1:], idx[1:, :-1]], -1).reshape(-1, 4)
    if hole is not None:
        X, Y = XY; xc = (X[:-1, :-1] + X[1:, 1:]) / 2; yc = (Y[:-1, :-1] + Y[1:, 1:]) / 2; q = q[~((xc > hole[0]) & (xc < hole[1]) & (yc > hole[2]) & (yc < hole[3])).reshape(-1)]
    nq = len(q); me.loops.add(nq * 4); me.loops.foreach_set("vertex_index", q.reshape(-1)); me.polygons.add(nq); me.polygons.foreach_set("loop_start", np.arange(0, nq * 4, 4, dtype=np.int32))
    me.update(calc_edges=True); me.shade_smooth(); me.materials.append(m); scene.collection.objects.link(bpy.data.objects.new(name, me)); log(name, P.shape[:2], "faces", nq)
W40 = 32.5
if os.path.exists(f"{DATA}/dem20.npz"): X, Y, P = TR.far_grid(site, LS.Dem(f"{DATA}/dem20.npz", 30400, 0.02), CX - W40, CX + W40, CY - W40, CY + W40, 1, 1.0); add_grid("r20", P)       # the 20 m grid where the camera looks
else: X, Y, P = TR.far_grid(site, d40, CX - W40, CX + W40, CY - W40, CY + W40, 1, 0.7); add_grid("r40", P)
K = int(E("K80", 3)); X, Y, P = TR.far_grid(site, d80, -300, 300, -300, 300, K); add_grid("r80", P, (CX - W40 + 0.3, CX + W40 - 0.3, CY - W40 + 0.3, CY + W40 - 0.3), (X, Y)); del X, Y, P

sl = bpy.data.lights.new("sun", "SUN"); sl.energy = E("SUN", 10.0); sun = bpy.data.objects.new("sun", sl); scene.collection.objects.link(sun); sun.rotation_mode = "QUATERNION"
w = bpy.data.worlds.new("space"); scene.world = w; w.use_nodes = True; w.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.0
cd = bpy.data.cameras.new("cam"); cd.sensor_fit = "VERTICAL"; cd.sensor_height = 36; cd.lens = E("LENS", 38.6); cd.clip_start = 100; cd.clip_end = 5.0e6
cam = bpy.data.objects.new("cam", cd); scene.collection.objects.link(cam); scene.camera = cam
TX, TY = E("TX", -3.0), E("TY", -9.5)                     # look at the ground between the ridge and Shackleton crater
def set_cam(t):
    back = E("BACK", 78.0) - E("PUSH", 10.0) * t; alt = (E("ALT", 62.0) - E("PUSH", 10.0) * 0.55 * t) * 1000; az = math.radians(E("FROM", 200.0))       # camera stands off to this map bearing
    pos = Vector(site.local(TX + back * math.sin(az), TY + back * math.cos(az), alt)); tgt = Vector(site.local(TX, TY, 0.0)); d = (tgt - pos).normalized()
    up = Vector(site.local(TX, TY, 1.0e5)) - tgt; cam.location = pos; cam.rotation_mode = "QUATERNION"; cam.rotation_quaternion = d.to_track_quat("-Z", "Y")
scene.render.engine = "CYCLES"; cy = scene.cycles; cy.device = "CPU"; cy.samples = int(E("SPP", 12)); cy.use_adaptive_sampling = False; cy.use_denoising = True; cy.max_bounces = 3; cy.diffuse_bounces = 2; scene.render.use_persistent_data = True
sc = E("SCALE", 1.0); scene.render.resolution_x, scene.render.resolution_y = int(1080 * sc), int(1920 * sc); scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = "OPEN_EXR"; scene.render.image_settings.color_depth = "16"; scene.render.image_settings.exr_codec = "ZIP"
import OpenEXR, Imath
def read_exr(path):
    f = OpenEXR.InputFile(path); dw = f.header()["dataWindow"]; Wd, Hd = dw.max.x - dw.min.x + 1, dw.max.y - dw.min.y + 1; pt = Imath.PixelType(Imath.PixelType.FLOAT)
    return np.stack([np.frombuffer(f.channel(c, pt), np.float32).reshape(Hd, Wd) for c in ("R", "G", "B")], -1)
def write_exr(path, img):
    Hd, Wd = img.shape[:2]; hdr = OpenEXR.Header(Wd, Hd); hdr["channels"] = {c: Imath.Channel(Imath.PixelType(Imath.PixelType.FLOAT)) for c in "RGB"}
    o = OpenEXR.OutputFile(path, hdr); o.writePixels({c: np.ascontiguousarray(img[:, :, i], np.float32).tobytes() for i, c in enumerate("RGB")}); o.close()
log("scene built")
for i in range(a_, b_ + 1):
    set_cam(i / max(nf - 1, 1)); acc = None
    for k in range(SUB):                                   # the Sun moves during the time one frame stands for; averaging its positions is the time-lapse's own motion blur
        d, dist, tt = sun_at(i + (k + 0.5) / SUB - 0.5); sl.angle = 2 * math.asin(695700.0 / dist); sun.rotation_quaternion = Vector(d).to_track_quat("Z", "Y")
        scene.render.filepath = f"{OUT}/sub_{i:04d}_{k}.exr"; bpy.ops.render.render(write_still=True); im = read_exr(scene.render.filepath); os.remove(scene.render.filepath); acc = im if acc is None else acc + im
    write_exr(f"{OUT}/f_{i:04d}.exr", acc / SUB); log("frame", i, tt.utc_strftime("%Y-%m-%d %H:%M"), "sun alt %.2f" % math.degrees(math.asin(d[2])))
