# Shared camera and sky geometry for the Moon shot, version 2.
import math, numpy as np
R, ALT, FOV, TH0, PITCH, TRAVEL = 1737.4, 100.0, 10.6, 16.0, 17.94, 22.0
W, H = 1080, 1920
def cam_basis(t):
    th = math.radians(TH0) - t * TRAVEL / (R + ALT)
    u = np.array([0, -math.sin(th), math.cos(th)]); f = np.array([0, math.cos(th), math.sin(th)])
    pos = np.array([0, 0, -R]) + (R + ALT) * u
    p = math.radians(PITCH); d = math.cos(p) * f - math.sin(p) * u
    z = np.array([0, 0, 1.0]); up = z - z.dot(d) * d; up /= np.linalg.norm(up); right = np.cross(d, up)
    return pos, d, up, right
def scene_to_equatorial(lam_deg=263.0, beta_deg=-2.0):
    # Earth, seen from the Moon, placed on the ecliptic in front of the Sagittarius star clouds; "up" at the lunar south pole is ecliptic south.
    eps, lam, beta = math.radians(23.4393), math.radians(lam_deg), math.radians(beta_deg)
    e = np.array([math.cos(beta) * math.cos(lam), math.cos(beta) * math.sin(lam) * math.cos(eps) - math.sin(beta) * math.sin(eps),
                  math.cos(beta) * math.sin(lam) * math.sin(eps) + math.sin(beta) * math.cos(eps)])
    n = -np.array([0, -math.sin(eps), math.cos(eps)])
    z = n - n.dot(e) * e; z /= np.linalg.norm(z); x = np.cross(e, z)
    return np.stack([x, e, z], 1)       # columns: images of scene X, Y, Z
def sky_uv(t, M, NW=65536, NH=32768):
    pos, d, up, right = cam_basis(t)
    fpx = (H / 2) / math.tan(math.radians(FOV / 2))
    xn = (np.arange(W) + 0.5 - W / 2) / fpx; yn = (H / 2 - (np.arange(H) + 0.5)) / fpx
    X, Y = np.meshgrid(xn, yn)
    v = d[None, None, :] + X[..., None] * right + Y[..., None] * up
    v /= np.linalg.norm(v, axis=2, keepdims=True)
    q = v @ M.T
    ra = np.mod(np.arctan2(q[..., 1], q[..., 0]), 2 * math.pi); dec = np.arcsin(q[..., 2])
    col = np.mod(0.5 - ra / (2 * math.pi), 1.0) * NW - 0.5; row = (0.5 - dec / math.pi) * NH - 0.5
    return col.astype(np.float32), row.astype(np.float32)
