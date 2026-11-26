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
# The camera can also tilt up past the top of the source ("sky_ext" rows of sky are made above it: the sky's own tone, the
# stars, NASA's Milky Way map), a planet can be redrawn with the phase the Sun's place in the picture gives it ("earth"), a
# foreground shot with a black sky can be stood in front of the view ("overlay"), and everything ends in one shared pass of
# softness, grain and lens fall-off so nothing looks laid on top.
# The source frames can be cleaned first (fuse_frames.py: each rebuilt from itself and its neighbours; point FRAME_CACHE_DIR at
# the cleaned copy). Their own fine detail can then be drawn more firmly ("clarity") and the source's coloured lens rims taken
# off the grey ground ("chroma_soft").
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
REPAIR = {}                                                               # "repair_frames": decoded frames whose far ground is taken from the frame before, moved onto its place. In NASA's file thin lit ridge lines break up for single frames, every 16th or 32nd
RROWS = spec.get("repair_rows", [900, 1050])                              # only down to these rows (all, none): the near ground moves differently from the far ground between frames, so it is left as it is
for i_ in spec.get("repair_frames", []):
    A_, _ = cv2.estimateAffinePartial2D(T[i_ - 1].reshape(-1, 1, 2), T[i_].reshape(-1, 1, 2), method=cv2.RANSAC, ransacReprojThreshold=1.0); REPAIR[i_] = A_
def src(i, ya, yb, xa, xb):
    """a piece of source frame i"""
    own = np.ascontiguousarray(F[i][ya:yb, xa:xb])
    if i not in REPAIR or ya >= RROWS[1]: return own
    pa, pb, qa, qb = max(ya - 6, 0), min(yb + 6, H), max(xa - 6, 0), min(xb + 6, W); A_ = REPAIR[i].copy(); A_[:, 2] += A_[:, :2] @ [qa, pa] - [xa, ya]
    far_ = cv2.warpAffine(np.ascontiguousarray(F[i - 1][pa:pb, qa:qb]), A_, (xb - xa, yb - ya), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)
    w_ = np.clip((RROWS[1] - np.arange(ya, yb, dtype=np.float32)) / (RROWS[1] - RROWS[0]), 0, 1)[:, None, None]; return np.clip(far_ * w_ + own * (1 - w_), 0, 255).astype(np.uint8)

# ---------- the timeline: values at times
def key(track, t):
    """straight lines between the keys, with the corners rounded over 0.7 s, so nothing starts or stops with a jerk"""
    k = np.array(spec[track], float); return float(np.interp(t + np.linspace(-0.35, 0.35, 15), k[:, 0], k[:, 1]).mean())
def glide(keys, t, rmp=None):
    """a camera move: between two keys it eases out of the first and into the second"""
    k = np.array(keys, float)
    if t <= k[0, 0]: return float(k[0, 1])
    if t >= k[-1, 0]: return float(k[-1, 1])
    j = int(np.searchsorted(k[:, 0], t, side="right") - 1); T_ = k[j + 1, 0] - k[j, 0]; tau = t - k[j, 0]; D_ = k[j + 1, 1] - k[j, 1]; rr_ = min(float(PATH.get("ramp", 0) if rmp is None else rmp), T_ / 2) if PATH else 0.0
    if rr_ > 0:                                                             # "ramp": seconds to get up to speed and to slow down; in between the speed is steady. The top speed is then travel / (time - ramp), where an S-curve over the whole move peaks at 1.9 times the mean
        vm = D_ / (T_ - rr_); s3 = lambda x_: x_ ** 3 - x_ ** 4 / 2
        return float(k[j, 1] + (vm * rr_ * s3(tau / rr_) if tau < rr_ else D_ - vm * rr_ * s3((T_ - tau) / rr_) if tau > T_ - rr_ else vm * (tau - rr_ / 2)))
    u = tau / T_; u = u * u * u * (u * (6 * u - 15) + 10); return float(k[j, 1] + D_ * u)
PATH = spec.get("path"); PAD = 180
def cam(t): return float(np.clip(glide(PATH["x"], t) + PATH.get("sway", 0.0) * (math.sin(t * 1.9 + 0.4) + 0.45 * math.sin(t * 4.3 + 1.7)), 0, W - OW))      # sway: the frame is never held perfectly still
def camy(t): return float(np.clip(glide(PATH["y"], t, PATH.get("ramp_y")), -EXT + 6, 0)) if PATH and PATH.get("y") else 0.0      # "ramp_y": the same for the tilt
K = np.array(spec.get("shadow_rgb", [0.217, 0.228, 0.296]), np.float32)[::-1]; SOFT = spec.get("edge_soft_deg", 30.0); SOFTK = spec.get("edge_soft_k"); EXT = int(spec.get("sky_ext", 0)); YY, XX = np.mgrid[-EXT:H, 0:W].astype(np.float32)
SOFTR = spec.get("edge_soft_range", [5.0, 32.0]); RELIEF = spec.get("edge_relief_deg", 0.0)
def softness(rad): return np.clip(SOFTK / np.maximum(rad, 1.0), SOFTR[0], SOFTR[1]) if SOFTK else SOFT      # an edge of one width on the ground looks wider, in degrees, the nearer it is to the vanishing point
rs = np.random.default_rng(spec.get("seed", 4)); WAVES = [(rs.uniform(1.4, 4.2), rs.uniform(0, 6.28), a) for a in (2.2, 1.5, 1.0, 0.6)]      # the edge is the shadow of a ridge line, not of a ruler: it wanders by a few degrees along its length
def wander(rad): lr = np.log(np.maximum(rad, 8.0)); return sum(a * np.sin(f * lr * 2.2 + ph) for f, ph, a in WAVES)
def cover(ang, rad, A, along=None):
    m = np.clip((A - ang - spec.get("edge_wander", 1.0) * wander(rad if along is None else along) * np.minimum(softness(rad) / 30.0 * 2.0, 1.0)) / softness(rad) + 0.5, 0, 1); return m * m * (3 - 2 * m)
BANDS = spec.get("bands", [{"lead": "edge_deg"}])      # a shadow has a front edge ("lead") and may have a back edge ("trail") that follows it across the ground the same way: the light comes back from the side the dark came from
FING = spec.get("edge_fingers"); FX = np.arange(-20.0, 200.0, 0.004); FT = np.zeros(len(FX), np.float32)
if FING:                                                                    # the skyline that casts the shadow, as a height along the horizon: broad masses, saddles, single peaks. Low sunlight comes through the saddles in long streaks
    rf = np.random.default_rng(FING.get("seed", 11))
    for per, amp in FING.get("octaves", ((11.0, 1.0), (4.6, 0.8), (1.9, 0.6), (0.8, 0.4))):
        kx = np.arange(-20.0 - per, 200.0 + 2 * per, per); kv = rf.uniform(-1, 1, len(kx))
        j_ = np.clip(np.searchsorted(kx, FX) - 1, 0, len(kx) - 2); u = (FX - kx[j_]) / per; u = u * u * (3 - 2 * u); w_ = kv[j_] * (1 - u) + kv[j_ + 1] * u
        if FING.get("peaked"): w_ = 1.0 - 2.0 * np.abs(w_) ** FING["peaked"]      # a skyline is made of peaks, pointed at the top and rounded between: each peak's shadow is a long pointed finger. (Smooth waves gave the edge round lobes, like a cloud's shadow.)
        FT += (amp * w_).astype(np.float32)
    FT = np.convolve(FT, np.ones(133, np.float32) / 133, "same"); FT = FT - np.median(FT); FT = FT / np.abs(FT).max()      # the Sun is half a degree wide: anything on the skyline narrower than that is smeared out in its shadow
def leadv(name, t):
    """where a shadow's edge stands at time t. "@sun": worked out from the Sun's height above the crest ("sun_height"), as a ridge's shadow must be: a bit of ground
    falls into the shadow when the Sun, seen from it, drops to the crest. Its distance from the ridge's foot over its distance from the camera, u, is then
    crest / (Sun's height above the crest), the crest's height above the horizon being "front.crest_px" (both in pixels as seen from the camera). So the Sun stands
    on the crest exactly when the shadow reaches the camera, and the edge crosses the far plain slowly and the near plain fast."""
    if name != "@sun": return key(name, t)
    h_ = key("sun_height", t)
    if h_ <= 0.5: return 1e4
    ec_ = FRONT["crest_px"]
    if FRONT.get("h_foot"):                                                 # the crest stands well behind the ridge's foot: its shadow reaches the foot only once the Sun is "h_foot" above the crest (NASA's picture, with its Sun 305 px up, shows the plain lit right to the foot).
        hf_ = FRONT["h_foot"]; u_ = hf_ * (ec_ + h_) / (h_ * (ec_ + hf_)) - 1.0      # With the camera at 0 and the crest at 1 along the line of sight, the edge lies at h / (crest + h), and the foot at h_foot / (crest + h_foot)
    else: u_ = ec_ / h_
    return FRONT.get("scale", 200.0) * np.sign(u_) * (abs(u_) / UREF) ** FRONT.get("power", 1.0)
def disc_hidden(hh):
    """the part of the Sun's disc hidden by a straight crest, its centre hh radii above it (hh <= -1: all hidden; hh >= 1: none)"""
    hh = np.clip(hh, -1.0, 1.0); return (np.arccos(hh) - hh * np.sqrt(1.0 - hh * hh)) / np.pi
def in_light(mh):
    """the share of the way from lit to shadowed picture levels that a hidden share mh of the Sun's light takes the ground: mixed as light (levels go as light to the power 1/2.2), not as levels. Half the Sun
    leaves the ground at about three quarters of its lit level, not half way to the shadow: the light holds until the last sliver and then goes"""
    k_ = float(np.mean(K)); kg_ = k_ ** 2.2; lv_ = (1.0 - (1.0 - kg_) * mh) ** (1.0 / 2.2); return ((1.0 - lv_) / (1.0 - k_)).astype(np.float32)
def front_threshold(u):
    """the Sun's height above the crest (px, as the camera sees it) at which the Sun's centre touches the crest as seen from ground u (the edge's place, see shadow_coord)"""
    ec_, hf_ = FRONT["crest_px"], FRONT["h_foot"]; k_ = (ec_ + hf_) / hf_; d_ = (u + 1.0) * k_ - 1.0
    return np.where(d_ > 1e-4, ec_ / np.maximum(d_, 1e-4), 1e5)
def shade(ang, rad, t, rel=0.0, along=None):
    if FRONT and FRONT.get("disc_penumbra") and FRONT.get("h_foot") and spec.get("sun_height") and BANDS[0]["lead"] == "@sun":      # the ridge's shadow, exactly: how much of the Sun's disc the crest hides as seen from each bit of ground. Its edge is sharp near the ridge while the Sun is high and widens into a long gradient as the Sun nears the crest (when the Sun is within its own width of the crest, the whole plain is in the penumbra)
        a_ = ang + rel; u_ = np.sign(a_) * UREF * (np.abs(a_) / FRONT.get("scale", 200.0)) ** (1.0 / FRONT.get("power", 1.0))
        return in_light(disc_hidden((key("sun_height", t) - front_threshold(u_)) / float(spec["sky_clean"].get("disc", 28.0))))
    """rel: how much each bit of ground faces the Sun, in degrees of the edge's travel. Ground turned to the Sun keeps the light longer and gets it back sooner; hollows the other way round. That is what makes a real shadow edge ragged."""
    m = 0.0
    for b in BANDS:
        c = cover(ang + rel, rad, leadv(b["lead"], t), along)
        if b.get("trail"): c = c * (1 - cover(ang - rel * spec.get("trail_fingers", 1.0), rad + 137.0, key(b["trail"], t), along))
        m = np.maximum(m, c)
    return m
def crest_dark(t):
    """the high far ground keeps the light longest and gets it back first"""
    c = 0.0
    for b in BANDS: c = max(c, float(np.clip((leadv(b["lead"], t) - 150.0) / 40.0, 0, 1)) * (1 - float(np.clip((key(b["trail"], t) + 10.0) / 30.0, 0, 1)) if b.get("trail") else 1.0))
    return c
FRONT = spec.get("front"); GT_ = np.array(spec["ground_top"], np.float32) if spec.get("ground_top") else None
UREF = (H - float(np.mean(GT_[:, 1]))) / (float(np.mean(GT_[:, 1])) - vp[r, 1]) if (FRONT and GT_ is not None) else 1.0
def shadow_coord(x, y, i):
    """where a bit of ground stands in the shadow's travel: (ang, rad, along, ridge) for shade().
    Without "front": the angle round the vanishing point (0 = to the right along the horizon, 90 = straight down), as in every earlier version.
    With "front": the ridge's shadow lies on the plain from the ridge's foot toward the camera, as a shadow cast by a ridge must: the ground at the foot is the
    first to lose the Sun and the last to get it back. Each bit of ground is placed by how far it is from the ridge's foot along the Sun's direction (the line
    to the point on the horizon under the Sun, "sun_x"): on flat ground seen from a height, distance goes as 1 / (rows below the horizon), so it is
    (its row - the foot's row where that line meets the foot) / (the foot's row - the horizon's row). "scale" is the value at the bottom of the picture.
    The softness of the edge grows with that distance ("soft", a part of it): the Sun is 0.53 degrees wide, so its shadow's edge widens the farther it falls."""
    if not FRONT:
        ang_ = np.degrees(np.arctan2(y - vp[i, 1], x - vp[i, 0])); return ang_, np.hypot(x - vp[i, 0], y - vp[i, 1]), None, None
    dx_, dy_ = vp[i, 0] - vp[r, 0], vp[i, 1] - vp[r, 1]; yh = vp[i, 1]; xv = FRONT["sun_x"] + dx_
    yg = np.interp(x - dx_, GT_[:, 0], GT_[:, 1]) + dy_; ridge = y < yg; yp = np.maximum(y, yg + 0.5)
    xq = x + (yp - yg) / np.maximum(yp - yh, 1.0) * (xv - x); ygq = np.interp(xq - dx_, GT_[:, 0], GT_[:, 1]) + dy_      # where the line toward the Sun meets the foot
    u = (yp - ygq) / np.maximum(ygq - yh, 1.0)
    ang_ = FRONT.get("scale", 200.0) * np.sign(u) * (np.abs(u) / UREF) ** FRONT.get("power", 1.0)
    rad_ = SOFTK / np.maximum(FRONT.get("soft", 0.1) * np.abs(ang_), 1e-3) if SOFTK else np.full_like(ang_, 1.0)
    return ang_, rad_, 200.0 + np.abs(x - xv), ridge
def lamp_on(k_, i, t):
    """a lamp switches itself on a moment after the shadow reaches it, and off when the sunlight is back; a beacon ("blink": [period, part of it lit, offset]) flashes all the time"""
    if L[k_].get("blink"): per, duty, ph = L[k_]["blink"]; return 1.0 if ((t + ph) % per) < duty * per else 0.0
    gx, gy = T[i, 2 * k_ + 1]; d = 0.16 + 0.09 * ((k_ * 7) % 5); a, rad, al_, _ = shadow_coord(np.float32(gx), np.float32(gy), i)
    return float(np.clip((float(shade(np.float32(a), np.float32(rad), t - d, 0.0, al_)) - 0.72) / 0.08, 0, 1))
START = spec.get("start", 0)            # the first output frame is this many source frames into the decoded range (the range must hold ref_frame)
SKYMAX = spec.get("sky_max", 30.0)      # the sky is whatever is darker than this and reaches the top edge; raise it where lens glare lifts the sky (a number, or [[x, value], ...] across the picture)
if isinstance(SKYMAX, list): sm = np.array(SKYMAX, np.float32); SKYMAX = np.interp(np.arange(W), sm[:, 0], sm[:, 1]).astype(np.float32)[None]
else: SKYMAX = np.full((1, W), SKYMAX, np.float32)
EL7 = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7)); EL5 = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5)); SMALL = spec.get("old_shadow_max_px", 70000)
def sun_elev(t):
    """the Sun's height above the horizon in degrees at time t: its height above the crest ("sun_height", px) plus the crest's above the horizon ("front.crest_px"), over the lens's px per degree"""
    if spec.get("sun_height") and FRONT: return max((key("sun_height", t) + FRONT["crest_px"]) / spec["stars"].get("px_per_deg", 105.0), 0.05)
    return spec.get("sun_elev_deg", 4.5)
def stretch_shadows(sh, cx, cy, f, fade):
    """sh: the source's shadows on the ground (0/1, window pixels). Each is drawn out along the Sun's ray, away from (cx, cy), the point on the horizon under the Sun, to f times its length on the ground.
    On flat ground seen from a height, depth along such a ray goes as 1 / (distance from that point), so a shadow from base radius rb to tip rt on the picture becomes one from rb to
    1 / (1/rb - f (1/rb - 1/rt)). The added part fades over its last "fade" share: the Sun is a disc, so a long shadow's tip is soft. Returns the added part only."""
    h_, w_ = sh.shape; R_ = int(np.ceil(max(np.hypot(cx - xx_, cy - yy_) for xx_ in (0, w_) for yy_ in (0, h_)))) + 2; NA = 3600
    P = cv2.warpPolar(sh.astype(np.float32), (R_, NA), (float(cx), float(cy)), R_, cv2.WARP_POLAR_LINEAR + cv2.INTER_LINEAR) > 0.5
    st_ = P & ~np.pad(P, ((0, 0), (1, 0)))[:, :-1]; en_ = P & ~np.pad(P, ((0, 0), (0, 1)))[:, 1:]
    rs, cs = np.nonzero(st_); re_, ce = np.nonzero(en_); out = np.zeros(P.shape, np.float32)
    if len(rs) == 0 or len(rs) != len(re_): return np.zeros_like(sh, np.float32)
    rb = np.maximum(cs, 1).astype(np.float64); rt = np.maximum(ce + 1, rb + 1).astype(np.float64); den = 1.0 / rb - f * (1.0 / rb - 1.0 / rt)
    ne = np.where(den > 1.0 / (R_ * 4.0), 1.0 / np.maximum(den, 1e-9), R_ * 4.0); ne = np.minimum(ne, R_ - 1)
    for k in range(len(rs)):
        a_, b_ = int(ce[k]) + 1, int(ne[k])
        if b_ <= a_: continue
        L_ = b_ - a_; fl_ = max(fade * L_, 1.0); out[rs[k], a_:b_] = np.clip((b_ - np.arange(a_, b_)) / fl_, 0, 1)
    back = cv2.warpPolar(out, (w_, h_), (float(cx), float(cy)), R_, cv2.WARP_POLAR_LINEAR + cv2.WARP_INVERSE_MAP + cv2.INTER_LINEAR)
    return back
def shift_x(a, d):
    """a moved d px to the right; what comes in from outside is 0"""
    o_ = np.zeros_like(a)
    if d > 0: o_[:, d:] = a[:, :-d]
    elif d < 0: o_[:, :d] = a[:, -d:]
    else: o_[:] = a
    return o_
