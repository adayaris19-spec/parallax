"""
One metric, four instruments.

The claim the whole project rests on is that blindness is a single, comparable
quantity across fields that currently have no shared language for it. This is
the smallest demonstration of that claim.
"""

import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from reach import audit, find_blind_regions
from reach.domains import hep, msms

rows = []

a = audit(hep.SPACE, hep.MENU, n=300_000, seed=1)
r = find_blind_regions(a, ["m", "n_vis", "f_vis", "f_lep"], max_regions=1,
                       min_mass=0.02)
rows.append(("collider trigger menu", "generic BSM final states", a,
             r[0].render({ax.name: ax for ax in hep.AXES}) if r else "-"))

space = msms.enumerate_formulas(50.0, 500.0)
ms_axes = {ax.name: ax for ax in msms.AXES}
for label, filt in [
    ("targeted MRM assay", msms.targeted_method(space, 600)),
    ("non-targeted HRMS (acquisition)", msms.acquisition_only(space)),
    ("non-targeted HRMS (as reported)", msms.nontargeted_method(space)),
]:
    a = audit(space, filt)
    r = find_blind_regions(a, ["mass", "C", "N", "O", "polarity"],
                           max_regions=1, min_mass=0.02)
    rows.append((label, "CHNOPS formulas, 50-500 Da", a,
                 r[0].render(ms_axes) if r else "-"))

print()
print("THE BLINDNESS LEDGER")
print("=" * 96)
print(f"  {'instrument + policy':<34}{'reach':>9}{'blind':>9}   largest named blind region")
print("-" * 96)
for label, _space, a, region in rows:
    print(f"  {label:<34}{a.reach*100:8.2f}%{a.blind*100:8.2f}%   {region}")
print("=" * 96)
print("""
  Read the last two rows together. The hardware records 45.9% of the stated
  chemical space; what is reported is 1.0%. Roughly 98% of what the instrument
  actually detected is discarded at the annotation step, because a feature that
  cannot be matched to a spectral library is not written down.

  No paper reports that number, because there is currently no quantity for it.
""")
