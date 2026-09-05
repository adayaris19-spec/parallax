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

> *This apparatus is structurally incapable of recording 64% of the phenomena it
> nominally covers, and here is the shape of what it misses.*

`reach` is a first attempt at making it expressible.

---

## The idea

Discovery is bounded by filters, and filters are written from the theories we
already hold.

A collider sees collisions at ~40 MHz and writes roughly one in 10⁵ to disk. The
discard is irreversible, decided in microseconds, in hardware, by rules derived
from the models people expected to test. A targeted assay finds exactly the
compounds on its list and is blind to everything else *by construction*. A
sky survey has a selection function. A sequencing pipeline has quality filters.
Every one of these is a place where the universe was allowed to speak and we
decided in advance which parts to hear.

Each field has independently noticed a local version of this — trigger-level
analysis and anomaly triggers in particle physics, retrospective suspect
screening in environmental chemistry, selection functions in astronomy. **None
of them share a metric.** So blindness cannot be compared between instruments,
optimised against, audited, or attached to a dataset.

**Discovery reach** is the proposed quantity:

```
reach = P( signal survives every stage of the filter )   under a stated prior
        over the space of signals that could exist
```

Three inputs, all of which an experiment already has: the instrument response,
the filter policy, and an explicit statement of what could be out there.

The third one is the honest part. **Reach is undefined without a stated prior**,
and different priors give different, equally legitimate numbers. That is not a
bug to be hidden — it is the content of the claim. `prior_note` is a required
field on every signal space in this library for exactly that reason.

---

## Results from the two worked examples

```
THE BLINDNESS LEDGER
================================================================================
  instrument + policy                   reach    blind   largest blind region
--------------------------------------------------------------------------------
  collider trigger menu                35.79%   64.21%   m <= 73.5 GeV
  targeted MRM assay                    0.05%   99.95%   (everywhere)
  non-targeted HRMS (acquisition)      45.90%   54.10%   polarity >= 0.833
  non-targeted HRMS (as reported)       1.00%   99.00%   -
================================================================================
```

**The collider result is a validation, not a discovery.** The method was told
nothing about known blind spots, and it recovered them: light states below the
electroweak scale, soft high-multiplicity final states, and mostly-invisible
decays. Any physicist would have told you that. The point is that the framework
*derives* it from the menu, and attributes it — the audit shows that lifting a
single pT threshold recovers 35–64% of reach, which is the precise statement
that trigger thresholds set by bandwidth are the dominant source of blindness.

**The chemistry result is the interesting one.** Read the last two rows
together. Under this prior the acquisition hardware can register 45.9% of the
stated chemical space; what is actually *reported* is 1.0%. Roughly 98% of what
the instrument detected is destroyed at the **annotation** step, because a
feature that cannot be matched to a spectral library is generally never written
down. Everyone in metabolomics knows this as "dark matter"; nobody quotes it as
a number, because there was no number to quote.

Chemistry also gives exactness: molecular formula space is enumerable, so reach
there is computed over all 1,153,017 plausible CHNOPS formulas between 50 and
500 Da rather than estimated by sampling.

---

## What this is not

Read this section before quoting anything above.

- **The response models are crude, documented proxies.** The collider kinematics
  are order-of-magnitude parameterisations and the trigger thresholds are
  representative of published scales, **not** any experiment's actual menu.
  Nothing here is a statement about ATLAS or CMS. The mass-spec ionisation and
  retention models are deliberately simple heuristics, labelled as such in the
  source.
- **The contribution is the method, not these numbers.** Supply a real detector
  response and a real trigger menu and the numbers move. The framework does not.
- **The priors are choices.** The collider prior is a flat statement of
  ignorance over final-state configurations, not a cross-section prior — it asks
  "of the things that could exist, which could we record?", not "which are
  likely?". The chemistry prior counts formulas, not molecules, and excludes
  halogens and metals entirely, which means most PFAS are outside it. Both are
  stated in full in every certificate the tool emits.

---

## The exclusion certificate

Every dataset documents what it contains. **None documents what it structurally
could never have contained.** That asymmetry is why blind spots compound
silently when datasets are combined, meta-analysed, or used as training data.

So the tool emits a machine-readable statement of what a filter policy makes
unrecordable — reach, per-decision attribution, named blind regions, the stated
prior, and a fingerprint of the exact policy:

```json
{
  "certificate": "exclusion/v0",
  "estimate": { "discovery_reach": 0.357875, "blind_fraction": 0.642125 },
  "blind_regions": [
    { "rule": "m <= 73.9 GeV", "prior_mass": 0.506, "reach_within": 0.00206 }
  ],
  "attribution": [
    { "node": "met_200", "cost_if_lifted": 0.642125,
      "rationale": "missing transverse energy; also catches decays past the calorimeter" }
  ]
}
```

This is the piece I believe is genuinely missing from science's metadata, and
the piece most likely to matter if any of this is right.

---

## Use

```bash
pip install numpy
python examples/audit_collider.py     # trigger menu audit + certificate
python examples/audit_massspec.py     # exact audit of three MS methods
python examples/ledger.py             # one metric across all four
python -m pytest tests/ -q
```

Defining a new audit means stating three things:

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
print(a.reach, find_blind_regions(a, ["m"]))
```

`rationale` is not decoration. The belief that motivated a cut is the source of
the blindness it causes, and the audit prints it next to the damage.

---

## What would make this real

In rough order:

1. **Formalise the metric.** Properties, invariances, behaviour under
   composition of filters, and the relationship between reach and existing
   selection-function formalisms. This is the paper that has to exist first.
2. **One real audit.** A published, documented trigger menu or acquisition
   method, with a real response model, audited end to end and compared against
   what that collaboration believes about its own blind spots.
3. **Exclusion certificates attached to real datasets.** The primitive only
   matters if it ships with data.
4. **Adversarial filter design.** Search for signals that would physically occur
   and die in the filter, then fix the filter. This is the practical payoff, and
   it is only possible once there is an objective function.

## Prior art, honestly

This is not virgin territory, and pretending otherwise would be the exact error
the project is about. Trigger-level / data-scouting analyses and anomaly-based
triggers already exist in high-energy physics; retrospective suspect screening
already exists in environmental chemistry; astronomy has computed selection
functions for decades. What does not exist, as far as I can tell, is a
**domain-independent quantity** that lets these be stated in the same units,
attributed to individual decisions, and attached to a dataset as metadata.

If that already exists somewhere and I have missed it, that is the single most
useful thing anyone could tell me.
