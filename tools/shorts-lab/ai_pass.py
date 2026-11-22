# Free AI realism test: sends frames of our own render through public demos of open models on Hugging Face
# (Qwen-Image-Edit to make a frame look photographed, Wan 2.2 to turn a frame into moving video).
# usage: python ai_pass.py REQUEST.json CLIP.mp4 OUT_DIR      needs HF_TOKEN in the environment (a free account's token)
import os, sys, json, time, shutil, subprocess
from gradio_client import Client, handle_file
req = json.load(open(sys.argv[1])); clip, out = sys.argv[2], sys.argv[3]; os.makedirs(out, exist_ok=True); tok = os.environ.get("HF_TOKEN") or None
report = {"token_present": bool(tok), "steps": []}; files = {}
def client(space):
    try: return Client(space, token=tok, verbose=False)
    except TypeError: return Client(space, hf_token=tok, verbose=False)
for n in req["frames"]:
    p = f"{out}/frame{n}.jpg"; subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", clip, "-vf", f"select=eq(n\\,{int(n)}),scale=720:1280:flags=lanczos", "-frames:v", "1", "-q:v", "2", p], check=True); files[f"frame{n}"] = p
for st in req["steps"]:
    t0 = time.time(); rec = {"name": st["name"], "kind": st["kind"], "space": st["space"], "input": st["input"]}
    try:
        src = files[st["input"]]; c = client(st["space"])
        if st["kind"] == "edit":
            r = c.predict(images=[{"image": handle_file(src), "caption": None}], prompt=st["prompt"], seed=int(st.get("seed", 1)), randomize_seed=False, true_guidance_scale=1.0,
                          num_inference_steps=int(st.get("steps", 4)), height=int(st.get("height", 1344)), width=int(st.get("width", 768)), rewrite_prompt=False, api_name="/infer")
            g = r[0][0]; p = g.get("image", g) if isinstance(g, dict) else g; p = p.get("path") if isinstance(p, dict) else p
            dst = f"{out}/{st['name']}{os.path.splitext(p)[1] or '.png'}"; shutil.copy(p, dst)
        else:
            r = c.predict(input_image=handle_file(src), prompt=st["prompt"], steps=int(st.get("steps", 6)), duration_seconds=float(st.get("seconds", 5)), guidance_scale=1, guidance_scale_2=1,
                          seed=int(st.get("seed", 7)), randomize_seed=False, api_name="/generate_video")
            v = r[0]; v = v.get("video", v) if isinstance(v, dict) else v; dst = f"{out}/{st['name']}.mp4"; shutil.copy(v, dst)
        files[st["name"]] = dst; rec.update(ok=True, file=os.path.basename(dst))
    except Exception as e:
        rec.update(ok=False, error=repr(e)[:700])
    rec["seconds"] = round(time.time() - t0, 1); report["steps"].append(rec); print(json.dumps(rec), flush=True)
json.dump(report, open(f"{out}/report.json", "w"), indent=1)
