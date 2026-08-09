# PARALLAX — Design Handoff

**Build at time of writing:** `b74`
**Scope:** the whole visual and interaction system of the product — front door and workspace.

> This document was written against `b71` and then **run against the app**, twice. The conformance
> defects it found were fixed and shipped as `b72`; the remaining items were completed in `b73`,
> and running them surfaced three things the first draft had got wrong, which are corrected in
> place and flagged. `b74` then fixed a set of narrow-width collisions found by rendering the app
> at eight widths rather than reading the CSS. §11 records all three passes. The rest of the
> document describes the app as it now stands.

This document is written for whoever picks the design up next: a designer who needs the rules, or an
engineer who needs to add a surface without breaking the language. It describes what is actually in
the code, not an aspiration. Every rule below is traceable to a line in `index.html`.

---

## 1. What the product is, and what that costs the design

Parallax runs a scientific literature question across **18 archives × ~124 passes** (one per archive
per decade, back to the 1660s), reads every abstract, and turns the return into figures and prose.
It is not a search box with results; it is an instrument that has already done the reading by the
time you open it.

Two consequences shape everything visually:

1. **Nothing on screen is allowed to be decorative.** This is enforced culturally in the codebase —
   the `b71` changelog entry (`index.html:3125`) records the deletion of a sweeping scan line and a
   rotating bearing ring for exactly this reason: *"A line sweeping across a plot on a loop encodes
   nothing."* If you add an element, it must answer *where am I looking, at what scale, which point
   is the point*.
2. **The document is the workspace.** There is no page navigation. Text carries the intelligence and
   figures are embedded inside the text that explains them (`index.html:4029`). Modes morph the
   scene; they never replace it.

### Repository shape

| Path | What it is |
|---|---|
| `index.html` | The entire product. ~8,790 lines: ~940 of CSS, ~7,700 of JS, no build step, no framework, no dependencies. |
| `setup/ingest.ts` | Supabase Edge Function `ingest` (v10). The perimeter — sharded across parallel invocations. |
| `setup/schema.sql` | Two tables (`records`, `findings`), public read via RLS. |
| `robots.txt` | Pre-release; the page also carries `noindex,nofollow,noarchive` (`index.html:6`). |

There is **no component library and no design tool file.** The `<style>` block at the top of
`index.html` *is* the design system. Treat it as the source of truth and edit it in place.

---

## 2. Principles

These are extracted from the code's own commentary, which is unusually explicit about intent. They
are load-bearing — most of the visual decisions below are downstream of one of them.

**One room.** The front door and the product share the off-white, the amber and the two typefaces,
"so arriving in the product is not a change of scenery" (`index.html:170`). Never introduce a colour
slab or a second palette for a marketing surface.

**One instrument language, on every figure.** The in-product figures are built as SVG strings; the
front-door figures are built in the DOM. Both call the same chrome primitives (`index.html:4068`).
A figure must be readable in a form a physicist already knows — exclusion plot, contours, spectrum,
residuals, impact diagram, support graph — "because a figure that has to be explained before it can
be read is not a figure" (`index.html:7827`).

**Depth is the data.** Where the design uses 3D — extruded columns, cast shadows, stacked ribbons —
the depth axis is carrying a real variable (archive identity, decade), never perspective for its own
sake (`index.html:6017`, `index.html:7070`).

**Answers, not labels.** A collapsed section header must already carry its finding. The digest logic
(`digestOf`, `index.html:4830`) prefers an author-supplied digest, then the section's own opening
sentence, and only falls back to a shape count — "which says almost nothing".

**Plain sentences with physics words.** Headings and section digests are ordinary sentence case, and
this is enforced against the surrounding uppercase chrome with `!important`
(`index.html:519–520`).

**Progressive disclosure, never a wall.** The inspector, the findings, the grouped sections and the
console log all collapse to one line and open on demand.

**Nothing simulated is shown as if it were live.** This is the principle that actually governs the
ambient surfaces, and it is stronger than it looks. `renderBand()` is deliberately empty — *"the
simulated telemetry readouts are gone; the panels button is the only thing that lived on this bar
and was real"* (`index.html:1831`). `#activity`, `#telemetry`, `#chipsDock` and `#findings` are
`display:none` in the base stylesheet at every width for the same reason.

> **Correction to the first draft of this document.** It stated a principle called *"the model never
> sleeps — vitals are always present"*, citing the `#vitals` CSS block. That block styled an element
> that has never existed in the markup, and its "always present" comment was stale. **There is no
> always-on liveness readout in this product, by design.** The only thing feeding one would be
> `AMBIENT` (`index.html:1856`), which invents record counts with `Math.random()`. That is demo
> data — legitimate, and labelled `DATA: SIM` in the HUD — but it is not a live pulse, and putting it
> on a permanent strip would be the same facade as the scanning line b71 deleted. The dead `#vitals`
> rules were removed in `b73`. **Do not "restore" a liveness indicator without a real signal to feed
> it.**

