# Composite version 3: one lens for every layer. Glare from Earth veils the stars near it, light wraps round edges,
# and the whole frame shares one softness, one grade and one grain.
import os, sys, math, numpy as np, cv2
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__))); import cam2
FG, CROP, OUT, A, B, NF = sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4]), int(sys.argv[5]), int(sys.argv[6])
E = lambda k, d: float(os.environ.get(k, d))
W, H = cam2.W, cam2.H
crop = np.load(CROP).astype(np.float32)[:, :, ::-1].copy(); c0, r0 = np.load(CROP + ".off.npy")
M = cam2.scene_to_equatorial()
yv, xv = np.mgrid[0:H, 0:W].astype(np.float32); vig = 1 - 0.18 * (((xv - W / 2) / (W / 2)) ** 2 + ((yv - H / 2) / (H / 2)) ** 2) / 2
fpx = (H / 2) / math.tan(math.radians(cam2.FOV / 2)); EARTH = np.array([0, 384400.0, -cam2.R])
def rd(p):
    a = cv2.imread(p, cv2.IMREAD_UNCHANGED).astype(np.float32); return a / (65535.0 if a.max() > 255 else 255.0)
def blur(a, s): return cv2.GaussianBlur(a, (0, 0), s)
for i in range(A, B + 1):
    t = i / (NF - 1); rng = np.random.default_rng(1000 + i)
    pos, d, up, right = cam2.cam_basis(t); v = EARTH - pos; dist = np.linalg.norm(v)
    ex = W / 2 + fpx * v.dot(right) / v.dot(d); ey = H / 2 - fpx * v.dot(up) / v.dot(d); er = fpx * 6371.0 / dist
    rr = np.sqrt((xv - ex) ** 2 + (yv - ey) ** 2) / er                      # distance from Earth's centre, in Earth radii
    col, row = cam2.sky_uv(t, M)
    sky = np.clip(cv2.remap(crop, (col - c0).astype(np.float32), (row - r0).astype(np.float32), cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE), 0, None)
    sky = (1 - np.exp(-E("SKYGAIN", 8.5) * sky)) ** (1 / 1.6)
    sl = sky.mean(2, keepdims=True); sky = sl + (sky - sl) * 0.80; sky = sky * np.float32([1.03, 1.0, 0.96])      # less brown, a little cooler (BGR)
    f = rd(f"{FG}/f_{i:04d}.png"); a = f[:, :, 3:4]; fg = f[:, :, :3]
    # 1. veiling glare: Earth's light scattered in the lens lifts the sky near it and washes out faint stars there
    veil = np.clip(0.60 * np.exp(-(np.maximum(rr - 1, 0)) / 0.55) + 0.28 * np.exp(-(np.maximum(rr - 1, 0)) / 2.2), 0, 1)[..., None]
    # the sunlit lunar limb does the same to the sky just above it
    lit = blur((fg * a).mean(2), 60)[..., None]; veil = np.clip(veil + 0.9 * lit, 0, 0.90)
    sky = sky * (1 - 0.72 * veil)
    img = fg * a + sky * (1 - a)
    glow = (0.11 * np.exp(-(np.maximum(rr - 1, 0)) / 0.45) + 0.045 * np.exp(-(np.maximum(rr - 1, 0)) / 2.4))[..., None] * np.float32([1.0, 0.72, 0.48])
    img = img + glow * (1 - a * 0.85)
    # 2. light wrap: a little of what is behind an object bleeds over its edge
    wrap = np.clip(blur((1 - a)[:, :, 0], 5)[..., None] - (1 - a), 0, 1)
    img = img + wrap * blur(img, 14) * 0.55
    # 3. bloom from every bright thing, shared
    hi = np.clip(img - 0.66, 0, None); img = img + 0.55 * blur(hi, 6) + 0.60 * blur(hi, 26) * np.float32([1.10, 1.0, 0.93]) + 0.35 * blur(hi, 90) * np.float32([1.15, 1.0, 0.90])
    # 4. one grade: cool shadows, warm light, a shared black floor
    lum = img.mean(2, keepdims=True); wgt = np.clip(lum * 1.5, 0, 1)
    img = img * (np.float32([1.08, 1.0, 0.94]) * (1 - wgt) + np.float32([0.94, 1.0, 1.05]) * wgt)
    img = np.clip(img, 0, 1); img = img * img * (3 - 2 * img) * 0.30 + img * 0.70
    img = np.float32([0.030, 0.022, 0.018]) + img * (1 - np.float32([0.030, 0.022, 0.018]))
    # 5. one lens softness and one grain over everything
    img = blur(img, 0.55); img = img + 0.35 * (img - blur(img, 1.6))
    img = img * vig[:, :, None]
    g = blur(rng.normal(0, 1, (H, W)).astype(np.float32), 0.7)[..., None] * E("GRAIN", 0.020)
    img = img + g * (0.35 + 0.65 * np.sqrt(np.clip(img.mean(2, keepdims=True), 0, 1)))
    cv2.imwrite(f"{OUT}/c_{i:04d}.png", np.clip(img * 255 + rng.uniform(-0.5, 0.5, img.shape), 0, 255).astype(np.uint8))
print("done", A, B, "earth px", round(ex), round(ey), "radius", round(er))
