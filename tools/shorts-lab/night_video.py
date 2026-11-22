# Surface shots for the Moon base video "The 354-hour night". Every shot stands on the summit of the Connecting Ridge near the
# Moon's south pole, in the week of 20-25 April 2026, when the real terrain hid the Sun from that spot for about 40 hours.
#
# Measured or published: the terrain (NASA LOLA elevation), where the Sun and Earth are and how Earth is turned and lit
# (JPL DE421 and the lunar orientation kernels), Earth's clouds (NASA GIBS, VIIRS, the same days), the stars (NASA SVS Deep
# Star Maps 2020), the habitat and suit designs (NASA prototypes, github.com/nasa/NASA-3D-Resources).
# Modelled by us: everything on the ground smaller than about 30 m, rocks, bootprints, where the habitat and people stand,
# every lamp, the camera and its exposure. The habitat is shown only under a line about what a base would need.
#
# usage: python night_video.py DATA OUT first last count      env: SHOT (1 to 7), EARTHK, SPP, SCALE, Q, and overrides AZ, PITCH, H, LENS, PAN, SPAN, UTC, EXPO
import os, sys, math, time, numpy as np, bpy, bmesh, cv2
from mathutils import Vector, Matrix
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import lunar_site as LS, terrain as TR
DATA, OUT = sys.argv[1], sys.argv[2]; ARGS = sys.argv[3:]; E = lambda k, d: float(os.environ.get(k, d)); t0 = time.time()
def log(*a): print(f"[{time.time()-t0:6.1f}s]", *a, flush=True)
CX, CY = -11.52, -12.44; Q = E("Q", 1.0); SHOT = int(E("SHOT", 2)); a_, b_, nf = (int(ARGS[0]), int(ARGS[1]), int(ARGS[2])) if ARGS else (0, 0, 1)
TOP, BASE = (0.0, 0.0), (-74.0, 14.0)                    # world metres from the summit: the summit itself; ground just west of it, in the hill's own shadow that week
SHOTS = {
    1: dict(utc=(2026, 4, 22, 9, 0), span=38.0, layout="base", people=False, pos=(-71.6, -39.9), az=1.5, pitch=-4.5, h=1.5, lens=40, dolly=(0.0, 0.0), pan=0.0, earth="2026-04-22", dur=4.5, expo=2.4e5),   # the dark spell at a habitat, 38 hours in one take: the stars slide past, Earth stays where it is
    2: dict(utc=(2026, 4, 22, 21, 0), span=0.0, layout="base", people=True, pos=(-70.0, -18.0), az=356.0, pitch=-11.0, h=1.6, lens=28, dolly=(0.25, 1.1), pan=-1.0, earth="2026-04-22", dur=5.4, expo=1.0e5),  # the same night at the habitat, real time
    3: dict(utc=(2026, 4, 22, 12, 0), span=12.0, layout="base", people=False, pos=(-71.6, -39.9), az=0.2, pitch=0.2, h=1.5, lens=70, dolly=(0.0, 0.0), pan=0.0, earth="2026-04-22", dur=6.6, expo=2.4e5),      # the same dark spell from closer: 30 hours, lit windows, the stars sliding behind
    4: dict(utc=(2026, 4, 21, 22, 0), span=14.0, layout="bare", people=False, pos=(-3.0, -8.0), az=5.0, pitch=-3.0, h=1.65, lens=50, dolly=(0.0, 0.0), pan=0.0, earth="2026-04-22", dur=3.2, expo=1.0e5),     # from the summit as that dark spell begins: the last sunlight leaves a far ridge
    6: dict(utc=(2026, 4, 22, 9, 0), span=38.0, layout="bare", people=False, pos=(-3.0, -8.0), az=4.0, pitch=7.0, h=1.65, lens=20, dolly=(0.0, 0.0), pan=0.0, earth="2026-04-22", dur=2.4, expo=2.4e5),       # the dark spell from the bare summit, wide: 38 hours of stars sliding over the ridge, Earth holding still
    7: dict(utc=(2026, 4, 21, 22, 0), span=10.0, layout="bare", people=False, pos=(-3.0, -8.0), az=5.5, pitch=-1.2, h=1.65, lens=85, dolly=(0.0, 0.0), pan=0.0, earth="2026-04-22", dur=3.5, expo=1.4e5),     # long lens on the far ridge as its last sunlight goes out
    8: dict(utc=(2026, 9, 7, 0, 0), span=0.0, layout="astro", people=True, pos=(-10.4, -144.0), az=1.2, pitch=3.3, h=0.5, lens=412, dolly=(0.6, 0.0), pan=0.0, earth="2026-09-07", dur=4.55, expo=4.3, tele=100.0, astro_base=(-9.9, -50.2)),   # long lens from 100 m down the slope: a person on the summit with Earth, 3.6 degrees up, behind them
    9: dict(utc=(2026, 3, 27, 17, 30), span=9.0, layout="bare", people=False, pos=(-3.0, -8.0), az=62.0, pitch=4.0, h=1.65, lens=24, dolly=(0.0, 0.0), pan=-50.0, earth="2026-03-27", dur=3.5, expo=4.3, expo_end=2.4e5, ramp=(0.38, 0.66)),   # night falls on the bare summit: the Sun slides behind the far ridges (it stayed gone 83 hours), the camera turns to Earth, the exposure opens until stars show
    5: dict(utc=(2026, 9, 6, 0, 0), span=0.0, layout="astro", people=True, pos=(-202.0, -56.0), az=9.0, pitch=-9.5, h=1.55, lens=32, dolly=(0.5, 0.35), pan=-1.2, earth="2026-09-06", dur=4.55, expo=4.3),     # the ridge in the sunny season, on the west slope that faces the low Sun: a person, real time
}
C = SHOTS[SHOT]; NIGHT = C["expo"] > 100 or "expo_end" in C; TELE = C.get("tele", 0.0)
for k in ("az", "pitch", "h", "lens", "pan", "span"): C[k] = E(k.upper(), C[k])
if os.environ.get("UTC"): C["utc"] = tuple(int(v) for v in os.environ["UTC"].split(","))
EXPO = E("EXPO", C["expo"])                # the camera's exposure, applied in the renderer so that night frames keep their precision
bpy.ops.wm.read_factory_settings(use_empty=True); scene = bpy.context.scene
d5 = LS.Dem(f"{DATA}/dem5.npz", 30336, 0.005); d40 = LS.Dem(f"{DATA}/dem40.npz", 15200, 0.04); d80 = LS.Dem(f"{DATA}/dem80.npz", 7600, 0.08)
h0 = float(TR.ndimage.gaussian_filter(d5.cut(CX - 0.1, CX + 0.1, CY - 0.1, CY + 0.1)[0], 3.0)[20, 20]); site = LS.Site(CX, CY, h0); G = TR.Ground(site, d5, A=800.0, yoff=0.0)

