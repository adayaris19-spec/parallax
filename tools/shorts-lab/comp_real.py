# Camera response for scene-linear frames: one exposure for the whole frame, lens glare, a film-like curve, sensor noise. No stars are added.
# usage: python comp_real.py IN_DIR OUT_DIR first last      env: EV, GLARE, GRAIN
import os, sys, numpy as np
os.environ["OPENCV_IO_ENABLE_OPENEXR"] = "1"
import cv2
src, dst, A, B = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4]); E = lambda k, d: float(os.environ.get(k, d)); os.makedirs(dst, exist_ok=True)
import OpenEXR, Imath
def read_exr(path):                 # returns BGR float32, scene-linear
    f = OpenEXR.InputFile(path); dw = f.header()["dataWindow"]; W, H = dw.max.x - dw.min.x + 1, dw.max.y - dw.min.y + 1; pt = Imath.PixelType(Imath.PixelType.FLOAT)
    return np.stack([np.frombuffer(f.channel(c, pt), np.float32).reshape(H, W) for c in ("B", "G", "R")], -1).copy()
def blur(a, s): return cv2.GaussianBlur(a, (0, 0), s)
def curve(x):                       # filmic shoulder and toe (Hable), white point 11.2
    a, b, c, d, e, f = 0.22, 0.30, 0.10, 0.20, 0.01, 0.30; h = lambda v: ((v * (a * v + c * b) + d * e) / (v * (a * v + b) + d * f)) - e / f
    return h(x) / h(11.2)
for i in range(A, B + 1):
    img = read_exr(f"{src}/f_{i:04d}.exr"); H, W = img.shape[:2]; img = np.clip(img, 0, 500.0) * 2.0 ** E("EV", 2.1)
    cl = np.minimum(img, 6.0)                                               # light a lens can scatter (clipped so one hot pixel cannot flood the frame)
    img = img + E("GLARE", 0.8) * (0.0045 * blur(cl, 90) + 0.010 * blur(cl, 22) + 0.030 * blur(np.clip(cl - 1.0, 0, None), 5))      # veiling glare and a little halation around bright things
    img = blur(img, 0.6)                                                    # lens softness
    out = curve(img * 1.9); lum = out.mean(2, keepdims=True); out = lum + (out - lum) * 1.06
    yv, xv = np.mgrid[0:H, 0:W].astype(np.float32); out *= (1 - 0.14 * (((xv - W / 2) / (W / 2)) ** 2 + ((yv - H / 2) / (H / 2)) ** 2) / 2)[:, :, None]
    out = np.clip(out, 0, 1) ** (1 / 2.2)
    rng = np.random.default_rng(1000 + i); g = rng.normal(0, 1, (H, W, 1)).astype(np.float32); g = g * 0.75 + blur(g, 0.8)[:, :, None] * 0.6
    out = out + E("GRAIN", 0.016) * g * (0.55 + 0.9 * (1 - out)) + 0.010                 # sensor noise, stronger in the dark, and a small black offset
    cv2.imwrite(f"{dst}/c_{i:04d}.png", (np.clip(out, 0, 1) * 255 + 0.5).astype(np.uint8))
print("done", A, B)
