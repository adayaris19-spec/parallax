# How the zodiacal light falls off away from the ecliptic, from the dust model fitted to Clementine's pictures of it
# (Hahn, Zook, Cooper, Sunkara 2002, "Clementine Observations of the Zodiacal Light and the Dust Content of the Inner Solar
# System", arXiv astro-ph/0204111). The paper gives the brightness along the ecliptic as a formula (its eq. 5; night_fall.py
# uses that) and the rest as a model: three kinds of dust, each with a spread of orbit tilts and a fall-off with distance from
# the Sun (its eqs. 6 to 8 and Table II). This computes that model and writes, for each direction near the Sun, the brightness
# there divided by the brightness on the ecliptic at the same angle from the Sun. night_fall.py multiplies eq. 5 by it.
#
# The model needs a law for how dust scatters light by angle. The paper used Hong's (1985, IAU Colloquium 85, p. 217, Table I):
# three Henyey-Greenstein terms with asymmetry factors 0.698, -0.203, -0.813 and weights 0.665, 0.330, 0.005. The table is made
# with it. (Hong fitted it to the sky 15 degrees and more from the Sun; the Clementine paper uses it closer in, and so do we.)
# Light scattered equally in all directions is run beside it to show how much the choice matters; that difference is printed
# and kept with the table as its uncertainty.
#
# usage: python zodi_shape.py OUT.json
import sys, json, math, numpy as np
trap = lambda f, x: float(((f[1:] + f[:-1]) * np.diff(x)).sum() / 2)
SIG = {"low": math.radians(7.0), "high": math.radians(33.0)}          # spread of orbit tilts: asteroids and Jupiter-family comets; Halley-type comets (paper, section 4.2.2)
NU = {"low": 1.0, "high": 1.45, "iso": 2.0}; FR = {"low": 0.45, "high": 0.50, "iso": 0.05}      # Table II: fall-off with distance from the Sun, share of the dust at the Earth's distance
def h_of_beta(sig):
    """eq. 6 with eq. 7: how the dust thins with latitude above the ecliptic, 1 on the ecliptic"""
    bs = np.radians(np.arange(0.0, 90.01, 0.25)); out = []
    for b in bs:
        if math.pi / 2 - b < 1e-6: out.append((2 / math.pi) * math.exp(-0.5 * (b / sig) ** 2) * math.pi / 2); continue      # straight over the pole: the integral's limit
        s = np.linspace(0.0, math.sqrt(math.pi / 2 - b), 4001)[1:]; i = b + s * s      # sin^2 i - sin^2 b = sin(i - b) sin(i + b), which stays exact where the two are nearly equal
        f = (2 / math.pi) * np.sin(i) * np.exp(-0.5 * (i / sig) ** 2) * 2 * s / np.sqrt(np.sin(s * s) * np.sin(2 * b + s * s)); out.append(trap(f, s))
    out = np.array(out); return bs, out / out[0], 1.0 / out[0]
H = {}
for k, sg in SIG.items(): bs, hb, c = h_of_beta(sg); H[k] = hb; print("dust '%s': normalisation %.3f (paper: %s)" % (k, c, {"low": "10.27", "high": "2.190"}[k]))
H["iso"] = np.ones_like(bs)
def hg(g, ph): return (1 - g * g) / (1 + g * g - 2 * g * np.cos(ph)) ** 1.5
LAWS = {"Hong 1985": lambda ph: 0.665 * hg(0.698, ph) + 0.330 * hg(-0.203, ph) + 0.005 * hg(-0.813, ph), "equal in all directions": lambda ph: np.ones_like(ph)}
def Z(theta, phi, psi):
    """eq. 8 without its constant: brightness toward ecliptic latitude theta, longitude phi from the Sun (radians)"""
    eps = math.acos(math.cos(phi) * math.cos(theta)); ph = np.linspace(eps, math.pi, 3000)[1:-1]
    beta = np.arcsin(np.clip(np.sin(ph - eps) * math.sin(theta) / math.sin(eps), -1, 1)); tot = 0.0
    for k in NU: tot += FR[k] / math.sin(eps) ** (NU[k] + 1) * trap(psi(ph) * np.interp(np.abs(beta), bs, H[k]) * np.sin(ph) ** NU[k], ph)
    return tot
lon = np.arange(0.0, 46.0, 1.0); lat = np.arange(0.0, 41.0, 1.0); tabs = []
for name, psi in LAWS.items():
    T = np.ones((len(lat), len(lon)))
    for a, th in enumerate(lat):
        for b, ln in enumerate(lon):
            eps = math.degrees(math.acos(math.cos(math.radians(ln)) * math.cos(math.radians(th))))
            if th == 0 or eps < 1.5: continue
            T[a, b] = Z(math.radians(th), math.radians(ln), psi) / Z(0.0, math.radians(eps), psi)
    tabs.append(T)
    # the paper's own check on the ecliptic: brightness should fall close to (angle from the Sun) ^ -2.45
    e1, e2 = math.radians(5.0), math.radians(25.0); print("scattering '%s': slope on the ecliptic between 5 and 25 degrees %.2f (measured: -2.45 +/- 0.05)" % (name, math.log(Z(0, e2, psi) / Z(0, e1, psi)) / math.log(math.sin(e2) / math.sin(e1))))
T = tabs[0]; dif = np.abs(tabs[0] - tabs[1]) / T
print("difference between the two scattering laws within 30 degrees of the Sun: at most %.0f%% of the value, %.0f%% on average" % (100 * dif[:31, :31].max(), 100 * dif[:31, :31].mean()))
for th in (5, 10, 20, 30): print("  straight above the Sun by %2d degrees: %.2f of the ecliptic's brightness at that angle" % (th, T[th, 0]))
json.dump({"source": "arXiv astro-ph/0204111, eqs. 6-8, Table II", "lon_deg": lon.tolist(), "lat_deg": lat.tolist(), "ratio": np.round(T, 4).tolist(), "uncertainty_within_30_deg": round(float(dif[:31, :31].max()), 3)}, open(sys.argv[1], "w"))
print("wrote", sys.argv[1])
