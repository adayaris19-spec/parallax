# Narrated Watch videos (v4): a free AI narrator (Kokoro, tts.py) reads the script, word-by-word captions follow
# the voice, footage alternates with animated graphics (gfx.html: a study clipping, a counter, a timeline, a globe,
# a chart), and the score ducks under the voice. Two looks by goal: clean (space, energy, computing) and collage
# (health, climate, water, food: grain, warmer colour, paper). No clip is used twice across a goal's videos.
# Usage: python3 render4.py <reel id>... [--no-upload]. Needs: the files render.py needs, KOKORO_DIR with the voice
# model, KOKORO_PY (a Python with kokoro-onnx), and gfx.html's assets (three.module.min.js, moon/earth/mars.jpg) in
# WR/gfx served at GFX_URL (default http://localhost:8766/gfx.html).
import json, os, re, shutil, subprocess, sys
import numpy as np
from PIL import Image
CODE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, CODE)
import render as R, score3
W, H, FPS, X = R.W, R.H, 24, 0.5  # film rate; half-second joins
WR = R.WR; VERSION = 4
GFX_URL = os.environ.get('GFX_URL', 'http://localhost:8766/gfx.html')
KPY = os.environ.get('KOKORO_PY', sys.executable)
VOICE = os.environ.get('TTS_VOICE', 'am_michael')
CLEAN = {'mars', 'moon-base', 'fusion', 'grid-storage', 'solid-state-batteries', 'room-temperature-superconductors', 'useful-quantum-computing', 'brain-computer-interfaces'}
def look_for(slug): return 'clean' if slug in CLEAN else 'collage'
sh = R.sh

def shade():
    # A soft dark band behind the captions (lower middle) and at the top, so white text reads on any footage.
    f = f'{WR}/gfx/shade2.png'
    if not os.path.exists(f):
        y = np.linspace(0, 1, H)[:, None]
        a = np.clip(0.5 * np.clip((y - 0.62) / 0.2, 0, 1) ** 1.4 + 0.3 * np.clip(1 - y / 0.14, 0, 1), 0, 0.6)
        img = np.zeros((H, W, 4), np.uint8); img[..., 3] = (np.repeat(a, W, 1) * 255).astype(np.uint8)
        Image.fromarray(img, 'RGBA').save(f)
    return f

# ---------- captions (ASS, burned in with libass) ----------
def ass_time(t): t = max(0, t); return f'{int(t // 3600)}:{int(t % 3600 // 60):02d}:{t % 60:05.2f}'
def word_times(text, t0, dur):
    # Kokoro gives no timings, so each word gets time in proportion to its length, plus a beat after punctuation.
    ws = text.split(); wt = [len(re.sub(r'\W', '', w)) + 2 + (3 if re.search(r'[.,?!:;]$', w) else 0) for w in ws]
    tot = sum(wt) or 1; out = []; t = t0
    for w, k in zip(ws, wt): d = dur * k / tot; out.append((w, t, t + d)); t += d
    return out
def chunks(words):
    # Documentary subtitles: a phrase at a time (up to ~34 characters a line, two lines), breaking at punctuation.
    out, cur, n = [], [], 0
    for w in words:
        cur.append(w); n += len(w[0]) + 1
        if n >= 52 or (re.search(r'[.?!:;]$', w[0]) and n > 14) or (w[0].endswith(',') and n > 30): out.append(cur); cur, n = [], 0
    if cur: out.append(cur)
    return out
def wrap2(t):
    if len(t) <= 34: return t
    ws = t.split(); best = None
    for i in range(1, len(ws)):
        a, b = ' '.join(ws[:i]), ' '.join(ws[i:]); d = abs(len(a) - len(b))
        if best is None or d < best[0]: best = (d, a, b)
    return best[1] + '\\N' + best[2]
