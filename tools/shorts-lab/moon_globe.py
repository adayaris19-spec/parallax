# The Moon as a whole, seen from space, with Earth beyond: shots at a scale the surface scenes cannot give.
#
# Measured or published: the Moon's colour and relief (NASA SVS "CGI Moon Kit": the LRO camera's colour mosaic and LOLA
# elevation at 16 samples per degree; within 9 degrees of the south pole, LOLA's own 80 m polar grid); where the Sun and Earth are, how Earth is turned and lit, at every frame's moment
# (JPL DE421 and the lunar orientation kernels); Earth's clouds (NASA GIBS, VIIRS, the same day).
# Modelled by us: where the camera is (no spacecraft is there), the exposure, the thin blue edge of Earth's air.
# The Moon is shaded the way its dust really scatters light (Lommel-Seeliger: no darkening toward the edge), not as a plaster ball.
# No stars are drawn: at an exposure set for sunlit ground they are far too faint to record.
#
# usage: python moon_globe.py DATA OUT first last count
#   env: VIEW 1 night sweeping across the globe, Earth above the dark edge
#             2 Earth turning above the south pole's edge, long lens
#             3 the south polar cap from above, sunlight circling it
#        UTC "y,m,d,h,min" the middle of the shot; SPAN hours that pass during it; D0, D1 camera distance from the Moon's centre (1000 km);
#        FOV vertical field of view in degrees; GAP, AIM, TILT framing angles; EXPO; Q mesh detail; SPP; SCALE
import os, sys, math, json, time, numpy as np, bpy
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
os.environ["OPENCV_IO_ENABLE_OPENEXR"] = "1"
import cv2
from mathutils import Vector, Matrix
DATA, OUT = sys.argv[1], sys.argv[2]; ARGS = sys.argv[3:]; E = lambda k, d: float(os.environ.get(k, d)); t0 = time.time()
def log(*a): print(f"[{time.time()-t0:6.1f}s]", *a, flush=True)
a_, b_, nf = (int(ARGS[0]), int(ARGS[1]), int(ARGS[2])) if ARGS else (0, 0, 1)
VIEW = int(E("VIEW", 1)); Q = E("Q", 1.0); RM = 1.7374                        # scene unit: 1000 km
DEF = {1: dict(utc="2026,10,14,0,0", span=30.0, d0=5.2, d1=4.8, fov=40.0, expo=2.6),
       2: dict(utc="2026,10,16,0,0", span=6.0, d0=12.0, d1=12.0, fov=6.0, expo=2.2),
       3: dict(utc="2026,10,16,0,0", span=72.0, d0=4.3, d1=4.0, fov=30.0, expo=3.2)}[VIEW]
UTC = tuple(int(v) for v in os.environ.get("UTC", DEF["utc"]).split(",")); SPAN = E("SPAN", DEF["span"]); DAY = "%04d-%02d-%02d" % UTC[:3]
bpy.ops.wm.read_factory_settings(use_empty=True); scene = bpy.context.scene

# ---------- Sun and Earth, in the Moon's own axes (x toward the mean Earth, z north), at any moment of the shot
from skyfield.api import Loader, PlanetaryConstants
from skyfield.framelib import itrs
load = Loader(f"{DATA}/spice"); eph = load("de421.bsp"); ts = load.timescale(builtin=True); pc = PlanetaryConstants()
pc.read_text(load("moon_080317.tf")); pc.read_text(load("pck00008.tpc")); pc.read_binary(load("moon_pa_de421_1900-2050.bpc")); fr = pc.build_frame_named("MOON_ME_DE421"); moon = eph["moon"]
def sky(tt):
    t = ts.utc(*UTC[:3], UTC[3] + UTC[4] / 60.0 + SPAN * (tt - 0.5)); o = {"t": t}
    for name in ("sun", "earth"): o[name] = np.array(moon.at(t).observe(eph[name]).frame_xyz(fr).km) / 1000.0
    o["erot"] = np.array(fr.rotation_at(t)) @ np.array(itrs.rotation_at(t)).T; return o
