# Cuts the part of the sky a take can see out of one of NASA's Deep Star Maps 2020 (svs.gsfc.nasa.gov/4851), so night_fall.py
# does not have to hold the whole map. The maps are the whole sky as one picture: right ascension grows leftwards from the middle,
# north is up. starmap_2020_32k.exr (1.5 GB) is 91 px per degree, close to the 105 px per degree of the Moon base take.
#
# usage: python sky_cut.py SPEC.json STARMAP.exr OUT.npy
#   SPEC.json: a night_fall.py spec with "stars" (px_per_deg, sun_xy, sun_ecl_lon), "size" and "sky_ext"
#   writes OUT.npy (float16, RGB) and OUT.npy.json (where the cut sits in the whole map); name OUT.npy in the spec as stars.sky_map.file
import sys, json, math, numpy as np, OpenEXR, Imath
spec = json.load(open(sys.argv[1])); st = spec["stars"]; ppd = st["px_per_deg"]; sx, sy = st["sun_xy"]; lam_s = st["sun_ecl_lon"]; eps = math.radians(23.4393); W, H = spec["size"]; EXT = spec.get("sky_ext", 0)
f = OpenEXR.InputFile(sys.argv[2]); dw = f.header()["dataWindow"]; FW, FH = dw.max.x - dw.min.x + 1, dw.max.y - dw.min.y + 1
# the corners and edges of the take's picture (with the sky made above it), turned back into right ascension and declination: the same view night_fall.py uses for the stars
ys, xs = np.mgrid[-EXT - 100:H + 100:20, -100:W + 100:20].astype(float); beta = np.radians((ys - sy) / ppd); lam = np.radians(lam_s) + np.radians((xs - sx) / ppd) / np.maximum(np.cos(beta), 0.2)
xe, ye, ze = np.cos(beta) * np.cos(lam), np.cos(beta) * np.sin(lam), np.sin(beta); yq = ye * math.cos(eps) - ze * math.sin(eps); zq = ye * math.sin(eps) + ze * math.cos(eps)
ra = np.mod(np.arctan2(yq, xe), 2 * math.pi); dec = np.arcsin(zq); col = np.mod(0.5 - ra / (2 * math.pi), 1.0) * FW; row = (0.5 - dec / math.pi) * FH
if col.max() - col.min() > FW / 2: raise SystemExit("the view crosses the map's left and right edge; not handled")
c0, c1, r0, r1 = max(int(col.min()) - 8, 0), min(int(col.max()) + 8, FW), max(int(row.min()) - 8, 0), min(int(row.max()) + 8, FH)
pt = Imath.PixelType(Imath.PixelType.HALF); out = np.zeros((r1 - r0, c1 - c0, 3), np.float16)
for k, ch in enumerate("RGB"): out[..., k] = np.frombuffer(f.channel(ch, pt, r0, r1 - 1), np.float16).reshape(r1 - r0, FW)[:, c0:c1]      # only the rows needed are read
meta = {"full_w": FW, "full_h": FH, "col0": c0, "row0": r0}
if FW / 360.0 > 1.25 * ppd:                                              # a finer map than the take needs is brought down by area here, once, so each star keeps its light and the file stays small
    import cv2; z = ppd / (FW / 360.0); out = cv2.resize(out.astype(np.float32), None, fx=z, fy=z, interpolation=cv2.INTER_AREA).astype(np.float16); meta = {k: v * z for k, v in meta.items()}
np.save(sys.argv[3], out); json.dump(meta, open(sys.argv[3] + ".json", "w"))
print("right ascension %.1f to %.1f, declination %.1f to %.1f degrees; wrote" % (np.degrees(ra.min()), np.degrees(ra.max()), np.degrees(dec.min()), np.degrees(dec.max())), sys.argv[3], out.shape)
