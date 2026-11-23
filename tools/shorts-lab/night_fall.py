# Night falling on one place, and day coming back, on a real moving shot of that place in sunlight.
#
# What it does to each frame of the source shot:
#   - a shadow edge travels across the ground. The edge is a straight line on the ground, so in the picture it turns about its
#     vanishing point (VP); it starts on the shadow the source shot already has. Ground inside the shadow takes the colour the
#     source's own shadows have (measured: 0.217, 0.228, 0.296 of the sunlit ground), so the new dark matches the old.
#   - the sky, and anything already as dark as a shadow, is left alone.
#   - lamps switch on at places picked on the real objects in one reference frame and followed through the shot. A lamp shows the
#     ground around it as the source shot has it (so the detail is real), tinted with the lamp's colour.
#   - once the ground is dark, the stars a camera would then record come up in the sky: real stars from a catalogue ("stars").
#     A planet's disc in the sky hides them, its dark side included ("discs").
#   - small lights that could really be there: beacons that blink on masts, a spacecraft crossing the sky, a lander's engine ("movers").
# Modelled by us: the moving shadow, how dark the night gets, every lamp and light, where the stars sit. The place, the objects and
# the camera move are the source's.
#
# The picture worked on can be wider than a phone frame ("size"). With "path" the output is a 1080x1920 frame travelling across it
# like a camera, pixel for pixel, eased and blurred along the move as a film shutter would; only the part in view is computed.
# "order": "pingpong" runs the source forwards, then backwards, and so on, so one take can last longer than the source.
#
# usage: python night_fall.py SOURCE.mp4 SPEC.json OUT.mp4 [frame numbers to write as stills instead, e.g. 0,60,120]
#   PART=a,b        render output frames a to b-1 only (several runs side by side, joined afterwards)
#   PREPARE=1       decode the source and follow the lamps, then stop (do this once before runs side by side)
#   FRAME_CACHE_DIR where the decoded source frames and the lamp tracks are kept between runs (default /tmp)
import os, sys, json, math, gzip, csv, hashlib, subprocess, numpy as np, cv2
src, spec, out = sys.argv[1], json.load(open(sys.argv[2])), sys.argv[3]; stills = [int(v) for v in sys.argv[4].split(",")] if len(sys.argv) > 4 else None
HERE = os.path.dirname(os.path.abspath(sys.argv[2]))
W, H = spec.get("size", [1080, 1920]); FPS = 24; OW = 1080; x0, y0 = spec["window"]; f0, f1, REF = spec["source_frames"][0], spec["source_frames"][1], spec["ref_frame"]; order = spec.get("order", "forward")
CD = os.environ.get("FRAME_CACHE_DIR", "/tmp"); cache = os.path.join(CD, f"nf_{os.path.basename(src)}_{x0}_{y0}_{W}x{H}_{f0}_{f1}.raw")
if not os.path.exists(cache):                                            # the source frames are decoded once and shared by every run
    subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-y", "-i", src, "-vf", f"select=between(n\\,{f0}\\,{f1}),crop={W}:{H}:{x0}:{y0}", "-vsync", "0", "-f", "rawvideo", "-pix_fmt", "bgr24", cache + ".part"], check=True); os.replace(cache + ".part", cache)
F = np.memmap(cache, np.uint8, "r").reshape(-1, H, W, 3); n = len(F); print("source frames", n, "size", W, H, flush=True)
def grey(i): return cv2.cvtColor(np.ascontiguousarray(F[i]), cv2.COLOR_BGR2GRAY)

# ---------- follow the lamp places and a few far points through the shot, both ways from the frame each was picked in
L = spec["lamps"]; nl = len(L); far0 = spec.get("far_points", []); pts0 = []
for l in L: pts0 += [l["at"], l.get("ground", l["at"])]
P0 = np.array(pts0 + far0, np.float32).reshape(-1, 2); refs = np.array([l.get("ref", REF) for l in L for _ in (0, 1)] + [REF] * len(far0)); r = REF - f0
tfile = cache + ".track_" + hashlib.md5((P0.tobytes() + refs.tobytes())).hexdigest()[:10] + ".npy"
if os.path.exists(tfile): T = np.load(tfile)
else:
    T = np.zeros((n, len(P0), 2), np.float32); lk = dict(winSize=(41, 41), maxLevel=4, criteria=(cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 40, 0.01))
    for rf in np.unique(refs):
        idx = np.nonzero(refs == rf)[0]; r_ = int(rf) - f0; T[r_, idx] = P0[idx]
        for rng in (range(r_ + 1, n), range(r_ - 1, -1, -1)):
            gp = grey(r_); p = P0[idx].reshape(-1, 1, 2).copy()
            for i in rng:
                gi = grey(i); q, st, _ = cv2.calcOpticalFlowPyrLK(gp, gi, p, None, **lk); d = (q - p)[:, 0]; med = np.median(d[st[:, 0] == 1], 0) if st.any() else np.zeros(2)
                bad = (st[:, 0] == 0) | (np.linalg.norm(d - med, axis=1) > 6.0); q[bad, 0] = p[bad, 0] + med          # a point that slips is carried along with the rest
                T[i, idx] = q[:, 0]; p = q; gp = gi
    np.save(tfile, T)
