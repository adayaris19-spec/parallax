"""
A mass-spectrometry method, audited for what it cannot see.

Chemistry gives the cleanest possible statement of the problem, because the
space of possibilities can be written down exactly. Molecular formulas over
CHNOPS within a mass window are enumerable, so reach here is EXACT, not
estimated.

The response models below (ionisation, retention, annotation) are deliberately
crude, documented proxies - not validated instrument simulations. Swap in a real
method's response and the numbers change; the framework does not. What survives
the crudeness is the ordering: which decision destroys the most.

The motivating fact: PFAS entered production in the 1940s and took roughly fifty
years to be recognised as global contamination. That was not a failure of
chemistry. It was a failure of surveillance - nobody was looking, because
targeted methods only find what is on the list.
"""

from __future__ import annotations

import numpy as np

from ..core import All, Axis, Cut, EnumeratedSpace, Filter

MONO = {  # monoisotopic masses, Da
    "C": 12.0,
    "H": 1.00782503207,
    "N": 14.0030740048,
    "O": 15.9949146196,
    "P": 30.97376163,
    "S": 31.97207100,
}

AXES = [
    Axis("mass", "log", 50.0, 500.0, "Da", note="monoisotopic neutral mass"),
    Axis("C", "int", 0, 41, "", note="carbon count"),
    Axis("H", "int", 0, 90, "", note="hydrogen count"),
    Axis("N", "int", 0, 10, "", note="nitrogen count"),
    Axis("O", "int", 0, 20, "", note="oxygen count"),
    Axis("P", "int", 0, 4, "", note="phosphorus count"),
    Axis("S", "int", 0, 6, "", note="sulfur count"),
    Axis("rdbe", "lin", 0, 40, "", note="rings plus double-bond equivalents"),
    Axis("polarity", "lin", 0, 5, "", note="heteroatom-to-carbon ratio proxy"),
]


