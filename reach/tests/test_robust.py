import pathlib
import sys

import numpy as np
import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from reach import audit
from reach.robust import (Claim, Knob, power_law, reach_under, reweight, sweep)
from reach.domains import atlas_run2 as atlas


def test_certain_claims_survive_and_false_ones_do_not():
    knobs = [Knob("a", 0.5, 2.0, why="test")]
    e = sweep(lambda p: {"x": p["a"]}, knobs,
              [Claim("always", "x is positive", lambda q: q["x"] > 0),
               Claim("never", "x exceeds 100", lambda q: q["x"] > 100)],
              draws=30, seed=1)
    assert e.survival["always"] == 1.0
    assert e.survival["never"] == 0.0


def test_sweep_varies_every_knob_together():
    """One-at-a-time sensitivity understates fragility; the sweep must be joint."""
    knobs = [Knob("a", 0.5, 2.0, why=""), Knob("b", 0.5, 2.0, why="")]
    e = sweep(lambda p: {"prod": p["a"] * p["b"]}, knobs, [], draws=200, seed=2)
    spread = e.quantities["prod"]
    assert spread.min() < 0.6 and spread.max() > 1.7


def test_failures_are_recorded_for_diagnosis():
    knobs = [Knob("a", 0.5, 2.0, why="")]
    e = sweep(lambda p: {"x": p["a"]}, knobs,
              [Claim("big", "x > 1", lambda q: q["x"] > 1.0)], draws=40, seed=3)
    assert 0.0 < e.survival["big"] < 1.0
    assert e.failures["big"], "a claim that sometimes fails must record how"
    assert all(f["a"] <= 1.0 for f in e.failures["big"])


def test_reweight_renormalises():
    table = {"m": np.array([1.0, 10.0, 100.0, 1000.0])}
    w = np.full(4, 0.25)
    out = reweight(table, w, {"m": power_law(1.0)})
    assert out.sum() == pytest.approx(1.0)
    assert out[0] > out[-1], "a falling prior must favour light states"


def test_falling_mass_prior_lowers_reach_for_a_high_threshold_menu():
    """The menu is blind at low mass, so weighting low mass down-weights reach.
    This is the quantitative form of 'a reach number without its prior is
    not a result'."""
    a = audit(atlas.SPACE, atlas.MENU, n=40_000, seed=7, attribute=False)
    flat = a.reach
    steep = reach_under(a.table, a.weights, a.survives, {"m": power_law(1.5)})
    assert steep < flat / 10.0


def test_bandwidth_beats_geometry_survives_perturbation():
    """The headline claim, as an integration test: energy thresholds destroy
    far more reach than detector geometry, whatever the exact numbers."""
    N = 20_000
    rng = np.random.default_rng(3)
    base = {ax.name: ax.draw(N, rng) for ax in atlas.AXES}
    w = np.full(N, 1.0 / N)
    thresholds = list(atlas.NOMINAL)
    radii = ["r_tracker", "r_calo", "r_muon"]

    def run(params):
        table = dict(base)
        table.update(atlas.build_space(params).derive(table))
        menu = atlas.build_menu(params)
        r = float(w[menu.evaluate(table)].sum())
        no_t = atlas.build_menu({**params, **{k: 1e-6 for k in thresholds}})
        no_g = atlas.build_menu({**params, **{k: 1e6 for k in radii}})
        return {"gain_thresholds": float(w[no_t.evaluate(table)].sum()) - r,
                "gain_geometry": float(w[no_g.evaluate(table)].sum()) - r,
                "reach": r}

    e = sweep(run, atlas.KNOBS,
              [Claim("bandwidth", "thresholds beat geometry",
                     lambda q: q["gain_thresholds"] > q["gain_geometry"]),
               Claim("under_half", "reach below half", lambda q: q["reach"] < 0.5)],
              draws=25, seed=4)
    assert e.survival["bandwidth"] == 1.0
    assert e.survival["under_half"] == 1.0


def test_every_encoded_threshold_declares_its_confidence():
    """Unverified inputs must say so, or the audit is dishonest."""
    allowed = {"high", "medium", "low"}
    for key, t in atlas.NOMINAL.items():
        assert t.confidence in allowed, key
        assert t.chain and t.verify
    for key, g in atlas.GEOMETRY.items():
        assert g.confidence in allowed, key


def test_every_uncertain_threshold_has_a_knob_or_is_pinned():
    """Anything the sweep cannot doubt should be a deliberate choice."""
    knobbed = {k.name for k in atlas.KNOBS}
    unknobbed = set(atlas.NOMINAL) - knobbed
    # the remaining ones are backup chains at higher thresholds; they cannot
    # dominate reach because a lower-threshold chain in the same object already
    # fires wherever they would
    assert unknobbed <= {"mu_noniso", "e_med", "e_loose", "g_single"}
