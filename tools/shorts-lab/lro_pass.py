# The Lunar Reconnaissance Orbiter passing over the Moon's south pole with Earth above the limb, for the line about the
# sunlit ridges: the maps of polar sunlight were made from this spacecraft's laser altimeter (Mazarico et al. 2011, Icarus).
#
# Measured or published: the terrain (NASA LOLA elevation, 40 m and 80 m grids); where the Sun and Earth are and how Earth is
# turned and lit at this moment (JPL DE421, lunar orientation kernels); Earth's clouds (NASA GIBS, VIIRS, the same day); the
# spacecraft's shape (NASA-3D-Resources); its height and speed (the 50 km circular polar mapping orbit, 1.66 km/s) and how it
# flies (instruments to the Moon, array to the Sun, dish to Earth).
# Modelled by us: where on that orbit the spacecraft is at this moment (not from tracking data), its surface finishes, and the
# camera, which no spacecraft carries: it flies beside the orbiter and pulls back.
#
# usage: python lro_pass.py DATA OUT first last count      env: SPP, SCALE, LENS, EXPO, D0, D1 ... ; LABELS=1 writes label positions only
import os, sys, math, time, json, numpy as np, bpy
from mathutils import Vector, Matrix
from bpy_extras.object_utils import world_to_camera_view
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import lunar_site as LS, terrain as TR, lro_model as LM
DATA, OUT = sys.argv[1], sys.argv[2]; ARGS = sys.argv[3:]; E = lambda k, d: float(os.environ.get(k, d)); t0 = time.time()
def log(*a): print(f"[{time.time()-t0:6.1f}s]", *a, flush=True)
a_, b_, nf = (int(ARGS[0]), int(ARGS[1]), int(ARGS[2])) if ARGS else (0, 0, 1)
CX, CY = -11.52, -12.44; UTC = tuple(int(v) for v in os.environ.get("UTC", "2026,10,16,0,0").split(",")); DAY = "%04d-%02d-%02d" % UTC[:3]
ALT, SPEED, DUR = E("ALT", 50.0), 1.656, E("DUR", 3.5)                       # km above the datum; km/s for a circular orbit at that height; seconds
NOCRAFT = E("NOCRAFT", 0) > 0; SPAN = E("SPAN", 0.0)                      # NOCRAFT=1: no spacecraft, a camera above the terrain; SPAN: hours that pass during the shot (a time-lapse)
X0, Y0 = E("X0", -8.0), E("Y0", -152.0)                                      # map km where the spacecraft is at mid-shot: beyond the pole, heading for the Earth side
bpy.ops.wm.read_factory_settings(use_empty=True); scene = bpy.context.scene
def dem(window, full, n, step): p = f"{DATA}/{window}"; return LS.Dem(p if os.path.exists(p) else f"{DATA}/{full}", n, step)
d5 = dem("dem5.npz", "ldem_875s_5m.img", 30336, 0.005); d40 = dem("dem40s.npz", "ldem_80s_40m.img", 15200, 0.04); d80 = dem("dem80.npz", "ldem_80s_80m.img", 7600, 0.08)
h0 = float(TR.ndimage.gaussian_filter(d5.cut(CX - 0.1, CX + 0.1, CY - 0.1, CY + 0.1)[0], 3.0)[20, 20]); site = LS.Site(CX, CY, h0)
O = np.array(site.local(X0, Y0, ALT * 1000.0), np.float64)                   # scene origin at the spacecraft's mid-shot place, so the close detail keeps its precision
loc = lambda x, y, h: np.asarray(site.local(x, y, h), np.float64) - O
p0 = loc(0.0, 0.0, 0.0); MOON_C = p0 - (loc(0.0, 0.0, 1000.0) - p0) / 1000.0 * LS.R * 1000.0

