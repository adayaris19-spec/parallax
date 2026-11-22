# The explainer layer over a rendered shot: place labels that stay on their place as the camera moves, a tag on the
# spacecraft, and a card naming the source of the fact. Text is drawn at twice the frame size and scaled down so edges stay clean.
# usage: python explain.py CLIP.mp4 LABELS_DIR SPEC.json OUT.mp4      (LABELS_DIR may be "-" when the spec has no place labels)
#   LABELS_DIR holds labels_NNNN.json per frame (written by the shot script: where each named point is on screen)
import os, sys, json, subprocess
from PIL import Image, ImageDraw, ImageFont, ImageFilter
clip, labdir, spec, out = sys.argv[1], sys.argv[2], json.load(open(sys.argv[3])), sys.argv[4]; W, H, FPS, S = 1080, 1920, 24, 2
FONT = "/usr/share/fonts/opentype/inter/"; font = lambda name, px: ImageFont.truetype(FONT + name + ".otf", int(px * S))
ACC = tuple(int(spec.get("accent", "9AA2FF")[i:i + 2], 16) for i in (0, 2, 4)); ease = lambda x: max(0.0, min(1.0, x)) ** 2 * (3 - 2 * max(0.0, min(1.0, x)))
work = os.path.splitext(out)[0] + "_x"; os.makedirs(work, exist_ok=True)
subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", clip, f"{work}/in_%04d.png"], check=True); n = len([f for f in os.listdir(work) if f.startswith("in_")])
def spaced(d, xy, text, f, fill, track=0.0):
    x, y = xy
    for ch in text: d.text((x, y), ch, font=f, fill=fill); x += d.textlength(ch, font=f) + track * f.size
    return x
def width(d, text, f, track=0.0): return sum(d.textlength(ch, font=f) + track * f.size for ch in text)
def wrap(d, text, f, maxw):
    lines, cur = [], ""
    for w in text.split():
        t = (cur + " " + w).strip()
        if d.textlength(t, font=f) <= maxw or not cur: cur = t
        else: lines.append(cur); cur = w
    return lines + [cur]
