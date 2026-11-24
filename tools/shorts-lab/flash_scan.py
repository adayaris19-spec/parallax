# A check for flicker: finds things that are brighter or darker for one or two frames and then go back, with the camera's own move
# taken out first (each frame's neighbours are shifted onto it). Something that moves across the picture on its own (a lander, a
# person) also shows up here; the list gives place and time so each entry can be looked at.
#
# usage: python flash_scan.py PICTURE.mp4        (use the picture without subtitles: a subtitle changing is a flash too)
import cv2, numpy as np, sys, collections
f = sys.argv[1]; cap = cv2.VideoCapture(f); fr = []
while True:
    ok, a = cap.read()
    if not ok: break
    g = cv2.cvtColor(a, cv2.COLOR_BGR2GRAY); fr.append(cv2.resize(cv2.dilate(g, np.ones((3, 3), np.uint8)), (540, 960), interpolation=cv2.INTER_AREA).astype(np.float32))
n = len(fr); fps = cap.get(cv2.CAP_PROP_FPS); ev = []; win = cv2.createHanningWindow((540, 960), cv2.CV_32F)
def shift_to(a, b):                                                      # a moved so that it lies on b
    (dx, dy), _ = cv2.phaseCorrelate(a, b, win); return cv2.warpAffine(a, np.float32([[1, 0, dx], [0, 1, dy]]), (540, 960), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE), abs(dx) + abs(dy)
for t in range(1, n - 2):
    b = fr[t]; a, s1 = shift_to(fr[t - 1], b); c, s2 = shift_to(fr[t + 1], b); d, s3 = shift_to(fr[t + 2], b)
    b_ = cv2.GaussianBlur(b, (0, 0), 1.2); a = cv2.GaussianBlur(a, (0, 0), 1.2); c = cv2.GaussianBlur(c, (0, 0), 1.2); d = cv2.GaussianBlur(d, (0, 0), 1.2)
    up1 = np.minimum(b_ - a, b_ - c); dn1 = np.minimum(a - b_, c - b_); up2 = np.minimum(np.minimum(b_ - a, c - a), np.minimum(b_ - d, c - d))
    for name, m in (("flash 1 frame", up1), ("dip 1 frame", dn1), ("flash 2 frames", up2)):
        m = np.maximum(m, 0); m[:12] = 0; m[-12:] = 0; m[:, :12] = 0; m[:, -12:] = 0; y, x = np.unravel_index(m.argmax(), m.shape)
        if m[y, x] > 9: ev.append((float(m[y, x]), t, name, x * 2, y * 2, int((m > 6).sum())))
ev.sort(reverse=True); print(n, "frames at", fps, "fps;", len(ev), "flash events after taking out the camera move")
seen = set(); k = 0
for v, t, name, x, y, area in ev:
    key = (t // 4, x // 80, y // 80)
    if key in seen: continue
    seen.add(key); print("  %5.2f s frame %3d  %-15s at (%4d,%4d) strength %3.0f area %d" % (t / fps, t, name, x, y, v, area)); k += 1
    if k >= 60: break
c = collections.Counter(int(t / fps) for v, t, *_ in ev); print("events per second:", [c.get(s, 0) for s in range(int(n / fps) + 1)])
