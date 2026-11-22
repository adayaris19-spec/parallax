# Short-form video: progress

Checklist of the phases in `MASTER_PROMPT.md`. Times are UTC+1.

- [x] **Phase 1: Check understanding** — confirmed by the owner Nov 21. The "Moon by 2020" Reel worked because of its story (real promise, real miss, real dates, punchline), not its text styling; the settled narration and text rules stand.
- [ ] **Phase 2: Discovery interview** (11 topics → draft rules in `RULES.md`)
  - [x] 1 Purpose and feeling — stakes then momentum; viewer action is keep watching
  - [x] 2 Subject matter — own made imagery in NASA artist-illustration style, real footage only for filmed events; goal story first, news when big
  - [x] 3 Structure and timing — 4 shots of 4.5–7 s, strongest picture first, peak in shot 3
  - [ ] **Feasibility test pulled forward (owner's choice, Nov 21):** can the artist-illustration look be made for free? Stills sent; waiting for the owner's verdict. Details below.
  - [x] Added Nov 22 after the first moving clip — what goes on in a shot, how true a made picture must be, how to show things that do not exist yet (rules in section 2)
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
| Moon south pole, v2 | 40 m elevation, NASA 64k star map at 1:1, atmosphere, shadow fill | 2 min 20 s | 0 | "Pretty solid, definitely way better", but the parts look separate: "the Earth is good by itself, but against the background it just looks fake". Fixed in v3 with one shared lens pass (`comp3.py`); verdict on v3 pending |
| HIV capsid | 2,440,800 atoms of PDB 3J3Q | 4 min 50 s | 4 (7%) | "Pretty solid"; wants to see it moving |
| Queensland coast and reef | NASA VIIRS imagery of 2026-08-11 | 40 s | 14 (23%) | "Pretty solid"; wants to see it moving |

**Known weaknesses**
- Earth example: soft at full size. VIIRS true colour is gridded at 250 m but its real sharpness is coarser. Open ocean and space leave 23% of the frame empty.
- Moon v2: the largest shadows are still close to black (6.4% of the frame under 8/255). No hardware or people.
- Motion: see the motion test below. A 5 s shot is 120 frames, which costs 35 minutes to 2.5 hours of CPU per shot at these settings; to be reduced before it is practical.
- Each new subject needs its own scene script. That does not yet scale to 26 goals.

**Motion test (Nov 21–22): the same three scenes as 5 s clips, 1080×1920, 24 fps**

| Clip | Camera move | Render | Checks | Owner's verdict |
|---|---|---|---|---|
| Moon south pole, v3 lens pass | Flies 22 km forward at 100 km height; Earth rises 129 px (0.7°), ground slides about 1 px per frame at the bottom of the frame | 20 samples, 45 s per frame, 90 min | Fine detail stays attached to the ground between frames (0.93–0.99 correlation after motion compensation); stars stay locked to Earth; 0 empty cells, 0% pure black | "Not exactly what I was looking for": only three things in it, all sliding vertically; "not even scientifically right"; not engaging past a second. "If you could do this, you could definitely do what I want": more elements, more going on; slow is fine |

- The Moon camera moves 2.7 times faster than a real orbiter at that height (a real one covers about 8 km in 5 s). At real speed the move would be barely visible. Camera speed needs a rule.
- The film grain makes the file large: 16 MB for 5 s at this quality setting.
- Why it read as three sliding layers: a 10.6° lens from 100 km up has no near field, so flying forward only slides the ground down and Earth up.
- Two liberties in that clip are now ruled out (`RULES.md` section 2, Nov 22): the faster-than-real camera, and bright stars beside a sunlit Earth and sunlit ground.
- The capsid clip was not rendered: one object turning slowly would fail the same way. The Earth clip (a single surface gliding at real orbital speed) was finished for completeness.
- Owner's answers, Nov 22: all four kinds of "going on" are wanted, depending on the clip; future things may be published designs or our own designs built from published plans; pictures show only what a real camera could record.
- Next test: one shot with many separate things at work, built from NASA's published hardware models, with a real-camera exposure.

**Moon base test (Nov 22): "things at work", shot as a real camera would record it**

Scripts and the measured-versus-modelled record are in `tools/shorts-lab/` (see its README).

- In frame: an astronaut, a habitat with a second astronaut at its hatch, a crew rover driving in with turning wheels and thrown dust, an excavator robot, a second rover far off, wheel tracks, bootprints, rocks, and Earth. 10 separate things; the earlier Moon clip had 3.
- Real: the place (Connecting Ridge, LOLA elevation), the Sun and Earth for 2026-09-06 00:00 UTC from JPL's ephemeris, the hardware designs (NASA prototypes), no stars, real speeds.
- Checks on the last frame: 0 empty cells of 60; black sky covers 15.3% of the frame (draft limit 15%); 11.5% of pixels under 8/255, nearly all of it sky.
- Cost: about 60 s per frame at 32 samples, so about 2 hours for a 5 s shot.
- Still sent to the owner Nov 22; the 5 s clip is rendering. Verdict pending.
- Limits: the astronauts cannot walk (the suit model has one pose); the excavator is parked; no motion blur; everything smaller than about 30 m on the ground is modelled.

**Blocked: the open AI image model test.** The plan was an Apache-licensed image model run on the CPU through `stable-diffusion.cpp`. This session's safety check refused the build three times; it was not worked around. **Owner's decision (Nov 21): skip the AI image test for now.** Revisit only if the real-data method cannot cover a goal (for example things that do not exist yet, such as a finished Moon base with people).

**Other findings**
- NASA publishes 257 spacecraft and hardware models as `.glb` (github.com/nasa/NASA-3D-Resources). For a Moon base they include the Habitat Demonstration Unit, the Space Exploration Vehicle (crew rover), the RASSOR digging robot, the Mark III and Z2 spacesuits, an astronaut, the Apollo Lunar Module, dishes and the Gateway core. Most are Draco-compressed, which the `bpy` pip package cannot read (only the Gateway and three simple models load as they are); they need decompressing first.
- NASA's Deep Star Maps 2020 at 64k is 0.0055° per pixel, which is 1:1 with a 1920 px frame at a 10.6° field of view. Orientation was verified against Antares (within 2 px).
- NASA GIBS serves daily true-colour imagery as tiles with no key. Single-day mosaics have visible boundaries between satellite passes; shots must be framed inside one pass.
- EOX "Sentinel-2 cloudless 2016" tiles (CC BY 4.0) are sharp on land (about 140 m per pixel at zoom 10 here, finer at higher zooms), but the sea has visible coverage halos and seams around the coast and reefs. Usable for land only, under a land mask; not tried in a render yet.
- `eoimages.gsfc.nasa.gov` (Blue Marble) and `sciencedirect.com` cannot be reached from this environment.
