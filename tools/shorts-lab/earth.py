# Earth from orbit over the Coral Sea, looking north-west along the Great Barrier Reef coast.
# Surface: NASA GIBS true-colour imagery from VIIRS on NOAA-20 for one real day (public domain). Atmosphere is modelled.
import os, sys, math, time, numpy as np, bpy
from mathutils import Vector
DATA, OUT = sys.argv[1], sys.argv[2]; A, B, NF = int(sys.argv[3]), int(sys.argv[4]), int(sys.argv[5])
E = lambda k, d: float(os.environ.get(k, d)); t0 = time.time()
def log(*a): print(f"[{time.time()-t0:6.1f}s]", *a, flush=True)
R, ALT, FOV = 6371.0, E("ALT", 480), E("FOV", 48); LAT0, LON0, AZ = E("LAT", -20.5), E("LON", 153.5), E("AZ", 310); HFRAC = E("HFRAC", 0.86)
FAR = (117.0, 162.0, -42.75, 2.25); NEAR = (140.625, 159.75, -27.0, -7.875)
bpy.ops.wm.read_factory_settings(use_empty=True); scene = bpy.context.scene
def nvec(lat, lon):
    la, lo = np.radians(lat), np.radians(lon); return np.stack([np.cos(la) * np.cos(lo), np.cos(la) * np.sin(lo), np.sin(la)], -1)
def grid(name, step, radius, mat):
    lons = np.arange(FAR[0] + 0.02, FAR[1] - 0.02, step); lats = np.arange(FAR[2] + 0.02, FAR[3] - 0.02, step)
    LO, LA = np.meshgrid(lons, lats); P = (nvec(LA, LO) * radius).astype(np.float32); ny, nx = LO.shape
    me = bpy.data.meshes.new(name); me.vertices.add(ny * nx); me.vertices.foreach_set("co", P.reshape(-1))
    idx = np.arange(ny * nx, dtype=np.int32).reshape(ny, nx); q = np.stack([idx[:-1, :-1], idx[:-1, 1:], idx[1:, 1:], idx[1:, :-1]], -1).reshape(-1); nq = (ny - 1) * (nx - 1)
    me.loops.add(nq * 4); me.loops.foreach_set("vertex_index", q); me.polygons.add(nq); me.polygons.foreach_set("loop_start", np.arange(0, nq * 4, 4, dtype=np.int32))
    me.update(calc_edges=True); me.shade_smooth()
    ll = np.stack([LO, LA, np.zeros_like(LO)], -1).astype(np.float32); me.attributes.new("ll", "FLOAT_VECTOR", "POINT").data.foreach_set("vector", ll.reshape(-1))
    ob = bpy.data.objects.new(name, me); scene.collection.objects.link(ob); me.materials.append(mat); log(name, ny, nx); return ob
def helpers(nt):
    N = nt.nodes.new; L = nt.links.new
    def mth(op, a, b=None, clamp=False):
        n = N("ShaderNodeMath"); n.operation = op; n.use_clamp = clamp
        for i, v in enumerate((a, b)):
            if v is None: continue
            if isinstance(v, (int, float)): n.inputs[i].default_value = v
            else: L(v, n.inputs[i])
        return n.outputs[0]
    def cosview():
        g = N("ShaderNodeNewGeometry"); d = N("ShaderNodeVectorMath"); d.operation = "DOT_PRODUCT"; L(g.outputs["Incoming"], d.inputs[0]); L(g.outputs["Normal"], d.inputs[1])
        return mth("MAXIMUM", mth("ABSOLUTE", d.outputs["Value"]), 0.02)
    return N, L, mth, cosview
def surface_material():
    m = bpy.data.materials.new("surface"); m.use_nodes = True; nt = m.node_tree; nt.nodes.clear(); N, L, mth, cosview = helpers(nt)
    out = N("ShaderNodeOutputMaterial"); em = N("ShaderNodeEmission"); at = N("ShaderNodeAttribute"); at.attribute_name = "ll"
    def tex(path, b):
        mp = N("ShaderNodeMapping"); dl, dt = b[1] - b[0], b[3] - b[2]
        mp.inputs["Scale"].default_value = (1 / dl, 1 / dt, 1); mp.inputs["Location"].default_value = (-b[0] / dl, -b[2] / dt, 0); L(at.outputs["Vector"], mp.inputs["Vector"])
        t = N("ShaderNodeTexImage"); t.image = bpy.data.images.load(path); t.extension = "EXTEND"; t.interpolation = "Cubic"; L(mp.outputs["Vector"], t.inputs["Vector"]); return t, mp
    tf, _ = tex(f"{DATA}/far.png", FAR); tn, mpn = tex(f"{DATA}/near.png", NEAR)
    sx = N("ShaderNodeSeparateXYZ"); L(mpn.outputs["Vector"], sx.inputs[0])
    def edge(v):
        a = N("ShaderNodeMapRange"); a.interpolation_type = "SMOOTHSTEP"; a.inputs["From Min"].default_value = 0.0; a.inputs["From Max"].default_value = 0.03; L(v, a.inputs["Value"])
        b = N("ShaderNodeMapRange"); b.interpolation_type = "SMOOTHSTEP"; b.inputs["From Min"].default_value = 1.0; b.inputs["From Max"].default_value = 0.97; L(v, b.inputs["Value"])
        return mth("MULTIPLY", a.outputs["Result"], b.outputs["Result"])
    mask = mth("MULTIPLY", edge(sx.outputs["X"]), edge(sx.outputs["Y"]))
    mix = N("ShaderNodeMixRGB"); L(mask, mix.inputs["Fac"]); L(tf.outputs["Color"], mix.inputs["Color1"]); L(tn.outputs["Color"], mix.inputs["Color2"])
    c = cosview(); f = mth("SUBTRACT", 1.0, mth("EXPONENT", mth("MULTIPLY", mth("SUBTRACT", mth("DIVIDE", 1.0, c), 1.0), -E("HAZE", 0.05))))
    hz = N("ShaderNodeMixRGB"); L(f, hz.inputs["Fac"]); L(mix.outputs["Color"], hz.inputs["Color1"]); hz.inputs["Color2"].default_value = (0.40, 0.60, 0.95, 1)
    L(hz.outputs["Color"], em.inputs["Color"]); L(em.outputs[0], out.inputs["Surface"]); return m