S0 = sky(0.5); unit = lambda v: np.asarray(v, float) / np.linalg.norm(v); sd0, ed0 = unit(S0["sun"]), unit(S0["earth"])
log("view", VIEW, S0["t"].utc_strftime("%Y-%m-%d %H:%M"), "Sun over lon %.1f lat %.1f" % (math.degrees(math.atan2(sd0[1], sd0[0])), math.degrees(math.asin(sd0[2]))),
    "Earth over lon %.1f lat %.1f" % (math.degrees(math.atan2(ed0[1], ed0[0])), math.degrees(math.asin(ed0[2]))), "Earth-Moon-Sun angle %.1f" % math.degrees(math.acos(sd0 @ ed0)))

# ---------- the Moon: LOLA relief as shape, the LRO colour mosaic as its surface
KIT = f"{DATA}/moonkit"; dem = cv2.imread(f"{KIT}/ldem_16.tif", cv2.IMREAD_UNCHANGED).astype(np.float32)        # km above a 1737.4 km sphere; the map is centred on longitude 0
nlon = int(2880 * Q) // 2 * 2; nlat = nlon // 2 + 1; H = cv2.resize(dem, (nlon, nlat), interpolation=cv2.INTER_AREA); H = np.concatenate([H, H[:, :1]], 1)
la = np.radians(np.linspace(90, -90, nlat)); lo = np.radians(np.linspace(-180, 180, nlon + 1)); LO, LA = np.meshgrid(lo, la); r = RM + H / 1000.0
P = np.stack([r * np.cos(LA) * np.cos(LO), r * np.cos(LA) * np.sin(LO), r * np.sin(LA)], -1)
def grid_mesh(name, P, UV):
    ny, nx, _ = P.shape; me = bpy.data.meshes.new(name); me.vertices.add(ny * nx); me.vertices.foreach_set("co", np.ascontiguousarray(P, np.float32).reshape(-1))
    idx = np.arange(ny * nx, dtype=np.int32).reshape(ny, nx); q = np.stack([idx[:-1, :-1], idx[1:, :-1], idx[1:, 1:], idx[:-1, 1:]], -1).reshape(-1); nq = (ny - 1) * (nx - 1)
    me.loops.add(nq * 4); me.loops.foreach_set("vertex_index", q); me.polygons.add(nq); me.polygons.foreach_set("loop_start", np.arange(0, nq * 4, 4, dtype=np.int32)); me.update(calc_edges=True); me.shade_smooth()
    me.uv_layers.new(name="uv").data.foreach_set("uv", UV.reshape(-1, 2)[q].astype(np.float32).reshape(-1)); ob = bpy.data.objects.new(name, me); scene.collection.objects.link(ob); return ob
