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
far0 = spec.get("far_points", []); P0 = np.array(pts0 + far0, np.float32).reshape(-1, 1, 2); T = np.zeros((n, len(P0), 2), np.float32); r = REF - f0; T[r] = P0[:, 0]
lk = dict(winSize=(41, 41), maxLevel=4, criteria=(cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 40, 0.01))
for rng in (range(r + 1, n), range(r - 1, -1, -1)):
    prev = r; p = P0.copy()
    for i in rng:
        q, st, _ = cv2.calcOpticalFlowPyrLK(gray[prev], gray[i], p, None, **lk); d = (q - p)[:, 0]; med = np.median(d[st[:, 0] == 1], 0) if st.any() else np.zeros(2)
        bad = (st[:, 0] == 0) | (np.linalg.norm(d - med, axis=1) > 6.0); q[bad, 0] = p[bad, 0] + med          # a point that slips is carried along with the rest
        T[i] = q[:, 0]; p = q; prev = i
nl = len(L); far = T[:, 2 * nl:]
if spec.get("vp_track"):                                                 # the same shadow in every framing of one take: the point's place in each source frame, in the source's own pixels (written with WRITE_TRACK)
    tr = json.load(open(os.path.join(os.path.dirname(os.path.abspath(sys.argv[2])), spec["vp_track"]))); vp = np.array([tr["vp"][str(f)] for f in range(f0, f1 + 1)], np.float32) - np.array([x0, y0], np.float32)[None]
else: vp = np.array(spec["vp"], np.float32)[None] + np.median(far - far[r][None], 1)      # the vanishing point moves as the far ground does
if os.environ.get("WRITE_TRACK"): json.dump({"source": os.path.basename(src), "vp": {str(f0 + i): [round(float(vp[i, 0] + x0), 2), round(float(vp[i, 1] + y0), 2)] for i in range(n)}}, open(os.environ["WRITE_TRACK"], "w")); print("wrote track", os.environ["WRITE_TRACK"]); sys.exit()
spread = lambda a: np.linalg.norm(a - a.mean(0), axis=1).mean(); scale = np.array([spread(T[i, :2 * nl]) for i in range(n)]) / spread(T[r, :2 * nl])
print("lamp places moved up to %.0f px; scale %.2f to %.2f; vanishing point from" % (np.abs(T - T[r][None]).max(), scale.min(), scale.max()), vp[0].round(0), "to", vp[-1].round(0), flush=True)

# ---------- the timeline: values at times
def key(track, t):
    """straight lines between the keys, with the corners rounded over 0.7 s, so nothing starts or stops with a jerk"""
    k = np.array(spec[track], float); return float(np.interp(t + np.linspace(-0.35, 0.35, 15), k[:, 0], k[:, 1]).mean())
K = np.array(spec.get("shadow_rgb", [0.217, 0.228, 0.296]), np.float32)[::-1]; SOFT = spec.get("edge_soft_deg", 30.0); yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
rs = np.random.default_rng(spec.get("seed", 4)); WAVES = [(rs.uniform(1.4, 4.2), rs.uniform(0, 6.28), a) for a in (2.2, 1.5, 1.0, 0.6)]      # the edge is the shadow of a ridge line, not of a ruler: it wanders by a few degrees along its length
def wander(rad): lr = np.log(np.maximum(rad, 8.0)); return sum(a * np.sin(f * lr * 2.2 + ph) for f, ph, a in WAVES)
def cover(ang, rad, A):
    m = np.clip((A - ang - wander(rad)) / SOFT + 0.5, 0, 1); return m * m * (3 - 2 * m)
BANDS = spec.get("bands", [{"lead": "edge_deg"}])      # a shadow has a front edge ("lead") and may have a back edge ("trail") that follows it across the ground the same way: the light comes back from the side the dark came from
def shade(ang, rad, t):
    m = 0.0
    for b in BANDS:
        c = cover(ang, rad, key(b["lead"], t))
        if b.get("trail"): c = c * (1 - cover(ang, rad + 137.0, key(b["trail"], t)))
        m = np.maximum(m, c)
    return m
def crest_dark(t):
    """the high far ground keeps the light longest and gets it back first"""
    c = 0.0
    for b in BANDS: c = max(c, float(np.clip((key(b["lead"], t) - 150.0) / 40.0, 0, 1)) * (1 - float(np.clip((key(b["trail"], t) + 10.0) / 30.0, 0, 1)) if b.get("trail") else 1.0))
    return c
def lamp_on(k_, i, t):
    """a lamp switches itself on a moment after the shadow reaches it, and off when the sunlight is back"""
    gx, gy = T[i, 2 * k_ + 1]; d = 0.16 + 0.09 * ((k_ * 7) % 5); a = math.degrees(math.atan2(gy - vp[i, 1], gx - vp[i, 0])); rad = math.hypot(gx - vp[i, 0], gy - vp[i, 1])
    return float(np.clip((float(shade(np.float32(a), np.float32(rad), t - d)) - 0.72) / 0.08, 0, 1))
