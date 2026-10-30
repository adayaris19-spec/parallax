# Score library for rendered Watch videos (from the Reel scores): render_score(cuts, total, cfg) -> stereo array.
import re, subprocess, wave, os
import numpy as np
from scipy.signal import butter, sosfilt, fftconvolve
SR = 48000
def midi(m): return 440.0 * 2 ** ((m - 69) / 12)
def lp(x, f, o=2): return sosfilt(butter(o, f, 'low', fs=SR, output='sos'), x)
def hp(x, f, o=2): return sosfilt(butter(o, f, 'high', fs=SR, output='sos'), x)
def bp(x, a, b, o=2): return sosfilt(butter(o, [a, b], 'band', fs=SR, output='sos'), x)
def env(n, a, r):
    e = np.ones(n); na, nr = min(int(a * SR), n), min(int(r * SR), n)
    if na: e[:na] = np.linspace(0, 1, na) ** 1.6
    if nr: e[-nr:] *= np.linspace(1, 0, nr) ** 1.4
    return e

class Mix:
    def __init__(s, N, seed):
        s.N = N; s.rng = np.random.default_rng(seed)
        s.wet = np.zeros((2, N)); s.dry = np.zeros((2, N))
    def add(s, t, v, pan=0.5, wet=True, gain=1.0):
        a = int(t * SR)
        if a >= s.N or a < 0: return
        v = v[:s.N - a] * gain; L, Rr = np.sqrt(1 - pan), np.sqrt(pan)
        tgt = s.wet if wet else s.dry
        tgt[0, a:a + len(v)] += v * L; tgt[1, a:a + len(v)] += v * Rr

# ---------- instruments ----------
def saw(f, n, bright, rng, detunes=(-0.07, 0, 0.07)):
    t = np.arange(n) / SR; out = np.zeros(n)
    for det in detunes:
        ff = f * 2 ** (det / 12); k = 1
        while k * ff < min(bright * 2.2, 9000):
            out += (1 / k) * np.exp(-k * ff / bright) * np.sin(2 * np.pi * k * ff * t + rng.uniform(0, 6.28)); k += 1
    return out / len(detunes)
def pluck(f, n):
    t = np.arange(n) / SR
    return (np.sin(2 * np.pi * f * t) + 0.35 * np.sin(4 * np.pi * f * t) * np.exp(-t * 6) + 0.12 * np.sin(2 * np.pi * 3.01 * f * t) * np.exp(-t * 9)) * np.exp(-t * 4.2) * (1 - np.exp(-t * 900))
def bell(f, n, decay=0.9):
    t = np.arange(n) / SR
    return (np.sin(2 * np.pi * f * t) + 0.5 * np.sin(2 * np.pi * 2.76 * f * t) * np.exp(-t * 1.5) + 0.25 * np.sin(2 * np.pi * 5.4 * f * t) * np.exp(-t * 3)) * np.exp(-t * decay) * (1 - np.exp(-t * 400))
def piano(f, n, rng):
    # felt piano: slightly stretched partials, each decaying faster the higher it is, plus a soft hammer thump
    t = np.arange(n) / SR; out = np.zeros(n)
    for k in range(1, 9):
        fk = f * k * (1 + 0.0004 * k * k)
        if fk > 7000: break
        out += (0.9 ** k) / k ** 0.7 * np.sin(2 * np.pi * fk * t + rng.uniform(0, 6.28)) * np.exp(-t * (0.9 + 0.55 * k))
    thump = lp(rng.standard_normal(n), 900) * np.exp(-t * 60) * 0.25
    return (out + thump) * (1 - np.exp(-t * 300))
def boom(n, rng, f0=34, f1=52, d=2.4):
    t = np.arange(n) / SR; f = f0 + f1 * np.exp(-t * 7)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * d) + lp(rng.standard_normal(n), 2500) * np.exp(-t * 40) * 0.35
def taiko(n, rng):
    t = np.arange(n) / SR; f = 70 + 60 * np.exp(-t * 18)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 5) + bp(rng.standard_normal(n), 120, 900) * np.exp(-t * 22) * 0.8
def kick(n):
    t = np.arange(n) / SR; f = 48 + 110 * np.exp(-t * 30)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 9)
def hat(n, rng):
    t = np.arange(n) / SR
    return hp(rng.standard_normal(n), 7000) * np.exp(-t * 55)
