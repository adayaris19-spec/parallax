# The held-still astronaut cut out of his shot. Sky: by darkness. Ground on his lit side: he starts where the row first turns
# suit-white. Ground on his shaded side: his arm is smooth, the ground is ribbed with wheel tracks; the edge is read once from the
# time-averaged picture (the arm hardly moves) and used for every frame. It was read by eye, to a few pixels; arm and ground are
# the same dark grey there, so a few pixels either way do not show.
#
# usage: python astro_cut.py DIR/         (DIR/stab.npy and DIR/stab_valid.npy in, from astro_stab.py; DIR/astro_cut.npy out:
#   frames x height x width x 4, colour and cover, which night_fall.py reads as overlay.cut)
# HZ and EDGE below belong to this one shot.
import cv2, numpy as np, sys
S = sys.argv[1]; st = np.load(S + "stab.npy", mmap_mode="r"); valid = np.load(S + "stab_valid.npy", mmap_mode="r"); n, H, W = st.shape[:3]
med = np.median(st[::2], 0).astype(np.uint8); gm = cv2.cvtColor(med, cv2.COLOR_BGR2GRAY).astype(np.float32)
HZ = 600; EDGE = [(560, 840), (590, 858), (620, 880), (650, 895), (700, 900), (900, 900), (930, 915), (950, 935), (1000, 940), (1080, 935)]      # the shaded side's edge, read off the time-averaged picture: (row, column)
xr0 = np.interp(np.arange(H), [e[0] for e in EDGE], [e[1] for e in EDGE]).astype(np.float32) - 4.0
# the arm does move a little as he turns: its folds are found again in every frame, and the edge goes with them. The edge is set a
# few pixels inside the arm on purpose: a sliver of dark arm lost does not show, a sliver of ribbed ground kept does
tpl = gm[650:900, 790:880].astype(np.uint8); shift = []
for k in range(n):
    gk = cv2.cvtColor(np.ascontiguousarray(st[k][630:920, 730:940]), cv2.COLOR_BGR2GRAY); res = cv2.matchTemplate(gk, tpl, cv2.TM_CCOEFF_NORMED); _, mx, _, loc = cv2.minMaxLoc(res); shift.append((loc[0] - 60, loc[1] - 20, mx))
shift = np.array(shift, np.float32); sx_ = cv2.blur(cv2.medianBlur(np.clip(shift[:, 0] + 100, 0, 255).astype(np.uint8)[:, None], 5).astype(np.float32), (1, 7))[:, 0] - 100
print("arm found in every frame with match %.2f to %.2f; it shifts from %+.0f to %+.0f px across the frames" % (shift[:, 2].min(), shift[:, 2].max(), sx_[0], sx_[-1]))
def reach(mask):
    k, lab, s_, _ = cv2.connectedComponentsWithStats(mask.astype(np.uint8), connectivity=4); ids = np.unique(np.concatenate([lab[0], lab[:, 0], lab[:, -1]])); return np.isin(lab, [c for c in ids if c != 0 and s_[c, cv2.CC_STAT_AREA] > 300])
out = np.zeros((n, H, W, 4), np.uint8); xs = np.arange(W, dtype=np.float32)[None]
XL = []                                                                   # his lit side, row by row, in every frame; then steadied over seven frames so the outline does not twitch
for k in range(n):
    g = cv2.GaussianBlur(cv2.cvtColor(np.ascontiguousarray(st[k]), cv2.COLOR_BGR2GRAY), (0, 0), 1.0); run = cv2.erode((g > 150).astype(np.uint8), np.ones((1, 13), np.uint8)); first = np.minimum(np.where(run.any(1), run.argmax(1), W).astype(np.float32), 600)
    XL.append(cv2.blur(cv2.medianBlur(np.clip(first / 3.0, 0, 255).astype(np.uint8)[:, None], 41).astype(np.float32) * 3.0, (1, 15))[:, 0] - 7.0)
XL = np.array(XL); XL = np.array([np.median(XL[max(k - 3, 0):k + 4], 0) for k in range(n)])
for k in range(n):
    a = np.ascontiguousarray(st[k]); g = cv2.GaussianBlur(cv2.cvtColor(a, cv2.COLOR_BGR2GRAY), (0, 0), 1.0)
    dark = (g < 16) | (valid[k] == 0); sky = reach(dark); wide = (g < 46) | (valid[k] == 0); R = 9
    core = reach(cv2.erode(wide.astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * R + 1, 2 * R + 1))) > 0); sky = sky | ((cv2.dilate(core.astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * R + 3, 2 * R + 3))) > 0) & wide)
    sky = cv2.medianBlur(sky.astype(np.uint8), 9) > 0; body = ~sky
    xl = XL[k]
    below = (np.arange(H)[:, None] >= HZ - 20); xr = xr0 - 8.0 + 2.0 * sx_[k]; inside = (xs >= xl[:, None]) & (xs <= xr[:, None]); body = body & (~below | inside)
    body[:, W - 108:] = False; body = cv2.morphologyEx(body.astype(np.uint8), cv2.MORPH_OPEN, np.ones((5, 5), np.uint8)); k2, lab, s_, _ = cv2.connectedComponentsWithStats(body, connectivity=8)
    out[k, ..., :3] = a; out[k, ..., 3] = (lab == 1 + int(np.argmax(s_[1:, cv2.CC_STAT_AREA]))).astype(np.uint8)
masks = out[..., 3].copy()                                                # a pixel belongs to him if it does in most of the five frames around: nothing in the outline may appear for one frame and go again
for k in range(n):
    body = (masks[max(k - 2, 0):k + 3].astype(np.float32).mean(0) > 0.5).astype(np.float32); al = cv2.GaussianBlur(cv2.erode(body, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))), (0, 0), 1.2); out[k, ..., 3] = np.clip(al * 255, 0, 255).astype(np.uint8)
np.save(S + "astro_cut.npy", out); print("saved", out.shape)
bg = np.zeros((H, W, 3), np.float32); bg[:] = (62, 44, 38)
show = []
for k in (0, 33, 66, 99):
    al = out[k, ..., 3:].astype(np.float32) / 255; show.append((out[k, ..., :3] * al + bg * (1 - al)).astype(np.uint8))
cv2.imwrite(S + "cut_row.png", np.hstack([cv2.resize(s_, None, fx=0.6, fy=0.6) for s_ in show])); cv2.imwrite(S + "right_strip.png", np.hstack([(out[k, 520:1040, 780:1040, :3] * (out[k, 520:1040, 780:1040, 3:] / 255.0) + bg[520:1040, 780:1040] * (1 - out[k, 520:1040, 780:1040, 3:] / 255.0)).astype(np.uint8) for k in (0, 20, 40, 60, 70, 80, 90, 99)]))