CAP = 9.0                                                                     # degrees from the south pole: inside this the kit's map is stretched to a point, so LOLA's own polar grid (80 m, read at about 400 m) gives the shape
jc = int(np.searchsorted(-np.degrees(la), 90.0 - CAP)); capdeg = 90.0 + math.degrees(la[jc]); UV = np.stack([LO / (2 * np.pi) + 0.5, LA / np.pi + 0.5], -1)
import lunar_site as LS
from scipy import ndimage
d80 = LS.Dem(f"{DATA}/dem80.npz", 7600, 0.08); hh, xs_, ys_ = d80.cut(-300, 300, -300, 300); hh = ndimage.gaussian_filter(hh, 2.0)
nr = int(700 * Q); cc = np.radians(np.linspace(capdeg, 0.0, nr))[:, None]; lon_ = lo[None, :]; rk = 2 * LS.R * np.tan(cc / 2); xk, yk = rk * np.sin(lon_), rk * np.cos(lon_)      # map km: x toward 90 E, y toward 0
hk = ndimage.map_coordinates(hh, [(yk - ys_[0]) / 0.08, (xk - xs_[0]) / 0.08], order=1, mode="nearest"); latk = cc - np.pi / 2
demw = np.concatenate([dem[:, -1:], dem, dem[:, :1]], 1); hkit = ndimage.map_coordinates(demw, [np.broadcast_to((np.pi / 2 - latk) / np.pi * dem.shape[0] - 0.5, hk.shape), np.broadcast_to((lon_ + np.pi) / (2 * np.pi) * dem.shape[1] + 0.5, hk.shape)], order=1, mode="nearest") * 1000.0
wk = np.clip((capdeg - np.degrees(cc)) / 3.5, 0, 1); wk = wk * wk * (3 - 2 * wk); hk = hk * wk + hkit * (1 - wk); rr_ = RM + hk / 1.0e6      # the finer shape comes in over 3.5 degrees, so no edge shows where the two data sets meet
Pk = np.stack([rr_ * np.cos(latk) * np.cos(lon_), rr_ * np.cos(latk) * np.sin(lon_), rr_ * np.sin(latk)], -1); Pk[0] = P[jc]                                    # the first ring is the sphere's own edge, so the two meet
UVk = np.stack([np.broadcast_to(lon_ / (2 * np.pi) + 0.5, hk.shape), np.broadcast_to(latk / np.pi + 0.5, hk.shape)], -1)
mo = grid_mesh("moon", np.concatenate([P[:jc + 1], Pk[1:]], 0), np.concatenate([UV[:jc + 1], UVk[1:]], 0)); log("moon mesh: sphere rows", jc + 1, "polar rows", nr - 1, "columns", nlon + 1)       # one surface, so the light falls across the join unbroken
if not os.path.exists(f"{KIT}/ldem_16.exr"):                                # the same heights as an EXR, which the renderer reads as plain numbers
    import OpenEXR, Imath
    hd = OpenEXR.Header(dem.shape[1], dem.shape[0]); hd["channels"] = {c: Imath.Channel(Imath.PixelType(Imath.PixelType.FLOAT)) for c in "RGB"}; hd["compression"] = Imath.Compression(Imath.Compression.ZIP_COMPRESSION)
    f_ = OpenEXR.OutputFile(f"{KIT}/ldem_16.exr", hd); raw = dem.tobytes(); f_.writePixels({c: raw for c in "RGB"}); f_.close()
cmap = "lroc_color_poles_16k.tif" if os.path.exists(f"{KIT}/lroc_color_poles_16k.tif") and Q >= 1 else "lroc_color_poles_8k.tif"
small = cv2.resize(cv2.imread(f"{KIT}/{cmap}", cv2.IMREAD_REDUCED_COLOR_8), (512, 256)).astype(np.float32) / 255.0; ALB = 0.12 / float((small ** 2.2).mean())      # the Moon reflects about 12% of the light on it
m = bpy.data.materials.new("moon"); m.use_nodes = True; nt = m.node_tree; nt.nodes.clear(); N, L = nt.nodes.new, nt.links.new
out = N("ShaderNodeOutputMaterial"); dif = N("ShaderNodeBsdfDiffuse"); dif.inputs["Roughness"].default_value = 0.0; tx = N("ShaderNodeTexImage"); tx.image = bpy.data.images.load(f"{KIT}/{cmap}"); tx.interpolation = "Cubic"
hx = N("ShaderNodeTexImage"); hx.image = bpy.data.images.load(f"{KIT}/ldem_16.exr"); hx.image.colorspace_settings.name = "Non-Color"; hx.interpolation = "Cubic"
bp = N("ShaderNodeBump"); bp.inputs["Strength"].default_value = 1.0; bp.inputs["Distance"].default_value = 0.001; L(hx.outputs["Color"], bp.inputs["Height"]); L(bp.outputs["Normal"], dif.inputs["Normal"])       # relief finer than the mesh, at its true height
geo = N("ShaderNodeNewGeometry"); SUNV = N("ShaderNodeCombineXYZ")
def dot(a, b): n = N("ShaderNodeVectorMath"); n.operation = "DOT_PRODUCT"; L(a, n.inputs[0]); L(b, n.inputs[1]); return n.outputs["Value"]
def math_(op, a, b, clamp=False):
    n = N("ShaderNodeMath"); n.operation = op; n.use_clamp = clamp
    for i, v in enumerate((a, b)):
        if isinstance(v, (int, float)): n.inputs[i].default_value = v
        else: L(v, n.inputs[i])
    return n.outputs[0]
