# A camera move over a picture wider than the frame: a 1080x1920 frame travels across it, pixel for pixel (nothing is enlarged).
# The move eases in and out, and each frame is blurred along the move by half the distance travelled in it, as a film shutter would.
#
# usage: python pan_window.py WIDE.mp4 PATH.json OUT.mp4
#   PATH.json: {"x": [[time, left edge], ...], "y": [[time, top edge], ...] (optional), "shutter": 0.5}
#   Between two keys the frame glides (no speed at the keys themselves); put a key before time 0 to start already moving.
import sys, json, subprocess, numpy as np, cv2
src, path, out = sys.argv[1], json.load(open(sys.argv[2])), sys.argv[3]; W, H, FPS = 1080, 1920, 24
pr = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", src], capture_output=True, text=True).stdout.strip().split(","); SW, SH = int(pr[0]), int(pr[1])
def glide(keys, t):
    k = np.array(keys, float)
    if t <= k[0, 0]: return k[0, 1]
    if t >= k[-1, 0]: return k[-1, 1]
    j = int(np.searchsorted(k[:, 0], t, side="right") - 1); u = (t - k[j, 0]) / (k[j + 1, 0] - k[j, 0]); u = u * u * u * (u * (6 * u - 15) + 10); return k[j, 1] + (k[j + 1, 1] - k[j, 1]) * u
pos = lambda t: (float(np.clip(glide(path["x"], t), 0, SW - W)), float(np.clip(glide(path.get("y", [[0, 0]]), t), 0, SH - H)))
rd = subprocess.Popen(["ffmpeg", "-nostdin", "-v", "error", "-i", src, "-f", "rawvideo", "-pix_fmt", "bgr24", "-"], stdout=subprocess.PIPE, bufsize=SW * SH * 3)
wr = subprocess.Popen(["ffmpeg", "-nostdin", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-", "-c:v", "libx264", "-crf", "10", "-preset", "fast", "-pix_fmt", "yuv420p", out], stdin=subprocess.PIPE)
j = 0; top = 0.0
while True:
    buf = rd.stdout.read(SW * SH * 3)
    if len(buf) < SW * SH * 3: break
    f = np.frombuffer(buf, np.uint8).reshape(SH, SW, 3); t = j / FPS; x, y = pos(t); xb, yb = pos(t - 1.0 / FPS); xa, ya = pos(t + 1.0 / FPS); vx, vy = (xa - xb) / 2, (ya - yb) / 2
    M = np.float32([[1, 0, -x], [0, 1, -y]]); fr = cv2.warpAffine(f, M, (W, H), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)      # the move is smooth to a fraction of a pixel
    bx, by = int(round(abs(vx) * path.get("shutter", 0.5))), int(round(abs(vy) * path.get("shutter", 0.5)))
    if bx >= 2 or by >= 2: fr = cv2.blur(fr, (max(bx, 1), max(by, 1)), borderType=cv2.BORDER_REPLICATE)
    wr.stdin.write(fr.tobytes()); top = max(top, abs(vx), abs(vy)); j += 1
wr.stdin.close(); wr.wait(); print("wrote", out, j, "frames; fastest move %.1f px a frame" % top)