def tick(n, rng, f=2600):
    t = np.arange(n) / SR
    return (np.sin(2 * np.pi * f * t) * 0.6 + bp(rng.standard_normal(n), 1800, 6000)) * np.exp(-t * 180)
def heartbeat(n, rng):
    t = np.arange(n) / SR
    def thump(t0, a):
        tt = np.clip(t - t0, 0, None); on = (t >= t0)
        f = 45 + 35 * np.exp(-tt * 25)
        return np.sin(2 * np.pi * np.cumsum(f * on) / SR) * np.exp(-tt * 14) * on * a
    return thump(0, 1.0) + thump(0.24, 0.7)
def whoosh(n, rng):
    t = np.linspace(0, 1, n)
    return bp(rng.standard_normal(n), 300, 5000) * t ** 2.2 * 0.5
def breath(n, rng):
    t = np.linspace(0, 1, n)
    return bp(rng.standard_normal(n), 500, 3000) * np.sin(np.pi * t) ** 2 * 0.5

def reverb(x, sec, rng):
    n = int(sec * SR); t = np.arange(n) / SR; out = []
    for ch in range(2):
        ir = lp(rng.standard_normal(n) * np.exp(-t * 6.6 / sec), 6000, 1); ir[:960] *= np.linspace(0, 1, 960)
        out.append(fftconvolve(x[ch], ir / np.sqrt(np.sum(ir ** 2)))[:x.shape[1]])
    return np.stack(out)

SHAPE = {'m': [0, 7, 12, 15], 'M': [0, 7, 12, 16], 'm9': [0, 7, 14, 15], 'M9': [0, 7, 14, 16], 'sus': [0, 7, 12, 17]}
STYLES = {
 # id: style, key (tonic midi), progression (degree, chord) per beat, extras
 '01-moon-2020':     dict(style='ambient', key=57, prog=[(0,'m'),(8,'M'),(3,'M'),(10,'M'),(5,'m'),(0,'m9')]),
 '02-lithium-2023':  dict(style='pulse', key=52, bpm=112, prog=[(0,'m'),(8,'M'),(3,'M'),(10,'M'),(0,'m'),(3,'M9')], bright=1.0),
 '03-blindness-2020':dict(style='piano', key=48, prog=[(9,'m'),(5,'M'),(0,'M'),(7,'M'),(5,'M9'),(0,'M9')], major=True),
 '04-fusion-fuel':   dict(style='pulse', key=53, bpm=126, prog=[(0,'m'),(0,'m'),(8,'M'),(10,'M'),(3,'M'),(0,'sus')], bright=0.7, sweep=True),
 '05-alzheimers':    dict(style='piano', key=50, prog=[(0,'m'),(8,'M'),(5,'m'),(10,'M'),(3,'M'),(0,'m9')], cello=True),
 '06-malaria':       dict(style='tension', key=49, prog=[(0,'m'),(0,'m'),(1,'M'),(0,'m'),(8,'M'),(0,'m')], taiko=True),
 '07-lunar-night':   dict(style='space', key=54, prog=[(0,'m9'),(8,'M9'),(3,'M9'),(10,'sus'),(5,'m9'),(0,'m9')], clock=True),
 '08-cancer-dna':    dict(style='heart', key=55, prog=[(0,'m'),(3,'M'),(8,'M'),(10,'M'),(5,'m'),(0,'m9')]),
 '09-tb-vaccine':    dict(style='tension', key=56, prog=[(0,'m'),(5,'m'),(0,'m'),(8,'M'),(10,'M'),(0,'m9')], ticking=True, breath=True),
}

def chord_notes(key, deg, kind):
    root = key + deg - (12 if deg > 6 else 0)
    return root, [root + iv for iv in SHAPE[kind]]

def pad_layer(m, edges, cfg, gain=0.2, bright0=1300, bstep=320, att=0.45, rel=0.9, oct=0):
    for i in range(len(edges) - 1):
        a, b = edges[i], edges[i + 1]; last = i == len(edges) - 2
        root, notes = chord_notes(cfg['key'], *cfg['prog'][i])
        n = int((b - a + 0.35 + (0 if last else 0.9)) * SR)
        e = env(n, att, rel if not last else 0.6)
        for j, nt in enumerate(notes):
            v = saw(midi(nt + oct), n, bright0 + bstep * i, m.rng) * e * (gain if j else gain * 1.2)
            m.add(max(0, a - 0.35), v, pan=0.5 + 0.35 * np.cos(j * 1.7))
    return

