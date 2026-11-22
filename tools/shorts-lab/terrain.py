# Ground for a surface-level Moon shot. Real: LOLA elevation (5 m grid, smoothed to about 30 m because its 0.5 m height steps are noise at this scale).
# Modelled: everything smaller (craters under ~20 m, soil roughness, wheel tracks, bootprints), statistically like the real Moon but not measured.
import math, numpy as np, cv2
from scipy import ndimage
def smoothstep(x, a, b): t = np.clip((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t)
def fbm_tile(n, beta, seed):
    rng = np.random.default_rng(seed); fy = np.fft.fftfreq(n)[:, None]; fx = np.fft.rfftfreq(n)[None, :]; k = np.sqrt(fx * fx + fy * fy); k[0, 0] = 1
    spec = k ** (-beta / 2) * np.exp(2j * np.pi * rng.random(k.shape)); spec[0, 0] = 0
    t = np.fft.irfft2(spec, s=(n, n)); return (t / t.std()).astype(np.float32)
class Ground:
    def __init__(s, site, dem5, seed=7, half_km=5.0, K=0.04, A=560.0, yoff=180.0):
        s.site = site; h, xs, ys = dem5.cut(site.cx - half_km, site.cx + half_km, site.cy - half_km, site.cy + half_km)
        s.h_raw = h; s.h = ndimage.gaussian_filter(h, 3.0); s.x0, s.y0, s.step = xs[0], ys[0], dem5.s
        s.rng = np.random.default_rng(seed); dmin, dmax = 0.14, 18.0
        n = s.rng.poisson(K * (dmin ** -2 - dmax ** -2) * A * A); u = s.rng.random(n)
        s.cD = (dmin ** -2 - u * (dmin ** -2 - dmax ** -2)) ** -0.5; s.cx = s.rng.uniform(-A / 2, A / 2, n); s.cy = s.rng.uniform(-A / 2 + yoff, A / 2 + yoff, n); s.cage = s.rng.beta(3.0, 1.2, n)
        s.keep = lambda x, y, D: np.ones(len(x), bool)      # replaced by the layout: a base is sited on a clear patch
        s.T1 = fbm_tile(2048, 2.7, seed + 1); s.T2 = fbm_tile(2048, 2.1, seed + 2); s.extra = []      # extra: functions (u0, v0, res, nx, ny) -> height delta, e.g. tracks
    def dem(s, U, V):
        col = (s.site.cx + U / 1000.0 - s.x0) / s.step; row = (s.site.cy + V / 1000.0 - s.y0) / s.step
        return ndimage.map_coordinates(s.h, [row, col], order=3, mode="nearest")
    def noise(s, U, V, res):
        z = 0.040 * ndimage.map_coordinates(s.T1, [(V / 0.05) % 2048, (U / 0.05) % 2048], order=1, mode="wrap")
        if res <= 0.02: z = z + 0.0030 * ndimage.map_coordinates(s.T2, [(V / 0.005) % 2048, (U / 0.005) % 2048], order=1, mode="wrap")
        return z
    def craters(s, H, u0, v0, res):
        ny, nx = H.shape; m = 1.2 * s.cD; sel = np.where((s.cD >= 3.5 * res) & (s.cx > u0 - m) & (s.cx < u0 + nx * res + m) & (s.cy > v0 - m) & (s.cy < v0 + ny * res + m))[0]
        for i in sel:
            D, age = s.cD[i], s.cage[i]; Rc = D / 2; w = int(math.ceil(2.3 * Rc / res)); ic = int(round((s.cx[i] - u0) / res)); jc = int(round((s.cy[i] - v0) / res))
            i0, i1, j0, j1 = max(ic - w, 0), min(ic + w + 1, nx), max(jc - w, 0), min(jc + w + 1, ny)
            if i0 >= i1 or j0 >= j1: continue
            xx = (np.arange(i0, i1) * res + u0 - s.cx[i]) / Rc; yy = (np.arange(j0, j1) * res + v0 - s.cy[i]) / Rc; rho = np.hypot(xx[None, :], yy[:, None])
            z = -D * (0.17 - 0.12 * age) * np.exp(-(rho / 0.74) ** 2.5) + D * 0.035 * (1 - 0.75 * age) * np.exp(-((rho - 1.03) / (0.24 + 0.22 * age)) ** 2)
            H[j0:j1, i0:i1] += (z * (1 - smoothstep(rho, 1.8, 2.3))).astype(np.float32)
        return len(sel)
    def grid(s, u0, u1, v0, v1, res, origin=(0.0, 0.0), theta=0.0):
        """A patch of ground. By default its axes are the map's. With origin and theta it is a box around a camera: its v axis points along
        map azimuth theta (degrees from the Earth-side direction, clockwise) and (0, 0) sits at origin (map metres). Returns map coordinates."""
        if not getattr(s, '_filtered', False): k = s.keep(s.cx, s.cy, s.cD); s.cx, s.cy, s.cD, s.cage = s.cx[k], s.cy[k], s.cD[k], s.cage[k]; s._filtered = True      # the layout may clear big craters from where things stand
        nx, ny = int(round((u1 - u0) / res)) + 1, int(round((v1 - v0) / res)) + 1; U, V = np.meshgrid(u0 + np.arange(nx) * res, v0 + np.arange(ny) * res)
        c, sn = math.cos(math.radians(theta)), math.sin(math.radians(theta)); s.origin, s.theta = origin, theta
        MX = origin[0] + U * c + V * sn; MY = origin[1] - U * sn + V * c
        H = s.dem(MX, MY).astype(np.float32); H += s.noise(MX, MY, res).astype(np.float32)
        if theta == 0.0 and origin == (0.0, 0.0): nc = s.craters(H, u0, v0, res)
        else:
            keep = (s.cx, s.cy); dx, dy = s.cx - origin[0], s.cy - origin[1]; s.cx, s.cy = dx * c - dy * sn, dx * sn + dy * c       # crater centres in the patch's own axes
            nc = s.craters(H, u0, v0, res); s.cx, s.cy = keep
        for f in s.extra: H = f(H, u0, v0, res)            # wheel tracks and bootprints press the soil flat, so they need the surface itself
        return MX, MY, H, nc
    def to_local(s, U, V, H): return s.site.local(s.site.cx + U / 1000.0, s.site.cy + V / 1000.0, H)
def far_grid(site, dem, x0, x1, y0, y1, k=1, sigma=0.0):
    """coarse real terrain straight from a LOLA grid, in local metres"""
    h, xs, ys = dem.cut(x0, x1, y0, y1)
    if sigma: h = ndimage.gaussian_filter(h, sigma)
    if k > 1:
        a, b = (h.shape[0] // k) * k, (h.shape[1] // k) * k; h = h[:a, :b].reshape(a // k, k, b // k, k).mean((1, 3)); xs = xs[:b].reshape(-1, k).mean(1); ys = ys[:a].reshape(-1, k).mean(1)
    X, Y = np.meshgrid(xs, ys); return X, Y, site.local(X, Y, h)
