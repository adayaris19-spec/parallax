# PARALLAX

A research instrument. It reads the published record, watches what observatories
actually measured, and makes a claim where the two disagree.

`vision.html` is the argument for why it exists and what it is for. Read it
before changing what a claim is allowed to say.

## Layout

| Path | What it is |
|---|---|
| `index.html` | The site. One file, ~576k. Talks to the `ingest` function. |
| `v3.html` | An earlier build of the site, kept. |
| `vision.html` | The product argument. Published as an Artifact. |
| `setup/ingest.ts` | Edge Function `ingest` — the literature perimeter, 18 archives. |
| `setup/sky.ts` | Edge Function `sky` — live observatories, extraction, claims. |
| `setup/sky.test.mjs` | Tests for everything in `sky.ts` that does not need a network. |
| `setup/schema.sql` | Full schema, for a fresh project. |
| `setup/migrate-sky.sql` | The sky tables only, re-runnable, for an existing project. |
| `.github/workflows/sky.yml` | Deploys `sky.ts` and runs a sweep on every push. |

The deployed `ingest` has drifted from `setup/ingest.ts`; treat the file as a
reference, not as the source of truth for that function. `sky` is deployed only
by CI from `setup/sky.ts`, so that one is exact.

## Running it

```
node --experimental-strip-types --no-warnings setup/sky.test.mjs
```

No network, no deploy. It loads the real `sky.ts` with a `Deno` shim rather than
a transcription of it, so a test passing means the deployed source passes.

A sweep runs from GitHub Actions — `sky` workflow, Run workflow, pick a mode and
target. Pushing a change to `setup/sky.ts` deploys and sweeps automatically.
Secrets `SUPABASE_ACCESS_TOKEN` and `SUPABASE_ANON_KEY` live in repository
settings; the project ref is not a secret and sits in the workflow.

## Modes

| Mode | Does |
|---|---|
| `probe` | Asks every observatory whether it answers. Writes nothing. |
| `papers` | Asks the two paper indices what they return for one name. Writes nothing. |
| `sky` | Sweeps observatories and stores observations. |
| `tension` | Both eyes, the comparison, and any claims. The real one. |
| `scorecard` | What has been claimed and how it resolved. |

Start from `probe` or `papers` when something is wrong. A full sweep costs half a
minute and six services to answer a question about one of them.

## The rules that are not negotiable

These are enforced in code, not asserted in prose, and each one exists because
its absence produced a wrong claim on real data.

- **No error bar, no claim.** Two numbers without stated uncertainties are not a
  disagreement. `reconcile` counts them and drops them.
- **No kill condition, no claim.** `mint` refuses to build a row without the
  measurement that would end it. There is no path around it.
- **No value that is not in the source text.** A model handed an abstract whose
  numbers were stripped will supply one from context. Every stated value must
  appear as digits in the text it was read from.
- **An absence must be searched for.** Before saying nothing explains an object,
  the worker queries an index and carries the hit count as its receipt. It fails
  closed: if the check errors, no claim.
- **A value must agree with what it claims to be.** A quantity declares a
  dimension and a plausible magnitude. An age and an orbital period are both
  times; only magnitude separates them.
- **Never compare in the unit it arrived in.** Everything normalises to SI first
  or is dropped. Jupiter radii against Earth radii is a factor of eleven.
- **A targeted question gets targeted claims.** Correct claims about the wrong
  subject are still the wrong answer.

## The lesson this codebase keeps relearning

Five separate bugs here came from counting a failure without naming it: a silent
arXiv catch, a bare OpenAlex failure count, `no_object` conflating two faults, a
unit counter that did not say which spellings, and a database write that logged
its rejection to a console nobody reads. Each cost a round trip to diagnose.

When something fails, record *what* it was, not just that it happened. Every
sweep reply is built for that: `ledger`, `dropped`, `unconverted_units`,
`index_errors`, `stored`, `rejected_orphans`, `skipped`. The denominator is
always reported, because a sweep that compared four things and found one tension
is a different object from one that compared four thousand.

`WORKER_VERSION` in `sky.ts` is bumped on any change to what a sweep returns, and
the reply carries it. It exists because a run once tested the previous build and
nobody could tell.
