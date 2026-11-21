# Composite version 2: rendered Moon+Earth over the real star field, then glow and grade.
import os, sys, math, numpy as np, cv2
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__))); import cam2
FG, CROP, OUT, A, B, NF = sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4]), int(sys.argv[5]), int(sys.argv[6])
E = lambda k, d: float(os.environ.get(k, d))
W, H = cam2.W, cam2.H
crop = np.load(CROP).astype(np.float32)[:, :, ::-1].copy(); c0, r0 = np.load(CROP + ".off.npy")     # to BGR
M = cam2.scene_to_equatorial(); rng = np.random.default_rng(5)
yv, xv = np.mgrid[0:H, 0:W].astype(np.float32); vig = 1 - 0.14 * (((xv - W / 2) / (W / 2)) ** 2 + ((yv - H / 2) / (H / 2)) ** 2) / 2
def rd(p):
    a = cv2.imread(p, cv2.IMREAD_UNCHANGED).astype(np.float32); return a / (65535.0 if a.max() > 255 else 255.0)
for i in range(A, B + 1):
    t = i / (NF - 1); col, row = cam2.sky_uv(t, M)
    sky = cv2.remap(crop, (col - c0).astype(np.float32), (row - r0).astype(np.float32), cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE); sky = np.clip(sky, 0, None)
    k = E("SKYGAIN", 9.0); sky = 1 - np.exp(-k * sky); sky = sky ** (1 / E("SKYGAMMA", 1.6))                 # soft-clipped exposure for the star field
    f = rd(f"{FG}/f_{i:04d}.png")
    if f.shape[0] != H: f = cv2.resize(f, (W, H), interpolation=cv2.INTER_CUBIC)
    a = f[:, :, 3:4]; img = f[:, :, :3] * a + sky * (1 - a)
    hi = np.clip(img - 0.70, 0, None)
    img = img + 0.50 * cv2.GaussianBlur(hi, (0, 0), 7) + 0.75 * cv2.GaussianBlur(hi, (0, 0), 34) * np.float32([1.12, 1.0, 0.92])
    lum = img.mean(2, keepdims=True); wgt = np.clip(lum * 1.5, 0, 1)
    img = img * (np.float32([1.07, 1.0, 0.95]) * (1 - wgt) + np.float32([0.94, 1.0, 1.045]) * wgt)       # cool shadows, warm sunlight (BGR)
    img = np.clip(img, 0, 1); img = img * img * (3 - 2 * img) * 0.30 + img * 0.70
    img = img * vig[:, :, None]
    cv2.imwrite(f"{OUT}/c_{i:04d}.png", np.clip(img * 255 + rng.uniform(-0.5, 0.5, img.shape), 0, 255).astype(np.uint8))
print("done", A, B)
