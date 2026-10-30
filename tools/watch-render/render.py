# Render Watch videos like the Instagram Reels: continuous footage, crossfades, baked-in text and an
# original score timed to the joins. Usage: python3 render.py <reel id>... | all [--part=i/n] [--no-upload]
# 'all' renders every reel without a current render (see README.md).
import json, os, re, subprocess, sys, math, shutil
# Work files go in WATCH_RENDER_DIR (default: next to this script). Keys come from files named by
# PARALLAX_ANON_FILE and PARALLAX_ADMIN_FILE (never committed); the Management API call needs the
# environment's Supabase access (the session proxy provides it).
CODE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, CODE)
WR = os.environ.get('WATCH_RENDER_DIR', CODE)
for d in ('clips', 'ov', 'out', 'final', 'anim'): os.makedirs(f'{WR}/{d}', exist_ok=True)
import score3
ANON = open(os.environ['PARALLAX_ANON_FILE']).read().strip(); ADMIN = open(os.environ['PARALLAX_ADMIN_FILE']).read().strip()
FN = 'https://zfmjjazkmolvywvayjzj.supabase.co/functions/v1/reels'
MGMT = 'https://api.supabase.com/v1/projects/zfmjjazkmolvywvayjzj/database/query'
W, H, FPS, X = 720, 1280, 30, 0.6
VERSION = 1
args = [a for a in sys.argv[1:] if not a.startswith('--')]
UPLOAD = '--no-upload' not in sys.argv

def sh(cmd, **kw): return subprocess.run(cmd, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, **kw)
def sql(q): return json.loads(sh(['curl', '-s', '-X', 'POST', MGMT, '-H', 'content-type: application/json', '-d', json.dumps({'query': q})]).stdout or '[]')
def hue(s):
    h = 0
    for c in str(s): h = (h * 31 + ord(c)) & 0xFFFFFFFF
    return h % 360

STAMP = re.compile(r'^(Myth|Fact|Setback|Missed|Update|Breaking|The catch|Next)\s*[:—–]\s*', re.I)
def layouts(scenes, seed):
    n = len(scenes); prev = ''; out = []
    for k, s in enumerate(scenes):
        cap = str(s.get('caption') or '').strip(); stat = s.get('stat')
        if s.get('layout') == 'quote': ly = 'mid'
        elif stat and stat.get('value'): ly = 'stat'
        elif k == 0: ly = 'top'
        elif STAMP.match(cap): ly = 'stamp'
        elif k == n - 1 and n >= 3: ly = 'end'
        elif cap.endswith('?'): ly = 'card'
        else:
            opts = [x for x in ('low', 'mid', 'card') if x != prev]; ly = opts[(seed + k) % len(opts)]
        if ly == prev and ly != 'stat': ly = 'mid' if ly == 'low' else 'low'
        prev = ly; out.append(ly)
    return out

def words(s): return len(re.sub(r'\s+', ' ', ' '.join(str(s.get(k) or '') for k in ('kicker', 'caption', 'sub'))).split())
def dur(s, i, n, ly):
    d = 1.6 + 0.2 * words(s)
    if ly == 'stat': d += 0.5
    if i == n - 1: d += 0.8
    return round(min(max(d, 3.4), 5.4), 2)

def fetch(url, dest):
    if os.path.exists(dest) and os.path.getsize(dest) > 2000: return dest
    m = re.search(r'r2\.dev/([a-z0-9-]+/[A-Za-z0-9._-]+\.(?:mp4|jpg))', url or '')
    if not m: return None
    sh(['curl', '-s', '-o', dest, '-X', 'POST', FN, '-H', f'Authorization: Bearer {ANON}', '-H', f'x-parallax-admin: {ADMIN}', '-H', 'content-type: application/json', '-d', json.dumps({'action': 'file', 'path': m.group(1)})])
    return dest if os.path.exists(dest) and os.path.getsize(dest) > 2000 else None

STYLE = {  # mood -> score style (the same palettes as the Reels)
    'tense': dict(style='tension', ticking=True), 'uplifting': dict(style='ambient'), 'epic': dict(style='pulse', bpm=118, bright=0.9),
    'mysterious': dict(style='space', clock=False), 'bittersweet': dict(style='piano'), 'calm': dict(style='piano'),
}
PROGS = [[(0, 'm'), (8, 'M'), (3, 'M'), (10, 'M'), (5, 'm'), (0, 'm9'), (8, 'M'), (0, 'm')],
         [(0, 'm'), (5, 'm'), (8, 'M'), (7, 'M'), (3, 'M'), (0, 'm9'), (5, 'm'), (0, 'm')],
         [(8, 'M'), (10, 'M'), (0, 'm'), (3, 'M'), (5, 'm'), (0, 'm9'), (10, 'M'), (0, 'm')]]

