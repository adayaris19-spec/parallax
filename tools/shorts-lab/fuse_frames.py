# More of the source's own detail: each frame is rebuilt from itself and the frames just before and after it.
#
# A video file carries each frame with its own noise (from the render and from the compression), and that noise is what limits how
# firmly fine detail can be drawn: sharpen a single frame and the noise is sharpened with it. The frames next to it show the same
# ground a fraction of a second apart, with different noise. Here every neighbour is moved onto the frame place by place
# (optical flow), and the two are averaged wherever they agree. Where they do not agree (something moved, a line broke up for one
# frame, the move could not be followed) the frame keeps its own pixels, so nothing is smeared, doubled or erased.
# Nothing is invented: every value written is an average of the source's own values for that place.
#
# usage: python fuse_frames.py IN.raw W H OUT.raw [NEIGHBOURS each side, default 3]
#   IN.raw / OUT.raw: frames as bgr24, one after another (the cache night_fall.py makes and reads)
#   PART=a,b   do frames a to b-1 only (several runs side by side write into the same OUT.raw)
#   CHECK=i    do frame i only, print what it gained, write nothing
import os, sys, numpy as np, cv2
src, W, H, out = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), sys.argv[4]; K = int(sys.argv[5]) if len(sys.argv) > 5 else 3
F = np.memmap(src, np.uint8, "r").reshape(-1, H, W, 3); N = len(F); SIG = float(os.environ.get("AGREE", 5.0))      # AGREE: how far (in levels, after a slight blur) a neighbour may differ and still count half
gy, gx = np.mgrid[0:H, 0:W].astype(np.float32); dis = cv2.DISOpticalFlow_create(cv2.DISOPTICAL_FLOW_PRESET_MEDIUM); dis.setFinestScale(int(os.environ.get("FINEST", 1)))
soft = lambda a: cv2.GaussianBlur(a, (0, 0), 1.0)
def fuse(i):
    c = F[i].astype(np.float32); cg8 = cv2.cvtColor(F[i], cv2.COLOR_BGR2GRAY); cg = soft(cg8.astype(np.float32)); acc = c.copy(); wsum = np.ones((H, W), np.float32); used = 0.0
    js = [j for j in range(i - K, i + K + 1) if j != i and 0 <= j < N]
    for j in js:
        fl = cv2.GaussianBlur(dis.calc(cg8, cv2.cvtColor(F[j], cv2.COLOR_BGR2GRAY), None), (0, 0), 1.5); mx, my = gx + fl[..., 0], gy + fl[..., 1]
        w = cv2.remap(np.ascontiguousarray(F[j]).astype(np.float32), mx, my, cv2.INTER_LANCZOS4, borderMode=cv2.BORDER_REPLICATE)
        d = soft(cv2.cvtColor(w, cv2.COLOR_BGR2GRAY)) - cg; wt = np.exp(-(d * d) / (2 * SIG * SIG)) * ((mx >= 0) & (mx <= W - 1) & (my >= 0) & (my <= H - 1))
        wt = np.minimum(wt, cv2.erode(wt, np.ones((3, 3), np.uint8)))          # a neighbour that disagrees at one place is not trusted right beside it either
        acc += w * wt[..., None]; wsum += wt; used += float(wt.mean())
    return acc / wsum[..., None], used / max(len(js), 1), wsum
def hf(a): g = cv2.cvtColor(np.clip(a, 0, 255).astype(np.uint8), cv2.COLOR_BGR2GRAY).astype(np.float32); return g - cv2.GaussianBlur(g, (0, 0), 1.0)
if os.environ.get("CHECK"):
    i = int(os.environ["CHECK"]); r, used, ws = fuse(i); c = F[i].astype(np.float32)
    # noise: what is left of a frame after its fused version is taken away is the part the neighbours did not share
    n1 = (c - r)[..., 1]; flat = cv2.GaussianBlur(np.abs(hf(r)), (0, 0), 4.0) < 1.2
    print("frame %d: neighbours agreed on %.0f%% of the picture; mean frames per pixel %.2f" % (i, 100 * used, float(ws.mean())))
    print("  taken out (rms, green): all %.2f | flat ground %.2f" % (float(n1.std()), float(n1[flat].std()) if flat.any() else 0))
    print("  fine detail (rms above 1 px): single %.2f, fused %.2f" % (float(hf(c)[900:1900].std()), float(hf(r)[900:1900].std())))
    if len(sys.argv) > 6: np.save(sys.argv[6], r)
    sys.exit()
a, b = [int(v) for v in os.environ["PART"].split(",")] if os.environ.get("PART") else (0, N)
if not os.path.exists(out):
    with open(out, "wb") as fh: fh.truncate(N * H * W * 3)
O = np.memmap(out, np.uint8, "r+").reshape(-1, H, W, 3); rng = np.random.default_rng(77 + a)
for i in range(a, b):
    r, used, _ = fuse(i)
    O[i] = np.clip(np.floor(r + rng.random((H, W, 1), dtype=np.float32)), 0, 255).astype(np.uint8)      # rounded up or down at random in proportion, so smooth dark gradients do not turn into steps
    if (i - a) % 5 == 0: print("frame", i, "agreed %.0f%%" % (100 * used), flush=True); O.flush()
O.flush(); print("wrote frames", a, "to", b - 1)
