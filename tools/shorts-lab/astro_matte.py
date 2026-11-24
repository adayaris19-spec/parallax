# The astronaut's outline found again on the 4K pixels themselves.
#
# astro_cut.py found his outline on a half-size copy of NASA's shot and smoothed it: at the size he is now shown (astro_4k.py)
# it is blobby. Where the suit meets the background it wanders by several pixels, takes in a strip of dark sky beside the
# backpack and cuts into the right shoulder. Here the old outline only says where to look: a band of BAND px on each side of
# it is left open, everything inside the band is suit and everything outside is background, and each pixel in the band is
# given to the side whose colours it matches (OpenCV's GrabCut). The new outline is then softened by under a pixel, and
# each frame's is the median of it and its two neighbours, so it does not flicker.
#
# usage: python astro_matte.py IN.npy OUT.npy [BAND]      (IN.npy: frames x h x w x 4 from astro_4k.py; OUT.npy the same, cover replaced)
#   PREVIEW=k  only frame k, written as OUT.png beside the old outline
import os, sys, numpy as np, cv2
src, out = sys.argv[1], sys.argv[2]; band = int(sys.argv[3]) if len(sys.argv) > 3 else 12
A = np.load(src, mmap_mode="r"); N = len(A)
def refine(k):
    f = np.ascontiguousarray(A[k, ..., :3]); a = A[k, ..., 3]; inside = (a > 127).astype(np.uint8); ker = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * band + 1, 2 * band + 1))
    m = np.full(a.shape, cv2.GC_PR_BGD, np.uint8); m[inside > 0] = cv2.GC_PR_FGD; m[cv2.erode(inside, ker) > 0] = cv2.GC_FGD; m[cv2.dilate(inside, ker) == 0] = cv2.GC_BGD
    m[-6:] = np.where(inside[-6:] > 0, cv2.GC_FGD, cv2.GC_BGD)      # the bottom rows are hidden by the rock: as before
    bg, fg = np.zeros((1, 65), np.float64), np.zeros((1, 65), np.float64); cv2.setRNGSeed(k); cv2.grabCut(f, m, None, bg, fg, 4, cv2.GC_INIT_WITH_MASK)
    r = ((m == cv2.GC_FGD) | (m == cv2.GC_PR_FGD)).astype(np.uint8)
    n, lab, st, _ = cv2.connectedComponentsWithStats(r, 8); keep = 1 + int(np.argmax(st[1:, cv2.CC_STAT_AREA])) if n > 1 else 1; r = (lab == keep).astype(np.uint8)      # one piece: no islands
    r = 1 - cv2.morphologyEx(1 - r, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8)); r = cv2.morphologyEx(r, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5)))      # no holes or hairs a pixel wide
    return r.astype(np.float32)
if os.environ.get("PREVIEW"):
    k = int(os.environ["PREVIEW"]); r = refine(k); f = np.ascontiguousarray(A[k, ..., :3]); old = A[k, ..., 3] > 127
    v = f.copy(); c_old = cv2.findContours(old.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)[0]; c_new = cv2.findContours((r > 0.5).astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)[0]
    cv2.drawContours(v, c_old, -1, (0, 0, 255), 1); cv2.drawContours(v, c_new, -1, (0, 255, 0), 1); cv2.imwrite(out, v); print("changed pixels: %d added, %d taken off" % (((r > 0.5) & ~old).sum(), (~(r > 0.5) & old).sum())); sys.exit()
R = np.zeros((N,) + A.shape[1:3], np.float32)
for k in range(N):
    R[k] = refine(k)
    if k % 10 == 0: print("frame", k, flush=True)
O = np.lib.format.open_memmap(out, "w+", np.uint8, A.shape)
for k in range(N):
    med = np.median(R[max(k - 1, 0):k + 2], axis=0) if 0 < k < N - 1 else R[k]
    O[k, ..., :3] = A[k, ..., :3]; O[k, ..., 3] = np.clip(cv2.GaussianBlur(med, (0, 0), 0.7) * 255.0 + 0.5, 0, 255).astype(np.uint8)
O.flush(); d = np.abs(O[..., 3].astype(np.float32) - A[..., 3]).mean(axis=(1, 2)); print("wrote", out, "| mean change of the cover per frame %.2f levels (largest %.2f)" % (d.mean(), d.max()))
