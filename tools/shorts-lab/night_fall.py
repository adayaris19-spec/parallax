# Night falling on one place, and day coming back, on a real moving shot of that place in sunlight.
#
# What it does to each frame of the source shot:
#   - a shadow edge travels across the ground. The edge is a straight line on the ground, so in the picture it turns about its
#     vanishing point (VP); it starts on the shadow the source shot already has. Ground inside the shadow takes the colour the
#     source's own shadows have (measured: 0.217, 0.228, 0.296 of the sunlit ground), so the new dark matches the old.
#   - the sky, and anything already as dark as a shadow, is left alone.
#   - lamps switch on at places picked on the real objects in one reference frame and followed through the shot. A lamp shows the
#     ground around it as the source shot has it (so the detail is real), tinted with the lamp's colour.
# Modelled by us: the moving shadow, how dark the night gets, every lamp. The place, the objects and the camera move are the source's.
#
# usage: python night_fall.py SOURCE.mp4 SPEC.json OUT.mp4 [frame numbers to write as stills instead, e.g. 0,60,120]
import os, sys, json, math, subprocess, numpy as np, cv2
src, spec, out = sys.argv[1], json.load(open(sys.argv[2])), sys.argv[3]; stills = [int(v) for v in sys.argv[4].split(",")] if len(sys.argv) > 4 else None
W, H, FPS = 1080, 1920, 24; x0, y0 = spec["window"]; f0, f1, REF = spec["source_frames"][0], spec["source_frames"][1], spec["ref_frame"]; order = spec.get("order", "forward")
raw = subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-i", src, "-vf", f"select=between(n\\,{f0}\\,{f1}),crop={W}:{H}:{x0}:{y0}", "-vsync", "0", "-f", "rawvideo", "-pix_fmt", "bgr24", "-"], capture_output=True, check=True).stdout
F = np.frombuffer(raw, np.uint8).reshape(-1, H, W, 3); n = len(F); print("source frames", n, flush=True)
gray = [cv2.cvtColor(f, cv2.COLOR_BGR2GRAY) for f in F]

# ---------- follow the lamp places and a few far points through the shot, both ways from the reference frame
L = spec["lamps"]; pts0 = [];
for l in L: pts0 += [l["at"], l.get("ground", l["at"])]
far0 = spec["far_points"]; P0 = np.array(pts0 + far0, np.float32).reshape(-1, 1, 2); T = np.zeros((n, len(P0), 2), np.float32); r = REF - f0; T[r] = P0[:, 0]
lk = dict(winSize=(41, 41), maxLevel=4, criteria=(cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 40, 0.01))
for rng in (range(r + 1, n), range(r - 1, -1, -1)):
    prev = r; p = P0.copy()
    for i in rng:
        q, st, _ = cv2.calcOpticalFlowPyrLK(gray[prev], gray[i], p, None, **lk); d = (q - p)[:, 0]; med = np.median(d[st[:, 0] == 1], 0) if st.any() else np.zeros(2)
        bad = (st[:, 0] == 0) | (np.linalg.norm(d - med, axis=1) > 6.0); q[bad, 0] = p[bad, 0] + med          # a point that slips is carried along with the rest
        T[i] = q[:, 0]; p = q; prev = i
nl = len(L); far = T[:, 2 * nl:]; vp = np.array(spec["vp"], np.float32)[None] + np.median(far - far[r][None], 1)      # the vanishing point moves as the far ground does
spread = lambda a: np.linalg.norm(a - a.mean(0), axis=1).mean(); scale = np.array([spread(T[i, :2 * nl]) for i in range(n)]) / spread(T[r, :2 * nl])
print("lamp places moved up to %.0f px; scale %.2f to %.2f; vanishing point from" % (np.abs(T - T[r][None]).max(), scale.min(), scale.max()), vp[0].round(0), "to", vp[-1].round(0), flush=True)

# ---------- the timeline: values at times, joined smoothly
def key(track, t):
    k = spec[track]; ts = [a for a, _ in k]; vs = [b for _, b in k]
    if t <= ts[0]: return vs[0]
    if t >= ts[-1]: return vs[-1]
    j = max(i for i in range(len(ts)) if ts[i] <= t); u = (t - ts[j]) / (ts[j + 1] - ts[j]); u = u * u * (3 - 2 * u); return vs[j] + (vs[j + 1] - vs[j]) * u
K = np.array(spec.get("shadow_rgb", [0.217, 0.228, 0.296]), np.float32)[::-1]; SOFT = spec.get("edge_soft_deg", 30.0); yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
rs = np.random.default_rng(spec.get("seed", 4)); WAVES = [(rs.uniform(1.4, 4.2), rs.uniform(0, 6.28), a) for a in (3.2, 2.2, 1.4, 0.9)]      # the edge is the shadow of a ridge line, not of a ruler: it wanders by a few degrees along its length
def wander(rad): lr = np.log(np.maximum(rad, 8.0)); return sum(a * np.sin(f * lr * 2.2 + ph) for f, ph, a in WAVES)
def cover(ang, rad, A):
    m = np.clip((A - ang - wander(rad)) / SOFT + 0.5, 0, 1); return m * m * (3 - 2 * m)