# ---------- the sky for any moment
from skyfield.api import Loader, PlanetaryConstants
from skyfield.framelib import itrs
load = Loader(f"{DATA}/spice"); eph = load("de421.bsp"); ts = load.timescale(builtin=True); pc = PlanetaryConstants()
pc.read_text(load("moon_080317.tf")); pc.read_text(load("pck00008.tpc")); pc.read_binary(load("moon_pa_de421_1900-2050.bpc")); fr = pc.build_frame_named("MOON_ME_DE421"); obs = eph["moon"] + pc.build_latlon_degrees(fr, site.lat, site.lon)
AM = np.array([[0, 1.0, 0], [1.0, 0, 0], [0, 0, -1.0]])
def sky_at(tt):
    u = C["utc"]; t = ts.utc(u[0], u[1], u[2], u[3] + u[4] / 60.0 + C["span"] * tt); o = {"t": t}; R = site.B @ AM @ np.array(fr.rotation_at(t))        # ICRF -> local
    for name in ("sun", "earth"):
        v = np.array(obs.at(t).observe(eph[name]).apparent().frame_xyz(fr).km); d = np.linalg.norm(v); o[name] = (site.B @ (AM @ (v / d)), d)
    o["earth_rot"] = R @ np.array(itrs.rotation_at(t)).T; o["icrf"] = R; return o
S0 = sky_at(0.0); log("shot", SHOT, S0["t"].utc_strftime("%Y-%m-%d %H:%M"), "sun alt %.2f az %.1f" % (math.degrees(math.asin(S0["sun"][0][2])), math.degrees(math.atan2(S0["sun"][0][0], S0["sun"][0][1])) % 360),
               "earth alt %.2f az %.1f" % (math.degrees(math.asin(S0["earth"][0][2])), math.degrees(math.atan2(S0["earth"][0][0], S0["earth"][0][1])) % 360))

# ---------- materials
def regolith():
    m = bpy.data.materials.new("regolith"); m.use_nodes = True; nt = m.node_tree; nt.nodes.clear(); N = nt.nodes.new; L = nt.links.new
    out = N("ShaderNodeOutputMaterial"); d = N("ShaderNodeBsdfDiffuse"); d.inputs["Roughness"].default_value = 1.0; geo = N("ShaderNodeNewGeometry")
    def noise(scale, detail, rough=0.6):
        n = N("ShaderNodeTexNoise"); n.inputs["Scale"].default_value = scale; n.inputs["Detail"].default_value = detail; n.inputs["Roughness"].default_value = rough; L(geo.outputs["Position"], n.inputs["Vector"]); return n
    def rng(x, lo, hi):
        r = N("ShaderNodeMapRange"); r.inputs["To Min"].default_value = lo; r.inputs["To Max"].default_value = hi; L(x.outputs["Fac"], r.inputs["Value"]); return r.outputs["Result"]
    def mul(p, q):
        r = N("ShaderNodeMath"); r.operation = "MULTIPLY"; L(p, r.inputs[0]); L(q, r.inputs[1]); return r.outputs[0]
    v = mul(mul(rng(noise(0.035, 6), 0.80, 1.20), rng(noise(0.9, 8), 0.88, 1.12)), rng(noise(40.0, 6, 0.7), 0.90, 1.10))
    col = N("ShaderNodeMixRGB"); col.blend_type = "MULTIPLY"; col.inputs["Fac"].default_value = 1; col.inputs["Color1"].default_value = (0.150, 0.140, 0.128, 1); L(v, col.inputs["Color2"]); L(col.outputs["Color"], d.inputs["Color"])
    bn = N("ShaderNodeTexNoise"); bn.inputs["Scale"].default_value = 260.0; bn.inputs["Detail"].default_value = 5; L(geo.outputs["Position"], bn.inputs["Vector"])
    bp = N("ShaderNodeBump"); bp.inputs["Strength"].default_value = 0.55; bp.inputs["Distance"].default_value = 0.004; L(bn.outputs["Fac"], bp.inputs["Height"]); L(bp.outputs["Normal"], d.inputs["Normal"]); L(d.outputs["BSDF"], out.inputs["Surface"]); return m
REG = regolith()
def add_grid(name, P, mask=None):
    ny, nx, _ = P.shape; me = bpy.data.meshes.new(name); me.vertices.add(ny * nx); me.vertices.foreach_set("co", np.ascontiguousarray(P, np.float32).reshape(-1))
    idx = np.arange(ny * nx, dtype=np.int32).reshape(ny, nx); q = np.stack([idx[:-1, :-1], idx[:-1, 1:], idx[1:, 1:], idx[1:, :-1]], -1).reshape(-1, 4)
    if mask is not None: q = q[~mask.reshape(-1)]
    nq = len(q); me.loops.add(nq * 4); me.loops.foreach_set("vertex_index", q.reshape(-1)); me.polygons.add(nq); me.polygons.foreach_set("loop_start", np.arange(0, nq * 4, 4, dtype=np.int32))
    me.update(calc_edges=True); me.shade_smooth(); me.materials.append(REG); scene.collection.objects.link(bpy.data.objects.new(name, me)); log(name, P.shape[:2], "faces", nq)

# ---------- people and things: where they stand (world metres), decided before the ground is made so it can carry their marks
ORG, TH = C["pos"], C["az"]; cT, sT = math.cos(math.radians(TH)), math.sin(math.radians(TH))
def to_grid(wx, wy): dx, dy = np.asarray(wx) - ORG[0], np.asarray(wy) - ORG[1]; return dx * cT - dy * sT, dx * sT + dy * cT
def to_world(u, v): return ORG[0] + u * cT + v * sT, ORG[1] - u * sT + v * cT
def smooth_path(ctrl, step=0.05):
    p = np.array(ctrl, np.float64)
    for _ in range(5): q = np.empty((2 * len(p) - 2, 2)); q[0::2] = 0.75 * p[:-1] + 0.25 * p[1:]; q[1::2] = 0.25 * p[:-1] + 0.75 * p[1:]; p = np.vstack([p[:1], q, p[-1:]])
    s = np.concatenate([[0], np.cumsum(np.hypot(*np.diff(p, axis=0).T))]); t = np.arange(0, s[-1], step); return np.stack([np.interp(t, s, p[:, 0]), np.interp(t, s, p[:, 1])], 1)
HAB = BASE; A1 = (HAB[0] + 3.3, HAB[1] - 25.6); A2 = (HAB[0] - 0.3, HAB[1] - 3.3)       # habitat; an astronaut near the camera; one at the hatch
P5 = C.get("astro_base", SHOTS[5]["pos"]); AS5 = (P5[0] + 1.9, P5[1] + 6.2)                           # the astronaut of shot 5, a few steps ahead of the camera
hx, hy = HAB
WALKS = {"base": [[(hx + 5.5, hy - 34.5), (hx + 4.6, hy - 30.0), (hx + 3.6, hy - 27.0), (hx + 3.3, hy - 26.0)], [(hx + 3.0, hy - 25.2), (hx + 1.6, hy - 16.0), (hx + 0.2, hy - 8.0), (hx - 0.2, hy - 4.0)], [(hx + 0.4, hy - 4.2), (hx + 2.5, hy - 13.0), (hx + 4.2, hy - 24.0)],
                  [(hx - 0.8, hy - 3.0), (hx - 3.4, hy - 3.8), (hx - 5.6, hy - 2.8)], [(hx + 0.3, hy - 3.6), (hx + 4.0, hy - 4.5), (hx + 7.5, hy - 2.8)]],
         "astro": [[(P5[0] - 2.8, P5[1] - 4.5), (P5[0] - 0.7, P5[1]), (P5[0] + 1.1, P5[1] + 3.9), (P5[0] + 1.8, P5[1] + 5.7)]], "bare": []}[C["layout"]]