# ---------- Sun and Earth at this moment
from skyfield.api import Loader, PlanetaryConstants
from skyfield.framelib import itrs
load = Loader(f"{DATA}/spice"); eph = load("de421.bsp"); ts = load.timescale(builtin=True); pc = PlanetaryConstants()
pc.read_text(load("moon_080317.tf")); pc.read_text(load("pck00008.tpc")); pc.read_binary(load("moon_pa_de421_1900-2050.bpc")); fr = pc.build_frame_named("MOON_ME_DE421"); obs = eph["moon"] + pc.build_latlon_degrees(fr, site.lat, site.lon)
AM = np.array([[0, 1.0, 0], [1.0, 0, 0], [0, 0, -1.0]]); T = ts.utc(*UTC[:3], UTC[3] + UTC[4] / 60.0); SKY = {}
for name in ("sun", "earth"):
    v = np.array(obs.at(T).observe(eph[name]).apparent().frame_xyz(fr).km); d = np.linalg.norm(v); SKY[name] = (site.B @ (AM @ (v / d)), d)
EROT = site.B @ AM @ np.array(fr.rotation_at(T)) @ np.array(itrs.rotation_at(T)).T
def sun_at(tt):
    t = ts.utc(*UTC[:3], UTC[3] + UTC[4] / 60.0 + SPAN * (tt - 0.5)); v = np.array(obs.at(t).observe(eph["sun"]).apparent().frame_xyz(fr).km); d = np.linalg.norm(v); return site.B @ (AM @ (v / d)), d
sd, sdist = SKY["sun"]; ed, edist = SKY["earth"]; log(DAY, "sun alt %.2f az %.1f" % (math.degrees(math.asin(sd[2])), math.degrees(math.atan2(sd[0], sd[1])) % 360), "earth alt %.2f az %.1f" % (math.degrees(math.asin(ed[2])), math.degrees(math.atan2(ed[0], ed[1])) % 360))

# ---------- the Moon: measured terrain where the camera looks, a plain sphere beyond the grids
m = bpy.data.materials.new("regolith"); m.use_nodes = True; nt = m.node_tree; nt.nodes.clear(); N = nt.nodes.new; L = nt.links.new
out = N("ShaderNodeOutputMaterial"); dif = N("ShaderNodeBsdfDiffuse"); dif.inputs["Roughness"].default_value = 1.0; geo = N("ShaderNodeNewGeometry")
n1 = N("ShaderNodeTexNoise"); n1.inputs["Scale"].default_value = 0.00035; n1.inputs["Detail"].default_value = 10; L(geo.outputs["Position"], n1.inputs["Vector"])
mr = N("ShaderNodeMapRange"); mr.inputs["To Min"].default_value = 0.88; mr.inputs["To Max"].default_value = 1.12; L(n1.outputs["Fac"], mr.inputs["Value"])
col = N("ShaderNodeMixRGB"); col.blend_type = "MULTIPLY"; col.inputs["Fac"].default_value = 1; col.inputs["Color1"].default_value = (0.150, 0.140, 0.128, 1); L(mr.outputs["Result"], col.inputs["Color2"]); L(col.outputs["Color"], dif.inputs["Color"]); L(dif.outputs["BSDF"], out.inputs["Surface"])
def add_grid(name, X, Y, P, holes=()):
    ny, nx, _ = P.shape; me = bpy.data.meshes.new(name); me.vertices.add(ny * nx); me.vertices.foreach_set("co", np.ascontiguousarray(P - O, np.float32).reshape(-1))
    idx = np.arange(ny * nx, dtype=np.int32).reshape(ny, nx); q = np.stack([idx[:-1, :-1], idx[:-1, 1:], idx[1:, 1:], idx[1:, :-1]], -1).reshape(-1, 4); xc = (X[:-1, :-1] + X[1:, 1:]) / 2; yc = (Y[:-1, :-1] + Y[1:, 1:]) / 2; keep = np.ones(xc.shape, bool)
    for (x0, x1, y0, y1) in holes: keep &= ~((xc > x0) & (xc < x1) & (yc > y0) & (yc < y1))
    q = q[keep.reshape(-1)]; nq = len(q); me.loops.add(nq * 4); me.loops.foreach_set("vertex_index", q.reshape(-1)); me.polygons.add(nq); me.polygons.foreach_set("loop_start", np.arange(0, nq * 4, 4, dtype=np.int32))
    me.update(calc_edges=True); me.shade_smooth(); me.materials.append(m); scene.collection.objects.link(bpy.data.objects.new(name, me)); log(name, P.shape[:2], "faces", nq)