def render(r):
    rid, slug = r['id'], r['slug']; scenes = r['scenes']; n = len(scenes)
    lays = layouts(scenes, hue(str(rid)))
    durs = [dur(s, i, n, lays[i]) for i, s in enumerate(scenes)]
    tag = f'{slug}-{rid}'
    # 1. footage for every scene
    media = []
    for i, s in enumerate(scenes):
        v = s.get('visual') or {}
        if v.get('kind') == 'video':
            f = fetch(v.get('url'), f"{WR}/clips/{re.sub(r'[^A-Za-z0-9.-]', '_', v['url'].split('r2.dev/')[-1])}")
            media.append(('video', f) if f else ('image', fetch(v.get('poster'), f"{WR}/clips/{re.sub(r'[^A-Za-z0-9.-]', '_', str(v.get('poster')).split('r2.dev/')[-1])}")))
        elif v.get('kind') == 'anim':
            kind = str(v.get('url', 'anim:dna')).split(':')[-1]; hh = (hue(slug + str(rid)) + 200) % 360
            f = f'{WR}/anim/{kind}-{hh}.webm'
            if not os.path.exists(f):
                os.makedirs(f'{WR}/anim', exist_ok=True)
                sh(['node', f'{CODE}/animrec.js', kind, str(hh), f])
            media.append(('video', f))
        else:
            media.append(('image', fetch(v.get('url') or v.get('poster'), f"{WR}/clips/{re.sub(r'[^A-Za-z0-9.-]', '_', str(v.get('url')).split('/')[-1])[:80]}")))
    # 2. text layers
    jobs = []
    for i, s in enumerate(scenes):
        s2 = dict(s); m = STAMP.match(str(s.get('caption') or ''))
        if lays[i] == 'stamp' and m: s2['stampWord'] = m.group(1); rest = s['caption'][m.end():]; s2['caption'] = rest[:1].upper() + rest[1:]
        for L in ('bg', 'A', 'B'): jobs.append([f'{WR}/ov/{tag}-{i}-{L}.png', {'s': s2, 'lay': lays[i], 'layer': L}])
    jf = f'{WR}/ov/{tag}.json'; json.dump(jobs, open(jf, 'w'))
    sh(['node', f'{CODE}/ov.js', jf])
    # 3. scenes with camera motion; the text arrives just after each crossfade
    segs = []
    for i, s in enumerate(scenes):
        D = durs[i] + (X if i < n - 1 else 0); kind, f = media[i]
        mo = ['zin', 'panr', 'zout', 'panl'][(hue(str(rid)) + i) % 4]
        cover = f'scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H}'
        if mo in ('zin', 'zout'):
            z = f'(1+0.09*t/{D})' if mo == 'zin' else f'(1.09-0.09*t/{D})'
            bg = f"{cover},scale=w='2*trunc({W}*{z}/2)':h=-2:eval=frame,crop={W}:{H}"
        else:
            sg = '+' if mo == 'panr' else '-'
            bg = f"scale={int(W*1.14)}:{int(H*1.14)}:force_original_aspect_ratio=increase,crop={W}:{H}:x='(iw-ow)/2{sg}(iw-ow)/2*0.8*(2*t/{D}-1)':y='(ih-oh)/2'"
        ta = 0.35 if i else 0.15; tb = ta + (0.75 if lays[i] == 'stat' else 0.9)
        vf = (f"[0:v]{bg},eq=brightness=-0.02:saturation=1.1:contrast=1.04,fps={FPS},setsar=1[v];"
              f"[1:v]scale={W}:{H},format=rgba[s];[2:v]scale={W}:{H},format=rgba,fade=in:st={ta}:d=0.5:alpha=1[a];[3:v]scale={W}:{H},format=rgba,fade=in:st={tb:.2f}:d=0.5:alpha=1[b];"
              f"[v][s]overlay=0:0[v1];[v1][a]overlay=x=0:y='max(0,18-18*min(1,max(0,(t-{ta})/0.5)))'[v2];[v2][b]overlay=x=0:y='max(0,12-12*min(1,max(0,(t-{tb:.2f})/0.5)))',format=yuv420p")
        out = f'{WR}/out/{tag}-{i}.mp4'; pre = f'{WR}/ov/{tag}-{i}-'
        src = ['-f', 'lavfi', '-i', f'color=c=0x07080d:s={W}x{H}:r={FPS}'] if not f else (['-ss', '0.4', '-stream_loop', '-1', '-i', f] if kind == 'video' else ['-loop', '1', '-i', f])
        sh(['ffmpeg', '-y', '-v', 'error', *src, '-loop', '1', '-i', pre + 'bg.png', '-loop', '1', '-i', pre + 'A.png', '-loop', '1', '-i', pre + 'B.png',
            '-t', f'{D:.2f}', '-filter_complex', vf, '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-r', str(FPS), out])
        segs.append((out, D))
    # 4. one continuous piece: crossfades between every scene
    inputs = []; [inputs.extend(['-i', p]) for p, _ in segs]
    fc = ''; prev = '[0:v]'; off = 0.0; starts = [0.0]
    for j in range(1, n):
        off += segs[j - 1][1] - X; starts.append(off); lab = f'[v{j}]'
        fc += f'{prev}[{j}:v]xfade=transition=fade:duration={X}:offset={off:.3f}{lab};'; prev = lab
    total = off + segs[-1][1]
    video = f'{WR}/out/{tag}-v.mp4'
    sh(['ffmpeg', '-y', '-v', 'error', *inputs, '-filter_complex', fc.rstrip(';') if fc else 'null', '-map', prev if fc else '0:v', '-an', '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', video])
    # 5. the score, timed to the crossfades
    cuts = [s0 + X / 2 for s0 in starts[1:]]
    cfg = dict(STYLE.get(r.get('mood') or '', STYLE['mysterious']))
    cfg['key'] = 48 + hue(str(rid) + slug) % 9; base = PROGS[hue(slug) % 3]; cfg['prog'] = [base[i % len(base)] for i in range(n)]
    mix, _ = score3.render(cuts, total, cfg, hue(str(rid)) or 7)
    wav = f'{WR}/out/{tag}.wav'; score3.write(mix, wav)
    final = f'{WR}/final/{tag}-v{VERSION}.mp4'
    sh(['ffmpeg', '-y', '-v', 'error', '-i', video, '-i', wav, '-map', '0:v', '-map', '1:a', '-c:v', 'libx264', '-preset', 'medium', '-crf', '24', '-maxrate', '2600k', '-bufsize', '5200k', '-c:a', 'aac', '-b:a', '128k', '-shortest', '-movflags', '+faststart', final])
    poster = final.replace('.mp4', '.jpg')
    sh(['ffmpeg', '-y', '-v', 'error', '-ss', '0.9', '-i', final, '-frames:v', '1', '-q:v', '4', poster])
    for p, _ in segs: os.remove(p)
    os.remove(video); os.remove(wav)
    info = {'dur': round(total, 2), 'bytes': os.path.getsize(final), 'scenes': n, 'starts': [round(x, 2) for x in starts]}
    if UPLOAD:
        urls = {}
        for p in (final, poster):
            name = 'renders/' + os.path.basename(p)
            res = json.loads(sh(['curl', '-s', '-X', 'POST', f'{FN}?upload={name}', '-H', f'Authorization: Bearer {ANON}', '-H', f'x-parallax-admin: {ADMIN}', '-H', 'content-type: application/octet-stream', '--data-binary', '@' + p]).stdout)
            if 'url' not in res: raise RuntimeError(f'upload failed: {res}')
            urls[p.rsplit('.', 1)[1]] = res['url']
        rec = {'url': urls['mp4'], 'poster': urls['jpg'], 'dur': info['dur'], 'starts': info['starts'], 'v': VERSION}
        sql(f"update reels set render = '{json.dumps(rec)}'::jsonb where id = {int(rid)}")
        info['url'] = urls['mp4']
    return info