prng = np.random.default_rng(11); PRINTS = []
for w in [smooth_path(c) for c in WALKS]:
    for k in range(int(len(w) * 0.05 / 0.52)):
        i = min(int((k * 0.52 + prng.uniform(-0.04, 0.04)) / 0.05), len(w) - 2); p = w[i]; f = w[min(i + 6, len(w) - 1)] - w[max(i - 6, 0)]; f = f / np.linalg.norm(f); side = 1 if k % 2 else -1
        PRINTS.append((p[0] - side * 0.13 * f[1], p[1] + side * 0.13 * f[0], math.atan2(f[1], f[0]) + side * 0.12 + prng.normal(0, 0.10)))
def marks(H, u0, v0, res):
    if res > 0.12 or not PRINTS: return H
    ny, nx = H.shape; bp = np.zeros((ny, nx), np.uint8); rib = np.zeros((ny, nx), np.uint8); P = lambda a: tuple(int(round(v)) for v in ((a[0] - u0) / res * 16, (a[1] - v0) / res * 16))
    for (x, y, a) in PRINTS:
        gu, gv = to_grid(x, y); fu, fv = math.cos(a) * cT - math.sin(a) * sT, math.cos(a) * sT + math.sin(a) * cT           # heading in the patch's axes
        if not (u0 < gu < u0 + nx * res and v0 < gv < v0 + ny * res): continue
        cv2.ellipse(bp, P((gu, gv)), (int(0.17 / res * 16), int(0.075 / res * 16)), math.degrees(math.atan2(fv, fu)), 0, 360, 255, -1, cv2.LINE_AA, 4)
        if res <= 0.025:
            for k in range(-3, 4):
                q = (gu + fu * k * 0.045, gv + fv * k * 0.045); cv2.line(rib, P((q[0] + 0.06 * fv, q[1] - 0.06 * fu)), P((q[0] - 0.06 * fv, q[1] + 0.06 * fu)), 255, max(1, int(round(0.018 / res))), cv2.LINE_AA, 4)
    b = cv2.GaussianBlur(bp.astype(np.float32) / 255, (0, 0), max(0.012 / res, 0.6)); Z = -0.018 * b
    if res <= 0.025: Z = Z + 0.007 * cv2.GaussianBlur(rib.astype(np.float32) / 255, (0, 0), 0.7) * b
    Hlp = cv2.GaussianBlur(H, (0, 0), max(0.25 / res, 1.0)); return (Hlp + (H - Hlp) * (1 - np.clip(0.9 * b, 0, 0.95)) + Z).astype(np.float32)
G.extra.append(marks)
def keep(x, y, D):                                         # things stand on a patch chosen for being clear of big craters
    k = np.ones(len(x), bool)
    for (px, py, rr, dmax) in ((HAB[0] + 1, HAB[1], 10.0, 1.2), (A1[0], A1[1], 4.0, 0.7), (AS5[0], AS5[1], 5.0, 0.7), (ORG[0] + 5 * sT, ORG[1] + 5 * cT, 9.0, 0.9)): k &= ~((np.hypot(x - px, y - py) < rr) & (D > dmax))
    return k
G.keep = keep

# ---------- ground: three modelled levels boxed around the camera, real terrain beyond
LEV = [("g0", -7.0, 7.0, -1.5, 14.5, 0.01 / Q), ("g1", -40.0, 40.0, -10.0, 70.0, 0.05 / Q), ("g2", -240.0, 240.0, -60.0, 420.0, 0.30 / Q)]; HG = {}; HOLES = {"g1": ["g0"], "g2": ["g1"]}
if TELE:                                                   # a long lens looks at ground far from the camera: fine ground where the person stands, mid detail all the way there
    LEV = [("g0", -2.0, 2.0, -1.0, 3.0, 0.02 / Q), ("ga", -5.0, 5.0, TELE - 5.0, TELE + 9.0, 0.015 / Q), ("g1", -22.0, 22.0, -6.0, TELE + 30.0, 0.05 / Q), ("g2", -240.0, 240.0, -60.0, 420.0, 0.30 / Q)]; HOLES = {"g1": ["g0", "ga"], "g2": ["g1"]}
BOX = {n_: (a, b, c_, d) for (n_, a, b, c_, d, r_) in LEV}
for i, (name, u0, u1, v0, v1, res) in enumerate(LEV):
    MX, MY, H, nc = G.grid(u0, u1, v0, v1, res, ORG, TH); HG[name] = (u0, v0, res, H); P = G.to_local(MX, MY, H); mask = None
    for hn in HOLES.get(name, []):
        a0, a1, b0, b1 = BOX[hn]; gu, gv = to_grid(MX, MY); uc = (gu[:-1, :-1] + gu[1:, 1:]) / 2; vc = (gv[:-1, :-1] + gv[1:, 1:]) / 2; mk = (uc > a0 + res) & (uc < a1 - res) & (vc > b0 + res) & (vc < b1 - res); mask = mk if mask is None else (mask | mk)
    add_grid(name, P, mask); del MX, MY, P
def far(name, dem, half, k, sigma, inner):
    X, Y, P = TR.far_grid(site, dem, CX - half, CX + half, CY - half, CY + half, k, sigma) if half < 290 else TR.far_grid(site, dem, -300, 300, -300, 300, k, sigma)
    wx, wy = (X - CX) * 1000, (Y - CY) * 1000; xc = (wx[:-1, :-1] + wx[1:, 1:]) / 2; yc = (wy[:-1, :-1] + wy[1:, 1:]) / 2
    if inner == "g2": gu, gv = to_grid(xc, yc); mask = (gu > -240 + 6) & (gu < 240 - 6) & (gv > -60 + 6) & (gv < 420 - 6)
    else: mask = (np.abs(xc) < inner * 1000 - 60) & (np.abs(yc) < inner * 1000 - 60)
    add_grid(name, P, mask)