Q = E("Q", 1.0); NEAR = (-46.0, 36.0, -113.0, 22.0); MID = tuple(float(v) for v in os.environ.get("MIDBOX", "-112,112,22,300").split(","))           # map km: the 40 m grid under and ahead of the spacecraft; the 80 m grid on to the horizon
X, Y, P = TR.far_grid(site, d40, *NEAR, int(round(1 / Q))); add_grid("near40", X, Y, P)
X, Y, P = TR.far_grid(site, d80, *MID, int(round(2 / Q))); add_grid("mid160", X, Y, P)
X, Y, P = TR.far_grid(site, d80, -300, 300, -300, 300, int(round(6 / Q))); add_grid("far480", X, Y, P, [(NEAR[0] + 0.6, NEAR[1] - 0.6, NEAR[2] + 0.6, NEAR[3] + 0.6), (MID[0] + 0.6, MID[1] - 0.6, MID[2] - 0.6, MID[3] - 0.6)]); del X, Y, P
bpy.ops.mesh.primitive_uv_sphere_add(segments=720, ring_count=360, radius=(LS.R - 9.0) * 1000.0, location=tuple(MOON_C)); sph = bpy.context.object; sph.name = "moon_beyond"; sph.data.materials.append(m)
for p_ in sph.data.polygons: p_.use_smooth = True
moon = bpy.data.objects.new("moon", None); scene.collection.objects.link(moon)          # the spacecraft stays at the scene's origin and the Moon moves under it: the model has parts 0.4 mm apart,
for o in list(scene.objects):                                                            # which only render cleanly where coordinates are small
    if o.type == "MESH": o.parent = moon

