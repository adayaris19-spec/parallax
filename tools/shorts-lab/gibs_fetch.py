# Fetch one day of NASA GIBS true-colour imagery (VIIRS, public domain) for a lat/lon box and stitch it.
# env GIBS_SAT: NOAA20 (default) or SNPP, the two satellites that carry the instrument about 50 minutes apart.
import sys, os, math, subprocess, numpy as np, cv2
from concurrent.futures import ThreadPoolExecutor
date, z, lon0, lon1, lat0, lat1, tdir, out = sys.argv[1], int(sys.argv[2]), float(sys.argv[3]), float(sys.argv[4]), float(sys.argv[5]), float(sys.argv[6]), sys.argv[7], sys.argv[8]
span = 288.0 / 2 ** z
c0, c1 = int((lon0 + 180) // span), int(math.ceil((lon1 + 180) / span)); r0, r1 = int((90 - lat1) // span), int(math.ceil((90 - lat0) / span))
SAT = os.environ.get("GIBS_SAT", "NOAA20"); base = f"https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/VIIRS_{SAT}_CorrectedReflectance_TrueColor/default/{date}/250m/{z}"
def get(rc):
    r, c = rc; p = f"{tdir}/{SAT}_{date}_{z}_{r}_{c}.jpg"
    if not (os.path.exists(p) and os.path.getsize(p) > 500):
        for _ in range(4):
            if subprocess.run(["curl", "-sS", "-m", "60", "-o", p, f"{base}/{r}/{c}.jpg"]).returncode == 0 and os.path.getsize(p) > 500: break
    return r, c, p
jobs = [(r, c) for r in range(r0, r1) for c in range(c0, c1)]
with ThreadPoolExecutor(8) as ex: res = list(ex.map(get, jobs))
M = np.zeros(((r1 - r0) * 512, (c1 - c0) * 512, 3), np.uint8); bad = 0
for r, c, p in res:
    t = cv2.imread(p)
    if t is None or t.shape[0] != 512: bad += 1; continue
    M[(r - r0) * 512:(r - r0 + 1) * 512, (c - c0) * 512:(c - c0 + 1) * 512] = t
cv2.imwrite(out, M, [cv2.IMWRITE_PNG_COMPRESSION, 1])
print("tiles", len(jobs), "bad", bad, "image", M.shape, "bounds lon", c0 * span - 180, c1 * span - 180, "lat", 90 - r1 * span, 90 - r0 * span)
