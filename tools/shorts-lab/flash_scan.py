# A check for flicker: finds things that are brighter or darker for one or two frames and then go back.
# Each frame's neighbours are first moved onto it place by place (optical flow), so a camera move, near ground sliding against far
# ground, and things that travel across the picture are not counted; what is left is light that really changes for a frame.
# Something that appears and is gone within a frame or two (a short blink, a break in a thin line) is listed with place and time.
#
# usage: python flash_scan.py PICTURE.mp4 [OUT_DIR]     (use the picture without subtitles: a subtitle changing is a flash too)
#   with OUT_DIR, the five frames around each of the twelve strongest finds are written there as strips to look at
import sys, collections, numpy as np, cv2
f = sys.argv[1]; outdir = sys.argv[2] if len(sys.argv) > 2 else None; cap = cv2.VideoCapture(f); small = []; full = []
while True:
    ok, a = cap.read()
    if not ok: break
    g = cv2.cvtColor(a, cv2.COLOR_BGR2GRAY); small.append(cv2.resize(g, (540, 960), interpolation=cv2.INTER_AREA))
    if outdir: full.append(cv2.resize(a, (540, 960), interpolation=cv2.INTER_AREA))
n = len(small); fps = cap.get(cv2.CAP_PROP_FPS); gy, gx = np.mgrid[0:960, 0:540].astype(np.float32); ev = []; per = np.zeros(n)
def onto(a, b):
    """frame a moved onto frame b, place by place"""
    fl = cv2.calcOpticalFlowFarneback(b, a, None, 0.5, 4, 25, 3, 7, 1.5, 0); return cv2.remap(a, gx + fl[..., 0], gy + fl[..., 1], cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
blur = lambda x: cv2.GaussianBlur(x.astype(np.float32), (0, 0), 1.0)
for t in range(1, n - 1):
    b = blur(small[t]); a = blur(onto(small[t - 1], small[t])); c = blur(onto(small[t + 1], small[t]))
    for name, m in (("flash", np.minimum(b - a, b - c)), ("dip", np.minimum(a - b, c - b))):
        m = np.maximum(m, 0); m[:10] = 0; m[-10:] = 0; m[:, :10] = 0; m[:, -10:] = 0; per[t] += float((m > 12).sum()); y, x = np.unravel_index(m.argmax(), m.shape)
        if m[y, x] > 12: ev.append((float(m[y, x]), t, name, int(x) * 2, int(y) * 2, int((m > 8).sum())))
ev.sort(reverse=True); print(n, "frames at", fps, "fps; frames with something off for one frame:", len(set(e[1] for e in ev)), "; pixels off per frame (of %d): mean %.1f, worst %d at frame %d" % (540 * 960, per.mean(), per.max(), per.argmax()))
seen = set(); k = 0; shown = []
for v, t, name, x, y, area in ev:
    key = (t // 4, x // 100, y // 100)
    if key in seen: continue
    seen.add(key); print("  %5.2f s frame %3d  %-5s at (%4d,%4d) strength %3.0f area %d" % (t / fps, t, name, x, y, v, area)); shown.append((t, x, y)); k += 1
    if k >= 30: break
c = collections.Counter(int(e[1] / fps) for e in ev); print("finds per second:", [c.get(s_, 0) for s_ in range(int(n / fps) + 1)])
if outdir:
    import os; os.makedirs(outdir, exist_ok=True)
    for q, (t, x, y) in enumerate(shown[:12]):
        x0 = int(np.clip(x // 2 - 60, 0, 420)); y0 = int(np.clip(y // 2 - 50, 0, 860)); cv2.imwrite(os.path.join(outdir, "find_%02d_frame%03d.png" % (q, t)), np.hstack([cv2.resize(full[j][y0:y0 + 100, x0:x0 + 120], None, fx=3, fy=3, interpolation=cv2.INTER_NEAREST) for j in range(max(t - 2, 0), min(t + 3, n))]))