---

## 3. Tokens

### 3.1 Colour — the provenance system

This is the spine of the whole design. **Five classes of epistemic status**, each with one colour,
used identically in text chips, figure strokes, borders and node fills.

**There is one definition.** The CSS custom properties (`index.html:18–26`) are the source; the JS
object the figures paint with reads them at boot via `getComputedStyle` (`index.html:1027`). The
hex literals in that block are fallbacks for a browser that returns an empty string, nothing more.
**To change a provenance colour, change `:root` and only `:root`.**

| Class | Meaning | CSS var | Hex |
|---|---|---|---|
| Measured | Evidence; something was observed | `--ev` | `#0a6a90` |
| Calculated | Derived from measurement | `--calc` | `#38536f` |
| Assumed | A prior, unmeasured | `--asm` | `#b4560a` |
| Proposed | Hypothesis, not yet supported | `--hyp` | `#5a34a8` |
| Claim | The user's own assertion | `--clm` | `#1b2b3d` |

`HUDA`, the figure-chrome accent, is now `C.asm` rather than a third copy of the same hex
(`index.html:4101`).

Status and neutrals:

| Token | Value | Use |
|---|---|---|
| `--ok` | `#12855a` | contained, consistent, passing |
| `--bad` | `#c0392b` | conflict, breach, failure |
| `--ink` | `#14263a` | primary text |
| `--ink2` | `#2e4a66` | body text |
| `--dim` | `#4c6076` | micro-labels, axis text, captions. 6.2:1 against the room — raised from `#54697d` (5.4:1) in `b73` |
| `--line` | `rgba(26,52,84,.16)` | hairline dividers |
| `--line2` | `rgba(26,52,84,.30)` | container borders |
| `--surf` | `rgba(255,253,249,.82)` | translucent panel fill |

**Amber (`--asm`) has a second job.** Besides "assumed", it is the product's single accent: the
active dock underline, the primary CTA, the open-section marker, the console prompt, the plate
number, the reticle. This overloading is intentional and consistent — but it means *amber in a
figure means "assumed", amber in chrome means "here"*. Do not use amber for a figure element that
isn't an assumption.

**Ground.** The room is a warm off-white built from three stacked layers (`index.html:29–36`):
a radial amber wash top-right, a radial grey wash bottom-left, and a `168deg` linear gradient
`#faf8f3 → #f4f3ef → #edeeee`. On top of it sit a multiply-blended paper grain
(`#grain`, 3px dot lattice at 30% opacity) and a vignette (`.vig`).

**There is exactly one dark surface in the product**, and it is not a panel — it is the sky the
black hole occupies, a graphite aperture with a soft radial edge that simply stops being dark as it
reaches the room (`index.html:459–461`). Do not add a second. The onboarding screen (`#onb`,
`index.html:792`) is the one remaining navy full-bleed surface and predates this rule; it is a
candidate for reconciliation.

### 3.2 Type

Two families, no third:

```
--f: 'Inter','Inter var', system-ui, -apple-system, 'Segoe UI', Roboto,
     'Helvetica Neue', Arial, sans-serif
--m: ui-monospace, 'SF Mono', 'JetBrains Mono', 'Cascadia Mono', Consolas,
     'Roboto Mono', Menlo, 'DejaVu Sans Mono', monospace
```

**No webfont, and that is now a stated decision rather than an omission** (`b73`). One file, no
build step, no third-party request: a CDN font breaks all three, and an embedded one puts a quarter
of a megabyte in front of first paint. So Inter is used where it exists and the chain names the
closest equivalent on each platform explicitly, rather than leaning on `sans-serif` to mean
something sensible. The tracked-out micro-labels are what degrade most without Inter, which is why
the fallbacks are enumerated.

**The mono is not for code.** It marks *machine-produced quantity*: readouts, counters, IDs, axis
values, telemetry, plate numbers, the build stamp, timestamps. Anything a person wrote is Inter.

The scale is not a neat ratio — it is two registers with very little in between, on purpose
("a page of mediums reads as nothing", `index.html:196`):

| Register | Size | Where |
|---|---|---|
| Display | `clamp(32px, 4.45vw, 64px)` | front-door `h1` (`.hhero h1`) |
| Section | `clamp(26px, 3.4vw, 46px)` | front-door `h2` (`.hsec>h2`) |
| Numbers | `clamp(30px, 3.5vw, 50px)` mono 800 | `.hnums b` |
| Lede | `clamp(14.5px, 1.28vw, 17.5px)` | `.hlede` |
| Station heading | `17.5px / weight 440` | `.sec h2` |
| Body | `12.3px / 1.75` | `.sec p` |
| Dense body | `10.3–11.6px` | inspector rows, cards, console |
| **Micro-label** | **7–9.5px, weight 800, uppercase, `letter-spacing .14–.34em`** | everywhere |

