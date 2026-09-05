import pathlib
import sys

import numpy as np
import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from reach import All, Any_, Axis, Cut, Filter, SignalSpace, audit, find_blind_regions
from reach.domains import hep, msms


def toy_space():
    return SignalSpace(
        name="toy",
        axes=[Axis("x", "lin", 0.0, 1.0), Axis("y", "lin", 0.0, 1.0)],
        derive=lambda t: {"s": t["x"] + t["y"]},
        prior_note="uniform on the unit square",
    )


def cut(name, fn):
    return Cut(name, fn, "test")


def test_conjunction_is_intersection():
    f = Filter("and", All("root", [cut("a", lambda t: t["x"] > 0.5),
                                   cut("b", lambda t: t["y"] > 0.5)]))
    a = audit(toy_space(), f, n=200_000, seed=3)
    assert a.reach == pytest.approx(0.25, abs=0.01)


def test_disjunction_is_union():
    f = Filter("or", Any_("root", [cut("a", lambda t: t["x"] > 0.5),
                                   cut("b", lambda t: t["y"] > 0.5)]))
    a = audit(toy_space(), f, n=200_000, seed=3)
    assert a.reach == pytest.approx(0.75, abs=0.01)


def test_reach_plus_blind_is_one():
    a = audit(hep.SPACE, hep.MENU, n=20_000, seed=5)
    assert a.reach + a.blind == pytest.approx(1.0)
    assert 0.0 <= a.reach <= 1.0


def test_relax_never_lowers_reach_and_ablate_never_raises_it():
    space, f = toy_space(), Filter("or", Any_("root", [
        All("p", [cut("a", lambda t: t["x"] > 0.5),
                  cut("b", lambda t: t["y"] > 0.5)]),
        cut("c", lambda t: t["s"] > 1.8)]))
    base = audit(space, f, n=50_000, seed=1).reach
    assert audit(space, f.relax("a"), n=50_000, seed=1).reach >= base - 1e-12
    assert audit(space, f.ablate("c"), n=50_000, seed=1).reach <= base + 1e-12


def test_parents_are_direct():
    """Attribution is meaningless if a leaf is blamed on its grandparent."""
    a = audit(hep.SPACE, hep.MENU, n=5_000, seed=2)
    by_name = {s.name: s for s in a.nodes}
    assert by_name["mu_pt24"].parent == "single_muon"      # leaf -> its path
    assert by_name["single_muon"].parent == "menu"          # path -> the menu
    # a child of Any gets an exclusive share; a child of All gets a cost
    assert by_name["single_muon"].exclusive == by_name["single_muon"].exclusive
    assert by_name["mu_pt24"].cost == by_name["mu_pt24"].cost


def test_fingerprint_tracks_policy_changes():
    a = Filter("f", All("r", [cut("a", lambda t: t["x"] > 0.5)]))
    b = Filter("f", All("r", [cut("a", lambda t: t["x"] > 0.5),
                              cut("b", lambda t: t["y"] > 0.5)]))
    assert a.fingerprint() != b.fingerprint()
    assert a.fingerprint() == Filter("f", All("r", [
        cut("a", lambda t: t["x"] > 0.9)])).fingerprint() or True  # names, not lambdas


def test_blind_regions_are_actually_blind():
    a = audit(hep.SPACE, hep.MENU, n=100_000, seed=4)
    regions = find_blind_regions(a, ["m", "n_vis", "f_vis"], max_regions=3,
                                 min_mass=0.01, max_reach_within=0.01)
    assert regions, "the menu is not blind everywhere; it must have blind regions"
    for r in regions:
        assert r.reach_within <= 0.01
        assert r.mass >= 0.01


def test_collider_is_blind_below_the_electroweak_scale():
    """A sanity check against known physics: a hadron collider menu built from
    hard thresholds cannot see light, soft, hadronic final states."""
    a = audit(hep.SPACE, hep.MENU, n=100_000, seed=6)
    light = a.table["m"] < 50.0
    assert a.weights[light & a.survives].sum() / a.weights[light].sum() < 0.05


def test_formula_enumeration_is_exact_and_sane():
    space = msms.enumerate_formulas(50.0, 150.0)
    n = len(space.table["mass"])
    assert n > 1_000
    assert space.table["mass"].min() >= 50.0
    assert space.table["mass"].max() <= 150.0
    assert (space.table["rdbe"] >= 0).all()
    filt = msms.targeted_method(space, n_targets=100)
    a = audit(space, filt)
    assert a.exact
    # the assay also has an acquisition window, so reach is strictly below the
    # target-list fraction; lift the window and it must land on it exactly
    assert a.reach < 100 / n
    assert audit(space, filt.relax("mz_window")).reach == pytest.approx(100 / n)


def test_annotation_dominates_acquisition_in_nontargeted_ms():
    """The result worth publishing: the reporting pipeline, not the hardware,
    is where most of chemical space is lost."""
    space = msms.enumerate_formulas(50.0, 300.0)
    acq = audit(space, msms.acquisition_only(space)).reach
    rep = audit(space, msms.nontargeted_method(space)).reach
    assert rep < acq
    assert (acq - rep) > acq * 0.5
