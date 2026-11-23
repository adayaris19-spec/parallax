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
import json, os, numpy as np
from scipy.signal import butter, sosfilt
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

def render(events, total, clips_dir=".", seed=3):
    """returns a stereo track (2, N) at 48 kHz; levels are absolute (the narration sits near -19 dBFS RMS)"""
    N = int(total * SR); out = np.zeros((2, N)); rng = np.random.default_rng(seed)
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
        else: raise SystemExit(f"unknown sound {k}")
    return out