The micro-label is the most distinctive type object in the system and appears in ~40 places. Its
formula is: uppercase, weight 750–800, tracking between `.14em` and `.34em`, colour `--dim` or
`--ink2`, size 7–9.5px. Wider tracking = higher in the hierarchy (`.34em` on overlay labels, `.14em`
on inline keys).

Station body text sets in **two columns above 1250px** (`index.html:537–543`), with an opened
section spanning both so nothing is ever sawn in half.

### 3.3 Space, radius, elevation

Spacing is expressed as fluid `clamp()` on the front door and fixed px in the workspace. The
recurring front-door values are worth treating as tokens:

```
page gutter     clamp(18px, 5vw, 64px)
section pad     clamp(46px, 6vw, 92px)
grid gap        clamp(16px, 1.8vw, 26px)
block rhythm    clamp(26px, 3vw, 40px)
```

**Radius carries meaning, roughly:**

| Radius | Meaning | Examples |
|---|---|---|
| `0` | instrument surface, part of the document | `.sec`, `#liveFig`, figures |
| `2–3px` | a hard-edged sheet or control | `.gsec`, `.chip`, `#newBox`, `.hgo` |
| `4–7px` | a card that sits on the page | `.hgrid article`, `.hpick figure` |
| `9–14px` | a floating object above the page | `#insp`, `.pcard`, `#bandMenu` |
| `50%` / `99px` | a dot, a mic, a pill | `.mic`, `.hkick`, `#cxOpen` |

**Elevation is one long soft shadow with a large negative spread**, never a stack. Two families:

- *Warm* (front door, sheets): `0 Npx Mpx -Kpx rgba(60,48,32,.3–.6)`
- *Cool* (floating workspace objects): `0 Npx Mpx -Kpx rgba(10,30,60,.4–.6)`

Cards that need to feel like a physical plate add a 1px inner top highlight:
`0 1px 0 rgba(255,255,255,.75) inset` (`.hpick figure`, `index.html:311`).

Floating panels use `backdrop-filter: blur(10–22px)`; `.pcard` adds `saturate(1.15)`.

### 3.4 Motion

Four easing curves, and they are not interchangeable:

| Curve | Duration | Use |
|---|---|---|
| `cubic-bezier(.16,.9,.3,1)` | `.26–.9s` | **entrances and lifts** — hero rise, card hover, step hover |
| `cubic-bezier(.2,.8,.2,1)` | `.25–.5s` | **panels** — inspector slide, station in, brief slide |
| `cubic-bezier(.2,.7,.2,1)` | `.7–1.1s` | **state and progress** — vitals bars, construction bar, onboarding dissolve |
| `cubic-bezier(.55,0,.45,1)` | `13s` | the hero beam only (`hsweep`) |

Named keyframes: `fi` (fade-in-up, `.4s`), `hrise` (`.9s`, staggered `.09s` per line), `stIn` /
`vIn` (station and figure entrance), `bl` (blink, `2.8s`), `hpulse` / `micp` (expanding ring),
`fl` (attention flash), `lvf` (live-value flash), `hroll` (`42s` ticker, pauses on hover).

**Reduced motion is honoured globally** with a blunt override (`index.html:829–831`): all animation
`.01ms`, all transition `.05s`. The JS also branches on it independently — `RM` (`index.html:1023`)
and `RMO()` (`index.html:7521`) — so canvas and SVG animation opt out too. Any new animated element
must be reachable by one of these three mechanisms.

---

## 4. Layout architecture

### 4.1 Two surfaces

**The front door** (`#home`, `index.html:891`) — `position:fixed`, `z-index:900`, scrollable,
`user-select:text`. **It is removed from the DOM once you are through it** (`index.html:172`). It is
a conventional scrolling marketing page: hero → ticker → 4-step mechanism → 6-card capability grid →
6 readout figures → perimeter table → pricing → auth card → close.

**The workspace** — `html,body { height:100%; overflow:hidden; user-select:none }`
(`index.html:28`). Never scrolls. Everything is absolutely positioned inside a fixed viewport.

### 4.2 Workspace stacking order

Layering is explicit and worth preserving:

| z | Layer | Element |
|---|---|---|
| 900 | front door | `#home` |
| 80 / 75 | onboarding / construction | `#onb`, `#cons` |
| 66 / 64 / 62 / 60 | overlays | `#newOv`, `#gal`, `#plansOv`, `#ap` |
| 58 / 57 | console | `#cxOpen`, `#cx` |
| 50 | tooltip | `#tip` |
| 20 | floating cards | `#cards` |
| 10 | chrome | `#chrome` |
| 8 / 7 / 6 | figure input, stage, WebGL | `#figInput`, `#stage`, `#gl` |
| 5 | document | `#doc` |
| 2 | grain, vignette | `#grain`, `.vig` |

