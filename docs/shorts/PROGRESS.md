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
- Still and 5 s clip sent to the owner Nov 22. **Owner's verdict:** "that's, I guess, fine", and "this style is also good", but it is obviously computer-made ("that's AI, that's really obvious"); it must look real enough that people ask "is this AI or is this real?". Too little moves besides the camera. Far too slow: about 3 hours of waiting for one 5 s shot. Asked for free tools that work like Higgsfield, not credit-based ones.
- Checks on the finished clip (120 frames, 1080×1920, 24 fps):
  - 4 things move on their own: the near rover with its wheels, the dust it throws, its beacon, the far rover.
  - Depth: the nearest ground crosses the frame at about 6.8 px per frame, ground about 40 m away at 2.4, and Earth at about 0.4 (the pan only). That is 17 times faster near than far; the draft rule asks for 4.
  - No flicker: brightness changes by at most 0.17 of 255 between frames, and fine ground detail matches 0.91–0.98 from one frame to the next after motion compensation. The join between the two render runs (frames 59 and 60) does not show.
  - 0 empty cells of 60 in every frame checked.
  - Black sky covers 19.8% of the first frame and 16.3% of the last, over the 15% draft limit.
  - Render: 58–62 s per frame, about 2 hours in two runs. Two copies at once run out of memory.
- Limits: the astronauts cannot walk (the suit model has one pose); the excavator is parked; no motion blur; everything smaller than about 30 m on the ground is modelled.

**Free realism and speed options (searched Nov 22)**

Figures below come from third-party write-ups and vendor pages found by search on Nov 22; each must be checked at its official source before it is relied on.

- Higgsfield is a paid front end that resells other companies' models (for example Kling and Seedance) on credits. Its free plan is reported to include no monthly credits and no commercial use.
- Free tiers of hosted generators (Kling, Luma, Pika, Sora, Veo): reported to carry watermarks, daily caps and no commercial rights, and none can be automated. Ruled out.
- Open models that can be run for free: Wan 2.2 (Alibaba) is reported as Apache 2.0, with image-to-video; its VACE variant takes a control video and reference image, which is how our own render could steer the result. HunyuanVideo 1.5's licence is reported to exclude the EU and UK. LTX's licence is reported inconsistently.
- Free graphics cards: Kaggle notebooks (reported at about 30 GPU-hours a week on a 16 GB card; terms for this use not yet checked); Hugging Face ZeroGPU (documented at 5 GPU-minutes a day for a free account, 2 without an account).
- First test: our frame through Wan 2.2 image-to-video on a public Hugging Face demo. Refused: the no-account quota for this machine's shared address was already used up. Needs the owner's free account token, added by the owner as the GitHub secret `HF_TOKEN`.
- Plan put to the owner: keep the accurate 3D scene as the skeleton, add a Wan realism pass that follows it, reject any result that drifts from the render; and split frame rendering across GitHub's free runners to cut a shot from 2 hours to about 15 minutes.

**Speed test (Nov 22): one shot split across GitHub's free machines**

- Workflow `.github/workflows/shorts-lab-render.yml`: the 120 frames are split into 20 chunks, one free runner each. It starts when `tools/shorts-lab/render-request.json` changes on the working branch, uses no secrets and publishes nothing.
- `tools/shorts-lab/prep_site_data.py` downloads only the rows of NASA's grids that the shot needs (266 MB prepared, 21 s on a runner, kept in the workflow cache) instead of 2.4 GB.
- Result: the same Moon base shot, same settings, finished in **16 min 44 s** against about 2 hours on one machine. All frames were rendered after about 12 minutes; the rest was one machine applying the camera response and encoding. That step now runs on each runner, so the next run should be shorter.
- The clip matches the single-machine render: mean difference 3.1 of 255 per pixel, the size of render and grain noise.
- Second full run, with motion blur added and the camera response moved onto each runner: 15 min 23 s.
- Scene changes for that run (all modelled, listed in the lab README): lunar dust and toned-down paint on the hardware, a small hand-carried camera wobble, half-frame shutter blur for the camera and rovers, the near astronaut lifts an arm and turns toward the rover, the second astronaut reaches for the hatch. The first render of it showed a blocky suit (the suit model is split into small patches that shade flat once its stored normals are removed); fixed by joining the patches, and rendered again before anything was sent.
- Free because the repository is public. A 4-shot video would need four such runs, one after another or queued together.

