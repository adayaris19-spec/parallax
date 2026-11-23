# Sound effects for a reel, made from nothing but arithmetic (no recordings, no licences): what you would hear inside a suit.
# There is no sound outside on the Moon, so every sound here is one a helmet would carry: the radio, your own breath, the suit's fan,
# and switches and impacts felt through the structure. No voices are made.
#
# The plan lists events under "sound"; make_video.py calls render() and mixes the result under the narration.
#   {"type": "beep",   "at": 7.72, "hz": 2525, "tail": 0.5}      radio tone (the tones NASA's radio links use to key a transmission) + static
#   {"type": "breath", "from": 7.8, "to": 13.2, "first": "in"}  slow breathing inside a helmet
#   {"type": "hum",    "from": 0, "to": 7.7, "gain": 1.0}       fan and pump hum
#   {"type": "hit",    "at": 7.75}                              a low thump on a cut
#   {"type": "clunks", "times": [..] or "file": "t1_lamps.json", "pick": 0, "offset": 0.0}   one relay clunk per lamp switching (times written by night_fall.py)
#   {"type": "drop",   "from": 1.0, "to": 6.2}                   a low tone sinking away as the light goes
# Film-style power (owner, Nov 23: "the sounds can be more dramatic"):
#   {"type": "boom",   "at": 7.75, "gain": 1.0, "tail": 2.4}     a deep impact with a long tail
#   {"type": "riser",  "from": 3.2, "to": 6.05}                  a swell that climbs and stops dead (into silence or a boom)
#   {"type": "swell",  "from": 13.0, "peak": 15.4, "to": 19.0, "notes": [38, 45, 50, 57, 62, 66]}   a wide chord opening up (the Sun coming back)
#   {"type": "floods", "file": "t1_lamps.json", "pick": 0, "offset": 0.0}   each lamp as a big floodlight breaker, with the echo of a large space
#   {"type": "whoosh", "at": 6.83, "dir": "left", "length": 0.5}  the rush of a camera whipping from one shot to the next
import json, os, numpy as np
from scipy.signal import butter, sosfilt, fftconvolve
SR = 48000
def bp(x, lo, hi, order=2): return sosfilt(butter(order, [lo, hi], "band", fs=SR, output="sos"), x)
def lp(x, hi, order=2): return sosfilt(butter(order, hi, "low", fs=SR, output="sos"), x)
def hp(x, lo, order=2): return sosfilt(butter(order, lo, "high", fs=SR, output="sos"), x)
def fade(n, a=0.005, b=0.005):
    e = np.ones(n); na, nb = min(int(a * SR), n // 2), min(int(b * SR), n // 2)
    if na: e[:na] = np.sin(np.linspace(0, np.pi / 2, na)) ** 2
    if nb: e[-nb:] = np.cos(np.linspace(0, np.pi / 2, nb)) ** 2
    return e
def db(v): return 10 ** (v / 20)
def midi(n): return 440.0 * 2 ** ((n - 69) / 12)
def hall(x, rng, seconds=2.4, wet=0.35, bright=3500):
    """a large space: the sound plus a decaying wash of itself, different in each ear; returns (2, n)"""
    n = int(seconds * SR); t = np.arange(n) / SR; out = []
    for _ in range(2):
        ir = lp(rng.standard_normal(n), bright) * np.exp(-t * 6.9 / seconds) * np.minimum(t / 0.012, 1); ir /= np.sqrt((ir ** 2).sum())
        out.append(np.concatenate([x, np.zeros(n - 1)]) * (1 - wet) + fftconvolve(x, ir) * wet)
    return np.array(out)

def render(events, total, clips_dir=".", seed=3):
    """returns a stereo track (2, N) at 48 kHz; levels are absolute (the narration sits near -19 dBFS RMS)"""
    N = int(total * SR); out = np.zeros((2, N)); rng = np.random.default_rng(seed)
    def add2(at, x2, gain=1.0):                                         # a stereo sound as it is
        i = int(at * SR)
        if i >= N: return
        if i < 0: x2 = x2[:, -i:]; i = 0
        x2 = x2[:, :N - i]; out[:, i:i + x2.shape[1]] += x2 * gain
    def add(at, x, pan=0.5, gain=1.0):
        i = int(at * SR)
        if i >= N or i + len(x) <= 0: return
        if i < 0: x = x[-i:]; i = 0
        x = x[:N - i]; out[0, i:i + len(x)] += x * gain * np.cos(pan * np.pi / 2) * 1.414; out[1, i:i + len(x)] += x * gain * np.sin(pan * np.pi / 2) * 1.414
    for ev in events:
        k = ev["type"]; g = ev.get("gain", 1.0)
        if k == "beep":                                                # a quarter-second tone, then the open channel's hiss closing down
            n = int(0.25 * SR); t = np.arange(n) / SR; tone = np.sin(2 * np.pi * ev.get("hz", 2525) * t) * fade(n, 0.004, 0.004)
            add(ev["at"], tone, 0.5, g * db(-27))
            tl = ev.get("tail", 0.5); m = int(tl * SR)
            if m:
                h = bp(rng.standard_normal(m), 500, 3200) * (0.75 + 0.25 * lp(rng.standard_normal(m), 30)) * fade(m, 0.01, tl * 0.7)
                add(ev["at"] + 0.25, h / (np.abs(h).max() + 1e-9), 0.5, g * db(-38))
        elif k == "breath":                                            # in through the nose, out through the mouth; the helmet rings a little
            t0 = ev["from"]; phase = ev.get("first", "in"); period = ev.get("period", 4.0)
            while t0 < ev["to"] - 0.6:
                if phase == "in":
                    d = 0.36 * period; n = int(d * SR); e = np.sin(np.linspace(0, np.pi, n)) ** 1.5; x = bp(rng.standard_normal(n), 700, 2600) * e; lvl = -37
                else:
                    d = 0.46 * period; n = int(d * SR); u = np.linspace(0, 1, n); e = np.minimum(u / 0.12, 1) * np.exp(-u * 2.6) * fade(n, 0.01, 0.2); x = bp(rng.standard_normal(n), 250, 1500) * e; lvl = -34
                n = min(n, int((ev["to"] - t0) * SR)); x = x[:n] * fade(n, 0.01, 0.15)
                ring = np.zeros(int(0.045 * SR)); ring[0] = 1; ring[int(0.0021 * SR)] = 0.35; ring[int(0.0047 * SR)] = 0.22; ring[int(0.011 * SR)] = 0.12      # the inside of a helmet: a few very short echoes
                x = np.convolve(x, ring)[:n]; add(t0, x / (np.abs(x).max() + 1e-9), 0.5, g * db(lvl + 9))
                t0 += d + (0.06 if phase == "in" else 0.12) * period; phase = "out" if phase == "in" else "in"
        elif k == "hum":                                               # the suit's fan and pump: a steady low hum with a faint whine
            n = int((ev["to"] - ev["from"]) * SR); t = np.arange(n) / SR; wob = 1 + 0.004 * np.sin(2 * np.pi * 0.31 * t)
            x = sum(a * np.sin(2 * np.pi * f * wob * t + p) for f, a, p in ((118, 1.0, 0), (236, 0.45, 1.0), (354, 0.2, 2.1), (472, 0.08, 0.5))) + 0.05 * np.sin(2 * np.pi * 1870 * t) + 0.5 * lp(rng.standard_normal(n), 400)
            x = x * fade(n, ev.get("fade_in", 0.4), ev.get("fade_out", 0.6)); add(ev["from"], x / np.abs(x).max(), 0.5, g * db(-41))
        elif k == "hit":                                               # felt more than heard: a low thump whose pitch falls
            n = int(0.5 * SR); t = np.arange(n) / SR; f = 44 + 38 * np.exp(-t * 16); x = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 7.5) * fade(n, 0.002, 0.05)
            x += 0.25 * lp(rng.standard_normal(n), 900) * np.exp(-t * 60) + 0.9 * bp(rng.standard_normal(n), 130, 520) * np.exp(-t * 20) * np.minimum(t / 0.004, 1)      # the second part is what a phone speaker can still play
            add(ev["at"] - 0.01, x / np.abs(x).max(), 0.5, g * db(-15))
        elif k == "clunks":                                            # a relay closing for each lamp: a click, a small knock, and a short electric buzz
            times = ev.get("times")
            if times is None: sw = json.load(open(os.path.join(clips_dir, ev["file"])))["switch_times"]; pick = ev.get("pick", 0); times = [s[pick] for s in sw if len(s) > pick]      # pick: 0 = each lamp's first switch, 1 = its second
            pans = ev.get("pans") or [0.25 + 0.5 * ((i * 5) % 7) / 6 for i in range(len(times))]
            for i, (tt, pan) in enumerate(zip(sorted(times), pans)):
                n = int(0.30 * SR); t = np.arange(n) / SR; f0 = 92 + 14 * ((i * 3) % 5)
                x = 0.9 * hp(rng.standard_normal(n), 2500) * np.exp(-t * 700) + 0.8 * np.sin(2 * np.pi * f0 * t) * np.exp(-t * 34)
                x += 0.22 * np.sign(np.sin(2 * np.pi * 100 * t)) * lp(np.ones(n), 2000) * np.exp(-t * 11) * np.minimum(t / 0.012, 1)
                x = lp(x, 5200) * fade(n, 0.0005, 0.03); add(tt + ev.get("offset", 0.0), x / np.abs(x).max(), pan, g * db(-24))
        elif k == "drop":                                              # the light leaving: a low tone that sinks and thins out
            n = int((ev["to"] - ev["from"]) * SR); u = np.linspace(0, 1, n); f = 82 * 2 ** (-1.0 * u); ph = 2 * np.pi * np.cumsum(f) / SR
            x = (np.sin(ph) + 0.3 * np.sin(2 * ph + 0.7)) * np.sin(np.pi * u) ** 0.8 * (1 - 0.6 * u); add(ev["from"], x / np.abs(x).max(), 0.5, g * db(-27))
        elif k == "boom":                                              # a deep impact: a falling sub tone, a body a phone can still play, a short crack, then the room
            n = int(1.6 * SR); t = np.arange(n) / SR; f = 34 + 46 * np.exp(-t * 9); x = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 2.6)
            x += 0.7 * bp(rng.standard_normal(n), 90, 420) * np.exp(-t * 7) + 0.35 * bp(rng.standard_normal(n), 400, 1800) * np.exp(-t * 26) + 0.5 * hp(rng.standard_normal(n), 1500) * np.exp(-t * 180)
            x = np.tanh(1.6 * x / np.abs(x).max()) * fade(n, 0.001, 0.2); y = hall(x, rng, ev.get("tail", 2.4), 0.30, 1800); add2(ev["at"] - 0.012, y / np.abs(y).max(), g * db(-7))
        elif k == "riser":                                             # tension: noise and a cluster of tones climbing, louder and brighter, then nothing
            n = int((ev["to"] - ev["from"]) * SR); u = np.linspace(0, 1, n); e = u ** 2.4
            nz = rng.standard_normal(n); x = np.zeros(n)
            for j, (lo, hi) in enumerate(((180, 500), (500, 1400), (1400, 3800))): x += bp(nz, lo, hi) * np.clip((u - 0.22 * j) / (1 - 0.22 * j), 0, 1) ** 1.5 * (0.9 - 0.2 * j)      # brighter bands join later
            for j, m0 in enumerate(ev.get("notes", [38, 45, 50, 53])): f = midi(m0) * 2 ** (u * ev.get("octaves", 0.5)); x += 0.5 * np.sin(2 * np.pi * np.cumsum(f) / SR + j) * (1 + 0.5 * np.sin(2 * np.pi * (5 + 9 * u) * u * (ev["to"] - ev["from"])))
            x = x * e * fade(n, 0.05, 0.012); y = hall(x, rng, 0.9, 0.25, 4000)[:, :n + int(0.25 * SR)]; y[:, n:] *= np.linspace(1, 0, y.shape[1] - n) ** 2; add2(ev["from"], y / np.abs(y).max(), g * db(-11))
        elif k == "swell":                                             # the Sun coming back: a wide chord that opens, holds and lets go
            n = int((ev["to"] - ev["from"]) * SR); t = np.arange(n) / SR; pk = ev["peak"] - ev["from"]; e = np.where(t < pk, (t / pk) ** 1.8, np.exp(-(t - pk) / ev.get("release", 1.6))) * fade(n, 0.05, 0.4)
            L = np.zeros(n); R = np.zeros(n)
            for j, m0 in enumerate(ev.get("notes", [38, 45, 50, 57, 62, 66])):
                for dt, pan in ((-0.06, 0.2), (0.0, 0.5), (0.07, 0.8)):
                    f = midi(m0 + dt); ph = 2 * np.pi * f * t + rng.uniform(0, 6.28); w = sum(np.sin(h * ph) / h ** 1.25 for h in range(1, 9)) * (1.0 if m0 < 60 else 0.6)
                    L += w * np.cos(pan * np.pi / 2); R += w * np.sin(pan * np.pi / 2)
            cut = 300 + 3200 * np.clip(e, 0, 1) ** 1.3; y = []
            for c in (L, R):                                           # the chord gets brighter as it opens: a low-pass that rises with the level, in short blocks
                o = np.zeros(n); blk = 2048; z = np.zeros((2, 2))
                for a in range(0, n, blk):
                    sos = butter(2, float(cut[a]), "low", fs=SR, output="sos"); seg, zi = sosfilt(sos, c[a:a + blk], zi=np.zeros((sos.shape[0], 2)) if a == 0 else z_); z_ = zi; o[a:a + blk] = seg
                y.append(o * e)
            y = np.array(y); y = np.array([hall(y[0], rng, 2.6, 0.35, 5000)[0], hall(y[1], rng, 2.6, 0.35, 5000)[1]]); add2(ev["from"], y / np.abs(y).max(), g * db(-13))
        elif k == "floods":                                            # big lamps coming on: a heavy breaker, the buzz of the lamp, the echo of a wide place
            times = ev.get("times")
            if times is None: sw = json.load(open(os.path.join(clips_dir, ev["file"])))["switch_times"]; pick = ev.get("pick", 0); times = [s[pick] for s in sw if len(s) > pick]
            times = [tt for tt in times if tt + ev.get("offset", 0.0) <= ev.get("until", 1e9)]      # "until": none after this time in the video (to keep a spoken word clear)
            for i, tt in enumerate(sorted(times)):
                n = int(0.5 * SR); t = np.arange(n) / SR; f0 = 70 + 9 * ((i * 3) % 5)
                x = 1.0 * hp(rng.standard_normal(n), 1800) * np.exp(-t * 320) + 1.0 * np.sin(2 * np.pi * f0 * t) * np.exp(-t * 16) + 0.6 * bp(rng.standard_normal(n), 150, 600) * np.exp(-t * 30)
                x += 0.18 * np.sign(np.sin(2 * np.pi * 100 * t)) * np.exp(-t * 6) * np.minimum(t / 0.02, 1)
                y = hall(lp(x, 6000) * fade(n, 0.0005, 0.05), rng, 1.4, 0.32, 3000); pan = 0.25 + 0.5 * ((i * 5) % 7) / 6; y = y / np.abs(y).max(); y[0] *= np.cos(pan * np.pi / 2) * 1.414; y[1] *= np.sin(pan * np.pi / 2) * 1.414
                add2(tt + ev.get("offset", 0.0), y, g * db(-17))
        elif k == "whoosh":                                            # a camera whipping round: air rushing past, rising then falling, centred on the join
            d = ev.get("length", 0.5); n = int(d * SR); u = np.linspace(-1, 1, n); e = np.exp(-(u / 0.42) ** 2) * fade(n, 0.03, 0.05); nz = rng.standard_normal(n)
            x = bp(nz, 250, 900) * 0.8 + bp(nz, 900, 2600) * np.exp(-(u / 0.3) ** 2) * 0.9 + bp(nz, 2600, 6500) * np.exp(-(u / 0.18) ** 2) * 0.5
            y = hall(x * e, rng, 0.7, 0.2, 5000)[:, :n + int(0.3 * SR)]; pan = np.linspace(0.25, 0.75, y.shape[1]) if ev.get("dir", "left") == "left" else np.linspace(0.75, 0.25, y.shape[1])
            y = y / np.abs(y).max(); y[0] *= np.cos(pan * np.pi / 2) * 1.414; y[1] *= np.sin(pan * np.pi / 2) * 1.414; add2(ev["at"] - d / 2, y, g * db(-13))
        else: raise SystemExit(f"unknown sound {k}")
    return out