def enumerate_formulas(mass_lo: float = 50.0, mass_hi: float = 500.0,
                       max_rdbe: float = 40.0) -> EnumeratedSpace:
    """
    Every chemically plausible CHNOPS formula in a mass window.

    Plausibility follows the spirit of the Kind & Fiehn (2007) 'seven golden
    rules' heuristics: element-ratio bounds and a non-negative, bounded RDBE.
    These are heuristics, and they themselves exclude exotic-but-real chemistry -
    which is a blind spot of the PRIOR rather than of the instrument, and is
    exactly the kind of thing a certificate should force you to declare.
    """
    C, H, N, O, P, S = [], [], [], [], [], []
    masses = []

    c_max = int(mass_hi // MONO["C"])
    for c in range(0, c_max + 1):
        mc = c * MONO["C"]
        if mc > mass_hi:
            break
        for n in range(0, min(10, int((mass_hi - mc) // MONO["N"])) + 1):
            mn = mc + n * MONO["N"]
            for o in range(0, min(20, int((mass_hi - mn) // MONO["O"])) + 1):
                mo = mn + o * MONO["O"]
                for p in range(0, min(4, int((mass_hi - mo) // MONO["P"])) + 1):
                    mp = mo + p * MONO["P"]
                    for s in range(0, min(6, int((mass_hi - mp) // MONO["S"])) + 1):
                        ms = mp + s * MONO["S"]
                        if ms > mass_hi:
                            break
                        h_lo = max(0, int(np.ceil((mass_lo - ms) / MONO["H"])))
                        h_hi = int((mass_hi - ms) // MONO["H"])
                        for h in range(h_lo, h_hi + 1):
                            m = ms + h * MONO["H"]
                            if not (mass_lo <= m <= mass_hi):
                                continue
                            # ratio heuristics (only meaningful when carbon present)
                            if c > 0:
                                if not (0.2 <= h / c <= 3.1):
                                    continue
                                if n / c > 1.3 or o / c > 1.2:
                                    continue
                                if p / c > 0.3 or s / c > 0.8:
                                    continue
                            elif h + n + o + p + s == 0:
                                continue
                            rdbe = c - h / 2.0 + n / 2.0 + p / 2.0 + 1.0
                            if rdbe < 0 or rdbe > max_rdbe:
                                continue
                            C.append(c); H.append(h); N.append(n)
                            O.append(o); P.append(p); S.append(s)
                            masses.append(m)

    c_a = np.array(C, float); h_a = np.array(H, float); n_a = np.array(N, float)
    o_a = np.array(O, float); p_a = np.array(P, float); s_a = np.array(S, float)
    m_a = np.array(masses, float)

    hetero = n_a + o_a + p_a + s_a
    table = {
        "C": c_a, "H": h_a, "N": n_a, "O": o_a, "P": p_a, "S": s_a,
        "mass": m_a,
        "rdbe": c_a - h_a / 2.0 + n_a / 2.0 + p_a / 2.0 + 1.0,
        "hetero": hetero,
        "polarity": (n_a + o_a + 2.0 * p_a + s_a) / np.maximum(c_a, 1.0),
    }

    return EnumeratedSpace(
        name=f"chnops-formula-space-{int(mass_lo)}-{int(mass_hi)}Da",
        table=table,
        axes=AXES,
        description="All chemically plausible CHNOPS molecular formulas in the "
                    "stated mass window.",
        prior_note=(
            "Uniform over ENUMERATED FORMULAS, not over molecules: each formula "
            "counts once regardless of how many structural isomers realise it, "
            "and isomer count grows steeply with carbon number. A per-structure "
            "prior would weight large molecules far more heavily and lower reach "
            "further. Formulas are restricted to CHNOPS and to Kind & Fiehn-style "
            "ratio heuristics, so halogenated and metal-containing chemistry - "
            "including most PFAS - is outside this prior entirely."
        ),
    )


def _target_list(space: EnumeratedSpace, n_targets: int, seed: int = 7) -> np.ndarray:
    size = len(space.table["mass"])
    rng = np.random.default_rng(seed)
    idx = rng.choice(size, size=min(n_targets, size), replace=False)
    flag = np.zeros(size, dtype=bool)
    flag[idx] = True
    return flag


def targeted_method(space: EnumeratedSpace, n_targets: int = 600) -> Filter:
    """A targeted MRM assay: it can only find what is already on the list."""
    on_list = _target_list(space, n_targets)

    return Filter(
        name=f"targeted-mrm-{n_targets}-analytes",
        root=All("targeted_method", [
            Cut("on_target_list", lambda t: on_list,
                f"the method monitors {n_targets} specific transitions; "
                "everything else is invisible by construction",
                ("formula",)),
            Cut("mz_window", lambda t: (t["mass"] >= 100.0) & (t["mass"] <= 1000.0),
                "acquisition window", ("mass",)),
        ], "a targeted assay is a filter whose blindness equals its target list"),
        description="Targeted multiple-reaction-monitoring assay.",
    )


def nontargeted_method(space: EnumeratedSpace, library_size: int = 25_000) -> Filter:
    """
    Full-scan high-resolution MS, which is supposed to see everything - and does
    not. The interesting result is that a large, nameable blind region survives
    even here, and that the dominant loss is at ANNOTATION rather than at
    acquisition.
    """
    in_library = _target_list(space, library_size, seed=11)

    return Filter(
        name="nontargeted-hrms-esi-pos-rplc",
        root=All("nontargeted_method", [
            Cut("mz_window", lambda t: (t["mass"] >= 100.0) & (t["mass"] <= 1000.0),
                "scan range starts at m/z 100 to avoid solvent clusters; "
                "small molecules are discarded before anything else happens",
                ("mass",)),
            Cut("ionises_esi_pos", lambda t: (t["N"] >= 1) | (t["hetero"] >= 2),
                "CRUDE PROXY: electrospray in positive mode needs a "
                "protonatable site; pure hydrocarbons are largely blind",
                ("N", "hetero")),
            Cut("elutes_in_gradient",
                lambda t: (t["polarity"] <= 0.8) &
                          ~((t["C"] >= 30) & (t["polarity"] < 0.05)),
                "CRUDE PROXY: very polar analytes elute in the void volume with "
                "the salts and are cut; very hydrophobic ones never elute",
                ("polarity", "C")),
            Cut("library_annotatable", lambda t: in_library,
                "a feature that cannot be matched to a spectral library is "
                "typically never reported - this is the 'dark matter of "
                "metabolomics', where only a small percent of detected features "
                "are ever identified",
                ("formula",)),
        ], "full-scan acquisition followed by library-based reporting"),
        description="Non-targeted HRMS, ESI positive, reversed-phase LC, with "
                    "library-based annotation.",
    )


def acquisition_only(space: EnumeratedSpace) -> Filter:
    """The same method with the annotation stage removed, to separate what the
    hardware cannot detect from what the reporting pipeline discards."""
    full = nontargeted_method(space)
    # relax, not ablate: removing a child of an All would kill the whole path
    f = full.relax("library_annotatable")
    return Filter("nontargeted-hrms-acquisition-only", f.root,
                  "Same acquisition, with the annotation stage lifted, so that "
                  "hardware blindness can be separated from reporting blindness.")
