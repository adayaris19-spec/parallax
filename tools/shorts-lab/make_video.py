# Puts one finished video together from rendered shots: cuts, narration, subtitles, score, loudness.
# The plan (lines, shots, timings) is a JSON file; see night-video.json.
# usage: python make_video.py PLAN.json CLIPS_DIR VOICE_DIR OUT.mp4
#   CLIPS_DIR holds <shot>.mp4 from the render workflow; VOICE_DIR holds <line>.wav and words.json (word timings).
import os, sys, json, subprocess, numpy as np, soundfile as sf
from scipy.signal import resample_poly, butter, sosfilt
from scipy.ndimage import maximum_filter1d, uniform_filter1d
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, os.path.join(HERE, "..", "watch-render"))
import score3, pyloudnorm
plan = json.load(open(sys.argv[1])); CL, VO, OUT = sys.argv[2], sys.argv[3], sys.argv[4]; W = os.path.splitext(OUT)[0] + "_work"; os.makedirs(W, exist_ok=True)
FPS, SR = 24, 48000; run = lambda *a: subprocess.run(a, check=True)
cuts = plan["cuts"]; N = cuts[-1]; total = N / FPS                      # cuts: the frame each shot ends on

# ---------- picture: each shot trimmed to its frames, then joined
parts = []; a = 0
for k, (shot, b) in enumerate(zip(plan["shots"], cuts)):
    p = f"{W}/p{k}.mp4"; n = b - a
    run("ffmpeg", "-v", "error", "-y", "-i", f"{CL}/{shot['clip']}.mp4", "-vf", f"trim=start_frame={shot.get('from', 0)}:end_frame={shot.get('from', 0) + n},setpts=PTS-STARTPTS", "-an", "-c:v", "libx264", "-crf", "10", "-preset", "fast", "-pix_fmt", "yuv420p", "-r", str(FPS), p)
    parts.append(p); a = b
open(f"{W}/list.txt", "w").write("".join(f"file '{p}'\n" for p in parts))
run("ffmpeg", "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", f"{W}/list.txt", "-c", "copy", f"{W}/picture.mp4")

# ---------- narration: every sentence placed at its time
words = json.load(open(f"{VO}/words.json")); voice = np.zeros(int(total * SR) + SR); subs = []
for ln in plan["lines"]:
    x, sr = sf.read(f"{VO}/{ln['id']}.wav", dtype="float32"); x = resample_poly(x, SR, sr); i0 = int(ln["at"] * SR); voice[i0:i0 + len(x)] += x[:len(voice) - i0]
    w = words[ln["id"]]; starts = [0.0] + [w[i][1] for i in ln.get("split", [])]; end = w[-1][2] + 0.30      # a phrase stays until the next begins
    for j, text in enumerate(ln["text"]): subs.append((ln["at"] + starts[j], ln["at"] + (starts[j + 1] if j + 1 < len(starts) else end), text))
voice = voice[:int(total * SR)]

# ---------- score: no beat; it gives way to the voice
cfg = dict(plan["score"]); mix, _ = score3.render([c / FPS for c in cuts[:-1]], total, cfg, cfg.pop("seed", 7)); music = mix[:, :len(voice)]
if music.shape[1] < len(voice): music = np.pad(music, ((0, 0), (0, len(voice) - music.shape[1])))
env = np.abs(voice); env = sosfilt(butter(1, 6.0, "low", fs=SR, output="sos"), np.maximum(env, sosfilt(butter(1, 6.0, "low", fs=SR, output="sos"), env)[::1]))
k = int(0.25 * SR); lead = np.concatenate([env[k:], np.zeros(k)]); env = np.maximum(env, lead)                    # the music starts to give way a little before each sentence
duck = 1.0 - (1.0 - plan.get("duck", 0.36)) * np.clip(env / 0.03, 0, 1); duck = sosfilt(butter(1, 3.0, "low", fs=SR, output="sos"), duck)
meter = pyloudnorm.Meter(SR); v = voice * 10 ** ((-16.0 - meter.integrated_loudness(voice)) / 20); m = music * 10 ** ((plan.get("music_lufs", -27.0) - meter.integrated_loudness(music.T)) / 20) * duck
out = np.stack([v, v]) + m; CEIL = 10 ** (-2.0 / 20)
def limit(x):                                                             # a look-ahead limiter: short peaks are turned down, nothing is clipped
    w = int(0.004 * SR); pk = maximum_filter1d(np.max(np.abs(x), axis=0), 2 * w + 1); return x * uniform_filter1d(np.minimum(1.0, CEIL / np.maximum(pk, 1e-9)), w)
for _ in range(4): out = limit(out * 10 ** ((plan.get("lufs", -15.0) - meter.integrated_loudness(out.T)) / 20))
fo = int(0.5 * SR); out[:, -fo:] *= np.linspace(1, 0, fo) ** 1.5; sf.write(f"{W}/audio.wav", out.T, SR, subtype="PCM_24")

# ---------- subtitles: one phrase at a time, sentence case, no highlight, inside the app's safe areas
def ts(t): h = int(t // 3600); m_ = int(t % 3600 // 60); return f"{h}:{m_:02d}:{t % 60:05.2f}"
S = plan.get("subs", {}); ass = f"""[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: s,{S.get('font', 'Inter Display Medium')},{S.get('size', 58)},&H00FFFFFF,&H00FFFFFF,&H30000000,&H60000000,0,0,0,0,100,100,0.2,0,1,{S.get('outline', 2.8)},{S.get('shadow', 1.8)},2,{S.get('left', 80)},{S.get('right', 170)},{S.get('bottom', 420)},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
""" + "".join(f"Dialogue: 0,{ts(a)},{ts(min(b, total - 0.05))},s,,0,0,0,,{t}\n" for a, b, t in subs)
open(f"{W}/subs.ass", "w").write(ass)
run("ffmpeg", "-v", "error", "-y", "-i", f"{W}/picture.mp4", "-i", f"{W}/audio.wav", "-vf", f"ass={W}/subs.ass", "-c:v", "libx264", "-crf", str(plan.get("crf", 17)), "-preset", "slow", "-pix_fmt", "yuv420p", "-r", str(FPS),
    "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", "-shortest", OUT)
print("wrote", OUT, "length %.2f s" % total, "loudness %.1f LUFS" % meter.integrated_loudness(out.T), "true peak %.1f dB" % (20 * np.log10(np.max(np.abs(resample_poly(out, 4, 1, axis=1))) + 1e-9)))
for a, b, t in subs: print("  %5.2f-%5.2f  %s" % (a, b, t))
