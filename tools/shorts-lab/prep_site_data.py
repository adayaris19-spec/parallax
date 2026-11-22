# Fetch only the data the Moon base shot needs, so a fresh machine is ready in about a minute instead of downloading 2.4 GB.
# usage: python prep_site_data.py OUT_DIR
import os, sys, subprocess, numpy as np
OUT = sys.argv[1]; HERE = os.path.dirname(os.path.abspath(__file__)); CX, CY = -11.52, -12.44          # the summit of the Connecting Ridge; the windows below reach 5 km and 33 km around it
PDS = "https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/polar/img/"
N3D = "https://raw.githubusercontent.com/nasa/NASA-3D-Resources/master/3D%20Models/"
NAIF = "https://naif.jpl.nasa.gov/pub/naif/generic_kernels/"
def curl(url, out, rng=None):
    if os.path.exists(out) and os.path.getsize(out) > 0: return
    subprocess.run(["curl", "-sS", "-f", "-L", "--retry", "4", "--max-time", "1500", "-o", out] + (["-r", rng] if rng else []) + [url], check=True)
def window(name, n, step, half, out):
    """download only the rows of a LOLA grid that cover the site, then keep the columns that do"""
    if os.path.exists(out): return
    c = (n - 1) / 2; c0, c1 = int(round((CX - half) / step + c)), int(round((CX + half) / step + c)); r0, r1 = int(round((CY - half) / step + c)), int(round((CY + half) / step + c))
    R0, R1 = n - r1, n - r0; tmp = out + ".part"; curl(PDS + name, tmp, f"{R0 * n * 2}-{R1 * n * 2 - 1}")
    a = np.fromfile(tmp, "<i2").reshape(R1 - R0, n)[:, c0:c1].copy(); os.remove(tmp); np.savez_compressed(out, a=a, r_off=R0, c_off=c0); print(name, a.shape, flush=True)
def strip(name, n, step, x0, x1, y0, y1, out):
    """the same for a box given in map km: used for the long strip an orbiting camera looks along"""
    if os.path.exists(out): return
    c = (n - 1) / 2; c0, c1 = int(round(x0 / step + c)), int(round(x1 / step + c)); r0, r1 = int(round(y0 / step + c)), int(round(y1 / step + c)); R0, R1 = n - r1, n - r0; tmp = out + ".part"; curl(PDS + name, tmp, f"{R0 * n * 2}-{R1 * n * 2 - 1}")
    a = np.fromfile(tmp, "<i2").reshape(R1 - R0, n)[:, c0:c1].copy(); os.remove(tmp); np.savez_compressed(out, a=a, r_off=R0, c_off=c0); print(name, a.shape, flush=True)
for d in ("", "spice", "models_plain", "earthglobal", "tmp"): os.makedirs(f"{OUT}/{d}", exist_ok=True)
window("ldem_875s_5m.img", 30336, 0.005, 5.2, f"{OUT}/dem5.npz"); window("ldem_80s_40m.img", 15200, 0.04, 33.0, f"{OUT}/dem40.npz"); window("ldem_80s_20m.img", 30400, 0.02, 33.0, f"{OUT}/dem20.npz")
strip("ldem_80s_40m.img", 15200, 0.04, -48.0, 38.0, -115.0, 24.0, f"{OUT}/dem40s.npz")       # for the orbiter shot (lro_pass.py)
if not os.path.exists(f"{OUT}/dem80.npz"):
    curl(PDS + "ldem_80s_80m.img", f"{OUT}/tmp/d80.img"); a = np.fromfile(f"{OUT}/tmp/d80.img", "<i2").reshape(7600, 7600); np.savez_compressed(f"{OUT}/dem80.npz", a=a, r_off=0, c_off=0); os.remove(f"{OUT}/tmp/d80.img")
curl("https://svs.gsfc.nasa.gov/vis/a000000/a004800/a004851/starmap_2020_8k.exr", f"{OUT}/starmap_2020_8k.exr")          # NASA SVS Deep Star Maps 2020, for night shots
for k, u in (("de421.bsp", "spk/planets/a_old_versions/de421.bsp"), ("moon_pa_de421_1900-2050.bpc", "pck/moon_pa_de421_1900-2050.bpc"), ("moon_080317.tf", "fk/satellites/moon_080317.tf"), ("pck00008.tpc", "pck/a_old_versions/pck00008.tpc")): curl(NAIF + u, f"{OUT}/spice/{k}")
for k, u in (("sev", "Space%20Exploration%20Vehicle/Space%20Exploration%20Vehicle.glb"), ("z2", "Z2%20Spacesuit/Z2%20Spacesuit.glb"), ("hdu1", "Habitat%20Demonstration%20Unit/Habitat%20Demonstration%20Unit%20(part%201).glb"),
             ("rassor", "Regolith%20Advanced%20Surface%20Systems%20Operations%20Robot%20(RASSOR)/Regolith%20Advanced%20Surface%20Systems%20Operations%20Robot%20(RASSOR).glb"),
             ("lro_a", "Lunar%20Reconnaissance%20Orbiter%20(A)/Lunar%20Reconnaissance%20Orbiter%20(A).glb")):
    if not os.path.exists(f"{OUT}/models_plain/{k}.glb"): curl(N3D + u, f"{OUT}/tmp/{k}.glb"); subprocess.run([sys.executable, f"{HERE}/undraco.py", f"{OUT}/tmp/{k}.glb", f"{OUT}/models_plain/{k}.glb"], check=True); os.remove(f"{OUT}/tmp/{k}.glb")
for day in ("2026-09-06", "2026-04-22", "2026-04-24", "2026-10-16"):           # Earth's real clouds on the days the shots show
    if not os.path.exists(f"{OUT}/earthglobal/earth_{day}.png"): subprocess.run([sys.executable, f"{HERE}/gibs_fetch.py", day, "3", "-180", "180", "-90", "90", f"{OUT}/tmp", f"{OUT}/earthglobal/earth_{day}.png"], check=True)
for day in ("2026-10-14", "2026-10-16", "2026-09-07", "2026-03-27"):                         # the same for close views of Earth: both satellites joined (earth_day.py)
    if not os.path.exists(f"{OUT}/earthglobal/earthx_{day}.png"): subprocess.run([sys.executable, f"{HERE}/earth_day.py", day, f"{OUT}/tmp", f"{OUT}/earthglobal/earthx_{day}.png"], check=True)
os.makedirs(f"{OUT}/moonkit", exist_ok=True)                                   # NASA SVS CGI Moon Kit: the whole Moon's colour (LRO camera mosaic) and relief (LOLA, 16 samples per degree)
for f in ("lroc_color_poles_16k.tif", "lroc_color_poles_8k.tif", "ldem_16.tif"):
    if not os.path.exists(f"{OUT}/moonkit/{f}"): curl("https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/" + f, f"{OUT}/moonkit/{f}")
subprocess.run(["rm", "-rf", f"{OUT}/tmp"]); print("ready", flush=True)
