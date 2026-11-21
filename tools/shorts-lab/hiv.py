# HIV-1 capsid, every heavy atom of PDB 3J3Q (Zhao et al., Nature 2013; PDB data is CC0) drawn as a sphere.
import os, sys, math, time, numpy as np, bpy
from mathutils import Vector, Matrix
NPZ, OUT = sys.argv[1], sys.argv[2]; E = lambda k, d: float(os.environ.get(k, d)); t0 = time.time()
def log(*a): print(f"[{time.time()-t0:6.1f}s]", *a, flush=True)
bpy.ops.wm.read_factory_settings(use_empty=True); scene = bpy.context.scene
d = np.load(NPZ); P = d["P"]; rad = d["rad"]; res = d["res"]; ch = d["ch"]; rs = d["ring_size"][ch]; ring = d["ring"][ch]
SC = 0.01                                               # 100 angstrom = 1 scene unit
ax = d["axes"]; long_ax = ax[:, 2]; a1 = ax[:, 1]; a0 = np.cross(a1, long_ax)
Q = (P - d["center"]) @ np.stack([a0, a1, long_ax], 1) * SC          # long axis -> Z
# put the broad end up
top = Q[Q[:, 2] > 0]; bot = Q[Q[:, 2] < 0]
if np.hypot(top[:, 0], top[:, 1]).mean() < np.hypot(bot[:, 0], bot[:, 1]).mean(): Q[:, 2] *= -1; Q[:, 0] *= -1
tilt = math.radians(E("TILT", 24)); spin = math.radians(E("SPIN", 20))
Rz = np.array([[math.cos(spin), -math.sin(spin), 0], [math.sin(spin), math.cos(spin), 0], [0, 0, 1]]); Ry = np.array([[math.cos(tilt), 0, math.sin(tilt)], [0, 1, 0], [-math.sin(tilt), 0, math.cos(tilt)]])
Q = (Q @ Rz.T @ Ry.T).astype(np.float32)
# colour: protein domain, ring type, small per-chain and per-element variation
rng = np.random.default_rng(3); n = len(Q); nch = ch.max() + 1
ntd = res <= 145; pent = rs == 5
col = np.empty((n, 3), np.float32)
col[ntd & ~pent] = (0.93, 0.56, 0.13); col[~ntd & ~pent] = (0.03, 0.36, 0.47)
col[ntd & pent] = (0.92, 0.10, 0.28); col[~ntd & pent] = (0.40, 0.10, 0.58)
jit = rng.uniform(0.80, 1.18, nch).astype(np.float32)[ch][:, None]; hue = rng.normal(0, 0.035, (nch, 3)).astype(np.float32)[ch]
rj = rng.uniform(0.90, 1.10, ring.max() + 1).astype(np.float32)[ring][:, None]
col = np.clip(col * jit * rj + hue, 0.005, 1.0)
col *= rng.uniform(0.92, 1.08, (n, 1)).astype(np.float32)
rgba = np.concatenate([col, np.ones((n, 1), np.float32)], 1)
me = bpy.data.meshes.new("atoms"); me.vertices.add(n); me.vertices.foreach_set("co", Q.reshape(-1))
me.attributes.new("rad", "FLOAT", "POINT").data.foreach_set("value", (rad * SC * E("RADK", 1.0)).astype(np.float32))
me.attributes.new("col", "FLOAT_COLOR", "POINT").data.foreach_set("color", rgba.reshape(-1))
ob = bpy.data.objects.new("capsid", me); scene.collection.objects.link(ob)
mat = bpy.data.materials.new("protein"); mat.use_nodes = True; nt = mat.node_tree; bs = nt.nodes["Principled BSDF"]
at = nt.nodes.new("ShaderNodeAttribute"); at.attribute_name = "col"; nt.links.new(at.outputs["Color"], bs.inputs["Base Color"]); bs.inputs["Roughness"].default_value = 0.42
ng = bpy.data.node_groups.new("pts", "GeometryNodeTree")
ng.interface.new_socket(name="Geometry", in_out="INPUT", socket_type="NodeSocketGeometry"); ng.interface.new_socket(name="Geometry", in_out="OUTPUT", socket_type="NodeSocketGeometry")
gi = ng.nodes.new("NodeGroupInput"); go = ng.nodes.new("NodeGroupOutput"); m2p = ng.nodes.new("GeometryNodeMeshToPoints"); na = ng.nodes.new("GeometryNodeInputNamedAttribute"); na.data_type = "FLOAT"; na.inputs["Name"].default_value = "rad"
sm = ng.nodes.new("GeometryNodeSetMaterial"); sm.inputs["Material"].default_value = mat
ng.links.new(gi.outputs[0], m2p.inputs["Mesh"]); ng.links.new(na.outputs["Attribute"], m2p.inputs["Radius"]); ng.links.new(m2p.outputs["Points"], sm.inputs["Geometry"]); ng.links.new(sm.outputs["Geometry"], go.inputs[0])
ob.modifiers.new("gn", "NODES").node_group = ng
log("atoms", n, "extent", Q.min(0), Q.max(0))
# out-of-focus particles for depth (illustrative, not data)
pm = bpy.data.materials.new("mote"); pm.use_nodes = True; e = pm.node_tree.nodes.new("ShaderNodeEmission"); pm.node_tree.links.new(e.outputs[0], pm.node_tree.nodes["Material Output"].inputs["Surface"])
oi = pm.node_tree.nodes.new("ShaderNodeObjectInfo"); mr = pm.node_tree.nodes.new("ShaderNodeMapRange"); mr.inputs["To Min"].default_value = 0.25; mr.inputs["To Max"].default_value = 2.6
pm.node_tree.links.new(oi.outputs["Random"], mr.inputs["Value"]); pm.node_tree.links.new(mr.outputs["Result"], e.inputs["Strength"]); e.inputs["Color"].default_value = (0.25, 0.75, 0.9, 1)
bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=1); base = bpy.context.object; base.data.materials.append(pm)
for i in range(int(E("MOTES", 260))):
    o = base.copy(); scene.collection.objects.link(o); r_ = rng.uniform(0.03, 0.16)
    o.scale = (r_, r_, r_); o.location = (rng.uniform(-14, 14), rng.uniform(11, 60), rng.uniform(-18, 18))