# ---------- Sun, Earth
SUNE = 10.0; sl = bpy.data.lights.new("sun", "SUN"); sl.energy = SUNE; sl.angle = 2 * math.asin(695700.0 / sdist); sun = bpy.data.objects.new("sun", sl); scene.collection.objects.link(sun); sun.rotation_mode = "QUATERNION"; sun.rotation_quaternion = Vector(sd).to_track_quat("Z", "Y")
ED = 3.0e7; nlat, nlon = 361, 721; la = np.radians(np.linspace(-90, 90, nlat)); lo = np.radians(np.linspace(-180, 180, nlon)); LO, LA = np.meshgrid(lo, la); SPH = np.stack([np.cos(LA) * np.cos(LO), np.cos(LA) * np.sin(LO), np.sin(LA)], -1)
eme = bpy.data.meshes.new("earth"); eme.vertices.add(nlat * nlon); idx = np.arange(nlat * nlon, dtype=np.int32).reshape(nlat, nlon); q = np.stack([idx[:-1, :-1], idx[:-1, 1:], idx[1:, 1:], idx[1:, :-1]], -1).reshape(-1); nq = (nlat - 1) * (nlon - 1)
eme.vertices.foreach_set("co", (SPH @ EROT.T * (6371.0 / edist * ED) + np.array(ed) * ED).astype(np.float32).reshape(-1)); eme.loops.add(nq * 4); eme.loops.foreach_set("vertex_index", q); eme.polygons.add(nq); eme.polygons.foreach_set("loop_start", np.arange(0, nq * 4, 4, dtype=np.int32)); eme.update(calc_edges=True); eme.shade_smooth()
eme.uv_layers.new(name="uv").data.foreach_set("uv", np.stack([(LO / (2 * np.pi) + 0.5), (LA / np.pi + 0.5)], -1).reshape(-1, 2)[q].astype(np.float32).reshape(-1))
em = bpy.data.materials.new("earth"); em.use_nodes = True; nt = em.node_tree; nt.nodes.clear(); o_ = nt.nodes.new("ShaderNodeOutputMaterial"); d_ = nt.nodes.new("ShaderNodeBsdfDiffuse"); tx = nt.nodes.new("ShaderNodeTexImage")
tx.image = bpy.data.images.load(f"{DATA}/earthglobal/earth_{os.environ.get('EARTHDAY', DAY)}.png")       # EARTHDAY: the cloud picture to use when the shot's own day has none fetched (shots where Earth is out of view); tx.extension = "EXTEND"; tx.interpolation = "Cubic"; nt.links.new(tx.outputs["Color"], d_.inputs["Color"])
air = nt.nodes.new("ShaderNodeEmission"); air.inputs["Color"].default_value = (0.32, 0.52, 1.0, 1); lw = nt.nodes.new("ShaderNodeLayerWeight"); lw.inputs["Blend"].default_value = 0.12; add = nt.nodes.new("ShaderNodeAddShader")       # the thin blue edge of the atmosphere
dotn = nt.nodes.new("ShaderNodeVectorMath"); dotn.operation = "DOT_PRODUCT"; gn = nt.nodes.new("ShaderNodeNewGeometry"); dotn.inputs[1].default_value = tuple(sd); nt.links.new(gn.outputs["Normal"], dotn.inputs[0])
lit = nt.nodes.new("ShaderNodeMapRange"); lit.inputs["From Min"].default_value = -0.05; lit.inputs["From Max"].default_value = 0.25; nt.links.new(dotn.outputs["Value"], lit.inputs["Value"]); mul = nt.nodes.new("ShaderNodeMath"); mul.operation = "MULTIPLY"; nt.links.new(lw.outputs["Facing"], mul.inputs[0]); nt.links.new(lit.outputs["Result"], mul.inputs[1])
sc_ = nt.nodes.new("ShaderNodeMath"); sc_.operation = "MULTIPLY"; sc_.inputs[1].default_value = 0.55 * SUNE / math.pi; nt.links.new(mul.outputs[0], sc_.inputs[0]); nt.links.new(sc_.outputs[0], air.inputs["Strength"]); nt.links.new(d_.outputs["BSDF"], add.inputs[0]); nt.links.new(air.outputs[0], add.inputs[1]); nt.links.new(add.outputs[0], o_.inputs["Surface"])
eme.materials.append(em); eob = bpy.data.objects.new("earth", eme); scene.collection.objects.link(eob); eob.visible_shadow = False
w = bpy.data.worlds.new("space"); scene.world = w; w.use_nodes = True; w.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.0
bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=4, radius=1.0); sdisk = bpy.context.object; sdisk.name = "sun_disk"       # the Sun itself, for shots that look toward it; it lights nothing (the lamp does)
sm_ = bpy.data.materials.new("sun_disk"); sm_.use_nodes = True; nt = sm_.node_tree; nt.nodes.clear(); so_ = nt.nodes.new("ShaderNodeOutputMaterial"); se_ = nt.nodes.new("ShaderNodeEmission"); se_.inputs["Color"].default_value = (1.0, 0.95, 0.88, 1); nt.links.new(se_.outputs[0], so_.inputs[0])
sdisk.data.materials.append(sm_); sdisk.visible_diffuse = sdisk.visible_glossy = sdisk.visible_transmission = sdisk.visible_volume_scatter = sdisk.visible_shadow = False
def set_sun(tt):
    d, dist = sun_at(tt) if SPAN else (sd, sdist); ang = math.asin(695700.0 / dist); sun.rotation_quaternion = Vector(d).to_track_quat("Z", "Y"); sdisk.location = Vector(d) * 2.0e7; sdisk.scale = (2.0e7 * math.tan(ang),) * 3; se_.inputs["Strength"].default_value = SUNE / (math.pi * ang * ang)