mu0 = math_("MAXIMUM", dot(geo.outputs["Normal"], SUNV.outputs[0]), 0.0); mu = math_("MAXIMUM", dot(geo.outputs["Normal"], geo.outputs["Incoming"]), 0.0)
k = math_("MINIMUM", math_("DIVIDE", 2.0, math_("ADD", math_("ADD", mu0, mu), 0.02)), 8.0)                       # Lommel-Seeliger over Lambert: 2 / (mu0 + mu)
gain = N("ShaderNodeMixRGB"); gain.blend_type = "MULTIPLY"; gain.inputs["Fac"].default_value = 1.0; L(tx.outputs["Color"], gain.inputs["Color1"]); kk = math_("MULTIPLY", k, ALB)
kc = N("ShaderNodeCombineColor") if hasattr(bpy.types, "ShaderNodeCombineColor") else N("ShaderNodeCombineRGB")
for i in range(3): L(kk, kc.inputs[i])
L(kc.outputs[0], gain.inputs["Color2"]); L(gain.outputs["Color"], dif.inputs["Color"]); L(dif.outputs["BSDF"], out.inputs["Surface"]); mo.data.materials.append(m)
uvn = N("ShaderNodeUVMap"); sep = N("ShaderNodeSeparateXYZ"); L(uvn.outputs["UV"], sep.inputs[0])                                              # near the pole the kit's maps are smeared to a point: there the added relief fades out (the shape itself is fine) and the colour fades to its own average
bs = N("ShaderNodeMapRange"); bs.inputs["From Min"].default_value = (CAP - 3.5) / 180; bs.inputs["From Max"].default_value = CAP / 180; L(sep.outputs["Y"], bs.inputs["Value"]); L(bs.outputs["Result"], bp.inputs["Strength"])
mr = N("ShaderNodeMapRange"); mr.inputs["From Min"].default_value = 1.2 / 180; mr.inputs["From Max"].default_value = 3.0 / 180; L(sep.outputs["Y"], mr.inputs["Value"])
fl = N("ShaderNodeMixRGB"); px = small[-4:-1].reshape(-1, 3).mean(0)[::-1] ** 2.2; fl.inputs["Color1"].default_value = (float(px[0]), float(px[1]), float(px[2]), 1); L(mr.outputs["Result"], fl.inputs["Fac"]); L(tx.outputs["Color"], fl.inputs["Color2"]); L(fl.outputs["Color"], gain.inputs["Color1"])

