# Does this match what you already know about your own blind spots?

**One page, one ask.** I have computed something about the ATLAS Run-2 trigger
menu and I need someone who works on triggers to tell me whether it is
interesting or trivially obvious. Either answer is useful to me. The second one
takes you five minutes.

---

## What I did

I wrote a small framework that computes a single number I will call **discovery
reach**: given (a) an instrument response, (b) a filter policy, and (c) an
*explicitly stated* prior over signals that could exist, what fraction of that
prior survives to be recordable at all?

It is the complement of the efficiency you normally publish. You quote acceptance
for the signal you searched for. This quotes acceptance for the signals you
didn't.

I applied it to the Run-2 primary menu — `HLT_mu26_ivarmedium`, `HLT_mu50`,
`HLT_e26_lhtight_nod0_ivarloose`, `HLT_e60_lhmedium_nod0`, `HLT_e140_lhloose_nod0`,
`HLT_g140_loose`, `HLT_j420`, `HLT_4j120`, `HLT_ht1000_L1J100`,
`HLT_xe110_pufit_L1XE55`, `HLT_2mu14`, `HLT_2e17_lhvloose_nod0` — against a
deliberately flat prior over final-state *configurations* (mass, visible
fraction, object multiplicity, leptonic fraction, proper decay length), not a
cross-section prior.

## What came out

```
REACH  40.4%      of the stated configuration space can fire any primary chain
BLIND  59.6%

most valuable chain by UNIQUE coverage:   HLT_xe110_pufit   (14.6%)
largest blind region:  m <= 54.5 GeV      (46.9% of prior mass, reach 2.5e-04)
next:                  m <= 111 GeV and n_vis >= 6   (6.6% of prior mass)
```

Then I varied all twelve uncertain inputs simultaneously — every threshold over
±40-80%, the leading-object hardness assumption, and the effective tracker /
calorimeter / muon radii — across 250 draws, and asked which *qualitative* claims
survive:

```
ROBUST  100%   reach is below one half
ROBUST  100%   energy thresholds destroy more reach than detector geometry
               (abolishing thresholds recovers 58.6%; abolishing geometric
                limits recovers 0.06% - three orders of magnitude)
ROBUST  100%   missing energy is the most valuable chain by unique coverage
LIKELY   81%   light states with no hard lepton are essentially unreachable
FAILS    11%   soft high-multiplicity states have conditional reach below 5%
               <- a prediction of mine the ensemble destroyed; left in on purpose
```

The headline, if it holds: **collider blindness is made of bandwidth, not of
physics.** What the detector can physically register barely matters next to what
the readout can afford to keep.

## The three questions I actually need answered

1. **Is the ordering right?** Would you expect thresholds to dominate geometry,
   and by roughly three orders of magnitude? If your intuition says the gap is
   much smaller, my response model is wrong somewhere and I would like to know
   where.

2. **Do the named blind regions match what the collaboration believes about
   itself?** Specifically: is there a region I name that you would dispute, or
   one you know about that I have missed entirely? The `m ≲ 55 GeV`,
   no-hard-lepton corner is the one I would most expect you to say is
   well-known.

3. **Does a quantity like this already exist inside ATLAS?** Some
   model-independent acceptance map, a trigger-level coverage study, an
   "efficiency for what we weren't looking for". If it does, that is the single
   most useful thing you can tell me, and I will stop.

**The most likely correct answer to (1) and (2) is "yes, obviously, everyone in
the trigger group knows this."** Please say so if it is true. That is not a
failure for me — it validates the method against a field that already has the
answer, which is exactly what I need before pointing it at fields that don't.

## What is wrong with this, stated up front

- **The thresholds were encoded from public values but not verified against the
  source.** The machine I built this on had no network access. Every value in
  the code carries its own confidence flag and a pointer to what to check. If I
  have a chain name or a number wrong, tell me and I will fix it — but note that
  the robustness sweep exists precisely so that this matters less than it
  sounds. If a conclusion only held when `HLT_j420` was exactly 420 GeV, the
  sweep would have caught it.
- **The kinematics are order-of-magnitude parameterisations**, not a simulation.
  Leading-object p_T is a crude function of mass, multiplicity and visible
  fraction. No pile-up, no detector resolution, no reconstruction inefficiency,
  no L1/HLT distinction, no isolation modelling. This will be the weakest link
  and I would rather you attack it than be polite about it.
- **This is not a statement about ATLAS.** It is a statement about a menu shaped
  like the published one, under a prior I chose.
- **The prior dominates the number.** Same menu, same run, reweighted by a
  falling mass prior `m^-α`: 40.4% at α=0, 0.67% at α=1, 0.01% at α=2. Two and a
  half orders of magnitude from the prior alone. I think that makes the *number*
  close to meaningless and the *orderings* the only thing worth arguing about.
  If you disagree, that is a conversation I want to have.

## Why I think it might be worth your five minutes

Every field discards most of what it collects, using rules written from the
theories it already holds — you at 40 MHz in hardware, environmental chemistry
via target lists, astronomy via selection functions. None of them share a
metric, so nobody can compare blindness across instruments, optimise against it,
or attach it to a dataset.

High-energy physics is the field most likely to have already solved this, and
therefore the right place to find out whether the idea is new or naive. If it is
naive, you will know in five minutes and I will have wasted only my own time.

---

**Code, results and the verification checklist:** `reach/` — the ATLAS encoding
is in `reach/domains/atlas_run2.py`, and `python examples/audit_atlas.py`
reproduces every number above. Pure Python and numpy, no other dependencies.

Reply with "this is obvious" and I will take it as a result.