**AI realism test 1 (Nov 22): one render frame through open Wan 2.2 image-to-video**

- Run by `.github/workflows/shorts-lab-ai.yml` on a public Hugging Face demo. The workflow reported that no `HF_TOKEN` secret was visible to it, so it ran on the no-account quota of the GitHub machine.
- Output: 480×832, 81 frames at 16 fps (5 s), made in 56 s. Sent to the owner.
- Gained: natural motion. The astronaut turns, lifts an arm and walks out of frame; the rover drives in; the camera drifts.
- Failed the accuracy guard: by the last frame the rover is a different vehicle (its solar panels became a plain blue shell and it has four wheels, not six), a dust cloud hangs beside it (impossible without air), a few stars appear, and the ground has turned into soft blobs.
- Realism: no gain. It keeps the computer-made look of the frame it was given, at a quarter of our resolution.
- Not tested yet: the step that first makes the frame look photographed (the Qwen-Image-Edit demo returned an error), and the first-and-last-frame mode that pins both ends of the clip to our render.
- Reading: image-to-video from a rendered frame is not enough on its own. Owner's verdict pending.
- Test 2 (first and last frame pinned to our render, and the photographed-look step again): both demos refused within seconds, and the workflow again saw no `HF_TOKEN`. No more tests on the no-account allowance; the rest waits for the owner's token to be visible to the workflow.

**Owner's verdict on the Moon base clips and the AI clip (Nov 22):** "At least the moments are there", but every visual needs a purpose inside the goal's video, and it has to be realistic: "you just put a bunch of things on the Moon. Is that realistic? Is that what the goal is? That's the biggest thing right now." Detail still to improve. Rules added in `RULES.md` section 2 ("Every picture has a job"). The improved Moon base render finished but was not sent: it is the same purposeless shot.

**Next: one real video for the Moon base goal, message first.** The goal's own facts (read from the app's database Nov 22) say its biggest obstacle is the lunar night: about 354 hours of darkness, batteries losing over 35% of capacity below −20°C, small landers surviving only by shutting down, a reactor ground-tested in 2018 but none flown, and a few south polar ridges with near-constant sunlight that still go dark for days in some seasons. Shots are being designed from those lines.

**Moon base video "The 354-hour night": plan and first shot with a job (Nov 22)**

| Beat | Line, from the goal's own facts | The picture's job |
|---|---|---|
| Hook | "A night on the Moon lasts 354 hours." | Show how big and slow that night is: the real Moon and its day–night line |
| Build | "Batteries lose over a third of their capacity in the cold. Small landers get through by shutting down. A base with people can't." | Show the cold doing it: the dark surface with the two numbers the line says |
| Peak | "On a few ridges at the south pole, the Sun almost never sets. Even there, it goes dark for days in some seasons." | Be the evidence: a real month of sunlight at the south pole |
| End | "China and Russia aim to deliver a reactor for their lunar station in 2033 to 2035." | Point forward: a reactor, shown only as planned |