# ---------- Sun, Earth
SUNE = 10.0; sl = bpy.data.lights.new("sun", "SUN"); sl.energy = SUNE; sun = bpy.data.objects.new("sun", sl); scene.collection.objects.link(sun); sun.rotation_mode = "QUATERNION"
elat, elon = 361, 721; ela = np.radians(np.linspace(-90, 90, elat)); elo = np.radians(np.linspace(-180, 180, elon)); ELO, ELA = np.meshgrid(elo, ela)
eob = grid_mesh("earth", np.stack([np.cos(ELA) * np.cos(ELO), np.cos(ELA) * np.sin(ELO), np.sin(ELA)], -1)[:, ::-1] * 6.371, np.stack([ELO / (2 * np.pi) + 0.5, ELA / np.pi + 0.5], -1)[:, ::-1]); eob.visible_shadow = False
em = bpy.data.materials.new("earth"); em.use_nodes = True; nt = em.node_tree; nt.nodes.clear(); N, L = nt.nodes.new, nt.links.new; o_ = N("ShaderNodeOutputMaterial"); d_ = N("ShaderNodeBsdfDiffuse"); etx = N("ShaderNodeTexImage")
EDAY = os.environ.get("EARTHDAY", DAY); epic = f"{DATA}/earthglobal/earthx_{EDAY}.png"; etx.image = bpy.data.images.load(epic if os.path.exists(epic) else f"{DATA}/earthglobal/earth_{EDAY}.png"); etx.extension = "EXTEND"; etx.interpolation = "Cubic"; L(etx.outputs["Color"], d_.inputs["Color"])
air = N("ShaderNodeEmission"); air.inputs["Color"].default_value = (0.32, 0.52, 1.0, 1); lw = N("ShaderNodeLayerWeight"); lw.inputs["Blend"].default_value = 0.12; add = N("ShaderNodeAddShader")       # the thin blue edge of the atmosphere
egeo = N("ShaderNodeNewGeometry"); ESUN = N("ShaderNodeCombineXYZ"); ed_ = N("ShaderNodeVectorMath"); ed_.operation = "DOT_PRODUCT"; L(egeo.outputs["Normal"], ed_.inputs[0]); L(ESUN.outputs[0], ed_.inputs[1])
lit = N("ShaderNodeMapRange"); lit.inputs["From Min"].default_value = -0.05; lit.inputs["From Max"].default_value = 0.25; L(ed_.outputs["Value"], lit.inputs["Value"]); mul = N("ShaderNodeMath"); mul.operation = "MULTIPLY"; L(lw.outputs["Facing"], mul.inputs[0]); L(lit.outputs["Result"], mul.inputs[1])
sc_ = N("ShaderNodeMath"); sc_.operation = "MULTIPLY"; sc_.inputs[1].default_value = 0.55 * SUNE / math.pi; L(mul.outputs[0], sc_.inputs[0]); L(sc_.outputs[0], air.inputs["Strength"]); L(d_.outputs["BSDF"], add.inputs[0]); L(air.outputs[0], add.inputs[1]); L(add.outputs[0], o_.inputs["Surface"])
eob.data.materials.append(em); w = bpy.data.worlds.new("space"); scene.world = w; w.use_nodes = True; w.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.0

# ---------- the camera
cd = bpy.data.cameras.new("cam"); cd.sensor_fit = "VERTICAL"; cd.sensor_height = 36; FOV = E("FOV", DEF["fov"]); cd.lens = 18.0 / math.tan(math.radians(FOV) / 2); cd.clip_start = 0.01; cd.clip_end = 1.0e5
cam = bpy.data.objects.new("cam", cd); scene.collection.objects.link(cam); scene.camera = cam
def look(pos, fwd, up):
    f = unit(fwd); u = unit(np.asarray(up) - f * (np.asarray(up) @ f)); r_ = np.cross(f, u); cam.matrix_world = Matrix([[r_[0], u[0], -f[0], pos[0]], [r_[1], u[1], -f[1], pos[1]], [r_[2], u[2], -f[2], pos[2]], [0, 0, 0, 1]])
def rot_toward(a, b, deg):                                                    # turn unit vector a toward b by deg
    p = unit(b - a * (a @ b)); return a * math.cos(math.radians(deg)) + p * math.sin(math.radians(deg))