# ---------- the spacecraft
if not NOCRAFT: root, parts = LM.load(f"{DATA}/models_plain/lro_a.glb"); root.rotation_mode = "QUATERNION"
else: root = bpy.data.objects.new("anchor", None); scene.collection.objects.link(root); parts = None
def craft(tt):
    """place and attitude at time fraction tt: instruments (+X) to the Moon's centre, long axis (Z) along the track"""
    y = Y0 + SPEED * DUR * (tt - 0.5); p = loc(X0, y, ALT * 1000.0); fwd = loc(X0, y + 0.5, ALT * 1000.0) - loc(X0, y - 0.5, ALT * 1000.0); up = p - MOON_C; up /= np.linalg.norm(up); fwd -= up * (fwd @ up); fwd /= np.linalg.norm(fwd)
    back = -fwd if E("FLIP", 1) else fwd                                       # the spacecraft flies either way round (it turns end for end twice a year); here its equipment deck trails
    R = np.stack([-up, np.cross(back, -up), back], 1); return p, R, up, fwd
HERE_P = np.zeros(3)
def place(tt):
    p, R, up, fwd = craft(tt); HERE_P[:] = p; moon.location = tuple(-p); root.location = (0.0, 0.0, 0.0); root.rotation_quaternion = Matrix(R.tolist()).to_quaternion(); LM.point(parts, R.T @ sd, R.T @ ed); return np.zeros(3), R, up, fwd

# ---------- the camera: beside and above the spacecraft, pulling back so the pole and Earth open up behind it
cd = bpy.data.cameras.new("cam"); cd.sensor_fit = "VERTICAL"; cd.sensor_height = 36; cd.lens = E("LENS", 60.0); cd.clip_start = 0.2; cd.clip_end = 1.0e9; cam = bpy.data.objects.new("cam", cd); scene.collection.objects.link(cam); scene.camera = cam; cam.rotation_mode = "QUATERNION"
ease = lambda x: x * x * (3 - 2 * x)
def aim(az, pitch, up, fwd):
    right = np.cross(fwd, up); a, p_ = math.radians(az), math.radians(pitch); return (fwd * math.cos(a) + right * math.sin(a)) * math.cos(p_) + up * math.sin(p_)
def set_cam_free(tt):
    """no spacecraft: the camera rides above the terrain, moving a little as hours pass"""
    p = loc(X0 + E("DX", 0.0) * (tt - 0.5), Y0 + E("DY", 0.0) * (tt - 0.5), (ALT + E("DALT", 0.0) * (tt - 0.5)) * 1000.0); HERE_P[:] = p; moon.location = tuple(-p); up = p - MOON_C; up /= np.linalg.norm(up)
    north = loc(X0, Y0 + 0.5, ALT * 1000.0) - loc(X0, Y0 - 0.5, ALT * 1000.0); north -= up * (north @ up); north /= np.linalg.norm(north)
    look = aim(E("AZ0", 180.0) + (E("AZ1", 180.0) - E("AZ0", 180.0)) * tt, E("PITCH0", -6.0) + (E("PITCH1", -6.0) - E("PITCH0", -6.0)) * tt, up, north); cam.location = (0.0, 0.0, 0.0)
    q = Vector(look).to_track_quat("-Z", "Y"); zc = q @ Vector((0, 1, 0)); roll = math.atan2(float(np.cross(np.array(zc), up) @ look), float(np.array(zc) @ up)); cam.rotation_quaternion = q @ Matrix.Rotation(-roll, 4, "Z").to_quaternion()
