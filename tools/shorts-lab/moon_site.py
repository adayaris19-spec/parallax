# From where on the Moon do the Sun and the Earth stand as a picture shows them? For one moment, prints how high the Sun and the
# Earth are at the south pole and at a few named places, and searches the south polar region for the place that fits best.
# Positions: JPL DE440; the Moon's orientation: JPL's lunar frames (moon_pa_de440_200625.bpc, moon_de440_250416.tf, pck00011.tpc,
# all from naif.jpl.nasa.gov/pub/naif/generic_kernels; not kept here), through skyfield.
#
# usage: python moon_site.py KERNEL_DIR "2039-01-08 14:00" SUN_DEG_UP EARTH_DEG_UP DEG_APART
#   KERNEL_DIR holds de440s.bsp, moon_pa.bpc (the .bpc under that name), moon_de440_250416.tf and pck00011.tpc
import numpy as np, math, json, sys
from skyfield.api import Loader, PlanetaryConstants
d_, h_ = sys.argv[2].split(); SUN_UP, EARTH_UP, APART = float(sys.argv[3]), float(sys.argv[4]), float(sys.argv[5])
load=Loader(sys.argv[1]); eph=load("de440s.bsp"); ts=load.timescale(builtin=True); t=ts.utc(*[int(v) for v in d_.split("-")], *[int(v) for v in h_.split(":")]); earth,moon,sun=eph["earth"],eph["moon"],eph["sun"]
pc=PlanetaryConstants(); pc.read_text(load("moon_de440_250416.tf")); pc.read_text(load("pck00011.tpc")); pc.read_binary(load("moon_pa.bpc"))
segs=pc._binary_files[0].segments; jd=float(t.tdb); right=[s for s in segs if s.initial_jd <= jd <= s.final_jd][0]; pc._segment_map[right.body]=right      # the file holds two spans of time; use the one that holds the date
frame=pc.build_frame_named("MOON_ME_DE440_ME421")
def altaz(lat, lon, body):
    site=moon+pc.build_latlon_degrees(frame, lat, lon); alt,az,_=site.at(t).observe(body).apparent().altaz(); return alt.degrees, az.degrees
def sub(body):
    v=moon.at(t).observe(body).apparent().position.km; p=frame.rotation_at(t)@(v/np.linalg.norm(v)); return math.degrees(math.asin(p[2])), math.degrees(math.atan2(p[1],p[0]))
se=sub(earth); ss=sub(sun); print("on the Moon, the point under the Earth: lat %+.2f lon %+.2f; under the Sun: lat %+.2f lon %+.2f"%(se+ss))
print("at the south pole itself: Sun %.2f deg above the horizon, Earth %.2f deg"%(altaz(-90,0,sun)[0], altaz(-90,0,earth)[0]))
wrap=lambda a:(a+180)%360-180; best=[]
for lat in np.arange(-89.5,-80.0,0.25):
    for lon in np.arange(-60,60.01,1.0):
        a_s,z_s=altaz(lat,lon,sun); a_e,z_e=altaz(lat,lon,earth); best.append((abs(a_s-SUN_UP)+abs(a_e-EARTH_UP)+abs(abs(wrap(z_s-z_e))-APART)*0.5, lat, lon, a_s, a_e, wrap(z_s-z_e)))
best.sort(); print("places where the Sun is %.1f deg up, the Earth %.1f deg up and they stand %.1f deg apart (best five):" % (SUN_UP, EARTH_UP, APART))
for e,lat,lon,a_s,a_e,dz in best[:5]: print("   lat %.2f lon %+.1f: Sun %.2f deg up, Earth %.2f deg up, Sun %+.1f deg of azimuth from the Earth (misfit %.2f)"%(lat,lon,a_s,a_e,dz,e))
for name,(lat,lon) in (("Malapert massif (85.99 S, 2.9 E)",(-85.99,2.9)),("Shackleton rim (89.8 S, 0)",(-89.8,0.0)),("Mons Mouton (84.6 S, 31.5 E)",(-84.6,31.5)),("Nobile rim (85.2 S, 31 E)",(-85.2,31.0))):
    a_s,z_s=altaz(lat,lon,sun); a_e,z_e=altaz(lat,lon,earth); print("   %-34s Sun %+.2f deg, Earth %+.2f deg, Sun %+.1f deg of azimuth from the Earth"%(name,a_s,a_e,wrap(z_s-z_e)))
