# PARALLAX

## Mission

**To find the questions science stopped asking for reasons that are no longer true.**

## Vision

A world where no discovery waits on an accident.

Where the moment a constraint expires — a detector gets sharper, a method gets
invented, a cost collapses by nine orders of magnitude — every question that
constraint was ever blocking reopens automatically: dated, explained, and
addressed to the people who can now answer it.

Science's frontier stops being a fossil of past limitations and becomes a live
function of present capability.

---

## The problem nobody is working on

Science has no memory of its own foreclosures.

Every field is shaped as much by what it never did as by what it did. And the
"never did" is not random — it is *caused*. A question goes unasked because the
instrument to answer it did not exist. Because the mathematics had not been
invented. Because a founding paper framed the field in a vocabulary that had no
word for it. Because the answer needed two halves that live in fields with no
shared journal, no shared conference, no shared citation. Because a 1974 result
made it look settled, and that result was quietly overturned in 2009 in a
different literature. Because the person who would have asked it died.

Those constraints expire. The questions do not reopen.

There is no institution, no journal, no database, no norm that records *"this was
not pursued, and here is why."* Absence leaves no document. A paper is written
when work succeeds; nothing is written when work is never begun. So the reason a
question was closed is destroyed at the moment it is closed, and when the reason
stops being true — a decade later, in another field, in a paper nobody connects
to it — the question stays shut. Forever, or until someone stumbles on it by
luck.

This is the largest structural loss in the knowledge system, and it is invisible
by construction. **You cannot notice the absence of something you never saw.** No
human, and no committee of humans, can hold the entire history of what was
possible in their head and difference it against the entire history of what was
attempted. This is not a task humans are bad at. It is a task humans cannot
begin.

That is why it is worth building an instrument for.

---

## What Parallax measures

The name is the mechanism. Astronomers measure the distance to a thing they can
never reach by observing it from two positions and measuring the displacement.

Parallax observes every question in science from two positions:

1. **Where the question stands** — the last time anyone touched it, and what they
   could do when they did.
2. **Where capability stands now** — what can be measured, computed, synthesised,
   or proven today.

The displacement between those two is the finding. We call it **the angle**, and
it is measured in years of capability drift. A question with a 31-year angle is a
question last engaged with 1994's instruments, sitting in a world with 2026's.

The angle is a number. It is computable per question, for every question science
has ever posed. Nothing like it exists.

---

## The four objects

Each has to be constructed. None of them exists today. Each is a new scientific
object in its own right.

### 1. The Capability Record — a history of the possible

For every field, for every year: what could actually be *done*. Angular
resolution. Sensitivity. Energy scale. Sample size. Sequencing cost. Available
compute. Obtainable materials. Extant datasets. Proven theorems. Existing
techniques.

This is not in any database. It is sitting, undigested, in the methods sections
of the entire published record — the part of every paper that human readers skip
and every index ignores. Every paper ever written is a dated datapoint about what
was achievable when it was written. Twenty million methods sections are a
measurement of the frontier of the possible, across three centuries, at annual
resolution.

Nobody has ever assembled it because nobody could read them all.

### 2. The Attempt Record — including the silent attempts

What was actually asked. And, harder and more valuable: what was tried and
abandoned without ever being published.

Failure is unpublishable, but it is not traceless. It casts shadows: a technique
that appears for three years and vanishes; a question raised in a 1974 discussion
section and never followed by anyone including its author; a productive line that
stops abruptly mid-decade; a dissertation with no follow-on; conference abstracts
with no paper behind them. Individually these are noise. At corpus scale they are
a signal, and the signal is *"this was tried, and it did not work, and no one told
you."*

### 3. The Foreclosure Map — the negative space, with causes

Difference (1) against (2) and what remains is everything science has never done.
That set is enormous and useless — until each region of it is labelled with the
*cause* of its emptiness. Every cause has its own signature in the record:

- **Impossible then** — the capability did not exist. (The valuable case.)
- **Impossible ever** — forbidden by physical law. (Correctly empty.)
- **Unframable** — the field's vocabulary had no way to pose it.
- **Split** — the halves live in disciplines that have never cited each other.
- **Abandoned after failure** — tried, failed, unpublished.
- **Abandoned after a result that was later overturned.**
- **Never funded** — a structural, not intellectual, absence.
- **Uninteresting** — genuinely not worth asking. Parallax must be willing to say
  this, and say it often, or it is a hallucination engine with a nice interface.

