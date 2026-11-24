# How much fine detail a video carries, as numbers: for chosen moments, the strength (rms, in levels of 255) of what the picture
# holds at three sizes: under about 1 px, 1 to 3 px, 3 to 9 px. Two videos of the same take can be put side by side.
# Detail and noise both count here, so the last column gives the noise: what changes from one frame to the next at a place
# where nothing moves (the quietest tenth of the picture), which detail does not do.
#
# usage: python detail_meter.py A.mp4 [B.mp4] TIMES [ROWS]      e.g. detail_meter.py old.mp4 new.mp4 1.0,8.0,16.5 700:1900
import sys, numpy as np, cv2
args = sys.argv[1:]; vids = [a for a in args if a.endswith(".mp4")]; rest = [a for a in args if not a.endswith(".mp4")]
times = [float(v) for v in rest[0].split(",")]; r0, r1 = [int(v) for v in rest[1].split(":")] if len(rest) > 1 else (0, 1920)
def grab(path, t):
    cap = cv2.VideoCapture(path); fps = cap.get(cv2.CAP_PROP_FPS); cap.set(cv2.CAP_PROP_POS_FRAMES, int(round(t * fps))); out = []
    for _ in range(2):
        ok, a = cap.read()
        if not ok: break
        out.append(cv2.cvtColor(a, cv2.COLOR_BGR2GRAY).astype(np.float32)[r0:r1])
    return out
G = lambda a, s: cv2.GaussianBlur(a, (0, 0), s)
print("%-28s %6s | %8s %8s %8s | %s" % ("video", "at", "< 1 px", "1-3 px", "3-9 px", "noise (frame to frame, still parts)"))
for t in times:
    for v in vids:
        f = grab(v, t); a = f[0]; g1, g3, g9 = G(a, 1.0), G(a, 3.0), G(a, 9.0)
        d = np.abs(G(f[1], 1.0) - g1) if len(f) > 1 else np.zeros_like(a); blk = cv2.resize(np.abs(f[1] - a) if len(f) > 1 else d, (a.shape[1] // 16, a.shape[0] // 16), interpolation=cv2.INTER_AREA)
        still = cv2.resize(d, (a.shape[1] // 16, a.shape[0] // 16), interpolation=cv2.INTER_AREA); q = blk[still <= np.percentile(still, 10)].mean() / 1.128      # mean |difference| of two frames = 1.128 x the noise of one
        print("%-28s %5.1fs | %8.2f %8.2f %8.2f | %.2f" % (v.split("/")[-1][:28], t, (a - g1).std(), (g1 - g3).std(), (g3 - g9).std(), q))
