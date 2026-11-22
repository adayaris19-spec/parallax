# Geometry for a camera standing on the Moon near the south pole: real elevation data, and where the Sun and Earth really are.
# Map frame (LOLA south polar stereographic): x toward longitude 90 E, y toward longitude 0 (the Earth side), kilometres from the pole.
import math, numpy as np
R = 1737.4
class Dem:
    def __init__(s, path, n, step_km):
        s.n = n; s.s = step_km; s.c = (n - 1) / 2
        if path.endswith(".npz"): z = np.load(path); s.a = z["a"]; s.r_off, s.c_off = int(z["r_off"]), int(z["c_off"])        # a window cut from the full grid by prep_site_data.py
        else: s.a = np.memmap(path, dtype="<i2", mode="r", shape=(n, n)); s.r_off = s.c_off = 0
    def cut(s, x0, x1, y0, y1):
        """heights in metres, row 0 = lowest y; plus the x and y of the cell centres (km)"""
        c0, c1 = max(int(round(x0 / s.s + s.c)), 0), min(int(round(x1 / s.s + s.c)), s.n); r0, r1 = max(int(round(y0 / s.s + s.c)), 0), min(int(round(y1 / s.s + s.c)), s.n)
        a0, a1, b0, b1 = s.n - r1 - s.r_off, s.n - r0 - s.r_off, c0 - s.c_off, c1 - s.c_off
        assert a0 >= 0 and b0 >= 0 and a1 <= s.a.shape[0] and b1 <= s.a.shape[1], "asked for terrain outside the stored window"
        h = np.asarray(s.a[a0:a1, b0:b1])[::-1].astype(np.float32) * 0.5
        return h, (np.arange(c0, c1) - s.c) * s.s, (np.arange(r0, r1) - s.c) * s.s
def to_global(x, y, h_m):
    """map km + height m -> 3D km; origin at the pole on the reference sphere, Z out of the south pole"""
    x = np.asarray(x, np.float64); y = np.asarray(y, np.float64); r = np.sqrt(x * x + y * y) + 1e-12; c = 2 * np.arctan(r / (2 * R)); rr = R + np.asarray(h_m, np.float64) / 1000
    return np.stack([rr * np.sin(c) * x / r, rr * np.sin(c) * y / r, rr * np.cos(c) - R], -1)
class Site:
    def __init__(s, cx, cy, h_m):
        s.cx, s.cy, s.h = cx, cy, h_m; s.P0 = to_global(cx, cy, h_m); up = s.P0 - np.array([0, 0, -R]); up /= np.linalg.norm(up)
        yl = np.array([0, 1.0, 0]); yl -= yl.dot(up) * up; yl /= np.linalg.norm(yl); xl = np.cross(yl, up); s.B = np.stack([xl, yl, up])
        r = math.hypot(cx, cy); s.lat = -90 + math.degrees(2 * math.atan(r / (2 * R))); s.lon = math.degrees(math.atan2(cx, cy)) % 360
    def local(s, x, y, h_m):
        """map km + height m -> local metres (x right, y toward the Earth side, z up)"""
        return ((to_global(x, y, h_m) - s.P0) @ s.B.T * 1000).astype(np.float32)
    def sky(s, kernel_dir, utc):
        """unit vectors to the Sun and Earth in the local frame, distances (km), and the Earth-fixed -> local rotation, for a UTC time (y, m, d, h, min)"""
        from skyfield.api import Loader, PlanetaryConstants
        from skyfield.framelib import itrs
        load = Loader(kernel_dir); eph = load("de421.bsp"); ts = load.timescale(builtin=True); t = ts.utc(*utc)
        pc = PlanetaryConstants(); pc.read_text(load("moon_080317.tf")); pc.read_text(load("pck00008.tpc")); pc.read_binary(load("moon_pa_de421_1900-2050.bpc"))
        fr = pc.build_frame_named("MOON_ME_DE421"); obs = eph["moon"] + pc.build_latlon_degrees(fr, s.lat, s.lon)
        A = np.array([[0, 1.0, 0], [1.0, 0, 0], [0, 0, -1.0]])            # Moon-fixed (x to Earth, z north) -> map frame
        out = {}
        for name in ("sun", "earth"):
            ap = obs.at(t).observe(eph[name]).apparent(); v = np.array(ap.frame_xyz(fr).km); d = np.linalg.norm(v); vl = s.B @ (A @ (v / d))
            alt, az, _ = ap.altaz(); out[name] = dict(dir=vl, dist=d, alt=math.degrees(math.asin(vl[2])), alt_check=alt.degrees, az=az.degrees)
        out["earth_rot"] = s.B @ A @ np.array(fr.rotation_at(t)) @ np.array(itrs.rotation_at(t)).T
        return out
