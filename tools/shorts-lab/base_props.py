# Layout and props for the Moon base test shot. Executed inside base_scene.py (shares its names).
# Published designs: NASA Space Exploration Vehicle, Habitat Demonstration Unit, RASSOR, Z-2 suit (github.com/nasa/NASA-3D-Resources).
# Modelled by us: where they stand, how fast they move, rocks, tracks, bootprints, thrown dust.
import cv2, bmesh
MOD = f"{DATA}/models_plain"; prng = np.random.default_rng(11)
def smooth_path(ctrl, step=0.05):
    p = np.array(ctrl, np.float64)
    for _ in range(5): q = np.empty((2 * len(p) - 2, 2)); q[0::2] = 0.75 * p[:-1] + 0.25 * p[1:]; q[1::2] = 0.25 * p[:-1] + 0.75 * p[1:]; p = np.vstack([p[:1], q, p[-1:]])
    s = np.concatenate([[0], np.cumsum(np.hypot(*np.diff(p, axis=0).T))]); t = np.arange(0, s[-1], step); return np.stack([np.interp(t, s, p[:, 0]), np.interp(t, s, p[:, 1])], 1)
def offset(path, d):
    g = np.gradient(path, axis=0); g /= np.linalg.norm(g, axis=1, keepdims=True) + 1e-9; return path + d * np.stack([-g[:, 1], g[:, 0]], 1)
def at(path, s, step=0.05):
    """position and unit heading at arc length s"""
    i = min(max(s / step, 0), len(path) - 2); k = int(i); a = i - k; p = path[k] * (1 - a) + path[k + 1] * a; f = path[min(k + 6, len(path) - 1)] - path[max(k - 6, 0)]; return p, f / np.linalg.norm(f)
ROAD = smooth_path([(80, 34), (50, 31.5), (28, 28.5), (15, 26.8), (7, 27.0), (1.5, 28.6), (-1.0, 30.6)])
LOOP = smooth_path([(-9, -3.5), (-4.5, -0.6), (-0.6, 2.3), (3.2, 5.6), (6.4, 10.5), (9.0, 17.0), (12.5, 23.0), (17, 27.2)])
FAR = smooth_path([(-110, 143), (-90, 147), (-70, 150), (-50, 152), (-30, 151)])
A1, A2, RAS, HAB = (-0.7, 5.6), (-1.9, 32.4), (1.6, 10.5), (-3.0, 36.0)          # astronaut, astronaut, robot, habitat
WALKS = [smooth_path(c) for c in ([(0.9, -1.2), (0.6, 1.4), (0.0, 3.6), (-0.6, 5.2)], [(-0.3, 5.9), (0.5, 7.8), (1.1, 9.4), (1.3, 10.1)], [(2.0, 10.0), (1.3, 8.2), (-0.1, 6.2)],
                                  [(-1.7, 32.0), (0.2, 30.2), (2.6, 28.6)], [(-2.1, 32.7), (-2.6, 33.3), (-3.0, 33.7)], [(-1.0, 6.2), (-2.6, 10.0), (-3.0, 16.0), (-2.4, 23.0), (-2.0, 31.8)])]
def keep(x, y, D):
    dr = np.full(len(x), 1e9)
    for path in (ROAD[::10], LOOP[::10]): dr = np.minimum(dr, np.sqrt(((x[:, None] - path[None, :, 0]) ** 2 + (y[:, None] - path[None, :, 1]) ** 2).min(1)))
    apron = (x > -9) & (x < 9) & (y > -4) & (y < 18); hab = np.hypot(x - HAB[0], y - HAB[1]) < 9
    return ~((apron & (D > 0.8)) | (hab & (D > 1.2)) | ((dr < 3.2 + D / 2) & (D > 0.7)))
G.keep = keep
PRINTS = []
for w in WALKS:
    n = int(len(w) * 0.05 / 0.52)
    for k in range(n):
        p, f = at(w, k * 0.52 + prng.uniform(-0.04, 0.04)); side = 1 if k % 2 else -1; nrm = np.array([-f[1], f[0]])
        PRINTS.append((p[0] + side * 0.13 * nrm[0], p[1] + side * 0.13 * nrm[1], math.atan2(f[1], f[0]) + side * 0.12 + prng.normal(0, 0.10)))
