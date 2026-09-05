"""
A real published trigger menu, audited - and then attacked.

Three sections:
  1. the nominal audit against the ATLAS Run-2 primary menu
  2. a robustness sweep in which every uncertain input is varied together,
     reporting which conclusions survive
  3. the prior family, because reach without a stated prior is meaningless
     and one prior is not a statement
"""

import pathlib
import sys

import numpy as np

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from reach import audit, certificate, find_blind_regions
from reach.report import render
from reach.robust import Claim, Knob, power_law, reach_under, sweep
from reach.robust import render as render_robust
from reach.domains import atlas_run2 as atlas

N = 120_000
SEED = 11

# ---------------------------------------------------------------- 1. nominal
a = audit(atlas.SPACE, atlas.MENU, n=N, seed=SEED)
regions = find_blind_regions(a, ["m", "n_vis", "f_vis", "f_lep", "displacement"],
                             max_regions=4, min_mass=0.01)
print(render(a, list(atlas.AXES), regions))
print(f"\n  for scale: the menu writes {atlas.kept_fraction():.1e} of all "
      f"bunch crossings to permanent storage.\n")

# ------------------------------------------------------- 2. robustness sweep
# Common random numbers: draw the axes once so that differences between draws
# come from the knobs, not from sampling noise.
rng = np.random.default_rng(SEED)
base = {ax.name: ax.draw(N, rng) for ax in atlas.AXES}
weights = np.full(N, 1.0 / N)

ALL_THRESHOLDS = ["mu_iso", "mu_noniso", "e_iso", "e_med", "e_loose",
                  "g_single", "j_single", "j_four", "ht", "met", "dimu", "diel"]
ALL_RADII = ["r_tracker", "r_calo", "r_muon"]


def evaluate(params):
    space = atlas.build_space(params)
    table = dict(base)
    table.update(space.derive(table))
    return table


def run(params):
    table = evaluate(params)
    menu = atlas.build_menu(params)
    survives = menu.evaluate(table)
    reach = float(weights[survives].sum())

    # counterfactuals: what would we recover by abolishing each class of cut?
    no_thresholds = atlas.build_menu({**params, **{k: 1e-6 for k in ALL_THRESHOLDS}})
    no_geometry = atlas.build_menu({**params, **{k: 1e6 for k in ALL_RADII}})
    gain_thresholds = float(weights[no_thresholds.evaluate(table)].sum()) - reach
    gain_geometry = float(weights[no_geometry.evaluate(table)].sum()) - reach

    # conditional reach in two corners of the space
    def corner(mask):
        m = weights[mask].sum()
        return float(weights[mask & survives].sum() / m) if m > 0 else 0.0

    light_hadronic = corner((table["m"] < 100.0) & (table["f_lep"] < 0.1))
    soft_busy = corner((table["n_vis"] >= 10) & (table["m"] < 300.0))

    # which path uniquely contributes most
    uniques = {}
    for path in [c.name for c in menu.root.children]:
        without = menu.ablate(path)
        uniques[path] = reach - float(weights[without.evaluate(table)].sum())
    top = max(uniques, key=uniques.get)

    return {
        "reach": reach,
        "gain_thresholds": gain_thresholds,
        "gain_geometry": gain_geometry,
        "light_hadronic": light_hadronic,
        "soft_busy": soft_busy,
        "met_unique": uniques.get("met", 0.0),
        "met_is_top": 1.0 if top == "met" else 0.0,
    }


CLAIMS = [
    Claim("reach_below_half",
          "the menu can record less than half of the stated signal space",
          lambda q: q["reach"] < 0.5),
    Claim("light_hadronic_blind",
          "light states with no hard lepton (m < 100 GeV, f_lep < 0.1) are "
          "essentially unreachable: conditional reach below 2%",
          lambda q: q["light_hadronic"] < 0.02,
          "this is the well-known sub-electroweak blind spot - if the method "
          "is sound it must recover it without being told"),
    Claim("soft_busy_blind",
          "soft high-multiplicity states (n_vis >= 10, m < 300 GeV) have "
          "conditional reach below 5%",
          lambda q: q["soft_busy"] < 0.05),
    Claim("thresholds_beat_geometry",
          "energy thresholds destroy more reach than detector geometry does",
          lambda q: q["gain_thresholds"] > q["gain_geometry"],
          "if true, the dominant cause of blindness is bandwidth, not physics"),
    Claim("met_is_most_unique",
          "missing energy is the single most valuable path by unique coverage",
          lambda q: q["met_is_top"] > 0.5,
          "the only chain that rewards a signal for being invisible"),
]

e = sweep(run, atlas.KNOBS, CLAIMS, draws=250, seed=5)
print()
print(render_robust(e, "ATLAS Run-2 primary menu",
                    ["reach", "light_hadronic", "soft_busy",
                     "gain_thresholds", "gain_geometry", "met_unique"]))

# -------------------------------------------------------- 3. prior sensitivity
print()
print("=" * 78)
print("PRIOR FAMILY  ·  reach is undefined without a prior, so state several")
print("=" * 78)
print("  A falling mass prior m^-alpha shifts weight to light states, which is")
print("  where the menu is blind. alpha=0 is the flat log-uniform baseline.")
print()
print(f"    {'mass prior':<28}{'reach':>10}")
for alpha in (0.0, 0.5, 1.0, 1.5, 2.0):
    r = reach_under(a.table, a.weights, a.survives, {"m": power_law(alpha)})
    label = "log-uniform (baseline)" if alpha == 0 else f"m^-{alpha:g}"
    print(f"    {label:<28}{r*100:9.2f}%")
print()
print("  Every one of these is a legitimate number. They answer different")
print("  questions, and a reach figure quoted without its prior is not a result.")
print("=" * 78)

out = pathlib.Path(__file__).parent / "atlas_exclusion_certificate.json"
cert = certificate.build(a, atlas.MENU, list(atlas.AXES), regions)
cert["robustness"] = {
    "draws": e.draws,
    "knobs": [{"name": k.name, "lo": k.lo, "hi": k.hi, "why": k.why}
              for k in e.knobs],
    "claim_survival": {c.name: {"statement": c.statement,
                                "survives_fraction": round(e.survival[c.name], 3)}
                       for c in CLAIMS},
    "reach_spread": e.summary("reach"),
}
cert["provenance"] = {
    "thresholds": {k: {"value": v.value, "chain": v.chain,
                       "confidence": v.confidence, "verify": v.verify}
                   for k, v in atlas.NOMINAL.items()},
    "warning": "Encoded from documented public values but NOT verified against "
               "the source in the session that produced this file (no network "
               "access). See VERIFICATION_CHECKLIST in reach/domains/atlas_run2.py.",
}
out.write_text(certificate.dumps(cert))
print(f"\ncertificate -> {out.name}")