far("r5", d5, 3.0, 1, 2.0, "g2"); far("r40", d40, 32.5, 1, 0.8, 3.0); far("r480", d80, 300, 6, 0, 32.5)
def ground(wx, wy):
    gu, gv = to_grid(wx, wy)
    for name in ("g0", "ga", "g1", "g2"):
        if name not in HG: continue
        u0, v0, res, H = HG[name]; fi, fj = (gu - u0) / res, (gv - v0) / res
        if 1 <= fi < H.shape[1] - 2 and 1 <= fj < H.shape[0] - 2:
            i, j = int(fi), int(fj); a, b = fi - i, fj - j; h = (H[j, i] * (1 - a) + H[j, i + 1] * a) * (1 - b) + (H[j + 1, i] * (1 - a) + H[j + 1, i + 1] * a) * b
            return G.to_local(np.array([[wx]]), np.array([[wy]]), np.array([[h]]))[0, 0]
    raise ValueError("outside the detailed ground")

# ---------- Sun, Earth and stars where they really are
SUNE = 10.0; sl = bpy.data.lights.new("sun", "SUN"); sl.energy = SUNE; sun = bpy.data.objects.new("sun", sl); scene.collection.objects.link(sun); sun.rotation_mode = "QUATERNION"
el = bpy.data.lights.new("earthlight", "SUN"); el.color = (0.72, 0.84, 1.0); elo = bpy.data.objects.new("earthlight", el); scene.collection.objects.link(elo); elo.rotation_mode = "QUATERNION"
bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=4, radius=1.0); sdisk = bpy.context.object; sdisk.name = "sun_disk"                 # the Sun itself, so a sunset has a Sun in it; it lights nothing (the lamp does)
sm = bpy.data.materials.new("sun_disk"); sm.use_nodes = True; nt = sm.node_tree; nt.nodes.clear(); o_ = nt.nodes.new("ShaderNodeOutputMaterial"); e_ = nt.nodes.new("ShaderNodeEmission"); e_.inputs["Color"].default_value = (1.0, 0.96, 0.9, 1); nt.links.new(e_.outputs[0], o_.inputs[0])
sdisk.data.materials.append(sm); sdisk.visible_diffuse = sdisk.visible_glossy = sdisk.visible_transmission = sdisk.visible_volume_scatter = sdisk.visible_shadow = False
ED = 2.0e6; nlat, nlon = (361, 721) if TELE else (181, 361); la = np.radians(np.linspace(-90, 90, nlat)); lo = np.radians(np.linspace(-180, 180, nlon)); LO, LA = np.meshgrid(lo, la); SPH = np.stack([np.cos(LA) * np.cos(LO), np.cos(LA) * np.sin(LO), np.sin(LA)], -1)
eme = bpy.data.meshes.new("earth"); eme.vertices.add(nlat * nlon); idx = np.arange(nlat * nlon, dtype=np.int32).reshape(nlat, nlon); q = np.stack([idx[:-1, :-1], idx[:-1, 1:], idx[1:, 1:], idx[1:, :-1]], -1).reshape(-1); nq = (nlat - 1) * (nlon - 1)
eme.loops.add(nq * 4); eme.loops.foreach_set("vertex_index", q); eme.polygons.add(nq); eme.polygons.foreach_set("loop_start", np.arange(0, nq * 4, 4, dtype=np.int32)); eme.update(calc_edges=True); eme.shade_smooth()
eme.uv_layers.new(name="uv").data.foreach_set("uv", np.stack([(LO / (2 * np.pi) + 0.5), (LA / np.pi + 0.5)], -1).reshape(-1, 2)[q].astype(np.float32).reshape(-1))
em = bpy.data.materials.new("earth"); em.use_nodes = True; nt = em.node_tree; nt.nodes.clear(); o_ = nt.nodes.new("ShaderNodeOutputMaterial"); d_ = nt.nodes.new("ShaderNodeBsdfDiffuse"); tx = nt.nodes.new("ShaderNodeTexImage")
epx = f"{DATA}/earthglobal/earthx_{C['earth']}.png"; tx.image = bpy.data.images.load(epx if os.path.exists(epx) else f"{DATA}/earthglobal/earth_{C['earth']}.png"); tx.extension = "EXTEND"; tx.interpolation = "Cubic"; nt.links.new(d_.outputs["BSDF"], o_.inputs["Surface"]); eme.materials.append(em)
nt.links.new(tx.outputs["Color"], d_.inputs["Color"]); EARTHK = E("EARTHK", 3.0e-6 if "expo_end" in C else 1.0); EDOT = None
if TELE:                                                   # seen large through the long lens, Earth gets the thin blue edge of its air (as in the orbital scenes)
    air = nt.nodes.new("ShaderNodeEmission"); air.inputs["Color"].default_value = (0.32, 0.52, 1.0, 1); lw = nt.nodes.new("ShaderNodeLayerWeight"); lw.inputs["Blend"].default_value = 0.12; add = nt.nodes.new("ShaderNodeAddShader")
    dotn = nt.nodes.new("ShaderNodeVectorMath"); dotn.operation = "DOT_PRODUCT"; gn = nt.nodes.new("ShaderNodeNewGeometry"); dotn.inputs[1].default_value = tuple(float(v) for v in S0["sun"][0]); nt.links.new(gn.outputs["Normal"], dotn.inputs[0])
    lit = nt.nodes.new("ShaderNodeMapRange"); lit.inputs["From Min"].default_value = -0.05; lit.inputs["From Max"].default_value = 0.25; nt.links.new(dotn.outputs["Value"], lit.inputs["Value"]); mul = nt.nodes.new("ShaderNodeMath"); mul.operation = "MULTIPLY"; nt.links.new(lw.outputs["Facing"], mul.inputs[0]); nt.links.new(lit.outputs["Result"], mul.inputs[1])
    sc_ = nt.nodes.new("ShaderNodeMath"); sc_.operation = "MULTIPLY"; sc_.inputs[1].default_value = 0.55 * 10.0 / math.pi; nt.links.new(mul.outputs[0], sc_.inputs[0]); nt.links.new(sc_.outputs[0], air.inputs["Strength"]); nt.links.new(d_.outputs["BSDF"], add.inputs[0]); nt.links.new(air.outputs[0], add.inputs[1]); nt.links.new(add.outputs[0], o_.inputs["Surface"])
if EARTHK < 1.0:                                           # held back: the picture of Earth gives off its own light, shaded by where the Sun is, so the sampler has nothing faint to lose
    em_ = nt.nodes.new("ShaderNodeEmission"); gn_ = nt.nodes.new("ShaderNodeNewGeometry"); EDOT = nt.nodes.new("ShaderNodeVectorMath"); EDOT.operation = "DOT_PRODUCT"; nt.links.new(gn_.outputs["Normal"], EDOT.inputs[0])
    cl_ = nt.nodes.new("ShaderNodeClamp"); nt.links.new(EDOT.outputs["Value"], cl_.inputs["Value"]); ml_ = nt.nodes.new("ShaderNodeMath"); ml_.operation = "MULTIPLY"; ml_.inputs[1].default_value = SUNE / math.pi * EARTHK; nt.links.new(cl_.outputs["Result"], ml_.inputs[0])
    nt.links.new(tx.outputs["Color"], em_.inputs["Color"]); nt.links.new(ml_.outputs[0], em_.inputs["Strength"]); nt.links.new(em_.outputs[0], o_.inputs["Surface"])
