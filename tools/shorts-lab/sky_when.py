# Where the Sun and Earth really are, seen from a site on the Moon. Uses JPL DE421 and the lunar orientation kernels (public, NAIF).
# usage: python sky_when.py KERNEL_DIR lat lon_east year month   -> lists hours when the constraints hold
import sys, numpy as np
from skyfield.api import Loader, PlanetaryConstants
kd, lat, lon, yr, mo = sys.argv[1], float(sys.argv[2]), float(sys.argv[3]), int(sys.argv[4]), int(sys.argv[5])
load = Loader(kd); eph = load("de421.bsp"); ts = load.timescale(builtin=True)
pc = PlanetaryConstants(); pc.read_text(load("moon_080317.tf")); pc.read_text(load("pck00008.tpc")); pc.read_binary(load("moon_pa_de421_1900-2050.bpc"))
frame = pc.build_frame_named("MOON_ME_DE421"); site = eph["moon"] + pc.build_latlon_degrees(frame, lat, lon)
t = ts.utc(yr, mo, 1, np.arange(0, 24 * 62))
se, sa, _ = site.at(t).observe(eph["sun"]).apparent().altaz(); ee, ea, _ = site.at(t).observe(eph["earth"]).apparent().altaz()
sep = (sa.degrees - ea.degrees + 180) % 360 - 180        # Sun azimuth minus Earth azimuth (east positive)
print("hours", len(se.degrees), "sun alt range %.2f..%.2f" % (se.degrees.min(), se.degrees.max()), "earth alt range %.2f..%.2f" % (ee.degrees.min(), ee.degrees.max()))
last = None
for i in range(len(se.degrees)):
    if se.degrees[i] > -1.5 and ee.degrees[i] > 3.0 and i % 6 == 0:
        print(t[i].utc_strftime("%Y-%m-%d %H:%M"), "sun alt %.2f az %.1f | earth alt %.2f az %.1f | sun-earth az %.1f" % (se.degrees[i], sa.degrees[i], ee.degrees[i], ea.degrees[i], sep[i]))
