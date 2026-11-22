# Fetch only the data the Moon base shot needs, so a fresh machine is ready in about a minute instead of downloading 2.4 GB.
# usage: python prep_site_data.py OUT_DIR
import os, sys, subprocess, numpy as np
OUT = sys.argv[1]; HERE = os.path.dirname(os.path.abspath(__file__)); CX, CY = -11.82, -12.54
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
for d in ("", "spice", "models_plain", "earthglobal", "tmp"): os.makedirs(f"{OUT}/{d}", exist_ok=True)
window("ldem_875s_5m.img", 30336, 0.005, 5.2, f"{OUT}/dem5.npz"); window("ldem_80s_40m.img", 15200, 0.04, 33.0, f"{OUT}/dem40.npz")
if not os.path.exists(f"{OUT}/dem80.npz"):
    curl(PDS + "ldem_80s_80m.img", f"{OUT}/tmp/d80.img"); a = np.fromfile(f"{OUT}/tmp/d80.img", "<i2").reshape(7600, 7600); np.savez_compressed(f"{OUT}/dem80.npz", a=a, r_off=0, c_off=0); os.remove(f"{OUT}/tmp/d80.img")
for k, u in (("de421.bsp", "spk/planets/a_old_versions/de421.bsp"), ("moon_pa_de421_1900-2050.bpc", "pck/moon_pa_de421_1900-2050.bpc"), ("moon_080317.tf", "fk/satellites/moon_080317.tf"), ("pck00008.tpc", "pck/a_old_versions/pck00008.tpc")): curl(NAIF + u, f"{OUT}/spice/{k}")
for k, u in (("sev", "Space%20Exploration%20Vehicle/Space%20Exploration%20Vehicle.glb"), ("z2", "Z2%20Spacesuit/Z2%20Spacesuit.glb"), ("hdu1", "Habitat%20Demonstration%20Unit/Habitat%20Demonstration%20Unit%20(part%201).glb"),
             ("rassor", "Regolith%20Advanced%20Surface%20Systems%20Operations%20Robot%20(RASSOR)/Regolith%20Advanced%20Surface%20Systems%20Operations%20Robot%20(RASSOR).glb")):
    if not os.path.exists(f"{OUT}/models_plain/{k}.glb"): curl(N3D + u, f"{OUT}/tmp/{k}.glb"); subprocess.run([sys.executable, f"{HERE}/undraco.py", f"{OUT}/tmp/{k}.glb", f"{OUT}/models_plain/{k}.glb"], check=True); os.remove(f"{OUT}/tmp/{k}.glb")
if not os.path.exists(f"{OUT}/earthglobal/earth_2026-09-06.png"): subprocess.run([sys.executable, f"{HERE}/gibs_fetch.py", "2026-09-06", "3", "-180", "180", "-90", "90", f"{OUT}/tmp", f"{OUT}/earthglobal/earth_2026-09-06.png"], check=True)
subprocess.run(["rm", "-rf", f"{OUT}/tmp"]); print("ready", flush=True)
