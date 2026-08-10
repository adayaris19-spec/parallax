# PARALLAX V2 — The Restructure

**Decision:** PARALLAX restructures around Plays 1 + 2 + 3 — PROSPECT, GROUND TRUTH and
CONSENSUS — as **one product**, not three. This document is the blueprint: what the product
becomes, what happens to every existing part, the data model, and the sequence.

---

## 0. Why all three at once is not three products

The three plays looked separate on the strategy page. They are not:

- An **OBJECT** (101955 Bennu, the lunar south pole, a returned sample) is described by claims.
- A **CLAIM** ("Bennu contains all five nucleobases") rests on evidence — papers, datasets,
  aliquots, laboratories — and either supports or contradicts other claims.
- A **VALUE** (Bennu's bulk density, lunar polar ice concentration) is nothing but the adopted
  synthesis of a claim series over time, with an uncertainty.

That is **one graph with three kinds of node**, and the provenance palette —
measured / calculated / assumed / proposed / claim — is the type system of its edges. PROSPECT is
the graph read from an object. GROUND TRUTH is the graph read from a claim. CONSENSUS is the graph
read from a parameter. Build the graph once and all three products are *views*.

The name already says this. Parallax is how you measure distance by looking from two places at
once. The graph is the set of sightlines; the dossiers are what triangulation returns.

> **The unit of the product changes: from the *question* to the *dossier*.**
> V1 asks "what does the literature say about my question?"
> V2 maintains "what does humanity actually know about this object / claim / number —
> on what evidence, resting on which assumptions, and what would change it?"

---

## 1. What V2 is

**PARALLAX — the state-of-knowledge instrument.** Three dossier types over one typed claim graph:

| Sightline | Unit | The standing question it answers | Was |
|---|---|---|---|
| **OBJECT** | A body, site, sample or mission | What is measured about this thing, what is merely inferred, which assumption chains hold it up, and what one observation would de-risk it | PROSPECT |
| **CLAIM** | An assertion in the record | What does this claim rest on — aliquot, lab, technique, paper, replication — what contradicts it, and what is its current standing | GROUND TRUTH |
| **VALUE** | A parameter with a number | The full measurement history, the spread, the adopted value with uncertainty, and a watch that fires when new data moves it | CONSENSUS |

Everything a dossier shows is typed by provenance, everything cites down to evidence, and the
**materiality gate** — surface only what changes an assumption, a bound or a conclusion — runs
over all three. WATCH stops meaning "watch a question" and starts meaning "subscribe to a dossier."

## 2. What happens to every V1 part

Nothing valuable is discarded; the engine is repointed.

| V1 part | V2 fate |
|---|---|
| The perimeter (18 archives, 124 passes, era ladder) | **Kept as-is** — it is the evidence engine. Gains *data-archive* adapters (SBDB, MPC, PDS, PSA, MAST) in worker v11 |
| The relevance gate (Claude scores every abstract) | **Extended** — from scoring relevance to *extracting typed claims* into the graph |
| Provenance palette (5 classes) | **Promoted** — from a colour system to the edge-type system of the graph |
| Materiality gate | **Kept** — becomes the firing rule for dossier watches |
| WATCH mode | **Becomes** dossier subscriptions (object, claim or value) |
| MODEL mode | **Becomes** the OBJECT dossier — "the live model" of a body. The Sgr A* black-hole demo is archived as a worked example |
| ANALYZE mode (adjudication) | **Kept whole** — two claims side by side, plus the discriminating observation. First mode absorbed into v2, because it is already graph-shaped |
| MEMORY mode | **Dissolved into the graph** — every claim and value carries its own time axis natively |
| CLAIM mode (grade a draft) | **Becomes** the LEDGER — the field's record, against which your draft is still gradeable |
| REASON / console | **Kept** — plain language over the graph |
| The simulated counters (`AMBIENT`, `S.counters`) | **Die.** V2's liveness is real by construction: a value that moved because data landed is a pulse that is not a facade. This finishes the honesty arc that started when b71 deleted the scanning line |
| Design system (per `DESIGN_HANDOFF.md`) | **Kept whole** — one room, instrument chrome, honest figures |

## 3. The data model

`setup/schema-v2.sql`, additive next to the v1 tables (`records` stays; evidence references it).

```
objects        a body, site, sample, mission or instrument
claims         a typed assertion, optionally about an object
evidence       a paper (→ records), dataset, or analysis: lab, technique, aliquot, instrument
claim_edges    claim ↔ evidence (supports / contradicts / replicates)
               claim ↔ claim   (rests-on — the assumption chains)
value_series   parameter × object: every historical determination, one adopted
```

Provenance is a column, not a convention. A dossier is a query, not a document.

## 4. The worker (v10 → v11)

Same sharded-perimeter pattern, three additions:

1. **Data adapters.** JPL Small-Body Database first (simple JSON, no auth), then MPC, PDS. A
   question returns papers *plus the datasets and instruments underneath them*.
2. **Typed extraction.** The gate stops returning only `relevance` and starts returning claims:
   `{statement, object, provenance, value?, uncertainty?, stance}` — written to the graph.
3. **Dossier assembly.** A dossier view is a read over the graph; the worker's job ends at
   honest rows.

## 5. The sequence

| Phase | Ships | Exit criterion |
|---|---|---|
| **P1 — now** | `/v2/` prototype: the three dossier views with real, hand-curated content (this commit) | You can click through OBJECT · CLAIM · VALUE and every number on screen is true and typed |
| **P2** | Worker v11: SBDB adapter + typed claim extraction; schema-v2 live in Supabase | A Bennu query returns graph rows, not just papers |
| **P3** | Dossiers assemble from the graph; watch gate fires on dossiers | Subscribe to Bennu; a new paper that moves a claim's standing notifies you |
| **P4** | V1 modes absorbed: ANALYZE first, then CLAIM→LEDGER, MEMORY dissolves | The Sgr A* demo is reachable only as an archived worked example |
| **P5** | `/v2/` becomes `/`; the question bar remains as one way to *open* a dossier | One product |

**Order rationale:** OBJECT first because Bennu grades us — 121.6 g of ground truth exists to
score the dossier against, publicly. CLAIM second because the public adjudication layer is the
marketing engine and the prompt that started this strategy contained its demo. VALUE last because
adopted values need graph mass to be trustworthy, and by P4 the graph has it.

## 6. What ships today (P1, honestly labelled)

`/v2/index.html` — static, one file, the product's own design system:

- **OBJECT — 101955 Bennu.** The dossier as it will look: readout header, provenance-typed
  inventory, and the **graded-predictions table** — what the pre-arrival assumption chains said
  against what the mission and the sample actually measured, including the chain that broke
  (thermal inertia → fine regolith: the surface was boulders).
- **CLAIM — "DNA in asteroids."** The ledger entry: the claim as heard (not supported), the four
  real claims underneath it with their chains down to aliquot, lab, technique and paper, the
  replication across Ryugu and Murchison, and the era ladder back to Berzelius burning pieces of
  the Alais meteorite in 1834.
- **VALUE — bulk density of Bennu.** The measurement history drawn as an instrument figure:
  the assumed analog band, the 2014 Yarkovsky determination, the 2019 spacecraft measurement,
  the adopted value — uncertainty shrinking by an order of magnitude per method change.

Every number on those three screens is from the published record. What is *not* real yet is the
plumbing: the prototype is hand-curated, and says so on the page. P2 replaces the hands with the
worker.

## 7. Risks, named

- **Three products badly instead of one well.** The guard is structural: one spine (the graph),
  three views, shipped strictly in the order the evidence allows (§5).
- **Graph cold start.** Solved dossier-at-a-time: each shipped dossier is complete and useful
  alone; nobody is sold an empty graph.
- **Being wrong in public.** The product's entire value is epistemic honesty, so every claim it
  publishes carries its chain. The prototype already follows the rule: nothing on screen without
  provenance.
