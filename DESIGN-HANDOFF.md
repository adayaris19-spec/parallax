# PARALLAX — Design Re-evaluation Handoff

**Target:** `index.html` (b71, 8,597 lines, ~578 KB single file)
**Purpose:** a complete, evidence-grounded re-evaluation of the visual system — composition, colour, type, motion, layering — under new lenses.
**How to use:** copy the block under [Master Prompt](#master-prompt) into a fresh session. Everything above it is the evidence pack that prompt depends on; everything below it is the contract the work is graded against.

---

## 0. Ground truth (measured, not asserted)

Every number below was counted from `index.html` at b71. The prompt references these, so they are stated here once, precisely.

| Dimension | Measured | Design intent as written in the file |
|---|---|---|
| Distinct `font-size` values | **58** (47 px literals + 11 `clamp()`) | line 197: *"Two type sizes only, enormous and small, because a page of mediums reads as nothing"* |
| `font-size` declarations total | 312 | — |
| Sub-11px font sizes | 140 declarations, **66 of them under 9px** | — |
| Distinct `font-weight` values | **12** — incl. `420`, `440`, `520`, `650`, `750` | — |
| Webfonts loaded | **0** (`@font-face`: none, `<link rel=preload>`: none) | stack is `'Inter','SF Pro Display','Helvetica Neue',system-ui` |
| Distinct hex colours | **97** | 12 colour tokens defined in `:root` |
| Distinct `rgba()` literals | **261** | — |
| `var(--token)` usages | 453 | — |
| Distinct `border-radius` values | **15** (0,1,2,3,4,5,6,7,8,9,10,12,14,99px,50%) | — |
| Distinct `padding` values | **78** | — |
| Distinct `letter-spacing` values | **27** | — |
| Distinct `line-height` values | **21** | — |
| Distinct `gap` values | **24** | — |
| `z-index` values | **23**, unlayered, 0→900 (incl. 57, 58, 62, 64, 66) | — |
| Easing curves | **4** — three of them near-identical | — |
| Selectors declared more than once | **42** (excl. keyframe stops) | — |
| `position:fixed` layers | 17 | — |
| `backdrop-filter` instances | 12 | — |
| Always-running infinite animations | 6 | — |
| Media queries | **5 total** (900px ×4, 980px, 760px, 1250px, reduced-motion) | — |

### 0.1 Five findings that are not opinions

**F1 — The typographic hierarchy is not guaranteed to render.**
The file uses `font-weight:420/440/520/650/750`. Those are variable-font axis values. No `@font-face` and no font `<link>` exists in the document. On any machine without Inter locally installed — most Windows and Linux clients — the stack falls through `SF Pro Display` and `Helvetica Neue` (both Apple-only) to `system-ui`, and every intermediate weight snaps to 400 or 700. The designed typographic colour exists only on the author's machine. This is the single highest-leverage defect in the file.

**F2 — Stated intent and implementation have diverged by an order of magnitude.**
The comment at line 197 commits to two type sizes. There are 58. This is not a style quibble: it means the file no longer encodes its own design rules, so each new build re-decides them locally. That is the mechanism that produced findings F3–F5.

**F3 — The stylesheet carries override sediment from 71 builds.**
42 selectors are declared more than once with conflicting values. Worked example, lines 271–288: `.hgrid h3` is declared three times (`14px`, then `clamp(15px,1.25vw,17.5px)`, then `14.5px`) and `.hgrid p` three times (`12.4px`, `13.2px`, `12.8px`). Only the last wins; the first two are dead bytes that still read as live intent to the next person editing. `.hgrid`, `.hgrid article`, `#ctl`, `#hint`, `#brief`, `#vitals`, `.hhero`, `.hviz` have the same problem.

**F4 — There are three unreconciled colour worlds, not one.**
1. `#home` — light paper, amber-led (`#faf8f3`→`#edeeee`, accent `--asm #b4560a`).
2. `#onb` — full-screen dark navy (`#071429`→`#11315c`), cyan-glow, 200-weight type at `.42em` tracking.
3. `#chrome` + figures — light paper chrome floating over a WebGL canvas, while the SVG figures use a *different*, darker instrument palette (`#8fb4dc`, `#b08af5`, `#2ec8f5`, `#e8a13a`, `#f57a7a`) that is nowhere in `:root`.

Dark handling is 5 ad-hoc `.dark` selectors, not a systemic surface layer. Light chrome text sits over a canvas whose luminance is not controlled, so legibility there is unverified by construction. `v3.html` compounds this with a fourth, divergent palette (`--ev:#0090c4` vs `#0a6a90`, `--asm:#a85e08` vs `#b4560a`, `--ink:#0d2236` vs `#14263a`).

**F5 — Mobile deletes information rather than reflowing it.**
Lines 816–828 hide `#findings`, `#activity`, `#telemetry`, `#chipsDock` and `#vitals` below 900px. Five information surfaces vanish. For a product whose claim is that the model never sleeps and the readouts are the interface, the mobile build contradicts the thesis.

### 0.2 Contrast, computed (WCAG 2.1, small text ≥4.5:1)

Against the page's own gradient, worst case `#edeeee`:

| Token | Hex | vs `#faf8f3` | vs `#edeeee` | Verdict |
|---|---|---|---|---|
| `--ink` | `#14263a` | 14.46 | 13.20 | AAA |
| `--clm` | `#1b2b3d` | 13.56 | 12.38 | AAA |
| `--ink2` | `#2e4a66` | 8.65 | 7.90 | AAA |
| `--hyp` | `#5a34a8` | 7.94 | 7.25 | AAA |
| `--calc` | `#38536f` | 7.51 | 6.86 | AA |
| `--ev` | `#0a6a90` | 5.69 | 5.20 | AA |
| `--dim` | `#54697d` | 5.36 | 4.89 | AA (thin margin) |
| `--bad` | `#c0392b` | 5.12 | 4.68 | AA (thin margin) |
| **`--asm`** | **`#b4560a`** | **4.63** | **4.22** | **fails AA at small text** |
| **`--ok`** | **`#12855a`** | **4.37** | **3.99** | **fails AA at small text** |

`--asm` is the primary brand accent and appears 66 times. `--ok` carries live/success state. Both are used at small sizes. White on `--asm` measures 4.91 — passing, but with no headroom for the `filter:brightness(1.1)` hover on `.hgo`.

The compounding factor: `--dim` at 4.89 is applied to 7.5px and 8px uppercase text at `.2em`+ tracking in `#vitals`, `#hud`, `#bld`, `.sug .where` and `#cons .tick`. Contrast ratios assume normal-weight text at normal size; sub-9px letterspaced uppercase is materially harder to read than the ratio implies.

---

## 1. Master Prompt

> Copy everything between the rules into a fresh session, with `index.html` in context.

---

You are re-evaluating the visual system of PARALLAX, a research instrument for scientists, delivered as a single self-contained `index.html`. It is at build 71. It was designed by accretion — each build solved a local problem — and it now needs to be looked at whole, from the outside, by someone who did not write it.

**Ultrathink. Take the time this deserves.** Do not begin proposing until you have finished looking.

### What this app is, so you judge it against the right standard

Three surfaces, one product:
1. **The front door** (`#home`) — a marketing page that must make a working scientist believe this is a real instrument, not a dashboard skin.
2. **The threshold** (`#onb`, `#cons`) — a dark full-screen moment where the user states their field and a model is constructed.
3. **The bench** (`#chrome`, `#stage`, figures, panels) — the live workspace. Six instruments, no pages. A WebGL canvas underneath, floating chrome on top, SVG figures throughout.

The design language is *scientific instrumentation*: paper-white ground, provenance encoded in colour (cyan measured · navy calculated · amber assumed · violet proposed · graphite claim), monospace readouts, physics vocabulary. **This register is correct and is not up for re-evaluation.** What is up for re-evaluation is whether the execution actually delivers it.

### The three goals, in priority order

1. **Clean look** — one visual language, not three. A stranger should not be able to tell which build any given element came from.
2. **Productivity** — the user finds the readout they need without hunting. Information density is a virtue here; visual noise is not. These are different things and the distinction is the whole job.
3. **Efficiency** — fewer decisions per element, fewer bytes, fewer paints. The system should make the next build cheaper, not more expensive.

### Hard constraints — violating these fails the work

- **Single file.** No build step, no bundler, no external CSS or JS. It ships as one `index.html`.
- **No network dependencies for critical rendering.** If you load a font, self-host it as base64 or accept the fallback explicitly and design for it. Do not add a Google Fonts link.
- **Provenance colour semantics are load-bearing.** Cyan/navy/amber/violet/graphite mean specific epistemic things. You may retune the *values* for contrast and harmony. You may not reassign the *meanings* or drop a channel.
- **No wholesale rewrite.** This file works. You are re-evaluating and correcting it, not replacing it. Every change must be independently revertable.
- **Never delete information to make something fit.** Reflow, collapse, progressively disclose, paginate — but the mobile build may not be an amputation of the desktop build.

### The four lenses — run all four, in this order, before proposing anything

**Lens A — The Stranger's Eye (first five seconds).**
You have never seen this product. Scroll the front door once. Load the bench once. Then answer: What is this? Who is it for? What does it want me to do? Where does my eye land first, second, third — and is that the order the product wanted? Name every place where the visual hierarchy and the information hierarchy disagree. Be specific about elements, not vibes.

**Lens B — The Instrument Bench (does it read as one machine?).**
An instrument bench looks coherent because every dial on it was made by the same shop. Audit the three surfaces against each other: type register, colour ground, control affordance, label style, corner radius, shadow depth, motion character. Every discontinuity you find is a seam where the product stops feeling like one machine. Rank the seams by how early a new user hits them. Pay particular attention to the boundary where light chrome sits over the dark WebGL stage, and to the SVG figure palette, which is not in `:root` at all.

**Lens C — The Grep (measurable sprawl → a token contract).**
Count, don't estimate. 58 font sizes, 12 font weights, 97 hex colours, 261 rgba literals, 15 radii, 78 padding values, 27 letter-spacings, 24 gaps, 23 z-indexes, 4 easings, 42 redeclared selectors. For each axis, derive the *smallest scale that loses nothing* — collapse to it, and state explicitly what visual difference (if any) is lost. Then define the token contract in `:root` and prove every literal now maps to a token. Where a literal genuinely must stay, say why in a comment. **The test of this lens is not that the numbers got smaller; it is that you can point at any element and name which token it uses and why.**

**Lens D — The Adversary (what breaks it).**
Attack the design from outside the author's machine:
- *Typography:* no webfont is loaded, yet weights 420/440/520/650/750 are used. Render the page mentally on Windows (Segoe UI) and Linux (Cantarell). What hierarchy survives? Fix this first — it invalidates every other typographic judgement until it is fixed.
- *Contrast:* `--asm` (4.22:1 worst case) and `--ok` (3.99:1) fail AA at small text and are used at small text. 66 declarations use type below 9px, much of it uppercase at wide tracking in `--dim`. Recompute every foreground/background pair against the *worst* stop of the background gradient, not the best.
- *Motion:* 6 infinite animations run permanently, including a 13s blurred 44vw beam sweep (`filter:blur(22px)` over a large area) and a 42s marquee. Cost them. The `prefers-reduced-motion` block exists — verify it actually neutralises all six.
- *Layering:* 17 fixed layers, 12 `backdrop-filter` blurs, 23 unlayered z-indexes. Find the stacking bugs that exist today and the ones the next build will introduce.
- *Mobile:* five surfaces are hidden below 900px. Only 5 media queries exist for a product this dense. What does a scientist on a phone actually get?
- *Selection & input:* `user-select:none` is set globally on `body`. Verify that readouts, figures, and numeric values a scientist would want to copy are exempted. A research instrument whose numbers cannot be copied is a research instrument with a bug.

### New angles — pick the ones that earn their place, discard the rest

Do not apply all of these. Argue for the two or three that would most change the product, and say plainly why you rejected the others.

- **Ground inversion.** The bench is a dark stage wearing light chrome. What if the instrument surfaces were dark-native and the paper ground belonged only to the front door and to documents? Which artefacts in the current file are evidence the design already wants this?
- **One accent, not five.** Provenance needs five channels; *chrome* does not. What if amber were reserved exclusively for "assumed" and the interface accent were something else entirely — or nothing, with hierarchy carried by weight and space alone?
- **Density as the tunable.** Instead of one fixed density, a comfortable/compact control that scales the spacing scale. Does the token contract make this nearly free? If so, it may be the highest productivity-per-byte change available.
- **Figure-first composition.** The figures are the product. Are they currently framed as the subject, or as illustrations decorating text? What changes if every section is built outward from its figure?
- **The quiet default.** Six infinite animations mean the page is never at rest. What is the case for stillness as the default state, with motion reserved to signal that something actually changed?
- **Progressive disclosure over deletion.** The mobile amputation exists because there is no collapse mechanism. Design one, and it likely serves the desktop bench too.

### Required output

Produce a document with exactly these sections:

1. **Verdict** — five sentences maximum. What is right about this design, what is wrong, and the one change that matters most.
2. **Findings** — each with: the lens that found it, the specific file location, why it costs the user (in productivity, efficiency or coherence terms), and severity (blocker / high / medium / polish). Ordered by severity. No finding without a location.
3. **The token contract** — the proposed `:root`, complete, with the derived scales for type, weight, colour (incl. dark surfaces and the figure palette), spacing, radius, elevation, z-index layers, and motion. Each scale annotated with what it replaced and what was lost.
4. **The composition** — how the three surfaces reconcile into one language. Address the light-chrome-over-dark-canvas boundary explicitly.
5. **Sequenced plan** — ordered changes, each one independently shippable and revertable, each with its own acceptance test. Front-load the changes that unblock judgement of later ones (F1 before any other typography work).
6. **Rejected** — the angles you considered and dropped, with reasons. This section is mandatory and is read as carefully as the others.

### Rules of engagement

- Every claim about the current state must cite a line number or a count you actually ran. If you did not measure it, say "unverified".
- Prefer deleting a rule to adding one. A change that removes 40 lines and loses nothing is worth more than a change that adds 40.
- When you cannot decide between two options, build both as a minimal side-by-side and judge from the render — do not argue it out in prose.
- Say plainly when something is already good. A re-evaluation that finds everything wrong is not a re-evaluation, it is a rewrite with extra steps.

---

## 2. Acceptance gates

The re-evaluation is done when all of these hold. These are checks, not aspirations — each one is runnable.

| # | Gate |
|---|---|
| G1 | Typographic hierarchy renders identically on a machine with no Inter installed — either a self-hosted font is embedded, or every weight used is one the fallback stack actually provides. |
| G2 | ≤ 8 type steps and ≤ 4 font weights, all in `:root`. No bare `font-size` literal outside the token block without a comment justifying it. |
| G3 | Every foreground/background pair meets AA at its rendered size, measured against the **darkest** stop of the background gradient. `--asm` and `--ok` specifically resolved. |
| G4 | No interface text below 11px except deliberate monospace readouts, which must be ≥ 10px and meet AAA contrast. |
| G5 | ≤ 6 radii, ≤ 8 spacing steps, ≤ 3 easings, ≤ 6 named z-index layers — all tokenised. |
| G6 | Zero redeclared selectors. (Currently 42.) |
| G7 | The SVG figure palette is defined in `:root` and shares a documented relationship with the chrome palette. |
| G8 | No information surface is hidden at any viewport. Everything hidden today is reachable via collapse or disclosure. |
| G9 | `prefers-reduced-motion` neutralises all six infinite animations, verified individually. |
| G10 | Numeric readouts and figure values are selectable and copyable despite the global `user-select:none`. |
| G11 | Total CSS byte count is lower than at b71, or the increase is itemised and justified. |
| G12 | `v3.html` is either deleted, or marked an archive and excluded from the token contract. Two live palettes in one repo is a bug. |

---

## 3. Working notes for whoever runs this

- **Do F1 first.** Until the font question is settled, no typographic judgement in this file is trustworthy, because you are looking at a render nobody else sees.
- **Then Lens C.** The token contract is the change that makes every later change cheap. Do it before any aesthetic decision.
- **Then F4 (three colour worlds) and F5 (mobile amputation).** These are the two that a user actually feels.
- Leave the provenance semantics alone. They are the most original thing in this product.
- The build history shows real design conviction — V64 *"the home page in one room"*, V67 *"plain sentences with physics words"*, V71 *"delete the facade, add depth that is the data."* The problem is not taste. The problem is that the file has no mechanism for holding a decision across builds. The token contract is that mechanism.

---

*Generated as a design handoff for the `claude/parallax-design-reevaluation-rt059n` branch. Evidence measured against `index.html` at b71.*