START = spec.get("start", 0)            # the first output frame is this many source frames into the decoded range (the range must hold ref_frame)
SKYMAX = spec.get("sky_max", 30.0)      # the sky is whatever is darker than this and reaches the top edge; raise it where lens glare lifts the sky
EL7 = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7)); EL5 = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5)); SMALL = spec.get("old_shadow_max_px", 70000)
def frame(j):
    """j: output frame number"""
    i = j + START if order == "forward" else n - 1 - j - START; t = j / FPS; o = F[i].astype(np.float32); lum = gray[i].astype(np.float32)
    dark = (lum < SKYMAX).astype(np.uint8); _, lab = cv2.connectedComponents(dark, connectivity=4); top = np.unique(lab[0][dark[0] > 0]); sky = np.isin(lab, top) & (dark > 0)       # the sky: the dark that reaches the top edge
    ng, glab, st, _ = cv2.connectedComponentsWithStats((~sky).astype(np.uint8), connectivity=4); big = 1 + int(np.argmax(st[1:, cv2.CC_STAT_AREA]))
    gm = np.isin(glab, [c for c in range(1, ng) if c == big or st[c, cv2.CC_STAT_TOP] > 0]).astype(np.float32)   # the ground: everything that is not sky, except what touches the top edge
    for (px, py, pr) in spec.get("protect", []): cv2.circle(gm, (int(round(px + vp[i, 0] - vp[r, 0])), int(round(py + vp[i, 1] - vp[r, 1]))), int(pr), 0.0, -1)      # the Earth or the Sun in the sky: never touched
    if spec.get("ground_top"):                                              # nothing above this line is ground the shadow can reach (the flank of a far ridge is higher and keeps its light)
        (xa, ya), (xb, yb) = spec["ground_top"]; dx, dy = vp[i, 0] - vp[r, 0], vp[i, 1] - vp[r, 1]; gm[yy < ya + dy + (xx - xa - dx) * (yb - ya) / (xb - xa)] = 0.0
    ground = cv2.GaussianBlur(gm, (0, 0), 2.0)
    deep = key("deep", t); ang = np.degrees(np.arctan2(yy - vp[i, 1], xx - vp[i, 0]))                         # 0 = to the right along the horizon, 90 = straight down
    m = shade(ang, np.hypot(xx - vp[i, 0], yy - vp[i, 1]), t); m[ang < 0] = 0.0
    m = np.maximum(m, crest_dark(t) * (ang < 6)) * ground
    # ground that is sunlit takes the shadow colour. What is already dark stays: the black foreground as it is; an old shadow of an
    # object is raised to the level of the ground around it, because with the Sun gone there is nothing left to cast it.
    # The few pixels where dark and sunlit meet are a mix, and the source has thin coloured rims there, so they are filled in from both sides.
    lb = cv2.GaussianBlur(lum, (0, 0), 1.0); wb = np.clip((lb - 48.0) / 20.0, 0, 1); dm = (lb < 58.0).astype(np.uint8)
    mx = o.max(2); sat = (np.clip(((mx - o.min(2)) / np.maximum(mx, 1.0) - 0.22) / 0.2, 0, 1) * wb)[..., None]; on = o + (lum[..., None] - o) * sat      # strong colour on sunlit grey ground is an artefact; dark things keep the colour the lens glare gives them
    nc, dl, dst, _ = cv2.connectedComponentsWithStats(dm, connectivity=4); small = np.isin(dl, [c for c in range(1, nc) if dst[c, cv2.CC_STAT_AREA] < SMALL]).astype(np.float32) * ground
    soft = cv2.GaussianBlur(on, (0, 0), 1.4); lit = on * K[None, None]; ws = wb * ground; nl = lit.mean(2)
    gl = cv2.GaussianBlur(nl * ws, (0, 0), 22.0) / np.maximum(cv2.GaussianBlur(ws, (0, 0), 22.0), 1e-3); dk = cv2.GaussianBlur(soft.mean(2) * small, (0, 0), 22.0) / np.maximum(cv2.GaussianBlur(small, (0, 0), 22.0), 1e-3)
    lift = 1 + (np.clip(gl / np.maximum(dk, 1.0), 1.0, 2.4) - 1) * cv2.GaussianBlur(small, (0, 0), 1.0)
    night = (lit * wb[..., None] + soft * (lift * (1 - wb))[..., None]) * deep
    band = (cv2.dilate(dm, EL7) > 0) & (cv2.erode(dm, EL5) == 0); w = (~band).astype(np.float32)
    fill = cv2.GaussianBlur(night * w[..., None], (0, 0), 2.5) / np.maximum(cv2.GaussianBlur(w, (0, 0), 2.5), 1e-3)[..., None]
    bs = cv2.GaussianBlur(band.astype(np.float32), (0, 0), 0.7)[..., None]; night = night + (fill - night) * bs; res = o + (night - o) * m[..., None]
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
    amount = 0.72 * (1 - np.exp(-1.5 * pool.max(2, keepdims=True))); tint = pool / np.maximum(pool.max(2, keepdims=True), 1e-6); res = res + np.maximum(o * tint * amount - res, 0) * (m * ground)[..., None]      # lamp light is added to the dim ground, and shows it as the source shot has it
    res = res + core * (0.25 + 0.75 * m[..., None])                                                         # a lamp in full sunlight hardly shows
    return np.clip(res, 0, 255).astype(np.uint8)
total = spec.get("frames", n - START); ON = [[] for _ in L]
if stills:
    for j in stills: cv2.imwrite(f"{os.path.splitext(out)[0]}_{j:03d}.png", frame(j))
    print("wrote stills", stills)
else:
    ff = subprocess.Popen(["ffmpeg", "-nostdin", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-", "-c:v", "libx264", "-crf", "10", "-preset", "fast", "-pix_fmt", "yuv420p", out], stdin=subprocess.PIPE)
    for j in range(total): ff.stdin.write(frame(j).tobytes())
    ff.stdin.close(); ff.wait(); print("wrote", out, total, "frames")
    sw = [[round(j / FPS, 2) for j in range(1, len(v)) if (v[j] > 0.5) != (v[j - 1] > 0.5)] for v in ON]; json.dump({"switch_times": sw}, open(os.path.splitext(out)[0] + "_lamps.json", "w")); print("lamp switch times", sw)