def set_cam(tt):
    set_sun(tt)
    if NOCRAFT: return set_cam_free(tt)
    p, R, up, fwd = place(tt); k = ease(tt); D = E("D0", 13.0) + (E("D1", 23.0) - E("D0", 13.0)) * k
    to_craft = aim(E("CAZ0", 13.0) + (E("CAZ1", 8.0) - E("CAZ0", 13.0)) * k, E("CPITCH0", -24.0) + (E("CPITCH1", -21.0) - E("CPITCH0", -24.0)) * k, up, fwd)     # where the spacecraft sits as seen from the camera
    look = aim(E("AZ0", 7.0) + (E("AZ1", 8.2) - E("AZ0", 7.0)) * k, E("PITCH0", -17.6) + (E("PITCH1", -16.6) - E("PITCH0", -17.6)) * k, up, fwd)
    pos = p + np.array([0.0, 0.0, 0.0]) - to_craft * D; cam.location = tuple(pos); q = Vector(look).to_track_quat("-Z", "Y"); zc = q @ Vector((0, 1, 0)); roll = math.atan2(float(np.cross(np.array(zc), up) @ look), float(np.array(zc) @ up))
    cam.rotation_quaternion = q @ Matrix.Rotation(-roll, 4, "Z").to_quaternion()            # the horizon stays level with the Moon under the spacecraft, not with the far-off site
LABELS = {"Shackleton crater": (7.69, -6.40), "Shackleton floor west": (2.2, -6.9), "Connecting Ridge": (CX, CY), "South Pole": (0.0, 0.0)}
def label_points():
    o = {}
    for name, (x, y) in LABELS.items():
        h = float(d5.cut(x - 0.03, x + 0.03, y - 0.03, y + 0.03)[0].max()) if abs(x - CX) < 5 and abs(y - CY) < 5 else float(d40.cut(x - 0.2, x + 0.2, y - 0.2, y + 0.2)[0].mean())
        v = world_to_camera_view(scene, cam, Vector(tuple(loc(x, y, h) - HERE_P))); o[name] = [round(v.x, 5), round(1 - v.y, 5), round(v.z, 1)]
    sv = world_to_camera_view(scene, cam, sdisk.location); o["_sun"] = [round(sv.x, 5), round(1 - sv.y, 5), round(sv.z, 1)]
    v = world_to_camera_view(scene, cam, root.location); o["_craft"] = [round(v.x, 5), round(1 - v.y, 5), round(v.z, 2)]; ve = world_to_camera_view(scene, cam, Vector(tuple(np.array(ed) * ED))); o["_earth"] = [round(ve.x, 5), round(1 - ve.y, 5)]; return o

# ---------- render
scene.render.engine = "CYCLES"; cy = scene.cycles; cy.device = "CPU"; cy.film_exposure = E("EXPO", 2.6); cy.samples = int(E("SPP", 96)); cy.use_adaptive_sampling = True; cy.adaptive_threshold = 0.01; cy.use_denoising = True
cy.max_bounces = 8; cy.diffuse_bounces = 3; cy.glossy_bounces = 5; cy.sample_clamp_indirect = 10.0; cy.caustics_reflective = False; cy.caustics_refractive = False; scene.render.use_persistent_data = True
sc = E("SCALE", 1.0); scene.render.resolution_x, scene.render.resolution_y = int(round(1080 * sc)), int(round(1920 * sc)); scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = "OPEN_EXR"; scene.render.image_settings.color_depth = "16"; scene.render.image_settings.exr_codec = "ZIP"; log("scene built")
os.makedirs(OUT, exist_ok=True)
for i in range(a_, b_ + 1):
    set_cam(i / max(nf - 1, 1)); bpy.context.view_layer.update(); json.dump(label_points(), open(f"{OUT}/labels_{i:04d}.json", "w"))
    if E("LABELS", 0): continue
    scene.render.filepath = f"{OUT}/f_{i:04d}.exr"; bpy.ops.render.render(write_still=True); log("frame", i)
