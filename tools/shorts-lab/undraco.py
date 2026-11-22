# Rewrite a Draco-compressed .glb as a plain .glb that the bpy pip package can import. usage: python undraco.py in.glb out.glb
import sys, json, struct, numpy as np, DracoPy
src, dst = sys.argv[1], sys.argv[2]
f = open(src, "rb"); magic, ver, total = struct.unpack("<4sII", f.read(12)); n, _ = struct.unpack("<I4s", f.read(8)); J = json.loads(f.read(n)); n, _ = struct.unpack("<I4s", f.read(8)); BIN = f.read(n)
views = J.get("bufferViews", []); acc = J["accessors"]; out = bytearray(); newviews = []
def view_bytes(i):
    v = views[i]; o = v.get("byteOffset", 0); return BIN[o:o + v["byteLength"]]
def add(data, target=None):
    while len(out) % 4: out.append(0)
    v = {"buffer": 0, "byteOffset": len(out), "byteLength": len(data)}
    if target: v["target"] = target
    out.extend(data); newviews.append(v); return len(newviews) - 1
draco_views = set(); remap = {}
for m in J.get("meshes", []):
    for p in m["primitives"]:
        e = p.get("extensions", {}).get("KHR_draco_mesh_compression")
        if e: draco_views.add(e["bufferView"])
for i in range(len(views)):                      # keep everything that is not Draco data (images, animation, plain meshes)
    if i in draco_views: continue
    v = dict(views[i]); data = view_bytes(i); k = add(data, v.get("target"))
    if "byteStride" in v: newviews[k]["byteStride"] = v["byteStride"]
    remap[i] = k
for a in acc:
    if "bufferView" in a: a["bufferView"] = remap[a["bufferView"]]
for im in J.get("images", []):
    if "bufferView" in im: im["bufferView"] = remap[im["bufferView"]]
def set_acc(i, arr, ctype, typ, target):
    a = acc[i]; a["bufferView"] = add(arr.tobytes(), target); a["byteOffset"] = 0; a["componentType"] = ctype; a["count"] = len(arr) if typ != "SCALAR" else arr.size; a["type"] = typ
    a.pop("normalized", None); a.pop("sparse", None)
    if typ == "VEC3" and arr.dtype == np.float32: a["min"] = arr.min(0).tolist(); a["max"] = arr.max(0).tolist()
    else: a.pop("min", None); a.pop("max", None)
npr = 0
for m in J.get("meshes", []):
    for p in m["primitives"]:
        e = p.get("extensions", {}).pop("KHR_draco_mesh_compression", None)
        if not e: continue
        if not p["extensions"]: p.pop("extensions")
        d = DracoPy.decode(view_bytes(e["bufferView"])); npr += 1
        pts = np.asarray(d.points, np.float32).reshape(-1, 3); set_acc(p["attributes"]["POSITION"], pts, 5126, "VEC3", 34962)
        keep = {"POSITION"}
        if "NORMAL" in p["attributes"] and d.normals is not None and len(d.normals):
            set_acc(p["attributes"]["NORMAL"], np.asarray(d.normals, np.float32).reshape(-1, 3), 5126, "VEC3", 34962); keep.add("NORMAL")
        if "TEXCOORD_0" in p["attributes"] and d.tex_coord is not None and len(d.tex_coord):
            set_acc(p["attributes"]["TEXCOORD_0"], np.asarray(d.tex_coord, np.float32).reshape(len(pts), -1)[:, :2].copy(), 5126, "VEC2", 34962); keep.add("TEXCOORD_0")
        p["attributes"] = {k: v for k, v in p["attributes"].items() if k in keep}
        if "indices" in p: set_acc(p["indices"], np.asarray(d.faces, np.uint32).reshape(-1), 5125, "SCALAR", 34963)
J["bufferViews"] = newviews; J["buffers"] = [{"byteLength": len(out)}]
for k in ("extensionsRequired", "extensionsUsed"):
    if k in J:
        J[k] = [x for x in J[k] if x not in ("KHR_draco_mesh_compression", "KHR_mesh_quantization")]
        if not J[k]: J.pop(k)
js = json.dumps(J, separators=(",", ":")).encode(); js += b" " * (-len(js) % 4); out += b"\0" * (-len(out) % 4)
with open(dst, "wb") as g:
    g.write(struct.pack("<4sII", b"glTF", 2, 12 + 8 + len(js) + 8 + len(out))); g.write(struct.pack("<I4s", len(js), b"JSON")); g.write(js); g.write(struct.pack("<I4s", len(out), b"BIN\0")); g.write(bytes(out))
print("ok", src.split("/")[-1], "primitives decoded", npr, "size", len(out))
