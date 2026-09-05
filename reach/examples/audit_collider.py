"""What a representative collider trigger menu cannot see."""

import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from reach import audit, certificate, find_blind_regions
from reach.report import render
from reach.domains import hep

a = audit(hep.SPACE, hep.MENU, n=400_000, seed=1)
regions = find_blind_regions(a, ["m", "n_vis", "f_vis", "f_lep", "displacement"],
                             max_regions=4, min_mass=0.01)
print(render(a, list(hep.AXES), regions))

out = pathlib.Path(__file__).parent / "collider_exclusion_certificate.json"
out.write_text(certificate.dumps(
    certificate.build(a, hep.MENU, list(hep.AXES), regions)))
print(f"\ncertificate -> {out.name}")
