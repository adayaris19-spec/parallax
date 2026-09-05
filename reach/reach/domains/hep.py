"""
A hadron collider trigger, audited for what it cannot see.

IMPORTANT - what this is and is not. The kinematics below are order-of-magnitude
parameterisations, and the trigger thresholds are representative of the public
scale of an LHC general-purpose menu, not any experiment's actual menu. Nothing
here should be quoted as a statement about ATLAS or CMS.

The contribution is the METHOD: state a space of things that could exist, state
the filter, and compute what the filter destroys. The numbers move when you
supply a real detector response and a real menu; the framework does not.

A collider trigger is the sharpest example in science of the general problem.
Collisions arrive at ~40 MHz and roughly one in 10^5 is written to disk. The
discard is irreversible, happens in microseconds, in hardware, and the rules
were written from the models people expected to test.
"""

from __future__ import annotations

import numpy as np

from ..core import All, Any_, Axis, Cut, Filter, SignalSpace

# Detector geometry, in metres - where a decay has to happen to leave a signature.
R_TRACKER = 1.0     # beyond this, no track: kills anything needing a charged track
R_CALO = 4.0        # beyond this, no calorimeter deposit
R_MUON = 10.0       # beyond this, the particle has left the building

AXES = [
    Axis("m", "log", 1.0, 5000.0, "GeV",
         note="mass scale of the produced state"),
    Axis("n_vis", "int", 2, 20, "",
         note="number of visible final-state objects"),
    Axis("f_vis", "lin", 0.0, 1.0, "",
         note="fraction of the mass appearing as visible energy"),
    Axis("f_lep", "lin", 0.0, 1.0, "",
         note="fraction of visible objects that are electrons or muons"),
    Axis("ctau", "log", 1e-6, 10.0, "m",
         note="proper decay length"),
    Axis("gamma", "log", 1.0, 20.0, "",
         note="Lorentz boost of the decaying state"),
]


def derive(t):
    m, n, f_vis, f_lep = t["m"], t["n_vis"], t["f_vis"], t["f_lep"]

    e_vis = m * f_vis                       # total visible energy
    ht = e_vis
    per_object = e_vis / n
    # the leading object carries more than its share; cap at the 2-body limit
    pt_lead = np.minimum(per_object * 1.6, m / 2.0)

    n_lep = np.floor(n * f_lep)
    n_jet = n - n_lep

    displacement = t["ctau"] * t["gamma"]

    # energy that escapes the calorimeter reads as missing energy, so a
    # sufficiently long-lived visible decay converts into MET
    escaped = np.where(displacement > R_CALO, e_vis, 0.0)
    met = m * (1.0 - f_vis) + escaped

    return {
        "e_vis": e_vis, "ht": ht, "per_object": per_object, "pt_lead": pt_lead,
        "n_lep": n_lep, "n_jet": n_jet, "displacement": displacement, "met": met,
    }


SPACE = SignalSpace(
    name="generic-bsm-final-state",
    axes=AXES,
    derive=derive,
    description="Model-agnostic final states from a heavy state produced at a "
                "hadron collider, parameterised by what a detector would see "
                "rather than by any particular Lagrangian.",
    prior_note=(
        "Log-uniform in mass over 1-5000 GeV and in proper decay length over "
        "1e-6 to 10 m; uniform in visible-energy fraction, leptonic fraction "
        "and object multiplicity 2-20. This is a deliberately flat statement of "
        "ignorance, NOT a production cross-section prior: it asks 'of the "
        "final-state configurations that could exist, which could we record?', "
        "not 'which are likely?'. A cross-section-weighted prior gives a very "
        "different and equally legitimate number - state which you mean."
    ),
)


def _menu() -> Filter:
    """A representative single-object / energy-sum trigger menu."""

    def trackable(t):
        return t["displacement"] <= R_TRACKER

    def calo_visible(t):
        return t["displacement"] <= R_CALO

    def muon_visible(t):
        return t["displacement"] <= R_MUON

    single_mu = All("single_muon", [
        Cut("mu_present", lambda t: t["n_lep"] >= 1, "at least one lepton", ("n_lep",)),
        Cut("mu_pt24", lambda t: t["pt_lead"] >= 24.0,
            "single-muon threshold; set by rate, tuned for W/Z/top", ("pt_lead",)),
        Cut("mu_in_acceptance", muon_visible,
            "muon system reaches ~10 m", ("displacement",)),
    ], "the workhorse path: one hard, prompt-ish lepton")

    single_eg = All("single_egamma", [
        Cut("eg_present", lambda t: t["n_lep"] >= 1, "at least one lepton", ("n_lep",)),
        Cut("eg_pt30", lambda t: t["pt_lead"] >= 30.0,
            "single-electron/photon threshold", ("pt_lead",)),
        Cut("eg_tracked", trackable,
            "electron identification needs a track: dies past the tracker",
            ("displacement",)),
    ], "one hard electron or photon")

    single_jet = All("single_jet", [
        Cut("jet_present", lambda t: t["n_jet"] >= 1, "at least one jet", ("n_jet",)),
        Cut("jet_pt450", lambda t: t["pt_lead"] >= 450.0,
            "single-jet threshold is brutal because QCD rate is enormous",
            ("pt_lead",)),
        Cut("jet_in_calo", calo_visible, "needs a calorimeter deposit",
            ("displacement",)),
    ], "one very hard jet")

    multijet = All("multijet", [
        Cut("four_jets", lambda t: t["n_jet"] >= 4, "four or more jets", ("n_jet",)),
        Cut("each_jet_100", lambda t: t["per_object"] >= 100.0,
            "each jet must clear 100 GeV", ("per_object",)),
        Cut("mj_in_calo", calo_visible, "needs calorimeter deposits",
            ("displacement",)),
    ], "four hard jets")

    ht_path = All("ht_sum", [
        Cut("ht_1000", lambda t: t["ht"] >= 1000.0,
            "scalar sum of transverse energy", ("ht",)),
        Cut("ht_in_calo", calo_visible, "sum is built from calorimeter towers",
            ("displacement",)),
    ], "large total visible energy")

    met_path = All("missing_energy", [
        Cut("met_200", lambda t: t["met"] >= 200.0,
            "missing transverse energy; also catches decays past the calorimeter",
            ("met",)),
    ], "large imbalance - the only path that rewards invisibility")

    dilepton = All("dilepton", [
        Cut("two_leptons", lambda t: t["n_lep"] >= 2, "two leptons", ("n_lep",)),
        Cut("dilep_pt20", lambda t: t["per_object"] >= 20.0,
            "both leptons above 20 GeV", ("per_object",)),
        Cut("dilep_tracked", trackable, "lepton pairing needs tracks",
            ("displacement",)),
    ], "two moderate leptons")

    return Filter(
        name="representative-l1-hlt-menu",
        root=Any_("menu", [single_mu, single_eg, single_jet, multijet,
                           ht_path, met_path, dilepton],
                  "an event is kept if any path fires"),
        description="Representative general-purpose collider trigger menu. "
                    "Thresholds are illustrative of published scales, not any "
                    "experiment's actual menu.",
    )


MENU = _menu()
