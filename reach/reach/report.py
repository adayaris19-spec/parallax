"""Human-readable rendering of an audit."""

from __future__ import annotations

from .core import Audit, Axis
from .blindmap import BlindRegion


def _pct(x: float) -> str:
    if x != x:
        return "     -"
    if 0 < x < 0.0001:
        return f"{x:.2e}"
    return f"{x*100:6.2f}%"


def render(a: Audit, axes: list[Axis], regions: list[BlindRegion]) -> str:
    axis_index = {ax.name: ax for ax in axes}
    w = []
    w.append("=" * 78)
    w.append(f"DISCOVERY REACH  ·  {a.space_name}")
    w.append(f"filter: {a.filter_name}  [{a.filter_fingerprint}]")
    w.append("=" * 78)
    method = "exhaustive" if a.exact else "monte-carlo"
    w.append(f"  signals considered : {a.n:,}  ({method})")
    w.append(f"  REACH              : {_pct(a.reach).strip()}   "
             f"of the stated signal space can be recorded at all")
    w.append(f"  BLIND              : {_pct(a.blind).strip()}   "
             f"is destroyed before a human sees it")
    w.append("")
    w.append("  prior:")
    for line in _wrap(a.prior_note, 70):
        w.append(f"    {line}")
    w.append("")

    menu = [s for s in a.nodes if s.exclusive == s.exclusive]
    if menu:
        w.append("-" * 78)
        w.append("PATHS  ·  what each route admits, and what only it admits")
        w.append("-" * 78)
        w.append(f"  {'path':<22} {'covers':>9} {'unique':>9}")
        for s in sorted(menu, key=lambda s: -s.coverage):
            w.append(f"  {s.name:<22} {_pct(s.coverage):>9} {_pct(s.exclusive):>9}")
        w.append("")

    costs = [s for s in a.nodes if s.cost == s.cost and s.cost > 0]
    if costs:
        w.append("-" * 78)
        w.append("REQUIREMENTS  ·  reach recovered if this single cut were lifted")
        w.append("-" * 78)
        for s in sorted(costs, key=lambda s: -s.cost)[:10]:
            w.append(f"  {s.name:<24} +{_pct(s.cost)}")
            for line in _wrap(s.rationale, 60):
                w.append(f"      {line}")
        w.append("")

    w.append("-" * 78)
    w.append("BLIND REGIONS  ·  where the filter admits nothing at all")
    w.append("-" * 78)
    if not regions:
        w.append("  none large enough to name at the requested resolution")
    for i, r in enumerate(regions, 1):
        w.append(f"  [{i}] {r.render(axis_index)}")
        w.append(f"      prior mass {_pct(r.mass).strip()} · "
                 f"reach inside {r.reach_within:.2e}")
    w.append("=" * 78)
    return "\n".join(w)


def _wrap(text: str, width: int) -> list[str]:
    words, lines, cur = text.split(), [], ""
    for word in words:
        if len(cur) + len(word) + 1 > width:
            lines.append(cur)
            cur = word
        else:
            cur = f"{cur} {word}".strip()
    if cur:
        lines.append(cur)
    return lines
