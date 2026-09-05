"""
The ATLAS Run-2 primary trigger menu, audited for what it cannot see.

PROVENANCE AND A WARNING
------------------------
These chain names and thresholds are the published ATLAS Run-2 (2017-2018)
primary single-object and energy-sum triggers, encoded from documented public
values. THEY WERE NOT VERIFIED AGAINST THE SOURCE IN THE SESSION THAT WROTE THIS
FILE - the machine had no outbound network access. Every entry therefore carries
its own `confidence` and a `verify` pointer, and `VERIFICATION_CHECKLIST` at the
bottom lists exactly what to confirm and where.

This is deliberate, not sloppy. The whole point of `reach.robust` is that an
audit whose conclusion depends on getting each number exactly right is not worth
publishing. So every threshold here is a knob, the sweep varies all of them
together over a generous range, and the claims are reported with survival rates.
If a conclusion only holds when HLT_j420 is exactly 420 GeV, the sweep will say
so and you should not believe it.

Correct any number below and re-run; nothing downstream needs to change.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Mapping

import numpy as np

from ..core import All, Any_, Axis, Cut, Filter, SignalSpace
from ..robust import Knob

ATLAS_PUBLIC = ("ATLAS Trigger Operation public results / the Run-2 trigger "
                "menu papers; check the TriggerOperationPublicResults page")


@dataclass(frozen=True)
class Threshold:
    value: float
    unit: str
    chain: str
    confidence: str
    verify: str = ATLAS_PUBLIC
    note: str = ""


# --- the menu as published --------------------------------------------------

NOMINAL: dict[str, Threshold] = {
    "mu_iso": Threshold(26.0, "GeV", "HLT_mu26_ivarmedium", "high",
                        note="the single-muon workhorse for 2017-2018"),
    "mu_noniso": Threshold(50.0, "GeV", "HLT_mu50", "high",
                           note="isolation-free backup, recovers high-pT muons"),
    "e_iso": Threshold(26.0, "GeV", "HLT_e26_lhtight_nod0_ivarloose", "high"),
    "e_med": Threshold(60.0, "GeV", "HLT_e60_lhmedium_nod0", "high"),
    "e_loose": Threshold(140.0, "GeV", "HLT_e140_lhloose_nod0", "high"),
    "g_single": Threshold(140.0, "GeV", "HLT_g140_loose", "high"),
    "j_single": Threshold(420.0, "GeV", "HLT_j420", "medium",
                          note="was 380 GeV in 2016; moved to 420 for 2017-18"),
    "j_four": Threshold(120.0, "GeV", "HLT_4j120", "medium"),
    "ht": Threshold(1000.0, "GeV", "HLT_ht1000_L1J100", "medium"),
    "met": Threshold(110.0, "GeV", "HLT_xe110_pufit_L1XE55", "medium",
                     note="the MET threshold rose through Run 2 as pile-up grew"),
    "dimu": Threshold(14.0, "GeV", "HLT_2mu14", "medium"),
    "diel": Threshold(17.0, "GeV", "HLT_2e17_lhvloose_nod0", "medium"),
}

# --- detector geometry, metres ----------------------------------------------

GEOMETRY = {
    "r_tracker": Threshold(1.1, "m", "inner detector outer radius", "high",
                           verify="ATLAS detector paper",
                           note="past this there is no track, so no electron ID"),
    "r_calo": Threshold(4.25, "m", "hadronic calorimeter outer radius", "medium",
                        verify="ATLAS detector paper"),
    "r_muon": Threshold(11.0, "m", "muon spectrometer outer radius", "medium",
                        verify="ATLAS detector paper"),
}

RATES = {
    "bunch_crossing_hz": (40e6, "high", "40 MHz design bunch crossing rate"),
    "l1_accept_hz": (100e3, "high", "L1 output ~100 kHz"),
    "hlt_accept_hz": (1.2e3, "medium", "HLT output ~1.0-1.2 kHz averaged"),
}


def kept_fraction() -> float:
    """The share of collisions that are written to permanent storage at all."""
    return RATES["hlt_accept_hz"][0] / RATES["bunch_crossing_hz"][0]


# --- signal space -----------------------------------------------------------

AXES = [
    Axis("m", "log", 1.0, 5000.0, "GeV", note="mass scale of the produced state"),
    Axis("n_vis", "int", 2, 20, "", note="visible final-state objects"),
    Axis("f_vis", "lin", 0.0, 1.0, "", note="fraction of mass that is visible"),
    Axis("f_lep", "lin", 0.0, 1.0, "", note="fraction of objects that are e/mu"),
    Axis("ctau", "log", 1e-6, 10.0, "m", note="proper decay length"),
    Axis("gamma", "log", 1.0, 20.0, "", note="Lorentz boost"),
]


def build_space(params: Mapping[str, float] | None = None) -> SignalSpace:
    p = dict(params or {})
    hardness = p.get("hardness", 1.6)      # how much the leading object leads
    r_calo = GEOMETRY["r_calo"].value * p.get("r_calo", 1.0)

    def derive(t):
        m, n, f_vis, f_lep = t["m"], t["n_vis"], t["f_vis"], t["f_lep"]
        e_vis = m * f_vis
        per_object = e_vis / n
        pt_lead = np.minimum(per_object * hardness, m / 2.0)
        n_lep = np.floor(n * f_lep)
        displacement = t["ctau"] * t["gamma"]
        escaped = np.where(displacement > r_calo, e_vis, 0.0)
        return {
            "e_vis": e_vis, "ht": e_vis, "per_object": per_object,
            "pt_lead": pt_lead, "n_lep": n_lep, "n_jet": n - n_lep,
            "displacement": displacement,
            "met": m * (1.0 - f_vis) + escaped,
        }

    return SignalSpace(
        name="generic-bsm-final-state",
        axes=AXES,
        derive=derive,
        description="Model-agnostic final states parameterised by what a "
                    "detector would see rather than by a Lagrangian.",
        prior_note=(
            "Log-uniform in mass (1-5000 GeV) and proper decay length "
            "(1e-6 to 10 m); uniform in visible fraction, leptonic fraction and "
            "multiplicity 2-20. A flat statement of ignorance over final-state "
            "CONFIGURATIONS, not a cross-section prior: it asks which of the "
            "things that could exist could be recorded, not which are likely. "
            "See the prior-family sweep for how reach moves under falling "
            "mass priors."
        ),
    )


SPACE = build_space()


def build_menu(scale: Mapping[str, float] | None = None) -> Filter:
    """The published menu, with every threshold multiplied by an optional knob."""
    s = dict(scale or {})

    def th(key: str) -> float:
        return NOMINAL[key].value * s.get(key, 1.0)

    r_track = GEOMETRY["r_tracker"].value * s.get("r_tracker", 1.0)
    r_calo = GEOMETRY["r_calo"].value * s.get("r_calo", 1.0)
    r_muon = GEOMETRY["r_muon"].value * s.get("r_muon", 1.0)

    tracked = lambda t: t["displacement"] <= r_track
    in_calo = lambda t: t["displacement"] <= r_calo
    in_muon = lambda t: t["displacement"] <= r_muon

    def lepton_path(name, thr_key, reach_fn, geo_note):
        c = NOMINAL[thr_key]
        return All(name, [
            Cut(f"{name}_has_lepton", lambda t: t["n_lep"] >= 1,
                "the chain requires a reconstructed lepton", ("n_lep",)),
            Cut(f"{name}_pt", lambda t, k=thr_key: t["pt_lead"] >= th(k),
                f"{c.chain}: {c.value} {c.unit} threshold, set by output "
                f"bandwidth rather than by physics", ("pt_lead",)),
            Cut(f"{name}_geom", reach_fn, geo_note, ("displacement",)),
        ], c.chain)

    paths = [
        lepton_path("mu_iso", "mu_iso", in_muon,
                    "muon spectrometer reaches ~11 m, so muons survive "
                    "displacement better than anything else"),
        lepton_path("mu_noniso", "mu_noniso", in_muon,
                    "same acceptance, higher threshold, no isolation"),
        lepton_path("e_iso", "e_iso", tracked,
                    "electron identification needs a track: dies past the "
                    "inner detector"),
        lepton_path("e_med", "e_med", tracked, "as above"),
        lepton_path("e_loose", "e_loose", tracked, "as above"),

        All("g_single", [
            Cut("g_pt", lambda t: t["pt_lead"] >= th("g_single"),
                f"{NOMINAL['g_single'].chain}: unconverted photons need only "
                "calorimeter energy", ("pt_lead",)),
            Cut("g_geom", in_calo, "needs an EM calorimeter deposit",
                ("displacement",)),
        ], NOMINAL["g_single"].chain),

        All("j_single", [
            Cut("j_has_jet", lambda t: t["n_jet"] >= 1, "at least one jet",
                ("n_jet",)),
            Cut("j_pt", lambda t: t["pt_lead"] >= th("j_single"),
                f"{NOMINAL['j_single'].chain}: the single-jet threshold is "
                "brutal because the QCD dijet rate is enormous - this cut is "
                "made of bandwidth, not of physics", ("pt_lead",)),
            Cut("j_geom", in_calo, "needs a calorimeter deposit",
                ("displacement",)),
        ], NOMINAL["j_single"].chain),

        All("j_four", [
            Cut("j4_count", lambda t: t["n_jet"] >= 4, "four or more jets",
                ("n_jet",)),
            Cut("j4_pt", lambda t: t["per_object"] >= th("j_four"),
                f"{NOMINAL['j_four'].chain}: every jet must clear the "
                "threshold, so soft busy events fail", ("per_object",)),
            Cut("j4_geom", in_calo, "calorimeter deposits", ("displacement",)),
        ], NOMINAL["j_four"].chain),

        All("ht", [
            Cut("ht_sum", lambda t: t["ht"] >= th("ht"),
                f"{NOMINAL['ht'].chain}: scalar sum of transverse energy",
                ("ht",)),
            Cut("ht_geom", in_calo, "the sum is built from calorimeter towers",
                ("displacement",)),
        ], NOMINAL["ht"].chain),

        All("met", [
            Cut("met_thr", lambda t: t["met"] >= th("met"),
                f"{NOMINAL['met'].chain}: missing transverse energy. The only "
                "path that rewards invisibility, and it also catches decays "
                "past the calorimeter", ("met",)),
        ], NOMINAL["met"].chain),

        All("dimu", [
            Cut("dimu_count", lambda t: t["n_lep"] >= 2, "two muons", ("n_lep",)),
            Cut("dimu_pt", lambda t: t["per_object"] >= th("dimu"),
                f"{NOMINAL['dimu'].chain}", ("per_object",)),
            Cut("dimu_geom", in_muon, "muon spectrometer acceptance",
                ("displacement",)),
        ], NOMINAL["dimu"].chain),

        All("diel", [
            Cut("diel_count", lambda t: t["n_lep"] >= 2, "two electrons",
                ("n_lep",)),
            Cut("diel_pt", lambda t: t["per_object"] >= th("diel"),
                f"{NOMINAL['diel'].chain}", ("per_object",)),
            Cut("diel_geom", tracked, "electron ID needs tracks",
                ("displacement",)),
        ], NOMINAL["diel"].chain),
    ]

    return Filter(
        name="atlas-run2-primary-menu",
        root=Any_("menu", paths, "an event is kept if any primary chain fires"),
        description="ATLAS Run-2 (2017-2018) primary single-object and "
                    "energy-sum triggers. Thresholds encoded from documented "
                    "public values; see VERIFICATION_CHECKLIST.",
    )


MENU = build_menu()


# --- what the sweep is allowed to doubt -------------------------------------

KNOBS = [
    Knob("mu_iso", 0.7, 1.5, why="single-muon threshold moved across Run 2"),
    Knob("e_iso", 0.7, 1.5, why="single-electron threshold likewise"),
    Knob("j_single", 0.6, 1.4, why="was 380 GeV in 2016, 420 later"),
    Knob("j_four", 0.6, 1.6, why="multijet thresholds are the least certain here"),
    Knob("ht", 0.6, 1.5, why="HT threshold varied with pile-up"),
    Knob("met", 0.5, 1.8, why="MET threshold rose substantially through Run 2"),
    Knob("dimu", 0.6, 1.6, why="dilepton thresholds least certain"),
    Knob("diel", 0.6, 1.6, why="as above"),
    Knob("hardness", 0.7, 2.2,
         why="how much the leading object leads - a pure modelling choice"),
    Knob("r_tracker", 0.8, 1.3, why="effective tracking radius for electron ID"),
    Knob("r_calo", 0.7, 1.4, why="effective calorimeter containment radius"),
    Knob("r_muon", 0.7, 1.4, why="effective muon spectrometer radius"),
]

VERIFICATION_CHECKLIST = """
Roughly thirty minutes with a browser confirms or corrects every input.

  1. HLT chain names and thresholds  -> ATLAS Trigger Operation public results,
     and the Run-2 trigger menu papers. Confirm: mu26_ivarmedium, mu50,
     e26_lhtight_nod0_ivarloose, e60_lhmedium_nod0, e140_lhloose_nod0,
     g140_loose, j420, 4j120, ht1000, xe110_pufit, 2mu14, 2e17_lhvloose_nod0.
     Note these changed between 2015-16 and 2017-18; this file targets 2017-18.
  2. L1 and HLT output rates          -> same source. Encoded: 100 kHz, ~1.2 kHz
     against a 40 MHz crossing rate.
  3. Detector radii                   -> the ATLAS detector paper. Encoded:
     tracker 1.1 m, calorimeter 4.25 m, muon system 11 m.
  4. Then re-run examples/audit_atlas.py. If the claim survival rates hold,
     the conclusions never depended on the corrections.
"""