def lamp_on(k_, i, t):
    """a lamp switches itself on a moment after the shadow reaches it, and off when the sunlight is back"""
    gx, gy = T[i, 2 * k_ + 1]; d = 0.16 + 0.09 * ((k_ * 7) % 5); a = math.degrees(math.atan2(gy - vp[i, 1], gx - vp[i, 0])); rad = math.hypot(gx - vp[i, 0], gy - vp[i, 1])
    return float(np.clip((cover(np.float32(a), np.float32(rad), key("edge_deg", t - d)) - 0.72) / 0.08, 0, 1))
def frame(j):
    """j: output frame number"""
    i = j if order == "forward" else n - 1 - j; t = j / FPS; o = F[i].astype(np.float32); lum = gray[i].astype(np.float32)
    dark = (lum < 30).astype(np.uint8); _, lab = cv2.connectedComponents(dark, connectivity=4); top = np.unique(lab[0][dark[0] > 0]); sky = np.isin(lab, top) & (dark > 0)       # the sky: the dark that reaches the top edge
    _, glab, st, _ = cv2.connectedComponentsWithStats((~sky).astype(np.uint8), connectivity=4); big = 1 + int(np.argmax(st[1:, cv2.CC_STAT_AREA])); ground = cv2.GaussianBlur((glab == big).astype(np.float32), (0, 0), 2.0)   # the ground: the largest piece that is not sky (this leaves the Earth out)
    A = key("edge_deg", t); deep = key("deep", t); ang = np.degrees(np.arctan2(yy - vp[i, 1], xx - vp[i, 0]))                         # 0 = to the right along the horizon, 90 = straight down
    m = cover(ang, np.hypot(xx - vp[i, 0], yy - vp[i, 1]), A); m[ang < 0] = 0.0
    crest = float(np.clip((A - 150.0) / 40.0, 0, 1)); m = np.maximum(m, crest * (ang < 6)) * ground                                 # the high far ground keeps the light longest
    wb = np.clip((cv2.GaussianBlur(lum, (0, 0), 1.2) - 48.0) / 20.0, 0, 1)[..., None]; target = o * (K[None, None] * deep * wb + (1 - wb) * deep ** 0.5); res = o + (target - o) * m[..., None]
    pool = np.zeros((H, W, 3), np.float32); core = np.zeros((H, W, 3), np.float32); s = float(scale[i])
    for k_, l in enumerate(L):
        v = lamp_on(k_, i, t); ON[k_].append(v)
        if v <= 0: continue
        (ax, ay), (gx, gy) = T[i, 2 * k_], T[i, 2 * k_ + 1]; R = l.get("reach", 90.0) * s; col = np.array(l.get("color", [1.0, 0.86, 0.66]), np.float32)[::-1]
        x_a, x_b, y_a, y_b = int(max(gx - 3.2 * R, 0)), int(min(gx + 3.2 * R, W)), int(max(gy - 1.6 * R, 0)), int(min(gy + 1.6 * R, H))
        if x_b > x_a and y_b > y_a:
            g = np.exp(-(((xx[y_a:y_b, x_a:x_b] - gx) / R) ** 2 + ((yy[y_a:y_b, x_a:x_b] - gy) / (0.34 * R)) ** 2) * 1.6); pool[y_a:y_b, x_a:x_b] += (0.55 * v * l.get("gain", 1.0) * g)[..., None] * col
        rr = l.get("glow", 34.0) * s; x_a, x_b, y_a, y_b = int(max(ax - 3 * rr, 0)), int(min(ax + 3 * rr, W)), int(max(ay - 3 * rr, 0)), int(min(ay + 3 * rr, H))
        if x_b > x_a and y_b > y_a:
            d2 = (xx[y_a:y_b, x_a:x_b] - ax) ** 2 + (yy[y_a:y_b, x_a:x_b] - ay) ** 2; pool[y_a:y_b, x_a:x_b] += (0.38 * v * l.get("gain", 1.0) * np.exp(-d2 / (rr * rr)))[..., None] * col
            c = np.exp(-d2 / (2 * (l.get("size", 3.0) * s) ** 2)) + 0.30 * np.exp(-d2 / (2 * (l.get("size", 3.0) * s * 4.5) ** 2)); core[y_a:y_b, x_a:x_b] += (255.0 * v * c)[..., None] * (0.55 + 0.45 * col)
    amount = np.clip(pool.max(2, keepdims=True), 0, 0.85); tint = pool / np.maximum(pool.max(2, keepdims=True), 1e-6); res = res + np.maximum(o * tint * amount - res, 0) * (m * ground)[..., None]      # lamp light is added to the dim ground, and shows it as the source shot has it
    res = res + core * (0.25 + 0.75 * m[..., None])                                                         # a lamp in full sunlight hardly shows
    return np.clip(res, 0, 255).astype(np.uint8)
total = spec.get("frames", n); ON = [[] for _ in L]
if stills:
    for j in stills: cv2.imwrite(f"{os.path.splitext(out)[0]}_{j:03d}.png", frame(j))
    print("wrote stills", stills)
else:
    ff = subprocess.Popen(["ffmpeg", "-nostdin", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-", "-c:v", "libx264", "-crf", "10", "-preset", "fast", "-pix_fmt", "yuv420p", out], stdin=subprocess.PIPE)
    for j in range(total): ff.stdin.write(frame(j).tobytes())
    ff.stdin.close(); ff.wait(); print("wrote", out, total, "frames")
    sw = [[round(j / FPS, 2) for j in range(1, len(v)) if (v[j] > 0.5) != (v[j - 1] > 0.5)] for v in ON]; json.dump({"switch_times": sw}, open(os.path.splitext(out)[0] + "_lamps.json", "w")); print("lamp switch times", sw)
