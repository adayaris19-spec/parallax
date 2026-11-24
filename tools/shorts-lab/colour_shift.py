# The source's three colours put back on top of each other.
#
# NASA's animation carries a lens effect: toward the edges of the frame red is drawn a little further out than green and blue
# a little further in (or the other way round), so every hard edge there has a blue rim on one side and an orange one on the
# other, and the picture is less sharp than it was rendered. In the middle of the frame there is none. Here the shift of red
# and of blue against green is measured on the frames' own hard edges (where each colour passes half-way from dark to bright,
# to a fraction of a pixel), fitted as a smooth shift away from a middle point that is the same on both sides of it (the middle
# point is fitted too), and undone. Nothing is invented: each colour is only moved back.
#
# usage: python colour_shift.py IN.raw W H OUT.raw      (IN.raw / OUT.raw: frames as bgr24, the cache night_fall.py reads; run after fuse_frames.py)
#   MEASURE=1  only measure, fit and print
import os, sys, numpy as np, cv2
src, W, H, out = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), sys.argv[4]
F = np.memmap(src, np.uint8, "r").reshape(-1, H, W, 3); N = len(F); gy, gx = np.mgrid[0:H, 0:W].astype(np.float32)
def cross(p):
    """where a profile across an edge passes half-way between its dark and its bright side"""
    lo, hi = np.percentile(p, 8), np.percentile(p, 92)
    if hi - lo < 60: return None
    q = (p - lo) / (hi - lo); idx = np.nonzero((q[:-1] < 0.5) != (q[1:] < 0.5))[0]
    if len(idx) != 1: return None
    i = idx[0]; return i + (0.5 - q[i]) / (q[i + 1] - q[i])
def edges(f, per=40000, seed=2):
    """for hard upright edges: x, y, 0, red - green, blue - green (px along x); for hard level edges the same along y, marked 1"""
    g = cv2.GaussianBlur(f[..., 1], (0, 0), 1.0); sx = cv2.Sobel(g, cv2.CV_32F, 1, 0, ksize=3); sy = cv2.Sobel(g, cv2.CV_32F, 0, 1, ksize=3); rec = []
    for axis, G1, G2 in ((0, sx, sy), (1, sy, sx)):
        ys, xs = np.nonzero((np.abs(G1) > 260) & (np.abs(G1) > 4 * np.abs(G2))); pick = np.random.default_rng(seed).choice(len(ys), min(per, len(ys)), replace=False)
        for y, x in zip(ys[pick], xs[pick]):
            if not (12 <= x < W - 12 and 12 <= y < H - 12): continue
            cr = [cross(f[y, x - 9:x + 10, c] if axis == 0 else f[y - 9:y + 10, x, c]) for c in (2, 1, 0)]
            if None not in cr: rec.append((x, y, axis, cr[0] - cr[1], cr[2] - cr[1]))
    return np.array(rec, np.float64)
def terms(X, Y):
    a, b = X * X / 1e6, Y * Y / 1e6; return [np.ones_like(a), a, b, a * a, a * b, b * b]      # even in both directions: the same on the left as on the right, above as below
def fit(rec, col):
    """shift along x = X * P(X^2, Y^2), along y = Y * Q(X^2, Y^2), X and Y counted from a middle point that is fitted too. P is read off the upright edges, Q off the level ones.
    Being the same on both sides of the middle, the fit also covers the side of the frame where the picture has few upright edges to measure."""
    best = None; up = rec[:, 2] == 0
    for cxx in range(1500, 2001, 25):
        for cyy in range(900, 1201, 25):
            X, Y = rec[:, 0] - cxx, rec[:, 1] - cyy; T_ = terms(X, Y); e = 0.0; ks = []
            for m, u in ((up, X), (~up, Y)):
                A = np.stack([u[m] * q[m] for q in T_], 1); d = rec[m, col]; keep = np.ones(len(d), bool)
                for _ in range(2): k = np.linalg.lstsq(A[keep], d[keep], rcond=None)[0]; r = np.abs(d - A @ k); keep = r <= np.percentile(r, 98)
                e += float((r[keep] ** 2).sum()); ks.append(k)
            if best is None or e < best[0]: best = (e, (cxx, cyy), ks)
    return float(np.sqrt(best[0] / len(rec))), best[1], best[2]