far = T[:, 2 * nl:]
if spec.get("vp_track"):                                                 # the same shadow in every framing of one take: the point's place in each source frame, in the source's own pixels (written with WRITE_TRACK)
    tr = json.load(open(os.path.join(HERE, spec["vp_track"]))); vp = np.array([tr["vp"][str(f)] for f in range(f0, f1 + 1)], np.float32) - np.array([x0, y0], np.float32)[None]
else: vp = np.array(spec["vp"], np.float32)[None] + np.median(far - far[r][None], 1)      # the vanishing point moves as the far ground does
if os.environ.get("WRITE_TRACK"): json.dump({"source": os.path.basename(src), "vp": {str(f0 + i): [round(float(vp[i, 0] + x0), 2), round(float(vp[i, 1] + y0), 2)] for i in range(n)}}, open(os.environ["WRITE_TRACK"], "w")); print("wrote track", os.environ["WRITE_TRACK"]); sys.exit()
spread = lambda a: np.linalg.norm(a - a.mean(0), axis=1).mean(); scale = np.array([spread(T[i, :2 * nl]) for i in range(n)]) / spread(T[r, :2 * nl])
print("lamp places moved up to %.0f px; scale %.2f to %.2f; vanishing point from" % (np.abs(T - T[r][None]).max(), scale.min(), scale.max()), vp[0].round(0), "to", vp[-1].round(0), flush=True)
if os.environ.get("PREPARE"): print("prepared"); sys.exit()

# ---------- the timeline: values at times
def key(track, t):
    """straight lines between the keys, with the corners rounded over 0.7 s, so nothing starts or stops with a jerk"""
    k = np.array(spec[track], float); return float(np.interp(t + np.linspace(-0.35, 0.35, 15), k[:, 0], k[:, 1]).mean())
def glide(keys, t):
    """a camera move: between two keys it eases out of the first and into the second"""
    k = np.array(keys, float)
    if t <= k[0, 0]: return float(k[0, 1])
    if t >= k[-1, 0]: return float(k[-1, 1])
    j = int(np.searchsorted(k[:, 0], t, side="right") - 1); u = (t - k[j, 0]) / (k[j + 1, 0] - k[j, 0]); u = u * u * u * (u * (6 * u - 15) + 10); return float(k[j, 1] + (k[j + 1, 1] - k[j, 1]) * u)
PATH = spec.get("path"); PAD = 180
def cam(t): return float(np.clip(glide(PATH["x"], t), 0, W - OW))
K = np.array(spec.get("shadow_rgb", [0.217, 0.228, 0.296]), np.float32)[::-1]; SOFT = spec.get("edge_soft_deg", 30.0); SOFTK = spec.get("edge_soft_k"); YY, XX = np.mgrid[0:H, 0:W].astype(np.float32)
def softness(rad): return np.clip(SOFTK / np.maximum(rad, 1.0), 5.0, 32.0) if SOFTK else SOFT      # an edge of one width on the ground looks wider, in degrees, the nearer it is to the vanishing point
rs = np.random.default_rng(spec.get("seed", 4)); WAVES = [(rs.uniform(1.4, 4.2), rs.uniform(0, 6.28), a) for a in (2.2, 1.5, 1.0, 0.6)]      # the edge is the shadow of a ridge line, not of a ruler: it wanders by a few degrees along its length
def wander(rad): lr = np.log(np.maximum(rad, 8.0)); return sum(a * np.sin(f * lr * 2.2 + ph) for f, ph, a in WAVES)
def cover(ang, rad, A):
    m = np.clip((A - ang - wander(rad) * np.minimum(softness(rad) / 30.0 * 2.0, 1.0)) / softness(rad) + 0.5, 0, 1); return m * m * (3 - 2 * m)
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
    """a lamp switches itself on a moment after the shadow reaches it, and off when the sunlight is back; a beacon ("blink": [period, part of it lit, offset]) flashes all the time"""
    if L[k_].get("blink"): per, duty, ph = L[k_]["blink"]; return 1.0 if ((t + ph) % per) < duty * per else 0.0
    gx, gy = T[i, 2 * k_ + 1]; d = 0.16 + 0.09 * ((k_ * 7) % 5); a = math.degrees(math.atan2(gy - vp[i, 1], gx - vp[i, 0])); rad = math.hypot(gx - vp[i, 0], gy - vp[i, 1])
    return float(np.clip((float(shade(np.float32(a), np.float32(rad), t - d)) - 0.72) / 0.08, 0, 1))