**`#chrome` is `pointer-events:none`** so the workspace beneath stays reachable. Every child must
opt back in with `pointer-events:auto`. This has bitten before — there is a standing comment about
it at `index.html:705`, where the figure panel's backdrop and close button silently swallowed every
click. **If you add anything inside `#chrome`, set `pointer-events:auto` on it.**

### 4.3 The station

The unit of the workspace is a **station**: text pane left, live visual pane right, both alive.

```
#ststep   stepper strip, top-left      (66vw wide, dots + current title)
#stext    text pane                    (left:26px, width 66vw, max 1180px, scrolls)
#svis     visual pane                  (left: 66vw+44px, right:14px)
#band     status band, bottom-right    (speak · activity · telemetry · panels)
```

Three visual-pane modes: default (side), `.m` (stacked under a narrower text column), and `.full`
(the instrument takes the room, masked at the edges so the volume dissolves into the page rather
than ending at a border — `index.html:424–433`).

Stations are declared in `stationsBase(mode)` (`index.html:4561`) as `{id, label, sub, vis, html}`,
with `vis` naming a figure from `VISTITLE` (`index.html:4552`). Console-generated stations are
appended from `CXTABS` (`index.html:7246`) and are grouped and styled identically — that is the
point of the disclosure logic running on rendered DOM rather than at call sites
(`index.html:4824`).

### 4.4 Modes

Six instruments over one corpus (`MODEDEFS`, `index.html:2952`), with sub-instruments per mode
(`SUBDEFS`, `index.html:3830`):

| Mode | Object | Sub-instruments |
|---|---|---|
| `watch` | evidence stream | Change stream · Literature agreement |
| `model` | live black hole | Physical system · Dependency graph · Error budget |
| `analyze` | hypothesis space | Evidence landscape · Cost–yield frontier · Hidden connections |
| `memory` | time evolution | Timeline |
| `claim` | living claim | Structure · Referee simulation |
| `reason` | think out loud | — |

### 4.5 Responsive

Four breakpoints, all in `index.html`:

- **`min-width:1250px`** — station text goes two-column.
- **`max-width:980px`** — hero collapses to one column; the globe moves above the text.
- **`max-width:900px`** — the big one. Findings, activity, telemetry, chips dock and vitals are
  **hidden entirely**; the dock moves to the bottom; the console goes full-width; the figure panel
  goes single-column.
- **`max-width:760px`** — front-door nav links hidden.

**`b73` rewrote the ≤900px case.** Before it, the mobile block was five `display:none` lines that
left the real problem untouched: the station kept its two-pane geometry all the way down, so at
390px the text held 66vw and the figure got a ~100px sliver. Now `#doc` becomes the scroller,
`#ststep` / `#stext` / `#svis` fall into normal flow stacked, `#liveFig` takes `min(44vh,340px)`,
body text goes to 13px, and the dock, controls and panels button are held clear of each other. Four
of the five hidden surfaces were already `display:none` at every width — hiding them again on
mobile changed nothing (see §2).

**`b74` fixed the top strip, which was broken at more widths than mobile.** `#brand` and `#hud` are
positioned into the same row independently and neither accounts for the other; below ~580px the
readouts overprinted the wordmark. Below 560px they now take a line each (`#doc` starts at 84px);
between 560–900px the mark shrinks and `#cmdHint`, `#qBtn b` and `#planBtn b` drop out. **`#liveBtn`
keeps its value at every width** — `SIM` vs `LIVE` is the honesty label from §9.4 and must never be
what gets dropped for space. The same collision existed on the *desktop* between 901–1150px, where
the centred dock ran into both ends of the strip; that range now drops `.dk .d` and the same two HUD
values. The dock carries the ticker's masked fade so its scroller reads as "more", not as damage.

---

## 5. Component inventory

Grouped by role, with the line where each lives.

### Chrome
| Component | Line | Notes |
|---|---|---|
| `#brand` | `56` | wordmark, `.46em` tracking; `.dark` variant for dark scenes |
| `#dock` | `60` | mode switcher; active = amber bottom border |
| `#hud` | `77` | WATCH / PLAN / DATA / CMD / account / build stamp |
| `#bld` | `84`, `755` | build stamp — **clickable**, opens the changelog |
| `#banner` | `69` | full-width status; `.work` / `.good` / `.bad` |
| `#band` | `493` | the bottom bar. One real control on it — the panels button. `renderBand()` is empty on purpose |
| `#ctl` | `112` | per-mode instrument controls: `.cchip`, `.cslider` |
| `#band` | `476` | one-glance status band |

