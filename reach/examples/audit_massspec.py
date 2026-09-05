"""What a mass-spectrometry method cannot see. Reach here is exact."""

import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from reach import audit, certificate, find_blind_regions
from reach.report import render
from reach.domains import msms

space = msms.enumerate_formulas(50.0, 500.0)
print(f"enumerated {len(space.table['mass']):,} plausible CHNOPS formulas "
      f"between 50 and 500 Da\n")

axes = list(msms.AXES)
mapped = ["mass", "C", "N", "O", "polarity", "rdbe"]

for name, filt in [
    ("TARGETED ASSAY", msms.targeted_method(space, n_targets=600)),
    ("NON-TARGETED, ACQUISITION ONLY", msms.acquisition_only(space)),
    ("NON-TARGETED, AS REPORTED", msms.nontargeted_method(space)),
]:
    a = audit(space, filt)
    regions = find_blind_regions(a, mapped, max_regions=3, min_mass=0.02)
    print(f"\n### {name}")
    print(render(a, axes, regions))

a = audit(space, msms.nontargeted_method(space))
regions = find_blind_regions(a, mapped, max_regions=3, min_mass=0.02)
out = pathlib.Path(__file__).parent / "massspec_exclusion_certificate.json"
out.write_text(certificate.dumps(
    certificate.build(a, msms.nontargeted_method(space), axes, regions)))
print(f"\ncertificate -> {out.name}")