- The lines are a draft put to the owner; not yet approved.
- Peak shot, version 1 (`tools/shorts-lab/pole_light.py`): Shackleton crater and the ridges beside it from a fixed point about 60 km up, 1 to 30 October 2026 in 5 s. Terrain is LOLA elevation; the Sun's direction and size for each frame come from the JPL ephemeris; three Sun positions are averaged per frame as the time-lapse's own blur. Rendered on GitHub's runners in 15 min 24 s. Sent to the owner.
- Measured from the clip: the best-lit point, on Shackleton's rim, is in sunlight in 81% of the frames; 0.24% of the picture is lit for at least 60% of the month; 28% is never lit; the darkest stretch is around 23–24 October, with 5% of the picture lit. These are our own counts from one month at 5.9-hour steps, not sourced figures, so they are not for narration.
- Not real, and to be said plainly: the viewpoint (nothing hovers above the pole) and the speed (a month in 5 s).
- Weak: soft at full size on the 40 m grid; much of the frame is dark for parts of the clip; nothing yet shows the viewer which points stay lit.
- Version 2 is rendering: the 20 m LOLA grid and a closer framing. Owner's verdict pending.

**Owner's verdict on the south pole time-lapse, and the next ask (Nov 22):** "This could be like a filler… 3 seconds max, but definitely not the main one… I think this is really plain." Then: "let's try one actual complete video with the AI voiceover, all the clips, the text… Put a lot of effort into it. It should be around 20-25 seconds." Rule added in `RULES.md` section 3 (one filler of at most 3.0 s).

**First complete video: Moon base, "the 354-hour night" (Nov 22)**

Plan file: `tools/shorts-lab/night-video.json`. Method and sources: `tools/shorts-lab/README.md`.

