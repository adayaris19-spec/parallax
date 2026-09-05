"""
Naming the blind region.

A reach number alone is not useful - "we miss 88% of it" invites a shrug. What
changes behaviour is a sentence a physicist can argue with:

    m < 94 GeV and n_vis > 6 and f_lep < 0.12   ->  reach 0.000  (11.4% of prior mass)

So this module extracts human-readable boxes from the blind set: greedy
conjunctive rules grown to maximise prior mass while holding survival at zero.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from .core import Audit, Axis


@dataclass
class BlindRegion:
    constraints: list[tuple[str, str, float]] = field(default_factory=list)
    mass: float = 0.0            # share of total prior mass
    reach_within: float = 0.0    # survival rate inside the box

    def tidy(self, axes: dict[str, Axis]) -> "BlindRegion":
        """Keep only the binding constraint per (axis, direction), and drop any
        that merely restate the edge of the space."""
        tightest: dict[tuple[str, str], float] = {}
        for name, op, thr in self.constraints:
            key = (name, op)
            if key not in tightest:
                tightest[key] = thr
            else:
                tightest[key] = min(tightest[key], thr) if op == "<=" \
                    else max(tightest[key], thr)
        kept = []
        for (name, op), thr in tightest.items():
            ax = axes.get(name)
            if ax is not None:
                span = ax.hi - ax.lo
                if op == "<=" and thr >= ax.hi - 1e-9 * max(span, 1):
                    continue
                if op == ">=" and thr <= ax.lo + 1e-9 * max(span, 1):
                    continue
            kept.append((name, op, thr))
        self.constraints = kept
        return self

    def render(self, axes: dict[str, Axis]) -> str:
        self.tidy(axes)
        if not self.constraints:
            return "(everywhere)"
        parts = []
        for name, op, thr in self.constraints:
            ax = axes.get(name)
            unit = f" {ax.unit}" if ax and ax.unit else ""
            if ax and ax.kind == "int":
                parts.append(f"{name} {op} {int(round(thr))}{unit}")
            else:
                parts.append(f"{name} {op} {thr:.3g}{unit}")
        return " and ".join(parts)


def _candidate_thresholds(values: np.ndarray, k: int = 12) -> np.ndarray:
    qs = np.linspace(0.05, 0.95, k)
    return np.unique(np.quantile(values, qs))


def find_blind_regions(
    a: Audit,
    axis_names: list[str],
    max_regions: int = 4,
    min_mass: float = 0.005,
    max_reach_within: float = 0.005,
    max_depth: int = 6,
) -> list[BlindRegion]:
    """
    Greedily grow conjunctive boxes containing only signals the filter destroys.

    Each region is maximal in the greedy sense: constraints are added while they
    still keep survival at (essentially) zero, preferring the constraint that
    retains the most blind prior mass.
    """
    w = a.weights
    survives = a.survives
    available = np.ones(len(w), dtype=bool)
    regions: list[BlindRegion] = []

    for _ in range(max_regions):
        in_box = available.copy()
        if not in_box.any():
            break
        constraints: list[tuple[str, str, float]] = []

        for _ in range(max_depth):
            best = None
            base_blind = float(w[in_box & ~survives].sum())
            for name in axis_names:
                vals = a.table.get(name)
                if vals is None:
                    continue
                blind_vals = vals[in_box & ~survives]
                if blind_vals.size == 0:
                    continue
                for thr in _candidate_thresholds(blind_vals):
                    for op, sel in (("<=", vals <= thr), (">=", vals >= thr)):
                        cand = in_box & sel
                        blind_mass = float(w[cand & ~survives].sum())
                        live_mass = float(w[cand & survives].sum())
                        if blind_mass < min_mass:
                            continue
                        # prefer purity, then retained blind mass
                        score = blind_mass / (blind_mass + live_mass * 40.0)
                        score *= blind_mass / max(base_blind, 1e-12)
                        if best is None or score > best[0]:
                            best = (score, name, op, thr, cand, blind_mass, live_mass)
            if best is None:
                break
            _, name, op, thr, cand, blind_mass, live_mass = best
            if (name, op, float(thr)) in constraints:
                break
            in_box = cand
            constraints.append((name, op, float(thr)))
            if live_mass / max(blind_mass + live_mass, 1e-12) <= max_reach_within:
                break

        box_mass = float(w[in_box].sum())
        live = float(w[in_box & survives].sum())
        if box_mass < min_mass or not constraints:
            break
        if box_mass and live / box_mass > max_reach_within:
            available &= ~in_box
            continue
        regions.append(BlindRegion(
            constraints=constraints,
            mass=box_mass,
            reach_within=live / box_mass if box_mass else 0.0,
        ))
        available &= ~in_box

    return regions


def reach_map(a: Audit, x: str, y: str, bins: int = 24) -> dict:
    """Reach on a 2-D grid, for plotting the shape of what is lost."""
    xv, yv = a.table[x], a.table[y]
    xe = np.linspace(xv.min(), xv.max(), bins + 1)
    ye = np.linspace(yv.min(), yv.max(), bins + 1)
    tot, _, _ = np.histogram2d(xv, yv, bins=[xe, ye], weights=a.weights)
    hit, _, _ = np.histogram2d(xv[a.survives], yv[a.survives],
                               bins=[xe, ye], weights=a.weights[a.survives])
    with np.errstate(invalid="ignore", divide="ignore"):
        grid = np.where(tot > 0, hit / tot, np.nan)
    return {"x": x, "y": y, "x_edges": xe.tolist(), "y_edges": ye.tolist(),
            "reach": grid.tolist()}
