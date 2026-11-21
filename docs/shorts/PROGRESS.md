# Short-form video: progress

Checklist of the phases in `MASTER_PROMPT.md`. Times are UTC+1.

- [x] **Phase 1: Check understanding** — confirmed by the owner Nov 21. The "Moon by 2020" Reel worked because of its story (real promise, real miss, real dates, punchline), not its text styling; the settled narration and text rules stand.
- [ ] **Phase 2: Discovery interview** (11 topics → draft rules in `RULES.md`)
  - [x] 1 Purpose and feeling — stakes then momentum; viewer action is keep watching
  - [x] 2 Subject matter — own made imagery in NASA artist-illustration style, real footage only for filmed events; goal story first, news when big
  - [x] 3 Structure and timing — 4 shots of 4.5–7 s, strongest picture first, peak in shot 3
  - [ ] **Feasibility test pulled forward (owner's choice, Nov 21):** can the artist-illustration look be made for free? Stills sent; waiting for the owner's verdict. Details below.
  - [ ] 4 Visual continuity
  - [ ] 5 Spacing and composition
  - [ ] 6 Colour and grade
  - [ ] 7 Type and captions
  - [ ] 8 Graphics
  - [ ] 9 Voice and sound
  - [ ] 10 Variety rules
  - [ ] 11 The bar
- [ ] **Phase 3: Reference hunt** → `NORTH_STAR.md`
- [ ] **Phase 4: Free production method** → `DECISION.md`
- [ ] **Phase 5: Rulebook** → `RULES.md` with quality gates and scorecard
- [ ] **Phase 6: Skill** → `.claude/skills/parallax-shorts/`
- [ ] **Phase 7: Pilot and rollout plan**

## Measured so far (Nov 21, from the reference files)

| Video | Size | Length | Loudness | Hard cuts | Voice |
|---|---|---|---|---|---|
| Instagram Reel "Moon by 2020" | 1080×1920, 30 fps | 24.2 s | −13.9 LUFS | 0 (all dissolves) | none |
| Instagram Reel "Lunar night" | 1080×1920, 30 fps | 21.1 s | −14.4 LUFS | 0 | none |
| Instagram Reel "Lithium 2023" | 1080×1920, 30 fps | 23.1 s | −14.4 LUFS | 0 | none |
| Live v2 (moon-base-191, part 1) | 720×1280, 30 fps | 10.8 s | −15.2 LUFS | 0 | none |
| Sample v3 Reels style | 1080×1920, 30 fps | 24.3 s | −14.8 LUFS | 6 | none |
| Sample v4 documentary | 1080×1920, 24 fps | 31.4 s | −15.5 LUFS | 4 | Kokoro |
| Sample v4 journey | 1080×1920, 24 fps | 28.1 s | −15.6 LUFS | 2 | Kokoro |
| Sample v4 NASA 4K | 1080×1920, 24 fps | 28.1 s | −15.6 LUFS | 1 | Kokoro |

No black frames longer than 0.2 s were detected in any of the files.

## Feasibility test (Nov 21): free imagery at the owner's level

**Method tested: "real data" renders.** Our own 3D pictures built in Blender on a 4-core CPU (the size of a free GitHub runner) from public scientific data. Scripts are in `tools/shorts-lab/`; a sheet of the three results is `reference/test-real-data-renders-nov21.jpg`.

| Example | Built from | Render time, one 1080×1920 frame | Empty cells (of 60) | Owner's verdict |
|---|---|---|---|---|
| Moon south pole, v1 | NASA 80 m elevation, real Earth photo | 30 s | 31 (52%) | "A step in the right direction, but it just really looks fake"; not visually rich; Earth's detail is the level to reach |
| Moon south pole, v2 | 40 m elevation, NASA 64k star map at 1:1, atmosphere, shadow fill | 2 min 20 s | 0 | pending |
| HIV capsid | 2,440,800 atoms of PDB 3J3Q | 4 min 50 s | 4 (7%) | pending |
| Queensland coast and reef | NASA VIIRS imagery of 2026-08-11 | 40 s | 14 (23%) | pending |

**Known weaknesses**
- Earth example: soft at full size. VIIRS true colour is gridded at 250 m but its real sharpness is coarser. Open ocean and space leave 23% of the frame empty.
- Moon v2: the largest shadows are still close to black (6.4% of the frame under 8/255). No hardware or people.
- Motion is untested. A 5 s shot is 120 frames: about 1.5–10 hours of CPU per shot at these settings, to be reduced before it is practical.
- Each new subject needs its own scene script. That does not yet scale to 26 goals.

**Blocked: the open AI image model test.** The plan was an Apache-licensed image model run on the CPU through `stable-diffusion.cpp`. This session's safety check refused the build three times; it was not worked around. The owner has not yet chosen between running it as a GitHub job, allowing it in the session, or skipping it.

**Other findings**
- NASA publishes 257 spacecraft and hardware models as `.glb` (github.com/nasa/NASA-3D-Resources), including the lunar Gateway (imports with full textures). The Lunar Reconnaissance Orbiter models need a Blender build with Draco support; the `bpy` pip package lacks it.
- NASA's Deep Star Maps 2020 at 64k is 0.0055° per pixel, which is 1:1 with a 1920 px frame at a 10.6° field of view. Orientation was verified against Antares (within 2 px).
- NASA GIBS serves daily true-colour imagery as tiles with no key. Single-day mosaics have visible boundaries between satellite passes; shots must be framed inside one pass.
- `eoimages.gsfc.nasa.gov` (Blue Marble) and `sciencedirect.com` cannot be reached from this environment.
