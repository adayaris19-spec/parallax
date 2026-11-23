# Free AI realism test: sends frames of our own render through public demos of open models on Hugging Face
# (Qwen-Image-Edit to make a frame look photographed, Wan 2.2 to turn a frame into moving video).
# usage: python ai_pass.py REQUEST.json CLIP.mp4 OUT_DIR      needs HF_TOKEN in the environment (a free account's token)
#   A request may also name "images": pictures fetched from a public address (for example NASA's own renderings) and cut to a
#   vertical frame, to be used as the first frame of a video. CLIP.mp4 may be "-" when the request takes no frames from a render.
import os, sys, json, time, shutil, subprocess
from gradio_client import Client, handle_file
req = json.load(open(sys.argv[1])); clip, out = sys.argv[2], sys.argv[3]; os.makedirs(out, exist_ok=True); tok = os.environ.get("HF_TOKEN") or None
report = {"token_present": bool(tok), "secret_named_HF_TOKEN": os.environ.get("HAS_HF_TOKEN"), "secret_under_another_name": os.environ.get("HAS_OTHER_NAME"), "saved_as_variable_not_secret": os.environ.get("HAS_AS_VARIABLE"), "steps": []}; files = {}
if tok:                                                  # is the token accepted, and is the account a paying one? (nothing that names the account is kept or printed)
    try:
        import urllib.request
        w = json.load(urllib.request.urlopen(urllib.request.Request("https://huggingface.co/api/whoami-v2", headers={"Authorization": f"Bearer {tok}"}), timeout=30)); report["token_valid"] = True; report["account_pro"] = bool(w.get("isPro"))
    except Exception as e: report["token_valid"] = False; report["token_error"] = type(e).__name__
print(json.dumps({k: v for k, v in report.items() if k != "steps"}), flush=True)
def client(space):
    try: return Client(space, token=tok, verbose=False)
    except TypeError: return Client(space, hf_token=tok, verbose=False)
for im in req.get("images", []):                         # a 9:16 column of the picture, starting x0 pixels from its left edge
    raw = f"{out}/{im['name']}_src"; subprocess.run(["curl", "-sS", "-L", "-m", "120", "-A", "Mozilla/5.0", "-o", raw, im["url"]], check=True); p = f"{out}/{im['name']}.jpg"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", raw, "-vf", f"crop=ih*9/16:ih:{int(im.get('x0', 0))}:0,scale={int(im.get('w', 832))}:{int(im.get('h', 1472))}:flags=lanczos", "-frames:v", "1", "-q:v", "2", p], check=True); os.remove(raw); files[im["name"]] = p
for n in req.get("frames", []):
    p = f"{out}/frame{n}.jpg"; subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", clip, "-vf", f"select=eq(n\\,{int(n)}),scale=720:1280:flags=lanczos", "-frames:v", "1", "-q:v", "2", p], check=True); files[f"frame{n}"] = p
for st in req["steps"]:
    t0 = time.time(); rec = {"name": st["name"], "kind": st["kind"], "space": st["space"], "input": st["input"]}
    try:
        src = files[st["input"]]; c = client(st["space"])
        if st["kind"] == "edit":
            r = c.predict(images=[{"image": handle_file(src), "caption": None}], prompt=st["prompt"], seed=int(st.get("seed", 1)), randomize_seed=False, true_guidance_scale=1.0,
                          num_inference_steps=int(st.get("steps", 4)), height=int(st.get("height", 256)), width=int(st.get("width", 256)), rewrite_prompt=False, api_name="/infer")
            g = r[0][0]; p = g.get("image", g) if isinstance(g, dict) else g; p = p.get("path") if isinstance(p, dict) else p
            dst = f"{out}/{st['name']}{os.path.splitext(p)[1] or '.png'}"; shutil.copy(p, dst)
        elif st["kind"] == "flf":                       # first and last frame both come from our render; the model fills in the motion between them
            r = c.predict(gallery_images=[{"image": handle_file(src), "caption": None}, {"image": handle_file(files[st["last"]]), "caption": None}], mode="First - Last Frame", prompt=st["prompt"],
                          height=int(st.get("height", 832)), width=int(st.get("width", 480)), duration_seconds=float(st.get("seconds", 5)), guidance_scale=1.0, steps=int(st.get("steps", 6)),
                          seed=int(st.get("seed", 7)), randomize_seed=False, remove_bg=False, api_name="/generate_video")
            v = r[0]; v = v.get("video", v) if isinstance(v, dict) else v; dst = f"{out}/{st['name']}.mp4"; shutil.copy(v, dst)
        elif st["kind"] == "ltx":                       # LTX-2.5's own demo: a first frame and a prompt
            r = c.predict(prompt=st["prompt"], image_path=handle_file(src), height=int(st.get("height", 1472)), width=int(st.get("width", 832)), duration_s=float(st.get("seconds", 2)), seed=int(st.get("seed", 7)),
                          decoder="conv", auto_len=False, randomize_seed=False, do_enhance=False, api_name="/run")
            v = r[0]; v = v.get("video", v) if isinstance(v, dict) else v; dst = f"{out}/{st['name']}.mp4"; shutil.copy(v, dst)
        else:
            r = c.predict(input_image=handle_file(src), prompt=st["prompt"], steps=int(st.get("steps", 6)), duration_seconds=float(st.get("seconds", 5)), guidance_scale=1, guidance_scale_2=1,
                          seed=int(st.get("seed", 7)), randomize_seed=False, api_name="/generate_video")
            v = r[0]; v = v.get("video", v) if isinstance(v, dict) else v; dst = f"{out}/{st['name']}.mp4"; shutil.copy(v, dst)
        files[st["name"]] = dst; rec.update(ok=True, file=os.path.basename(dst))
    except Exception as e:
        rec.update(ok=False, error=repr(e)[:700])
    rec["seconds"] = round(time.time() - t0, 1); report["steps"].append(rec); print(json.dumps(rec), flush=True)
json.dump(report, open(f"{out}/report.json", "w"), indent=1)
