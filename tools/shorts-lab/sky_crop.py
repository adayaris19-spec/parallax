# Cut the part of NASA's 64k star map that this shot can see, and check its orientation against a known star.
import sys, math, numpy as np, OpenEXR, Imath
sys.path.insert(0, sys.argv[3]); import cam2
src, out = sys.argv[1], sys.argv[2]
M = cam2.scene_to_equatorial()
cs, rs = [], []
for t in (0.0, 1.0):
    c, r = cam2.sky_uv(t, M); cs += [c.min(), c.max()]; rs += [r.min(), r.max()]
c0, c1, r0, r1 = int(min(cs)) - 64, int(max(cs)) + 64, int(min(rs)) - 64, int(max(rs)) + 64
print("crop cols", c0, c1, "rows", r0, r1)
f = OpenEXR.InputFile(src); hdr = f.header(); print("channels", list(hdr["channels"].keys()), "dataWindow", hdr["dataWindow"].max.x + 1, hdr["dataWindow"].max.y + 1)
HALF = Imath.PixelType(Imath.PixelType.HALF); Wd = hdr["dataWindow"].max.x + 1
def rows(a, b):
    out = []
    for ch in "RGB":
        buf = f.channel(ch, HALF, a, b - 1); out.append(np.frombuffer(buf, np.float16).reshape(b - a, Wd))
    return out
parts = []
for a in range(r0, r1, 256):
    b = min(a + 256, r1); R_, G_, B_ = rows(a, b)
    parts.append(np.stack([R_[:, c0:c1], G_[:, c0:c1], B_[:, c0:c1]], -1).copy())
crop = np.concatenate(parts, 0); np.save(out, crop); np.save(out + ".off.npy", np.array([c0, r0]))
print("crop", crop.shape, "max", float(crop.max()), "median", float(np.median(crop.astype(np.float32))))
# orientation check: Antares (RA 247.352 deg, Dec -26.432 deg) must be one of the brightest things near its predicted pixel
ra, dec = 247.352, -26.432
ac, ar = (0.5 - ra / 360) % 1 * Wd - 0.5, (0.5 - dec / 180) * (Wd // 2) - 0.5
a, b = int(ar) - 40, int(ar) + 40; R_, G_, B_ = rows(a, b)
win = (R_ + G_ + B_)[:, int(ac) - 40:int(ac) + 40].astype(np.float32); yy, xx = np.unravel_index(win.argmax(), win.shape)
band = (R_ + G_ + B_)[:, int(ac) - 2000:int(ac) + 2000].astype(np.float32)
print("Antares predicted px", round(ac), round(ar), "| brightest within 40 px:", float(win.max()), "at offset", xx - 40, yy - 40, "| brightest within 2000 px of it:", float(band.max()), "| red/blue there:", float(R_[yy, int(ac) - 40 + xx]), float(B_[yy, int(ac) - 40 + xx]))