if __name__ == '__main__':
    rows = sql("select r.id, g.slug, r.kind, r.mood, r.scenes, r.render from reels r join goals g on g.id = r.goal_id order by g.slug, r.id")
    part = next((x for x in sys.argv if x.startswith('--part=')), None)  # --part=i/n splits the goals between processes
    if args == ['all'] or not args:
        rows = [r for r in rows if not (r.get('render') or {}).get('v') == VERSION]
        if part:
            i, n = map(int, part.split('=')[1].split('/')); slugs = sorted({r['slug'] for r in rows}); mine = set(slugs[i::n])
            rows = [r for r in rows if r['slug'] in mine]
    else:
        rows = [r for r in rows if r['id'] in set(int(a) for a in args)]
    # delete each clip once no remaining video in this run needs it (keeps disk use small)
    need = {}
    for r in rows:
        for sc in r['scenes']:
            u = (sc.get('visual') or {}).get('url') or ''
            if 'r2.dev/' in u: need[u] = need.get(u, 0) + 1
    print('to render:', len(rows), flush=True)
    for r in rows:
        try:
            print('rendered', r['id'], r['slug'], json.dumps(render(r)), flush=True)
        except Exception as e:
            print('FAILED', r['id'], r['slug'], str(e)[:300], getattr(e, 'stderr', b'')[-400:] if hasattr(e, 'stderr') else '', flush=True)
        for sc in r['scenes']:
            u = (sc.get('visual') or {}).get('url') or ''
            if u in need:
                need[u] -= 1
                if need[u] <= 0:
                    for ext in ('', ):
                        f = f"{WR}/clips/{re.sub(r'[^A-Za-z0-9.-]', '_', u.split('r2.dev/')[-1])}"
                        if os.path.exists(f): os.remove(f)
