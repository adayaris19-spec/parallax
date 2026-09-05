"""
Robustness: does the CONCLUSION survive the assumptions being wrong?

This module exists because of an objection to the rest of the library that is
entirely correct. The response models in `reach.domains` are crude proxies. The
trigger thresholds may be misremembered. The priors are choices. A blindness
audit that reports "reach = 35.79%" and stops is therefore worth very little,
because the reader has no way to tell whether 35.79 is a result or an artefact
of somebody's guesses.

The resolution is that the claims worth making are almost never point estimates.
They are ORDERINGS and INEQUALITIES:

    "annotation destroys more reach than acquisition does"
    "no single-object path recovers the light hadronic region"
    "lifting one threshold recovers more than a fifth of the space"

Orderings are far more robust than the numbers underneath them, and robustness
is computable: perturb every uncertain input over its stated plausible range,
re-run, and report the fraction of the ensemble in which each claim still holds.

An audit should ship claims with survival rates, not numbers with false
precision. That is the methodological contribution of this file.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable, Mapping, Sequence

import numpy as np


@dataclass(frozen=True)
class Knob:
    """An uncertain input, and the range over which it is honestly uncertain."""

    name: str
    lo: float
    hi: float
    kind: str = "scale"      # 'scale' multiplies a nominal value; 'value' replaces it
    why: str = ""

    def draw(self, rng: np.random.Generator) -> float:
        if self.lo <= 0 or self.hi <= 0:
            return float(rng.uniform(self.lo, self.hi))
        return float(np.exp(rng.uniform(np.log(self.lo), np.log(self.hi))))


@dataclass(frozen=True)
class Claim:
    """A qualitative statement, and the test that decides it on one draw."""

    name: str
    statement: str
    test: Callable[[Mapping[str, float]], bool]
    matters_because: str = ""


@dataclass
class Ensemble:
    draws: int
    knobs: list[Knob]
    quantities: dict[str, np.ndarray] = field(default_factory=dict)
    claims: list[Claim] = field(default_factory=list)
    survival: dict[str, float] = field(default_factory=dict)
    failures: dict[str, list[dict]] = field(default_factory=dict)

    def summary(self, key: str) -> dict:
        v = self.quantities[key]
        return {
            "median": float(np.median(v)),
            "p05": float(np.quantile(v, 0.05)),
            "p95": float(np.quantile(v, 0.95)),
            "min": float(v.min()),
            "max": float(v.max()),
        }


def sweep(run: Callable[[Mapping[str, float]], Mapping[str, float]],
          knobs: Sequence[Knob],
          claims: Sequence[Claim],
          draws: int = 200,
          seed: int = 0,
          keep_failures: int = 3) -> Ensemble:
    """
    Run `run` across the joint uncertainty of every knob.

    `run` receives a mapping of knob name -> drawn value and returns whatever
    scalars the claims are written against. Every knob is varied simultaneously,
    not one at a time: one-at-a-time sensitivity systematically understates how
    fragile a conclusion is.
    """
    rng = np.random.default_rng(seed)
    rows: list[dict[str, float]] = []
    settings: list[dict[str, float]] = []

    for _ in range(draws):
        params = {k.name: k.draw(rng) for k in knobs}
        rows.append(dict(run(params)))
        settings.append(params)

    keys = sorted({k for r in rows for k in r})
    quantities = {k: np.array([r.get(k, np.nan) for r in rows]) for k in keys}

    survival: dict[str, float] = {}
    failures: dict[str, list[dict]] = {}
    for c in claims:
        held = np.array([bool(c.test(r)) for r in rows])
        survival[c.name] = float(held.mean())
        bad = [dict(settings[i], **{"_q": rows[i]}) for i in np.flatnonzero(~held)]
        failures[c.name] = bad[:keep_failures]

    return Ensemble(draws=draws, knobs=list(knobs), quantities=quantities,
                    claims=list(claims), survival=survival, failures=failures)


# --------------------------------------------------------------------------
# priors are choices: reweight rather than resample
# --------------------------------------------------------------------------


def reweight(table, weights, factors: Mapping[str, Callable[[np.ndarray], np.ndarray]]):
    """
    Apply importance weights to an existing draw, so a whole family of priors can
    be evaluated from one sample. `factors` maps an axis name to a positive
    density ratio relative to the prior the sample was drawn from.
    """
    w = np.array(weights, dtype=float)
    for name, fn in factors.items():
        w = w * np.asarray(fn(table[name]), dtype=float)
    total = w.sum()
    if total <= 0:
        raise ValueError("reweighting produced zero total mass")
    return w / total


def reach_under(table, weights, survives, factors) -> float:
    w = reweight(table, weights, factors)
    return float(w[survives].sum())


def power_law(alpha: float) -> Callable[[np.ndarray], np.ndarray]:
    """Density ratio for a falling m^-alpha prior against a log-uniform draw."""
    return lambda x: np.power(np.maximum(x, 1e-12), -float(alpha))


# --------------------------------------------------------------------------
# reporting
# --------------------------------------------------------------------------


def render(e: Ensemble, headline: str, quantity_keys: Sequence[str]) -> str:
    w = ["=" * 78,
         f"ROBUSTNESS  ·  {headline}",
         f"{e.draws} draws, all {len(e.knobs)} uncertain inputs varied together",
         "=" * 78, "", "  uncertain inputs:"]
    for k in e.knobs:
        w.append(f"    {k.name:<26} x[{k.lo:g}, {k.hi:g}]   {k.why}")
    w.append("")
    w.append("  quantities across the ensemble:")
    w.append(f"    {'':<26}{'p05':>9}{'median':>9}{'p95':>9}")
    for key in quantity_keys:
        if key not in e.quantities:
            continue
        s = e.summary(key)
        w.append(f"    {key:<26}{s['p05']*100:8.2f}%{s['median']*100:8.2f}%"
                 f"{s['p95']*100:8.2f}%")
    w.append("")
    w.append("-" * 78)
    w.append("CLAIM SURVIVAL  ·  fraction of the ensemble in which each holds")
    w.append("-" * 78)
    for c in e.claims:
        s = e.survival[c.name]
        mark = "ROBUST  " if s >= 0.95 else ("LIKELY  " if s >= 0.8 else
                                             ("SHAKY   " if s >= 0.5 else "FAILS   "))
        w.append(f"  {mark} {s*100:5.1f}%   {c.statement}")
        if c.matters_because:
            w.append(f"                    ({c.matters_because})")
    w.append("=" * 78)
    return "\n".join(w)
