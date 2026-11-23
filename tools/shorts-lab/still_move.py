# A slow camera move over a large still picture (for example one of NASA's 4K renderings): the frame travels from one
# 9:16 box of the picture to another, resampled from the full-size picture for every frame so nothing shimmers.
# usage: python still_move.py PICTURE OUT.mp4 FRAMES x0,y0,h  x1,y1,h1  [PAD_TOP]
#   a box is given by its left edge, top edge and height in the picture's pixels (its width is height * 9 / 16);
#   PAD_TOP adds that many rows of black above the picture first (for a sky that is black anyway).
import sys, subprocess, numpy as np, cv2
src, out, n = sys.argv[1], sys.argv[2], int(sys.argv[3]); a = [float(v) for v in sys.argv[4].split(",")]; b = [float(v) for v in sys.argv[5].split(",")]; pad = int(sys.argv[6]) if len(sys.argv) > 6 else 0
im = cv2.imread(src, cv2.IMREAD_COLOR)
if pad: im = cv2.copyMakeBorder(im, pad, 0, 0, 0, cv2.BORDER_CONSTANT, value=(0, 0, 0))
W, H = 1080, 1920; ff = subprocess.Popen(["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{W}x{H}", "-r", "24", "-i", "-", "-c:v", "libx264", "-crf", "10", "-preset", "fast", "-pix_fmt", "yuv420p", out], stdin=subprocess.PIPE)
for i in range(n):
    t = i / max(n - 1, 1); x0, y0, h = (a[k] + (b[k] - a[k]) * t for k in range(3)); s = H / h                 # a steady move: a real dolly does not ease inside a 2-3 second shot
    M = np.array([[s, 0, -x0 * s], [0, s, -y0 * s]], np.float32); ff.stdin.write(cv2.warpAffine(im, M, (W, H), flags=cv2.INTER_AREA if s < 1 else cv2.INTER_LANCZOS4, borderMode=cv2.BORDER_REPLICATE).tobytes())
ff.stdin.close(); ff.wait(); print("wrote", out, n, "frames; scale %.2f to %.2f" % (H / a[2], H / b[2]))