### Content
| Component | Line | Notes |
|---|---|---|
| `.sec` | `493` | a station section |
| `.gsec` | `508` | **grouped disclosure** — the workhorse. Collapsed header carries `.t` (question) + `.d` (2-line clamped answer) + `.cv` chevron |
| `.dtable` | `554` | data table; `tr.click` and `tr[data-x]` cross-highlight the figure |
| `.kfd` / `.kf` | `563`, `384` | ranked key finding, expands to working |
| `.chip` | `136` | provenance chip; one class per provenance |
| `.warnbox` | `368` | amber-left inline warning |
| `.echo` | `376` | what the system heard you ask |

### Floating
| Component | Line | Notes |
|---|---|---|
| `#insp` | `127` | inspector card, right, slide-in |
| `.pcard` | `608` | draggable contextual card |
| `#brief` | `647` | executive briefing overlay |
| `#tip` | `634` | the one dark tooltip |
| `#findings` | `571` | finding stack, top-left |

### Overlays
| Component | Line | Notes |
|---|---|---|
| `#cx` | `672` | **the console** — standing right panel, plain language in, real work out; files answers as stations rather than chat |
| `#gal` | `709` | figure panel; grid of every applicable figure, click one for solo |
| `#ap` | `775` | command aperture (⌘K) |
| `#newOv` | `738` | what shipped in this build |
| `#plansOv` | `759` | plan & billing — explicitly *not* a research station |

### Front door
| Component | Line | Notes |
|---|---|---|
| `#hnav` | `179` | sticky nav |
| `.hhero` / `.hbeam` | `199`, `211` | hero with grid mask, dual radial wash, sweeping beam |
| `.hkick` | `218` | live pill — pulsing amber dot + live count |
| `.hnums` | `241` | four large mono figures, amber; counted up on init over ~28 steps at 34ms (`index.html:8405`), snapped to final value under reduced motion |
| `.hticker` | `251` | archive ticker, masked at both edges, pauses on hover |
| `.hstep` / `.harrow` | `291`, `302` | 4-stage mechanism strip |
| `.hgrid article` | `275` | capability card; amber left rule scales to full height on hover |
| `.hpick figure` | `309` | readout plate |
| `.hcard` | `321` | auth card |

### Input
| Component | Line | Notes |
|---|---|---|
| `.askbar` | `348` | the ask field — **first thing on every research station** (`index.html:7173`) |
| `.mic` | `360` | dictation; degrades honestly where `SpeechRecognition` is absent (`index.html:3317`) |
| `.abtn` / `.hgo` / `.hlink` | `163`, `187`, `192` | actions: underline, amber solid, cyan text |

---

## 6. The figure language

This is the part most likely to be got wrong by someone new, and the part most worth protecting.

### 6.1 Chrome primitives

Five functions, one vocabulary, called by both pipelines (`index.html:4071–4127`):

| Primitive | Line | What it answers |
|---|---|---|
| `hudBrackets(x,y,w,h,len,col)` | `4073` | *where is the live area* — four corner brackets, amber, 1.4 stroke |
| `hudRail(x,y,w,h,step,col)` | `4080` | *at what scale* — rangefinder ticks, every 5th longer |
| `hudReticle(cx,cy,r,label,lx,ly)` | `4093` | *which point is the point* — dashed ring + halo + cross + leader to a label set clear of it |
| `hudPlate(x,y,id,rev,note)` | `4108` | *which figure is this* — plate number set **rotated −90° up the left margin**, because the bottom is already spoken for by captions |
| `hudFrame(u,x,y,w,h,o)` | `4116` | all of the above for a plot rectangle |
| `roHead(s,title,readouts,x0)` | `4122` | the readout header — title at 9.6px/800/`.16em`, then key/value pairs at 72px pitch |

`HUDA = '#b4560a'` (amber) and `HUDI = 'rgba(26,52,84,'` (ink, alpha appended by the caller).

### 6.2 Rules for a new figure

1. **Open with `svgO(w,h)`** (`index.html:4034`) — it guarantees the shared gradient/filter defs are
   in the document first. Per-SVG ids collide because every figure lives in the same document; the
   `FID` counter (`u=++FID`) namespaces anything that must be local.
2. **Header via `roHead`**, with 3–5 readouts. Every readout is a real computed quantity with a
   provenance colour. No readout may be a label.
3. **Colour by provenance, not by series.** Measured points cyan, calculated bands navy, priors
   amber, hypotheses violet, conflicts red, passing green.
4. **Text sizes inside SVG run 5.4–10px**, mono, weight 600–800, tracking `.02–.16em`. Axis values
   `6.8px/--dim`; annotations `6–6.6px`; readout values `10px`.
