import sys, numpy as np, cv2
src, out = sys.argv[1], sys.argv[2]
a = cv2.imread(src, cv2.IMREAD_UNCHANGED).astype(np.float32); a = a[:, :, :3] / (65535.0 if a.max() > 255 else 255.0)
H, W = a.shape[:2]; rng = np.random.default_rng(2)
lum = a.mean(2, keepdims=True)
a = lum + (a - lum) * 1.28                                   # saturation
a = np.clip(a, 0, 1); a = (a * a * (3 - 2 * a)) * 0.55 + a * 0.45   # contrast curve
a = np.clip((a - 0.035) / 0.965, 0, 1)                        # set the black point (the source imagery is hazy)
hi = np.clip(a - 0.72, 0, None); a = a + 0.45 * cv2.GaussianBlur(hi, (0, 0), 8) + 0.55 * cv2.GaussianBlur(hi, (0, 0), 30)
yv, xv = np.mgrid[0:H, 0:W].astype(np.float32); vig = 1 - 0.16 * (((xv - W / 2) / (W / 2)) ** 2 + ((yv - H / 2) / (H / 2)) ** 2) / 2
a = a * vig[:, :, None]
cv2.imwrite(out, np.clip(a * 255 + rng.uniform(-0.5, 0.5, a.shape), 0, 255).astype(np.uint8))
