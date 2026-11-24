# The cut-out astronaut again, this time straight from NASA's 4K frames.
#
# astro_stab.py and astro_cut.py work on a half-size copy of the shot (wide.mp4): that is enough to hold him still and to find his
# outline, but the picture they hand on has been scaled, compressed again and moved once more before it is scaled to its place in
# the reel. Here the same hold-still move is applied to the 4K frames themselves and each is brought down once, by area, to the
# size it is shown at. The outline is the one astro_cut.py found. The picture is NASA's pixels with one resampling instead of four.
#
# usage: python astro_4k.py DIR/ NASA_4K.mp4 SCALE OUT.npy
#   DIR/ holds wide.mp4, stab.npy and astro_cut.npy (from astro_stab.py and astro_cut.py)
#   SCALE: size in the reel as a part of the 4K frame (0.4 = what "scale": 0.8 of the half-size cut was)
#   OUT.npy: frames x height x width x 4 (colour, cover), read by night_fall.py as overlay.cut with "scale": 1.0
import cv2, numpy as np, sys, subprocess
S, src4k, z, out = sys.argv[1], sys.argv[2], float(sys.argv[3]), sys.argv[4]
cap = cv2.VideoCapture(S + "wide.mp4"); fr = []
while True:
    ok, a = cap.read()
    if not ok: break
    fr.append(a)
A0, A1, REF = 30, len(fr), 100; H, W = fr[0].shape[:2]; g = [cv2.cvtColor(f, cv2.COLOR_BGR2GRAY) for f in fr]
# ---- the hold-still move, found exactly as astro_stab.py finds it
def rigid_mask(gray): b = cv2.GaussianBlur(gray, (0, 0), 1.0); m = (~(b < 30)).astype(np.uint8); m[590:] = 0; m[:, W - 110:] = 0; return cv2.erode(m, np.ones((9, 9), np.uint8))
lk = dict(winSize=(31, 31), maxLevel=3, criteria=(cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 40, 0.01))
def step(a, b):
    p = cv2.goodFeaturesToTrack(g[a], 500, 0.01, 7, mask=rigid_mask(g[a])); q, st, _ = cv2.calcOpticalFlowPyrLK(g[a], g[b], p, None, **lk); ok = st[:, 0] == 1
    M, _ = cv2.estimateAffinePartial2D(p[ok], q[ok], method=cv2.RANSAC, ransacReprojThreshold=1.5); return np.vstack([M, [0, 0, 1]])
cv2.setRNGSeed(0); T = {REF: np.eye(3)}
for k in range(REF, A1 - 1): T[k + 1] = T[k] @ step(k + 1, k)
for k in range(REF, A0, -1): T[k - 1] = T[k] @ step(k - 1, k)
stab = np.load(S + "stab.npy", mmap_mode="r"); cut = np.load(S + "astro_cut.npy", mmap_mode="r")
d = [float(np.abs(cv2.warpAffine(fr[k], T[k][:2].astype(np.float32), (W, H), flags=cv2.INTER_CUBIC).astype(np.float32) - stab[k - A0]).mean()) for k in (A0, 60, 99, A1 - 1)]
print("the move found here against the one the cut was made with: mean difference %.2f levels (0 = the same move)" % max(d))
# ---- the 4K frames: the same crop of the same frames wide.mp4 was made from, not scaled
W4, H4 = 2 * W, 2 * H; up = np.array([[2, 0, 0.5], [0, 2, 0.5], [0, 0, 1.0]]); dn = np.linalg.inv(up)      # a half-size pixel sits over four full-size ones: its centre is half a pixel off theirs
ff = subprocess.Popen(["ffmpeg", "-nostdin", "-v", "error", "-ss", "12.6", "-i", src4k, "-vf", "select='not(mod(n\\,2))',crop=%d:%d:440:0" % (W4, H4), "-vsync", "0", "-frames:v", str(A1), "-f", "rawvideo", "-pix_fmt", "bgr24", "-"], stdout=subprocess.PIPE)
ow, oh = int(round(W4 * z)), int(round(H4 * z)); O = np.lib.format.open_memmap(out, "w+", np.uint8, (A1 - A0, oh, ow, 4)); chk = []
for k in range(A1):
    buf = ff.stdout.read(W4 * H4 * 3)
    if len(buf) < W4 * H4 * 3: raise SystemExit("the 4K file ended at frame %d" % k)
    if k < A0: continue
    a4 = np.frombuffer(buf, np.uint8).reshape(H4, W4, 3)
    if k in (A0, 60, 99, A1 - 1): chk.append(float(np.abs(cv2.resize(a4, (W, H), interpolation=cv2.INTER_AREA).astype(np.float32) - fr[k]).mean()))      # is this the frame wide.mp4 has at this place?
    s4 = cv2.warpAffine(a4, (up @ T[k] @ dn)[:2].astype(np.float32), (W4, H4), flags=cv2.INTER_LANCZOS4, borderMode=cv2.BORDER_CONSTANT)
    al = cv2.resize(np.ascontiguousarray(cut[k - A0, ..., 3]), (W4, H4), interpolation=cv2.INTER_CUBIC)
    O[k - A0, ..., :3] = cv2.resize(s4, (ow, oh), interpolation=cv2.INTER_AREA); O[k - A0, ..., 3] = cv2.resize(al, (ow, oh), interpolation=cv2.INTER_AREA)
ff.stdout.close(); ff.wait(); O.flush()
print("4K frames against the half-size copy: mean difference %.2f levels (a few = same frames, scaled and compressed)" % max(chk))
old = cv2.resize(np.ascontiguousarray(cut[70, ..., :3]), (ow, oh), interpolation=cv2.INTER_AREA).astype(np.float32); new = O[70, ..., :3].astype(np.float32); m = O[70, ..., 3] > 250
hf = lambda x: (cv2.cvtColor(x.astype(np.uint8), cv2.COLOR_BGR2GRAY).astype(np.float32) - cv2.GaussianBlur(cv2.cvtColor(x.astype(np.uint8), cv2.COLOR_BGR2GRAY).astype(np.float32), (0, 0), 1.0))[m].std()
print("fine detail on him at the size shown (rms above 1 px): from the half-size cut %.2f, from 4K %.2f" % (hf(old), hf(new)), "| saved", O.shape)