5. **Annotations are sentences, set on the geometry.** `svgEVPA` (`index.html:4128`) rotates its
   trend label to the slope of the line it describes and writes `TREND +5.2°/EPOCH MONOTONIC 9/9`
   rather than a legend entry. Do this.
6. **A figure ends with a verdict line** at `H-8`, 6px, `--dim`, stating what the reader should
   conclude — e.g. *"THE BREACH IS BOUNDARY-SHAPED, NOT NOISE-SHAPED"* (`index.html:4181`).
7. **Interactive elements must announce themselves.** The draggable band in `svgEVPA` carries a
   `◆ DRAG` handle and an inline instruction (`index.html:4145–4147`). `data-hl="…"` on a group
   wires it to the cross-highlight system (`svg.xdim [data-hl]`, `index.html:468`), which dims
   everything else to 28% and glows the match.
8. **No looping motion that encodes nothing.** One-shot pulses on a genuine event are fine; a
   perpetual sweep is not. The `pulse()` / `dashflow()` / `drawon()` stubs that used to stand in for
   the deleted motion are gone as of `b72`, along with their call sites — a function returning `''`
   invites someone to "fix" the facade back into existence.

Figures also carry an accessible name, and it is attached in exactly one place: `roHead`
(`index.html:4152`) injects a `<title>` and a matching `aria-label` onto the root from the title and
readouts it is already given, and `svgO` sets `role="img"`. **A new figure gets this for free if it
goes through `roHead`.** One that does not must set its own name.

### 6.3 The six front-door readouts

`hfig1…hfig6` (`index.html:7827`), deliberately in forms already legible to a physicist: exclusion,
joint density, spectrum, residuals, citations-against-year, support graph. They share one injected
set of gradients and filters so the strip reads as one material — a lit sphere, an extruded face, a
soft shadow. They are DOM-built (`mkn()`, `index.html:7519`) rather than string-built, but call the
same chrome.

---

## 7. Interaction and content rules

### Interaction
- **Every figure is manipulable.** Drag the admission volume to move the relevance threshold and
  every table on the left re-filters (`index.html:6017`). Drag the EVPA band to actuate the heating
  prior. Wheel and drag orbit the black hole.
- **Table ↔ figure is bidirectional.** `tr[data-x]` gets `cursor:crosshair` and drives
  `data-hl` highlighting in the SVG.
- **Progressive disclosure everywhere.** `.gsec`, `<details>` in the inspector, `.kf`/`.kfd`,
  `.fnd` — all collapse to a line and open on click.
- **Two ways to talk to it, always available:** the console (⌘K or the `◈` edge button) and the ask
  bar at the top of every station. Dictation on both.
- **Escape closes overlays. `/` opens the aperture.**
- **The build stamp is a support channel.** *"I am not seeing the changes" has to be answerable in
  one click, by the page itself* (`index.html:3119`). `WHATSNEW` entries are
  `[title, what changed, where to look]` — the third field is mandatory.

### Content and voice
- Headings and digests: **sentence case, plain sentences with physics words.** Chrome labels:
  uppercase micro-label. Never mix.
- A section header states its finding. `data-dg="…"` supplies the digest; if you omit it the first
  sentence is used, so **write the first sentence as the finding**.
- Numbers are always mono and always sourced. Counts are counted off returned records — the code
  repeatedly asserts *"Nothing below is invented"* (`index.html:6414`, `6421`).
- Failures name their cause. A failed call says what came back; a stale sweep says how old it is
  (`.stale`, `index.html:372`).
- Capabilities the browser lacks are stated, not faked (dictation is the reference case).

---

## 8. What design depends on from the backend

| Contract | Where | Design consequence |
|---|---|---|
| 18 archives | `setup/ingest.ts` — `openalex, crossref, ads, s2, europepmc, arxiv, inspire, pubmed, zenodo, openaire, osti, ntrs, cds, dblp, plos, doaj, hal, datacite` | The ticker, the perimeter table, the depth axis of the admission volume and the arrival terrain all key off archive identity. Adding one changes six surfaces. |
| Era ladder | `ingest.ts:854` — `[1665,1929]` then every decade to the 2020s | The spectrum figure's x-axis and the "quiet decades are the gaps" reading. |
| Sharded sweep | `ingest.ts` v10 | The UI **fills in progressively** as slices land. Any loading state must tolerate partial corpora, not a single spinner. |
| `records` / `findings` | `setup/schema.sql` | `relevance` (0–1) drives the draggable threshold; `severity` drives finding colour. |
| Three tiers | `TIERS`, `index.html:5247`; `COST`, `5246` | Limits are enforced, not decorative. Pricing is derived from measured per-record cost — if you restyle the pricing table, keep the derivation visible. |

---

## 9. Known gaps and risks

Everything the first draft listed has now been either fixed or deliberately settled — see §11.
What follows is what is genuinely still open, and it is mostly structural rather than visual.

