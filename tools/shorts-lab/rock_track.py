# Follows one near object (the foreground rock in the Moon base take) through the decoded source frames, so that something can be
# stood behind it. Writes, for every source frame, the move (shift, turn, scale) that carries a point on the object from the
# reference frame to that frame, in the picture's own pixels.
#
# usage: python rock_track.py FRAMES.raw W H REF_INDEX X0,Y0,X1,Y1 OUT.json [CHECK.png]
#   FRAMES.raw: the frame cache night_fall.py writes (bgr24); X0..Y1: a box round the object in the reference frame
import sys, json, numpy as np, cv2
raw, W, H, REF = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), int(sys.argv[4]); x0, y0, x1, y1 = [int(v) for v in sys.argv[5].split(",")]; out = sys.argv[6]
F = np.memmap(raw, np.uint8, "r").reshape(-1, H, W, 3); n = len(F); grey = lambda i: cv2.cvtColor(np.ascontiguousarray(F[i][y0:y1, x0:x1]), cv2.COLOR_BGR2GRAY)
lk = dict(winSize=(31, 31), maxLevel=3, criteria=(cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 40, 0.01))
def step(ga, gb):
    p = cv2.goodFeaturesToTrack(ga, 400, 0.01, 8); q, st, _ = cv2.calcOpticalFlowPyrLK(ga, gb, p, None, **lk); ok = st[:, 0] == 1
    M, inl = cv2.estimateAffinePartial2D(p[ok], q[ok], method=cv2.RANSAC, ransacReprojThreshold=1.2); return np.vstack([M, [0, 0, 1]]), int(inl.sum())
T = {REF: np.eye(3)}; g = {REF: grey(REF)}; least = 10 ** 9
for rng in (range(REF + 1, n), range(REF - 1, -1, -1)):
    prev = REF
    for i in rng: g[i] = grey(i); M, ni = step(g[prev], g[i]); T[i] = M @ T[prev]; least = min(least, ni); del g[prev]; prev = i
    g = {REF: grey(REF)}
C = np.array([[1, 0, x0], [0, 1, y0], [0, 0, 1]], float); Ci = np.linalg.inv(C)        # from box pixels to picture pixels
full = {str(i): (C @ T[i] @ Ci)[:2].round(5).tolist() for i in range(n)}; json.dump({"ref": REF, "move": full}, open(out, "w"))
mv = [np.hypot(*(np.array(full[str(i)]) @ [(x0 + x1) / 2, (y0 + y1) / 2, 1] - [(x0 + x1) / 2, (y0 + y1) / 2])) for i in range(n)]; print(n, "frames; the object moves up to %.0f px from its place in the reference frame; fewest points agreeing in a step: %d" % (max(mv), least))
if len(sys.argv) > 7:                                                    # a picture to check by eye: a line drawn on the object in the reference frame, carried to the first and last frames
    line = np.array(json.loads(sys.argv[8]), float) if len(sys.argv) > 8 else np.array([[x0, (y0 + y1) / 2], [x1, (y0 + y1) / 2]], float); rows = []
    for i in (0, REF, n - 1):
        im = np.ascontiguousarray(F[i][y0 - 150:y1, x0:x1]); pts = (np.c_[line, np.ones(len(line))] @ np.array(full[str(i)]).T - [x0, y0 - 150]).round().astype(np.int32); cv2.polylines(im, [pts], False, (0, 0, 255), 2); rows.append(cv2.resize(im, None, fx=0.5, fy=0.5))
    cv2.imwrite(sys.argv[7], np.hstack(rows))
