# Joins between shots that do not read as cuts. Reads a plan, trims every shot to its length, and reworks the last frames of one
# shot and the first frames of the next according to plan["joins"] (one entry per cut, in order):
#   {"type": "cut"}                                             a plain cut
#   {"type": "whip", "dir": "left", "out": 5, "in": 5}          the camera whips away and lands on the next shot: both pictures streak the
#                                                               same way, faster and faster, and the change happens inside the streak
#   {"type": "flare", "out": 8, "in": 9, "at": [x, y]}          a light in the first shot grows until it fills the frame; the next shot comes out of it
# Writes <OUT_DIR>/j<k>.mp4 per shot and <OUT_DIR>/plan.json (the same plan, pointing at those files) for make_video.py.
# Only the frames at the joins are held in memory; the rest of each shot is passed straight through.
#
# usage: python seam.py PLAN.json CLIPS_DIR OUT_DIR
import os, sys, json, subprocess, numpy as np, cv2
plan = json.load(open(sys.argv[1])); CL, OUT = sys.argv[2], sys.argv[3]; os.makedirs(OUT, exist_ok=True); W, H, FPS = 1080, 1920, 24; FB = W * H * 3
def reader(clip, a, n):
    return subprocess.Popen(["ffmpeg", "-nostdin", "-v", "error", "-i", f"{CL}/{clip}.mp4", "-vf", f"trim=start_frame={a}:end_frame={a + n},setpts=PTS-STARTPTS", "-f", "rawvideo", "-pix_fmt", "bgr24", "-"], stdout=subprocess.PIPE, bufsize=FB)
def grab(clip, a, n):
    raw = subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-i", f"{CL}/{clip}.mp4", "-vf", f"trim=start_frame={a}:end_frame={a + n},setpts=PTS-STARTPTS", "-f", "rawvideo", "-pix_fmt", "bgr24", "-"], capture_output=True, check=True).stdout
    f = np.frombuffer(raw, np.uint8).reshape(-1, H, W, 3).astype(np.float32); assert len(f) == n, (clip, len(f), n); return f
def streak(img, off, length, horizontal=True):
    """the picture slid by `off` pixels and smeared over `length`; what slides in from beyond its edge is a smear of its own colours"""
    a = img if horizontal else img.transpose(1, 0, 2); n = a.shape[1]; far = cv2.blur(np.ascontiguousarray(a[:, ::-1]), (n // 2 | 1, 1))      # beyond the picture's edge: its own colours, smeared, so nothing recognisable repeats
    tile = np.concatenate([a, far], 1); idx = (np.arange(n) - int(round(off))) % (2 * n); b = np.ascontiguousarray(tile[:, idx])
    k = int(max(1, min(abs(length), n * 0.9)))
    if k > 2: b = cv2.blur(np.concatenate([b[:, -k:], b, b[:, :k]], 1), (k, 1))[:, k:k + n]
    return b if horizontal else b.transpose(1, 0, 2)
cuts = plan["cuts"]; shots = plan["shots"]; joins = plan.get("joins", [{"type": "cut"}] * (len(shots) - 1)); lens = [b - a for a, b in zip([0] + cuts[:-1], cuts)]
head = [None] * len(shots); tail = [None] * len(shots)                    # the reworked first and last frames of each shot
for k, jn in enumerate(joins):
    if jn["type"] == "cut": continue
    no, ni = jn.get("out", 5), jn.get("in", 5); A = grab(shots[k]["clip"], shots[k].get("from", 0) + lens[k] - no, no); B = grab(shots[k + 1]["clip"], shots[k + 1].get("from", 0), ni)
    if jn["type"] == "whip":
        sgn, hor = {"left": (1, True), "right": (-1, True), "up": (1, False), "down": (-1, False)}[jn["dir"]]; span = (W if hor else H) * jn.get("travel", 1.5)
        for i in range(no):                                                 # leaving: slow at first, then faster than the eye can follow
            o0, o1 = span * (i / no) ** 2.4, span * ((i + 1) / no) ** 2.4; A[i] = streak(A[i], sgn * (o0 + o1) / 2, (o1 - o0) * 0.9, hor)
        for i in range(ni):                                                 # arriving: the same way, slowing onto the new picture
            o0, o1 = span * (1 - i / ni) ** 2.4, span * (1 - (i + 1) / ni) ** 2.4; B[i] = streak(B[i], -sgn * (o0 + o1) / 2, (o0 - o1) * 0.9, hor)
        la, fb = A[-1].copy(), B[0].copy(); A[-1] = 0.75 * la + 0.25 * fb; B[0] = 0.25 * la + 0.75 * fb      # inside the streak the two pictures are mixed, so there is no frame where one stops and the other starts
    elif jn["type"] == "flare":
        cx, cy = jn.get("at", [W / 2, H / 2]); yy, xx = np.mgrid[0:H, 0:W].astype(np.float32); r = np.hypot(xx - cx, (yy - cy) * 0.8); white = np.array(jn.get("color", [255, 250, 244]), np.float32)
        for i in range(no):                                                 # the light swells from where it is until nothing else is left
            u = (i + 1) / no; g = np.clip(1.0 * u ** 2.0 * np.exp(-(r / (120 + 2600 * u ** 2.2)) ** 1.4) + u ** 7, 0, 1)[..., None]; A[i] = A[i] + (white - A[i]) * g      # full white only on the very last frame
        for i in range(ni):                                                 # and the next picture comes out of it, the centre last
            u = 1 - (i + 1.0) / ni; g = np.clip(u ** 1.4 * (0.55 + 0.6 * np.exp(-(r / (300 + 1500 * (1 - u))) ** 1.6)), 0, 1)[..., None]; B[i] = B[i] + (white - B[i]) * g
    else: raise SystemExit("unknown join " + jn["type"])
    tail[k] = np.clip(A, 0, 255).astype(np.uint8); head[k + 1] = np.clip(B, 0, 255).astype(np.uint8)
new = json.loads(json.dumps(plan)); new.pop("joins", None)
for k, sh in enumerate(shots):
    rd = reader(sh["clip"], sh.get("from", 0), lens[k]); nh = len(head[k]) if head[k] is not None else 0; nt = len(tail[k]) if tail[k] is not None else 0
    wr = subprocess.Popen(["ffmpeg", "-nostdin", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-", "-c:v", "libx264", "-crf", "10", "-preset", "fast", "-pix_fmt", "yuv420p", f"{OUT}/j{k}.mp4"], stdin=subprocess.PIPE)
    for i in range(lens[k]):
        buf = rd.stdout.read(FB); assert len(buf) == FB, (sh["clip"], i)
        wr.stdin.write(head[k][i].tobytes() if i < nh else tail[k][i - (lens[k] - nt)].tobytes() if i >= lens[k] - nt else buf)
    wr.stdin.close(); wr.wait(); rd.stdout.close(); rd.wait(); new["shots"][k]["clip"] = f"j{k}"; new["shots"][k]["from"] = 0
json.dump(new, open(f"{OUT}/plan.json", "w"), indent=1); print("wrote", len(shots), "shots with", sum(j["type"] != "cut" for j in joins), "worked joins to", OUT)
