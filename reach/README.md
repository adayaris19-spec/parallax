# reach

**Measuring what an instrument cannot see.**

Every experiment publishes its efficiency *for the signal it went looking for*.
ATLAS will quote acceptance for a 2 TeV resonance to four significant figures. A
mass-spectrometry method will quote a limit of detection for the three hundred
compounds on its target list.

Nobody publishes efficiency for the signals they were **not** looking for.

Not because it is uninteresting — because the quantity has no name, no standard
method, and no place in a paper. Which means this sentence is currently not
expressible in the language of science:

> *This apparatus is structurally incapable of recording 60% of the phenomena it
> nominally covers, the cause is bandwidth rather than physics, and here is the
> shape of what it misses.*

`reach` makes it expressible, and — more importantly — makes it **falsifiable**.

---

## The idea

Discovery is bounded by filters, and filters are written from the theories we
already hold.

ATLAS sees collisions at 40 MHz and writes roughly **3 in 100,000** to permanent
storage. The discard is irreversible, decided in microseconds, by rules derived
from the models people expected to test. A targeted assay finds exactly the
compounds on its list and is blind to everything else *by construction*. Every
one of these is a place where the universe was allowed to speak and we decided
in advance which parts to hear.

Each field has independently noticed a local version of this. **None of them
share a metric**, so blindness cannot be compared between instruments, optimised
against, audited, or attached to a dataset.

**Discovery reach** is the proposed quantity:

```
reach = P( signal survives every stage of the filter )   under a stated prior
        over the space of signals that could exist
```

---

## The result

Audit of the **ATLAS Run-2 primary trigger menu** — real published chains
(`HLT_mu26_ivarmedium`, `HLT_j420`, `HLT_xe110_pufit`, …), against a flat prior
over final-state configurations:

```
  REACH   40.43%     of the stated signal space can be recorded at all
  BLIND   59.57%     is destroyed before a human sees it

  PATHS                     covers    unique
  met (HLT_xe110_pufit)     35.16%    14.64%      <- most valuable chain
  mu_iso (HLT_mu26)         22.64%     0.05%
  j_single (HLT_j420)        2.92%     0.00%

  BLIND REGIONS
  [1] m <= 54.5 GeV                    46.9% of prior mass, reach 2.5e-04
  [2] m <= 111 GeV and n_vis >= 6       6.6% of prior mass, reach 4.8e-03
```

The method was told nothing about known blind spots and recovered the
sub-electroweak one. Missing energy comes out as the single most valuable
chain — the only one that rewards a signal for being *invisible* — which is
recognisably right and was not put in by hand.

---

## Why you should believe it, or not

The obvious objection to everything above is correct: the response models are
proxies, the thresholds were encoded without network access to verify them, and
the prior is a choice. An audit reporting `40.43%` and stopping would be worth
nothing, because you could not tell a result from an artefact of my guesses.

**So the framework attacks itself.** `reach.robust` varies every uncertain input
simultaneously over its stated plausible range and reports, for each *qualitative
claim*, the fraction of the ensemble in which it still holds. Claims worth making
are almost never point estimates — they are orderings and inequalities, and
orderings are far more robust than the numbers underneath them.

250 draws, all 12 uncertain inputs varied together:

```
CLAIM SURVIVAL
  ROBUST   100.0%   the menu records less than half of the stated signal space
  ROBUST   100.0%   energy thresholds destroy more reach than detector geometry
  ROBUST   100.0%   missing energy is the most valuable path by unique coverage
  LIKELY    80.8%   light states with no hard lepton are essentially unreachable
  FAILS     10.8%   soft high-multiplicity states have conditional reach < 5%
```

Two things to take from that table.

**The headline claim is bandwidth, not physics.** Abolishing every energy
threshold recovers ~58.6% of reach; abolishing every geometric limit recovers
~0.06%. Three orders of magnitude apart, in 100% of draws. The dominant cause of
blindness at a collider is not what the detector can physically register — it is
what the readout can afford to keep.

**The last line is a claim of mine that the sweep destroyed.** I predicted soft
high-multiplicity states would be blind below 5%; the ensemble says ~10.8%
median, and the claim survives in only 10.8% of draws. It is left in the output
rather than quietly deleted, because a framework that only ever confirms its
author is the exact failure it was built to detect.

---

## Priors are choices, and the choice dominates

Reach is undefined without a prior over what could exist. This is not a caveat
to bury — it is the content of the claim. The same menu, same code, same run,
under a family of falling mass priors `m^-α`:

```
  mass prior                       reach
  log-uniform (baseline)          40.43%
  m^-0.5                           6.79%
  m^-1                             0.67%
  m^-1.5                           0.06%
  m^-2                             0.01%
```

Two and a half orders of magnitude, from the prior alone. Every one of those
numbers is legitimate; they answer different questions. **A reach figure quoted
without its prior is not a result**, and every certificate the tool emits prints
the prior in full.

