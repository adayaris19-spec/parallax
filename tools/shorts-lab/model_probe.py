# Try importing each NASA .glb and report size, mesh count and textures. usage: python model_probe.py file1.glb file2.glb ...
import sys, bpy
from mathutils import Vector
for path in sys.argv[1:]:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    try:
        bpy.ops.import_scene.gltf(filepath=path)
    except Exception as e:
        print("FAIL", path.split("/")[-1], "|", str(e).strip().splitlines()[-1][:160], flush=True); continue
    ms = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    if not ms: print("EMPTY", path.split("/")[-1], flush=True); continue
    lo = Vector((1e9,) * 3); hi = Vector((-1e9,) * 3); nv = 0; nf = 0
    for o in ms:
        nv += len(o.data.vertices); nf += len(o.data.polygons)
        for c in o.bound_box:
            w = o.matrix_world @ Vector(c); lo = Vector(map(min, lo, w)); hi = Vector(map(max, hi, w))
    d = hi - lo
    print("OK", path.split("/")[-1], "| meshes", len(ms), "verts", nv, "faces", nf, "| size x y z %.2f %.2f %.2f" % (d.x, d.y, d.z), "| materials", len(bpy.data.materials), "images", len(bpy.data.images), flush=True)