| Beat | Length | Line (all from the goal's facts) | Picture and its job |
|---|---|---|---|
| Hook | 4.6 s | "A Moon base would face nights about 354 hours long." | A lit habitat, close, through 20 hours of a real dark spell, the stars sliding behind it (time-lapse): how long a night is for anything that must stay on |
| Build | 5.4 s | "Small landers have survived them by mostly shutting down. A base with people cannot." | A person outside the lit habitat in the dark (real time): what cannot be switched off |
| Filler | 3.0 s | "Some ridges at the south pole get sunlight most of the time." | October 2026 at the south pole from above (time-lapse): why the pole is where a base could find power |
| Peak | 6.6 s | "Even the best go dark for days in some seasons. No base with people has yet run through a lunar night." | The same habitat small in the dark landscape through 38 hours of that spell (time-lapse) |
| End | 4.5 s | "NASA has said its astronauts would be there by 2030." | A person on the same ridge in the low Sun of the sunny season, Earth on the horizon (real time) |

- Sources of the lines: bottleneck b3.1 (about 354 hours; landers mostly shutting down; no crewed base has run through one), b3.3 (ridges with sunlight most of the time; dark for days in some seasons), and the pending promise "NASA astronauts would visit the Moon's south pole by 2030" (made 2020).
- What went wrong on the way, and what it taught:
  - The first plan put the two daylight shots in the same April week as the night shots. Test frames came out almost black: that week the Sun stays 1.2–1.7° below level at the ridge, so it lights things that stand up but not the ground. The sunlit shot moved to 6 September 2026 and to the ridge's west slope, the only nearby ground facing that Sun (checked on the terrain before rendering).
  - A "last sunlight leaves a far ridge" shot was tested and dropped: true, but a small white streak that vanishes. A "nightfall on the habitat" shot was tested and dropped: the habitat's spot gets no Sun at all that week.
  - The first cut had six shots and ended on the unsolved line. It broke the structure rules (four main shots, each at least 4.5 s, a forward-looking end), so it was re-cut before rendering.
  - The first hook line did not say the base is hypothetical. It now says "would".
  - "Crewed" was heard as "crude" by the speech recogniser; the script says "with people".
- Checks before rendering: one full-size frame of each surface shot viewed; three consecutive full-size frames of two shots compared (the render changes by about 0.5/255 between frames on still ground, far below the added sensor grain).
  - "Can't" was heard as "can" once the music was under it, which reverses the sentence; it is now "cannot".
  - The first assembly opened on the wide habitat shot. The close one is the stronger first frame, so the two swapped; the wide shot was rendered again at 160 frames to carry the peak.
- Render: 582 frames in 82 chunks on GitHub's free runners took 77 minutes (about 2.3 min per frame per machine, 20 machines at a time); the 160-frame re-render took 25 minutes. Assembly takes about 2 minutes. This is over the draft budget of 1 hour per finished video.
- Version 2 sent to the owner (Nov 22). Measured on the finished file:
  - 24.08 s, 1080×1920, 24 fps, 14.6 Mbit/s (44 MB). Shots 4.58, 5.42, 3.00, 6.58 and 4.50 s. The peak starts at 54% of the running time. The last word ends 1.40 s before the final frame.
  - Sound: −15.0 LUFS, true peak −1.6 dBTP. A speech recogniser given the finished mix returns the script (one plural dropped).
  - Subtitles sit between x 235–753 and y 1454–1497 of 1080×1920, clear of the app's top, bottom and right-hand areas. None is on screen across a cut, on the first frame or on the last.
  - Pixels darker than 8/255: hook 11%, build 10%, filler 39% (shadowed ground), peak 5%, end 23% (sky). The end shot is over the 15% black-sky draft limit; keeping Earth in frame costs that much sky.
- Still wrong, said plainly:
  - It still reads as computer-made on a careful look: the habitat is clean and simple, the suit's backpack looks soft, and the people only turn and lift an arm.
  - At the night exposure Earth is a white disc and can be mistaken for the Moon. That is what a camera would record, but the picture does not say "Earth" by itself.
  - The video opens on a night picture. It is fully exposed from frame 1, but it is a dark picture, against the "first frame at full brightness" rule.
  - The habitat stands where no base exists, on our choice of spot. The first line says "would" and the peak says none has done it; nothing on screen labels it.
  - Earthlight strength, every lamp and all ground detail under about 30 m are modelled, not measured.
  - The voice file is a free open model; pacing is even and a little flat.
- **Owner's verdict on version 2 (Nov 22):** "Your voice is good. The text is good." The visuals fail: "it looks like I did this for a school project"; "the detail is bad and the quality has kind of dropped"; "I want it to look really clear… right now it's low-key pixelated"; "the Earth is really bad in the background"; "it's not even moving. It's just going up or down"; "the visuals are boring me because they're just really repeated, and it would be fun if it was repeated if it was really good quality". A new idea from the owner: "you could mix in some articles in there and some other things to differentiate". Not a rejection of the idea: "I definitely see the idea, but it's low-key boring."
  - Settled by this: the voice (Kokoro `am_michael`, 1.12) and the script method pass. The computer-made scenes as main pictures do not.
  - Causes on our side, named: sensor grain was added on purpose and then squeezed to 14 Mbit/s, which reads as pixelated; Earth at the night exposure is a white disc; the habitat is the subject of three shots out of five; two of those are tripod time-lapses in which only the sky slides.

**After the verdict: the owner's answers, and a hero shot at the new bar (Nov 22)**

- Asked four questions. Answers: 3D stays "the main star", pushed to the standard of film effects ("really push the limits"), and mixed with explainer elements; articles, numbers, maps and charts are all allowed "depending on the situation"; 7 to 9 shots per video. Written into `RULES.md` sections 2 and 3.
- Changed on our side at once: no added grain; frames rendered at 1.5 times delivery size and scaled down; no white-disc Earth; no tripod time-lapses as main shots; no subject twice.
- What limits detail: NASA's free models. Most ship as plain flat-coloured shapes (the habitat, the Apollo lander, the orbiter). The Gateway model is the only one with full surface textures. So the finishes have to be made here.
- Hero shot (`tools/shorts-lab/lro_pass.py`, `lro_model.py`): NASA's Lunar Reconnaissance Orbiter over the south pole, 3.5 s, for the line "Some ridges at the south pole get sunlight most of the time."
  - Why this subject: the app's own source for that fact is "Illumination conditions of the lunar polar regions using LOLA topography" (Mazarico et al., Icarus), and LOLA is the laser altimeter on this spacecraft. It is a real thing that is really there, so nothing in the shot is imagined hardware.
  - Measured or published: terrain on LOLA's 40 m and 80 m grids; Sun and Earth for 16 October 2026 00:00 UTC (01:00 UTC+1) from the JPL ephemeris, chosen so the Sun lights the pole from the side and Earth sits 7° above the Moon's edge as seen from 50 km up; Earth's clouds from NASA GIBS for that day; the spacecraft's shape from NASA's detailed model, put together the way NASA's second, assembled model shows it; 50 km height and 1.66 km/s, its mapping orbit.
  - Modelled: where on its orbit the spacecraft is at that moment; its blanket foil, solar cells and paint; the camera beside it, which no spacecraft carries.
  - Explainer layer (`explain.py`, `lro-explain.json`): place labels that stay on their place as the camera moves, and a card naming the spacecraft and the paper.
  - First render: 84 frames at 1.5 times delivery size in 74 minutes on 17 machines (the close frames took up to 14 minutes each). Not sent: at full size the solar wing showed a lattice of triangles. Cause found by rendering the wing alone: NASA's model draws the cells as about 6,000 small triangles with gaps. Fixed by replacing them with one panel face carrying a rectangular cell pattern, and rendered again.
  - Also fixed before the second render: the crater's name pointed at the spacecraft once the crater's centre went behind it (the marker now sits on the visible part of the floor).
  - Second render: 84 frames in 28 chunks, 60 minutes (the longest chunk 42 minutes). Sent to the owner as a 3.5 s example with its line, subtitle and explainer layer.
  - Measured on the example: 1080×1920, 24 fps, 3.50 s, 9.3 Mbit/s. Sound −14.9 LUFS, true peak −1.9 dBTP. Between consecutive frames the wing changes by 1.7/255 and the foil by 0.8/255 (no shimmer). Earth is 113 px across.
  - Still wrong, said plainly: 38–53% of the frame is darker than 8/255 (black sky plus the pole's real shadows), over the 15% draft limit; nothing on the spacecraft moves; one 3.5 s shot cost an hour of rendering on 20 machines, against a draft budget of 15 minutes per shot; the cell pattern and all finishes are ours, not photographed.
- **Owner's verdict on the hero shot (Nov 22):** rejected. "This 3-second clip took you 4 hours." "You're not really applying the feedback… every single time I say change it, it's actually the same." "Go back to the inspirations… restart from the beginning." Rules in `RULES.md` section 2 ("Restart").

**Restart (Nov 22, evening)**

- Re-read `MASTER_PROMPT.md`, `SUMMARY.md`, the verdicts and the reference pictures. What had been the same in every version: a slow, grey Moon under black sky with one computer-made object. What had been skipped: Phase 3, the north star.
- Asked three questions. Answers: all four faults apply (dull and colourless; nothing happens; looks computer-made; wrong things shown); the look is cinematic; the mix is mostly made 3D with real footage, source cards and fillers allowed.
- First plan after that used NASA's real Artemis II footage (launch, crew, the Moon from Orion). The owner stopped it: the crew "doesn't relate" to the goal, real footage should be little, and there must be no visible break between real and made. All real footage was dropped.
- Tested and dropped two new opening shots that look toward the Sun over the pole: both render almost black, because ground lit by a Sun 1.6° up shows its unlit side to a camera facing the Sun.
- The video now being made (plan: `tools/shorts-lab/moonbase-v3.json`): 8 shots, all made 3D of the goal's own subject, with a graphics layer (`explain.py`, specs in `tools/shorts-lab/specs/`): a counter to 354 hours, the night temperature, named places with the source paper, and a strip of one year of sunlight at the ridge summit.
  - New in the pictures: no grain; Earth readable in night shots (held back, shown as an eye would see it); the Milky Way; a pass over the pole without the orbiter; the habitat in two shots only, at different scales.
  - The sunlight strip is our own calculation from NASA LOLA terrain and the JPL ephemeris (`summit-sunlight-2026.json`): some Sun in 88.5% of the hours of 2026 at the summit, longest spell without any 152 hours. It is shown as a picture with its method named; the figures are not narrated.
- **Restart video sent to the owner (Nov 22, 21:05 UTC+1): 23.4 s, 8 shots, all made 3D, with sound.** Waiting for the verdict.

  | Shot | Seconds | Picture | Graphics |
  |---|---|---|---|
  | 1 | 2.2 | The lit habitat at night, Earth above | Counter running to 354 hours |
  | 2 | 2.4 | A month of sunlight sweeping the south pole | The counter reaches 354 |
  | 3 | 3.5 | A far ridge losing its last sunlight | −173 °C, "about 100 K" |
  | 4 | 2.0 | A person outside the lit habitat | none |
  | 5 | 3.5 | The Lunar Reconnaissance Orbiter over the pole, Earth beyond | Place names, the source paper |
  | 6 | 2.8 | A glide toward Shackleton crater, Earth above | The ridge named, one year of its sunlight as a strip |
  | 7 | 3.3 | The empty ridge under the Milky Way | none |
  | 8 | 3.7 | An astronaut on the ridge in sunlight, Earth beyond | none |

  - Rendering: five new shots in one run of 34 minutes, then the glide again in 8 minutes (84 frames on 17 machines). Three shots are earlier renders used again: the sweep, the orbiter and the astronaut (the astronaut with its grain removed).
  - Fault found before sending: Earth was a plain white disc in the pass over the pole. Cause: in `lro_pass.py` a comment on the same line had swallowed the code that puts the cloud picture on the globe. Fixed and rendered again. The same check showed the camera moved only 5.8 km, which read as a still; it now travels 36 km and drops 8 km.
  - Changed in the edit: the sweep now ends bright (it ended at 9/255 mean brightness); the chart no longer sits on a second copy of the sweep but on the glide, with the ridge it describes marked; the two darkest night shots are lifted in the grade.
  - Measured on the file: 1080×1920, 24 fps, 23.42 s, 12.7 Mbit/s, 37 MB. Sound −15.0 LUFS, true peak −1.7 dBTP. The narration transcribed from the final mix matches the subtitles word for word (100%).
  - Still wrong, said plainly: 40% of the picture over the whole video is darker than 8/255 (limit for a draft is 15%); shot 3's ridge and ground are soft and read as computer-made; the habitat and both astronauts are NASA's plain models and look like models; the pole is seen from above in three shots (2, 5, 6), though each with a different subject in front; nothing was newly designed for colour beyond the orbiter's gold and blue, Earth, the lamp light and the gold chart.
- **Owner's verdict on the restart video (Nov 22):** "Honestly not that bad", but "not visually rich", "the same clip a lot of times", "the same moon, just either zoomed in or zoomed out", "it can still look more realistic", motion "not continuous" where the picture spins. "Make those changes more drastic." Physically correct, "not AI fluff". Text and voice "really good". Rules in `RULES.md` section 2 ("Places and scales").
- **Second restart, sent to the owner (Nov 22, about 23:40 UTC+1): 23.4 s, 8 shots, new places and scales.** Waiting for the verdict. Plan `tools/shorts-lab/moonbase-v4.json`; same script and voice; five of the eight shots are new kinds of picture.

  | Shot | Seconds | Picture | New? | Graphics |
  |---|---|---|---|---|
  | 1 | 2.2 | The Moon's far side from space, night sweeping toward the camera, Earth over the dark edge | new | Counter running to 354 hours |
  | 2 | 2.4 | Earth turning above the Moon's south pole, long lens | new | 354 hours, "about 14 Earth days" |
  | 3 | 3.5 | The Moon's night side lit only by Earth, the thin sunlit edge, stars | new | −173 °C, "about 100 K" |
  | 4 | 2.0 | A person outside the lit habitat | seen once | none |
  | 5 | 3.5 | The Lunar Reconnaissance Orbiter over the pole | seen twice | Place names, the source paper |
  | 6 | 2.8 | The south polar cap from above, sunlight circling it | new | The pole named, one year of a ridge's sunlight as a strip |
  | 7 | 3.3 | The empty ridge under the Milky Way | seen once | none |
  | 8 | 3.7 | A person on the ridge summit with Earth behind them, long lens | new | none |

  - What makes the new shots look real: they are built on photographs. The Moon's surface is NASA's LRO camera mosaic over LOLA relief (the CGI Moon Kit NASA's own studio uses), with LOLA's 80 m polar grid inside 9° of the pole. Earth is the day's satellite picture from both VIIRS satellites, joined so sea glint and gaps drop out (`earth_day.py`). The Moon is shaded the way its dust scatters light, so it does not darken toward the edge like a ball.
  - What is true in each: shot 1 is 14 October 2026 with 40 hours passing; shot 2 is 16 October with 6 hours passing (Earth makes a quarter turn); shot 3 is 12 October, 1.6 days after new Moon, when a nearly full Earth lights the night side; shot 6 is 16 October with 72 hours passing; shot 8 is 7 September 2026, 00:00 UTC (01:00 UTC+1), when Earth stood 3.6° above the horizon at the summit.
  - The finale's place was found by a search of the real terrain: a spot where a camera 100 m down the south slope sees the person's head inside Earth's disc and the local horizon under it. It is the summit of the Connecting Ridge itself.
  - Motion: every time-lapse now moves in small steps (largest mean change between frames: 6.3 of 255 in shot 2, where Earth turns; 1.0 to 2.3 in the other new shots).
  - Tried and dropped: night falling on the summit seen toward the Sun (black frame with a white dot at any exposure; the same failure as the two Sun-facing shots before).
  - Rendering: three space shots in 23 minutes (188 frames, 32 machines), the last two in about 15 minutes (176 frames, 33 machines). Fetching NASA's maps added about 250 MB to the kept data.
  - Measured on the file: 1080×1920, 24 fps, 23.42 s, 11.4 Mbit/s, 33 MB. Sound −15.0 LUFS, true peak −1.7 dBTP. The narration transcribed from the final mix matches the subtitles word for word (100%). Mean brightness of the new shots is 74 to 93 of 255 (shots 1, 2, 6, 8) against 20 to 45 for the night shots of the last version. Subtitle outline raised from 2.8 to 3.6 px so the text holds on sunlit ground.
  - Still wrong, said plainly: 44% of the picture is darker than 8/255, because space is black; the 15% draft limit was written for ground scenes and needs the owner's ruling for space shots. Shot 4's habitat and person are NASA's plain models and read as models. The person in the finale is the same plain suit model. The orbiter clip (shot 5) is used for the third time, kept because it is the only hardware and the only gold and blue in the video. The temperature counter starts at −20 °C, a starting point we chose, not a sourced figure; only the −173 °C it ends on is from the goal's facts. Four of the eight shots are the grey Moon from space or orbit, though at four different scales and lights.
- **Owner's verdict on the second restart video (Nov 22, late):** "slightly better", not a big improvement; the orbiter, the Moon with the counter and the big Earth "need to be changed completely"; not engaging in the first 5 seconds; Earth "spinning too fast… too close to the Moon"; "all day… the same clip, but slightly different". Asked three questions with options. Answers: everything about those shots is wrong (picture, graphics, nothing happens, looks fake); direction **"space film with action"**; opening "a visually rich, full, striking video". Rules in `RULES.md` section 2.
  - What had been missed since Nov 15: the owner had already rejected "repetitive Moon spheres" then (`SUMMARY.md`), and the Reels the owner called "fire" never showed the Moon from space at all.
  - New direction started: action shots in the rover scene (`base_scene.py`, `base_props.py`): a camera that travels with NASA's crew rover at its top speed, a second rover in convoy, dust thrown by twelve wheels, real glass in the windows, a lens with shallow focus. First look (two test frames) sent; the two-shot opening is rendering.
- **New opening sent to the owner (Nov 23, about 00:50 UTC+1): 4.6 s, two action shots, with sound.** Waiting for the verdict before the other six shots are built the same way.
  - Shot 1 (2.2 s): NASA's Space Exploration Vehicle at its published top speed (10 km/h) on the Connecting Ridge, seen from a camera travelling just ahead of it, 0.55 m above the ground, 35 mm lens at f/1.8. Shot 2 (2.4 s): two rovers 13 m apart, seen from 5 m up and ahead. Same script line, voice and score; no counters, labels or cards.
  - Measured or published: the terrain, the Sun and Earth for 6 September 2026 00:00 UTC (01:00 UTC+1), the rover's shape and top speed. Modelled: that two rovers drive there; the road and its ruts; the dust (each grain leaves a wheel at the rim's speed and then flies a parabola under lunar gravity); glass where the model paints its windows black; the camera.
  - Rendering: 116 frames in 26 minutes on 20 machines (the close shot with shallow focus was the slow one, up to 4 minutes a frame).
  - Measured on the file: 1080×1920, 24 fps, 4.58 s. Sound −15.0 LUFS, true peak −1.5 dBTP. Narration heard back word for word. Mean change between frames 11.7 and 8.4 of 255 (the earlier videos: 1 to 6). Darker than 8/255: 19% and 31% of the picture.
  - Also built and shown as one test frame: a tall crew lander descending on engines set high on its body, with the soil its blast drives off (`LANDER=1`). It is modelled from NASA's published pictures of the Artemis lander, not the maker's own model. In the test it stands 330 m from the habitat, which is closer than a real landing zone would be; ground a kilometre off cannot be seen from the base because the ridge falls away.
  - Tried, not good yet: a close shot of the digging robot with its drums turning (`DIG=1`); the frame does not read.
  - Still wrong, said plainly: the rover's hull is clean, even white and reads as a model on a close look; its windows are flat black; the ground is soft where it is not blurred by motion; no people are seen close, because the suit model does not hold up close.

**Blocked: the open AI image model test.** The plan was an Apache-licensed image model run on the CPU through `stable-diffusion.cpp`. This session's safety check refused the build three times; it was not worked around. **Owner's decision (Nov 21): skip the AI image test for now.** Revisit only if the real-data method cannot cover a goal (for example things that do not exist yet, such as a finished Moon base with people).

**Other findings**
- NASA publishes 257 spacecraft and hardware models as `.glb` (github.com/nasa/NASA-3D-Resources). For a Moon base they include the Habitat Demonstration Unit, the Space Exploration Vehicle (crew rover), the RASSOR digging robot, the Mark III and Z2 spacesuits, an astronaut, the Apollo Lunar Module, dishes and the Gateway core. Most are Draco-compressed, which the `bpy` pip package cannot read (only the Gateway and three simple models load as they are); they need decompressing first.
- NASA's Deep Star Maps 2020 at 64k is 0.0055° per pixel, which is 1:1 with a 1920 px frame at a 10.6° field of view. Orientation was verified against Antares (within 2 px).
- NASA GIBS serves daily true-colour imagery as tiles with no key. Single-day mosaics have visible boundaries between satellite passes; shots must be framed inside one pass.
- EOX "Sentinel-2 cloudless 2016" tiles (CC BY 4.0) are sharp on land (about 140 m per pixel at zoom 10 here, finer at higher zooms), but the sea has visible coverage halos and seams around the coast and reefs. Usable for land only, under a land mask; not tried in a render yet.
- `eoimages.gsfc.nasa.gov` (Blue Marble) and `sciencedirect.com` cannot be reached from this environment.