for i in range(n):
    t = i / FPS; P = json.load(open(f"{labdir}/labels_{i:04d}.json")) if labdir != "-" else {}; lay = Image.new("RGBA", (W * S, H * S), (0, 0, 0, 0)); d = ImageDraw.Draw(lay)
    for lb in spec.get("labels", []):                                         # a ring on the place, a thin line up, the name
        a = ease((t - lb["in"]) / 0.35)
        if a <= 0: continue
        x, y = P[lb["key"]][0] * W * S, P[lb["key"]][1] * H * S; r = 9 * S; up = lb.get("up", 120) * S * a; f = font("InterDisplay-Medium", lb.get("size", 30)); A = int(255 * a)
        sg = 1 if up >= 0 else -1                                             # a negative "up" hangs the name below the place
        d.ellipse((x - r, y - r, x + r, y + r), outline=(255, 255, 255, A), width=int(2.2 * S)); d.ellipse((x - 2 * S, y - 2 * S, x + 2 * S, y + 2 * S), fill=(255, 255, 255, A)); d.line((x, y - sg * r, x, y - sg * r - up), fill=(255, 255, 255, int(200 * a)), width=int(1.6 * S))
        tw = d.textlength(lb["text"], font=f); tx = x - tw / 2 if lb.get("align", "center") == "center" else (x + 10 * S if lb["align"] == "left" else x - tw - 10 * S); d.text((tx, y - sg * r - up - (f.size * 1.25 if sg > 0 else -f.size * 0.15)), lb["text"], font=f, fill=(255, 255, 255, A))
    tg = spec.get("tag")
    if tg:                                                                    # the spacecraft's name, riding above it
        a = ease((t - tg["in"]) / 0.35)
        if a > 0:
            cx, cy, dist = P[tg["key"]]; x = cx * W * S + tg.get("dx", 0) * S; y = cy * H * S - tg.get("rise", 4.9) / dist * 3200 * S * (H / 1920) - 30 * S; f1 = font("InterDisplay-SemiBold", 32); f2 = font("Inter-Medium", 22); A = int(255 * a)
            w1 = d.textlength(tg["text"], font=f1); x = min(max(x, 60 * S + w1 / 2), (W - 60) * S - w1 / 2); d.text((x - w1 / 2, y - f1.size * 2.1), tg["text"], font=f1, fill=(255, 255, 255, A)); w2 = width(d, tg["sub"], f2, 0.12); spaced(d, (x - w2 / 2, y - f1.size * 0.85), tg["sub"], f2, (*ACC, A), 0.12)
    c = spec.get("card")
    if c:                                                                     # the source of the fact: a bar in the app's accent colour, a small heading, the title, who and where
        a = ease((t - c["in"]) / 0.45)
        if a > 0:
            x0 = (c["x"] - 26 * (1 - a)) * S; y0 = c["y"] * S; A = int(255 * a); fk = font("Inter-SemiBold", c.get("kicker_size", 21)); ft = font("InterDisplay-Medium", c.get("size", 31)); fm = font("Inter-Medium", 23); lines = wrap(d, c["title"], ft, c["w"] * S)
            hh = fk.size * 1.9 + len(lines) * ft.size * 1.24 + fm.size * 1.9; d.rectangle((x0, y0, x0 + 4 * S, y0 + hh * a), fill=(*ACC, A)); x1 = x0 + 22 * S; y = y0 - 2 * S
            spaced(d, (x1, y), c["kicker"], fk, (*ACC, A), c.get("kicker_track", 0.14)); y += fk.size * 1.9
            for ln in lines: d.text((x1, y), ln, font=ft, fill=(255, 255, 255, A)); y += ft.size * 1.24
            d.text((x1, y + fm.size * 0.35), c["meta"], font=fm, fill=(200, 204, 214, A))
    for cn in spec.get("counters", []):                                       # a number that runs: thin figures, a small unit beside them, one line under
        tc_ = t + spec.get("t_offset", 0.0); a = ease((tc_ - cn.get("in", cn["t0"])) / 0.3)
        if a <= 0: continue
        k = max(0.0, min(1.0, (tc_ - cn["t0"]) / max(cn["t1"] - cn["t0"], 1e-6))); k = 1 - (1 - k) ** 3; val = cn["from"] + (cn["to"] - cn["from"]) * k; txt = ("%d" % round(abs(val))); txt = ("\u2212" + txt) if val < -0.5 else txt
        fn = font("Inter-ExtraLight", cn.get("size", 170)); fu = font("InterDisplay-Medium", cn.get("size", 170) * 0.25); fl = font("Inter-Medium", 24); A = int(255 * a); x, y = cn["x"] * S, cn["y"] * S
        wmax = d.textlength("\u2212888" if cn["to"] < 0 or cn["from"] < 0 else "888", font=fn); wt = d.textlength(txt, font=fn); d.text((x + wmax - wt, y), txt, font=fn, fill=(255, 255, 255, A))      # right-aligned so the figures do not jump
        d.text((x + wmax + 14 * S, y + fn.size * 0.60), cn.get("unit", ""), font=fu, fill=(255, 255, 255, A))
        if cn.get("label"): spaced(d, (x + 6 * S, y + fn.size * 1.10), cn["label"], fl, (*ACC, A), 0.10)
    ch = spec.get("chart")
    if ch:                                                                    # one year of sunlight at one place as a strip: gold where the Sun is up, dark where it is not
        a = ease((t - ch["in"]) / 0.4)
        if a > 0:
            import json as _j
            fr_ = _j.load(open(os.path.join(os.path.dirname(os.path.abspath(sys.argv[3])), ch["data"])))["frac"]; x0, y0, w, h = ch["x"] * S, ch["y"] * S, ch["w"] * S, ch["h"] * S; A = int(255 * a); ft = font("InterDisplay-Medium", 31); fc = font("Inter-Medium", 20); fm_ = font("Inter-Medium", 19)
            reveal = max(0.0, min(1.0, (t - ch["in"]) / ch.get("wipe", 1.3))); n_ = len(fr_)
            for line_i, ln in enumerate(wrap(d, ch["title"], ft, w)): d.text((x0, y0 - ft.size * 1.3 * (len(wrap(d, ch["title"], ft, w)) - line_i) - 12 * S), ln, font=ft, fill=(255, 255, 255, A))
            cols = int(w * reveal)
            for cx in range(0, cols, S):
                i0 = int(cx / w * n_); i1 = max(i0 + 1, int((cx + S) / w * n_)); v = sum(fr_[i0:i1]) / (i1 - i0); v = v ** 0.6
                d.rectangle((x0 + cx, y0, x0 + cx + S, y0 + h), fill=(int(16 + (255 - 16) * v), int(22 + (198 - 22) * v), int(44 + (96 - 44) * v), A))
            d.rectangle((x0, y0, x0 + w, y0 + h), outline=(255, 255, 255, int(70 * a)), width=S)
            for m_i, m_ in enumerate("JFMAMJJASOND"): d.text((x0 + (m_i + 0.5) / 12 * w - d.textlength(m_, font=fm_) / 2, y0 + h + 8 * S), m_, font=fm_, fill=(200, 204, 214, A))
            d.text((x0, y0 + h + 44 * S), ch["caption"], font=fc, fill=(170, 176, 190, A))
            if ch.get("key"): 
                kx = x0; ky = y0 + h + 84 * S
                for col_, lab_ in (((255, 198, 96), ch["key"][0]), ((16, 22, 44), ch["key"][1])):
                    d.rectangle((kx, ky + 4 * S, kx + 22 * S, ky + 22 * S), fill=(*col_, A), outline=(255, 255, 255, int(90 * a))); d.text((kx + 32 * S, ky), lab_, font=fc, fill=(220, 224, 232, A)); kx += (32 + 26) * S + d.textlength(lab_, font=fc)
    lay = lay.resize((W, H), Image.LANCZOS); al = lay.split()[3]; sh = Image.new("RGBA", (W, H), (0, 0, 0, 0)); sh.putalpha(al.filter(ImageFilter.GaussianBlur(5)).point(lambda v: int(v * 0.75)))          # a soft dark edge so text holds on bright ground
    base = Image.open(f"{work}/in_{i + 1:04d}.png").convert("RGBA")
    if spec.get("dim"):                                                       # the picture steps back while a chart is read
        dm = Image.new("RGBA", (W, H), (0, 0, 0, int(255 * spec["dim"] * ease((t - spec.get("dim_in", 0.0)) / 0.4)))); base = Image.alpha_composite(base, dm)
    base = Image.alpha_composite(Image.alpha_composite(base, sh), lay); base.convert("RGB").save(f"{work}/out_{i:04d}.png")
subprocess.run(["ffmpeg", "-v", "error", "-y", "-framerate", str(FPS), "-i", f"{work}/out_%04d.png", "-c:v", "libx264", "-crf", "8", "-preset", "medium", "-pix_fmt", "yuv420p", out], check=True); print("wrote", out, n, "frames")