GAUGE, RUT = 1.70, 0.72
def marks(H, u0, v0, res):
    ny, nx = H.shape; Z = np.zeros((ny, nx), np.float32)
    if res > 0.12: return H
    P = lambda a: np.round((a - np.array([u0, v0])) / res * 16).astype(np.int32)        # fixed point, 4 fractional bits
    rut = np.zeros((ny, nx), np.uint8)
    for path in (ROAD, LOOP):
        for side in (-1, 1): cv2.polylines(rut, [P(offset(path, side * GAUGE))], False, 255, max(1, int(round(RUT / res))), cv2.LINE_AA, 4)
    r = cv2.GaussianBlur(rut.astype(np.float32) / 255, (0, 0), max(0.035 / res, 0.7)); Z -= 0.026 * r
    Z += 0.010 * np.clip(cv2.GaussianBlur(r, (0, 0), max(0.12 / res, 1.0)) - r, 0, 1)               # soil pushed up beside the ruts
    if res <= 0.025:
        cl = np.zeros((ny, nx), np.uint8)
        for path in (ROAD, LOOP):
            for side in (-1, 1):
                for wo in (-0.20, 0.20):
                    c = offset(path, side * GAUGE + wo); g = np.gradient(c, axis=0); g /= np.linalg.norm(g, axis=1, keepdims=True) + 1e-9; nrm = np.stack([-g[:, 1], g[:, 0]], 1)
                    for k in range(0, len(c), 3):                                                # a cleat every 15 cm
                        if not (u0 - 1 < c[k, 0] < u0 + nx * res + 1 and v0 - 1 < c[k, 1] < v0 + ny * res + 1): continue
                        a, b = P(c[k] - 0.13 * nrm[k]), P(c[k] + 0.13 * nrm[k]); cv2.line(cl, tuple(a), tuple(b), 255, max(1, int(round(0.045 / res))), cv2.LINE_AA, 4)
        Z -= 0.009 * cv2.GaussianBlur(cl.astype(np.float32) / 255, (0, 0), 0.8)
    bp = np.zeros((ny, nx), np.uint8); rib = np.zeros((ny, nx), np.uint8)
    for (x, y, a) in PRINTS:
        if not (u0 < x < u0 + nx * res and v0 < y < v0 + ny * res): continue
        c = ((x - u0) / res, (y - v0) / res); cv2.ellipse(bp, (int(round(c[0] * 16)), int(round(c[1] * 16))), (int(0.17 / res * 16), int(0.075 / res * 16)), math.degrees(a), 0, 360, 255, -1, cv2.LINE_AA, 4)
        if res <= 0.025:
            f = np.array([math.cos(a), math.sin(a)]); nrm = np.array([-f[1], f[0]])
            for k in range(-3, 4):
                q = np.array([x, y]) + f * k * 0.045; cv2.line(rib, tuple(P(q - 0.06 * nrm)), tuple(P(q + 0.06 * nrm)), 255, max(1, int(round(0.018 / res))), cv2.LINE_AA, 4)
    b = cv2.GaussianBlur(bp.astype(np.float32) / 255, (0, 0), max(0.012 / res, 0.6)); Z -= 0.018 * b
    if res <= 0.025: Z += 0.007 * cv2.GaussianBlur(rib.astype(np.float32) / 255, (0, 0), 0.7) * b
    press = np.clip(0.92 * r + 0.9 * b, 0, 0.95); Hlp = cv2.GaussianBlur(H, (0, 0), max(0.25 / res, 1.0))        # pressed soil loses its small bumps
    return (Hlp + (H - Hlp) * (1 - press) + Z).astype(np.float32)
G.extra.append(marks)

def load(name, scale=1.0):
    before = set(scene.objects); bpy.ops.import_scene.gltf(filepath=f"{MOD}/{name}.glb"); new = [o for o in scene.objects if o not in before]
    ob = [o for o in new if o.type == "MESH"][0]; M = Matrix.Scale(scale, 4) @ ob.matrix_world.copy(); ob.parent = None; ob.data.transform(M); ob.matrix_world = Matrix.Identity(4)
    for o in new:
        if o is not ob: bpy.data.objects.remove(o)
    ob.name = name; return ob
def plane_rot(u, v, f, half_l, half_w):
    """rotation that sets a vehicle on the ground: model -y -> heading f, z -> ground normal"""
    nrm = np.array([-f[1], f[0]]); pts = [ground_z(u + a * f[0] + b * nrm[0], v + a * f[1] + b * nrm[1]) for a in (-half_l, 0, half_l) for b in (-half_w, half_w)]
    A = np.array([[p[0], p[1], 1] for p in pts]); cz = np.linalg.lstsq(A, np.array([p[2] for p in pts]), rcond=None)[0]; n = Vector((-cz[0], -cz[1], 1)).normalized()
    c = ground_z(u, v); zc = cz[0] * c[0] + cz[1] * c[1] + cz[2]; fw = Vector((f[0], f[1], 0)); fw = (fw - fw.dot(n) * n).normalized(); right = fw.cross(n)       # x = right when nose is -y ... model axes: x, y(back), z
    R = Matrix((-right, -fw, n)).transposed().to_4x4()      # columns: images of model x, y, z
    return Matrix.Translation(Vector((c[0], c[1], zc))) @ R