def blur_big(a, sig):                                                     # a wide blur done on a quarter-size copy: same result to the eye, a fraction of the time
    h_, w_ = a.shape[:2]; return cv2.resize(cv2.GaussianBlur(cv2.resize(a, (max(w_ // 4, 1), max(h_ // 4, 1)), interpolation=cv2.INTER_AREA), (0, 0), sig / 4.0), (w_, h_), interpolation=cv2.INTER_LINEAR)

def clarity(a, cl):
    """what to add to a picture to draw its own fine detail more firmly: "bands" of [size in px, strength], each band's detail held under "limit" levels.
    Worked on brightness only and added to all three colours alike: done colour by colour it would also draw out the thin coloured rims a lens leaves on hard edges."""
    lim_ = float(cl.get("limit", 14.0)); l_ = a @ np.array([0.114, 0.587, 0.299], np.float32); add_ = np.zeros_like(l_)
    for sg_, am_ in cl["bands"]: add_ += am_ * lim_ * np.tanh((l_ - (cv2.GaussianBlur(l_, (0, 0), sg_) if sg_ < 5 else blur_big(l_, sg_))) / lim_)
    return add_[..., None]
# ---------- the stars a camera exposed for dark ground would record: real ones, from the HYG catalogue (Hipparcos, Yale, Gliese)
STARS = None
if spec.get("stars"):
    sp = spec["stars"]; ppd = sp["px_per_deg"]; sx, sy = sp["sun_xy"]; lam_s = sp["sun_ecl_lon"]; eps = math.radians(23.4393); lim = sp.get("mag_limit", 9.5)
    # the view: from the south pole the horizon runs along the ecliptic, south is up, and ecliptic longitude grows to the right. The Sun fixes the place; the date (its longitude) is our choice, the source gives none.
    layer = np.zeros((H + EXT + 200, W + 200, 3), np.float32); cnt = 0
    cat = os.path.join(os.environ.get("STAR_CATALOGUE_DIR", HERE), sp["catalogue"])      # the catalogue file is not kept in the repository (13 MB): github.com/astronexus/HYG-Database, hyg/v3/hyg_v38.csv.gz, CC BY-SA 4.0
    def put_point(px, py, mag, ci, planet=False):
        col = np.clip(np.array([1.0 + 0.25 * (0.6 - ci), 1.0, 1.0 - 0.22 * (0.6 - ci)], np.float32), 0.7, 1.25)      # blue stars a little blue, red ones a little warm (BGR)
        flux = sp.get("gain", 1.0) * 1.7 * 10 ** (-0.4 * 0.6 * (mag - 4.0)); sig = 0.75 + 0.35 * max(0.0, 4.0 - mag) ** 0.5; rad_ = int(3 * sig) + 2; ix, iy = int(px), int(py)      # a camera's response is compressed: faint stars still register
        g = np.exp(-(((np.arange(ix - rad_, ix + rad_ + 1) - px)[None] ** 2 + (np.arange(iy - rad_, iy + rad_ + 1) - py)[:, None] ** 2) / (2 * sig * sig)))
        layer[iy - rad_:iy + rad_ + 1, ix - rad_:ix + rad_ + 1] += ((300.0 if planet else min(flux, 6.0) * 150.0) * g)[..., None] * (col / col.max() if planet else col)      # a planet is held just under white at its centre, so its colour shows
    with gzip.open(cat, "rt") as fh:
        for row in csv.DictReader(fh):
            try: mag = float(row["mag"]); ra = math.radians(float(row["ra"]) * 15.0); dec = math.radians(float(row["dec"]))
            except ValueError: continue
            if mag > lim or mag < -2: continue
            sb = math.sin(dec) * math.cos(eps) - math.cos(dec) * math.sin(eps) * math.sin(ra); beta = math.degrees(math.asin(sb))
            lam = math.degrees(math.atan2(math.sin(ra) * math.cos(eps) + math.tan(dec) * math.sin(eps), math.cos(ra))) % 360.0
            dl = (lam - lam_s + 180.0) % 360.0 - 180.0; px = sx + dl * ppd * math.cos(math.radians(beta)) + 100; py = sy + beta * ppd + 100 + EXT
            if not (4 <= px < W + 196 and 4 <= py < H + EXT + 196): continue
            try: ci = float(row["ci"])
            except ValueError: ci = 0.6
            put_point(px, py, mag, ci); cnt += 1
    for pl in sp.get("planets", []):                                       # planets where the ephemeris puts them on the take's date (earth_face.py prints them): steady points on the ecliptic
        px = sx + pl["dlon"] * ppd * math.cos(math.radians(pl["lat"])) + 100; py = sy + pl["lat"] * ppd + 100 + EXT
        if 4 <= px < W + 196 and 4 <= py < H + EXT + 196: put_point(px, py, pl["mag"], pl.get("ci", 0.8), True); print("planet", pl["name"], "at", round(px - 100), round(py - 100 - EXT), flush=True)
    STARS = np.clip(layer, 0, 255); print("stars placed", cnt, flush=True)
MILKY = None
if spec.get("stars") and spec["stars"].get("sky_map"):                     # the faint stars and the Milky Way they make up: NASA's Deep Star Maps 2020 (svs.gsfc.nasa.gov/4851), drawn from the Gaia, Hipparcos and Tycho catalogues. The part of the sky in view
    sm_ = spec["stars"]["sky_map"]; mp_ = os.path.join(os.environ.get("STAR_CATALOGUE_DIR", HERE), sm_["file"]); mw = np.load(mp_).astype(np.float32)[..., ::-1]      # is cut out of the map beforehand (sky_cut.py); the map is the whole sky, right ascension leftwards from the middle, north up
    mt = json.load(open(mp_ + ".json")) if os.path.exists(mp_ + ".json") else {"full_w": mw.shape[1], "full_h": mw.shape[0], "col0": 0, "row0": 0}
    if mt["full_w"] / 360.0 > 1.25 * ppd: zs_ = ppd / (mt["full_w"] / 360.0); mw = cv2.resize(np.ascontiguousarray(mw), None, fx=zs_, fy=zs_, interpolation=cv2.INTER_AREA); mt = {k_: v_ * zs_ for k_, v_ in mt.items()}      # a finer map than the take needs: brought down by area
    ly, lx_ = np.mgrid[0:H + EXT + 200, 0:W + 200].astype(np.float32); beta_ = np.radians((ly - 100 - EXT - sy) / ppd); lam_ = np.radians(lam_s) + np.radians((lx_ - 100 - sx) / ppd) / np.maximum(np.cos(beta_), 0.2)
    xe, ye, ze = np.cos(beta_) * np.cos(lam_), np.cos(beta_) * np.sin(lam_), np.sin(beta_); yq = ye * math.cos(eps) - ze * math.sin(eps); zq = ye * math.sin(eps) + ze * math.cos(eps)
    ra_ = np.mod(np.arctan2(yq, xe), 2 * math.pi); dec_ = np.arcsin(np.clip(zq, -1, 1)); mcol = (np.mod(0.5 - ra_ / (2 * math.pi), 1.0) * mt["full_w"] - 0.5 - mt["col0"]).astype(np.float32); mrow = ((0.5 - dec_ / math.pi) * mt["full_h"] - 0.5 - mt["row0"]).astype(np.float32)
    g_ = cv2.remap(mw, mcol, mrow, cv2.INTER_CUBIC, borderMode=cv2.BORDER_CONSTANT); g_ = g_.mean(2, keepdims=True) + (g_ - g_.mean(2, keepdims=True)) * sm_.get("colour", 1.0); del mw, beta_, lam_, xe, ye, ze, yq, zq, ra_, dec_, mcol, mrow
    per_s10 = sm_.get("f10", 0.0) / (ppd * ppd)                             # the map's value for one S10 unit (a 10th-magnitude star spread over a square degree). f10: the map's sum for a 10th-magnitude star, measured on catalogue stars
    if sm_.get("zodiacal"):                                                 # the zodiacal light, in the same units: on the ecliptic s10 / sin(angle from the Sun) ^ power, as Clementine's star trackers measured it from lunar orbit (arXiv astro-ph/0204111, eq. 5; 3 to 30 degrees).
        zz = sm_["zodiacal"]; zfac = 1.0
        if zz.get("shape"):                                                 # off the ecliptic: the same paper's dust model (zodi_shape.py works it out), as a part of the ecliptic's brightness at the same angle from the Sun
            zt = json.load(open(os.path.join(HERE, zz["shape"]))); zr = np.array(zt["ratio"], np.float32); bd = np.abs(ly - 100 - EXT - sy) / ppd; ld = np.abs(lx_ - 100 - sx) / ppd / np.maximum(np.cos(np.radians(bd)), 0.2)
            ee = np.clip(np.degrees(np.arccos(np.clip(np.cos(np.radians(ld)) * np.cos(np.radians(bd)), -1, 1))), zz.get("min_deg", 3.0), 89.0)
            zfac = cv2.remap(zr, np.clip(ld / (zt["lon_deg"][1] - zt["lon_deg"][0]), 0, zr.shape[1] - 1).astype(np.float32), np.clip(bd / (zt["lat_deg"][1] - zt["lat_deg"][0]), 0, zr.shape[0] - 1).astype(np.float32), cv2.INTER_LINEAR); del bd, ld
        else: ee = np.clip(np.hypot((lx_ - 100 - sx) / ppd, (ly - 100 - EXT - sy) / ppd / zz.get("flatten", 0.6)), zz.get("min_deg", 3.0), 89.0)      # without the model it is taken to fall as if the glow were flattened by "flatten": an assumption
        g_ = g_ + (zz["s10"] / np.sin(np.radians(ee)) ** zz["power"] * zfac * per_s10)[..., None] * np.array(zz.get("colour", [1.0, 0.95, 0.86]), np.float32)[::-1]; del ee, zfac
    if sm_.get("earth_night"):                                              # the Earth's night side, lit by the Moon the camera stands on (earth_face.py makes the face turned to the Moon). It hides the sky behind it
        en = sm_["earth_night"]; tx = np.load(os.path.join(os.environ.get("STAR_CATALOGUE_DIR", HERE), en["file"])); h2 = tx.shape[0]; ex0 = int(round(en["at"][0] + 100 - h2 / 2.0)); ey0 = int(round(en["at"][1] + 100 + EXT - h2 / 2.0))
        g_[ey0:ey0 + h2, ex0:ex0 + h2] = g_[ey0:ey0 + h2, ex0:ex0 + h2] * (1 - tx[..., 3:]) + tx[..., 2::-1] * (en["s10_white"] * per_s10) * tx[..., 3:]
        if en.get("lights"):                                                # the lights of its cities, where it is night there (NASA's Black Marble map through earth_face.py). Their strength against the moonlit clouds is our choice
            lg = np.load(os.path.join(os.environ.get("STAR_CATALOGUE_DIR", HERE), en["lights"])); g_[ey0:ey0 + h2, ex0:ex0 + h2] += lg[..., None] * (en.get("lights_s10", 30000.0) * per_s10) * np.array(en.get("lights_colour", [1.0, 0.82, 0.55]), np.float32)[::-1]
    x_ = np.power(np.clip(sm_.get("gain", 2.5) * g_, 0, None), sm_.get("power", 0.7)); sh_ = float(sm_.get("shoulder", 0)); MILKY = (255.0 * ((1 - np.exp(-sh_ * x_)) / sh_ if sh_ else np.clip(x_, 0, 1))).astype(np.float16); del ly, lx_, g_, x_      # shoulder: bright parts are pressed together as film does, so the moonlit Earth does not burn out
    print("sky map laid in, mean level %.1f" % float(MILKY.astype(np.float32).mean()), flush=True)
ZOD = None
if spec.get("stars") and spec["stars"].get("zodiacal"):                    # the zodiacal light: sunlight scattered by the dust between the planets, a lens-shaped glow along the ecliptic that brightens steeply toward the Sun
    zo = spec["stars"]["zodiacal"]; ly, lx_ = np.mgrid[0:H + EXT + 200, 0:W + 200].astype(np.float32); bz = (ly - 100 - EXT - sy) / ppd; ez = np.maximum(np.hypot((lx_ - 100 - sx) / ppd, bz), zo.get("inner_deg", 9.0))      # (photographed from lunar orbit by Clementine's star trackers, arXiv astro-ph/0204111). Its shape is modelled here, its strength is our choice
    ZOD = (zo.get("level", 30.0) * (ez / 20.0) ** -zo.get("slope", 2.3) * np.exp(-0.5 * (bz / (zo.get("width_deg", 3.5) + zo.get("flare", 0.16) * ez)) ** 2)).astype(np.float32); ZOD = np.minimum(ZOD, zo.get("max", 70.0)); del ly, lx_, bz, ez
# ---------- a planet redrawn with the phase its angle from the Sun gives it (the source's crescent is thicker than that angle allows)
EARTH = None; ETR = None
if spec.get("earth"):
    ea = spec["earth"]; er = float(ea["r"]); efile = cache + ".earth_%d_%d.npy" % (int(ea["at"][0]), int(ea["at"][1]))
    if os.path.exists(efile): ETR = np.load(efile)
    else:                                                                   # where the planet is in every source frame: a circle through its lit limb
        ETR = np.zeros((n, 2), np.float32); cx_, cy_ = ea["at"]
        for i_ in list(range(r, n)) + list(range(r - 1, -1, -1)):
            if i_ == r - 1: cx_, cy_ = ETR[r]
            xa_, ya_ = int(cx_ - er - 40), int(max(cy_ - er - 40, 0)); gq = cv2.cvtColor(np.ascontiguousarray(F[i_][ya_:int(cy_ + er + 40), xa_:int(cx_ + er + 40)]), cv2.COLOR_BGR2GRAY); ys_, xs_ = np.nonzero(gq > 70)
            if len(ys_) > 50:
                P_ = np.array([(xs_[ys_ == y_].max(), y_) for y_ in np.unique(ys_)], np.float64); A_ = np.c_[2 * P_[:, 0], 2 * P_[:, 1], np.ones(len(P_))]; c_ = np.linalg.lstsq(A_, (P_ ** 2).sum(1), rcond=None)[0]
                if abs(math.sqrt(max(c_[2] + c_[0] ** 2 + c_[1] ** 2, 0)) - er) < 4: cx_, cy_ = c_[0] + xa_, c_[1] + ya_
            ETR[i_] = (cx_, cy_)
        np.save(efile, ETR)
    q_ = 4; n_e = int(2 * (er + 14)) * q_; gy_, gx_ = np.mgrid[0:n_e, 0:n_e].astype(np.float32); u_ = (gx_ - n_e / 2 + 0.5) / (er * q_); v_e = (gy_ - n_e / 2 + 0.5) / (er * q_); rho = np.hypot(u_, v_e)
    el = math.radians(ea["elong_deg"]); z_e = np.sqrt(np.clip(1 - rho * rho, 0, 1)); lam_i = np.clip((u_ * math.sin(el) - z_e * math.cos(el)) / math.sin(el), 0, 1) * (rho <= 1)      # sunlight on a sphere, the Sun at that angle to the right and far behind it
    th_ = np.degrees(np.arctan2(v_e, u_)); rim = np.exp(-((rho - 1.0) / 0.012) ** 2) * (0.5 * np.clip(np.cos(np.radians(th_)), 0, 1) ** 1.2 + 0.10 * np.exp(-np.maximum(np.abs(th_) - 90.0, 0) / 8.0) * (np.abs(th_) > 75))      # the air at the limb: a thin blue line that carries the horns of the crescent a little way round
    # its colours are the source's own: sea, cloud and land read along the source's crescent, a few pixels in from the limb
    tk = np.arange(-120, 121, 1.0); ref8 = np.ascontiguousarray(F[r]).astype(np.float32); C_ = np.zeros((len(tk), 3), np.float32)
    for rr_ in np.arange(er - 9.0, er - 3.0, 1.0): C_ += cv2.remap(ref8, (ETR[r, 0] + rr_ * np.cos(np.radians(tk))).astype(np.float32)[None], (ETR[r, 1] + rr_ * np.sin(np.radians(tk))).astype(np.float32)[None], cv2.INTER_LINEAR)[0]
    ok_ = C_.max(1) > 0.35 * C_.max(); C_ = np.stack([np.interp(tk, tk[ok_], C_[ok_, c]) for c in range(3)], 1); C_ = cv2.GaussianBlur(C_[None].astype(np.float32), (0, 0), 1.5)[0]; C_ = C_ / C_.max()      # past the ends of the source's crescent: the colour at its ends
    C_ = np.clip(C_ * 1.25, 0, 1) ** 0.8; hue = np.stack([np.interp(th_, tk, C_[:, c]) for c in range(3)], -1)
    if ea.get("face_day"):                                                  # the colours of the face it turns to the Moon at the take's moment (earth_face.py), in place of the source's colours
        fd = np.load(os.path.join(os.environ.get("STAR_CATALOGUE_DIR", HERE), ea["face_day"])); hf = fd.shape[0]; hue = cv2.remap(np.ascontiguousarray(fd[..., ::-1]), (u_ * er + hf / 2.0 - 0.5).astype(np.float32), (v_e * er + hf / 2.0 - 0.5).astype(np.float32), cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
        hue = np.clip(hue * 1.15 + 0.12, 0, 1) * (1 - (1 - np.clip(lam_i / 0.4, 0, 1))[..., None] ** 2 * np.array([0.6, 0.35, 0.0], np.float32))      # near the day-night line the Sun is setting there: its light has come through a long path of air and is red
    ecol = (lam_i ** 0.45)[..., None] * hue * 255.0 + rim[..., None] * np.array([255, 228, 196], np.float32); lum_e = np.clip(lam_i ** 0.45 + rim, 0, 1)
    EARTH = (cv2.resize(np.clip(ecol, 0, 255), (n_e // q_, n_e // q_), interpolation=cv2.INTER_AREA), cv2.resize(np.clip(lum_e * 1.6, 0, 1), (n_e // q_, n_e // q_), interpolation=cv2.INTER_AREA))
def steady(a, sig=4.0):
    """a followed point's path with the measuring noise taken out"""
    k = int(3 * sig); b_ = np.vstack([2 * a[0] - a[k:0:-1], a, 2 * a[-1] - a[-2:-k - 2:-1]]); w_ = np.exp(-np.arange(-k, k + 1) ** 2 / (2 * sig * sig)); w_ /= w_.sum(); return np.stack([np.convolve(b_[:, c], w_, "valid") for c in range(a.shape[1])], 1).astype(np.float32)
ETS = steady(ETR) if ETR is not None else None; EOFF = np.array(spec["earth"].get("offset", [0.0, 0.0]), np.float32) if spec.get("earth") else None      # offset: from where the source drew the planet to where it stood on the take's date
def off(px, py, i):
    """how far something in the sky has moved from where it was picked in the reference frame. The sky is infinitely far, so all of it moves as the planet does (followed in the source); without a planet, as the far horizon does"""
    if ETS is not None: return float(ETS[i, 0] - ETS[r, 0]), float(ETS[i, 1] - ETS[r, 1])
    return float(vp[i, 0] - vp[r, 0]), float(vp[i, 1] - vp[r, 1])
# ---------- where the sky really ends, and the glare the source lays over everything
SKYL = np.array(spec["skyline"], np.float32) if spec.get("skyline") else None      # "skyline": the top of the ground across the wide picture in the reference frame, traced by hand. Where a far ridge is unlit it is as dark as the sky,
SKYM = np.interp(np.arange(W), [0, spec.get("skyline_near_x", 1170) - 60, spec.get("skyline_near_x", 1170)], [40.0, 40.0, 3.0]).astype(np.float32) if SKYL is not None else None      # and only this line tells them apart: without it stars were drawn on the mountain. (Left of "skyline_near_x" the ground is a near, sunlit hill that finds its own edge; there the line only has to lie below it.)
VEIL = None
if spec.get("sky_clean") and SKYL is not None:                              # The source has a lens glow round the Sun that is strongly blue and reaches across the whole frame (blue 83, red 41 at 4 degrees from the Sun): it reads as air, and the Moon has none.
    sc_ = spec["sky_clean"]; vfile = cache + ".veil_" + hashlib.md5((SKYL.tobytes() + json.dumps(sc_, sort_keys=True).encode())).hexdigest()[:10] + ".npy"; RB = np.arange(0.0, 4200.0, 12.0)      # How strong it is at each distance from the Sun is read from the sky itself (the middle value of all sky pixels at that distance: the sky has nothing else in it),
    if os.path.exists(vfile): VEIL = np.load(vfile)
    else:                                                                   # frame by frame, on a quarter-size copy
        VEIL = np.zeros((n, len(RB), 3), np.float32); q4 = 4; ys4, xs4 = np.mgrid[0:H // q4, 0:W // q4].astype(np.float32) * q4 + q4 / 2
        for i_ in range(n):
            f4 = cv2.resize(np.ascontiguousarray(F[i_]), (W // q4, H // q4), interpolation=cv2.INTER_AREA).astype(np.float32); ddx, ddy = float(vp[i_, 0] - vp[r, 0]), float(vp[i_, 1] - vp[r, 1]); ox_, oy_ = off(0, 0, i_)
            sk4 = ys4 < np.interp(xs4[0] - ddx, SKYL[:, 0], SKYL[:, 1])[None] + ddy - 12
            if ETR is not None: sk4 &= np.hypot(xs4 - ETR[i_, 0], ys4 - ETR[i_, 1]) > spec["earth"]["r"] + 26
            rr4 = np.hypot(xs4 - spec["stars"]["sun_xy"][0] - ox_, ys4 - spec["stars"]["sun_xy"][1] - oy_); bi = np.clip((rr4[sk4] / 12.0).astype(int), 0, len(RB) - 1); v4 = f4[sk4]; order_ = np.argsort(bi, kind="stable"); bi, v4 = bi[order_], v4[order_]; cuts_ = np.searchsorted(bi, np.arange(len(RB) + 1))
            got = np.array([cuts_[b_ + 1] - cuts_[b_] >= 20 for b_ in range(len(RB))]); med_ = np.array([np.median(v4[cuts_[b_]:cuts_[b_ + 1]], 0) if got[b_] else np.zeros(3) for b_ in range(len(RB))], np.float32)
            for c_ in range(3): VEIL[i_, :, c_] = np.minimum.accumulate(np.interp(RB, RB[got], med_[got, c_]))      # it only falls with distance
        VEIL = cv2.GaussianBlur(VEIL, (0, 0), sigmaX=1.5, sigmaY=2.0); np.save(vfile, VEIL)      # steadied along distance and from frame to frame
    print("glare read from the sky: at 4 degrees from the Sun (blue, green, red) %s, at 12 degrees %s" % (VEIL[r, int(420 / 12)].round(0), VEIL[r, int(1260 / 12)].round(0)), flush=True)
# ---------- a foreground shot (black sky behind its subject) stood in front of the view
OV = None; VIG = None
MOVERS = spec.get("movers", [])
if os.environ.get("PREPARE"): print("prepared"); sys.exit()
def lander_sprite(tilt_deg, side, px=26, lit_part=0.5, flame=0.0):
    """a small crewed lander as it would look from kilometres away: cabin, body with a foil band, legs, engine bell, an aerial; lit from one side. Returns colour and cover, 26 px square.
    lit_part: how much of its width the Sun lights. Seen at right angles to the Sun that is half; seen nearly toward the Sun (the Sun a few degrees off behind it) only a thin edge is lit and the rest is in its own shadow.
    flame: with the engine burning, its light falls on the bell, the legs and the underside."""
    q = 8; n_ = 26 * q; im = np.zeros((n_, n_, 3), np.float32); al = np.zeros((n_, n_), np.float32); P = lambda pts: np.round(np.array(pts, np.float32) * q).astype(np.int32)
    def poly(pts, col, a=1.0): cv2.fillPoly(im, [P(pts)], col, lineType=cv2.LINE_AA); cv2.fillPoly(al, [P(pts)], a, lineType=cv2.LINE_AA)
    def line(a_, b_, col, th): cv2.line(im, tuple(P([a_])[0]), tuple(P([b_])[0]), col, int(th * q), cv2.LINE_AA); cv2.line(al, tuple(P([a_])[0]), tuple(P([b_])[0]), 1.0, int(th * q), cv2.LINE_AA)
    lit, mid, dim = (236, 236, 232), (150, 150, 152), (70, 72, 78); back = float(np.clip((0.5 - lit_part) / 0.5, 0, 1))
    def tone(pts, col): cv2.fillPoly(im, [P(pts)], col, lineType=cv2.LINE_AA)      # colour only: what it covers is already drawn
    for fx in (-1, 1): line((13 + fx * 3.6, 15.2), (13 + fx * 7.2, 20.6), mid, 0.5); line((13 + fx * 6.4, 20.8), (13 + fx * 8.2, 20.8), lit, 0.5)      # legs and footpads
    poly([(11.6, 15.6), (14.4, 15.6), (15.2, 18.2), (10.8, 18.2)], dim)                                       # engine bell
    poly([(8.0, 11.6), (9.6, 10.2), (16.4, 10.2), (18.0, 11.6), (18.0, 14.6), (16.6, 15.8), (9.4, 15.8), (8.0, 14.6)], mid)      # descent stage
    poly([(13.0, 10.2), (16.4, 10.2), (18.0, 11.6), (18.0, 14.6), (16.6, 15.8), (13.0, 15.8)] if side > 0 else [(13.0, 10.2), (9.6, 10.2), (8.0, 11.6), (8.0, 14.6), (9.4, 15.8), (13.0, 15.8)], lit)      # its sunlit half
    poly([(8.0, 12.9), (18.0, 12.9), (18.0, 14.0), (8.0, 14.0)], (70, 150, 205))                              # a band of gold foil
    poly([(10.4, 5.6), (15.6, 5.6), (16.4, 7.0), (16.4, 10.2), (9.6, 10.2), (9.6, 7.0)], mid)                # cabin
    poly([(13.0, 5.6), (15.6, 5.6), (16.4, 7.0), (16.4, 10.2), (13.0, 10.2)] if side > 0 else [(13.0, 5.6), (10.4, 5.6), (9.6, 7.0), (9.6, 10.2), (13.0, 10.2)], lit)
    poly([(11.0, 7.0), (12.6, 7.0), (12.6, 8.4), (11.0, 8.4)], (40, 34, 30)); line((14.6, 5.6), (16.6, 2.6), mid, 0.35)      # a window, an aerial
    poly([(12.2, 4.7), (13.8, 4.7), (13.8, 5.6), (12.2, 5.6)], mid); line((10.6, 5.8), (8.9, 3.9), mid, 0.3); cv2.ellipse(im, tuple(P([(8.5, 3.5)])[0]), (int(1.2 * q), int(0.8 * q)), -40, 0, 360, lit, -1, cv2.LINE_AA); cv2.ellipse(al, tuple(P([(8.5, 3.5)])[0]), (int(1.2 * q), int(0.8 * q)), -40, 0, 360, 1.0, -1, cv2.LINE_AA)      # a docking port on top, a dish on a short boom
    for fx in (-1, 1): line((13 + fx * 3.9, 8.0), (13 + fx * 4.7, 8.0), dim, 0.3); line((13 + fx * 4.3, 7.5), (13 + fx * 4.3, 8.5), dim, 0.3); line((13 + fx * 2.0, 15.8), (13 + fx * 7.0, 20.5), dim, 0.25)      # thruster clusters on the cabin's sides, a second strut on each leg
    line((10.5, 10.4), (10.5, 15.6), dim, 0.2); line((15.5, 10.4), (15.5, 15.6), dim, 0.2); line((13.4, 10.2), (13 + side * 5.6, 19.4), dim, 0.22)      # panel seams, a ladder down the sunward leg
    if back > 0:                                                            # seen toward the Sun: everything but the edge turned to it is in the craft's own shadow, lit only by the grey ground far below
        xe = 13 + side * 5.0 - side * 10.0 * lit_part; keep = im.copy(); im *= (1 - 0.72 * back) * np.array([1.06, 1.0, 0.95], np.float32)
        edge = np.clip(((np.arange(n_, dtype=np.float32) / q - xe) * side) / 0.5 + 0.5, 0, 1)[None, :, None]; im = im * (1 - edge) + keep * edge
    if flame > 0:                                                           # the engine's own light from below: warm, strongest on the bell and the legs, fading up the body
        up_ = np.clip((np.arange(n_, dtype=np.float32) / q - 9.0) / 9.0, 0, 1)[:, None, None] ** 1.5; im = im + flame * up_ * al[..., None] * np.array([120.0, 165.0, 205.0], np.float32)
    for fx in (-1, 1): cv2.circle(im, tuple(P([(13 + fx * 2.9, 16.0)])[0]), int(0.45 * q), (225, 240, 252), -1, cv2.LINE_AA)      # two landing lights under the body
    M = cv2.getRotationMatrix2D((13 * q, 16.5 * q), tilt_deg, 1.0); im = cv2.warpAffine(im, M, (n_, n_), flags=cv2.INTER_LINEAR); al = cv2.warpAffine(al, M, (n_, n_), flags=cv2.INTER_LINEAR)
    return cv2.resize(im, (px, px), interpolation=cv2.INTER_AREA), cv2.resize(al, (px, px), interpolation=cv2.INTER_AREA)
def person_sprite(step, face, side, lean=0.0, kneel=0.0):
    """someone in a pressure suit seen from far off: helmet and visor, a backpack, arms, legs in mid-stride; lit from one side. Returns colour and cover, 16 x 24 px (the figure is 20 px tall).
    Proportions are those measured on a photograph of a suited astronaut standing on the Moon (NASA AS11-40-5903): helmet 0.22 of the body's height, each leg 0.13, shoulders with arms about 0.4 seen from the side.
    lean: degrees the body is bent forward at the hips, arms reaching down (someone working at something on the ground). kneel: 0 standing to 1 down on the knees."""
    q = 8; wq, hq = 16 * q, 24 * q; im = np.zeros((hq, wq, 3), np.float32); al = np.zeros((hq, wq), np.float32); P = lambda pts: np.round(np.array(pts, np.float32) * q).astype(np.int32)
    def poly(pts, col): cv2.fillPoly(im, [P(pts)], col, lineType=cv2.LINE_AA); cv2.fillPoly(al, [P(pts)], 1.0, lineType=cv2.LINE_AA)
    def line(a_, b_, col, th): cv2.line(im, tuple(P([a_])[0]), tuple(P([b_])[0]), col, max(int(th * q), 1), cv2.LINE_AA); cv2.line(al, tuple(P([a_])[0]), tuple(P([b_])[0]), 1.0, max(int(th * q), 1), cv2.LINE_AA)
    suit, pack, boot = (232, 232, 230), (205, 206, 208), (150, 150, 152); ca_, sa_ = math.cos(math.radians(lean) * face), math.sin(math.radians(lean) * face)
    dk_ = 4.6 * kneel; B = lambda pt: (8 + (pt[0] - 8) * ca_ - (pt[1] - 13.8) * sa_, 13.8 + dk_ + (pt[0] - 8) * sa_ + (pt[1] - 13.8) * ca_)      # the body above the hips, turned about them; kneeling, the hips come down
    for sg in (-1, 1):
        if kneel > 0.02: kn_ = (8 + sg * 1.0 + face * 3.0 * kneel, 13.8 + dk_ + (21.0 - 13.8 - dk_) * (0.55 + 0.45 * kneel)); ft_ = (8 + sg * 1.0 - face * 2.2 * kneel, 21.3); line((8 + sg * 1.0, 13.8 + dk_), kn_, suit, 2.5); line(kn_, ft_, suit, 2.2); line((ft_[0] - 0.4, 21.6), (ft_[0] + 0.5, 21.6), boot, 1.0)      # thigh forward to the knee, shin back along the ground
        else: line((8 + sg * 1.2, 13.8), (8 + sg * 1.2 + sg * step * 1.9, 21.2), suit, 2.5); line((8 + sg * 1.2 + sg * step * 1.9 - 0.5, 21.5), (8 + sg * 1.2 + sg * step * 1.9 + 1.1 * face, 21.5), boot, 1.2)      # legs and boots, in step
    poly([B(v_) for v_ in [(8 - face * 5.2, 4.4), (8 - face * 2.2, 4.4), (8 - face * 2.2, 14.0), (8 - face * 5.2, 14.0)]], pack)        # the backpack, behind
    poly([B(v_) for v_ in [(5.2, 6.3), (10.8, 6.3), (11.0, 14.4), (5.0, 14.4)]], suit)                                                  # body
    rch = min(lean / 40.0, 1.0)                                              # bent over, the arms hang toward the ground ahead
    for sg in (-1, 1): sh_ = B((8 + sg * 2.7, 7.6)); hd_ = B((8 + sg * 3.3 - sg * step * 0.9, 12.8)); line(sh_, (hd_[0] * (1 - rch) + (sh_[0] + face * 1.2) * rch, hd_[1] * (1 - rch) + min(sh_[1] + 5.6, 20.6) * rch), suit, 2.0)      # arms
    hc_ = B((8, 3.9)); cv2.circle(im, tuple(P([hc_])[0]), int(2.35 * q), suit, -1, cv2.LINE_AA); cv2.circle(al, tuple(P([hc_])[0]), int(2.35 * q), 1.0, -1, cv2.LINE_AA)      # helmet
    cv2.ellipse(im, tuple(P([B((8 + face * 1.0, 4.1))])[0]), (int(1.45 * q), int(1.35 * q)), 0, 0, 360, (38, 74, 112), -1, cv2.LINE_AA)                                 # gold visor, turned the way they walk
    ramp = np.clip(0.5 + side * (np.arange(wq, dtype=np.float32) / q - 8.0) / 5.0, 0, 1)[None, :, None]; im = im * (0.55 + 0.45 * ramp) * np.where(ramp > 0.5, 1.0, np.array([1.06, 1.0, 0.94], np.float32))      # the side away from the Sun is dimmer and a little blue
    return cv2.resize(im, (16, 24), interpolation=cv2.INTER_AREA), cv2.resize(al, (16, 24), interpolation=cv2.INTER_AREA)
SUNG = spec.get("sun_ground") or (FING or {}).get("sun_ground")           # the point on the horizon under the Sun: shadows on the ground point away from it
ONSET = {}
def src_index(j):
    q = j + START
    if order == "forward": return q
    if order == "reverse": return n - 1 - q
    p_ = 2 * (n - 1); q = q % p_; return q if q < n else p_ - q                 # pingpong: there and back, never the same frame twice in a row
EASE = float(spec.get("turn_ease", 0))                                    # frames over which the source slows, stops and starts back where it turns round (pingpong), instead of reversing in one frame
def src_pos(j):
    """where in the source output frame j is, as a number that need not be whole"""
    if not EASE or order != "pingpong": return float(src_index(j))
    p_ = 2 * (n - 1); q = (j + START + np.linspace(-EASE / 2, EASE / 2, 41)) % p_; return float(np.where(q < n, q, p_ - q).mean())
def sky_piece(layer, dx, dy, y0r, Hh, c0, c1):
    """the part of a sky layer in view, placed to a fraction of a pixel (placed to whole pixels, the whole sky moved in steps)"""
    fx, fy = 100.0 - dx, 100.0 - dy + EXT + y0r; ix, iy = int(math.floor(fx)), int(math.floor(fy))
    a = np.ascontiguousarray(layer[iy - 3:iy + Hh + 4, ix + c0 - 3:ix + c1 + 4]).astype(np.float32)
    return np.maximum(cv2.warpAffine(a, np.float32([[1, 0, -(3 + fx - ix)], [0, 1, -(3 + fy - iy)]]), (c1 - c0, Hh), flags=cv2.INTER_LANCZOS4, borderMode=cv2.BORDER_REPLICATE), 0)
FLANK = [None]; LENSB = [None]; SUNVIS = [1.0]
def frame(j):
    """j: output frame number"""
    FLANK[0] = None; LENSB[0] = None
    u = src_pos(j); i = int(min(max(round(u), 0), n - 1)); t = j / FPS; dx, dy = float(vp[i, 0] - vp[r, 0]), float(vp[i, 1] - vp[r, 1])
    i0_ = int(min(max(math.floor(u), 0), n - 2)); part = (vp[i0_] * (1 - (u - i0_)) + vp[i0_ + 1] * (u - i0_)) - vp[i]      # between two source frames: the nearer one is used, moved by the part of the camera's move that is missing
    if PATH: xw = cam(t) - float(part[0]); yw = camy(t) - float(part[1]); c0 = int(max(0, math.floor(xw) - PAD)); c1 = int(min(W, math.floor(xw) + OW + PAD + 1))
    else: xw = yw = 0.0; c0, c1 = 0, W
    y0r = max(-EXT, int(math.floor(yw)) - 2) if yw < 0 else 0; y1r = min(H, y0r + 1920 + 5) if yw < 0 else H; Hh = y1r - y0r      # the rows in view: some may lie above the source, in the made sky
    cw = c1 - c0; xx = XX[EXT + y0r:EXT + y1r, c0:c1]; yy = YY[EXT + y0r:EXT + y1r, c0:c1]; rng_ = np.random.default_rng(1000 + j)
    o8 = src(i, max(y0r, 0), y1r, c0, c1)
    if y0r < 0:                                                             # sky above the source: the tone of the source's own top rows, thinning upward, with the same grain
        base = cv2.blur(src(i, 0, 8, c0, c1).astype(np.float32).mean(0)[None], (61, 1))[0]; fall = np.exp(yy[:-y0r, :1] / 900.0)
        ext = base[None] * fall[..., None] + rng_.normal(0, 1.6, (-y0r, cw, 1)).astype(np.float32); o8 = np.vstack([np.clip(ext, 0, 255).astype(np.uint8), o8])
    if EARTH is not None:                                                   # the source's Earth out, ours in, in the source picture itself, so everything after treats it as part of the shot
        ecx, ecy = float(ETR[i, 0]) - c0, float(ETR[i, 1]) - y0r; ncx, ncy = float(ETS[i, 0] + EOFF[0]) - c0, float(ETS[i, 1] + EOFF[1]) - y0r; er = spec["earth"]["r"]      # where the source has it; where ours goes
        ea_, eb_, ec_, ed_ = int(max(min(ecx, ncx) - er - 44, 0)), int(min(max(ecx, ncx) + er + 44, cw)), int(max(min(ecy, ncy) - er - 44, 0)), int(min(max(ecy, ncy) + er + 44, Hh))
        if eb_ > ea_ and ed_ > ec_:
            reg = o8[ec_:ed_, ea_:eb_].astype(np.float32); rr_ = np.hypot(xx[ec_:ed_, ea_:eb_] - c0 - ecx, yy[ec_:ed_, ea_:eb_] - y0r - ecy); ring = (rr_ > er + 24) & (rr_ < er + 40); skyc = reg[ring].mean(0) if ring.any() else np.array([14, 10, 8], np.float32)
            hole = np.clip((er + 19 - rr_) / 4.0, 0, 1)[..., None]; reg = reg + (skyc[None, None] + rng_.normal(0, 1.6, reg.shape[:2] + (1,)).astype(np.float32) - reg) * hole
            ecol, eal = EARTH; hs = ecol.shape[0] / 2.0; Me = np.float32([[1, 0, ncx - ea_ - hs], [0, 1, ncy - ec_ - hs]]); pc = cv2.warpAffine(ecol, Me, (eb_ - ea_, ed_ - ec_), flags=cv2.INTER_LINEAR); pa = cv2.warpAffine(eal, Me, (eb_ - ea_, ed_ - ec_), flags=cv2.INTER_LINEAR)[..., None]
            o8[ec_:ed_, ea_:eb_] = np.clip(reg * (1 - pa) + pc, 0, 255).astype(np.uint8)
    if spec.get("dark_clean"):                                              # the source carries a lens effect of thin, faint, slanting streaks, a few levels bright, which show in the sky and on the mountain's dark face as scratches.
        dc = spec["dark_clean"]; md = cv2.medianBlur(o8, int(dc.get("size", 9))); lm_ = cv2.cvtColor(md, cv2.COLOR_BGR2GRAY).astype(np.float32); l0_ = cv2.cvtColor(o8, cv2.COLOR_BGR2GRAY).astype(np.float32)      # Where the picture is dark and a pixel differs only a little from its surroundings' middle value, it takes that value: thin faint lines go,
        wd_ = np.clip((dc.get("below", 70.0) - lm_) / 12.0, 0, 1) * np.clip((dc.get("faint", 14.0) - np.abs(l0_ - lm_)) / 5.0, 0, 1)      # smooth shading stays, and anything clearly brighter (a lit ridge line, the crescent) is left alone
        o8 = np.clip(o8 * (1 - wd_[..., None]) + md * wd_[..., None], 0, 255).astype(np.uint8)
    o = o8.astype(np.float32); lum = cv2.cvtColor(o8, cv2.COLOR_BGR2GRAY).astype(np.float32)
    dark = (lum < SKYMAX[:, c0:c1]).astype(np.uint8); _, lab = cv2.connectedComponents(dark, connectivity=4); top = np.unique(lab[0][dark[0] > 0]); sky = np.isin(lab, top) & (dark > 0)       # the sky: the dark that reaches the top edge
    if SKYL is not None: sky &= yy < (np.interp(xx[0] - dx, SKYL[:, 0], SKYL[:, 1]) + np.interp(xx[0] - dx, np.arange(W), SKYM))[None] + dy      # nothing below the traced skyline is sky, however dark it is
    if VEIL is not None:
        sc_ = spec["sky_clean"]; sox, soy = off(0, 0, i); rsun = np.hypot(xx - spec["stars"]["sun_xy"][0] - sox, yy - spec["stars"]["sun_xy"][1] - soy); fl_ = np.array(sc_.get("floor", [8.0, 6.0, 6.0]), np.float32)
        kv_ = 1.0 / (1.0 + (rsun / sc_.get("core", 75.0)) ** 2); wv_ = (1.0 - kv_).astype(np.float32)      # close round the Sun a glow stays, because a lens does make one: all of it at the Sun, half at "core" pixels from it, a twentieth at four times that. The rest comes off everything, sky and ground alike (it is laid over both),
        vv_ = np.stack([np.interp(rsun, RB, VEIL[i, :, c_]) for c_ in range(3)], -1).astype(np.float32); o = np.maximum(o - (vv_ - fl_) * (wv_ * sc_.get("amount", 1.0))[..., None], 0)
        drop_ = key("sun_drop", t) if spec.get("sun_drop") else 0.0
        if spec.get("sun_height") and SKYL is not None:                      # "sun_height": the same, given as the height of the Sun's centre above the skyline where it stands, in pixels of this frame (the source frame and the traced skyline do not sit exactly as the reference frame has them, so a drop given in the reference frame's pixels missed the crest by up to 25 px)
            drop_ = float(np.interp(spec["stars"]["sun_xy"][0] + sox - dx, SKYL[:, 0], SKYL[:, 1]) + dy - 6.5 - key("sun_height", t) - spec["stars"]["sun_xy"][1] - soy)      # (6.5 px: the sky starts that far above the traced line)
        # "sun_drop": how far below the source's place the Sun stands, in pixels, through the take. A ridge's shadow can only grow over the plain if the Sun sinks toward that ridge; the source's Sun never moves.
        rdr_ = np.hypot(xx - spec["stars"]["sun_xy"][0] - sox, yy - spec["stars"]["sun_xy"][1] - soy - drop_) if (drop_ or spec.get("sun_height")) else rsun; kd_ = 1.0 / (1.0 + (rdr_ / sc_.get("core", 75.0)) ** 2)      # So the sky is drawn with the Sun where the shadow says it is (the ridge hides whatever of it is below the skyline)
        vis_ = 1.0                                                          # how much of the Sun's disc is above the ridge, as a part of it. There is no air on the Moon: every glow round the Sun is made in the lens, by the part of the Sun the lens sees
        if spec.get("sun_height") and SKYL is not None: hh_ = float(np.clip(key("sun_height", t) / float(sc_.get("disc", 28.0)), -1, 1)); vis_ = (1.0 - (np.arccos(hh_) - hh_ * np.sqrt(1.0 - hh_ * hh_)) / np.pi) ** 0.45; SUNVIS[0] = vis_ ** (1 / 0.45)      # (to the power 0.45: the glow is drawn in the picture's levels, which follow light to about that power)
        sky0_ = fl_ + (np.stack([np.interp(rdr_, RB, VEIL[i, :, c_]) for c_ in range(3)], -1).astype(np.float32) - fl_) * (kd_ * vis_)[..., None] if (drop_ or spec.get("sun_height")) else fl_ + (vv_ - fl_) * kv_[..., None]      # the sky near the Sun, as the glow alone would have it: smooth, without the source's coloured lens spots and streaks
        sline = np.interp(xx[0] - dx, SKYL[:, 0], SKYL[:, 1])[None] + dy; above = np.clip((sline - 5.0 - yy) / 3.0, 0, 1) * (xx[0] - dx >= spec.get("skyline_near_x", 1170) - 60)[None]      # the sky itself holds nothing but that glare, the source's coloured lens spots and its streaks: all of it above the traced line is set to black
        for (px, py, pr) in spec.get("discs", []): eox, eoy = off(px, py, i); above = above * np.clip((np.hypot(xx - px - eox, yy - py - eoy) - pr - 8.0) / 3.0, 0, 1)      # (not the Earth)
        sw_s = np.maximum(sky.astype(np.float32), above) * (1.0 if (spec.get("sun_drop") or spec.get("sun_height")) else np.clip((rsun - 30.0) / 30.0, 0, 1)); o = o * (1 - sw_s[..., None]) + sky0_ * sw_s[..., None]
        gk_ = np.clip(8.0 * np.maximum(kv_, 1.0 / (1.0 + (rdr_ / sc_.get("core", 75.0)) ** 2)), 0, 1)[..., None]; o = o + (o.mean(2, keepdims=True) - o) * gk_ * sc_.get("neutral", 0.7)      # what is left of the glow is made white: it was blue
        if sc_.get("disc"):                                                 # the Sun itself: a white disc of its true size (0.53 degrees) with the bright bloom a lens gives it, drawn on sky only
            tb_ = vis_ * 150.0 * np.exp(-(rdr_ / (1.9 * float(sc_["disc"]))) ** 2)      # the bright bloom close round the disc: on the sky, so the crest cuts it flat with the disc, and only a little of it over the ridge
            dsc = 255.0 * np.clip((float(sc_["disc"]) - rdr_) / 3.0 + 1.0, 0, 1) + tb_; o = np.maximum(o, np.minimum(o + dsc[..., None], 255.0) * sw_s[..., None])
            LENSB[0] = vis_ * 26.0 * np.exp(-(rdr_ / (5.5 * float(sc_["disc"]))) ** 2) + tb_ * sc_.get("bloom_spill", 0.2) * (1 - sw_s) if vis_ > 0.002 else None      # the wide glare over everything
            if LENSB[0] is not None and (spec.get("sun_drop") or spec.get("sun_height")): LENSB[0] = LENSB[0] + ((sky0_ - fl_).mean(2) * (1 - sw_s))      # the wide glow drawn on the sky (the measured lens glare) goes over the ground in front of the Sun too, not only up to the crest
            if LENSB[0] is not None and spec.get("sun_spikes"):             # the same lens that gives every lamp a four-pointed star gives the Sun one too, far longer: [length in px, level]
                sl_, sv_ = spec["sun_spikes"]; ex_ = np.abs(xx - spec["stars"]["sun_xy"][0] - sox); ey_ = np.abs(yy - spec["stars"]["sun_xy"][1] - soy - drop_)
                scx_, scy_ = spec["stars"]["sun_xy"][0] + sox, spec["stars"]["sun_xy"][1] + soy + drop_; out_ = max(xw - scx_, scx_ - (xw + OW), yw - scy_, scy_ - (yw + 1920), 0.0); inf_ = float(np.clip(1.0 - out_ / 30.0, 0, 1))      # only while the Sun's image falls on the picture: from outside it drew a hairline across the sky
                LENSB[0] = LENSB[0] + inf_ * vis_ * sv_ * (np.exp(-ex_ / sl_) * np.exp(-(ey_ / 2.0) ** 2) + np.exp(-ey_ / (0.6 * sl_)) * np.exp(-(ex_ / 2.0) ** 2))      # its bloom is the lens's: laid over the finished picture, sky and ground alike (so it spills over the crest), in proportion to the part of the disc in view
        if sc_.get("flank") and spec.get("ground_top"):                     # the unlit flank of the far ridge, between the skyline and the plain: in the source it is the sky's glare plus about a dozen levels of its own light, with no texture. What is left on it after
            gt_ = np.array(spec["ground_top"], np.float32); fk = np.clip((yy - sline - 2.0) / 4.0, 0, 1) * np.clip((np.interp(xx[0] - dx, gt_[:, 0], gt_[:, 1])[None] + dy + 30.0 - yy) / 30.0, 0, 1) * np.clip((xx[0] - dx - spec.get("skyline_near_x", 1170) + 300.0) / 300.0, 0, 1)[None]; FLANK[0] = fk      # the glare comes off is uneven (the glare is not quite round) and tinted.
            l_ = o @ np.array([0.114, 0.587, 0.299], np.float32); fk = fk * np.clip((sc_["flank"].get("dark_under", 70.0) - cv2.GaussianBlur(l_, (0, 0), 2.0)) / 20.0, 0, 1) * wv_      # Its dark parts are made even and grey at the level of its own light; its sunlit parts are left as they are
            lv_ = np.minimum(l_, float(sc_["flank"].get("level", 19.0))); o = o + (lv_[..., None] - o) * fk[..., None]
        if sc_.get("dark_neutral", 0) > 0:                                  # the glare is not quite the same everywhere at one distance from the Sun, so taking it off leaves dark things a little tinted (brown where too much blue went). What is dark is made grey
            l_ = (o @ np.array([0.114, 0.587, 0.299], np.float32))[..., None]; o = o + (l_ - o) * (np.clip((80.0 - l_) / 40.0, 0, 1) * sc_["dark_neutral"] * wv_[..., None])
        o = o.astype(np.float32); lum = (o @ np.array([0.114, 0.587, 0.299], np.float32)).astype(np.float32)
    ng, glab, st, _ = cv2.connectedComponentsWithStats((~sky).astype(np.uint8), connectivity=4); big = 1 + int(np.argmax(st[1:, cv2.CC_STAT_AREA]))
    gm = np.isin(glab, [c for c in range(1, ng) if c == big or st[c, cv2.CC_STAT_TOP] > 0]).astype(np.float32)   # the ground: everything that is not sky, except what touches the top edge
    for (px, py, pr) in spec.get("protect", []): ox_, oy_ = off(px, py, i); cv2.circle(gm, (int(round(px + ox_ - c0)), int(round(py + oy_ - y0r))), int(pr), 0.0, -1)      # the Earth or the Sun in the sky: never touched
    if spec.get("ground_top") and not (FRONT and FRONT.get("ridge_face_first")):      # nothing above this line is ground the shadow can reach (the flank of a far ridge is higher and keeps its light)
        gt = np.array(spec["ground_top"], np.float32); above = yy < np.interp(xx[0] - dx, gt[:, 0], gt[:, 1])[None] + dy
        if spec.get("ground_top_from"): xa_, xb_ = spec["ground_top_from"]; u_ = np.clip((xx[0] - dx - xa_) / (xb_ - xa_), 0, 1); gm = gm * (1 - (u_ * u_ * (3 - 2 * u_))[None] * above)      # the rule comes in gradually across the picture, so it leaves no edge
        else: gm[above] = 0.0
    if SKYL is not None and spec.get("sky_clean"): gm = gm * np.clip((yy - (np.interp(xx[0] - dx, SKYL[:, 0], SKYL[:, 1])[None] + dy) + 3.0) / 3.0, 0, 1)      # nothing above the traced skyline is ground, however bright the source is there (its glare round its own Sun was taken for ground and darkened at night)
    ground = np.maximum(cv2.GaussianBlur(gm, (0, 0), 2.0), gm)
    if spec.get("defringe", 0) > 0:                                        # the source's lens effect puts thin green, purple and orange rims on hard edges; a film lens does this far less
        mx_ = o.max(2); sat_ = (mx_ - o.min(2)) / np.maximum(mx_, 1.0); edge = cv2.dilate((np.abs(cv2.Sobel(lum, cv2.CV_32F, 1, 0, ksize=3)) + np.abs(cv2.Sobel(lum, cv2.CV_32F, 0, 1, ksize=3)) > 90).astype(np.float32), EL7)
        o = o + (lum[..., None] - o) * (np.clip((sat_ - 0.25) / 0.2, 0, 1) * edge * ground * spec["defringe"])[..., None]
    farw = 1.0
    if spec.get("highlight"):                                               # the brightest sunlit ground is brought down a little (above "from", by "slope"): its texture was close to white, where nothing can be seen, and the Sun has to be the brightest thing in the picture
        hl = spec["highlight"]; l_ = cv2.GaussianBlur(o @ np.array([0.114, 0.587, 0.299], np.float32), (0, 0), hl.get("base_px", 6.0)); o = o - (np.clip(l_ - hl["from"], 0, None) * (1 - hl["slope"]) * ground)[..., None]      # taken off the broad brightness only, as the same amount from all three colours: the fine detail on top keeps its full strength
    if spec.get("chroma_soft", 0) > 0:                                      # the Moon's ground is grey: colour that changes from one pixel to the next on it is the source's lens effect (yellow and purple rims on every small ridge, strongest toward the corners).
        l3_ = (o @ np.array([0.114, 0.587, 0.299], np.float32))[..., None]; c_ = o - l3_; o = l3_ + c_ + (cv2.GaussianBlur(c_, (0, 0), spec["chroma_soft"]) - c_) * ground[..., None]      # Colour is kept only as it varies over a few pixels and more; brightness is untouched
    if spec.get("clarity"):                                                 # the ground's and the base's own fine detail drawn more firmly, at several sizes. Each size's detail is held under "limit" levels, so a hard edge (a module against its shadow, the skyline) gets no halo.
        cw_ = ground                                                        # This is only safe on frames whose noise has been taken out first (fuse_frames.py); on single frames it draws the noise more firmly too
        if spec["clarity"].get("far"): fa_ = spec["clarity"]["far"]; farw = fa_["amount"] + (1 - fa_["amount"]) * np.clip((yy - dy - fa_["above_y"]) / fa_.get("soft", 150.0), 0, 1); cw_ = ground * farw      # the far hillside is drawn from a stretched texture in the source (long level streaks): it gets less, so the streaks are not what is drawn out
        o = np.clip(o + clarity(o, spec["clarity"]) * cw_[..., None], 0, 255)
    deep = key("deep", t); ang, rad_s, along_s, ridge_s = shadow_coord(xx, yy, i)                         # 0 = to the right along the horizon, 90 = straight down
    rel = 0.0
    if RELIEF:                                                              # the ground's own relief, read from its shading in the source: brighter than its surroundings = turned to the Sun
        l1 = cv2.GaussianBlur(lum, (0, 0), 1.6); l2 = blur_big(lum, 16.0); l3 = blur_big(lum, 60.0); rel = RELIEF * np.clip(0.6 * (l1 - l2) / np.maximum(l2, 24.0) + 0.9 * (l2 - l3) / np.maximum(l3, 24.0), -1.0, 1.0)
        if spec.get("edge_relief_soft"): rel = cv2.GaussianBlur(rel, (0, 0), float(spec["edge_relief_soft"]))      # (where bright ground meets something dark this jumps from one end of its range to the other, and cut the shadow's edge there as with a knife)
    if FING:                                                                # each bit of ground looks back along its ray to one place on that skyline
        sgx, sgy = FING["sun_ground"][0] + dx, FING["sun_ground"][1] + dy; phi = np.degrees(np.arctan2(yy - sgy, sgx - xx))
        rel = rel + FING["deg"] * np.interp(phi, FX, FT).astype(np.float32) * np.clip((np.hypot(xx - sgx, yy - sgy) - FING.get("near", 500.0)) / FING.get("grow", 1100.0), 0, 1)      # far ground under the Sun is seen too edge-on for the streaks to show
    if FRONT and isinstance(rel, np.ndarray): rel = rel * np.clip(ang / float(FRONT.get("rel_grow", 60.0)), 0, 1)      # a peak lengthens the ridge's shadow by a part of its length: the lobes (and the ground's own relief) grow with the distance from the foot, and are nothing at the foot itself
    m = shade(ang, rad_s, t, rel, along_s)
    if ridge_s is not None: m = np.where(ridge_s, 0.0, m).astype(np.float32)      # the ridge itself (above its foot) follows "crest_dark" below
    if ROCK and spec["overlay"]["rock"].get("in_sun"):                       # the rock by the camera stands above the plain: when the plain is in the ridge's shadow it is still in the sunlight the camera itself is in (the camera sees the Sun). Its lit top keeps its light
        rk_ = rock_mask(i, c0, y0r, float(spec["overlay"]["rock"]["in_sun"]), 0.0, m.shape)
        if rk_.max() > 0 and y1r == H:                                      # the rock itself, not the plain beside it: the dark that reaches the bottom of the picture inside the traced outline, and the lit rim just above that dark
            nk, kl, ks, _ = cv2.connectedComponentsWithStats(((cv2.GaussianBlur(lum, (0, 0), 1.5) < 60.0) & (rk_ > 0.5)).astype(np.uint8), connectivity=4); ids_ = np.unique(kl[-1])
            dk_ = cv2.dilate(np.isin(kl, [c for c in ids_ if c != 0 and ks[c, cv2.CC_STAT_AREA] > 4000]).astype(np.uint8), np.ones((2 * int(spec["overlay"]["rock"].get("in_sun_rim", 26)) + 1, 7), np.uint8)).astype(np.float32)
            m = m * (1 - cv2.GaussianBlur(np.maximum(dk_ * rk_, rock_mask(i, c0, y0r, -10.0, 0.0, m.shape)), (0, 0), 3.0))      # (everything under the traced line is rock, its sunlit facets too; above the line only what touches its dark)
    if spec.get("crest_edge"):                                              # where the high ground's light ends: not a level line drawn with a ruler but an edge that follows the ground, lower where a slope faces the Sun, and a few pixels soft
        ce = spec["crest_edge"]; up_ = np.clip((vp[i, 1] + ce.get("ragged", 1.2) * rel - yy) / ce.get("soft", 10.0) + 0.5, 0, 1)
        m = np.maximum(m * (1 - up_), crest_dark(t) * np.maximum(up_, (((ang >= 0) & (ang < 6)) if ridge_s is None else ridge_s).astype(np.float32))) * ground
    else: m[ang < 0] = 0.0; m = np.maximum(m, crest_dark(t) * (ang < 6)) * ground
    if ridge_s is not None and FRONT.get("ridge_face_first", False) and SKYL is not None:      # the ridge's face, between its foot and its crest. It faces away from the Sun, so only its facets turned to the Sun are lit (the source's bright patches on it),
        sk_ = np.interp(xx[0] - dx, SKYL[:, 0], SKYL[:, 1])[None] + dy; ft_ = np.interp(xx[0] - dx, GT_[:, 0], GT_[:, 1])[None] + dy      # and each loses the Sun when the crest behind it hides it: the shadow climbs the face from its foot (at the same moment as the plain's foot, "h_foot")
        qf_ = np.clip((ft_ - yy) / np.maximum(ft_ - sk_, 8.0), 0, 1); wv_f = 1.0 + 0.12 * np.sin((xx - dx) / 97.0 + 0.7) + 0.07 * np.sin((xx - dx) / 41.0 + 2.1) + 0.05 * np.sin((xx - dx) / 17.0 + 4.0)      # to the crest, which keeps the light until the Sun reaches it; at dawn it comes down the same way. (The edge wanders a little along the face: it is the outline of the crest behind)
        hth_ = FRONT["h_foot"] * (1.0 - qf_) ** FRONT.get("face_power", 1.5) * (1.0 + (wv_f - 1.0) * np.minimum(qf_ * 3.0, 1.0)); sh_h = key("sun_height", t); sfh_ = 4.0 + 0.08 * hth_      # (no wander at the very foot, where it meets the plain's edge exactly) sh_h = key("sun_height", t); sfh_ = 4.0 + 0.08 * hth_
        if FRONT.get("disc_penumbra"): mf_ = in_light(disc_hidden((sh_h - hth_) / float(spec["sky_clean"].get("disc", 28.0))))      # how much of the Sun's disc the crest behind it hides
        else: mf_ = np.clip((hth_ - sh_h) / sfh_ + 0.5, 0, 1); mf_ = mf_ * mf_ * (3 - 2 * mf_)
        m = np.where(ridge_s, mf_, m).astype(np.float32) * ground
    # ground that is sunlit takes the shadow colour. What is already dark stays: the black foreground as it is; an old shadow of an
    # object is raised to the level of the ground around it, because with the Sun gone there is nothing left to cast it.
    # The few pixels where dark and sunlit meet are a mix, and the source has thin coloured rims there, so they are filled in from both sides.
    lb = cv2.GaussianBlur(lum, (0, 0), 1.0); wb = np.clip((lb - 48.0) / 20.0, 0, 1); dm = (lb < 58.0).astype(np.uint8)
    if spec.get("old_shadow_rel"):                                          # a shadow is dark for where it lies: on the far plain NASA's shadows are lighter (70 of 255 against ground at 170) and were taken for lit ground, which the night then dimmed to black.
        bgl_ = cv2.GaussianBlur(cv2.dilate(cv2.GaussianBlur(lum, (0, 0), 3.0), np.ones((31, 31), np.uint8)), (0, 0), 15.0); rr_ = lb / np.maximum(bgl_, 1.0); r0_ = float(spec["old_shadow_rel"])      # So darkness is also judged against the lit ground close by
        wb = np.minimum(wb, np.clip((rr_ - r0_ + 0.06) / 0.12, 0, 1) * (bgl_ > 90.0) + (bgl_ <= 90.0)); dm = np.maximum(dm, ((rr_ < r0_) & (bgl_ > 90.0)).astype(np.uint8))
    nc, dl, dst, _ = cv2.connectedComponentsWithStats(dm, connectivity=4); small = np.isin(dl, [c for c in range(1, nc) if dst[c, cv2.CC_STAT_AREA] < SMALL]).astype(np.float32) * ground
    mx = o.max(2); sat = (np.clip(((mx - o.min(2)) / np.maximum(mx, 1.0) - 0.22) / 0.2, 0, 1) * np.maximum(wb, cv2.dilate(small, EL7)))[..., None]; on = o + (lum[..., None] - o) * sat      # strong colour on grey ground, and on small dark things such as posts (the source's lens fringes them blue and red), is an artefact; large dark things keep the colour the lens glare gives them
    soft = cv2.bilateralFilter(on, int(spec["lift_bilateral"][0]), float(spec["lift_bilateral"][1]), float(spec["lift_bilateral"][2])) if spec.get("lift_bilateral") else cv2.GaussianBlur(on, (0, 0), float(spec.get("lift_soft", 1.4))); on_n = on      # what an old shadow is raised from: smoothed, because raising it raises its noise too ("lift_bilateral" [size, levels, px] smooths only what differs by less than "levels", so the edges of things in it stay sharp)
    if spec.get("night_rims"):                                              # a module's edge that catches the Sun is a thin bright rim in the source. Dimmed like everything else it stayed a pale outline round each module at night, with no Sun left to make it.
        nr = spec["night_rims"]; l_ = on @ np.array([0.114, 0.587, 0.299], np.float32); dv_ = l_ - cv2.GaussianBlur(l_, (0, 0), float(nr.get("size", 4.0))); lp_ = float(nr.get("limit", 18.0))      # In the night's version of the picture, what stands out brighter than its surroundings is held to "limit" levels;
        pos_ = np.maximum(dv_, 0) - lp_ * np.tanh(np.maximum(dv_, 0) / lp_); near_ = cv2.GaussianBlur(cv2.dilate((pos_ > 4.0).astype(np.float32), EL7), (0, 0), 1.5); neg_ = np.maximum(-dv_, 0) - lp_ * np.tanh(np.maximum(-dv_, 0) / lp_)
        on_n = on - pos_[..., None] + (neg_ * near_)[..., None]              # (the thin dark line that sharpening and the source's own shading leave beside such a rim goes with it: alone it outlined every module like a pencil). Lamp light still shows the rims: the lamps stand on the Sun's side
    lit = on_n * K[None, None]; ws = wb * ground; nlm = lit.mean(2)
    gl = blur_big(nlm * ws, 22.0) / np.maximum(blur_big(ws, 22.0), 1e-3); dk = blur_big(soft.mean(2) * small, 22.0) / np.maximum(blur_big(small, 22.0), 1e-3)
    lift = 1 + (np.clip(gl / np.maximum(dk, 1.0), 1.0, 2.4) - 1) * cv2.GaussianBlur(small, (0, 0), 1.0)
    if spec.get("hollows"):                                                 # two kinds of old shadow. The ground's own small hollows ("max_px" and under): with the Sun gone they are ground like the ground round them, so they are raised further ("lift") and take
        hw = spec["hollows"]; ar_ = dst[:, cv2.CC_STAT_AREA]; tiny = np.clip((2.0 * hw["max_px"] - ar_) / hw["max_px"], 0, 1).astype(np.float32)[dl] * (dl > 0) * small; tb = cv2.GaussianBlur(tiny, (0, 0), 1.0); ob = cv2.GaussianBlur(small - tiny, (0, 0), 1.0)      # the night ground's own colour (left as they were, they stood out as olive blotches with black cores on the blue ground). A patch between "max_px" and twice that is treated as part one, part the other, so a patch whose size wavers from frame to frame does not jump.
        rt_ = gl / np.maximum(dk, 1.0); lift = 1 + (np.clip(rt_, 1.0, hw.get("lift", 3.5)) - 1) * tb + (np.clip(rt_, 1.0, hw.get("object_lift", 2.4)) - 1) * (cv2.GaussianBlur(ob, (0, 0), hw["object_soft"]) if hw.get("object_soft") else ob)      # The shadows of things that stand on the ground ("object_lift"): lamps on masts now light the yard from the Sun's side, so those shadows are still cast, and are raised less.
        hv_ = np.clip(blur_big(ws, 22.0) / 0.1, 0, 1); cg_ = blur_big(lit * ws[..., None], 22.0) / np.maximum(blur_big(nlm * ws, 22.0), 1e-3)[..., None]; soft = soft + (soft.mean(2, keepdims=True) * cg_ - soft) * (np.clip(tb + ob, 0, 1) * hv_)[..., None]      # both kinds take the night ground's colour: the source's small shadows are greyer than its large ones, and showed as grey patches on blue ground
    night = (lit * wb[..., None] + soft * (lift * (1 - wb))[..., None]) * deep
    FILL = None
    if spec.get("shadow_fill"):                                             # the Sun's old shadows on the ground. NASA's are already about as dark as the night's ground (0.24 of lit ground), so at night they did not stand out by their level: they stood out
        sf = spec["shadow_fill"]; ok_ = [c for c in range(1, nc) if dst[c, cv2.CC_STAT_AREA] < SMALL and dst[c, cv2.CC_STAT_WIDTH] >= sf.get("flat", 1.6) * dst[c, cv2.CC_STAT_HEIGHT] and dst[c, cv2.CC_STAT_TOP] + dst[c, cv2.CC_STAT_HEIGHT] < Hh - 2]      # as smooth patches with no texture and a dark rim, in the shape of the Sun's shadows. A shadow on the ground is a dark patch wider than tall (a post is taller than wide) that does not reach the bottom (the dark rock does)
        shm_ = np.isin(dl, ok_).astype(np.uint8)
        for zn_ in sf.get("zones", []):                                     # "zones": places traced on the reference frame where the Sun's shadows are lighter than the "dark" test catches ({"poly": [[x, y], ...], "rel": 0.6}): there a pixel darker than "rel" of the sunlit ground close by is shadow. (Judged that way everywhere, it also took the modules' grey hulls for shadows.)
            pr_ = np.array(zn_["poly"], np.float32); gr_ = T[r, 1::2]; ka_ = int(np.argmin(np.hypot(gr_[:, 0] - pr_[:, 0].mean(), gr_[:, 1] - pr_[:, 1].mean())))      # it moves with the tracked lamp nearest to it (the vanishing point's motion is not the motion of things at this depth)
            pz_ = pr_ + (T[i, 2 * ka_ + 1] - T[r, 2 * ka_ + 1]).astype(np.float32) - np.float32([c0, y0r]); bx0_, by0_ = int(max(pz_[:, 0].min() - 40, 0)), int(max(pz_[:, 1].min() - 40, 0)); bx1_, by1_ = int(min(pz_[:, 0].max() + 40, cw)), int(min(pz_[:, 1].max() + 40, Hh))
            if bx1_ - bx0_ < 8 or by1_ - by0_ < 8: continue
            zm_ = np.zeros((by1_ - by0_, bx1_ - bx0_), np.uint8); cv2.fillPoly(zm_, [np.round(pz_ - np.float32([bx0_, by0_])).astype(np.int32)], 1)
            lz_ = lum[by0_:by1_, bx0_:bx1_]; bgz_ = cv2.GaussianBlur(cv2.dilate(cv2.GaussianBlur(lz_, (0, 0), 3.0), np.ones((31, 31), np.uint8)), (0, 0), 15.0)
            shm_[by0_:by1_, bx0_:bx1_] = np.maximum(shm_[by0_:by1_, bx0_:bx1_], ((cv2.GaussianBlur(lz_, (0, 0), 1.0) < zn_.get("rel", 0.6) * bgz_) & (zm_ > 0)).astype(np.uint8))
        sh_ = cv2.GaussianBlur(cv2.dilate(shm_, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * int(sf.get("reach_px", 3)) + 1,) * 2)).astype(np.float32), (0, 0), 1.5 + 0.3 * sf.get("reach_px", 3)) * ground      # "reach_px": how far past the dark the fill goes (a shadow's soft edge is wider than its dark core)
        if sh_.max() > 0:
            gm_ = np.hypot(cv2.Sobel(lb, cv2.CV_32F, 1, 0, ksize=3), cv2.Sobel(lb, cv2.CV_32F, 0, 1, ksize=3)); sh_ = sh_ * np.clip(1.0 - (cv2.GaussianBlur(gm_ * (1 - np.maximum(small, cv2.dilate(shm_, np.ones((9, 9), np.uint8)).astype(np.float32))), (0, 0), 2.0) - 60.0) / 80.0, 0, 1)      # (the shadow's own soft edge is not such an edge)      # (the hard edge of a thing standing in its own shadow is kept)
            hp_ = lum - cv2.GaussianBlur(lum, (0, 0), float(sf.get("texture_px", 3.0))); okl_ = wb * (1 - np.clip(cv2.dilate(small, EL7), 0, 1)) * ground; fh_ = np.zeros_like(lum); got_ = np.zeros_like(lum)
            for off_ in sf.get("offsets", [260, -260, 130, -130, 390, -390, 520, -520, 650, -650, 780, -780]):      # the ground's own fine texture, taken from sunlit ground on the same rows (so it has the same perspective), a little way to the side
                tk_ = (1 - got_) * shift_x(okl_, off_); fh_ += shift_x(hp_, off_) * tk_; got_ += tk_      # (shifted, not wrapped round: a wrap brought texture from the other end of the picture and left a seam)
            fh_ = fh_ * np.clip(got_, 0, 1); kk_ = float(K.mean()); FILL = (sh_, fh_, gl, kk_)
            if os.environ.get("DUMP_FILL"): np.savez_compressed(os.environ["DUMP_FILL"], sh=sh_, shm=shm_, c0=c0, y0r=y0r, dx=dx, dy=dy, lum=lum, small=small, got=got_, fh=fh_, okl=okl_)
            nl_ = night.mean(2); out_ = (1.0 - np.clip(sh_ * 3.0, 0, 1)) * ground; lev_ = blur_big(nl_ * out_, 18.0) / np.maximum(blur_big(out_, 18.0), 1e-3)      # at the level of the night's ground round it, as it actually is there
            night = night + ((lev_ + fh_ * kk_ * (1.0 + spec.get("night_detail", 0.0)) * deep - nl_) * sh_)[..., None]; FILL = (sh_, fh_, lev_ / np.maximum(deep, 1e-3), kk_)
    if os.environ.get("DUMP_NIGHT"): np.savez_compressed(os.environ["DUMP_NIGHT"], small=small, lift=lift, wb=wb, night=night, lit=lit, soft=soft, m=m, c0=c0, y0r=y0r, ground=ground, ridge=(ridge_s if ridge_s is not None else 0), dx=dx, dy=dy)
    if FLANK[0] is not None and spec["sky_clean"]["flank"].get("night", 1.0) < 1.0: night = night * (1 - (1 - spec["sky_clean"]["flank"]["night"]) * FLANK[0])[..., None]      # the far slope at night: its sunlit crest and patches go down to the level of the slope itself, not of the plain (they were left as pale dashes)
    if spec.get("night_detail", 0) > 0:                                     # the ground's fine relief (tracks, small craters, stones) is the source's own; in the dark it is shown a little more strongly than the dimming alone leaves it.
        nl_ = on @ np.array([0.114, 0.587, 0.299], np.float32); nh_ = nl_ - cv2.GaussianBlur(nl_, (0, 0), 2.2); nlim = float(spec.get("night_detail_limit", 12.0)); nh_ = nlim * np.tanh(nh_ / nlim)
        sm8_ = np.maximum(small > 0.5, (FILL[0] > 0.3) if FILL is not None else False).astype(np.uint8); nh_ = nh_ * (1.0 - cv2.GaussianBlur((cv2.dilate(sm8_, EL7) - cv2.erode(sm8_, EL5)).astype(np.float32), (0, 0), 1.5))      # (not along the edge of an old Sun shadow: drawn out at night it outlined the shadow it was meant to hide)      # Brightness only, and held under a limit: without it every hard edge (a module against the ground) got a pale outline at night
        night = night + nh_[..., None] * K[None, None] * ((deep * spec["night_detail"] * farw)[..., None] if isinstance(farw, np.ndarray) else deep * spec["night_detail"])
    band = (cv2.dilate(dm, EL7) > 0) & (cv2.erode(dm, EL5) == 0); w = (~band).astype(np.float32)
    fill = cv2.GaussianBlur(night * w[..., None], (0, 0), 2.5) / np.maximum(cv2.GaussianBlur(w, (0, 0), 2.5), 1e-3)[..., None]
    bs = cv2.GaussianBlur(band.astype(np.float32), (0, 0), 0.7)[..., None]; night = night + (fill - night) * bs
    if spec.get("long_shadows") and SUNG:                                   # the source's shadows are 2 to 4 times as long as what casts them, which a Sun 15 to 25 degrees up gives; its Sun is 4.6 degrees up, where a shadow is 12 times as long, and longer as it sinks.
        ls_ = spec["long_shadows"]; fct = min((1.0 / ls_.get("source_ratio", 3.0)) / math.tan(math.radians(sun_elev(t))), ls_.get("max_factor", 14.0))      # So each is drawn out along the Sun's ray to the length the Sun shown gives
        if fct > 1.05:
            fd_ = min(max((0.53 / sun_elev(t)) * fct / max(fct - 1.0, 1e-3), 0.05), 0.6) if ls_.get("fade") == "sun" else ls_.get("fade", 0.3)      # penumbra = length x (Sun's width / its height); as a share of the added part
            ext_ = ls_window(i, fct, fd_, xx, yy); ext_ = cv2.GaussianBlur(ext_, (0, 0), 0.8) * ground * ls_.get("strength", 1.0)
            ext_ = np.clip(ext_, 0, 1) * (1.0 - m); mls_ = np.maximum(m, ext_).astype(np.float32)      # (where the ridge's shadow already lies, nothing to add)
            o = o * (1.0 - ext_ * (1.0 - float(ls_.get("level", 0.2))))[..., None]      # the added length is the same shadow as the part the source drew: the same neutral dark (about 0.2 of the lit ground), not the night's colour
            if os.environ.get("DEBUG_LS"): print("long shadows t %.2f: factor %.2f, added px %d" % (t, fct, int((ext_ > 0.5).sum())), flush=True)
    if "mls_" not in locals(): mls_ = m
    res = o + (night - o) * m[..., None]
    # ---------- the sky: stars and the Milky Way come up as the exposure opens for dark ground, and never through glare or through a planet; then the lights that travel across it
    if STARS is not None or MOVERS:
        skyw = np.maximum(cv2.GaussianBlur(sky.astype(np.float32), (0, 0), 1.2), sky.astype(np.float32))
        if STARS is not None:
            sdx, sdy = off(0.0, 0.0, i); sw0 = key("star_level", t) * skyw * np.clip(1.0 - lb / spec["stars"].get("glare_lum", 46.0), 0, 1) ** 1.5; sw_ = sw0
            for (px, py, pr) in spec.get("discs", []): sw_ = sw_ * np.clip((np.hypot(xx - px - sdx, yy - py - sdy) - pr) / 2.0, 0, 1)      # the whole disc of the Earth hides the stars behind it, the unlit part too
            res = res + sky_piece(STARS, sdx, sdy, y0r, Hh, c0, c1) * sw_[..., None]
            ex_ = key("sky_exposure", t) if spec.get("sky_exposure") else 1.0     # the faint sky comes up as the camera leaves the lamps and its exposure opens, and goes down again when it returns to them
            if MILKY is not None: res = res + sky_piece(MILKY, sdx, sdy, y0r, Hh, c0, c1) * ((sw0 if spec["stars"]["sky_map"].get("earth_night") else sw_) * ex_)[..., None]
            if spec.get("earth") and spec["earth"].get("bloom") and key("star_level", t) > 0.02:      # in an exposure deep enough for the Milky Way the Earth's sunlit crescent is far over white, and spills light round itself
                ecx_, ecy_ = float(ETS[i, 0] + EOFF[0]) - c0, float(ETS[i, 1] + EOFF[1]) - y0r; ea_, eb_, ec_, ed_ = int(max(ecx_ - 260, 0)), int(min(ecx_ + 260, cw)), int(max(ecy_ - 260, 0)), int(min(ecy_ + 260, Hh))
                if eb_ > ea_ + 8 and ed_ > ec_ + 8:
                    hot_ = np.clip((lum[ec_:ed_, ea_:eb_] - 150.0) / 60.0, 0, 1) * (np.hypot(xx[ec_:ed_, ea_:eb_] - c0 - ecx_, yy[ec_:ed_, ea_:eb_] - y0r - ecy_) < spec["earth"]["r"] + 6)
                    res[ec_:ed_, ea_:eb_] += ((cv2.GaussianBlur(hot_.astype(np.float32), (0, 0), 5.0) * 2.2 + cv2.GaussianBlur(hot_.astype(np.float32), (0, 0), 22.0) * 3.0) * 255.0 * spec["earth"]["bloom"] * key("star_level", t) * ex_)[..., None] * np.array([1.0, 0.97, 0.94], np.float32)
            if ZOD is not None: res = res + (sky_piece(ZOD, sdx, sdy, y0r, Hh, c0, c1) * sw_ * ex_)[..., None] * np.array([0.84, 0.93, 1.0], np.float32)
        for mv in MOVERS:
            pth = np.array(mv["path"], float)
            if mv["type"] == "person" and mv.get("trail") and t > pth[0, 0]:      # trodden ground: where someone has walked the surface is left a little darker (the paths of the Apollo crews still show from orbit as dark lines). It stays after they have gone
                tb0, tb1 = T[i, 2 * mv["anchor"] + 1]; tt_ = np.r_[pth[pth[:, 0] < min(t, pth[-1, 0]), 0], min(t, pth[-1, 0])]; pts_ = np.c_[tb0 + np.interp(tt_, pth[:, 0], pth[:, 1]) - c0, tb1 + np.interp(tt_, pth[:, 0], pth[:, 2]) - y0r]
                if len(pts_) > 1 and pts_[:, 0].max() > -50 and pts_[:, 0].min() < cw + 50:
                    xa_, ya_ = int(max(pts_[:, 0].min() - 6, 0)), int(max(pts_[:, 1].min() - 6, 0)); xb_, yb_ = int(min(pts_[:, 0].max() + 6, cw)), int(min(pts_[:, 1].max() + 6, Hh))
                    if xb_ > xa_ + 2 and yb_ > ya_ + 2:
                        tm_ = np.zeros((yb_ - ya_, xb_ - xa_), np.float32); cv2.polylines(tm_, [np.round((pts_ - [xa_, ya_]) * 8).astype(np.int32)], False, 1.0, max(1, int(round(0.09 * mv.get("height", 16.0) * float(scale[i])))), cv2.LINE_AA, 3)
                        res[ya_:yb_, xa_:xb_] *= (1 - float(mv["trail"]) * cv2.GaussianBlur(tm_, (0, 0), 0.7) * ground[ya_:yb_, xa_:xb_])[..., None]
            if not (pth[0, 0] <= t <= pth[-1, 0]): continue
            if mv["type"] == "person":                                      # someone on foot. In sunlight: a figure in a white suit with the long shadow the low Sun gives. In the dark: the suit at the night's level and a helmet lamp
                bx0, by0 = T[i, 2 * mv["anchor"] + 1]; fx = bx0 + float(np.interp(t, pth[:, 0], pth[:, 1])) - c0; fy = by0 + float(np.interp(t, pth[:, 0], pth[:, 2])) - y0r; hh = mv.get("height", 16.0) * float(scale[i]); zs = hh / 20.3
                vx_ = float(np.interp(t + 0.15, pth[:, 0], pth[:, 1]) - np.interp(t - 0.15, pth[:, 0], pth[:, 1])); vy_ = float(np.interp(t + 0.15, pth[:, 0], pth[:, 2]) - np.interp(t - 0.15, pth[:, 0], pth[:, 2])); moving = math.hypot(vx_, vy_) > 0.25
                step = math.sin(t * mv.get("pace", 5.2) + mv["anchor"]) if moving else 0.15; face = (1.0 if vx_ >= 0 else -1.0) if moving else mv.get("face", 1.0)
                xa, xb, ya, yb = int(max(fx - 5.5 * hh, 0)), int(min(fx + 5.5 * hh, cw)), int(max(fy - 2.2 * hh, 0)), int(min(fy + 2.6 * hh, Hh))
                if xb <= xa or yb <= ya or not (0 <= fx < cw and 0 <= fy < Hh): continue
                if os.environ.get("DUMP_MOVERS"): print("person", MOVERS.index(mv), "anchor", mv["anchor"], "frame x %.0f y %.0f" % (fx + c0 - xw, fy + y0r - yw), "height %.1f" % hh)
                X, Y = xx[ya:yb, xa:xb] - c0 - fx, yy[ya:yb, xa:xb] - y0r - fy; sun = (1.0 - float(mls_[int(fy), int(fx)])) * float(wb[max(int(fy) - 2, 0):int(fy) + 3, max(int(fx) - 3, 0):int(fx) + 4].mean()); gfa = min(1.0, (t - pth[0, 0]) / 0.4, (pth[-1, 0] - t) / 0.4) if mv.get("fade", True) else 1.0
                lean_ = 0.0; kneel_ = 0.0
                if mv.get("work") and not moving:                           # "work": [seconds per round, offset, degrees]: they bend to something on the ground, stay down a while, and straighten, each over about a second
                    wp_ = ((t + mv["work"][1]) % mv["work"][0]) / mv["work"][0]; sm_w = lambda a_, b_, x_: float(np.clip((x_ - a_) / (b_ - a_), 0, 1)) ** 2 * (3 - 2 * float(np.clip((x_ - a_) / (b_ - a_), 0, 1))); dn_ = sm_w(0.18, 0.34, wp_) * (1 - sm_w(0.66, 0.82, wp_)); lean_ = (mv["work"][2] if len(mv["work"]) > 2 else 40.0) * dn_; kneel_ = (mv["work"][3] if len(mv["work"]) > 3 else 0.0) * dn_      # a fourth number: how far they go down on their knees (0 to 1)
                pf_ = (8.1 * (1 - 0.57 * kneel_) + 12.7 * math.cos(math.radians(lean_))) / 20.8      # how tall the figure stands in this pose, against upright: its shadow is that much shorter
                if SUNG and sun > 0.02:                                     # the shadow: a body's width at the feet, drawn out along the Sun's ray and softer toward its far end. Its length is the body's height over the tangent of the Sun's height,
                    ux, uy = fx + c0 - (SUNG[0] + dx), fy + y0r - (SUNG[1] + dy); nu = math.hypot(ux, uy); ux, uy = ux / nu, uy / nu; pd_ = spec["stars"]["px_per_deg"] if spec.get("stars") else 105.0      # seen as foreshortened as the ground is there: least when the Sun is off to the side, most when the shadow points at the camera
                    daz, dep = math.radians(abs(ux * nu) / pd_), math.radians(max(uy * nu, 0.0) / pd_); Ls = spec.get("drawn_shadow_scale", 1.0) * hh * pf_ / math.tan(math.radians(sun_elev(t))) * math.hypot(math.sin(daz), math.cos(daz) * math.sin(dep)); Pp = X * ux + Y * uy; Qq = -X * uy + Y * ux
                    a_sh = np.clip(Pp / 1.5 + 0.6, 0, 1) * np.clip((Ls - Pp) / (0.4 * Ls), 0, 1) * np.exp(-(Qq / (0.13 * hh + 0.012 * np.maximum(Pp, 0))) ** 2) * 0.9 * sun * gfa * (1 - mls_[ya:yb, xa:xb]) * ground[ya:yb, xa:xb] * wb[ya:yb, xa:xb]
                    res[ya:yb, xa:xb] += (night[ya:yb, xa:xb] - res[ya:yb, xa:xb]) * a_sh[..., None]
                spr, sal = person_sprite(step, face, 1.0 if not SUNG or SUNG[0] + dx > fx + c0 else -1.0, lean_, kneel_); Mp = np.float32([[zs, 0, fx - xa - 8.0 * zs], [0, zs, fy - ya - 21.9 * zs]])
                pc = cv2.warpAffine(spr, Mp, (xb - xa, yb - ya), flags=cv2.INTER_AREA); pa = (cv2.warpAffine(sal, Mp, (xb - xa, yb - ya), flags=cv2.INTER_AREA) * gfa)[..., None]
                res[ya:yb, xa:xb] = res[ya:yb, xa:xb] * (1 - pa) + pc * (sun + (1 - sun) * K[None, None] * deep * 1.15) * pa
                if sun < 0.6:                                               # the helmet lamp, and the ground it lights a few steps ahead
                    gl_ = (1 - sun / 0.6) * gfa; ln_ = math.radians(lean_); hx, hy = face * (2.2 * math.cos(ln_) + 8.1 * math.sin(ln_)) * zs, (-8.1 + 4.6 * kneel_ + 2.2 * math.sin(ln_) - 8.1 * math.cos(ln_)) * zs; dot_ = 235.0 * np.exp(-((X - hx) ** 2 + (Y - hy) ** 2) / (2 * (0.5 + 0.045 * hh) ** 2)); pl_ = (0.36 + 0.3 * math.sin(ln_)) * np.exp(-(((X - face * (0.9 - 0.45 * math.sin(ln_)) * hh) / ((0.9 - 0.4 * math.sin(ln_)) * hh)) ** 2 + (Y / (0.26 * hh)) ** 2))      # bent over, the lamp points down: a smaller, brighter pool just ahead of the feet
                    res[ya:yb, xa:xb] += (gl_ * dot_)[..., None] * np.array([0.92, 0.97, 1.0], np.float32) + np.maximum(o[ya:yb, xa:xb] * 0.8 - res[ya:yb, xa:xb], 0) * (gl_ * pl_ * ground[ya:yb, xa:xb])[..., None]
                continue
            if mv["type"] in ("walker", "rover"):                           # a light carried over the ground: it keeps its place by a lamp that is followed through the shot ("anchor"), bobs with each step, and throws a small pool ahead of itself
                bx0, by0 = T[i, 2 * mv["anchor"] + 1]; wx = bx0 + float(np.interp(t, pth[:, 0], pth[:, 1])) - c0; wy = by0 + float(np.interp(t, pth[:, 0], pth[:, 2])) + (0.7 * math.sin(t * 11.0 + mv["anchor"]) if mv["type"] == "walker" else 0.0) - y0r
                ahead = 1.0 if pth[-1, 1] >= pth[0, 1] else -1.0; big_ = mv["type"] == "rover"; xa, xb, ya, yb = int(max(wx - 60, 0)), int(min(wx + 60, cw)), int(max(wy - 30, 0)), int(min(wy + 30, Hh))
                if xb <= xa or yb <= ya: continue
                X, Y = xx[ya:yb, xa:xb] - c0 - wx, yy[ya:yb, xa:xb] - y0r - wy; g_ = mv.get("gain", 1.0) * min(1.0, (t - pth[0, 0]) / 0.5, (pth[-1, 0] - t) / 0.5) * float(m[int(np.clip(wy, 0, Hh - 1)), int(np.clip(wx, 0, cw - 1))])
                dot_ = 230.0 * np.exp(-(X * X + (Y + (3 if big_ else 5)) ** 2) / (2 * (1.5 if big_ else 1.1) ** 2)); pl_ = (0.5 if big_ else 0.34) * np.exp(-(((X - ahead * (16 if big_ else 9)) / (20 if big_ else 11)) ** 2 + (Y / (5 if big_ else 3.5)) ** 2))
                res[ya:yb, xa:xb] += (g_ * dot_)[..., None] * np.array([0.92, 0.97, 1.0], np.float32) + np.maximum(o[ya:yb, xa:xb] * 0.8 - res[ya:yb, xa:xb], 0) * (g_ * pl_)[..., None]
                continue
            if mv["type"] == "lander":                                      # a craft does not change speed in an instant: its path between the keys is rounded over about a second
                glide_ = lambda tt, c_: float(np.interp(tt + np.linspace(-0.5, 0.5, 11), pth[:, 0], pth[:, c_]).mean()); px = glide_(t, 1) + dx; py = glide_(t, 2) + dy
            else: px = float(np.interp(t, pth[:, 0], pth[:, 1])) + dx; py = float(np.interp(t, pth[:, 0], pth[:, 2])) + dy
            R_ = {"dust": 300, "lander": 420, "station": 60}.get(mv["type"], 40)
            xa, xb, ya, yb = int(max(px - R_ - c0, 0)), int(min(px + R_ - c0, cw)), int(max(py - R_ - y0r, 0)), int(min(py + R_ - y0r, Hh))
            if xb <= xa or yb <= ya: continue
            X, Y = xx[ya:yb, xa:xb] - px, yy[ya:yb, xa:xb] - py; g_ = mv.get("gain", 1.0) * min(1.0, (t - pth[0, 0]) / 0.3, (pth[-1, 0] - t) / 0.3); on_sky = skyw[ya:yb, xa:xb]
            if mv["type"] in ("orbiter", "station") and spec.get("star_level"): g_ *= float(np.clip(key("star_level", t) / 0.5, 0, 1))      # a spacecraft in orbit is a point like a star: an exposure for sunlit ground does not show it
            if mv["type"] == "lander":
                # the exhaust leaves down and ahead (the engine is braking and holding the lander up at once); in vacuum it spreads into a wide, thin fan that the Sun lights
                vx_ = glide_(t + 0.1, 1) - glide_(t - 0.1, 1); vy_ = glide_(t + 0.1, 2) - glide_(t - 0.1, 2); nv = math.hypot(vx_, vy_) + 1e-6
                ax_, ay_ = 0.5 * vx_ / nv, 0.5 * vy_ / nv + 0.5; na = math.hypot(ax_, ay_); ax_, ay_ = ax_ / na, ay_ / na; s_ = X * ax_ + Y * ay_; d_ = -X * ay_ + Y * ax_; sp_ = np.maximum(s_, 0)
                flick = 1.0 + 0.05 * math.sin(t * 7.3) + 0.03 * math.sin(t * 12.1)          # the flame breathes slowly; nothing here changes faster than 24 frames a second can show
                streak_ = 1.0 + 0.22 * np.sin(d_ / (1.6 + 0.05 * sp_) + t * 2.0) * np.clip(sp_ / 40.0, 0, 1)      # the fan is not smooth: it is drawn out in fine streaks that drift
                th_p = np.arctan2(np.abs(d_), s_); rho_p = np.hypot(s_, d_)      # with nothing round it to hold it in, exhaust opens into a wide soft fan (here to about 60 degrees either side of its axis) and thins with the square of the distance: no beams, no edges
                v_ = mv.get("core", 1.0) * (255.0 * np.exp(-(X * X + Y * Y) / (2 * 2.2 ** 2)) + 60.0 * flick * np.exp(-(X * X + Y * Y) / (2 * 7.0 ** 2))) + mv.get("plume", 1.0) * flick * (1.0 + 0.06 * (streak_ - 1.0)) * 120.0 * np.exp(-(th_p / mv.get("fan", 0.55)) ** 2) / (1.0 + (rho_p / 20.0) ** 2) * np.exp(-rho_p / 260.0)
                colr = np.array([1.0, 0.93, 0.86], np.float32)
                # the craft itself, as small as it would be from here, leaning the way its engine pushes; and a strobe that flashes
                bx, by = X + ax_ * 16.0, Y + ay_ * 16.0; strobe = 255.0 * np.exp(-(bx ** 2 + by ** 2) / (2 * 1.3 ** 2)) * (1.0 if ((t + 0.55) % 1.1) < 0.13 else 0.0); v_ = v_ + strobe
                jp_ = (t * 0.55 + mv["path"][0][0] * 0.37) % 1.0                    # now and then a small jet to one side keeps it upright: a short sunlit puff (a quarter of a second, rising and falling smoothly)
                if jp_ < 0.14 and mv.get("jets", True):
                    je_ = math.sin(math.pi * jp_ / 0.14) ** 2; js_ = 1.0 if int(t * 0.55 + mv["path"][0][0] * 0.37) % 2 else -1.0; jx_, jy_ = X + ax_ * 21.0, Y + ay_ * 21.0; ja_ = (-jx_ * ay_ + jy_ * ax_) * js_; jc_ = jx_ * ax_ + jy_ * ay_
                    v_ = v_ + 85.0 * je_ * np.exp(-(jc_ / (1.2 + 0.32 * np.maximum(ja_, 0))) ** 2) * np.exp(-np.maximum(ja_, 0) / 13.0) * (ja_ > 2.5)
                sz_ = mv.get("size", 1.0); spr, sal = lander_sprite(-math.degrees(math.atan2(ax_, ay_)), mv.get("sun_side", 1.0), int(round(26 * sz_)), mv.get("lit_part", 0.5), mv.get("flame_light", 0.0) * flick); ox_, oy_ = px - ax_ * 1.0 - 13.0 * sz_, py - ay_ * 1.0 - 17.5 * sz_      # the engine bell sits on the light
                Ms = np.float32([[1, 0, ox_ - c0 - xa], [0, 1, oy_ - y0r - ya]]); big_s = cv2.warpAffine(spr, Ms, (xb - xa, yb - ya), flags=cv2.INTER_LINEAR); big_a = cv2.warpAffine(sal, Ms, (xb - xa, yb - ya), flags=cv2.INTER_LINEAR) * on_sky * g_
                if mv.get("clip_y") is not None: big_a = big_a * np.clip((mv["clip_y"] + dy - yy[ya:yb, xa:xb]) / 3.0, 0, 1)
                res[ya:yb, xa:xb] = res[ya:yb, xa:xb] * (1 - big_a[..., None]) + big_s * big_a[..., None]
                if mv.get("clip_y") is not None and mv.get("pool", True):   # near the ground its flame lights the ground under it: a pool that grows and tightens as it comes down
                    near = float(np.clip(1 - (mv["clip_y"] + dy - py) / 150.0, 0, 1))
                    if near > 0:
                        gy0 = mv["clip_y"] + dy + 16; gxa, gxb, gya, gyb = int(max(px - 260 - c0, 0)), int(min(px + 260 - c0, cw)), int(max(gy0 - 60 - y0r, 0)), int(min(gy0 + 90 - y0r, Hh))
                        if gxb > gxa and gyb > gya:
                            GX, GY = xx[gya:gyb, gxa:gxb] - px, yy[gya:gyb, gxa:gxb] - gy0; pool_ = 120.0 * near ** 1.5 * g_ * flick * np.exp(-((GX / (190 - 110 * near)) ** 2 + (GY / (34 - 14 * near)) ** 2))
                            res[gya:gyb, gxa:gxb] += (pool_ * (1 - skyw[gya:gyb, gxa:gxb]))[..., None] * np.array([1.0, 0.95, 0.9], np.float32)
            elif mv["type"] == "dust":                                      # touchdown beyond a ridge: sunlit dust thrown up in a low, wide fan, seen only where it rises above the ridge line; it spreads and thins in seconds
                a_ = (t - pth[0, 0]) / (pth[-1, 0] - pth[0, 0]); rx, ry = 30 + 190 * a_ ** 0.6, 10 + 55 * a_ ** 0.6
                v_ = 115.0 * (1 - a_) ** 1.6 * min(1.0, a_ / 0.08) * np.exp(-((X / rx) ** 2 + (Y / ry) ** 2)); colr = np.array([0.95, 0.97, 1.0], np.float32); g_ = mv.get("gain", 1.0)      # centred just below the ridge line: the ridge itself cuts it off
            elif mv["type"] == "station":                                   # a station in orbit, large enough to show a shape: a lit body with solar wings either side, turning slowly end over end as it crosses
                ca, sa = math.cos(0.5 + 0.12 * t), math.sin(0.5 + 0.12 * t); z_ = mv.get("size", 0.45); U, V = (X * ca + Y * sa) / z_, (-X * sa + Y * ca) / z_
                v_ = 250.0 * np.exp(-((U / 2.6) ** 4 + (V / 1.5) ** 4)) + 170.0 * np.exp(-(((np.abs(U) - 4.6) / 2.6) ** 4 + (V / 2.4) ** 4)) + 26.0 * np.exp(-(X * X + Y * Y) / (2 * 6.0 ** 2)); colr = np.array([0.93, 0.97, 1.0], np.float32)
            else:                                                           # a spacecraft in orbit in sunlight: a steady point
                v_ = 235.0 * np.exp(-(X * X + Y * Y) / (2 * 1.15 ** 2)) + 18.0 * np.exp(-(X * X + Y * Y) / (2 * 4.0 ** 2)); colr = np.array([0.96, 0.98, 1.0], np.float32)
            if mv.get("clip_y") is not None: v_ = v_ * np.clip((mv["clip_y"] + dy - yy[ya:yb, xa:xb]) / 3.0, 0, 1)      # a ridge line it goes behind
            res[ya:yb, xa:xb] += (g_ * v_ * on_sky)[..., None] * colr      # the light is only drawn on sky
    pool = np.zeros((Hh, cw, 3), np.float32); pooly = np.zeros((Hh, cw, 3), np.float32); core = np.zeros((Hh, cw, 3), np.float32); s = float(scale[i]); lx = xx - c0; ly_ = yy - y0r
    for k_, l in enumerate(L):
        if l.get("glint"):                                                  # foil or glass that flashes for a moment as the edge of the sunlight crosses it
            ggx, ggy = T[i, 2 * k_ + 1]; ga_, gr_, gl_, _ = shadow_coord(np.float32(ggx), np.float32(ggy), i); mm_ = float(shade(np.float32(ga_), np.float32(gr_), t, 0.0, gl_)); v = l["glint"] * math.exp(-((mm_ - 0.35) / 0.2) ** 2) * (mm_ < 0.97) * (mm_ > 0.01); ON[k_].append(0.0)
        else: v = lamp_on(k_, i, t); ON[k_].append(v)
        if v <= 0: continue
        if not l.get("blink") and not l.get("glint"):
            v *= 1.0 + 0.02 * math.sin(t * (1.3 + 0.21 * (k_ % 9)) + k_)   # a lamp comes up as the dark reaches it and then drifts a little, slowly. (It used to stutter as it struck and shimmer; on a phone that read as a fault in the picture.)
        (ax, ay), (gx, gy) = T[i, 2 * k_], T[i, 2 * k_ + 1]
        if not (c0 - 400 < ax < c1 + 400): continue
        ax, gx, ay, gy = ax - c0, gx - c0, ay - y0r, gy - y0r; R = l.get("reach", 90.0) * s; col = np.array(l.get("color", [1.0, 0.86, 0.66]), np.float32)[::-1]
        x_a, x_b, y_a, y_b = int(max(gx - 3.2 * R, 0)), int(min(gx + 3.2 * R, cw)), int(max(gy - 1.6 * R, 0)), int(min(gy + 1.6 * R, Hh))
        if x_b > x_a and y_b > y_a and R > 0:
            g = np.exp(-(((lx[y_a:y_b, x_a:x_b] - gx) / R) ** 2 + ((ly_[y_a:y_b, x_a:x_b] - gy) / (l.get("tall", 0.34) * R)) ** 2) * 1.6); (pooly if l.get("keep_shadows") else pool)[y_a:y_b, x_a:x_b] += (0.55 * v * l.get("gain", 1.0) * g)[..., None] * col
        rr = l.get("glow", 34.0) * s; x_a, x_b, y_a, y_b = int(max(ax - 3 * rr, 0)), int(min(ax + 3 * rr, cw)), int(max(ay - 3 * rr, 0)), int(min(ay + 3 * rr, Hh))
        if x_b > x_a and y_b > y_a:
            d2 = (lx[y_a:y_b, x_a:x_b] - ax) ** 2 + (ly_[y_a:y_b, x_a:x_b] - ay) ** 2; pool[y_a:y_b, x_a:x_b] += (0.38 * v * l.get("gain", 1.0) * np.exp(-d2 / (rr * rr)))[..., None] * col
            c = np.exp(-d2 / (2 * (l.get("size", 3.0) * s * 0.8) ** 2)) + 0.16 * np.exp(-d2 / (2 * (l.get("size", 3.0) * s * 4.0) ** 2))      # a hard small source and a little lens bloom round it, not a soft ball
            if l.get("spikes"): ex_, ey_ = np.abs(lx[y_a:y_b, x_a:x_b] - ax), np.abs(ly_[y_a:y_b, x_a:x_b] - ay); c = c + 0.42 * (np.exp(-ex_ / l["spikes"]) * np.exp(-(ey_ / 0.8) ** 2) + np.exp(-ey_ / (0.6 * l["spikes"])) * np.exp(-(ex_ / 0.8) ** 2))
            core[y_a:y_b, x_a:x_b] += (255.0 * v * c)[..., None] * (0.55 + 0.45 * col)
    gfree = on_n * wb[..., None] + np.minimum(soft * lift[..., None] / K[None, None], 255.0) * (1 - wb[..., None])      # the ground as the source has it, with the Sun's shadows of objects lifted out: a lamp beside a module lights the ground where the Sun's shadow of that module lay
    if FILL is not None: gfree = gfree + ((FILL[2] / FILL[3] + FILL[1] * (1.0 + spec.get("night_detail", 0.0)) - gfree.mean(2)) * FILL[0])[..., None]      # under a lamp too, an old shadow is ground like the ground round it
    amount = 0.72 * (1 - np.exp(-1.5 * pool.max(2, keepdims=True))); tint = pool / np.maximum(pool.max(2, keepdims=True), 1e-6); res = res + np.maximum(gfree * tint * amount - res, 0) * (m * ground)[..., None]      # lamp light is added to the dim ground, and shows it as the source shot has it
    if pooly.max() > 0:                                                    # a lamp marked "keep_shadows" stands on the Sun's side of everything it lights, low and far off: the shadows it casts fall where the Sun's fell, so under it the source's picture is shown with them
        amount = 0.72 * (1 - np.exp(-1.5 * pooly.max(2, keepdims=True))); tint = pooly / np.maximum(pooly.max(2, keepdims=True), 1e-6); res = res + np.maximum(o * tint * amount - res, 0) * (m * ground)[..., None]
    res = res + core * (0.25 + 0.75 * m[..., None])                                                         # a lamp in full sunlight hardly shows
    if LENSB[0] is not None: res = res + LENSB[0][..., None] * np.array([0.97, 0.99, 1.0], np.float32)      # the Sun's bloom in the lens (see sky_clean), over everything
    if spec.get("foreground_soft") and y1r == H:                            # what is nearest the camera (the dark rock and slope that reach the bottom of the picture, with their sunlit rims) is a little out of focus, as it is for a lens focused on the base.
        fs = spec["foreground_soft"]; nk, kl, ks, _ = cv2.connectedComponentsWithStats((cv2.GaussianBlur(lum, (0, 0), 1.5) < fs.get("dark", 60.0)).astype(np.uint8), connectivity=4); ids_ = np.unique(kl[-1])      # (The source draws those rims as hard-edged blocks and ragged fringes.)
        fg_ = np.isin(kl, [c for c in ids_ if c != 0 and ks[c, cv2.CC_STAT_AREA] > 4000]).astype(np.uint8)
        if fg_.any():
            fg_ = cv2.GaussianBlur(cv2.dilate(fg_, np.ones((2 * int(fs.get("rim", 30)) + 1, 2 * int(fs.get("rim", 30)) + 1), np.uint8)).astype(np.float32), (0, 0), 8.0)
            if ROCK: fg_ = np.maximum(fg_, rock_mask(i, c0, y0r, 30.0, 8.0, fg_.shape))
            if fs.get("rows_from"): fg_ = np.maximum(fg_, np.clip((yy - fs["rows_from"]) / fs.get("rows_over", 110.0), 0, 1) * fs.get("rows_amount", 0.8))      # the last rows of the picture are the ground nearest the camera
            res = res + (cv2.GaussianBlur(res, (0, 0), float(fs.get("sigma", 2.4))) - res) * fg_[..., None]
    if not PATH: return np.clip(res, 0, 255).astype(np.uint8)
    fr = cv2.warpAffine(np.clip(res, 0, 255).astype(np.uint8), np.float32([[1, 0, -(xw - c0)], [0, 1, -(yw - y0r)]]), (OW, 1920), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)      # the frame the camera sees, placed to a fraction of a pixel
    bx_ = int(round(abs(cam(t + 1.0 / FPS) - cam(t - 1.0 / FPS)) / 2 * PATH.get("shutter", 0.5))); by_ = int(round(abs(camy(t + 1.0 / FPS) - camy(t - 1.0 / FPS)) / 2 * PATH.get("shutter", 0.5)))
    if bx_ >= 2 or by_ >= 2: fr = cv2.blur(fr, (max(bx_, 1), max(by_, 1)), borderType=cv2.BORDER_REPLICATE)
    fr = fr.astype(np.float32)
    if spec.get("overlay") and t >= spec["overlay"].get("show_from", spec["overlay"]["from_t"]) - 1e-6: fr = stand_behind(fr, t, xw, yw, i) if spec["overlay"].get("cut") else stand_in_front(fr, t, xw)
    return finish(fr, rng_)
OVC = None; ROCK = json.load(open(os.path.join(HERE, spec["overlay"]["rock"]["track"])))["move"] if spec.get("overlay") and spec["overlay"].get("rock") else None
def rock_mask(i, xw, yw, raise_px, soft, size):
    """the foreground rock in a picture whose top-left corner is (xw, yw) of the wide one: everything under its traced top line, lifted by raise_px"""
    c_ = np.array(spec["overlay"]["rock"]["crest"], float)
    if c_[0, 1] < H + 60 and c_[0, 1] > c_[1, 1]: c_ = np.vstack([c_[0] + (c_[0] - c_[1]) * (H + 60 - c_[0, 1]) / (c_[0, 1] - c_[1, 1]), c_])      # the traced line starts above the bottom of the picture: the rock's edge runs on down to it at the same slope (closing the outline straight down left a chip of plain inside it)
    if spec["overlay"]["rock"].get("crest_rough"):                         # the traced line, between its points, was straight; a rock's top is not. Fixed small bumps along it (the same in every frame)
        xs_ = np.arange(c_[0, 0], c_[-1, 0], 5.0); ys_ = np.interp(xs_, c_[:, 0], c_[:, 1]); a_ = float(spec["overlay"]["rock"]["crest_rough"])
        c_ = np.c_[xs_, ys_ + a_ * (0.6 * np.sin(xs_ / 23.0 + 1.3) + 0.35 * np.sin(xs_ / 9.7 + 0.4) + 0.2 * np.sin(xs_ / 4.3 + 2.2))]
    cr = np.c_[c_, np.ones(len(c_))] @ np.array(ROCK[str(i)], float).T - [xw, yw + raise_px]
    poly = np.vstack([cr, [[cr[-1, 0] + 4000, cr[-1, 1]], [cr[-1, 0] + 4000, 9000], [cr[0, 0], 9000]]]); mk = np.zeros(size, np.float32); cv2.fillPoly(mk, [np.round(poly * 8).astype(np.int32)], 1.0, lineType=cv2.LINE_AA, shift=3)
    return cv2.GaussianBlur(mk, (0, 0), soft) if soft > 0 else mk
LSRUNS = {}; LSH = {}
def ls_to_ref(i):
    """the ground-plane motion from source frame i to the reference frame: a homography fitted to the tracked points (lamps on the ground), so shadows found once on the reference frame move with the ground"""
    if i not in LSH:
        Hm_, _ = cv2.findHomography(T[i].astype(np.float32), T[r].astype(np.float32), cv2.RANSAC, 3.0) if i != r else (np.eye(3), None); LSH[i] = Hm_ if Hm_ is not None else np.eye(3)
    return LSH[i]
def ls_runs(i):
    """the source's shadows of things on the plain in source frame i, found once on the whole wide picture, as runs along the Sun's rays: a polar picture round the point on the horizon under the Sun
    (rows: direction, columns: distance from that point). A shadow is a patch darker than "rel" of the sunlit ground close by (NASA's are 0.25 to 0.45 of it), on the plain below the ridge's foot,
    not the dark foreground, and drawn out along the Sun's ray (a crater's dark inside lies across it; a module's shaded side lies along the module)."""
    i = r                                                                   # (found on the reference frame only, and carried to the others by ls_to_ref: found anew on each, borderline patches came and went, and whole long shadows with them)
    if i in LSRUNS: return LSRUNS[i]
    ls_ = spec["long_shadows"]; dx_, dy_ = float(vp[i, 0] - vp[r, 0]), float(vp[i, 1] - vp[r, 1]); cx, cy = float(SUNG[0] + dx_), float(vp[i, 1])
    lum_ = cv2.cvtColor(src(i, 0, H, 0, W), cv2.COLOR_BGR2GRAY).astype(np.float32); lb_ = cv2.GaussianBlur(lum_, (0, 0), 1.0)
    bgl_ = cv2.GaussianBlur(cv2.dilate(cv2.GaussianBlur(lum_, (0, 0), 3.0), np.ones((31, 31), np.uint8)), (0, 0), 15.0)
    foot_ = np.interp(np.arange(W) - dx_, GT_[:, 0], GT_[:, 1]) + dy_; Yc = np.arange(H, dtype=np.float32)[:, None]
    cand_ = ((lb_ < ls_.get("rel", 0.5) * bgl_) & (bgl_ > 90.0) & (Yc > foot_[None] + 6)).astype(np.uint8); cand_[H - int(ls_.get("skip_bottom", 260)):] = 0
    if ROCK: cand_[rock_mask(i, 0.0, 0.0, 40.0, 0.0, (H, W)) > 0.5] = 0
    nc_, dlc_, dstc_, _ = cv2.connectedComponentsWithStats(cand_, connectivity=8); keep_ = np.zeros(nc_, bool)
    for c_ in range(1, nc_):
        x_, y_, w_, h_, a_ = dstc_[c_]
        if a_ < ls_.get("min_px", 6) or a_ > ls_.get("max_px", 60000) or y_ + h_ >= H - int(ls_.get("skip_bottom", 260)) - 1: continue
        if a_ < 40: keep_[c_] = True; continue
        ys_, xs_ = np.nonzero(dlc_[y_:y_ + h_, x_:x_ + w_] == c_); pts_ = np.c_[xs_ + x_, ys_ + y_].astype(np.float64); mu_ = pts_.mean(0); _, sv_, vt_ = np.linalg.svd(pts_ - mu_, full_matrices=False)
        ray_ = np.array([mu_[0] - cx, mu_[1] - cy]); ray_ /= np.linalg.norm(ray_) + 1e-9
        keep_[c_] = abs(float(vt_[0] @ ray_)) > math.cos(math.radians(ls_.get("max_angle", 28.0))) or sv_[0] < 1.6 * sv_[1]
    shs_ = keep_[dlc_].astype(np.float32); R_ = int(np.ceil(max(np.hypot(cx - x_, cy - y_) for x_ in (0, W) for y_ in (0, H)))) + 2; NA = int(ls_.get("directions", 4096))
    P = cv2.warpPolar(shs_, (R_, NA), (cx, cy), R_, cv2.WARP_POLAR_LINEAR + cv2.INTER_LINEAR) > 0.5
    st_ = P & ~np.pad(P, ((0, 0), (1, 0)))[:, :-1]; en_ = P & ~np.pad(P, ((0, 0), (0, 1)))[:, 1:]; rs, cs = np.nonzero(st_); _, ce = np.nonzero(en_)
    LSRUNS[i] = (cx, cy, R_, NA, rs.astype(np.int32), cs.astype(np.int32), ce.astype(np.int32)); return LSRUNS[i]
def ls_window(i, f, fade, X, Y):
    """what drawing the source's shadows f times as long adds, at the window's pixels (canvas coordinates X, Y). On flat ground seen from a height, depth along a ray from the point on the horizon
    under the Sun goes as 1 / (distance from it), so a shadow from base radius rb to tip rt on the picture becomes one from rb to 1 / (1/rb - f (1/rb - 1/rt)). The added part fades over its last
    "fade" share: the Sun is a disc, so a long shadow's tip is soft."""
    cx, cy, R_, NA, rs, cs, ce = ls_runs(i); out = np.zeros((NA, R_), np.float32)
    rb = np.maximum(cs, 1).astype(np.float64); rt = np.maximum(ce + 1, rb + 1).astype(np.float64); den = 1.0 / rb - f * (1.0 / rb - 1.0 / rt)
    ne = np.minimum(np.where(den > 1e-6, 1.0 / np.maximum(den, 1e-9), R_), R_ - 1).astype(np.int64)
    for k in np.nonzero(ne > ce + 1)[0]:
        a_, b_ = int(ce[k]) + 1, int(ne[k]); out[rs[k], a_:b_] = np.clip((b_ - np.arange(a_, b_, dtype=np.float32)) / max(fade * (b_ - a_), 1.0), 0, 1)
    Hm_ = ls_to_ref(i); w_ = Hm_[2, 0] * X + Hm_[2, 1] * Y + Hm_[2, 2]; Xr = (Hm_[0, 0] * X + Hm_[0, 1] * Y + Hm_[0, 2]) / w_; Yr = (Hm_[1, 0] * X + Hm_[1, 1] * Y + Hm_[1, 2]) / w_      # this frame's pixels in the reference frame
    rr_ = np.hypot(Xr - cx, Yr - cy).astype(np.float32); aa_ = (np.mod(np.arctan2(Yr - cy, Xr - cx), 2 * np.pi) * (NA / (2 * np.pi))).astype(np.float32)
    return cv2.remap(out, rr_, aa_, cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=0)
def stand_behind(fr, t, xw, yw, i):
    """a figure cut out beforehand (astro_stab.py, astro_cut.py: held still, its sky and ground removed) stands at one place in the wide picture, behind something near that hides
    its lower part (a rock, followed through the source by rock_track.py). It keeps its own shot's light. Because it is tied to the picture and to the rock, it moves only as they do."""
    global OVC
    ov = spec["overlay"]
    if OVC is None: OVC = np.load(os.path.join(os.environ.get("OVERLAY_DIR", HERE), ov["cut"]), mmap_mode="r")
    nC = len(OVC); x_ = (t - ov["from_t"]) * FPS; r_ = ov.get("turn_soft", 6.0); k = int(np.clip(round((nC - 1) - (math.sqrt((x_ - (nC - 1)) ** 2 + r_ * r_) - r_)), 0, nC - 1))      # its frames run to the end, turn softly and run back
    a8 = np.ascontiguousarray(OVC[k]); sub = a8[..., :3].astype(np.float32); alpha = a8[..., 3].astype(np.float32) / 255.0
    hot = np.clip((cv2.GaussianBlur(sub.min(2), (0, 0), 1.2) - ov.get("lamp_min", 246.0)) / 6.0, 0, 1)      # its own lamps stay as bright as they are
    if ov.get("lamp_max_px"):                                               # a lamp is a small spot. A large white patch is suit that its own shot lit to white: that is shaded like the rest of the suit
        nh, hl, hs, _ = cv2.connectedComponentsWithStats((hot > 0.3).astype(np.uint8), connectivity=8); hot = hot * np.isin(hl, [c for c in range(1, nh) if hs[c, cv2.CC_STAT_AREA] <= ov["lamp_max_px"]])
    hy_, hx_ = np.mgrid[0:sub.shape[0], 0:sub.shape[1]].astype(np.float32)
    if ov.get("visor"):                                                     # its lamps sit on the helmet's rim, round the visor. A white spot anywhere else (a glove, a reflection in the visor) is not a lamp
        en_ = np.hypot((hx_ - ov["visor"]["at"][0]) / ov["visor"]["radius"][0], (hy_ - ov["visor"]["at"][1]) / ov["visor"]["radius"][1]); hot = hot * ((en_ > 0.93) & (en_ < ov["visor"].get("lamps_to", 1.75)))
    hot = np.maximum(hot, 1.5 * cv2.GaussianBlur(hot, (0, 0), 6.0)).clip(0, 1)[..., None]
    if ov.get("edge_in"): alpha = cv2.GaussianBlur(cv2.erode(alpha, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * int(ov["edge_in"]) + 1, 2 * int(ov["edge_in"]) + 1))), (0, 0), 0.8)      # the outermost pixels of the cut are part suit, part the black of its own shot: a thin dark line down its edges
    if ov.get("clarity"): sub = np.clip(sub + clarity(sub, ov["clarity"]), 0, 255)
    lit_ = np.array(ov.get("shade", [1.0, 1.0, 1.0]), np.float32)[::-1][None, None]
    if ov.get("lamp_pool"):                                                 # its helmet lamps point where it looks: at its hands and chest. That part is lit by them; the rest of the side turned to us is lit only by what the ground near it sends back
        lp = ov["lamp_pool"]; pool_ = np.exp(-(((hx_ - lp["at"][0]) / lp["radius"][0]) ** 2 + ((hy_ - lp["at"][1]) / lp["radius"][1]) ** 2))[..., None]
        lit_ = lit_ + (np.array(lp.get("colour", [0.95, 0.97, 1.0]), np.float32)[::-1] * lp.get("level", 0.9) - lit_) * pool_
    if ov.get("visor"):                                                     # the visor mirrors the place its own shot was made in, which is not ours: it is held dark, and only the lamps in it stay
        vz = ov["visor"]; lit_ = lit_ * (1 - (1 - vz.get("level", 0.5)) * np.clip(1.6 * (1 - ((hx_ - vz["at"][0]) / vz["radius"][0]) ** 2 - ((hy_ - vz["at"][1]) / vz["radius"][1]) ** 2), 0, 1)[..., None])
    sub = sub * lit_ * (1 - hot) + sub * hot
    at = np.array(ov["at"], float); dxy = np.array([float(vp[i, 0] - vp[r, 0]), float(vp[i, 1] - vp[r, 1])]); mask = None
    if ROCK:
        Mr = np.array(ROCK[str(i)], float); tie = ov["rock"].get("tie", 0.8); dxy = tie * (Mr @ [at[0], at[1], 1.0] - at) + (1 - tie) * dxy      # it stands a little beyond the rock: as the camera rises or sinks it shifts nearly as much as the rock does
        mask = rock_mask(i, xw, yw, -float(ov["rock"].get("lower", 0.0)), 0.0, (1920, OW))
        if ov["rock"].get("outline"):                                      # the traced line is a few straight pieces; the rock's real top is not. Its outline is taken from the source frame itself: the rock is the dark that reaches the bottom of the picture,
            ol = ov["rock"]["outline"]; xa_, ya_ = int(math.floor(xw)), int(max(math.floor(yw) + 1000, 0)); g_ = cv2.GaussianBlur(cv2.cvtColor(src(i, ya_, H, max(xa_, 0), min(xa_ + OW + 2, W)), cv2.COLOR_BGR2GRAY), (0, 0), 1.5)      # and the part of its sunlit rim next to that dark (the rim and the sunlit plain behind it are equally bright, so the rest of the rim cannot be told from the plain)
            nk, kl, ks, _ = cv2.connectedComponentsWithStats((g_ < ol.get("dark", 60.0)).astype(np.uint8), connectivity=4); ids_ = np.unique(kl[-1]); dk = np.isin(kl, [c for c in ids_ if c != 0 and ks[c, cv2.CC_STAT_AREA] > 4000]).astype(np.uint8)
            dk = cv2.dilate(dk, np.ones((2 * int(ol.get("rim", 12)) + 1, 5), np.uint8)).astype(np.float32); mask = np.maximum(mask, cv2.warpAffine(dk, np.float32([[1, 0, max(xa_, 0) - xw], [0, 1, ya_ - yw]]), (OW, 1920), flags=cv2.INTER_LINEAR, borderValue=0))
    z_ = ov.get("scale", 1.0); ax_, ay_ = ov["anchor"]; M = np.float32([[z_, 0, at[0] + dxy[0] - xw - z_ * ax_], [0, z_, at[1] + dxy[1] - yw - z_ * ay_]])
    alpha = cv2.warpAffine(alpha, M, (OW, 1920), flags=cv2.INTER_LINEAR, borderValue=0)      # a cut made at the size it is shown (astro_4k.py, "scale": 1.0) is only placed, to a fraction of a pixel, not scaled again
    if alpha.max() < 0.01: return fr
    sub = cv2.warpAffine(sub, M, (OW, 1920), flags=cv2.INTER_CUBIC if abs(z_ - 1.0) < 1e-6 else cv2.INTER_LINEAR, borderValue=0); foc = float(np.interp(t, [p_[0] for p_ in ov["defocus"]], [p_[1] for p_ in ov["defocus"]])) if ov.get("defocus") else 0.0
    if foc > 0.3: fr = cv2.GaussianBlur(fr, (0, 0), foc)
    if ov.get("sun_rim"):                                                   # the Sun is behind it and in view: the edges turned to the Sun catch it. A thin bright line along them, and a wider, weaker light that wraps a little way round, as it does on anything round
        sr = ov["sun_rim"]; sdx, sdy = sr.get("dir", [0.13, -0.99]); ed = lambda d_: np.clip(alpha - cv2.warpAffine(alpha, np.float32([[1, 0, -d_ * sdx], [0, 1, -d_ * sdy]]), (OW, 1920), borderMode=cv2.BORDER_REPLICATE), 0, 1)      # (replicated at the picture's edge: where the frame cuts the figure there is no silhouette to light)
        gate = float(np.clip((t - sr.get("from_t", -1.0)) / 0.5, 0, 1)) * (SUNVIS[0] ** 0.45 if spec.get("sun_height") else 1.0)      # (as much rim as there is Sun above the crest, on the picture's levels)
        rim_ = (cv2.GaussianBlur(ed(sr.get("width", 3.0)), (0, 0), 0.9) * sr.get("level", 0.85) + cv2.GaussianBlur(ed(sr.get("wrap_px", 26.0)), (0, 0), 9.0) * sr.get("wrap", 0.15)) * alpha * gate
        own_ = np.clip(cv2.GaussianBlur(sub.max(2), (0, 0), 3.0) / np.maximum(cv2.GaussianBlur(alpha, (0, 0), 3.0), 0.05) / (255.0 * max(float(np.mean(ov.get("shade", [1.0]))), 0.05)), 0.15, 1.0)      # white cloth catches the Sun brightly, dark glass and black fittings hardly
        sub = sub + (rim_ * own_)[..., None] * np.array(sr.get("colour", [250.0, 246.0, 238.0]), np.float32)[::-1]
    if mask is not None:
        edge_ = cv2.GaussianBlur(mask, (0, 0), max(1.4, foc)); sub = sub * (1 - ov["rock"].get("contact", 0.3) * cv2.GaussianBlur(mask, (0, 0), 10.0))[..., None]      # where it meets the rock it is a little darker: the rock stands between it and some of its light
        if ov["rock"].get("spill", 0) > 0 or ov["rock"].get("shadow", 0) > 0:
            top_ = mask * (1 - cv2.warpAffine(mask, np.float32([[1, 0, 0], [0, 1, ov["rock"].get("spill_px", 90)]]), (OW, 1920))); cxs = at[0] + dxy[0] - xw + ov["rock"].get("shadow_dx", 0.0); fall = np.exp(-((np.arange(OW, dtype=np.float32) - cxs) / ov["rock"].get("spill_width", 330.0)) ** 2)[None]
            if ov["rock"].get("spill", 0) > 0: fr = fr * (1 + ov["rock"]["spill"] * cv2.GaussianBlur(top_ * fall, (0, 0), 14.0))[..., None]      # lamp light that falls on the figure also falls on the top of the rock in front of it
            if ov["rock"].get("shadow", 0) > 0: fr = fr * (1 - ov["rock"]["shadow"] * np.clip(cv2.GaussianBlur(top_ * fall, (0, 0), 22.0) * 1.6, 0, 1))[..., None]      # with the Sun behind it, its shadow falls toward us, onto the top of the rock: soft, because the rock top is uneven and seen edge-on
        alpha = alpha * (1 - edge_)
    return fr * (1 - alpha[..., None]) + sub * alpha[..., None]
def stand_in_front(fr, t, xw):
    """a foreground shot whose sky is black, stood in front of the view: its sky is cut away, the view behind is thrown a little out of focus as a lens focused near would,
    and the subject is lit as the view says it must be: the Sun is behind it, so it is dark, with a thin rim of sunlight along the edges turned to the Sun. Its own lamps stay lit."""
    global OV
    ov = spec["overlay"]
    if OV is None:
        raw = subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-i", os.path.join(os.environ.get("OVERLAY_DIR", HERE), ov["clip"]), "-vf", "select=gte(n\\,%d)" % ov.get("from", 0), "-vsync", "0", "-f", "rawvideo", "-pix_fmt", "bgr24", "-"], capture_output=True, check=True).stdout; OV = np.frombuffer(raw, np.uint8).reshape(-1, 1920, OW, 3)
    k = int(np.clip(round((t - ov["from_t"]) * FPS), 0, len(OV) - 1)); a8 = OV[k]; g = cv2.GaussianBlur(cv2.cvtColor(a8, cv2.COLOR_BGR2GRAY), (0, 0), 1.0)
    def reach(mask, right=False):
        nb, lab, st, _ = cv2.connectedComponentsWithStats(mask.astype(np.uint8), connectivity=4); ids = np.unique(np.concatenate([lab[0], lab[:, 0]] + ([lab[:, -1]] if right else []))); return np.isin(lab, [c for c in ids if c != 0 and st[c, cv2.CC_STAT_AREA] > 400])
    sky_ = reach(g < ov.get("sky", 16), True); wide = g < ov.get("key", 50); R_ = ov.get("open", 15)      # the black sky itself; and the glow the subject's bright edges throw into it: dim, and reached from the top or the left without squeezing through anything narrow
    core_ = reach(cv2.erode(wide.astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * R_ + 1, 2 * R_ + 1))) > 0); back = sky_ | ((cv2.dilate(core_.astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * R_ + 3, 2 * R_ + 3))) > 0) & wide)      # dark inside the subject (a visor, its shaded side) stays
    back = cv2.medianBlur(back.astype(np.uint8), 11) > 0                  # the outline is the subject's, not the glow's ragged rim
    solid = (~back).astype(np.uint8); ns, sl, ss, _ = cv2.connectedComponentsWithStats(solid, connectivity=8); solid = np.isin(sl, [c for c in range(1, ns) if ss[c, cv2.CC_STAT_AREA] >= 500]).astype(np.float32)      # its stars go with its sky
    if ov.get("ground_left"):                                               # the ground of its own shot, to the left of the subject, goes too: on every row the subject starts where the picture first turns suit-white
        run = cv2.erode((g > ov["ground_left"]).astype(np.uint8), np.ones((1, 13), np.uint8)); first = np.where(run.any(1), run.argmax(1), 0).astype(np.float32)
        first = cv2.blur(cv2.medianBlur(np.clip(first, 0, 255).astype(np.uint8)[:, None], 61).astype(np.float32), (1, 25))[:, 0] - 8.0; solid = solid * (np.arange(OW, dtype=np.float32)[None] >= first[:, None])
    alpha = cv2.GaussianBlur(cv2.erode(solid, EL7), (0, 0), 1.3)
    sub = a8.astype(np.float32); hot = np.clip((cv2.GaussianBlur(sub.min(2), (0, 0), 1.2) - ov.get("lamp_min", 246.0)) / 6.0, 0, 1)      # only its lamps are this white
    hot = np.maximum(hot, 0.5 * cv2.GaussianBlur(hot, (0, 0), 7.0) * 3.0).clip(0, 1)[..., None]; dim = np.array(ov.get("shade", [0.2, 0.21, 0.26]), np.float32)[::-1]
    sub = (sub / 255.0) ** ov.get("gamma", 1.15) * 255.0 * dim * (1 - hot) + sub * hot
    sunx, suny = ov.get("sun_dir", [0.8, -0.6]); e1 = np.clip(alpha - cv2.warpAffine(alpha, np.float32([[1, 0, -7 * sunx], [0, 1, -7 * suny]]), (OW, 1920)), 0, 1)      # the edge turned to the Sun
    e1[:, -14:] = 0; e1[-14:] = 0; rim_ = cv2.GaussianBlur(e1, (0, 0), 2.0) * alpha * ov.get("rim", 1.0); sub = sub + rim_[..., None] * np.array([225, 240, 250], np.float32)
    z_ = ov.get("scale", 1.0); M = np.float32([[z_, 0, ov["at_x"] - xw], [0, z_, ov.get("at_y", 0)]])                                # it stands at one place in the wide picture: the camera's own turn brings it into frame
    sub = cv2.warpAffine(sub, M, (OW, 1920), flags=cv2.INTER_AREA if z_ < 1 else cv2.INTER_LINEAR, borderValue=0); alpha = cv2.warpAffine(alpha, M, (OW, 1920), flags=cv2.INTER_AREA if z_ < 1 else cv2.INTER_LINEAR, borderValue=0)[..., None]
    foc = float(np.interp(t, [p_[0] for p_ in ov["defocus"]], [p_[1] for p_ in ov["defocus"]]))
    if foc > 0.3: fr = cv2.GaussianBlur(fr, (0, 0), foc)
    out_ = fr * (1 - alpha) + sub * alpha
    if ov.get("veil", 0) > 0: out_ = out_ + (0.7 * blur_big(fr, 70.0) + 0.3 * blur_big(fr, 320.0)) * alpha * ov["veil"]      # glare happens in the lens, so the bright view behind lifts the dark figure in front of it a little, most where the view is brightest
    return out_
def finish(fr, rng_):
    """one lens and one film for everything in the frame: a trace of softness, fall-off toward the corners, and grain"""
    global VIG
    fp = spec.get("finish")
    if not fp: return np.clip(fr, 0, 255).astype(np.uint8)
    if VIG is None: yv, xv = np.mgrid[0:1920, 0:OW].astype(np.float32); VIG = (1 - fp.get("vignette", 0.1) * (np.hypot((xv - OW / 2) / (OW / 2), (yv - 960) / 960) / 1.414) ** 2.6)[..., None]
    if fp.get("soften", 0) > 0: fr = cv2.GaussianBlur(fr, (0, 0), fp["soften"])
    if fp.get("halation", 0) > 0: fr = fr + (blur_big(np.clip(fr.max(2) - 185.0, 0, None), 10.0) * fp["halation"])[..., None] * np.array([0.22, 0.42, 1.0], np.float32)      # film: a strong light spreads a faint red glow round itself inside the film
    if fp.get("sharpen", 0) > 0: fr = fr + (fr - cv2.GaussianBlur(fr, (0, 0), 1.1)) * fp["sharpen"]      # and fine edges are drawn a little more firmly
    fr = fr * VIG; lum_ = fr.mean(2, keepdims=True); gr = rng_.normal(0, 1.0, (1920, OW, 1)).astype(np.float32)      # grain: mostly brightness, a little colour, a little stronger in the dark
    fr = fr + gr * fp.get("grain", 1.8) * (1.15 - 0.55 * lum_ / 255.0) + rng_.normal(0, 1.0, (1920, OW, 3)).astype(np.float32) * fp.get("grain", 1.8) * 0.28
    return np.clip(fr, 0, 255).astype(np.uint8)
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
    sw = [[round((j + PART[0]) / FPS, 2) for j in range(1, len(v)) if (v[j] > 0.5) != (v[j - 1] > 0.5)] for k_, v in enumerate(ON) if not L[k_].get("blink") and not L[k_].get("silent") and not L[k_].get("glint")]; json.dump({"switch_times": sw}, open(os.path.splitext(out)[0] + "_lamps.json", "w")); print("lamp switch times", sw)
