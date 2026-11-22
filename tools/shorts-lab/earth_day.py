# One day of Earth as a whole-globe picture for close views: NASA GIBS true colour from the two VIIRS satellites, joined.
# Each satellite's picture has bright streaks where the Sun glints off the sea under its track, and gaps between passes. The two fly
# about 50 minutes apart, so the darker of the two at each place drops the glint and one fills the other's gaps. The cap around
# a pole has no picture when the Sun is low there; where that cap is in daylight it is filled with the ice next to it (white).
# usage: python earth_day.py YYYY-MM-DD TILE_DIR OUT.png
import os, sys, subprocess, datetime, numpy as np, cv2
day, tdir, out = sys.argv[1], sys.argv[2], sys.argv[3]; HERE = os.path.dirname(os.path.abspath(__file__)); ims = []
for sat in ("NOAA20", "SNPP"):
    p = f"{tdir}/earth_{sat}_{day}.png"
    if not os.path.exists(p): subprocess.run([sys.executable, f"{HERE}/gibs_fetch.py", day, "3", "-180", "180", "-90", "90", tdir, p], check=True, env={**os.environ, "GIBS_SAT": sat})
    ims.append(cv2.imread(p)[:2560, :5120])
a, b = ims; va, vb = a.max(2) > 8, b.max(2) > 8; im = np.where((va & vb)[..., None], np.minimum(a, b), np.where(va[..., None], a, b)); valid = va | vb
H, W = valid.shape; lat = 90 - (np.arange(H) + 0.5) * 180 / H; doy = datetime.date.fromisoformat(day).timetuple().tm_yday; decl = -23.44 * np.cos(2 * np.pi * (doy + 10) / 365.25)      # the Sun's latitude that day
for sign in (-1, 1):                                                     # south cap, north cap
    cap = (sign * lat > 60)[:, None] & ~valid
    if not cap.any() or sign * decl < 2.0: continue                      # in the dark half of the year the cap really is dark
    edge = (sign * lat > 70) & (sign * lat < 82); ice = np.median(im[edge][valid[edge]], 0); m = cv2.GaussianBlur(cap.astype(np.float32), (0, 0), 6)[..., None]; im = (im * (1 - m) + ice * m).astype(np.uint8)
    m2 = cv2.GaussianBlur(cv2.dilate(cap.astype(np.uint8), np.ones((41, 41), np.uint8)).astype(np.float32), (0, 0), 12)[..., None]; im = (im * (1 - m2) + cv2.GaussianBlur(im, (0, 0), 14) * m2).astype(np.uint8)      # no line where the fill meets the picture
cv2.imwrite(out, im, [cv2.IMWRITE_PNG_COMPRESSION, 3]); print(day, "written", im.shape, "no picture in %.1f%% of the globe before filling" % (100 * (~valid).mean()))