---

## The second domain

Chemistry, where the space of possibilities is enumerable, so reach is **exact**
rather than sampled — computed over all 1,153,017 plausible CHNOPS formulas
between 50 and 500 Da:

```
  instrument + policy                   reach    blind   largest blind region
  targeted MRM assay                    0.05%   99.95%   (everywhere)
  non-targeted HRMS (acquisition)      45.90%   54.10%   polarity >= 0.833
  non-targeted HRMS (as reported)       1.00%   99.00%   -
```

Read the last two rows together. The acquisition hardware registers 45.9% of the
space; what is **reported** is 1.0%. Some 98% of what the instrument actually
detected dies at library annotation, not at the inlet. Metabolomics calls this
"dark matter"; nobody quotes it as a number, because there was no number to
quote.

That two domains this different reduce to the same three inputs and the same
scalar is the entire universality claim, and it is why this is a metric rather
than a tool.

---

## The exclusion certificate

Every dataset documents what it contains. **None documents what it structurally
could never have contained.** That asymmetry is why blind spots compound
silently when datasets are combined, meta-analysed, or used as training data.

So the tool emits `exclusion/v0`: reach, per-decision attribution, named blind
regions, the stated prior, claim-survival rates, a fingerprint of the exact
policy, and — for the ATLAS audit — the provenance and confidence of every
encoded threshold.

This is the piece I believe is genuinely missing from science's metadata, and
the piece most likely to matter if any of this is right.

---

## What is still unverified

Stated plainly, because the project is about not hiding this.

- **The ATLAS thresholds were encoded from documented public values but not
  checked against the source**, because the machine had no outbound network
  access. Every entry carries its own `confidence` field, and
  `VERIFICATION_CHECKLIST` in `reach/domains/atlas_run2.py` lists exactly what
  to confirm and where — roughly thirty minutes with a browser. The robustness
  sweep exists precisely so that this matters less than it sounds: if a
  conclusion only holds when `HLT_j420` is exactly 420 GeV, the sweep says so.
- **The response models are crude, documented proxies.** Collider kinematics are
  order-of-magnitude parameterisations; the mass-spec ionisation and retention
  models are heuristics. All are labelled in the source.
- **This is not a statement about ATLAS.** It is a statement about a menu shaped
  like the published one, under a prior I chose.

## Prior art, and how to falsify the novelty claim

Trigger-level and data-scouting analyses, anomaly-based triggers, retrospective
suspect screening, and astronomical selection functions all already exist. The
narrow claim here is that no **domain-independent** quantity puts them in the
same units, attributes blindness to individual decisions, and attaches to a
dataset as metadata.

I could not verify that claim — the session that wrote this had no search
budget left. To kill it, look for any of: a metric defined over
(instrument response × filter policy × prior) that is reported across more than
one field; a "selection function" formalism generalised beyond astronomy; or a
dataset standard with a machine-readable exclusion statement. **If one exists,
that is the single most useful thing anyone could tell me**, and this repository
should be retired in its favour.

---

## Use

```bash
pip install numpy
python examples/audit_atlas.py        # real menu + robustness + prior family
python examples/audit_collider.py     # simplified menu, for comparison
python examples/audit_massspec.py     # exact audit of three MS methods
python examples/ledger.py             # one metric across four instruments
python -m pytest tests/ -q            # 18 tests
```

Defining an audit means stating three things — and a fourth, if you want to be
believed:

```python
space = SignalSpace(
    name="...", axes=[Axis("m", "log", 1.0, 5000.0, "GeV")],
    derive=lambda t: {"pt": t["m"] / 2},
    prior_note="say exactly what measure this places on possibility, and why",
)

menu = Filter("my-menu", Any_("menu", [
    All("path_a", [Cut("pt_30", lambda t: t["pt"] >= 30.0,
                       rationale="why this cut exists — the belief behind it")]),
]))

a = audit(space, menu)

# the fourth thing: state your claims and let the ensemble try to kill them
e = sweep(run, knobs, [Claim("c1", "reach is below half",
                             lambda q: q["reach"] < 0.5)], draws=250)
```

`rationale` is not decoration. The belief that motivated a cut is the source of
the blindness it causes, and the audit prints it next to the damage.

## What would make this real

1. **Formalise the metric** — properties, invariances, behaviour under
   composition of filters, and the relationship to existing selection-function
   formalisms. The paper that has to exist first.
2. **Verify the ATLAS encoding** against the source, and get one trigger expert
   to say whether the blind regions match what the collaboration believes about
   itself. That is the experiment that decides whether any of this is useful.
3. **Ship exclusion certificates with real datasets.** The primitive only
   matters if it travels with data.
4. **Adversarial filter design** — search for signals that would physically
   occur and die in the filter, then fix the filter. The practical payoff, and
   only possible once there is an objective function.