ease = lambda x: x * x * (3 - 2 * x)
def set_frame(tt):
    S = sky(tt); s, e = unit(S["sun"]), unit(S["earth"]); sun.rotation_quaternion = Vector(s).to_track_quat("Z", "Y"); sl.angle = 2 * math.asin(695.7 / np.linalg.norm(S["sun"]))
    SUNV.inputs[0].default_value, SUNV.inputs[1].default_value, SUNV.inputs[2].default_value = float(s[0]), float(s[1]), float(s[2])
    Mx = np.eye(4); Mx[:3, :3] = S["erot"]; Mx[:3, 3] = S["earth"]; eob.matrix_world = Matrix(Mx.tolist()); es = unit(S["sun"] - S["earth"])
    ESUN.inputs[0].default_value, ESUN.inputs[1].default_value, ESUN.inputs[2].default_value = float(es[0]), float(es[1]), float(es[2])
    D = DEF["d0"] if "D0" not in os.environ else E("D0", 0); D1 = DEF["d1"] if "D1" not in os.environ else E("D1", 0); D = D + (D1 - D) * tt
    if VIEW == 1:        # above the sunlit ground just short of where evening falls, looking over the dark edge to Earth; the camera holds its place over the ground as the night comes toward it
        e0 = ed0; w_ = unit(sd0 - e0 * (sd0 @ e0)); beta = math.degrees(math.asin(RM / D)) + E("GAP", 1.2); c = -e0 * math.cos(math.radians(beta)) - w_ * math.sin(math.radians(beta)); c = rot_toward(c, np.cross(e0, w_), E("SIDE", 0.0) + E("DRIFT", 2.0) * (tt - 0.5))
        pos = c * D; te = unit(S["earth"] - pos); f = rot_toward(-c, te, E("AIM", 13.0)); look(pos, f, te)
    elif VIEW == 2:      # far beyond the Moon on the side away from Earth, raised toward the south, so that Earth stands just over the south pole's edge
        e0 = ed0; u = unit(np.array([0, 0, -1.0]) - e0 * (-e0[2])); u = rot_toward(u, np.cross(e0, u), E("ROLL", 0.0)); b = RM + D * math.tan(math.radians(E("GAP", 1.25))); pos = -e0 * D + u * b + np.cross(e0, u) * E("DRIFT", 0.25) * (tt - 0.5)
        te = unit(S["earth"] - pos); f = rot_toward(te, -u, E("AIM", 0.9)); look(pos, f, u)
    else:                # above the south pole, held still over the ground while the sunlight circles the cap
        sh = unit(np.array([sd0[0], sd0[1], 0.0])); c = rot_toward(np.array([0, 0, -1.0]), sh, E("TILT", 3.0)); pos = c * D; f = rot_toward(-c, sh, E("AIM", 0.0)); look(pos, f, sh)   # the sunlit side at the top of the frame at mid-shot
    return S
LABELS = {"South Pole": (-90.0, 0.0), "Shackleton crater": (-89.67, 129.2), "Connecting Ridge": (-89.45, -137.2)}   # (lat, lon east); the ridge and crater as in the surface scenes
def label_points(S):
    from bpy_extras.object_utils import world_to_camera_view
    o = {}
    for name, (lat, lon) in LABELS.items():
        a, b = math.radians(lat), math.radians(lon); v = world_to_camera_view(scene, cam, Vector((RM * math.cos(a) * math.cos(b), RM * math.cos(a) * math.sin(b), RM * math.sin(a)))); o[name] = [round(v.x, 5), round(1 - v.y, 5), round(v.z, 4)]
    v = world_to_camera_view(scene, cam, Vector(tuple(S["earth"]))); o["_earth"] = [round(v.x, 5), round(1 - v.y, 5), round(v.z, 2)]; return o

# ---------- render
scene.render.engine = "CYCLES"; cy = scene.cycles; cy.device = "CPU"; cy.film_exposure = E("EXPO", DEF["expo"]); cy.samples = int(E("SPP", 48)); cy.use_adaptive_sampling = True; cy.adaptive_threshold = 0.01; cy.use_denoising = True
cy.max_bounces = 2; cy.diffuse_bounces = 1; cy.glossy_bounces = 1; cy.sample_clamp_indirect = 10.0; scene.render.use_persistent_data = True
sc = E("SCALE", 1.0); scene.render.resolution_x, scene.render.resolution_y = int(round(1080 * sc)), int(round(1920 * sc)); scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = "OPEN_EXR"; scene.render.image_settings.color_depth = "16"; scene.render.image_settings.exr_codec = "ZIP"; log("scene built"); os.makedirs(OUT, exist_ok=True)
for i in range(a_, b_ + 1):
    S = set_frame(i / max(nf - 1, 1)); bpy.context.view_layer.update(); json.dump(label_points(S), open(f"{OUT}/labels_{i:04d}.json", "w"))
    if E("LABELS", 0): continue
    scene.render.filepath = f"{OUT}/f_{i:04d}.exr"; bpy.ops.render.render(write_still=True); log("frame", i)
