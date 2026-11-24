# The face of the Earth turned to the Moon at a given moment, as it would look from the Moon's south pole (ecliptic south up),
# for the Earth's night side lit by moonlight. Also prints where the Sun, the Earth and the planets stand in a take's picture.
# Positions: JPL's DE440 ephemeris through skyfield. The picture of the Earth: one day of true-colour satellite imagery from
# NASA GIBS (whole Earth, 0.25 degrees a pixel); its clouds are that day's, not the clouds of the moment asked for.
#
# usage: python earth_face.py "2039-01-08 14:00" EPHEMERIS_DIR GIBS.jpg OUT.npy [RADIUS_PX]
#   GIBS.jpg: https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0&LAYERS=VIIRS_SNPP_CorrectedReflectance_TrueColor&CRS=EPSG:4326&BBOX=-90,-180,90,180&WIDTH=1440&HEIGHT=720&FORMAT=image/jpeg&TIME=2024-01-08
#   OUT.npy: height x width x 4, float32: how much light each place sends back (0..1, red green blue; already times the cosine of
#   the angle to the Moon, since the light comes from where the viewer stands) and cover. night_fall.py reads it as stars.sky_map.earth_night.
import sys, math, json, numpy as np, cv2
from skyfield.api import Loader, wgs84
from skyfield.framelib import ecliptic_frame
when, ephdir, img, out = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]; R = float(sys.argv[5]) if len(sys.argv) > 5 else 95.9
load = Loader(ephdir); eph = load("de440s.bsp"); ts = load.timescale(builtin=True); d_, h_ = when.split(); y, mo, da = [int(v) for v in d_.split("-")]; hh, mi = [int(v) for v in h_.split(":")]; t = ts.utc(y, mo, da, hh, mi)
earth, moon, sun = eph["earth"], eph["moon"], eph["sun"]; wrap = lambda a: (a + 180) % 360 - 180
def from_moon(body): lat, lon, dist = moon.at(t).observe(body).frame_latlon(ecliptic_frame); return lon.degrees, lat.degrees, dist.au
ls, bs, ds = from_moon(sun); le, be, de = from_moon(earth); print("from the Moon: Sun at ecliptic longitude %.2f; Earth %.2f deg from it in longitude, latitude %+.2f; Earth's radius %.3f deg" % (ls, wrap(le - ls), be, math.degrees(math.asin(6371.0 / (de * 149597870.7)))))
for name, key in (("Mercury", "mercury barycenter"), ("Venus", "venus barycenter"), ("Mars", "mars barycenter"), ("Jupiter", "jupiter barycenter"), ("Saturn", "saturn barycenter")):
    lp, bp, dp = from_moon(eph[key]); print("  %-8s %+7.2f deg from the Sun in longitude, latitude %+.2f" % (name, wrap(lp - ls), bp))
m = earth.at(t).observe(moon).position.km; m = m / np.linalg.norm(m); d = -m; e = math.radians(23.4393); south = -np.array([0.0, -math.sin(e), math.cos(e)])      # Earth to Moon; the ecliptic's south pole, in equatorial axes
up = south - south.dot(d) * d; up /= np.linalg.norm(up); right = np.cross(d, up); q = 4; n = int(2 * (R + 3)) * q; gy, gx = np.mgrid[0:n, 0:n].astype(np.float64); u = (gx - n / 2 + 0.5) / (R * q); v = (gy - n / 2 + 0.5) / (R * q); rho = np.hypot(u, v); z = np.sqrt(np.clip(1 - rho * rho, 0, 1))
P = u[..., None] * right - v[..., None] * up + z[..., None] * m; lat = np.degrees(np.arcsin(np.clip(P[..., 2], -1, 1))); lon = wrap(np.degrees(np.arctan2(P[..., 1], P[..., 0])) - t.gast * 15.0)
sub = wgs84.subpoint_of(earth.at(t).observe(moon)); c = n // 2; print("under the Moon: lat %.2f lon %.2f (the middle of the disc maps to lat %.2f lon %.2f)" % (sub.latitude.degrees, sub.longitude.degrees, lat[c, c], lon[c, c]))
tex = cv2.imread(img).astype(np.float32) / 255.0; th, tw = tex.shape[:2]; miss = cv2.dilate((tex.max(2) < 0.02).astype(np.uint8), np.ones((5, 5), np.uint8))      # where the satellite has no picture: the polar night, gaps between passes
rows = np.nonzero(miss.mean(1) > 0.5)[0]; cap = int(rows[rows < th // 2].max()) + 1 if (rows < th // 2).any() else 0      # the northern polar night is filled with the land and cloud just south of it, mirrored; small gaps from their surroundings
if cap: tex[:cap] = tex[2 * cap - 1:cap - 1:-1][:cap]; miss[:cap] = 0
tex = cv2.inpaint((tex * 255).astype(np.uint8), miss, 4, cv2.INPAINT_TELEA).astype(np.float32) / 255.0; tex = cv2.GaussianBlur(tex, (0, 0), 1.0)
samp = cv2.remap(tex, ((lon + 180) / 360 * tw - 0.5).astype(np.float32), ((90 - lat) / 180 * th - 0.5).astype(np.float32), cv2.INTER_LINEAR, borderMode=cv2.BORDER_WRAP)
refl = np.clip(samp, 0, 1) ** 2.2 * z[..., None] + (0.10 * np.exp(-((1 - rho) / 0.035) ** 2) * (rho <= 1))[..., None] * np.array([1.0, 0.8, 0.6])      # the surface, and a thin blue edge where the air is seen edge-on (BGR; its strength is our choice)
refl = cv2.GaussianBlur(refl, (0, 0), 0.9 * q); cover = np.clip((1 - rho) * R * q / 2.0 + 0.5, 0, 1); res = np.dstack([refl[..., ::-1], cover]).astype(np.float32)      # red green blue, and cover
res = cv2.resize(res, (n // q, n // q), interpolation=cv2.INTER_AREA); np.save(out, res); print("wrote", out, res.shape, "mean of what the disc sends back %.3f" % float(res[..., :3][res[..., 3] > 0.9].mean()))
