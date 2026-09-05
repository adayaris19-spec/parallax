"""
The exclusion certificate.

Every dataset on Earth documents what it contains. None documents what it
structurally could never have contained. That asymmetry is why blind spots
compound silently when datasets are combined, meta-analysed, or used as
training data.

A certificate is the missing metadata primitive: a machine-readable statement
of what a given filter policy makes unrecordable, under a stated prior.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone

from .core import Audit, Axis, Filter
from .blindmap import BlindRegion, find_blind_regions


def build(a: Audit, filt: Filter, axes: list[Axis],
          regions: list[BlindRegion] | None = None) -> dict:
    axis_index = {ax.name: ax for ax in axes}
    if regions is None:
        regions = find_blind_regions(a, [ax.name for ax in axes])

    return {
        "certificate": "exclusion/v0",
        "generated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "space": {
            "name": a.space_name,
            "prior": a.prior_note,
            "axes": [
                {"name": ax.name, "kind": ax.kind, "lo": ax.lo, "hi": ax.hi,
                 "unit": ax.unit, "note": ax.note}
                for ax in axes
            ],
        },
        "filter": {
            "name": a.filter_name,
            "fingerprint": a.filter_fingerprint,
            "policy": filt.spec(),
        },
        "estimate": {
            "method": "exhaustive" if a.exact else "monte-carlo",
            "samples": a.n,
            "discovery_reach": round(a.reach, 6),
            "blind_fraction": round(a.blind, 6),
        },
        "attribution": [
            {"node": s.name, "parent": s.parent, "kind": s.kind,
             "rationale": s.rationale,
             "coverage": None if s.coverage != s.coverage else round(s.coverage, 6),
             "exclusive": None if s.exclusive != s.exclusive else round(s.exclusive, 6),
             "cost_if_lifted": None if s.cost != s.cost else round(s.cost, 6)}
            for s in sorted(a.nodes, key=lambda s: -(s.coverage or 0))
        ],
        "blind_regions": [
            {"rule": r.render(axis_index), "prior_mass": round(r.mass, 6),
             "reach_within": round(r.reach_within, 8)}
            for r in regions
        ],
        "caveat":
            "Reach is defined relative to the stated prior over signal space. "
            "It is a property of (instrument response, filter policy, prior) "
            "jointly, and is not comparable across differing priors.",
    }


def dumps(cert: dict) -> str:
    return json.dumps(cert, indent=2)