def air_material(c_limb):
    m = bpy.data.materials.new("air"); m.use_nodes = True; nt = m.node_tree; nt.nodes.clear(); N, L, mth, cosview = helpers(nt)
    out = N("ShaderNodeOutputMaterial"); tr = N("ShaderNodeBsdfTransparent"); em = N("ShaderNodeEmission"); add = N("ShaderNodeAddShader"); c = cosview()
    g = mth("MINIMUM", mth("POWER", mth("DIVIDE", c, c_limb), E("AIRP", 1.6)), mth("MULTIPLY", mth("POWER", mth("DIVIDE", c_limb, c), 1.3), 1.0))
    em.inputs["Color"].default_value = (0.22, 0.48, 1.0, 1); L(mth("MULTIPLY", g, E("AIR", 0.85)), em.inputs["Strength"])
    L(tr.outputs[0], add.inputs[0]); L(em.outputs[0], add.inputs[1]); L(add.outputs[0], out.inputs["Surface"]); return m
grid("earth", E("STEP", 0.03), R, surface_material())
HA = E("HAIR", 75.0); shell = grid("air", 0.15, R + HA, air_material(math.sqrt(1 - (R / (R + HA)) ** 2)))
scene.world = bpy.data.worlds.new("w"); scene.world.use_nodes = True; scene.world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.0
cd = bpy.data.cameras.new("cam"); cd.sensor_fit = "VERTICAL"; cd.sensor_height = 36; cd.lens = 18 / math.tan(math.radians(FOV / 2)); cd.clip_start = 10; cd.clip_end = 1e5
cam = bpy.data.objects.new("cam", cd); scene.collection.objects.link(cam); scene.camera = cam
dip = math.degrees(math.acos(R / (R + ALT))); PITCH = dip + (HFRAC - 0.5) * FOV; log("dip", round(dip, 2), "pitch", round(PITCH, 2))
def set_cam(t):
    dkm = t * E("TRAVEL", 38.0); az = math.radians(AZ)
    lat = LAT0 + dkm * math.cos(az) / 111.19; lon = LON0 + dkm * math.sin(az) / (111.19 * math.cos(math.radians(LAT0)))
    up = nvec(lat, lon); north = nvec(lat + 0.01, lon) - up; north /= np.linalg.norm(north); east = np.cross(north, up)
    fwd = math.cos(az) * north + math.sin(az) * east; p = math.radians(PITCH); d = math.cos(p) * fwd - math.sin(p) * up
    cam.location = Vector(up * (R + ALT)); upc = up - up.dot(d) * d; upc /= np.linalg.norm(upc); right = np.cross(d, upc)
    from mathutils import Matrix
    M = Matrix((right, upc, -d)).transposed(); cam.rotation_mode = "QUATERNION"; cam.rotation_quaternion = M.to_quaternion()
scene.render.engine = "CYCLES"; cy = scene.cycles; cy.device = "CPU"; cy.samples = int(E("SPP", 24)); cy.use_denoising = False; cy.max_bounces = 2; cy.transparent_max_bounces = 4
cy.pixel_filter_type = "BLACKMAN_HARRIS"; scene.render.use_persistent_data = True
sc = E("SCALE", 1.0); scene.render.resolution_x, scene.render.resolution_y = int(1080 * sc), int(1920 * sc)
scene.view_settings.view_transform = "Standard"; scene.render.image_settings.file_format = "PNG"; scene.render.image_settings.color_depth = "16"
log("scene built")
for i in range(A, B + 1):
    set_cam(i / max(NF - 1, 1)); scene.render.filepath = f"{OUT}/f_{i:04d}.png"; bpy.ops.render.render(write_still=True); log("frame", i)