def undo(f, model):
    o = f.copy()
    for ch, (c0, ks) in model.items():
        X, Y = gx - c0[0], gy - c0[1]; T_ = terms(X, Y); sx_ = sum(k * q for k, q in zip(ks[0], T_)).astype(np.float32); sy_ = sum(k * q for k, q in zip(ks[1], T_)).astype(np.float32)
        o[..., ch] = cv2.remap(np.ascontiguousarray(f[..., ch]), gx + X * sx_, gy + Y * sy_, cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)
    return o
def zones(rec, col, label):
    X = rec[:, 0]; row = []
    for a, b in ((0, 300), (300, 700), (700, 1300), (1300, 2100), (2100, 2700), (2700, 3100), (3100, W)):
        m = (X >= a) & (X < b) & (rec[:, 2] == 0); row.append("%+.2f" % np.median(rec[m, col]) if m.sum() > 15 else "  . ")
    row2 = []
    for a, b in ((0, 300), (300, 700), (700, 1300), (1300, 2100), (2100, 2700), (2700, 3100), (3100, W)):
        m = (X >= a) & (X < b) & (rec[:, 2] == 1) & (rec[:, 1] > 1500); row2.append("%+.2f" % np.median(rec[m, col]) if m.sum() > 15 else "  . ")
    print("   %-22s along x on upright edges, by strip of the frame (left to right):" % label, " ".join(row), "| along y on level edges in the bottom rows:", " ".join(row2), "| rms %.2f px" % np.sqrt((rec[:, col] ** 2).mean()))
frames = [int(v) for v in np.linspace(3, N - 4, 8)]; rec = np.vstack([edges(np.ascontiguousarray(F[i]).astype(np.float32), seed=i) for i in frames]); print("hard edges measured:", len(rec), "(upright %d, level %d)" % ((rec[:, 2] == 0).sum(), (rec[:, 2] == 1).sum()))
model = {}
for ch, col, name in ((2, 3, "red"), (0, 4, "blue")):
    e, c0, ks = fit(rec, col); model[ch] = (c0, ks); sh = lambda X, Y, k: sum(kk * q for kk, q in zip(k, terms(np.float64(X), np.float64(Y))))
    print("%-4s against green: middle point at (%d, %d); shift 1000 px to the side of it %+.2f px, 1500 px to the side %+.2f px, 700 px below it %+.2f px; fit leaves %.2f px rms" % (name, c0[0], c0[1], 1000 * sh(1000, 0, ks[0]), 1500 * sh(1500, 0, ks[0]), 700 * sh(0, 700, ks[1]), e)); zones(rec, col, name + " before")
rec2 = np.vstack([edges(undo(np.ascontiguousarray(F[i]).astype(np.float32), model), seed=i) for i in frames])
for col, name in ((3, "red"), (4, "blue")): zones(rec2, col, name + " after undoing")
if os.environ.get("MEASURE"): sys.exit()
with open(out, "wb") as fh: fh.truncate(N * H * W * 3)
O = np.memmap(out, np.uint8, "r+").reshape(-1, H, W, 3); rng = np.random.default_rng(5)
for i in range(N):
    r = undo(np.ascontiguousarray(F[i]).astype(np.float32), model); v = np.clip(np.floor(r + rng.random((H, W, 1), dtype=np.float32)), 0, 255).astype(np.uint8); v[..., 1] = F[i][..., 1]; O[i] = v      # green is not touched at all
    if i % 20 == 0: print("frame", i, flush=True); O.flush()
O.flush(); print("wrote", N, "frames")
