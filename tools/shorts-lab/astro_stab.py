# The astronaut held still: NASA's camera pulls back and drifts through this shot; here every frame is moved and scaled so that his
# helmet and backpack stay where they are in one reference frame. What is left moving is him, and the ground sliding behind him.
#
# usage: python astro_stab.py DIR/        (DIR/wide.mp4 in, DIR/stab.npy and DIR/stab_valid.npy out)
#   wide.mp4 for the Moon base reel: the astronaut shot of NASA's Moon Base November update, 4K, from 12.6 s, real frames only:
#   ffmpeg -ss 12.6 -i nov_update.mp4 -vf "select='not(mod(n\,2))',crop=2400:2160:440:0,scale=1200:1080:flags=lanczos,setpts=N/24/TB" -frames:v 130 -r 24 -crf 8 -pix_fmt yuv444p wide.mp4
import cv2, numpy as np, sys
S = sys.argv[1]; cap = cv2.VideoCapture(S + "wide.mp4"); fr = []
while True:
    ok, a = cap.read()
    if not ok: break
    fr.append(a)
A0, A1, REF = 30, len(fr), 100; H, W = fr[0].shape[:2]; g = [cv2.cvtColor(f, cv2.COLOR_BGR2GRAY) for f in fr]
def rigid_mask(gray):                                                    # helmet, backpack, shoulders: what does not bend
    b = cv2.GaussianBlur(gray, (0, 0), 1.0); sky = b < 30; hz = 590; m = (~sky).astype(np.uint8); m[hz:] = 0; m[:, W - 110:] = 0; return cv2.erode(m, np.ones((9, 9), np.uint8)), hz
lk = dict(winSize=(31, 31), maxLevel=3, criteria=(cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 40, 0.01))
def step(a, b):                                                          # the move from frame a to frame b, as shift, turn and scale
    m, _ = rigid_mask(g[a]); p = cv2.goodFeaturesToTrack(g[a], 500, 0.01, 7, mask=m); q, st, _ = cv2.calcOpticalFlowPyrLK(g[a], g[b], p, None, **lk); ok = st[:, 0] == 1
    M, inl = cv2.estimateAffinePartial2D(p[ok], q[ok], method=cv2.RANSAC, ransacReprojThreshold=1.5); return np.vstack([M, [0, 0, 1]]), int(inl.sum()), int(ok.sum())
T = {REF: np.eye(3)}
for k in range(REF, A1 - 1): M, ni, nt = step(k + 1, k); T[k + 1] = T[k] @ M        # frame k+1 -> k -> ... -> REF
for k in range(REF, A0, -1): M, ni, nt = step(k - 1, k); T[k - 1] = T[k] @ M
sc = [float(np.hypot(T[k][0, 0], T[k][1, 0])) for k in range(A0, A1)]; print("frames", A0, "to", A1 - 1, "; scale needed %.3f to %.3f; shift up to %.0f px" % (min(sc), max(sc), max(np.hypot(T[k][0, 2], T[k][1, 2]) for k in T)))
st = np.stack([cv2.warpAffine(fr[k], T[k][:2].astype(np.float32), (W, H), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_CONSTANT) for k in range(A0, A1)])
valid = np.stack([cv2.warpAffine(np.ones((H, W), np.uint8), T[k][:2].astype(np.float32), (W, H), flags=cv2.INTER_NEAREST) for k in range(A0, A1)])
np.save(S + "stab.npy", st); np.save(S + "stab_valid.npy", valid); print("saved", st.shape, "; pixels inside every frame: %.0f%%" % (100 * valid.min(0).mean()))
gs = np.stack([cv2.cvtColor(f, cv2.COLOR_BGR2GRAY) for f in st]).astype(np.float32); sd = gs.std(0); med = np.median(gs, 0)
cv2.imwrite(S + "stab_std.png", np.clip(sd * 6, 0, 255).astype(np.uint8)); cv2.imwrite(S + "stab_med.png", med.astype(np.uint8))
cv2.imwrite(S + "stab_row.png", np.hstack([cv2.resize(st[i], None, fx=0.5, fy=0.5) for i in (0, 33, 66, 99)]))