def hits(m, cuts, total, kind='boom', g=0.17, whoosh_g=0.1):
    for c in [0.02] + cuts:
        n = int(2.2 * SR)
        v = boom(n, m.rng) if kind == 'boom' else taiko(n, m.rng)
        m.add(c, v, wet=kind != 'boom', gain=g * (0.75 if c < 0.1 else 1))
        if c > 0.1:
            w = int(0.55 * SR); m.add(c - 0.55, whoosh(w, m.rng), pan=0.4, gain=whoosh_g)

def ending_bells(m, edges, cfg, g=0.10):
    a = edges[-2]; root, _ = chord_notes(cfg['key'], *cfg['prog'][-1])
    for j, iv in enumerate((24, 31, 36, 39 if 'M' not in cfg['prog'][-1][1] else 40)):
        n = int((edges[-1] - a) * SR) + SR
        m.add(a + 0.1 + j * 0.09, bell(midi(root + iv), n), pan=0.3 + 0.13 * j, gain=g)

def render(cuts, total, cfg, seed=7):
    st = cfg['style']
    N = int((total + 0.05) * SR); edges = [0.0] + cuts + [total]
    m = Mix(N, seed)
    rv = 2.8
    if st == 'ambient':  # the original sound (kept for the Moon Reel)
        pad_layer(m, edges, cfg)
        for i in range(len(edges) - 1):
            a, b = edges[i], edges[i + 1]; root, notes = chord_notes(cfg['key'], *cfg['prog'][i]); kind = cfg['prog'][i][1]
            if i >= 1: n = int((b - a + 1.25) * SR); t = np.arange(n) / SR; m.add(max(0, a - 0.35), np.sin(2 * np.pi * midi(root - 12) * t) * env(n, 0.3, 0.6), wet=False, gain=0.07)
            if i >= 2:
                n = int((b - a + 1.25) * SR); t = np.arange(n) / SR
                for j, iv in enumerate((24, 31, 36, 43)):
                    m.add(max(0, a - 0.35), np.sin(2 * np.pi * midi(root + iv) * t) * (0.6 + 0.4 * np.sin(2 * np.pi * (0.35 + 0.1 * j) * t + j)) * env(n, 0.45, 0.9), pan=0.25 + 0.5 * (j % 2), gain=0.035)
            if 1 <= i < len(edges) - 2:
                step = 0.30 if i < 3 else 0.15; tones = [root + 12 + x for x in (0, 7, 12, 15 if 'm' in kind else 16, 19, 15 if 'm' in kind else 16, 12, 7)]
                t0 = a + 0.08; k = 0
                while t0 < b - 0.12:
                    m.add(t0, pluck(midi(tones[k % 8]), int(1.1 * SR)), pan=0.2 + 0.6 * (k % 2), gain=0.16 if step > 0.2 else 0.12); t0 += step; k += 1
        hits(m, cuts, total); ending_bells(m, edges, cfg)
    elif st == 'pulse':  # driving electronic: kick on the beat, offbeat hats, a 16th-note bass that ducks under the kick
        pad_layer(m, edges, cfg, gain=0.13, bright0=int(1100 * cfg['bright']), bstep=380)
        spb = 60 / cfg['bpm']; t = 0.0; k = 0
        while t < total - 0.7:
            seg = max(i for i in range(len(edges) - 1) if edges[i] <= t); last = seg == len(edges) - 2
            root, notes = chord_notes(cfg['key'], *cfg['prog'][seg])
            if seg >= 1 and not last:
                if k % 4 == 0: m.add(t, kick(int(0.5 * SR)), wet=False, gain=0.42)
                if k % 4 == 2: m.add(t, hat(int(0.15 * SR), m.rng), pan=0.65, wet=False, gain=0.10)
                if seg >= 3 and k % 2 == 1: m.add(t, hat(int(0.08 * SR), m.rng), pan=0.35, wet=False, gain=0.05)
            if not last:
                n = int(spb / 4 * 0.9 * SR); tt = np.arange(n) / SR
                f = midi(root - 12 + (12 if k % 8 == 6 else 0))
                bass = lp(saw(f, n, 900, m.rng, (0,)), 900 + 500 * seg) * np.exp(-tt * 9) * (0.55 if k % 4 == 0 else 1.0)
                m.add(t, bass, wet=False, gain=0.22 if seg >= 1 else 0.12)
            t += spb / 4; k += 1
        if cfg.get('sweep'):
            for c in cuts[2:]:
                n = int(1.6 * SR); s = bp(m.rng.standard_normal(n), 400, 6000) * np.linspace(0, 1, n) ** 3
                m.add(c - 1.6, s, pan=0.6, gain=0.07)
        hits(m, cuts, total, g=0.14); ending_bells(m, edges, cfg, g=0.09); rv = 2.2
    elif st == 'piano':  # felt piano broken chords, warm strings underneath, soft timpani on the cuts
        pad_layer(m, edges, cfg, gain=0.09, bright0=700, bstep=150, att=0.9, rel=1.2)
        for i in range(len(edges) - 1):
            a, b = edges[i], edges[i + 1]; root, notes = chord_notes(cfg['key'], *cfg['prog'][i]); last = i == len(edges) - 2
            pat = [notes[0] + 12, notes[1] + 12, notes[2] + 12, notes[3] + 12, notes[2] + 24, notes[3] + 12]
            step = 0.42 if i < 3 else 0.32
            t0 = a + 0.05; k = 0
            while t0 < b - 0.1:
                m.add(t0, piano(midi(pat[k % len(pat)]), int(2.4 * SR), m.rng), pan=0.35 + 0.3 * ((k * 3) % 4) / 3, gain=0.18 if k % 3 == 0 else 0.13)
                t0 += step; k += 1
                if last and k >= 4: break
            if i == 0 or last: m.add(a + 0.02, piano(midi(root - 12), int(3 * SR), m.rng), gain=0.2)
            if cfg.get('cello') and i >= 1:  # a slow low line, one long note per beat
                n = int((b - a + 0.8) * SR)
                vib = np.sin(2 * np.pi * 5.2 * np.arange(n) / SR) * 0.004
                f = midi(root - 12 + (7 if i % 2 else 0)) * (1 + vib)
                tt = np.arange(n) / SR; ph = 2 * np.pi * np.cumsum(f) / SR
                cel = sum(np.sin(k2 * ph) / k2 ** 1.3 for k2 in range(1, 9)); cel = lp(cel, 1800) * env(n, 0.6, 0.8)
                m.add(a, cel, pan=0.45, gain=0.08)
        hits(m, cuts, total, kind='boom', g=0.10, whoosh_g=0.05); ending_bells(m, edges, cfg, g=0.07); rv = 3.2
    elif st == 'tension':  # low drone, staccato string pulses, drums or ticking
        root0, _ = chord_notes(cfg['key'], *cfg['prog'][0])
        n = N; tt = np.arange(n) / SR
        drone = lp(saw(midi(root0 - 12), n, 500, m.rng), 600) * (0.7 + 0.3 * np.sin(2 * np.pi * 0.12 * tt)) * env(n, 1.2, 0.6)
        m.add(0, drone, gain=0.07)
        pad_layer(m, edges[:-1], {**cfg, 'prog': cfg['prog'][:-1]}, gain=0.10, bright0=900, bstep=180, att=0.7)
        for i in range(len(edges) - 1):
            a, b = edges[i], edges[i + 1]; root, notes = chord_notes(cfg['key'], *cfg['prog'][i]); last = i == len(edges) - 2
            if i >= 1 and not last:
                step = 0.25 if i < 3 else 0.125; t0 = a + 0.05; k = 0
                while t0 < b - 0.1:
                    nn = int(0.16 * SR); x = np.arange(nn) / SR
                    v = lp(saw(midi(notes[k % 2 * 2] + 12), nn, 1400, m.rng), 2200) * np.exp(-x * 18)
                    m.add(t0, v, pan=0.3 + 0.4 * (k % 2), gain=0.17 if k % 2 == 0 else 0.11); t0 += step; k += 1
            if last:
                pad_layer(m, edges[-2:], {**cfg, 'prog': [cfg['prog'][-1]]}, gain=0.13, bright0=1500)
        if cfg.get('taiko'):
            for c in cuts[:-1]:
                for j, d in enumerate((0.0, 0.33, 0.5)):
                    m.add(c + 0.9 + d, taiko(int(1.2 * SR), m.rng), pan=0.4 + 0.2 * j, gain=0.075)
        if cfg.get('ticking'):
            t0 = edges[1]
            while t0 < edges[-2]: m.add(t0, tick(int(0.05 * SR), m.rng), pan=0.6, wet=False, gain=0.05); t0 += 0.5
        if cfg.get('breath'):
            for c in cuts[:-1]: m.add(c + 0.6, breath(int(1.8 * SR), m.rng), pan=0.45, gain=0.10)
        hits(m, cuts, total, kind='taiko' if cfg.get('taiko') else 'boom', g=0.13 if cfg.get('taiko') else 0.12); ending_bells(m, edges, cfg, g=0.09); rv = 2.4
    elif st == 'heart':  # heartbeat under a glassy pad and a high bell motif
        pad_layer(m, edges, cfg, gain=0.12, bright0=2200, bstep=200, att=0.6)
        t0 = 0.3; bpm = 64
        while t0 < edges[-2]: m.add(t0, heartbeat(int(0.8 * SR), m.rng), wet=False, gain=0.34); t0 += 60 / bpm; bpm = min(bpm + 1.2, 84)
        for i in range(1, len(edges) - 2):
            a, b = edges[i], edges[i + 1]; root, notes = chord_notes(cfg['key'], *cfg['prog'][i])
            for j, nt in enumerate((notes[2] + 12, notes[3] + 12, notes[1] + 24)):
                m.add(a + 0.4 + j * 0.55, bell(midi(nt), int(2.5 * SR), 1.6), pan=0.3 + 0.2 * j, gain=0.06)
        hits(m, cuts, total, g=0.12); ending_bells(m, edges, cfg, g=0.09); rv = 3.0
    elif st == 'space':  # wide shimmering pads, sparse bells, a slow clock
        pad_layer(m, edges, cfg, gain=0.16, bright0=1700, bstep=150, att=1.1, rel=1.4, oct=12)
        pad_layer(m, edges, cfg, gain=0.07, bright0=600, bstep=60, att=1.5, rel=1.4, oct=-12)
        for i in range(len(edges) - 1):
            a, b = edges[i], edges[i + 1]; root, notes = chord_notes(cfg['key'], *cfg['prog'][i])
            for j in range(2):
                m.add(a + 0.6 + j * 1.3, bell(midi(notes[(i + j) % 4] + 24), int(3 * SR), 0.7), pan=0.15 + 0.7 * ((i + j) % 2), gain=0.07)
        if cfg.get('clock'):
            t0 = edges[1]
            while t0 < edges[-2]: m.add(t0, tick(int(0.04 * SR), m.rng, 1900), pan=0.55, wet=False, gain=0.06); t0 += 1.0
        hits(m, cuts, total, g=0.13, whoosh_g=0.06); ending_bells(m, edges, cfg, g=0.1); rv = 4.5
    # a faint, swelling air band so the mix isn't dull
    tt = np.arange(N) / N
    m.add(0, bp(m.rng.standard_normal(N), 5000, 13000) * (0.006 + 0.014 * tt), gain=1.0)
    m.add(0, bp(m.rng.standard_normal(N), 5000, 13000) * (0.006 + 0.014 * tt), pan=1.0, gain=0.7)
    mix = m.wet * 0.8 + reverb(m.wet, rv, m.rng) * 0.55 + m.dry
    mix = hp(mix, 38); mix = mix + 0.35 * bp(mix, 700, 4000)
    fi, fo = int(0.06 * SR), int(0.6 * SR)
    mix[:, :fi] *= np.linspace(0, 1, fi); mix[:, -fo:] *= np.linspace(1, 0, fo) ** 1.5
    return np.tanh(mix / (np.max(np.abs(mix)) + 1e-9) * 1.3) * 0.9, total


def write(mix, path):
    raw = path.replace('.wav', '-raw.wav')
    with wave.open(raw, 'wb') as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes((np.clip(mix.T, -1, 1) * 32767).astype('<i2').tobytes())
    subprocess.run(['ffmpeg', '-y', '-v', 'error', '-i', raw, '-af', 'loudnorm=I=-16:TP=-1.5:LRA=9', '-ar', '48000', path], check=True)
    os.remove(raw)