# EARTHK below 1 holds Earth back in night shots. One exposure for earthlit ground would record Earth as a white disc; the owner asked for an Earth that reads as Earth, so it is shown as an eye or a second exposure would see it.
eob = bpy.data.objects.new("earth", eme); scene.collection.objects.link(eob); eob.visible_shadow = False
if EARTHK < 1.0: eob.visible_diffuse = eob.visible_glossy = False
w = bpy.data.worlds.new("space"); scene.world = w; w.use_nodes = True; wn = w.node_tree; bg = wn.nodes["Background"]; star = wn.nodes.new("ShaderNodeTexEnvironment"); star.image = bpy.data.images.load(f"{DATA}/starmap_2020_8k.exr")
geo_ = wn.nodes.new("ShaderNodeNewGeometry"); cmb = wn.nodes.new("ShaderNodeCombineXYZ"); DOTS = []
for k in range(3):
    dn = wn.nodes.new("ShaderNodeVectorMath"); dn.operation = "DOT_PRODUCT"; wn.links.new(geo_.outputs["Incoming"], dn.inputs[0]); wn.links.new(dn.outputs["Value"], cmb.inputs[k]); DOTS.append(dn)
wn.links.new(cmb.outputs[0], star.inputs["Vector"]); wn.links.new(star.outputs["Color"], bg.inputs["Color"]); bg.inputs["Strength"].default_value = E("STARS", 2.4e-6)       # far too faint to show beside sunlit ground, as in a real exposure
def set_sky(tt):
    s = sky_at(tt); sd, sdist = s["sun"]; ed, edist = s["earth"]; ang = math.asin(695700.0 / sdist); sl.angle = 2 * ang; sun.rotation_quaternion = Vector(sd).to_track_quat("Z", "Y")
    sdisk.location = Vector(sd) * 1.0e6; sdisk.scale = (1.0e6 * math.tan(ang),) * 3; e_.inputs["Strength"].default_value = SUNE / (math.pi * ang * ang)
    sep = math.acos(float(np.clip(np.dot(sd, ed), -1, 1))); el.energy = SUNE * 1.0e-4 * (1 - math.cos(sep)) / 2 * E("EARTHLIGHT", 1.0); el.angle = 2 * math.asin(6371.0 / edist); elo.rotation_quaternion = Vector(ed).to_track_quat("Z", "Y")
    eme.vertices.foreach_set("co", (SPH @ s["earth_rot"].T * (6371.0 / edist * ED) + np.array(ed) * ED).astype(np.float32).reshape(-1)); eme.update()
    if EDOT is not None: EDOT.inputs[1].default_value = tuple(float(v) for v in sd)
    M = np.diag([-1.0, -1.0, 1.0]) @ s["icrf"].T              # local direction -> the star map's own axes
    for k in range(3): DOTS[k].inputs[1].default_value = tuple(-M[k])     # "Incoming" points back toward the camera
    return s

# ---------- props
MOD = f"{DATA}/models_plain"
def load_model(name, scale=1.0):
    before = set(scene.objects); bpy.ops.import_scene.gltf(filepath=f"{MOD}/{name}.glb"); new = [o for o in scene.objects if o not in before]
    ob = [o for o in new if o.type == "MESH"][0]; M = Matrix.Scale(scale, 4) @ ob.matrix_world.copy(); ob.parent = None; ob.data.transform(M); ob.matrix_world = Matrix.Identity(4)
    for o in new:
        if o is not ob: bpy.data.objects.remove(o)
    ob.name = name; return ob