def upright(u, v, yaw_deg, dz=0.0):
    c = ground_z(u, v); return Matrix.Translation(Vector((c[0], c[1], c[2] + dz))) @ Matrix.Rotation(math.radians(yaw_deg), 4, "Z")

def weather(ob, z0, z1, amount=0.8, tone=0.86):
    """lunar dust clings to everything: thickest near the ground, a thin film higher up; and no paint is perfectly white (modelled)"""
    for m in ob.data.materials:
        if not m or not m.use_nodes: continue
        nt = m.node_tree; b = next((n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"), None)
        if b is None: continue
        N, L = nt.nodes.new, nt.links.new; tc = N("ShaderNodeTexCoord"); sep = N("ShaderNodeSeparateXYZ"); L(tc.outputs["Object"], sep.inputs[0])
        mr = N("ShaderNodeMapRange"); mr.inputs["From Min"].default_value = z0; mr.inputs["From Max"].default_value = z1; mr.inputs["To Min"].default_value = 1.0; mr.inputs["To Max"].default_value = 0.0; L(sep.outputs["Z"], mr.inputs["Value"])
        def noise(scale, lo, hi):
            n = N("ShaderNodeTexNoise"); n.inputs["Scale"].default_value = scale; n.inputs["Detail"].default_value = 8; L(tc.outputs["Object"], n.inputs["Vector"])
            r = N("ShaderNodeMapRange"); r.inputs["From Min"].default_value = 0.3; r.inputs["From Max"].default_value = 0.7; r.inputs["To Min"].default_value = lo; r.inputs["To Max"].default_value = hi; L(n.outputs["Fac"], r.inputs["Value"]); return r.outputs["Result"]
        def math_(op, a, c):
            n = N("ShaderNodeMath"); n.operation = op; n.use_clamp = True
            for i, v in enumerate((a, c)):
                if isinstance(v, (int, float)): n.inputs[i].default_value = v
                else: L(v, n.inputs[i])
            return n.outputs[0]
        fac = math_("ADD", math_("MULTIPLY", math_("MULTIPLY", mr.outputs["Result"], noise(5.0, 0.35, 1.25)), amount), math_("MULTIPLY", noise(28.0, 0.0, 1.0), 0.16))
        mix = N("ShaderNodeMixRGB"); mix.blend_type = "MIX"; mix.inputs["Color2"].default_value = (0.165, 0.155, 0.14, 1); L(fac, mix.inputs["Fac"])
        tn = N("ShaderNodeMixRGB"); tn.blend_type = "MULTIPLY"; tn.inputs["Fac"].default_value = 1.0; tn.inputs["Color2"].default_value = (tone, tone, tone * 0.985, 1)
        bc = b.inputs["Base Color"]
        if bc.links: L(bc.links[0].from_socket, tn.inputs["Color1"])
        else: tn.inputs["Color1"].default_value = bc.default_value[:]
        L(tn.outputs["Color"], mix.inputs["Color1"]); L(mix.outputs["Color"], bc)
        ro = b.inputs["Roughness"]; src = ro.links[0].from_socket if ro.links else None; base_r = src if src is not None else float(ro.default_value)
        L(math_("MAXIMUM", base_r, math_("ADD", math_("MULTIPLY", fac, 0.5), 0.42)), ro)
def arm_rig(me, side):
    """the vertices of one arm of the suit, found by walking the mesh from the hand up to the shoulder, with a soft blend at the shoulder"""
    from scipy.sparse import coo_matrix; from scipy.sparse.csgraph import connected_components
    n = len(me.vertices); co = np.empty(n * 3, np.float32); me.vertices.foreach_get("co", co); co = co.reshape(-1, 3); S = np.array([side * 0.29, -0.02, 1.43], np.float32); a = np.array([0, -0.77, -0.63], np.float32); d = (co - S) @ a
    from scipy.spatial import cKDTree
    perp = np.linalg.norm((co - S) - d[:, None] * a, axis=1); ok = (d > -0.02) & (co[:, 0] * side > 0.05) & (perp < 0.17)       # inside a tube around the arm, below the shoulder
    cand = np.where(ok)[0]; weld = cand[cKDTree(co[cand]).query_pairs(0.0006, output_type="ndarray")]                           # the mesh is split at texture seams: join the doubled vertices
    ed = np.empty(len(me.edges) * 2, np.int32); me.edges.foreach_get("vertices", ed); ed = ed.reshape(-1, 2); ed = np.vstack([ed[ok[ed[:, 0]] & ok[ed[:, 1]]], weld.reshape(-1, 2)])
    nc, lab = connected_components(coo_matrix((np.ones(len(ed)), (ed[:, 0], ed[:, 1])), shape=(n, n)), directed=False); seed = cand[np.argmin(co[cand, 1])]; idx = np.where((lab == lab[seed]) & ok)[0]
    t = np.clip((d[idx] + 0.02) / 0.12, 0, 1); return idx, (t * t * (3 - 2 * t)).astype(np.float32), S
def pose_arm(co, co0, rig, phi):
    idx, w, S = rig; y, z = co0[idx, 1] - S[1], co0[idx, 2] - S[2]; c, s_ = math.cos(phi), math.sin(phi)
    co[idx, 1] = co0[idx, 1] + w * (S[1] + y * c - z * s_ - co0[idx, 1]); co[idx, 2] = co0[idx, 2] + w * (S[2] + y * s_ + z * c - co0[idx, 2])
def build_props():
    global SEV, SEV2, WHEELS, CO0, ROVER_S0, AST1, ACO0, ARM_R
    # crew rover (near) and a second one far off; NASA planned for them to travel in pairs
    SEV = load("sev"); me = SEV.data
    if "custom_normal" in me.attributes: me.attributes.remove(me.attributes["custom_normal"])
    me.set_sharp_from_angle(angle=math.radians(40)); me.shade_smooth()
    n = len(me.vertices); co = np.empty(n * 3, np.float32); me.vertices.foreach_get("co", co); CO0 = co.reshape(-1, 3).copy()
    from scipy.sparse import coo_matrix; from scipy.sparse.csgraph import connected_components
    ed = np.empty(len(me.edges) * 2, np.int32); me.edges.foreach_get("vertices", ed); ed = ed.reshape(-1, 2); nc, lab = connected_components(coo_matrix((np.ones(len(ed)), (ed[:, 0], ed[:, 1])), shape=(n, n)), directed=False)
    WHEELS = []
    for yc in (-0.83, 0.87, 2.57):
        for sx in (-1, 1):
            rad = np.hypot(CO0[:, 1] - yc, CO0[:, 2] + 1.86); inside = (rad < 0.405) & (CO0[:, 0] * sx > 1.36) & (CO0[:, 0] * sx < 2.05)
            bad = np.bincount(lab[~inside], minlength=nc) > 0; idx = np.where(inside & ~bad[lab])[0]; WHEELS.append((idx, yc)); 
    log("rover wheel vertices", [len(w[0]) for w in WHEELS])
    weather(SEV, -2.24, -0.55)
    SEV2 = SEV.copy(); SEV2.data = SEV.data.copy(); scene.collection.objects.link(SEV2); SEV2.name = "sev_far"
    ROVER_S0 = E("ROVER_S0", 70.6)
    # habitat
    hdu = load("hdu1", 0.0254); weather(hdu, 0.29, 2.3, 0.7); hdu.matrix_world = upright(HAB[0], HAB[1], E("HABYAW", 10.0), -0.29 - 0.05)
    # astronauts in NASA's Z-2 prototype suit (one pose only)
    a1 = load("z2"); weather(a1, 0.0, 1.05, 0.55, 0.92); a1.matrix_world = upright(A1[0], A1[1], 180 - 16, -0.035)
    me = a1.data; bm = bmesh.new(); bm.from_mesh(me); bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.0002); bm.to_mesh(me); bm.free()       # the model comes split into small patches; join them so it shades smoothly once it moves
    if "custom_normal" in me.attributes: me.attributes.remove(me.attributes["custom_normal"])
    me.set_sharp_from_angle(angle=math.radians(60)); me.shade_smooth(); me.update(); n = len(me.vertices); ACO0 = np.empty(n * 3, np.float32); me.vertices.foreach_get("co", ACO0); ACO0 = ACO0.reshape(-1, 3).copy(); ARM_R = arm_rig(me, -1); arm_l = arm_rig(me, 1); AST1 = a1
    log("suit arm vertices", len(ARM_R[0]), len(arm_l[0]), "x range of right arm", ACO0[ARM_R[0], 0].min().round(2), ACO0[ARM_R[0], 0].max().round(2))
    a2 = a1.copy(); a2.data = me.copy(); scene.collection.objects.link(a2); a2.matrix_world = upright(A2[0], A2[1], 180 + 35, -0.035)
    c2 = ACO0.copy(); pose_arm(c2, ACO0, arm_l, math.radians(-36)); pose_arm(c2, ACO0, ARM_R, math.radians(-10)); a2.data.vertices.foreach_set("co", c2.reshape(-1)); a2.data.update()       # the second astronaut reaches for the hatch
    # RASSOR digging robot, standing on its two drums
    ras = load("rassor"); me = ras.data; me.transform(Matrix.Rotation(math.radians(E("RASTILT", 13.0)), 4, "X")); zmin = min(v.co.z for v in me.vertices)
    m = bpy.data.materials.new("rassor_metal"); m.use_nodes = True; b = m.node_tree.nodes["Principled BSDF"]; b.inputs["Base Color"].default_value = (0.42, 0.43, 0.45, 1); b.inputs["Metallic"].default_value = 0.85; b.inputs["Roughness"].default_value = 0.48
    me.materials.clear(); me.materials.append(m); ras.matrix_world = upright(RAS[0], RAS[1], 205, -zmin - 0.03)
    # rocks
    rmat = bpy.data.materials.new("rock"); rmat.use_nodes = True; nt = rmat.node_tree; nt.nodes.clear(); N = nt.nodes.new; L = nt.links.new
    out = N("ShaderNodeOutputMaterial"); d = N("ShaderNodeBsdfDiffuse"); d.inputs["Roughness"].default_value = 1.0; oi = N("ShaderNodeObjectInfo"); mr = N("ShaderNodeMapRange"); mr.inputs["To Min"].default_value = 0.13; mr.inputs["To Max"].default_value = 0.30; L(oi.outputs["Random"], mr.inputs["Value"])
    tc = N("ShaderNodeTexCoord"); nz = N("ShaderNodeTexNoise"); nz.inputs["Scale"].default_value = 9.0; nz.inputs["Detail"].default_value = 8; L(tc.outputs["Object"], nz.inputs["Vector"]); m2 = N("ShaderNodeMapRange"); m2.inputs["To Min"].default_value = 0.72; m2.inputs["To Max"].default_value = 1.25; L(nz.outputs["Fac"], m2.inputs["Value"])
    mu = N("ShaderNodeMath"); mu.operation = "MULTIPLY"; L(mr.outputs["Result"], mu.inputs[0]); L(m2.outputs["Result"], mu.inputs[1]); cm = N("ShaderNodeCombineColor"); L(mu.outputs[0], cm.inputs[0]); mg = N("ShaderNodeMath"); mg.operation = "MULTIPLY"; mg.inputs[1].default_value = 0.95; L(mu.outputs[0], mg.inputs[0]); L(mg.outputs[0], cm.inputs[1])
    mb = N("ShaderNodeMath"); mb.operation = "MULTIPLY"; mb.inputs[1].default_value = 0.88; L(mu.outputs[0], mb.inputs[0]); L(mb.outputs[0], cm.inputs[2]); L(cm.outputs["Color"], d.inputs["Color"])
    n2 = N("ShaderNodeTexNoise"); n2.inputs["Scale"].default_value = 30.0; n2.inputs["Detail"].default_value = 6; L(tc.outputs["Object"], n2.inputs["Vector"]); bp = N("ShaderNodeBump"); bp.inputs["Strength"].default_value = 0.6; bp.inputs["Distance"].default_value = 0.05; L(n2.outputs["Fac"], bp.inputs["Height"]); L(bp.outputs["Normal"], d.inputs["Normal"]); L(d.outputs["BSDF"], out.inputs["Surface"])
    def rock_coords(seed, sub):
        bm = bmesh.new(); bmesh.ops.create_icosphere(bm, subdivisions=sub, radius=1.0); me = bpy.data.meshes.new(f"rock{seed}"); bm.to_mesh(me); bm.free(); r = np.random.default_rng(seed)
        co = np.empty(len(me.vertices) * 3, np.float32); me.vertices.foreach_get("co", co); co = co.reshape(-1, 3); dsp = np.ones(len(co))
        for k in range(9): a = r.normal(size=3); a /= np.linalg.norm(a); dsp -= r.uniform(0.05, 0.34) * np.clip(co @ a - r.uniform(0.25, 0.7), 0, 1) ** 0.6       # flat facets, as on broken rock
        for k in range(24): a = r.normal(size=3) * r.uniform(2, 7); dsp += 0.022 * np.sin(co @ a + r.uniform(0, 6.28))
        co = co * dsp[:, None] * r.uniform(0.55, 1.0, 3); me.vertices.foreach_set("co", co.astype(np.float32).reshape(-1)); me.update(); me.shade_smooth(); me.materials.append(rmat); return me
    base = [rock_coords(100 + k, 4) for k in range(14)]
    def clear_of_things(x, y, s):
        if min(np.hypot(ROAD[:, 0] - x, ROAD[:, 1] - y).min(), np.hypot(LOOP[:, 0] - x, LOOP[:, 1] - y).min()) < 2.4 + s: return False
        for (cx_, cy_, rr) in ((HAB[0] + 1.0, HAB[1], 7.5), (A1[0], A1[1], 0.8), (RAS[0], RAS[1], 1.4), (A2[0], A2[1], 0.8), (0.6, 0.2, 1.3)):
            if math.hypot(x - cx_, y - cy_) < rr + s: return False
        return True
    def scatter(u0, u1, v0, v1, smin, smax, coef, expo, tag):
        A = (u1 - u0) * (v1 - v0); n = prng.poisson(coef * (smin ** -expo - smax ** -expo) * A); k = 0
        for _ in range(n):
            s = (smin ** -expo - prng.random() * (smin ** -expo - smax ** -expo)) ** (-1 / expo); x, y = prng.uniform(u0, u1), prng.uniform(v0, v1)
            if not clear_of_things(x, y, s): continue
            try: c = ground_z(x, y)
            except ValueError: continue
            o = bpy.data.objects.new(f"{tag}{k}", base[prng.integers(len(base))]); scene.collection.objects.link(o); o.rotation_euler = tuple(prng.uniform(0, 6.28, 3)); o.scale = (s / 2,) * 3; o.location = (c[0], c[1], c[2] - s * prng.uniform(0.05, 0.22)); k += 1
        return k
    nr = scatter(-40, 40, -10, 70, 0.10, 1.3, 0.0006, 2.3, "rock"); nr2 = scatter(-150, 150, 70, 400, 0.6, 3.0, 0.0006, 2.3, "boulder")
    for (x, y, s, sd_) in ((0.75, 3.15, 0.30, 3), (1.0, 3.5, 0.12, 6), (-4.9, 13.5, 0.9, 8), (-0.9, 15.5, 0.7, 9)):      # the near one sits between the two ruts, where a wheel never ran      # hand-placed for the composition
        c = ground_z(x, y); o = bpy.data.objects.new("hero", base[sd_]); scene.collection.objects.link(o); o.rotation_euler = (0.3 * sd_, 0.2, 1.1 * sd_); o.scale = (s / 2,) * 3; o.location = (c[0], c[1], c[2] - 0.12 * s)
    # pebbles near the camera, one mesh
    lo = rock_coords(300, 1); pc = np.empty(len(lo.vertices) * 3, np.float32); lo.vertices.foreach_get("co", pc); pc = pc.reshape(-1, 3); pf = np.array([list(p.vertices) for p in lo.polygons], np.int32)
    V, F = [], []; npeb = 0
    if "g0" in HG:
        for _ in range(int(E("PEBBLES", 2600))):
            x, y = prng.uniform(-5.5, 9.5), prng.uniform(-1.0, 14.0); s = 0.012 * (1 - prng.random() * 0.985) ** (-1 / 2.3)
            if s > 0.10 or not clear_of_things(x, y, 0) and s > 0.03: continue
            c = ground_z(x, y); a = prng.uniform(0, 6.28); Rz = np.array([[math.cos(a), -math.sin(a), 0], [math.sin(a), math.cos(a), 0], [0, 0, 1]]); q = (pc * prng.uniform(0.6, 1.0, 3)) @ Rz.T * s / 2 + np.array([c[0], c[1], c[2] + s * prng.uniform(-0.05, 0.22)])
            F.append(pf + len(V) * len(pc)); V.append(q); npeb += 1
        me = bpy.data.meshes.new("pebbles"); Va = np.concatenate(V).astype(np.float32); Fa = np.concatenate(F).astype(np.int32); me.vertices.add(len(Va)); me.vertices.foreach_set("co", Va.reshape(-1)); me.loops.add(Fa.size); me.loops.foreach_set("vertex_index", Fa.reshape(-1))
        me.polygons.add(len(Fa)); me.polygons.foreach_set("loop_start", np.arange(0, Fa.size, 3, dtype=np.int32)); me.update(calc_edges=True); me.shade_smooth(); me.materials.append(rmat); scene.collection.objects.link(bpy.data.objects.new("pebbles", me))
    log("rocks", nr, "boulders", nr2, "pebbles", npeb)
    if E("DUST", 70000) > 0: build_dust()
    # work lights (modelled: NASA's models carry no lamps). A base in permanent low sun needs them; they only show inside shadows.
    def spot(name, power, cone, parent, loc, aim):
        l = bpy.data.lights.new(name, "SPOT"); l.energy = power * E("LAMPS", 1.0); l.spot_size = math.radians(cone); l.spot_blend = 0.5; l.shadow_soft_size = 0.06; l.color = (0.92, 0.96, 1.0)
        o = bpy.data.objects.new(name, l); scene.collection.objects.link(o); o.parent = parent; o.location = loc; o.rotation_mode = "QUATERNION"; o.rotation_quaternion = Vector(aim).normalized().to_track_quat("-Z", "Y"); return o
    for sx in (-0.8, 0.8): spot("headlight", 110, 62, SEV, (sx, -2.5, -0.95), (0.15 * sx, -1, -0.30))
    spot("hatch_light", 45, 110, hdu, (0.0, -2.75, 3.1), (0, -0.45, -1)); spot("helmet_light", 7, 55, a1, (0.12, -0.22, 1.83), (0.05, -1, -0.62)); spot("helmet_light2", 7, 55, a2, (0.12, -0.22, 1.83), (0.05, -1, -0.62))
    global BEACON
    bm_ = bpy.data.materials.new("beacon"); bm_.use_nodes = True; nt = bm_.node_tree; nt.nodes.clear(); o = nt.nodes.new("ShaderNodeOutputMaterial"); e = nt.nodes.new("ShaderNodeEmission"); e.inputs["Color"].default_value = (1.0, 0.45, 0.08, 1); nt.links.new(e.outputs[0], o.inputs[0]); BEACON = e
    bpy.ops.mesh.primitive_uv_sphere_add(segments=16, ring_count=8, radius=0.06, location=(0, 0, 0)); b = bpy.context.object; b.data.materials.append(bm_); b.parent = SEV; b.location = (0.0, -0.2, 1.36)

def build_dust():
    """soil thrown by the near rover's wheels: each grain leaves the rim at the rim's own speed and then only gravity acts (no air), so it flies a parabola"""
    global DUST, DP
    n = int(E("DUST", 70000)); r = np.random.default_rng(5); DP = dict(te=r.uniform(-2.5, E("DUR", 5.0), n), pod=r.integers(0, 6, n), th=np.radians(12 + 100 * r.random(n) ** 1.6), k=r.uniform(0.55, 1.0, n),
                                                                  lat=r.uniform(-0.34, 0.34, n), vlat=r.normal(0, 0.13, n), rad=(0.0035 * (1 - r.random(n) * 0.9) ** -0.5).astype(np.float32))
    me = bpy.data.meshes.new("dust"); me.vertices.add(n); me.attributes.new("rad", "FLOAT", "POINT").data.foreach_set("value", np.minimum(DP["rad"], 0.012))
    m = bpy.data.materials.new("dustmat"); m.use_nodes = True; nt = m.node_tree; nt.nodes.clear(); o = nt.nodes.new("ShaderNodeOutputMaterial"); d = nt.nodes.new("ShaderNodeBsdfDiffuse"); d.inputs["Color"].default_value = (0.19, 0.18, 0.165, 1); nt.links.new(d.outputs[0], o.inputs[0])
    ng = bpy.data.node_groups.new("dustpts", "GeometryNodeTree"); ng.interface.new_socket(name="Geometry", in_out="INPUT", socket_type="NodeSocketGeometry"); ng.interface.new_socket(name="Geometry", in_out="OUTPUT", socket_type="NodeSocketGeometry")
    gi = ng.nodes.new("NodeGroupInput"); go = ng.nodes.new("NodeGroupOutput"); m2p = ng.nodes.new("GeometryNodeMeshToPoints"); na = ng.nodes.new("GeometryNodeInputNamedAttribute"); na.data_type = "FLOAT"; na.inputs["Name"].default_value = "rad"
    sm = ng.nodes.new("GeometryNodeSetMaterial"); sm.inputs["Material"].default_value = m; ng.links.new(gi.outputs[0], m2p.inputs["Mesh"]); ng.links.new(na.outputs["Attribute"], m2p.inputs["Radius"]); ng.links.new(m2p.outputs["Points"], sm.inputs["Geometry"]); ng.links.new(sm.outputs["Geometry"], go.inputs[0])
    DUST = bpy.data.objects.new("dust", me); scene.collection.objects.link(DUST); DUST.modifiers.new("gn", "NODES").node_group = ng
def dust_positions(T, v, plane):
    g, Rw = 1.62, 0.38; te = DP["te"]; tau = T - te; s = ROVER_S0 + v * te; i = np.clip(s / 0.05, 0, len(ROAD) - 2); k = i.astype(int); a = (i - k)[:, None]; pc = ROAD[k] * (1 - a) + ROAD[k + 1] * a
    f = ROAD[np.minimum(k + 6, len(ROAD) - 1)] - ROAD[np.maximum(k - 6, 0)]; f /= np.linalg.norm(f, axis=1, keepdims=True); nrm = np.stack([-f[:, 1], f[:, 0]], 1)
    axle = np.array([-1.70, 0.0, 1.70])[DP["pod"] // 2]; side = np.where(DP["pod"] % 2 == 0, -1.0, 1.0) * GAUGE + DP["lat"]          # where each wheel pair touches the ground
    th, kk = DP["th"], DP["k"]; x0 = pc + f * (axle - Rw * np.sin(th))[:, None] + nrm * side[:, None]; z0 = Rw * (1 - np.cos(th))
    vx = v * kk * (1 - np.cos(th)); vz = v * kk * np.sin(th); xy = x0 + f * (vx * tau)[:, None] + nrm * (DP["vlat"] * tau)[:, None]; z = z0 + vz * tau - 0.5 * g * tau * tau
    zg = plane[0] * xy[:, 0] + plane[1] * xy[:, 1] + plane[2]; alive = (tau > 0) & (z > 0); P = np.stack([xy[:, 0], xy[:, 1], zg + z + 0.004], 1).astype(np.float32); P[~alive] = (0, 0, -5000); return P, int(alive.sum())
def animate(t, i):
    T = t * E("DUR", 5.0); v = E("ROVER_V", 1.4); p, f = at(ROAD, ROVER_S0 + v * T); SEV.matrix_world = plane_rot(p[0], p[1], f, 1.7, 1.7) @ Matrix.Translation(Vector((0, -0.87, 2.24 - 0.02)))
    phi = v * T / 0.38; co = CO0.copy()
    for idx, yc in WHEELS:
        y, z = CO0[idx, 1] - yc, CO0[idx, 2] + 1.86; co[idx, 1] = yc + y * math.cos(phi) - z * math.sin(phi); co[idx, 2] = -1.86 + y * math.sin(phi) + z * math.cos(phi)
    SEV.data.vertices.foreach_set("co", co.reshape(-1)); SEV.data.update()
    sm = lambda x: max(0.0, min(1.0, x)) ** 2 * (3 - 2 * max(0.0, min(1.0, x)))
    ca = ACO0.copy(); pose_arm(ca, ACO0, ARM_R, math.radians(-26 * sm((T - 0.9) / 1.3) + 7 * sm((T - 3.3) / 1.4))); AST1.data.vertices.foreach_set("co", ca.reshape(-1)); AST1.data.update()      # the near astronaut lifts an arm toward the rover
    AST1.matrix_world = upright(A1[0], A1[1], 180 - 16 - 7 * sm(T / 4.5), -0.035)
    BEACON.inputs["Strength"].default_value = 260.0 if (T % 1.0) < 0.14 else 0.0                # one flash a second
    if "DUST" in globals():
        pts = [ground_z(p[0] + a * f[0] - b * f[1], p[1] + a * f[1] + b * f[0]) for a in (-3.2, 0, 3.2) for b in (-1.7, 1.7)]; cz = np.linalg.lstsq(np.array([[q[0], q[1], 1] for q in pts]), np.array([q[2] for q in pts]), rcond=None)[0]
        P, na = dust_positions(T, v, cz); DUST.data.vertices.foreach_set("co", P.reshape(-1)); DUST.data.update()
        if i % 30 == 0: log("dust grains in flight", na)
    p, f = at(FAR, 50.0 + 1.6 * T)
    try: SEV2.matrix_world = plane_rot(p[0], p[1], f, 1.7, 1.7) @ Matrix.Translation(Vector((0, -0.87, 2.24 - 0.02)))
    except ValueError: SEV2.hide_render = True