base.hide_render = True
# lights
def area(name, loc, size, power, color):
    l = bpy.data.lights.new(name, "AREA"); l.size = size; l.energy = power; l.color = color; o = bpy.data.objects.new(name, l); scene.collection.objects.link(o)
    o.location = loc; o.rotation_mode = "QUATERNION"; o.rotation_quaternion = (Vector((0, 0, 0)) - Vector(loc)).to_track_quat("-Z", "Y")
area("key", (-14, -16, 13), 12, E("KEY", 26000), (1.0, 0.93, 0.82)); area("rim", (13, 15, 6), 10, E("RIM", 30000), (0.45, 0.72, 1.0)); area("under", (4, -9, -15), 14, E("UNDER", 5000), (0.55, 0.45, 0.95))
w = bpy.data.worlds.new("w"); scene.world = w; w.use_nodes = True; wn = w.node_tree; bg = wn.nodes["Background"]
tc = wn.nodes.new("ShaderNodeTexCoord"); gr = wn.nodes.new("ShaderNodeTexGradient"); gr.gradient_type = "SPHERICAL"; mp = wn.nodes.new("ShaderNodeMapping"); mp.inputs["Location"].default_value = (0.0, -0.75, 0.15)
cr = wn.nodes.new("ShaderNodeValToRGB"); cr.color_ramp.elements[0].color = (0.004, 0.010, 0.022, 1); cr.color_ramp.elements[1].color = (0.02, 0.16, 0.24, 1); cr.color_ramp.elements[1].position = 0.75
wn.links.new(tc.outputs["Generated"], mp.inputs["Vector"]); wn.links.new(mp.outputs["Vector"], gr.inputs["Vector"]); wn.links.new(gr.outputs["Fac"], cr.inputs["Fac"]); wn.links.new(cr.outputs["Color"], bg.inputs["Color"]); bg.inputs["Strength"].default_value = E("WORLD", 1.0)
# camera
cd = bpy.data.cameras.new("cam"); cd.sensor_fit = "VERTICAL"; cd.sensor_height = 36; cd.lens = E("LENS", 85); cam = bpy.data.objects.new("cam", cd); scene.collection.objects.link(cam); scene.camera = cam
dist = E("DIST", 27.0); cam.location = (E("CX", 0.0), -dist, E("CZ", 0.3)); cam.rotation_mode = "QUATERNION"; cam.rotation_quaternion = (Vector((E("CX", 0.0), 0, E("CZ", 0.3))) - cam.location).to_track_quat("-Z", "Y")
cd.dof.use_dof = True; cd.dof.focus_distance = dist - E("FOCUS_IN", 2.6); cd.dof.aperture_fstop = E("FSTOP", 1.4); cd.clip_end = 500
scene.render.engine = "CYCLES"; cy = scene.cycles; cy.device = "CPU"; cy.samples = int(E("SPP", 96)); cy.use_adaptive_sampling = True; cy.adaptive_threshold = 0.02; cy.use_denoising = True; cy.max_bounces = 4; cy.diffuse_bounces = 3
sc = E("SCALE", 1.0); scene.render.resolution_x, scene.render.resolution_y = int(1080 * sc), int(1920 * sc)
scene.view_settings.view_transform = "AgX"
for look in ("AgX - Medium High Contrast", "Medium High Contrast"):
    try: scene.view_settings.look = look; break
    except Exception: pass
scene.view_settings.exposure = E("EXPO", 0.0); scene.render.image_settings.file_format = "PNG"
scene.render.filepath = OUT; bpy.ops.render.render(write_still=True); log("rendered")