1. **`#chrome` is `pointer-events:none`.** Anything added inside it without `pointer-events:auto`
   will be silently dead — no error, no visual clue, and clicks land on whatever is beneath. This
   has already caused one shipped bug (`index.html:705`). It is a convention, not something a rule
   can enforce, so it stays a risk.
2. **Every id is global.** One file, a flat id namespace, and a `FID` counter to keep SVG defs from
   colliding. It works, and the no-build-step constraint that produces it is a real product
   decision — but a new figure that forgets `u=++FID` will quietly borrow another figure's
   gradients.
3. **Focus-ring coverage is by convention, not by audit.** The global `:focus-visible` rule plus
   `:focus:not(:focus-visible){outline:none}` means no control needs to disable its own outline —
   and `b73` removed the four that did. But a *future* control that sets `outline:0` on itself, or
   an inline `style` that does, will out-specify the ring and go dark again. There is no lint.
4. **The demo corpus is simulated, and the seam is one HUD label.** `AMBIENT` (`index.html:1856`)
   invents record counts with `Math.random()` and increments `S.counters`, which the executive
   briefing then reports as fact ("the perimeter read 2,143,208 records"). This is legitimate — the
   worked example is a demo and the HUD says `DATA: SIM` — but the honesty of the whole product
   rests on a user noticing one small label. **If you touch that area, make the seam louder, not
   quieter.** Left alone here because changing it is a product call, not a design repair.
5. **The reveal covers what the builders happen to mark.** `b73` restored the scroll reveal, but
   only the elements carrying `data-draw` / `data-pop` / `data-grow` participate — a few curves and
   groups per figure, not the whole plate. The `b68` changelog describes something more thorough
   than what the marks actually cover. Either mark more, or keep the copy honest.
6. **Micro-label size is now a taken decision, not an open one.** 7px chrome and 6px in-figure text
   stay; `--dim` moved to 6.2:1 to carry them. Recorded here so the next person knows it was
   weighed rather than inherited — and so that if they disagree, they are re-opening a decision
   rather than fixing an oversight.

---

## 10. Adding a surface — checklist

- [ ] Does it answer *where am I looking, at what scale, which point is the point*? If not, cut it.
- [ ] Off-white ground, no colour slab, no second dark panel.
- [ ] Provenance colour if it carries epistemic status; amber only for assumptions in figures.
- [ ] Inter for prose, mono for machine-produced quantity. No third family.
- [ ] Micro-labels uppercase 7–9.5px / 800 / `.14–.34em`; headings sentence case.
- [ ] Radius chosen from §3.3 by what the thing *is*.
- [ ] One long soft shadow, warm on the front door, cool in the workspace.
- [ ] Easing chosen from §3.4 by *category*, not by feel.
- [ ] Inside `#chrome`? Set `pointer-events:auto`.
- [ ] Reduced motion honoured — CSS override, `RM`, or `RMO()`.
- [ ] Collapses to one line that carries its answer.
- [ ] New figure: `svgO()` first, `roHead()` with real readouts, `hudFrame()`, verdict line, `data-hl`
      hooks, no perpetual motion.
- [ ] Keyboard-reachable, and does not set `outline:0` on itself (it would out-specify the ring).
- [ ] Ships with a `WHATSNEW` entry whose third field says **where to look**.

---

## 11. What this handoff changed (`b71` → `b74`)

The document was run against the app twice. `b72` fixed the conformance defects — the app
disagreeing with its own stated system. `b73` completed the rest, and in doing so proved three of
this document's own claims wrong; those are corrected in place above and called out below.

### `b72` — conformance

| Fix | Where | Effect |
|---|---|---|
| **One palette.** `C` reads the `:root` custom properties at boot instead of being a second hand-written copy. `HUDA` derives from `C.asm`. | `1027`, `4101` | `calc`, `ink2` and `bad` were each a different colour in a figure than in the text beside it. Verified identical. |
| **Focus ring.** Global `:focus-visible`, pointer focus silenced, dark-surface variant. | `42–56` | Keyboard navigation visible for the first time. |
| **Figures have accessible names.** `svgO` sets `role="img"`; `roHead` injects a `<title>` and `aria-label` from the title *and* its readouts. | `4064`, `4152` | All ten readouts, one insertion point. |
| **Dead scaffolding removed.** `pulse()`, `dashflow()`, `drawon()` and five call sites; `armFigures()` and the `.seen` observer. | `4090`, `8433` | No visual change. Removed a `getTotalLength()` sweep on every load. |
| **Build stamp written from `BUILD`.** | `3280` | It was hand-typed, so it went stale the moment `BUILD` moved. |

### `b73` — completion