START = spec.get("start", 0)            # the first output frame is this many source frames into the decoded range (the range must hold ref_frame)
SKYMAX = spec.get("sky_max", 30.0)      # the sky is whatever is darker than this and reaches the top edge; raise it where lens glare lifts the sky (a number, or [[x, value], ...] across the picture)
if isinstance(SKYMAX, list): sm = np.array(SKYMAX, np.float32); SKYMAX = np.interp(np.arange(W), sm[:, 0], sm[:, 1]).astype(np.float32)[None]
else: SKYMAX = np.full((1, W), SKYMAX, np.float32)
EL7 = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7)); EL5 = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5)); SMALL = spec.get("old_shadow_max_px", 70000)
def blur_big(a, sig):                                                     # a wide blur done on a quarter-size copy: same result to the eye, a fraction of the time
    h_, w_ = a.shape[:2]; return cv2.resize(cv2.GaussianBlur(cv2.resize(a, (max(w_ // 4, 1), max(h_ // 4, 1)), interpolation=cv2.INTER_AREA), (0, 0), sig / 4.0), (w_, h_), interpolation=cv2.INTER_LINEAR)

# ---------- the stars a camera exposed for dark ground would record: real ones, from the HYG catalogue (Hipparcos, Yale, Gliese)
STARS = None
if spec.get("stars"):
    sp = spec["stars"]; ppd = sp["px_per_deg"]; sx, sy = sp["sun_xy"]; lam_s = sp["sun_ecl_lon"]; eps = math.radians(23.4393); lim = sp.get("mag_limit", 9.5)
    # the view: from the south pole the horizon runs along the ecliptic, south is up, and ecliptic longitude grows to the right. The Sun fixes the place; the date (its longitude) is our choice, the source gives none.
    layer = np.zeros((H + 200, W + 200, 3), np.float32); cnt = 0
    cat = os.path.join(os.environ.get("STAR_CATALOGUE_DIR", HERE), sp["catalogue"])      # the catalogue file is not kept in the repository (13 MB): github.com/astronexus/HYG-Database, hyg/v3/hyg_v38.csv.gz, CC BY-SA 4.0
    with gzip.open(cat, "rt") as fh:
        for row in csv.DictReader(fh):
            try: mag = float(row["mag"]); ra = math.radians(float(row["ra"]) * 15.0); dec = math.radians(float(row["dec"]))
            except ValueError: continue
            if mag > lim or mag < -2: continue
            sb = math.sin(dec) * math.cos(eps) - math.cos(dec) * math.sin(eps) * math.sin(ra); beta = math.degrees(math.asin(sb))
            lam = math.degrees(math.atan2(math.sin(ra) * math.cos(eps) + math.tan(dec) * math.sin(eps), math.cos(ra))) % 360.0
            dl = (lam - lam_s + 180.0) % 360.0 - 180.0; px = sx + dl * ppd * math.cos(math.radians(beta)) + 100; py = sy + beta * ppd + 100
            if not (4 <= px < W + 196 and 4 <= py < H + 196): continue
            try: ci = float(row["ci"])
            except ValueError: ci = 0.6
            col = np.clip(np.array([1.0 + 0.25 * (0.6 - ci), 1.0, 1.0 - 0.22 * (0.6 - ci)], np.float32), 0.7, 1.25)      # blue stars a little blue, red ones a little warm (BGR)
            flux = sp.get("gain", 1.0) * 1.7 * 10 ** (-0.4 * 0.6 * (mag - 4.0)); sig = 0.75 + 0.35 * max(0.0, 4.0 - mag) ** 0.5; rad_ = int(3 * sig) + 2; ix, iy = int(px), int(py)      # a camera's response is compressed: faint stars still register
            g = np.exp(-(((np.arange(ix - rad_, ix + rad_ + 1) - px)[None] ** 2 + (np.arange(iy - rad_, iy + rad_ + 1) - py)[:, None] ** 2) / (2 * sig * sig)))
            layer[iy - rad_:iy + rad_ + 1, ix - rad_:ix + rad_ + 1] += (min(flux, 6.0) * 150.0 * g)[..., None] * col; cnt += 1
    STARS = np.clip(layer, 0, 255); print("stars placed", cnt, flush=True)
MOVERS = spec.get("movers", [])
def lander_sprite(tilt_deg, side):
    """a small crewed lander as it would look from kilometres away: cabin, body with a foil band, legs, engine bell, an aerial; lit from one side. Returns colour and cover, 26 px square."""
    q = 8; n_ = 26 * q; im = np.zeros((n_, n_, 3), np.float32); al = np.zeros((n_, n_), np.float32); P = lambda pts: np.round(np.array(pts, np.float32) * q).astype(np.int32)
    def poly(pts, col, a=1.0): cv2.fillPoly(im, [P(pts)], col, lineType=cv2.LINE_AA); cv2.fillPoly(al, [P(pts)], a, lineType=cv2.LINE_AA)
    def line(a_, b_, col, th): cv2.line(im, tuple(P([a_])[0]), tuple(P([b_])[0]), col, int(th * q), cv2.LINE_AA); cv2.line(al, tuple(P([a_])[0]), tuple(P([b_])[0]), 1.0, int(th * q), cv2.LINE_AA)
    lit, mid, dim = (236, 236, 232), (150, 150, 152), (70, 72, 78)
    for fx in (-1, 1): line((13 + fx * 3.6, 15.2), (13 + fx * 7.2, 20.6), mid, 0.5); line((13 + fx * 6.4, 20.8), (13 + fx * 8.2, 20.8), lit, 0.5)      # legs and footpads
    poly([(11.6, 15.6), (14.4, 15.6), (15.2, 18.2), (10.8, 18.2)], dim)                                       # engine bell
    poly([(8.0, 11.6), (9.6, 10.2), (16.4, 10.2), (18.0, 11.6), (18.0, 14.6), (16.6, 15.8), (9.4, 15.8), (8.0, 14.6)], mid)      # descent stage
    poly([(13.0, 10.2), (16.4, 10.2), (18.0, 11.6), (18.0, 14.6), (16.6, 15.8), (13.0, 15.8)] if side > 0 else [(13.0, 10.2), (9.6, 10.2), (8.0, 11.6), (8.0, 14.6), (9.4, 15.8), (13.0, 15.8)], lit)      # its sunlit half
    poly([(8.0, 12.9), (18.0, 12.9), (18.0, 14.0), (8.0, 14.0)], (70, 150, 205))                              # a band of gold foil
    poly([(10.4, 5.6), (15.6, 5.6), (16.4, 7.0), (16.4, 10.2), (9.6, 10.2), (9.6, 7.0)], mid)                # cabin
    poly([(13.0, 5.6), (15.6, 5.6), (16.4, 7.0), (16.4, 10.2), (13.0, 10.2)] if side > 0 else [(13.0, 5.6), (10.4, 5.6), (9.6, 7.0), (9.6, 10.2), (13.0, 10.2)], lit)
    poly([(11.0, 7.0), (12.6, 7.0), (12.6, 8.4), (11.0, 8.4)], (40, 34, 30)); line((14.6, 5.6), (16.6, 2.6), mid, 0.35)      # a window, an aerial
    M = cv2.getRotationMatrix2D((13 * q, 16.5 * q), tilt_deg, 1.0); im = cv2.warpAffine(im, M, (n_, n_), flags=cv2.INTER_LINEAR); al = cv2.warpAffine(al, M, (n_, n_), flags=cv2.INTER_LINEAR)
    return cv2.resize(im, (26, 26), interpolation=cv2.INTER_AREA), cv2.resize(al, (26, 26), interpolation=cv2.INTER_AREA)
ONSET = {}
def src_index(j):
    q = j + START
    if order == "forward": return q
    if order == "reverse": return n - 1 - q
    p_ = 2 * (n - 1); q = q % p_; return q if q < n else p_ - q                 # pingpong: there and back, never the same frame twice in a row
def frame(j):
    """j: output frame number"""
    i = src_index(j); t = j / FPS; dx, dy = float(vp[i, 0] - vp[r, 0]), float(vp[i, 1] - vp[r, 1])
    if PATH: xw = cam(t); c0 = int(max(0, math.floor(xw) - PAD)); c1 = int(min(W, math.floor(xw) + OW + PAD + 1))
    else: c0, c1 = 0, W
    cw = c1 - c0; xx = XX[:, c0:c1]; yy = YY[:, c0:c1]; o8 = np.ascontiguousarray(F[i][:, c0:c1]); o = o8.astype(np.float32); lum = cv2.cvtColor(o8, cv2.COLOR_BGR2GRAY).astype(np.float32)
    dark = (lum < SKYMAX[:, c0:c1]).astype(np.uint8); _, lab = cv2.connectedComponents(dark, connectivity=4); top = np.unique(lab[0][dark[0] > 0]); sky = np.isin(lab, top) & (dark > 0)       # the sky: the dark that reaches the top edge
    ng, glab, st, _ = cv2.connectedComponentsWithStats((~sky).astype(np.uint8), connectivity=4); big = 1 + int(np.argmax(st[1:, cv2.CC_STAT_AREA]))
    gm = np.isin(glab, [c for c in range(1, ng) if c == big or st[c, cv2.CC_STAT_TOP] > 0]).astype(np.float32)   # the ground: everything that is not sky, except what touches the top edge
    for (px, py, pr) in spec.get("protect", []): cv2.circle(gm, (int(round(px + dx - c0)), int(round(py + dy))), int(pr), 0.0, -1)      # the Earth or the Sun in the sky: never touched
    if spec.get("ground_top"):                                              # nothing above this line is ground the shadow can reach (the flank of a far ridge is higher and keeps its light)
        gt = np.array(spec["ground_top"], np.float32); above = yy < np.interp(xx[0] - dx, gt[:, 0], gt[:, 1])[None] + dy
        if spec.get("ground_top_from"): xa_, xb_ = spec["ground_top_from"]; u_ = np.clip((xx[0] - dx - xa_) / (xb_ - xa_), 0, 1); gm = gm * (1 - (u_ * u_ * (3 - 2 * u_))[None] * above)      # the rule comes in gradually across the picture, so it leaves no edge
        else: gm[above] = 0.0
    ground = cv2.GaussianBlur(gm, (0, 0), 2.0)
    deep = key("deep", t); ang = np.degrees(np.arctan2(yy - vp[i, 1], xx - vp[i, 0]))                         # 0 = to the right along the horizon, 90 = straight down
    m = shade(ang, np.hypot(xx - vp[i, 0], yy - vp[i, 1]), t); m[ang < 0] = 0.0
    m = np.maximum(m, crest_dark(t) * (ang < 6)) * ground
    # ground that is sunlit takes the shadow colour. What is already dark stays: the black foreground as it is; an old shadow of an
    # object is raised to the level of the ground around it, because with the Sun gone there is nothing left to cast it.
    # The few pixels where dark and sunlit meet are a mix, and the source has thin coloured rims there, so they are filled in from both sides.
    lb = cv2.GaussianBlur(lum, (0, 0), 1.0); wb = np.clip((lb - 48.0) / 20.0, 0, 1); dm = (lb < 58.0).astype(np.uint8)
    nc, dl, dst, _ = cv2.connectedComponentsWithStats(dm, connectivity=4); small = np.isin(dl, [c for c in range(1, nc) if dst[c, cv2.CC_STAT_AREA] < SMALL]).astype(np.float32) * ground
    mx = o.max(2); sat = (np.clip(((mx - o.min(2)) / np.maximum(mx, 1.0) - 0.22) / 0.2, 0, 1) * np.maximum(wb, cv2.dilate(small, EL7)))[..., None]; on = o + (lum[..., None] - o) * sat      # strong colour on grey ground, and on small dark things such as posts (the source's lens fringes them blue and red), is an artefact; large dark things keep the colour the lens glare gives them
    soft = cv2.GaussianBlur(on, (0, 0), 1.4); lit = on * K[None, None]; ws = wb * ground; nlm = lit.mean(2)
    gl = blur_big(nlm * ws, 22.0) / np.maximum(blur_big(ws, 22.0), 1e-3); dk = blur_big(soft.mean(2) * small, 22.0) / np.maximum(blur_big(small, 22.0), 1e-3)
    lift = 1 + (np.clip(gl / np.maximum(dk, 1.0), 1.0, 2.4) - 1) * cv2.GaussianBlur(small, (0, 0), 1.0)
    night = (lit * wb[..., None] + soft * (lift * (1 - wb))[..., None]) * deep
    band = (cv2.dilate(dm, EL7) > 0) & (cv2.erode(dm, EL5) == 0); w = (~band).astype(np.float32)
    fill = cv2.GaussianBlur(night * w[..., None], (0, 0), 2.5) / np.maximum(cv2.GaussianBlur(w, (0, 0), 2.5), 1e-3)[..., None]
    bs = cv2.GaussianBlur(band.astype(np.float32), (0, 0), 0.7)[..., None]; night = night + (fill - night) * bs; res = o + (night - o) * m[..., None]
    # ---------- the sky: stars come up as the exposure opens for dark ground, and never through glare or through a planet; then the lights that travel across it
    if STARS is not None or MOVERS:
        skyw = cv2.GaussianBlur(sky.astype(np.float32), (0, 0), 1.2)
        if STARS is not None:
            ix, iy = int(round(100 - dx)), int(round(100 - dy)); st_ = STARS[iy:iy + H, ix + c0:ix + c1]; sw_ = key("star_level", t) * skyw * np.clip(1.0 - lb / spec["stars"].get("glare_lum", 46.0), 0, 1) ** 1.5
            for (px, py, pr) in spec.get("discs", []): sw_ = sw_ * np.clip((np.hypot(xx - px - dx, yy - py - dy) - pr) / 2.0, 0, 1)      # the whole disc of the Earth hides the stars behind it, the unlit part too
            res = res + st_ * sw_[..., None]
        for mv in MOVERS:
            pth = np.array(mv["path"], float)
            if not (pth[0, 0] <= t <= pth[-1, 0]): continue
            if mv["type"] in ("walker", "rover"):                           # a light carried over the ground: it keeps its place by a lamp that is followed through the shot ("anchor"), bobs with each step, and throws a small pool ahead of itself
                bx0, by0 = T[i, 2 * mv["anchor"] + 1]; wx = bx0 + float(np.interp(t, pth[:, 0], pth[:, 1])) - c0; wy = by0 + float(np.interp(t, pth[:, 0], pth[:, 2])) + (0.7 * math.sin(t * 11.0 + mv["anchor"]) if mv["type"] == "walker" else 0.0)
                ahead = 1.0 if pth[-1, 1] >= pth[0, 1] else -1.0; big_ = mv["type"] == "rover"; xa, xb, ya, yb = int(max(wx - 60, 0)), int(min(wx + 60, cw)), int(max(wy - 30, 0)), int(min(wy + 30, H))
                if xb <= xa or yb <= ya: continue
                X, Y = xx[ya:yb, xa:xb] - c0 - wx, yy[ya:yb, xa:xb] - wy; g_ = mv.get("gain", 1.0) * min(1.0, (t - pth[0, 0]) / 0.5, (pth[-1, 0] - t) / 0.5) * float(m[int(np.clip(wy, 0, H - 1)), int(np.clip(wx, 0, cw - 1))])
                dot_ = 230.0 * np.exp(-(X * X + (Y + (3 if big_ else 5)) ** 2) / (2 * (1.5 if big_ else 1.1) ** 2)); pl_ = (0.5 if big_ else 0.34) * np.exp(-(((X - ahead * (16 if big_ else 9)) / (20 if big_ else 11)) ** 2 + (Y / (5 if big_ else 3.5)) ** 2))
                res[ya:yb, xa:xb] += (g_ * dot_)[..., None] * np.array([0.92, 0.97, 1.0], np.float32) + np.maximum(o[ya:yb, xa:xb] * 0.8 - res[ya:yb, xa:xb], 0) * (g_ * pl_)[..., None]
                continue
            px = float(np.interp(t, pth[:, 0], pth[:, 1])) + dx; py = float(np.interp(t, pth[:, 0], pth[:, 2])) + dy; R_ = {"dust": 300, "lander": 420}.get(mv["type"], 40)
            xa, xb, ya, yb = int(max(px - R_ - c0, 0)), int(min(px + R_ - c0, cw)), int(max(py - R_, 0)), int(min(py + R_, H))
            if xb <= xa or yb <= ya: continue
            X, Y = xx[ya:yb, xa:xb] - px, yy[ya:yb, xa:xb] - py; g_ = mv.get("gain", 1.0) * min(1.0, (t - pth[0, 0]) / 0.3, (pth[-1, 0] - t) / 0.3); on_sky = skyw[ya:yb, xa:xb]
            if mv["type"] == "lander":
                # the exhaust leaves down and ahead (the engine is braking and holding the lander up at once); in vacuum it spreads into a wide, thin fan that the Sun lights
                vx_ = float(np.interp(t + 0.1, pth[:, 0], pth[:, 1]) - np.interp(t - 0.1, pth[:, 0], pth[:, 1])); vy_ = float(np.interp(t + 0.1, pth[:, 0], pth[:, 2]) - np.interp(t - 0.1, pth[:, 0], pth[:, 2])); nv = math.hypot(vx_, vy_) + 1e-6
                ax_, ay_ = 0.5 * vx_ / nv, 0.5 * vy_ / nv + 0.5; na = math.hypot(ax_, ay_); ax_, ay_ = ax_ / na, ay_ / na; s_ = X * ax_ + Y * ay_; d_ = -X * ay_ + Y * ax_; sp_ = np.maximum(s_, 0)
                flick = 1.0 + 0.10 * math.sin(t * 61.0) + 0.06 * math.sin(t * 143.0)        # the flame is never quite steady
                v_ = 255.0 * np.exp(-(X * X + Y * Y) / (2 * 2.2 ** 2)) + 60.0 * flick * np.exp(-(X * X + Y * Y) / (2 * 7.0 ** 2)) + mv.get("plume", 1.0) * flick * (80.0 * np.exp(-(d_ / (4.0 + 0.30 * sp_)) ** 2) * np.exp(-sp_ / 60.0) + 34.0 * np.exp(-(d_ / (10.0 + 0.55 * sp_)) ** 2) * np.exp(-sp_ / 170.0)) * (s_ > -3)
                colr = np.array([1.0, 0.93, 0.86], np.float32)
                # the craft itself, as small as it would be from here, leaning the way its engine pushes; and a strobe that flashes
                bx, by = X + ax_ * 16.0, Y + ay_ * 16.0; strobe = 255.0 * np.exp(-(bx ** 2 + by ** 2) / (2 * 1.3 ** 2)) * (1.0 if (t % 1.1) < 0.085 else 0.0); v_ = v_ + strobe
                spr, sal = lander_sprite(-math.degrees(math.atan2(ax_, ay_)), mv.get("sun_side", 1.0)); ox_, oy_ = px - ax_ * 1.0 - 13.0, py - ay_ * 1.0 - 17.5      # the engine bell sits on the light
                Ms = np.float32([[1, 0, ox_ - c0 - xa], [0, 1, oy_ - ya]]); big_s = cv2.warpAffine(spr, Ms, (xb - xa, yb - ya), flags=cv2.INTER_LINEAR); big_a = cv2.warpAffine(sal, Ms, (xb - xa, yb - ya), flags=cv2.INTER_LINEAR) * on_sky * g_
                if mv.get("clip_y") is not None: big_a = big_a * np.clip((mv["clip_y"] + dy - yy[ya:yb, xa:xb]) / 3.0, 0, 1)
                res[ya:yb, xa:xb] = res[ya:yb, xa:xb] * (1 - big_a[..., None]) + big_s * big_a[..., None]
                if mv.get("clip_y") is not None:                            # near the ground its flame lights the ground under it: a pool that grows and tightens as it comes down
                    near = float(np.clip(1 - (mv["clip_y"] + dy - py) / 150.0, 0, 1))
                    if near > 0:
                        gy0 = mv["clip_y"] + dy + 16; gxa, gxb, gya, gyb = int(max(px - 260 - c0, 0)), int(min(px + 260 - c0, cw)), int(max(gy0 - 60, 0)), int(min(gy0 + 90, H))
                        if gxb > gxa and gyb > gya:
                            GX, GY = xx[gya:gyb, gxa:gxb] - px, yy[gya:gyb, gxa:gxb] - gy0; pool_ = 120.0 * near ** 1.5 * g_ * flick * np.exp(-((GX / (190 - 110 * near)) ** 2 + (GY / (34 - 14 * near)) ** 2))
                            res[gya:gyb, gxa:gxb] += (pool_ * (1 - skyw[gya:gyb, gxa:gxb]))[..., None] * np.array([1.0, 0.95, 0.9], np.float32)
            elif mv["type"] == "dust":                                      # touchdown beyond a ridge: sunlit dust thrown up in a low, wide fan, seen only where it rises above the ridge line; it spreads and thins in seconds
                a_ = (t - pth[0, 0]) / (pth[-1, 0] - pth[0, 0]); rx, ry = 30 + 190 * a_ ** 0.6, 10 + 55 * a_ ** 0.6
                v_ = 115.0 * (1 - a_) ** 1.6 * min(1.0, a_ / 0.08) * np.exp(-((X / rx) ** 2 + (Y / ry) ** 2)); colr = np.array([0.95, 0.97, 1.0], np.float32); g_ = mv.get("gain", 1.0)      # centred just below the ridge line: the ridge itself cuts it off
            else:                                                           # a spacecraft in orbit in sunlight: a steady point
                v_ = 235.0 * np.exp(-(X * X + Y * Y) / (2 * 1.15 ** 2)) + 18.0 * np.exp(-(X * X + Y * Y) / (2 * 4.0 ** 2)); colr = np.array([0.96, 0.98, 1.0], np.float32)
            if mv.get("clip_y") is not None: v_ = v_ * np.clip((mv["clip_y"] + dy - yy[ya:yb, xa:xb]) / 3.0, 0, 1)      # a ridge line it goes behind
            res[ya:yb, xa:xb] += (g_ * v_ * on_sky)[..., None] * colr      # the light is only drawn on sky
    for (px, py, pr) in spec.get("discs", []):                              # the Earth: the source's lens gives its crescent a rainbow rim; a camera would record it blue-white
        da, db_, dc, dd = int(max(px + dx - pr - 12 - c0, 0)), int(min(px + dx + pr + 12 - c0, cw)), int(max(py + dy - pr - 12, 0)), int(min(py + dy + pr + 12, H))
        if db_ > da and dd > dc:
            reg = res[dc:dd, da:db_]; lm = reg.mean(2, keepdims=True); wgt = np.clip((pr + 10 - np.hypot(xx[dc:dd, da:db_] - px - dx, yy[dc:dd, da:db_] - py - dy)) / 4.0, 0, 1)[..., None] * spec.get("disc_clean", 0.75) * np.clip((lm - 45.0) / 40.0, 0, 1)      # only the lit crescent; the dark side keeps the sky's own tone
            res[dc:dd, da:db_] = reg + (lm * np.array([1.06, 1.0, 0.93], np.float32) - reg) * wgt
    pool = np.zeros((H, cw, 3), np.float32); core = np.zeros((H, cw, 3), np.float32); s = float(scale[i]); lx = xx - c0
    for k_, l in enumerate(L):
        v = lamp_on(k_, i, t); ON[k_].append(v)
        if v <= 0: continue
        if not l.get("blink"):
            ONSET.setdefault(k_, j - 100 if j == PART[0] else j)        # a lamp already lit where this run starts struck long ago
            if j - ONSET[k_] in (1, 2, 4): v *= 0.3                          # a lamp striking: it stutters for a few frames before it holds
        (ax, ay), (gx, gy) = T[i, 2 * k_], T[i, 2 * k_ + 1]
        if not (c0 - 400 < ax < c1 + 400): continue
        ax, gx = ax - c0, gx - c0; R = l.get("reach", 90.0) * s; col = np.array(l.get("color", [1.0, 0.86, 0.66]), np.float32)[::-1]
        x_a, x_b, y_a, y_b = int(max(gx - 3.2 * R, 0)), int(min(gx + 3.2 * R, cw)), int(max(gy - 1.6 * R, 0)), int(min(gy + 1.6 * R, H))
        if x_b > x_a and y_b > y_a and R > 0:
            g = np.exp(-(((lx[y_a:y_b, x_a:x_b] - gx) / R) ** 2 + ((yy[y_a:y_b, x_a:x_b] - gy) / (0.34 * R)) ** 2) * 1.6); pool[y_a:y_b, x_a:x_b] += (0.55 * v * l.get("gain", 1.0) * g)[..., None] * col
        rr = l.get("glow", 34.0) * s; x_a, x_b, y_a, y_b = int(max(ax - 3 * rr, 0)), int(min(ax + 3 * rr, cw)), int(max(ay - 3 * rr, 0)), int(min(ay + 3 * rr, H))
        if x_b > x_a and y_b > y_a:
            d2 = (lx[y_a:y_b, x_a:x_b] - ax) ** 2 + (yy[y_a:y_b, x_a:x_b] - ay) ** 2; pool[y_a:y_b, x_a:x_b] += (0.38 * v * l.get("gain", 1.0) * np.exp(-d2 / (rr * rr)))[..., None] * col
            c = np.exp(-d2 / (2 * (l.get("size", 3.0) * s) ** 2)) + 0.30 * np.exp(-d2 / (2 * (l.get("size", 3.0) * s * 4.5) ** 2))
            if l.get("spikes"): ex_, ey_ = np.abs(lx[y_a:y_b, x_a:x_b] - ax), np.abs(yy[y_a:y_b, x_a:x_b] - ay); c = c + 0.42 * (np.exp(-ex_ / l["spikes"]) * np.exp(-(ey_ / 0.8) ** 2) + np.exp(-ey_ / (0.6 * l["spikes"])) * np.exp(-(ex_ / 0.8) ** 2))
            core[y_a:y_b, x_a:x_b] += (255.0 * v * c)[..., None] * (0.55 + 0.45 * col)
    amount = 0.72 * (1 - np.exp(-1.5 * pool.max(2, keepdims=True))); tint = pool / np.maximum(pool.max(2, keepdims=True), 1e-6); res = res + np.maximum(o * tint * amount - res, 0) * (m * ground)[..., None]      # lamp light is added to the dim ground, and shows it as the source shot has it
    res = res + core * (0.25 + 0.75 * m[..., None])                                                         # a lamp in full sunlight hardly shows
    res = np.clip(res, 0, 255).astype(np.uint8)
    if not PATH: return res
    fr = cv2.warpAffine(res, np.float32([[1, 0, -(xw - c0)], [0, 1, 0]]), (OW, H), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)      # the frame the camera sees, placed to a fraction of a pixel
    bx_ = int(round(abs(cam(t + 1.0 / FPS) - cam(t - 1.0 / FPS)) / 2 * PATH.get("shutter", 0.5)))
    return cv2.blur(fr, (bx_, 1), borderType=cv2.BORDER_REPLICATE) if bx_ >= 2 else fr
total = spec.get("frames", n - START); ON = [[] for _ in L]; OWd = OW if PATH else W
PART = [int(v) for v in os.environ["PART"].split(",")] if os.environ.get("PART") else [0, total]      # PART=a,b renders output frames a to b-1 only, so a long take can be made by several runs side by side and joined
if stills:
    for j in stills: cv2.imwrite(f"{os.path.splitext(out)[0]}_{j:03d}.png", frame(j))
    print("wrote stills", stills)
else:
    ff = subprocess.Popen(["ffmpeg", "-nostdin", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{OWd}x{H}", "-r", str(FPS), "-i", "-", "-c:v", "libx264", "-crf", "8", "-preset", "fast", "-pix_fmt", "yuv420p", out], stdin=subprocess.PIPE)
    for j in range(PART[0], PART[1]):
        ff.stdin.write(frame(j).tobytes())
        if j % 20 == 0: print("frame", j, flush=True)
    ff.stdin.close(); ff.wait(); print("wrote", out, PART[1] - PART[0], "frames")
    sw = [[round((j + PART[0]) / FPS, 2) for j in range(1, len(v)) if (v[j] > 0.5) != (v[j - 1] > 0.5)] for k_, v in enumerate(ON) if not L[k_].get("blink")]; json.dump({"switch_times": sw}, open(os.path.splitext(out)[0] + "_lamps.json", "w")); print("lamp switch times", sw)