def ass_file(lines, path, look):
    head = f"""[Script Info]
ScriptType: v4.00+
PlayResX: {W}
PlayResY: {H}
WrapStyle: 2
[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Sub,Inter Display Medium,54,&H00F2F2F2,&H00F2F2F2,&H00000000,&H96000000,0,0,0,0,100,100,0.4,0,1,0,2.2,2,120,120,470,1
[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    ev = []
    for words in lines:
        for ch in chunks(words): ev.append([ch[0][1] - 0.05, ch[-1][2] + 0.35, wrap2(' '.join(x[0] for x in ch))])
    for a, b in zip(ev, ev[1:]): a[1] = min(a[1], b[0])
    open(path, 'w').write(head + '\n'.join(f'Dialogue: 0,{ass_time(a)},{ass_time(b)},Sub,,0,0,0,,{{\\fad(120,120)\\blur0.6}}{t}' for a, b, t in ev) + '\n')

# ---------- footage ----------
SCALE = {'space': 0, 'orbit': 1, 'aerial': 2, 'ground': 3, 'close': 4, 'macro': 5}
def footage(media, D, look, out, push, hook=False, over=None):
    # One shot per scene, held: the camera keeps moving the same way through every cut (pushing in for a journey
    # inward, easing out for one outward), a little harder on the hook. With a graphic, the footage dims and softens
    # underneath it and the graphic (transparent) sits on top.
    sk, sf = media
    z0, z1 = (1.0, 1.16 if hook else 1.10) if push == 'in' else (1.12, 1.0)
    ins = (['-f', 'lavfi', '-t', f'{D:.2f}', '-i', f'color=c=0x07080d:s={W}x{H}:r={FPS}'] if not sf else
           (['-ss', '0.40', '-stream_loop', '-1', '-t', f'{D:.2f}', '-i', sf] if sk == 'video' else ['-loop', '1', '-t', f'{D:.2f}', '-i', sf]))
    z = f'({z0}+{z1 - z0:.3f}*t/{D:.2f})'
    grade = ('eq=contrast=0.97:brightness=-0.015:saturation=0.88,colorbalance=rs=-0.03:gs=-0.01:bs=0.04:rh=0.03:bh=-0.03,curves=all=0/0.03 0.5/0.48 1/0.96,noise=alls=6:allf=t,vignette=PI/6'
             if look == 'clean' else
             'eq=contrast=0.97:brightness=-0.01:saturation=0.9,colorbalance=rs=0.04:gs=0.01:bs=-0.04:rh=0.04:bh=-0.04,curves=all=0/0.03 0.5/0.49 1/0.96,noise=alls=6:allf=t,vignette=PI/6')
    fc = (f"[0:v]scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},scale=w='2*trunc({W}*{z}/2)':h=-2:eval=frame,"
          f"crop={W}:{H},fps={FPS},setsar=1,trim=duration={D:.2f},setpts=PTS-STARTPTS,{grade}")
    extra = []
    if over:
        fc += ",eq=brightness=-0.2:saturation=0.7,gblur=sigma=6[v0];[2:v]format=rgba[g];[v0][g]overlay=0:0[v];"; extra = ['-i', over]
    else: fc += '[v];'
    fc += '[1:v]format=rgba[sh];[v][sh]overlay=0:0,format=yuv420p'
    sh(['ffmpeg', '-y', '-v', 'error', *ins, '-loop', '1', '-i', shade(), *extra, '-t', f'{D:.2f}', '-filter_complex', fc, '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '16', '-r', str(FPS), out])

def graphic(g, D, look, out, over=False):
    # A globe is its own picture; everything else is drawn transparent, to sit over the scene's footage.
    spec = f'{out}.json'; json.dump(g, open(spec, 'w'))
    raw = out.replace('.mp4', '.mov' if over else '-raw.mp4')
    sh(['node', f'{CODE}/gfxrec.js', GFX_URL, spec, f'{D:.2f}', look, raw, str(FPS), 'over' if over else 'full'])
    os.remove(spec)
    if over: return raw
    sh(['ffmpeg', '-y', '-v', 'error', '-i', raw, '-loop', '1', '-i', shade(), '-t', f'{D:.2f}', '-filter_complex', '[1:v]format=rgba[s];[0:v][s]overlay=0:0,format=yuv420p', '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '16', '-r', str(FPS), out])
    os.remove(raw)

def render(r):
    rid, slug = r['id'], r['slug']; scenes = r['scenes']; n = len(scenes); look = r.get('look') or look_for(slug)
    tag = f'{slug}-{rid}'; tmp = f'{WR}/out/{tag}'; os.makedirs(tmp, exist_ok=True)
    # 1. the voice
    lines = [str(s.get('say') or s.get('caption') or '').strip() for s in scenes]
    jf = f'{tmp}/lines.json'; json.dump(lines, open(jf, 'w'))
    lens = json.loads(sh([KPY, f'{CODE}/tts.py', jf, tmp, VOICE]).stdout.decode().strip().splitlines()[-1])
    lead = 0.12; durs = [round(max(L + 0.35, 2.4), 2) for L in lens]; durs[-1] += 1.0
    # 2. pictures: graphics where the script asks, footage elsewhere (every clip once per goal)
    media = []
    for s in scenes:
        v = s.get('visual') or {}
        f = R.fetch(v.get('url'), f"{WR}/clips/{re.sub(r'[^A-Za-z0-9.-]', '_', str(v.get('url')).split('r2.dev/')[-1])}") if v.get('kind') == 'video' else None
        media.append(('video', f) if f else ('image', None))
    sc_idx = [SCALE.get((s.get('visual') or {}).get('scale') or '', -1) for s in scenes]; known = [x for x in sc_idx if x >= 0]
    push = 'out' if len(known) >= 2 and known[-1] < known[0] else 'in'
    segs, used = [], [os.path.basename(m[1]) for m in media if m[1]]
    for i, s in enumerate(scenes):
        D = durs[i] + (X if i < n - 1 else 0); out = f'{tmp}/seg{i}.mp4'; g = s.get('graphic') if (s.get('graphic') or {}).get('type') else None
        if g and g['type'] == 'globe': graphic(g, D, look, out)
        else: footage(media[i], D, look, out, push, hook=i == 0, over=graphic(g, D, look, out, over=True) if g else None)
        segs.append((out, D))
    # 3. join: a zoom-through travelling inward, a dissolve otherwise
    inputs = []; [inputs.extend(['-i', p]) for p, _ in segs]
    fc = ''; prev = '[0:v]'; off = 0.0; starts = [0.0]; tr = 'zoomin' if push == 'in' else 'fade'
    for j in range(1, n):
        off += segs[j - 1][1] - X; starts.append(off); lab = f'[v{j}]'
        fc += f'{prev}[{j}:v]xfade=transition={tr}:duration={X}:offset={off:.3f}{lab};'; prev = lab
    total = off + segs[-1][1]
    # 4. captions timed to the voice
    cap = []
    for i, L in enumerate(lens): cap.append(word_times(lines[i], starts[i] + lead, L))
    ass = f'{tmp}/cap.ass'; ass_file(cap, ass, look)
    video = f'{tmp}/v.mp4'
    sh(['ffmpeg', '-y', '-v', 'error', *inputs, '-filter_complex', (fc + f'{prev}ass={ass}[out]') if fc else f'[0:v]ass={ass}[out]', '-map', '[out]', '-an', '-c:v', 'libx264', '-preset', 'medium', '-crf', '19', '-pix_fmt', 'yuv420p', video])
    # 5. sound: the voice on top, the score ducking under it
    vin, vfc = [], ''
    for i in range(n): vin += ['-i', f'{tmp}/{i}.wav']; vfc += f'[{i}:a]adelay={int((starts[i] + lead) * 1000)}:all=1[a{i}];'
    vfc += ''.join(f'[a{i}]' for i in range(n)) + f'amix=inputs={n}:normalize=0,apad=whole_dur={total:.2f},volume=1.6[vo]'
    voice = f'{tmp}/voice.wav'; sh(['ffmpeg', '-y', '-v', 'error', *vin, '-filter_complex', vfc, '-map', '[vo]', '-ar', '48000', '-ac', '2', voice])
    cfg = dict(R.STYLE.get(r.get('mood') or '', R.STYLE['mysterious'])); cfg['key'] = 48 + R.hue(str(rid) + slug) % 9
    base = R.PROGS[R.hue(slug) % 3]; cfg['prog'] = [base[i % len(base)] for i in range(n)]
    mix, _ = score3.render([s0 + X / 2 for s0 in starts[1:]], total, cfg, R.hue(str(rid)) or 7)  # an impact on the first frame and each join
    music = f'{tmp}/music.wav'; score3.write(mix, music)
    final = f'{WR}/final/{tag}-v{VERSION}.mp4'
    sh(['ffmpeg', '-y', '-v', 'error', '-i', video, '-i', music, '-i', voice, '-filter_complex',
        '[1:a]volume=0.42[m];[2:a]asplit[v1][v2];[m][v1]sidechaincompress=threshold=0.03:ratio=8:attack=15:release=350[d];[d][v2]amix=inputs=2:normalize=0,loudnorm=I=-15:TP=-1.5:LRA=11,aresample=48000[a]',
        '-map', '0:v', '-map', '[a]', '-c:v', 'libx264', '-preset', 'medium', '-crf', '21', '-maxrate', '6000k', '-bufsize', '12000k', '-c:a', 'aac', '-b:a', '160k', '-shortest', '-movflags', '+faststart', final])
    sh(['ffmpeg', '-y', '-v', 'error', '-ss', '0.9', '-i', final, '-frames:v', '1', '-q:v', '4', final.replace('.mp4', '.jpg')])
    shutil.rmtree(tmp, ignore_errors=True)
    return {'file': final, 'dur': round(total, 2), 'starts': [round(x, 2) for x in starts], 'look': look, 'clips': used}

if __name__ == '__main__':
    for rid in [a for a in sys.argv[1:] if not a.startswith('--')]:
        rows = R.sql(f"select r.id, g.slug, r.kind, r.title, r.mood, r.scenes from reels r join goals g on g.id = r.goal_id where r.id = {int(rid)}")
        print(rid, render(rows[0]), flush=True)