| Fix | Effect |
|---|---|
| **The small screen, laid out.** `#doc` becomes the scroller; `#ststep` / `#stext` / `#svis` stack in normal flow; `#liveFig` gets `min(44vh,340px)`; body text to 13px; dock, controls and panels button held clear. | At 390px the text was 66vw and the figure a ~100px sliver. Verified: text now full width, document scrolls, no horizontal overflow. |
| **The last dark surface, brought into the room.** `#onb` takes the off-white, the front door's grid wash, ink type and the amber button. | The only dark surface left is the graphite aperture the black hole sits in — which is what §2 always claimed. Verified: `h1` `rgb(20,38,58)`, button `rgb(180,86,10)`. |
| **The scroll reveal, restored and guarded.** The CSS that reads `data-draw` / `data-pop` / `data-grow` is back, all of it behind `#home.reveal`, which the script adds *only* on the path where it will also observe. | Claimed since `b68`, not true since. Verified: nothing hidden after settle; under `prefers-reduced-motion` the class is never added and every figure is simply drawn. |
| **Micro-label contrast re-taken.** `--dim` `#54697d` → `#4c6076`, 5.4:1 → 6.2:1. Sizes kept. | A decision, recorded, rather than an inheritance. |
| **A typeface decision.** No webfont — stated, with reasons — and an explicitly enumerated fallback chain per platform. | Was an assumption; is now a choice. |
| **Dead `#vitals` CSS removed; `v3.html` deleted.** | Fifteen rules styling an element that never existed; 178KB linked from nowhere. `v3.html` is recoverable at `git show cfbcdca:v3.html`. |

### `b74` — collisions the CSS did not reveal

Found by rendering the running app at 360 / 390 / 472 / 520 / 700 / 880 / 1000 / 1500px and testing
every pair of chrome elements for overlap, rather than by reading the stylesheet. Reading it had
missed all four.

| Fix | Effect |
|---|---|
| **Wordmark and readouts overprinted below ~580px.** Two lines below 560px; shrink-and-drop between 560–900. | The mark was unreadable in any side panel or phone. `DATA`'s value is exempt from dropping — it is the honesty label. |
| **The same collision on the desktop, 901–1150px** — the centred dock ran into both the mark and the readouts. Pre-existing, unrelated to the mobile work. | `.dk .d` and two HUD values drop in that range only. |
| **`REASON` sliced off the dock** with no sign it scrolled. | Modes shrink so all six fit from ~470px; below that, the ticker's masked fade signals more. The console button also came down from mid-page to join the other controls. |
| **The ask field pushed its own button off a 360px screen** — a flex child that was never told it may shrink below its text. | `min-width:0` on the input; the bar wraps. |

**Verified:** at all eight widths — zero element-pair collisions, no horizontal overflow, and the
build stamp reachable at every one of them. The dock still overflows its scroller below ~470px,
which is intended: six modes do not fit a 360px phone, and it now says so.

### Three things this document had wrong

Running it against the app is what exposed them. All three are corrected above.

1. **"The model never sleeps — vitals are always present."** Stated as a principle in §2, cited to
   the `#vitals` CSS. **There has never been a `#vitals` element.** The rules styled nothing and
   their "always present" comment was stale. There is no always-on liveness readout, deliberately:
   `renderBand()` is empty because the telemetry it held was simulated. The real principle is
   *nothing simulated is shown as if it were live*.
2. **"At ≤900px five ambient surfaces disappear."** Four of the five — `#findings`, `#activity`,
   `#telemetry`, `#chipsDock` — are `display:none` in the **base** stylesheet at every width. The
   fifth never existed. Mobile's problem was never the hidden panels; it was the two-pane layout
   that survived all the way down.
3. **The component inventory listed `#vitals` as a live component.** It was read from CSS without
   checking the markup. Corrected to `#band`, which is what actually sits on the bottom edge —
   carrying one real control.

**Verification.** JS syntax-checked after every pass, then loaded in Chromium at 1600×1000 and
390×844, with and without `prefers-reduced-motion`. No page errors and no `console.error` on any
path. Front door renders complete — hero, counters reaching 124/18, six readouts, globe,
18-archive ticker, perimeter and pricing tables. Focus ring confirmed by real `Tab` presses. Figure
accessible names confirmed by calling the builders directly. Reveal confirmed to settle fully
visible, and confirmed never to engage under reduced motion.

**One thing verified only structurally:** the stacked `#svis` figure pane. It is rendered only when
a station has a visual, which needs a watch with returned records, which needs the Supabase
perimeter — unreachable offline. The rules are correct by inspection and the element is absent
rather than misplaced in the offline runs. **Worth a look on a real phone against a live backend.**

---

*Handoff prepared against `b71`, run against the app, and updated to `b73`. If the build stamp in
the top-right no longer reads `b73`, open it — it lists what has moved since.*