def upright(wx, wy, yaw_deg, dz=0.0): c = ground(wx, wy); return Matrix.Translation(Vector((c[0], c[1], c[2] + dz))) @ Matrix.Rotation(math.radians(yaw_deg), 4, "Z")
def weather(ob, z0, z1, amount=0.8, tone=0.86):
    for m in ob.data.materials:
        if not m or not m.use_nodes: continue
        nt = m.node_tree; b = next((n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"), None)
        if b is None: continue
        N, L = nt.nodes.new, nt.links.new; tc = N("ShaderNodeTexCoord"); sep = N("ShaderNodeSeparateXYZ"); L(tc.outputs["Object"], sep.inputs[0])
        mr = N("ShaderNodeMapRange"); mr.inputs["From Min"].default_value = z0; mr.inputs["From Max"].default_value = z1; mr.inputs["To Min"].default_value = 1.0; mr.inputs["To Max"].default_value = 0.0; L(sep.outputs["Z"], mr.inputs["Value"])
        def noise(scale, lo, hi):
            n = N("ShaderNodeTexNoise"); n.inputs["Scale"].default_value = scale; n.inputs["Detail"].default_value = 8; L(tc.outputs["Object"], n.inputs["Vector"])
            r = N("ShaderNodeMapRange"); r.inputs["From Min"].default_value = 0.3; r.inputs["From Max"].default_value = 0.7; r.inputs["To Min"].default_value = lo; r.inputs["To Max"].default_value = hi; L(n.outputs["Fac"], r.inputs["Value"]); return r.outputs["Result"]
        def mth(op, a, c):
            n = N("ShaderNodeMath"); n.operation = op; n.use_clamp = True
            for i, v in enumerate((a, c)):
                if isinstance(v, (int, float)): n.inputs[i].default_value = v
                else: L(v, n.inputs[i])
            return n.outputs[0]
        fac = mth("ADD", mth("MULTIPLY", mth("MULTIPLY", mr.outputs["Result"], noise(5.0, 0.35, 1.25)), amount), mth("MULTIPLY", noise(28.0, 0.0, 1.0), 0.16))
        mix = N("ShaderNodeMixRGB"); mix.inputs["Color2"].default_value = (0.165, 0.155, 0.14, 1); L(fac, mix.inputs["Fac"]); tn = N("ShaderNodeMixRGB"); tn.blend_type = "MULTIPLY"; tn.inputs["Fac"].default_value = 1.0; tn.inputs["Color2"].default_value = (tone, tone, tone * 0.985, 1)
        bc = b.inputs["Base Color"]
        if bc.links: L(bc.links[0].from_socket, tn.inputs["Color1"])
        else: tn.inputs["Color1"].default_value = bc.default_value[:]
        L(tn.outputs["Color"], mix.inputs["Color1"]); L(mix.outputs["Color"], bc); ro = b.inputs["Roughness"]; base_r = ro.links[0].from_socket if ro.links else float(ro.default_value); L(mth("MAXIMUM", base_r, mth("ADD", mth("MULTIPLY", fac, 0.5), 0.42)), ro)
def arm_rig(me, side):
    from scipy.sparse import coo_matrix; from scipy.sparse.csgraph import connected_components; from scipy.spatial import cKDTree
    n = len(me.vertices); co = np.empty(n * 3, np.float32); me.vertices.foreach_get("co", co); co = co.reshape(-1, 3); Sh = np.array([side * 0.29, -0.02, 1.43], np.float32); a = np.array([0, -0.77, -0.63], np.float32); d = (co - Sh) @ a
    perp = np.linalg.norm((co - Sh) - d[:, None] * a, axis=1); ok = (d > -0.02) & (co[:, 0] * side > 0.05) & (perp < 0.17); cand = np.where(ok)[0]; weld = cand[cKDTree(co[cand]).query_pairs(0.0006, output_type="ndarray")]
    ed = np.empty(len(me.edges) * 2, np.int32); me.edges.foreach_get("vertices", ed); ed = ed.reshape(-1, 2); ed = np.vstack([ed[ok[ed[:, 0]] & ok[ed[:, 1]]], weld.reshape(-1, 2)])
    nc, lab = connected_components(coo_matrix((np.ones(len(ed)), (ed[:, 0], ed[:, 1])), shape=(n, n)), directed=False); seed = cand[np.argmin(co[cand, 1])]; idx = np.where((lab == lab[seed]) & ok)[0]
    t = np.clip((d[idx] + 0.02) / 0.12, 0, 1); return idx, (t * t * (3 - 2 * t)).astype(np.float32), Sh
def pose_arm(co, co0, rig, phi):
    idx, wgt, Sh = rig; y, z = co0[idx, 1] - Sh[1], co0[idx, 2] - Sh[2]; c, s_ = math.cos(phi), math.sin(phi)
    co[idx, 1] = co0[idx, 1] + wgt * (Sh[1] + y * c - z * s_ - co0[idx, 1]); co[idx, 2] = co0[idx, 2] + wgt * (Sh[2] + y * s_ + z * c - co0[idx, 2])
def spot(name, power, cone, parent, loc, aim, color=(1.0, 0.93, 0.82), blend=0.6, size=0.05):
    l = bpy.data.lights.new(name, "SPOT"); l.energy = power; l.spot_size = math.radians(cone); l.spot_blend = blend; l.shadow_soft_size = size; l.color = color
    o = bpy.data.objects.new(name, l); scene.collection.objects.link(o); o.parent = parent; o.location = loc; o.rotation_mode = "QUATERNION"; o.rotation_quaternion = Vector(aim).normalized().to_track_quat("-Z", "Y"); return o
def glow(name, parent, loc, size, strength, color=(1.0, 0.78, 0.5), normal=(0, -1, 0)):
    """a lit window: a small light-giving panel just proud of the wall"""
    me = bpy.data.meshes.new(name); sx, sz = size[0] / 2, size[1] / 2; me.from_pydata([(-sx, 0, -sz), (sx, 0, -sz), (sx, 0, sz), (-sx, 0, sz)], [], [(0, 1, 2, 3)]); me.update()
    m = bpy.data.materials.new(name); m.use_nodes = True; nt = m.node_tree; nt.nodes.clear(); o = nt.nodes.new("ShaderNodeOutputMaterial"); e = nt.nodes.new("ShaderNodeEmission"); e.inputs["Color"].default_value = (*color, 1); e.inputs["Strength"].default_value = strength; nt.links.new(e.outputs[0], o.inputs[0])
    me.materials.append(m); ob = bpy.data.objects.new(name, me); scene.collection.objects.link(ob); ob.parent = parent; ob.location = loc; ob.rotation_mode = "QUATERNION"; ob.rotation_quaternion = Vector((0, -1, 0)).rotation_difference(Vector(normal)); return ob, e
STATE = {}
def suit():
    a = load_model("z2"); me = a.data; bm = bmesh.new(); bm.from_mesh(me); bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.0002); bm.to_mesh(me); bm.free()
    if "custom_normal" in me.attributes: me.attributes.remove(me.attributes["custom_normal"])
    me.set_sharp_from_angle(angle=math.radians(60)); me.shade_smooth(); me.update(); weather(a, 0.0, 1.05, 0.55, 0.92); return a
def build_props():
    L_ = E("LAMPS", 0.25)
    if C["layout"] == "base":
        hdu = load_model("hdu1", 0.0254); weather(hdu, 0.29, 2.3, 0.7); hdu.matrix_world = upright(HAB[0], HAB[1], 8.0, -0.34)
        glow("hatch_window", hdu, (0.02, -2.16, 1.78), (0.34, 0.5), 7.0e-4 * L_); glow("port", hdu, (0.33, -2.05, 4.05), (0.36, 0.36), 6.0e-4 * L_); glow("airlock_window", hdu, (-2.95, -1.08, 1.6), (0.3, 0.42), 5.0e-4 * L_)
        spot("porch", 0.16 * L_, 120, hdu, (0.0, -2.7, 3.15), (0, -0.5, -1)); spot("yard", 0.30 * L_, 95, hdu, (1.6, -2.3, 4.6), (0.25, -1, -0.62), (0.95, 0.97, 1.0)); spot("airlock_lamp", 0.05 * L_, 110, hdu, (-3.0, -1.6, 2.5), (-0.2, -0.6, -1))
        bpy.ops.mesh.primitive_uv_sphere_add(segments=16, ring_count=8, radius=0.07); b = bpy.context.object; bm_ = bpy.data.materials.new("beacon"); bm_.use_nodes = True; nt = bm_.node_tree; nt.nodes.clear(); o = nt.nodes.new("ShaderNodeOutputMaterial"); e = nt.nodes.new("ShaderNodeEmission")
        e.inputs["Color"].default_value = (1.0, 0.42, 0.06, 1); nt.links.new(e.outputs[0], o.inputs[0]); b.data.materials.append(bm_); b.parent = hdu; b.location = (0.0, 0.05, 5.92); STATE["beacon"] = e
        STATE["beacon_lamp"] = spot("beacon_lamp", 0.0, 150, hdu, (0.0, 0.05, 6.1), (0, -0.3, -1), (1.0, 0.45, 0.1), 0.9, 0.2)
        if C["people"]:
            a1 = suit(); me = a1.data; n = len(me.vertices); co0 = np.empty(n * 3, np.float32); me.vertices.foreach_get("co", co0); co0 = co0.reshape(-1, 3).copy(); rr, rl = arm_rig(me, -1), arm_rig(me, 1)
            a2 = a1.copy(); a2.data = me.copy(); scene.collection.objects.link(a2); a2.matrix_world = upright(A2[0], A2[1], 180 + 20, -0.035); c2 = co0.copy(); pose_arm(c2, co0, rl, math.radians(-36)); pose_arm(c2, co0, rr, math.radians(-10)); a2.data.vertices.foreach_set("co", c2.reshape(-1)); a2.data.update()
            STATE.update(a1=a1, co0=co0, rr=rr, rl=rl, a1pos=A1, a1yaw=180 - 8.0); STATE["helmet"] = spot("helmet", 0.022 * L_, 62, a1, (0.12, -0.24, 1.84), (0.02, -1, -0.5), (0.95, 0.97, 1.0), 0.95); spot("helmet2", 0.012 * L_, 58, a2, (0.12, -0.24, 1.84), (0.02, -1, -0.55), (0.95, 0.97, 1.0))
    if C["layout"] == "astro":
        a1 = suit(); me = a1.data; n = len(me.vertices); co0 = np.empty(n * 3, np.float32); me.vertices.foreach_get("co", co0); co0 = co0.reshape(-1, 3).copy(); STATE.update(a1=a1, co0=co0, rr=arm_rig(me, -1), rl=arm_rig(me, 1), a1pos=AS5, a1yaw=180 + 6.0)
    # rocks: in the 80 m box around the camera, plus pebbles close to it
    rmat = bpy.data.materials.new("rock"); rmat.use_nodes = True; nt = rmat.node_tree; nt.nodes.clear(); N = nt.nodes.new; L = nt.links.new
    out = N("ShaderNodeOutputMaterial"); d = N("ShaderNodeBsdfDiffuse"); d.inputs["Roughness"].default_value = 1.0; oi = N("ShaderNodeObjectInfo"); mr = N("ShaderNodeMapRange"); mr.inputs["To Min"].default_value = 0.13; mr.inputs["To Max"].default_value = 0.30; L(oi.outputs["Random"], mr.inputs["Value"])
    tc = N("ShaderNodeTexCoord"); nz = N("ShaderNodeTexNoise"); nz.inputs["Scale"].default_value = 9.0; nz.inputs["Detail"].default_value = 8; L(tc.outputs["Object"], nz.inputs["Vector"]); m2 = N("ShaderNodeMapRange"); m2.inputs["To Min"].default_value = 0.72; m2.inputs["To Max"].default_value = 1.25; L(nz.outputs["Fac"], m2.inputs["Value"])
    mu = N("ShaderNodeMath"); mu.operation = "MULTIPLY"; L(mr.outputs["Result"], mu.inputs[0]); L(m2.outputs["Result"], mu.inputs[1]); L(mu.outputs[0], d.inputs["Color"])
    n2 = N("ShaderNodeTexNoise"); n2.inputs["Scale"].default_value = 30.0; n2.inputs["Detail"].default_value = 6; L(tc.outputs["Object"], n2.inputs["Vector"]); bp = N("ShaderNodeBump"); bp.inputs["Strength"].default_value = 0.6; bp.inputs["Distance"].default_value = 0.05; L(n2.outputs["Fac"], bp.inputs["Height"]); L(bp.outputs["Normal"], d.inputs["Normal"]); L(d.outputs["BSDF"], out.inputs["Surface"])
    def rock(seed, sub):
        bm = bmesh.new(); bmesh.ops.create_icosphere(bm, subdivisions=sub, radius=1.0); me = bpy.data.meshes.new(f"rock{seed}"); bm.to_mesh(me); bm.free(); r = np.random.default_rng(seed)
        co = np.empty(len(me.vertices) * 3, np.float32); me.vertices.foreach_get("co", co); co = co.reshape(-1, 3); dsp = np.ones(len(co))
        for k in range(9): a = r.normal(size=3); a /= np.linalg.norm(a); dsp -= r.uniform(0.05, 0.34) * np.clip(co @ a - r.uniform(0.25, 0.7), 0, 1) ** 0.6
        for k in range(24): a = r.normal(size=3) * r.uniform(2, 7); dsp += 0.022 * np.sin(co @ a + r.uniform(0, 6.28))
        co = co * dsp[:, None] * r.uniform(0.55, 1.0, 3); me.vertices.foreach_set("co", co.astype(np.float32).reshape(-1)); me.update(); me.shade_smooth(); me.materials.append(rmat); return me
    base = [rock(100 + k, 4) for k in range(14)]; rr_ = np.random.default_rng(abs(1000 + int(ORG[0]) * 7 + int(ORG[1])))
    def clear(x, y, s):
        for (px, py, r0) in ((HAB[0] + 1, HAB[1], 8.0), (A1[0], A1[1], 0.9), (A2[0], A2[1], 0.9), (AS5[0], AS5[1], 0.9), (ORG[0], ORG[1], 1.2)):
            if math.hypot(x - px, y - py) < r0 + s: return False
        return not PRINTS or min(math.hypot(x - p[0], y - p[1]) for p in PRINTS) > 0.35 + s
    def scatter(u0, u1, v0, v1, smin, smax, coef, expo, tag):
        A_ = (u1 - u0) * (v1 - v0); n = rr_.poisson(coef * (smin ** -expo - smax ** -expo) * A_); k = 0
        for _ in range(n):
            s = (smin ** -expo - rr_.random() * (smin ** -expo - smax ** -expo)) ** (-1 / expo); wx, wy = to_world(rr_.uniform(u0, u1), rr_.uniform(v0, v1))
            if not clear(wx, wy, s): continue
            try: c = ground(wx, wy)
            except ValueError: continue
            o = bpy.data.objects.new(f"{tag}{k}", base[rr_.integers(len(base))]); scene.collection.objects.link(o); o.rotation_euler = tuple(rr_.uniform(0, 6.28, 3)); o.scale = (s / 2,) * 3; o.location = (c[0], c[1], c[2] - s * rr_.uniform(0.05, 0.22)); k += 1
        return k
    if TELE: nr = scatter(-20, 20, -5, TELE + 28, 0.10, 1.3, 0.0006, 2.3, "rock") + scatter(-8, 8, 12, TELE + 14, 0.035, 0.30, 0.0009, 2.3, "stone"); nb = scatter(-200, 200, TELE + 30, 400, 0.6, 3.0, 0.0006, 2.3, "boulder")      # the long lens shows the strip of ground up to the person; it gets the small stones the near ground has
    else: nr = scatter(-40, 40, -10, 70, 0.10, 1.3, 0.0006, 2.3, "rock"); nb = scatter(-200, 200, 70, 400, 0.6, 3.0, 0.0006, 2.3, "boulder")
    lo = rock(300, 1); pcv = np.empty(len(lo.vertices) * 3, np.float32); lo.vertices.foreach_get("co", pcv); pcv = pcv.reshape(-1, 3); pf = np.array([list(p.vertices) for p in lo.polygons], np.int32); V, F = [], []
    for _ in range(int(E("PEBBLES", 2400))):
        wx, wy = to_world(rr_.uniform(-4.5, 4.5), rr_.uniform(TELE - 4.5, TELE + 8.5)) if TELE else to_world(rr_.uniform(-6.5, 6.5), rr_.uniform(-1.0, 14.0)); s = 0.012 * (1 - rr_.random() * 0.985) ** (-1 / 2.3)
        if s > 0.10 or (s > 0.03 and not clear(wx, wy, 0)): continue
        c = ground(wx, wy); a = rr_.uniform(0, 6.28); Rz = np.array([[math.cos(a), -math.sin(a), 0], [math.sin(a), math.cos(a), 0], [0, 0, 1]]); F.append(pf + len(V) * len(pcv)); V.append((pcv * rr_.uniform(0.6, 1.0, 3)) @ Rz.T * s / 2 + np.array([c[0], c[1], c[2] + s * rr_.uniform(-0.05, 0.22)]))
    me = bpy.data.meshes.new("pebbles"); Va = np.concatenate(V).astype(np.float32); Fa = np.concatenate(F).astype(np.int32); me.vertices.add(len(Va)); me.vertices.foreach_set("co", Va.reshape(-1)); me.loops.add(Fa.size); me.loops.foreach_set("vertex_index", Fa.reshape(-1))
    me.polygons.add(len(Fa)); me.polygons.foreach_set("loop_start", np.arange(0, Fa.size, 3, dtype=np.int32)); me.update(calc_edges=True); me.shade_smooth(); me.materials.append(rmat); scene.collection.objects.link(bpy.data.objects.new("pebbles", me)); log("rocks", nr, "boulders", nb, "pebbles", len(V))
build_props()
sm_ = lambda x: max(0.0, min(1.0, x)) ** 2 * (3 - 2 * max(0.0, min(1.0, x)))
def animate(tt):
    T = tt * E("DUR", C["dur"])
    if "a1" in STATE:
        co = STATE["co0"].copy()
        if C["layout"] == "base": pose_arm(co, STATE["co0"], STATE["rr"], math.radians(-30 * sm_((T - 0.6) / 1.4) + 9 * sm_((T - 3.2) / 1.5))); yaw = STATE["a1yaw"] - 10 * sm_(T / 4.6)           # lifts an arm toward the hatch and turns to it
        else: pose_arm(co, STATE["co0"], STATE["rl"], math.radians(-44 * sm_((T - 0.5) / 1.6) + 6 * sm_((T - 3.6) / 1.2))); pose_arm(co, STATE["co0"], STATE["rr"], math.radians(-6 * sm_((T - 1.0) / 2.0))); yaw = STATE["a1yaw"] + 9 * sm_(T / 4.8)   # raises a hand against the low Sun and turns toward Earth
        STATE["a1"].data.vertices.foreach_set("co", co.reshape(-1)); STATE["a1"].data.update(); STATE["a1"].matrix_world = upright(STATE["a1pos"][0], STATE["a1pos"][1], yaw, -0.035)
    if "beacon" in STATE:
        on = 0.1 if C["span"] > 0 else float((T % 1.6) < 0.16)          # a time-lapse frame is a long exposure: it holds the flashes averaged
        STATE["beacon"].inputs["Strength"].default_value = 6.0e-3 * on * E("LAMPS", 0.25); STATE["beacon_lamp"].data.energy = 0.5 * on * E("LAMPS", 0.25)

# ---------- camera
cd = bpy.data.cameras.new("cam"); cd.sensor_fit = "VERTICAL"; cd.sensor_height = 36; cd.lens = C["lens"]; cd.clip_start = 0.05; cd.clip_end = 1.0e7; cam = bpy.data.objects.new("cam", cd); scene.collection.objects.link(cam); scene.camera = cam
def wobble(T, seed, amp):
    r = np.random.default_rng(seed); f = r.uniform(0.3, 2.2, 5); ph = r.uniform(0, 6.28, 5); a = r.uniform(0.4, 1.0, 5) / f ** 0.8; return amp * float((a * np.sin(2 * math.pi * f * T + ph)).sum()) / 2.2
Z0 = ground(ORG[0], ORG[1])[2]
def cam_pose(tt):
    T = tt * E("DUR", C["dur"]); k = 0.0 if C["span"] > 0 else E("SHAKE", 0.05 if TELE else 1.0)                       # a time-lapse camera sits on a tripod
    wx, wy = to_world(C["dolly"][0] * tt, C["dolly"][1] * tt); p = ground(wx, wy); pos = Vector((p[0] + k * wobble(T, 1, 0.008), p[1] + k * wobble(T, 2, 0.008), Z0 + C["h"] + k * wobble(T, 3, 0.012)))
    yaw = math.radians(C["az"] + C["pan"] * (sm_(tt) if "expo_end" in C else tt) + k * wobble(T, 4, 0.22)); pitch = math.radians(C["pitch"] + k * wobble(T, 5, 0.22)); d = Vector((math.sin(yaw) * math.cos(pitch), math.cos(yaw) * math.cos(pitch), math.sin(pitch)))
    return pos, d.to_track_quat("-Z", "Y") @ Matrix.Rotation(math.radians(k * wobble(T, 6, 0.25)), 4, "Z").to_quaternion()

# ---------- render
scene.render.engine = "CYCLES"; cy = scene.cycles; cy.device = "CPU"; cy.film_exposure = EXPO; cy.samples = int(E("SPP", 48 if NIGHT else 32)); cy.use_adaptive_sampling = True; cy.adaptive_threshold = 0.015; cy.use_denoising = True
for name_ in ("light_sampling_threshold", "light_threshold"):                 # very faint light (the held-back Earth) must not be cut off by the sampler
    if hasattr(cy, name_): setattr(cy, name_, 0.0)
cy.max_bounces = 6; cy.diffuse_bounces = 3; cy.glossy_bounces = 3; cy.transmission_bounces = 4; cy.caustics_reflective = False; cy.caustics_refractive = False; scene.render.use_persistent_data = True
sc = E("SCALE", 1.0); scene.render.resolution_x, scene.render.resolution_y = int(1080 * sc), int(1920 * sc); scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = "OPEN_EXR"; scene.render.image_settings.color_depth = "16"; scene.render.image_settings.exr_codec = "ZIP"
BLUR = C["span"] == 0 and E("BLUR", 1) > 0
if BLUR: scene.render.use_motion_blur = True; scene.render.motion_blur_shutter = 0.5; bpy.context.preferences.edit.keyframe_new_interpolation_type = "LINEAR"
log("scene built")
for i in range(a_, b_ + 1):
    tt = i / max(nf - 1, 1); s = set_sky(tt)
    if "expo_end" in C:                                    # day into night in one take: the exposure opens as the light goes, as a camera left on automatic would; Earth is held back in step (see EARTHK)
        x = sm_((tt - C["ramp"][0]) / (C["ramp"][1] - C["ramp"][0])); cy.film_exposure = math.exp(math.log(EXPO) * (1 - x) + math.log(E("EXPO_END", C["expo_end"])) * x); ml_.inputs[1].default_value = SUNE / math.pi * math.exp(math.log(EARTHK) * x)
    if BLUR:
        cam.animation_data_clear(); prev = None
        for j in (i - 1, i + 1, i):
            pos, qq = cam_pose(j / max(nf - 1, 1))
            if prev is not None and prev.dot(qq) < 0: qq.negate()
            prev = qq.copy(); cam.rotation_mode = "QUATERNION"; cam.location = pos; cam.rotation_quaternion = qq; cam.keyframe_insert("location", frame=j); cam.keyframe_insert("rotation_quaternion", frame=j)
        animate(tt); scene.frame_set(i)
    else:
        cam.rotation_mode = "QUATERNION"; cam.location, cam.rotation_quaternion = cam_pose(tt); animate(tt)
    scene.render.filepath = f"{OUT}/f_{i:04d}.exr"; bpy.ops.render.render(write_still=True); log("frame", i, s["t"].utc_strftime("%m-%d %H:%M"))