### 4. The Expiry Ledger — the payoff

Intersect the Foreclosure Map with *today's* capability. Every foreclosure whose
cause has died is a live opportunity, with a date of death.

The output is not a suggestion. It is a finding with a provenance:

> *This is not a new idea. It is a 51-year-old idea that was correct to abandon in
> 1974, and has been wrong to abandon since 2016. The obstacle was an angular
> resolution limit. It was removed by a group that has never cited this
> literature, in a field this literature has never cited. Nobody noticed, because
> nobody was looking at both.*

That sentence cannot be produced by a person. It requires having read two fields'
entire histories and having noticed that a constraint in one released a question
in the other. The binding constraint is almost always in a different field from
the question — which is precisely why the release is never noticed.

---

## How we prove it works

An idea like this can be talked about forever. It is also, unusually,
**backtestable** — and this is the part that turns it from a manifesto into an
instrument.

**The Hindsight Test.** Freeze the corpus at year *Y*. Build the Capability
Record, the Attempt Record, and the Foreclosure Map using nothing published after
*Y*. Emit the Expiry Ledger. Then run the tape forward against the real record
and ask: of the questions Parallax said were reopenable in *Y*, how many did
humanity actually reopen — and how long did it take?

Every hit has a **lead time**. Mean lead time over the human record is the single
number that says whether this instrument is real. If Parallax-at-1998 flags what
humans found in 2011, that is thirteen years, measured, not asserted. If it flags
nothing anyone ever pursued, the idea is wrong and we will know it cheaply.

No AI-for-science system has a benchmark like this, because no other system makes
a claim that history can grade. Ours does.

---

## What Parallax is not

- **Not literature search.** Search retrieves what exists. You cannot retrieve an
  absence. Finding what is *not* in the corpus requires a model of the whole
  space, not a query against documents. Every existing tool in this category is
  retrieval-shaped and therefore structurally incapable of this.
- **Not summarisation, alerting, or "this paper looks important."** Reading things
  and flagging them is a task that has been solved several times and was never the
  bottleneck.
- **Not contradiction-spotting.** Finding that two papers disagree is bookkeeping.
  Finding that a field's entire frontier is positioned where a dead instrument put
  it is a different order of claim.
- **Not hypothesis generation from a knowledge graph.** Linking two concepts that
  co-occur is a 1986 idea being re-implemented annually. Parallax does not
  speculate about what might be true; it establishes what was *foreclosed*, by
  what, and whether that thing still holds.
- **Not a research agent that does the work.** It tells you where the work is. The
  scarce thing in science is not labour. It is knowing where to point it.

---

## Why now, and why nobody has

The moat is the Capability Record, and it was unbuildable until approximately
now.

It requires reading twenty million methods sections — not indexing them,
*reading* them, extracting dated quantitative claims about what was achievable —
across every field, at a cost per paper of cents and falling. That capability
arrived recently and is not yet pointed at anything. Everyone building on top of
the scientific corpus is building retrieval, because retrieval is what the corpus
obviously supports. The negative space requires you to read *everything* before
you can say anything, which is the opposite of how every product in this space is
architected.

Parallax already has the perimeter this needs: 124 passes over 18 archives, one
per decade back to the 1600s, deliberately built so that the old work does not
fall off the end of a relevance sort. That design decision looked like a quality
detail. It was actually the foundation — because a history of the possible cannot
be reconstructed from a corpus that only contains the last five years.

## Where we prove it first

Observational astrophysics. Capability there is unusually honest: angular
resolution, baseline length, frequency coverage, sensitivity, and cadence are hard
numbers with clean dates, and the instruments announce themselves. The Capability
Record can be built there with the least inference and validated against a history
everyone knows. ADS, arXiv, INSPIRE, CDS, NTRS and OSTI are already inside the
perimeter.

One field, fully mapped, with a measured lead time on the Hindsight Test, is the
proof. After that the method is field-agnostic: every science has a capability
curve, and every science has forgotten what it closed.

---

## The one-line version

*Science's frontier is a fossil of constraints that no longer exist. Parallax
digs it up and dates it.*
