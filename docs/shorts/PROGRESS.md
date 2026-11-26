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
- **Owner's verdict on the action opening (Nov 23): the method is scrapped.** "There's no way this took 5 hours to render overnight. You need to scrap this method. You need to search up online, find a new method, because this is still not the level of detail that we are aiming for. The physics of this is still wrong. There's literally trail marks before the trail even goes there. It's not even a full reel." "Brainstorm how you're gonna make these videos work, because this is not the method that's working."
  - Faults owned: the road's ruts were drawn along its whole length, ahead of the rover that was supposed to be making them; only 4.6 s was delivered where a full video was asked for; a round took hours of scene-building for minutes of picture.
  - Why the method cannot reach the bar, in numbers: the free machines have 4 processor cores and no graphics card, so one 1080×1920 frame of a detailed scene takes 1.5 to 4 minutes and a 23 s video is 562 frames; every object beyond NASA's plain models has to be built by hand in code; every new shot is a new hand-built scene, so each round of feedback costs hours.
  - Phase 4 of the master prompt (the production method) is reopened. Research started Nov 23 into open video models, hosted generators, free graphics-card time, free assets and real footage; the outcome goes in `docs/shorts/DECISION.md`.
- **New method found and shown (Nov 23, about 15:40 UTC+1).** Record: `docs/shorts/DECISION.md`.
  - Search: four threads (open video models, hosted generators, free graphics-card time, methods and assets), then NASA's own libraries.
  - Finding 1: NASA published a Moon Base set in 2026 (4K concept animation, five 4K renderings, trailer, monthly videos), free to use with credit. This is the detail the owner asked for, on exactly this goal.
  - Finding 2: an open AI video model started from one of those renderings keeps its look and adds natural motion. Test on a free GitHub machine with no account: two 5 s clips in 80 s and 99 s at 480×832, 16 fps. Errors seen: a tool changes shape; wheel marks appear on untouched ground. The workflow still sees no `HF_TOKEN`.
  - Sent to the owner: a full 23.4 s reel cut from NASA's footage and renderings with the same script, voice and score (`tools/shorts-lab/moonbase-v6-nasa.json`; stills move by a slow camera push, `still_move.py`), and one AI-moved sample.
  - Time: about 40 minutes from finding the footage to the finished reel; no rendering.
  - Measured on the reel: 1080×1920, 24 fps, 23.42 s, 10.8 Mbit/s, 32 MB. Sound −15.0 LUFS, true peak −1.7 dBTP. Narration heard back word for word. Darker than 8/255: 18% of the picture (the last video: 44%).
  - Still wrong, said plainly: four of the eight shots are stills with a camera push; shot 5 comes from a 1920×1080 picture and is enlarged 1.8 times, so it is soft; two shots use the same NASA animation; the pictures are NASA's concept of a base, not this site on a real date; NASA's logo is visible on a suit.
  - Waiting for the owner's choice between the four options in `DECISION.md`.
- **Owner chose option B (Nov 23).** Also asked for smoother, more realistic motion, for the method to work for goals outside space, and for a full requirement check. Rules in `RULES.md` section 2 ("Option B chosen").
- **Token:** the workflow still sees no Hugging Face token. Checked Nov 23 under `HF_TOKEN` and six other usual names, and as a repository variable: none present. The AI step ran on the no-account allowance of one GitHub machine: one clip made, the second refused.
- **Moon base reel sent (Nov 23, about 17:35 UTC+1): 23.1 s, 8 shots, every shot moving.** Plan `tools/shorts-lab/moonbase-v7.json`. Waiting for the verdict.

  | Shot | Seconds | Picture | Source |
  |---|---|---|---|
  | 1 | 2.25 | Two astronauts at work at a base, a rover behind, Earth on the horizon | NASA, Landers video |
  | 2 | 2.17 | A glove holding a rock in the dark, helmet lamps behind | NASA, Rovers video |
  | 3 | 3.17 | A small lander sitting dark on the surface | NASA, Landers video |
  | 4 | 2.21 | An astronaut kneeling at work beside a rover | NASA, Rovers video |
  | 5 | 3.25 | An astronaut climbing down a lander's ladder | NASA, Rovers video |
  | 6 | 3.58 | A base on a sunlit plain under a ridge, long shadows | NASA concept animation |
  | 7 | 2.92 | The same kind of ground in darkness, only the base's lamps lit | NASA, Rovers video |
  | 8 | 3.58 | Two astronauts walking to their rover, Earth above the ridge | AI-moved from NASA's "Moon Base Phase 1" rendering |

  - What changed for smoothness: the first AI sample ran at 16 frames a second and 480 px wide. This reel's AI clip was made at 24 frames a second and 1088×1920 by LTX-2.3, in 94 s. NASA's 30-frames-a-second footage is played frame by frame. The lander shot had three repeated frames in NASA's file; they were removed. Measured on the final file: no repeated or stalled frame in 555.
  - What changed for realism: shots 1–7 are NASA's own 4K animation instead of stills pushed by a camera; each is a 9:16 window of the 3840×2160 frame, scaled down or 1:1, never enlarged.
  - Script: same seven sentences and voice. "No base with people has yet run through a lunar night" moved ahead of the two sunlight lines, so the peak line starts at 13.2 s, 57% of the running time (rule: 50–70%; it was 44%).
  - Requirement check, passes: length 23.1 s (20–25); 8 shots (7–9), none under 2.0 s; first frame a full bright picture, speech from 0.04 s; last word ends 0.73 s before the final frame; no end card, no ask, no logo of ours; every shot moves and shows the goal's own subject; four kinds of place or scale, none more than three times, never three in a row; three shots carry strong colour; no counters, labels or cards; subtitles one phrase at a time, each at least 1.2 s on screen; narration heard back word for word; −15.0 LUFS, true peak −1.6 dBTP; 11% of the picture darker than 8/255 (limit 15%); NASA's "Animation" tag and route graphic are outside every window; no whole-Moon or whole-Earth view.
  - Requirement check, misses:
    - The hook sentence ends at 4.2 s; the rule says 4.0 s. Fixing it means speeding up the approved voice.
    - Shots 6, 7 and 8 run 3.6, 2.9 and 3.6 s; the rule says about 2.0–3.5 s.
    - Astronauts appear in five shots and Earth in two (first and last), against "no subject twice".
    - Shot 1 shows stars beside sunlit ground, which one exposure could not record; it is NASA's picture.
    - Shot 3 has no action but the camera; the line is about a lander shut down.
    - Shot 8 looks plainer than the NASA shots (the rendering it starts from is plainer), its walk looks like Earth gravity, and its camera moves in faster than asked.
    - Motion in shots 1–7 runs at 80% of NASA's speed.
    - A US flag patch is visible on a suit in shot 4, and a small mission patch in shot 1. No NASA logo is in frame.
    - Sources are not credited inside the video; the credit ("NASA") has to go in the post's caption.
  - Time: about 100 minutes from the owner's message to the file, most of it finding and checking shots. No rendering. AI: one clip, 94 s, on a free no-account allowance. AI credit spent: $0.
  - Other goals (looked at, not built): NOAA Fisheries publishes coral b-roll packages as public domain with credit, and USGS has public-domain coral video; for malaria the search found public-domain stills (CDC's image library, NIAID) but no free video. Goals like that will lean on AI-moved photographs, which is where the method is weakest. Resolutions and rights per item are not yet checked.
- **Owner's verdict on the option B reel (Nov 23):** "getting better", some 3D "pretty nice", some "way weaker"; "transitions of astronaut, back to back… not entertaining". Asked four questions. Answers: liked shots 2, 4, 6 and 8, "still needs continuity"; format "one night, one place"; a story with a payoff and real sound. Rules in `RULES.md` section 2 ("A story in one place").
- **"One night, one place" reel sent (Nov 23, about 20:05 UTC+1): 23.1 s, 5 shots.** Plan `tools/shorts-lab/moonbase-v8.json`. Waiting for the verdict.

  | Shot | Seconds | Picture | Source |
  |---|---|---|---|
  | 1 | 7.75 | The base in sunlight; a ridge's shadow crosses it; 16 lamps come on one by one; night | NASA concept animation; shadow, night and lamps added by us |
  | 2 | 2.08 | An astronaut kneeling at work in dim light | NASA, Rovers video, untouched |
  | 3 | 3.46 | A glove holding a rock, helmet lamps behind | NASA, Rovers video, untouched |
  | 4 | 6.25 | The same base at night; the sunlight comes back; the shadow starts to return | NASA concept animation, same camera move backwards; shadow, night and lamps added by us |
  | 5 | 3.58 | Two astronauts walking to their rover in sunlight | AI-moved from NASA's rendering (the clip of the last reel) |

  - What changed: one place and one event instead of eight unrelated shots. The wide view of the base carries 14.0 of 23.1 s and comes back; the two close shots sit inside the night. All four shots the owner liked are in; the four not picked are out.
  - How the night is made (`night_fall.py`): on NASA's sunlit moving shot, a shadow edge travels over the ground at a steady 28 degrees a second about its vanishing point, starting from the shadow the shot already has. Shadowed ground takes the colour NASA's own shadows have in that shot. Each lamp sits on a real object, followed through the shot, and comes on 0.16–0.52 s after the shadow reaches it (first at 1.67 s, last at 4.92 s). Old sun shadows fade once the Sun is gone.
  - Sound (`sfx.py`, all synthesised, no recordings, no voices): a relay sound for every lamp, three radio tones in the gaps between sentences (7.56, 12.95, 22.5 s), breathing in the helmet under the close shots and the last shot, a suit hum, a low thump on each cut. The score falls to a tenth between 6.2 and 13.5 s and comes back with the sunlight.
  - Measured on the final file: 555 frames at 24 a second, none repeated; −15.0 LUFS, true peak −1.7 dBTP; narration heard back word for word; every subtitle phrase on screen at least 1.20 s; 8% of the picture darker than 8/255; the wide view is never under brightness 40/255 for more than 3.0 s.
  - Requirement check, passes: length; first frame a full bright picture with the shadow already moving and speech from 0.04 s; peak (the sunlight lines, with the dawn) starts at 13.2 s, 57%; last word ends 0.72 s before the final frame; no end card, ask or logo; every shot moves and shows something happening; nothing enlarged; 24 real frames a second; lamps never come on before the dark reaches them; lamp light, the gold visor and Earth carry colour; no counters or labels; NASA's "Animation" tag outside every window.
  - Requirement check, misses:
    - The night, the moving shadow and the lamps are ours, laid over NASA's shot. That is a third ingredient beside agency footage and AI motion; the owner has not agreed to it yet.
    - The shadow crosses the base in about 6 s. In reality that takes hours, while the rover in the same shot drives at normal speed. Not an honest time-lapse.
    - The shadow's shape and path are modelled, not computed from terrain; the place is NASA's concept, not a surveyed site. The light returns from the side it left.
    - The sound is synthesised, and it was checked by measurement only, not by ear.
    - "Small landers have survived them by mostly shutting down" plays over the base's lamps coming on; no lander is shown.
    - The two close shots come from another NASA sequence; they match the night in light, but nothing proves they are the same base. The last cut goes from the shadow returning to full sunlight.
    - The hook sentence ends at 4.2 s (rule 4.0 s), as before.
    - Earth is a thin crescent cut by the top edge in shots 1 and 4 and a large half-lit disc in shot 5.
    - The last shot is darker and plainer than the base shot (mean brightness 28/255 against 120).
    - Faint streaks in NASA's sky show at night; a faint outline of the old shadows remains.
    - Motion in the NASA shots runs at 80% of NASA's speed. A US flag patch shows on the suit in shot 2. The credit ("NASA") has to go in the post's caption.
    - Older rules this format sets aside: 7 to 9 shots of 2.0–3.5 s; four kinds of place or scale; no subject twice.
  - Time and cost: both takes render in about 4 minutes on this machine; the whole reel assembles in about 2. No new AI clip. AI credit spent: $0.
  - Token: checked again at 19:24 UTC+1. The workflow still sees no `HF_TOKEN`.
- **Owner's verdict on the one-place reel (Nov 23, about 20:15 UTC+1):** "so much better", "you're starting to understand much better". Wants: more dramatic sound, better continuity, more different shots, sentences that are easy to follow and catch attention. Our own night and lamps on NASA's shot are accepted if they belong there and are physically correct. Four questions asked; answers: wording 1 ("On most of the Moon, night lasts about fourteen days…"); film-style sound; the cut from the night base to the kneeling astronaut broke continuity; what repeats is the wide view, shots from the last reel, too few different shots, and astronauts. Rules in `RULES.md` section 2 ("More variety, sharper words, bigger sound").
  - Done since: the new narration is recorded (8 sentences, each read back word for word); `sfx.py` has booms, a riser, a dawn chord and floodlight breakers; `night_fall.py` can bring the light back from the side the dark came from.
- **"Fourteen days of night" reel sent (Nov 23, about 21:10 UTC+1): 24.75 s, 9 shots, 9 different pictures.** Plan `tools/shorts-lab/moonbase-v9.json`. Waiting for the verdict.

  | Shot | Seconds | Picture | Source |
  |---|---|---|---|
  | 1 | 3.2 | The Sun low over a ridge; the ridge's shadow comes down the plain | NASA concept animation, right edge; shadow and lamps added |
  | 2 | 3.6 | The shadow crosses the base; 16 lamps come on; dark | NASA concept animation, centre; shadow, night and lamps added |
  | 3 | 1.5 | Two astronauts at a rover, helmet lamps | NASA, Rovers video, graded |
  | 4 | 1.6 | A power mast over a lit unit, camera sinking | NASA, November update, graded |
  | 5 | 1.8 | A crane lowers cargo onto a rover by lamp light | NASA, Landers video, graded |
  | 6 | 1.75 | Tall solar masts; their panels blaze | NASA, November update |
  | 7 | 3.5 | The dark base under a crescent Earth; light catches the ridge, then crosses the plain | NASA concept animation, left; night, light and lamps added |
  | 8 | 3.0 | The shadow returns over the other side of the base; lamps on again | NASA concept animation, right; shadow and lamps added |
  | 9 | 4.7 | An astronaut close, helmet lamps on, checks a wrist display | NASA, November update, graded |

  - What changed for variety: nine pictures instead of five; no framing twice; only shot 2's framing has been seen before; astronauts in two shots. A second and third search of NASA's library (eight videos in all) found no other camera angle on this base, so three more framings were cut from the same 4K take, and five new NASA night shots were added.
  - What changed for continuity: the four base shots share one shadow model (`specs/base_vp_track.json`), so the dark reaches the Sun-side framing first, then the base, and the light comes back from the side the dark came from, high ground first. NASA's night shots are graded toward our night's colour. Mean brightness across each cut stays within a factor of 2, except crane to masts (2.5, dark to darker).
  - What changed in the words: the owner's chosen wording; 8 sentences, none over 12 words; the hook ends at 2.85 s.
  - What changed in the sound (`sfx.py`): an opening boom and a sinking tone; a swell climbing from 2.9 s that stops dead at 6.1 s; 0.73 s where the whole mix is 20 dB down; a boom on "A base with people cannot."; floodlight breakers as lamps come on; a chord swelling from 13.1 s to its peak at 16.85 s, in the pause before "But even the best go dark"; booms on the main cuts.
  - Measured on the final file: 594 frames at 24 a second, none repeated; −15.0 LUFS, true peak −1.6 dBTP; narration heard back word for word; every subtitle phrase on screen at least 1.20 s; last word ends 0.77 s before the final frame; the peak line starts at 13.4 s (54%).
  - Requirement check, misses:
    - Wide views of the plain carry 13.4 of 24.75 s (54%; the draft rule says a third). They are four different framings of one NASA take; no other angle on this base exists in NASA's library.
    - Shots 3 to 6 run 1.5–1.8 s; the rule says no shot under 2.0 s.
    - Shot 2's framing was in the last two reels.
    - Shots 3 to 6 and 9 come from three other NASA animations. Their ground is grey and tracked, not our bright plain, and nothing proves they are the same base. The masts resemble the base's small panel posts.
    - I read the blaze in shot 6 as panels catching the Sun; NASA's video does not say what it shows.
    - The shadow crosses in seconds what takes hours, beside rovers at normal speed; in shot 2 it moves twice as fast as in the last reel. Its shape and path are modelled, not computed from terrain. In shot 1 the Sun stays high while the plain below goes dark, which holds only because the camera stands above the plain.
    - 18% of the picture is darker than 8/255 (draft limit 15%): black night skies.
    - NASA's footage in shots 3, 4, 5 and 9 is graded darker and bluer by us.
    - Colour fringes from NASA's lens effects show along some edges; a round mission patch is visible on the shoulder in shot 9 (no NASA insignia, no face).
    - The sound is synthesised and was checked by measurement, not by ear.
    - The credit ("NASA") has to go in the post's caption.
  - Time and cost: about 55 minutes from the answers to the file. The four base shots render in about 4 minutes; the reel assembles in about 2. No AI clip. AI credit spent: $0.
- **Owner's verdict on the nine-shot reel (Nov 23, about 21:20 UTC+1):** the opening is "empty" and has to be "the most exciting, most eye-catching thing ever", with "more things in the sky and the space"; the transitions are "literally slide transitions" and should be "like a movie scene"; the shots themselves are fine but need "an extreme amount of detail". Rules in `RULES.md` section 2 ("A fuller opening, joins like a film, far more detail").
- **Reel with continuous takes and hidden joins sent (Nov 23, about 22:15 UTC+1): 24.75 s, 6 shots, no plain cut.** Plan `tools/shorts-lab/moonbase-v10.json`. Waiting for the verdict.

  | Shot | Seconds | Picture | Source |
  |---|---|---|---|
  | 1 | 6.8 | One camera move: from the Sun over the ridge, following a lander's engine light and the shadow front across the masts and the rover to the modules; lamps come on, stars come out around the crescent Earth | NASA concept animation; shadow, night, lamps, beacons, stars and spacecraft lights added |
  | 2 | 1.5 | Two astronauts at a rover, helmet lamps | NASA, Rovers video, graded |
  | 3 | 1.6 | A power mast over a lit unit | NASA, November update, graded |
  | 4 | 3.5 | Tall solar masts in the dark; their panels blaze | NASA, November update, lifted |
  | 5 | 6.5 | One camera move: light catches the ridge under the Earth and crosses the plain; the camera turns across the sunlit base to where the shadow is coming back and the lamps come on again | NASA concept animation; night, light, lamps, beacons and stars added |
  | 6 | 4.7 | An astronaut close, helmet lamps on, checks a wrist display | NASA, November update, graded |

  - Joins: shots 1 and 5 replace three cuts with camera moves across one wide picture of the base (2420 and 2710 px wide, 1:1). 1→2, 2→3, 3→4 and 5→6 are camera whips (4–6 frames each side); 4→5 is the masts' blaze swelling to fill the frame, with the next shot coming out of it.
  - Opening frame: the Sun and its flares, a lander's engine light with its sunlit exhaust, a spacecraft in orbit, the ridge and its lit crest, the shadow front, a boulder, five masts, a rover with its cables and tracks. The lander's path sits below the app's 230 px header.
  - Detail added (all ours, each something that could be there): 1,085 catalogue stars across the wide picture, shown only once the ground is dark and never in the Sun's glare; red beacons blinking on masts and posts; three spacecraft crossing in orbit; the lander's light, exhaust fan and a low glow of dust where it sets down beyond the ridge; lamps that stutter for three frames as they strike.
  - Sky: real stars (HYG catalogue), placed for a view along the ecliptic from the south pole with the Sun at ecliptic longitude 292° (mid-January) and 105 px per degree (from the Earth's size in NASA's frame). NASA's shot gives no date; the date and the pointing are our assumption.
  - Measured on the final file: 594 frames at 24 a second; no repeated frame except two white frames inside the flare; −15.0 LUFS, true peak −1.7 dBTP; narration heard back word for word; every subtitle phrase on screen at least 1.20 s; fastest camera move 15 px a frame in shot 1 and 30 in shot 5, each blurred as a half-open shutter would.
  - Requirement check, misses:
    - The lander is an event we invented. Only its engine light and exhaust are drawn, no body, and it crosses the sky in 5 s. The dust glow, the beacons and the orbiting spacecraft are ours too.
    - Stars come up while the Sun is still above the ridge elsewhere in the scene. That holds for a camera turned away from it and exposed for dark ground; it is our reading.
    - The Sun itself sits in the top 230 px, under the app's header.
    - Between whips, shots 2 and 3 are clear for about 1.2 s each.
    - Shot 4 is dark for its first 2.7 s (mean brightness 19/255) before the panels blaze. 23% of the whole picture is darker than 8/255 (draft limit 15%).
    - Wide views of the plain carry 13.4 of 24.75 s (54%), now as two moving takes.
    - The shadow and the lander move at time-lapse speed beside rovers at normal speed. The shadow's shape and path are modelled.
    - Shots 2, 3, 4 and 6 come from other NASA animations with grey, tracked ground; nothing proves they are the same base.
    - NASA's footage in shots 2, 3, 4 and 6 is graded by us. Colour fringes from NASA's lens effects show along some edges.
    - The sound is synthesised and was checked by measurement, not by ear. One whoosh had to be moved 0.1 s later and softened so that "seasons" is heard.
    - Credits for the caption: NASA; star positions from the HYG database (CC BY-SA 4.0).
  - Time and cost: about an hour from the owner's message to the file. A wide take renders in about 4 minutes as two runs side by side. No AI clip. AI credit spent: $0.
- **Owner's verdict on the reel with whips and a flare (Nov 23, about 22:25 UTC+1):** "exactly what I didn't want… I just want it to be one continuous clip"; no cliché transitions. The lander is acceptable but should be more detailed. "The Earth… be careful of the shadows." Detail "getting much better"; make it look "out of a space movie". Rules in `RULES.md` section 2 ("One continuous clip").
- **Reel as one unbroken take sent (Nov 23, about 22:43 UTC+1): 24.75 s, one shot, no cut, no transition effect.** Plan `tools/shorts-lab/moonbase-v11.json`, spec `tools/shorts-lab/specs/night_v11_one.json`. Waiting for the verdict.
  - The take: the camera starts on the Sun low over the ridge as a lander comes in; it follows the lander and the shadow front left across the masts and the rover to the modules (0–6.6 s), where the lander sets down beyond the ridge and the lamps and stars come on; it drifts on to the far modules under the crescent Earth through the night (6.6–13.6 s); first light catches the high ridge and crosses the plain; the camera travels back right across the sunlit base as the shadow returns (13.6–24.9 s) and ends on the Sun over the dark plain, lamps on, a second lander arriving.
  - How it is one take: NASA's 165 clean frames are run there and back (three and a half passes), on a 3510×1920 strip of the 4K picture; the 1080×1920 frame moves across the strip at 1:1 in three eased moves with shutter blur. Fastest move 12 px a frame.
  - The Earth: stars no longer show through its dark side (its whole disc, 95 px in radius, hides them); the rainbow rim NASA's lens effect gives the crescent is toned down to blue-white.
  - The lander: drawn as a craft 26 px across (cabin, descent stage with a foil band, legs, engine bell, an aerial, lit from the Sun's side, leaning with its thrust), a flashing strobe, a flickering flame with a sunlit exhaust fan, and a pool of light on the ground under it in its last seconds. A second one arrives at the end.
  - More small things: helmet lamps of three people walking near the modules and a rover's light far off on the plain (each tied to a followed point on the ground), cross-shaped streaks on the floodlights, 1,432 catalogue stars on the strip, beacons, five spacecraft crossing in orbit. Blue and red fringes that NASA's lens effect puts on dark posts are removed at night.
  - Sound: no whooshes. Opening boom, sinking tone, the swell that stops dead at 6.1 s, a silent beat (−43 dBFS against −17 for speech), boom on "A base with people cannot.", lamp breakers, the dawn chord peaking at 16.85 s.
  - Measured on the final file: 594 frames at 24 a second; no repeated frame and no sudden jump, including where the three render runs meet and where the source turns back; −15.0 LUFS, true peak −1.6 dBTP; narration heard back word for word; every subtitle phrase on screen at least 1.20 s; 5% of the picture darker than 8/255.
  - Requirement check, misses:
    - It is one place for 24.75 s. The astronauts at the rover, the power masts and the close astronaut are gone, because they could only be joined on by a cut.
    - People appear only as three helmet lamps a few pixels across.
    - The landers, the dust, the walkers, the far rover, the beacons and the orbiting spacecraft are ours; each could be there, none is in NASA's shot.
    - The source runs backwards in two of its passes: NASA's rover reverses, and the camera's slow rise turns into a sink. Neither showed as a jump in the measurements.
    - The night holds a mean brightness under 30/255 for 4.3 s.
    - The Sun sits in the top 230 px, under the app's header, at the start and the end.
    - The shadow and the landers move at time-lapse speed; the shadow's shape and path are modelled; the stars' date is assumed.
    - "Be careful of the shadows" is read as the Earth's dark side; the owner may have meant something else.
    - The sound is synthesised and was checked by measurement, not by ear.
    - Credits for the caption: NASA; star positions from the HYG database (CC BY-SA 4.0).
  - Time and cost: about 75 minutes from the owner's message to the file. The whole take renders in about 6 minutes. No AI clip. AI credit spent: $0.

- **Owner's verdict on the one-take reel (Nov 23, about 23:00 UTC+1):** "The transitions are good now. It's very continuous." But "boring because it's just the same thing… I'm just watching the camera look left and right"; "when the camera looks back, there could be something else there". "Make sure you get the logistics right. Is the Earth's angle right? Is the Moon actually that mountainous?" "Some parts still look very digital, AI made"; wants it polished "like it's out of a sci-fi space movie", with "very fine details, some that a human wouldn't even notice". Rules in `RULES.md` section 2 ("More to see in the one take, the place checked, nothing that reads as digital").
- **One take with the sky and an astronaut sent (Nov 24, about 00:10 UTC+1): 24.75 s, one shot, no cut, no transition effect.** Plan `tools/shorts-lab/moonbase-v12.json`, spec `tools/shorts-lab/specs/night_v12_one.json`. Waiting for the verdict.
  - The take, three kinds of view:
    - 0–8.6 s, the plain: the Sun low over the ridge, a lander coming in; the camera follows the shadow left across the masts and the rover to the modules; the lander sets down beyond the ridge, lamps and status lights come on.
    - 8.6–14.6 s, the sky: the camera tilts up off the base into the Milky Way, with the Earth's dark disc in front of it and a station crossing; it comes back down as first light catches the high ridge.
    - 14.6–24.75 s, a person: the camera travels back right across the sunlit base as the shadow returns; from 18.8 s an astronaut comes into the foreground from the right, helmet lamps on, the Sun behind him; the view behind goes out of focus; a second lander arrives.
  - The place, checked (the owner's "logistics"):
    - Right: the Earth low over the horizon and staying put. NASA: from the pole "the Earth bobs up and down, never veering far from 0° longitude" ([SVS 4944](https://svs.gsfc.nasa.gov/4944/)); the Moon's equator is tilted 6.68° to its orbit ([SVS 5199](https://svs.gsfc.nasa.gov/5199/)), which is the size of that bob. In NASA's frame the Earth's centre is about 4° above eye level (our measurement).
    - Corrected: the Earth's phase. NASA's frame shows a crescent 15.5 px thick on a disc 189 px across (8% lit). The Sun is about 21.5° from the Earth in the same frame (2,190 px), which allows (1 − cos 21.5°) / 2 = 3.5% (6.6 px). The Earth is redrawn with that crescent, lit limb toward the Sun, in NASA's own colours, with a thin line of air at the limb. It is followed frame by frame (measured: it moves up to 25 px differently from the horizon as the camera rises).
    - Right: rough ground with big rounded ridges and long shadows. NASA calls the pole's ground "rugged lunar terrain" where "the perpetually low Sun angle produces extremely long shadows" ([SVS 4944](https://svs.gsfc.nasa.gov/4944/)); its slope map shows "crater walls and mountainsides" ([SVS 4226](https://svs.gsfc.nasa.gov/4226/)). NASA's animation names no site, so the shape of this particular ridge cannot be checked.
    - Right: darkness arriving while the Sun is still in the sky. NASA: "Sometimes, the Sun is directly in front of the viewer, and at those times, we're seeing the shadows cast by distant elevations" ([SVS 5228](https://svs.gsfc.nasa.gov/5228/)).
    - Not right, and not ours to fix: the Sun's height. It is about 4° above eye level in NASA's frame; at the pole itself it is "never more than 1.5 degrees above or below" the horizon ([SVS 4944](https://svs.gsfc.nasa.gov/4944/)). The picture fits a site some degrees from the pole.
    - Assumed: the date of the sky (Sun at ecliptic longitude 292°, mid-January), the picture's scale (105 px per degree; the Earth's size gives 92 to 105 depending on the Moon's distance), the speed of everything we added.
  - What no longer reads as digital:
    - The shadow's edge follows the ground (ground turned to the Sun keeps the light longer) and is drawn out along the Sun's rays into long pointed shadows, as a far skyline casts them. Nothing narrower than the Sun's own half degree is drawn.
    - The sky is NASA's Deep Star Maps 2020 at 32k (91 px per degree against the take's 105), made from 1.7 billion stars of the Hipparcos, Tycho and Gaia catalogues ([SVS 4851](https://svs.gsfc.nasa.gov/4851/)), plus 322 bright stars from the HYG catalogue. Check: 56 of the 57 catalogue stars to magnitude 5 in view fall within 2 px of the same star in NASA's map.
    - One grain, one lens fall-off toward the corners and a trace of softness over everything; 2 px of camera sway; the coloured lens fringes on hard edges toned down.
    - The astronaut is NASA's (November update), slowed to 0.4× by motion interpolation, cut from his own shot (his sky, its glow and his ground removed), darkened and cooled as a figure with the Sun behind him, with a thin rim of sunlight on the edges turned to the Sun. His helmet lamps stay lit.
  - Small things added: 16 status lights on the modules (green, amber, red, blue, 1 px), a station crossing the sky during the tilt, the Earth's colours along its crescent.
  - Sound: as before, plus a quiet high chord under the tilt into the sky (peak 11.7 s) and helmet breathing from 21.3 s.
  - Measured on the final file: 594 frames at 24 a second, 51 MB; no repeated frame and no sudden jump (one frame changes 2.4 times its neighbours' amount: the last subtitle leaving at 24.3 s); −15.0 LUFS, true peak −1.6 dBTP; narration heard back word for word; every subtitle phrase on screen at least 1.20 s; 4.1% of the picture darker than 8/255.
  - Requirement check, misses:
    - The sky section has a mean brightness under 30/255 for 5.2 s (8.75–14.0 s). It is full of stars, but it is dark.
    - A camera exposed for the base's lamps would not record the Milky Way this clearly. The stars are in the right places; their brightness is a film's choice.
    - The astronaut comes from a different NASA animation. His suit's folds still carry that shot's light from the front left under our darkening, and his visor reflects that shot's base, not this one. He covers the right half of the frame for the last 4 s, and the last subtitle crosses his chest.
    - Astronauts were named as a repeat in an earlier verdict; this is the only one in the reel.
    - The landers, the dust, the station, the walkers, the far rover, the beacons, the status lights and the orbiting spacecraft are ours. The landers' exhaust fans are drawn bright enough to see; no source says how visible they would be.
    - The shadow and the landers move at time-lapse speed while the Sun does not drift and the rover drives at normal speed.
    - The Sun sits in the top 230 px, under the app's header, at the start and the end.
    - The source still runs backwards in two of its passes.
    - The sound is synthesised and was checked by measurement, not by ear.
    - Credits for the caption: NASA; NASA's Scientific Visualization Studio (Deep Star Maps 2020; Gaia DR2: ESA/Gaia/DPAC); star positions from the HYG database (CC BY-SA 4.0).
  - Time and cost: about 70 minutes from the owner's message to the file. The take renders in about 10 minutes as three runs side by side (the last third, with the astronaut, takes 7 minutes alone). NASA's 1.5 GB star map downloaded, not kept in the repository. No AI clip. AI credit spent: $0.

- **Owner's verdict on the take with the sky and the astronaut (Nov 24, about 00:10 UTC+1):** "This is honestly really nice. I'm really happy with it." The script is "not really fluent": tweak it. The graphics "surprised me… so much better than I expected", and "we can still push for more: more details, more accuracy". Rules in `RULES.md` section 2 ("A script that flows; keep pushing detail and accuracy").
- **Second version sent (Nov 24, about 00:55 UTC+1): 25.0 s, one shot, no cut.** Plan `tools/shorts-lab/moonbase-v13.json`, spec `tools/shorts-lab/specs/night_v13_one.json`. Waiting for the verdict.
  - Script, rewritten to flow. Same facts; the sentences are linked, nothing is said twice in a row, and the voice is made in four passages so it carries from one sentence into the next:
    - "On most of the Moon, night lasts about fourteen days. Small landers have survived it by mostly shutting down."
    - "A crew can't do that. Life support has to keep running, and no base has yet run through a lunar night."
    - "Some ridges at the south pole get sunlight most of the time, but even the best go dark for days in some seasons."
    - "And NASA has said its astronauts would visit the south pole by 2030."
    - Changed wording to note: "A base with people cannot. Life support cannot pause." became "A crew can't do that. Life support has to keep running"; "No base with people has yet" became "no base has yet" (the goal's fact says no crewed base; no base of any kind has, so the shorter line is still true).
    - The hook ends at 2.9 s. The beat of near silence is now 6.55–7.2 s (−51 dBFS against −17.5 for the sentence before it); the boom lands on "A crew can't do that."
  - More accurate than the last version:
    - The faint sky follows the camera's exposure: the star map shows at 35% while lamps are in frame and comes up fully only as the camera tilts off them.
    - Zodiacal light added: the glow of sunlit dust along the ecliptic, brightening toward the Sun. It was photographed from lunar orbit by Clementine's star trackers ([arXiv astro-ph/0204111](https://arxiv.org/abs/astro-ph/0204111)). Its shape here is a simple model and its strength is our choice; how bright it should be beside the Milky Way was not confirmed from a source.
    - Shadows of everything we add now come from the Sun's place in NASA's frame. Direction: away from the point the ground's shadows converge on under the Sun (checked against the shadows of NASA's rover and light posts). Length: height / tan(Sun's height), foreshortened as the ground is at that spot. The Sun's height is read as about 4.5° (3.5–5.5°) from the length of a rover's shadow in NASA's frame.
    - Spacecraft in low orbit were crossing at about 0.8° a second. At 100 km up the speed is 1.63 km/s; seen low over the horizon from about 470 km that is 0.2° a second (our arithmetic). They now move at that rate. The "station" of the last version is one of these: a station on the orbit NASA planned for Gateway would hang almost still, about 70,000 km over the pole ([NASA](https://www.nasa.gov/missions/artemis/lunar-near-rectilinear-halo-orbit-gateway/), pre-2026 planning).
    - A little of the view's glare now lies over the astronaut, as it would in one lens.
  - More detail:
    - Four people on foot, 17–19 px tall. Two stand at the rover in the opening frame with their shadows, and switch on helmet lamps when the dark reaches them. Two walk out from the modules as night falls (1.6 m/s), work through the night by lamp, and walk back in sunlight at dawn (0.9 m/s) with long shadows. A person who steps into a shadow NASA's shot already has goes dark.
    - 16 points on foil and glass that flash as the edge of the sunlight crosses them. Checked in the render: they do not stand out against sunlit ground, so they do not count as a visible detail.
  - Sound: same design, retimed to the new sentences; the end beep is gone (the narration now runs to 24.5 s).
  - Measured on the final file: 600 frames at 24 a second, 52 MB; no repeated frame and no sudden jump (one frame changes 2.3 times its neighbours' amount: the last subtitle leaving at 24.8 s); −15.0 LUFS, true peak −1.7 dBTP; narration heard back word for word; every subtitle phrase on screen at least 1.20 s; 2.8% of the picture darker than 8/255; mean brightness under 30/255 for 1.7 s (was 5.2 s).
  - Requirement check, misses:
    - Speech fills 23.1 of 25.0 s. The script flows better but is not shorter.
    - The Sun's height has now been read three ways from NASA's frame: about 4° above the level the shadow edge turns about, 4.5° from a shadow's length, 6.6° above the far edge of the plain if the plain is level. All are above the 1.5° the pole itself allows.
    - Close to the Sun the real zodiacal light may outshine the Milky Way; here the Milky Way stays the brighter of the two. Unconfirmed either way.
    - The people are drawn by us (a helmet, visor, pack, arms, legs in step). They are small and pass a look at full size; they have not been compared with footage of real astronauts at that distance.
    - Still as before: the astronaut is from another NASA animation and keeps that shot's light in his suit's folds and that shot's base in his visor; the landers' exhaust is drawn visible without a source; the shadow and landers move at time-lapse speed beside a rover at normal speed; the Sun sits under the app's header; the source runs backwards in two passes; the sound was checked by measurement, not by ear.
    - Credits for the caption: NASA; NASA's Scientific Visualization Studio (Deep Star Maps 2020; Gaia DR2: ESA/Gaia/DPAC); star positions from the HYG database (CC BY-SA 4.0).
  - Time and cost: about 45 minutes from the owner's message to the file, two full renders of about 13 minutes each. No AI clip. AI credit spent: $0.

- **Owner's verdict on the second version (Nov 24, about 09:40 UTC+1):** "Some things are glitching and it doesn't look as smooth and clear. Also the astronaut is awkward and looks floaty, which doesn't make sense. Also go another round increasing the detail." Rules in `RULES.md` section 2 ("No flicker, a clear picture, a person who stands in the scene").
- **Third version sent (Nov 24, about 11:35 UTC+1): 25.0 s, one shot, no cut.** Plan `tools/shorts-lab/moonbase-v14.json`, spec `tools/shorts-lab/specs/night_v14_one.json`. Same script, voice and sound. Waiting for the verdict.
  - What was glitching, found by measurement (`tools/shorts-lab/flash_scan.py` and a look at NASA's file), and what was done:

    | Cause | Before | Now |
    |---|---|---|
    | NASA's own file breaks the thin lit ridge lines for single frames (strongly every 32nd frame, less at two more) | broken line for one frame about every 1.3 s | the far ground of those 7 frames is taken from the frame before, moved onto its place |
    | The sky was placed to whole pixels while the ground moved by fractions | whole sky stepped up to 1.21 px in one frame during the hold on the stars | placed to a fraction of a pixel: largest step 0.29 px |
    | Lamps stuttered for three frames as they struck, then shimmered up to 39 times a second | flicker | come up once, drift slowly |
    | The lander's flame varied up to 23 times a second; its speed jumped at each point of its path (3.9 px a frame in one frame) | flicker, jerks | slow breathing; path rounded (0.8) |
    | The source reversed in one frame where it turns back | a bounce | slows, stops and starts back over 20 frames |
    | The astronaut was slowed with made-up in-between frames, and his outline changed from frame to frame | smeared edges, twitching outline | real frames only at 80% speed; outline steadied over five frames |
    | The flashes on foil added last time | did not read as anything | removed |
    | Final file at 16.5 Mbps, heavy grain (1.9), softening 0.5 px | may stall on a phone; soft | 9.9 Mbps, grain 1.1, softening 0.25 px; closer to its picture (SSIM 0.978, was 0.963) |

  - Measured, same test on both versions (far ground and sky, camera's move taken out): pixels that are off for exactly one frame fell from 380 to 67 a frame on average; the worst frame from 40,768 to 794. No frame changes unevenly against its neighbours (there was one).
  - The astronaut, rebuilt:
    - Re-cut from NASA's 4K original, wider, so his whole upper body is in the cut (before: half of him, cut off by the frame's right edge with ground beside him, which is what read as floating).
    - Held still: NASA's camera pulls back and drifts through his shot (he shrank to 90% and slid 98 px). That move is taken out, so he now moves only as he himself moves (`astro_stab.py`).
    - Cut out of his sky and his ground (`astro_cut.py`), and stood at one place in the wide picture behind the foreground rock, which hides him from the chest down. The rock is followed through NASA's take (`rock_track.py`); he shifts with it as NASA's camera rises.
    - His light: NASA's own, brought down to 66–76% and cooled to the night's colour; his helmet lamps kept. A little of it falls on the top of the rock in front of him.
  - Detail added in this round:
    - Stars from NASA's 64k map (twice as fine as the map used before), brought down to the take's scale by area.
    - The astronaut's own detail, now at 80% of 4K instead of 62% of a half-size cut: suit fabric, arm patches, the wrist display, the visor's reflection.
    - The landers: a docking port, a dish on a boom, thruster clusters, second leg struts, panel seams, a ladder, two landing lights; drawn 10–25% larger.
  - Unchanged checks on the final file: 600 frames at 24 a second, 31 MB; −15.0 LUFS, true peak −1.5 dBTP; narration heard back word for word; every subtitle phrase on screen at least 1.20 s; 2.7% of the picture darker than 8/255.
  - Requirement check, misses:
    - The detail round is small next to the fixes. Most of this round went into finding the glitches.
    - It took about 1 h 55 min, against the one-hour budget: four full renders of about 13 minutes, because three of the causes were found one after another, each after a render.
    - The astronaut is lit from the front while the Sun is behind him. A work lamp near the camera would explain it; none is shown. The light on the rock's top is ours.
    - He is not there in the opening frame, where the same rock is in view. He would have walked up in between; that is not shown.
    - His visor still reflects the other shot's base. His shaded-side edge was set by hand a few pixels inside his arm.
    - The hold on the sky is dark again: mean brightness under 30/255 for 5.3 s (1.7 s in the version before). The zodiacal light was halved because its strength has no source.
    - Around each turn-back one source frame serves up to about six output frames, each moved by a fraction of a pixel. The output frames differ, but this bends "no frame shown twice".
    - NASA's near ground moves up to 2.3 px a frame against the far ground (real depth). The flicker scan counts that as flicker; it was checked on its own (6,908 pixels fall to 1 when the near ground is lined up by itself) and left.
    - The scan's lists were looked at for the stretches where the camera is nearly still, not for all 600 frames. The sound was not touched and was checked by measurement, not by ear.
    - Still as before: the landers' exhaust is drawn visible without a source; the shadow and landers move at time-lapse speed beside a rover at normal speed; the Sun sits under the app's header and is higher than the pole itself allows; the date of the sky is assumed.
    - Credits for the caption: NASA; NASA's Scientific Visualization Studio (Deep Star Maps 2020; Gaia DR2: ESA/Gaia/DPAC); star positions from the HYG database (CC BY-SA 4.0).
  - Cost: NASA's 4 GB star map downloaded, not kept in the repository. No AI clip. AI credit spent: $0.

- **Owner's verdict on the third version (Nov 24, about 14:10 UTC+1):** "Fix what's wrong and run another round of adding detail, looking good though." Rules in `RULES.md` section 2 ("Fix what was listed, then add").
- **Fourth version sent (Nov 24, about 14:55 UTC+1): 25.0 s, one shot, no cut.** Plan `tools/shorts-lab/moonbase-v15.json`, spec `tools/shorts-lab/specs/night_v15_one.json`. Same script, voice and sound. Waiting for the verdict.
  - Every line of the last "still wrong" list, and what happened to it:

    | Listed as wrong | Now |
    |---|---|
    | The astronaut was lit from the front with the Sun behind him | Fixed. He is in the mountain's shadow like the ground behind him (30–38% of his lit look) and lit only where his own helmet lamps fall: hands, chest, wrist display. The unexplained fill light is gone |
    | He was not in the opening frame, where the same rock is in view | A cue added: one of the two people at the rover walks off toward the rock in the opening (1.3 m/s, until the camera leaves); at the end one person is left at the rover. The walk itself is not shown |
    | The hold on the sky was dark (mean under 30/255 for 5.3 s) | Fixed: 0.1 s. The zodiacal light is now at its measured strength |
    | The zodiacal light's strength had no source | Fixed. Clementine's star trackers measured it from lunar orbit: on the ecliptic 1.7×10⁻¹³ / sin^2.45(angle from the Sun) of the Sun's brightness, 3–30° ([arXiv astro-ph/0204111](https://arxiv.org/abs/astro-ph/0204111), eq. 5). That is 5,400 S10 units at 20° and 2,100 at 30° |
    | The date of the sky was assumed | Fixed. The sky is that of 8 January 2039, 14:00 UTC, the real moment closest to NASA's frame (see below) |
    | The flicker scan could not tell depth motion from flicker; its lists were read only where the camera is still | Fixed. It now moves each frame's neighbours onto it place by place; all 600 frames were scanned and the twelve strongest finds looked at: the edge of the returning sunlight, and stars streaking while the camera tilts. No flicker found |
    | The landers' exhaust was drawn visible without a source | Partly. Exhaust that freezes and spreads in near-vacuum is seen from the ground when the Sun lights it ([twilight phenomenon](https://en.wikipedia.org/wiki/Twilight_phenomenon)); NASA describes such a plume as mostly water vapour and carbon dioxide ([APOD](https://apod.nasa.gov/apod/ap240312.html)). How bright ours should be is still our drawing |
    | It took 1 h 55 min and four renders | About 45 minutes, one render. Faults were looked for on stills and with the scan first |
    | The sound was checked by measurement, not by ear | Not fixable here: nothing in this environment can listen. More measured: no clicks, no clipping, no dropout except the intended beat (60 ms of dead silence at 7.12 s); speech stands 5.8 to 13.2 dB above music and effects in each passage |
    | His visor reflects the other shot's base | Left. With his new light the reflection (ground lit by his lamps under a black sky) fits; the row of lamps on its horizon is behind our camera and never shown |
    | The shadow and landers move at time-lapse speed beside a rover at normal speed | Cannot be fixed in one take. The Sun moves about 0.5° an hour along the horizon, so a mountain's shadow needs hours to cross the plain (our arithmetic); either it or the rover has to be at the wrong speed |
    | The Sun is under the app's header and higher than the pole allows | NASA's footage; stays |
    | One source frame serves several output frames at each turn-back | Stays; the rule is now written as we read it (draft, to confirm) |
    | His shaded-side edge was set by hand | Stays |

  - The real moment: for every January from 2026 to 2040 the instant was found when the Earth stands 21.5° from the Sun, seen from the Moon, on the side NASA's frame shows (JPL's DE440 ephemeris through skyfield). 8 January 2039, 14:00 UTC fits best: the Sun at ecliptic longitude 288.1° (the take assumed 292°) and the Earth 0.44° off the ecliptic (NASA drew it level with the Sun). For that moment:
    - the Earth is drawn 0.8° from where NASA put it (NASA's is erased), 21.57° from the Sun; its radius in the sky comes out at 0.913° = 95.9 px, NASA's is 94.3 px;
    - Mars stands 1.3° from the Earth's centre (magnitude about +1.5) and Mercury 9.8° from the Sun (about −0.7); both are drawn. Venus is 20° on the other side of the Sun, outside the picture;
    - the face of the Earth turned to the Moon is centred on 23°N 128°E: east Asia and Australia, upside down as NASA says it looks from the south pole.
  - Detail added:
    - The Earth's night side is no longer black once the exposure opens for the stars. It is lit by the Moon the camera stands on, which is 97% full from there. Our arithmetic: a white surface facing the Moon sends back about 70,000 S10, fifteen times the zodiacal light beside it (4,600 S10). It is shown with one day of NASA GIBS satellite imagery (VIIRS, 8 January 2024). In daylight exposure it is the black disc with the thin crescent, as before.
    - Mars beside the Earth, Mercury near the Sun.
    - The zodiacal light: a glow along the horizon (the ecliptic lies along it at the pole), brightening toward the Sun.
    - Stars, Milky Way, zodiacal light and the Earth's night side are on one brightness scale and go through one exposure curve. NASA's star map was calibrated on 2,070 catalogue stars (it is a true flux scale: slope −0.388 against −0.400); the Milky Way's bulge in view comes out at 760 S10 (median) to 2,300.
    - The sky now moves with the Earth, not with the far ridge: both are infinitely far. It used to slide up to 25 px against the Earth over the take.
    - The landers fire short attitude jets.
  - Measured on the final file: 600 frames at 24 a second, 31 MB, 9.9 Mbps; no frame changes unevenly against its neighbours; the sky's largest step during the hold 0.34 px; −15.0 LUFS, true peak −1.5 dBTP; narration heard back word for word; 2.1% of the picture darker than 8/255.
  - Requirement check, misses:
    - The astronaut is clearly darker than in the version the owner called "looking good". His hands and chest are lit; his helmet and backpack are dim.
    - The Milky Way is fainter than before, because the glow in front of it is now at its measured strength. Away from the ecliptic the glow's fall-off is our assumption (flattened to 0.45), and the formula is used out to about 35° where it was measured to 30°.
    - The Earth's night-side brightness is our arithmetic (full Moon taken as magnitude −12.7, 0.6 fainter at this phase; our reading of reflectance from the satellite picture). It could be off by a factor of two. Its clouds are those of 8 January 2024, not 2039; the Arctic polar night, which the satellite does not see, is filled with the land just south of it, mirrored.
    - The sunlit crescent still carries NASA's colours, not that day's geography. Mars saturates to white at its centre. Mercury sits in the Sun's glare, mostly under the app's header.
    - How high the Sun and the Earth stood above the horizon at a named site on that date was not computed.
    - The small people are still our drawing and were not compared with real footage.
    - Credits for the caption: NASA; NASA's Scientific Visualization Studio (Deep Star Maps 2020; Gaia DR2: ESA/Gaia/DPAC); NASA GIBS (VIIRS, Suomi NPP); star positions from the HYG database (CC BY-SA 4.0).
  - Cost: JPL's ephemeris (32 MB) and one GIBS picture downloaded, not kept in the repository. No AI clip. AI credit spent: $0.

- **Owner's verdict on the fourth version (Nov 24, about 15:20 UTC+1):** "Fix what's wrong and give immense detail increase." Rules in `RULES.md` section 2 ("Fix what is wrong, and far more detail").
- **Fifth version sent (Nov 24, about 15:55 UTC+1): 25.0 s, one shot, no cut.** Plan `tools/shorts-lab/moonbase-v16.json`, spec `tools/shorts-lab/specs/night_v16_one.json`. Same script, voice and sound. Waiting for the verdict.
  - Every line of the last "still wrong" list, and what happened to it:

    | Listed as wrong | Now |
    |---|---|
    | The Sun is higher than the pole itself allows; how high Sun and Earth stood at a named place was not computed | Resolved. With JPL's lunar orientation (`moon_site.py`): at the pole itself at that moment the Sun is 0.46° up and the Earth 0.81° below the horizon, so NASA's frame is not the pole. It fits ground near 85°S, 17–21°W: Sun 4.5° up, Earth 4.2° up, 21.6° apart (NASA's frame: about 4.5°, about 4.1°, 21.5°). At the Malapert massif (86.0°S, 2.9°E) it would be Sun 4.3°, Earth 3.2° |
    | The Earth's night-side brightness was our arithmetic | Better founded. NASA's fact sheets give the full Moon magnitude −12.74 and the Sun −26.74 ([Moon](https://nssdc.gsfc.nasa.gov/planetary/factsheet/moonfact.html), [Sun](https://nssdc.gsfc.nasa.gov/planetary/factsheet/sunfact.html)): moonlight is 2.5 millionths of sunlight at full Moon. At this phase we take it 0.56 magnitude fainter (0.026 a degree, our figure). A white surface facing the Moon then sends back 75,000 S10 (was 70,000). Still ours: reading how much each place reflects from the satellite picture |
    | The crescent carried NASA's colours, not that day's | Fixed. It carries the face turned to the Moon at that moment, reddened along the day-night line, where the Sun is setting |
    | Mars burned out to white | Fixed: held just under white, orange |
    | Mercury sits in the Sun's glare under the app's header | Stays: that is where it was |
    | The sound was not checked by ear | Stays. Nothing here can listen. Measures unchanged: no clicks, no clipping, speech heard back word for word |
    | The shadow moves at time-lapse speed beside a rover at normal speed | Stays: one take cannot show hours and seconds at once |
    | The landers' exhaust brightness is our drawing | Stays |
    | His visor shows lamps that are behind our camera | Stays |
    | The Milky Way is fainter under the measured glow; the glow's fall-off away from the ecliptic is assumed | Stays |
    | The small people were not compared with real footage | Stays |
    | Clouds on the Earth are those of 8 January 2024 | Stays: 2039's cannot be known |

  - Detail, counted (before → now):

    | | Before | Now |
    |---|---|---|
    | Catalogue stars drawn as points (on top of NASA's star map) | 333, to magnitude 6.8 | 1,495, to magnitude 8.6 |
    | The star map's own colour | 80% | full |
    | Steady lamps on the base | 62 | 71 (9 more work lights: under module legs, at joints and module ends, each on a part NASA's daylight frames show) |
    | Blinking beacons | 7 | 8 (an amber one on the parked rover) |
    | People on foot | 4 | 12 (two at the solar masts in the opening, the rest around the modules; each with a shadow in sunlight and a helmet lamp in the dark) |
    | Rover lights travelling at night | 1 | 2 |
    | Spacecraft crossing in orbit | 6 | 8 |
    | The Earth's night side | moonlit clouds, land and sea | plus the lights of its cities where it is night there (NASA's Black Marble map); at this size a few warm specks |
    | The Earth's crescent | one colour ramp | that moment's clouds and coasts, red toward the day-night line |
    | The ground in the dark | dimmed | dimmed, with the source's own fine relief (tracks, small craters, stones) shown 50% more strongly |
    | The finish | grain, lens fall-off | plus a faint red glow round strong lights, as film gives, and a light sharpening (0.25); no softening |

  - Not done, on purpose: no windows or fittings were added to NASA's modules. Their daylight frames show none, and a window that appears only at night would be an invention.
  - The limit, stated plainly: every pixel of ground and hardware is NASA's animation shown 1:1. This round adds what can be added truthfully around it and keeps more of what it already holds. More detail in the ground and the modules themselves needs sharper footage or an AI step, and the token for that is still not visible to the workflow.
  - Measured on the final file: 600 frames at 24 a second, 31 MB, 10.0 Mbps (SSIM against its picture 0.977); no frame changes unevenly against its neighbours; the flicker scan over all frames finds the same real motion as before (the dawn light's edge, stars streaking in the tilt) and nothing new; −15.0 LUFS, true peak −1.5 dBTP; narration heard back word for word; 2.2% of the picture darker than 8/255; mean brightness under 30/255 for 0.1 s.
  - Requirement check, misses:
    - "Immense" is not met for the ground and the modules, for the reason above. The gain is in the sky, the Earth, the number of lights and people, and how much of NASA's own detail survives the dark and the encode.
    - The city lights' strength against the moonlit clouds is our choice, and they are barely visible.
    - The eight new people stand or shift a few steps; they do not do recognisable work.
    - The first encode of this version ran at 12 Mbps, over the 10 Mbps limit set last round; the file sent is the 10 Mbps one.
    - Credits for the caption: NASA; NASA's Scientific Visualization Studio (Deep Star Maps 2020; Gaia DR2: ESA/Gaia/DPAC); NASA GIBS (VIIRS, Suomi NPP; Black Marble); star positions from the HYG database (CC BY-SA 4.0).
  - Time and cost: about 35 minutes, one render. JPL's lunar frame files and one GIBS map downloaded, not kept in the repository. No AI clip. AI credit spent: $0.

- **Owner's verdict on the fifth version (Nov 24, about 15:50 UTC+1):** "Take your time for this one." Rules in `RULES.md` section 2 ("Time for depth").
- **Sixth version sent (Nov 24, about 17:30 UTC+1): 25.0 s, one shot, no cut.** Plan `tools/shorts-lab/moonbase-v17.json`, spec `tools/shorts-lab/specs/night_v17_one.json`. Same script, voice and sound. Waiting for the verdict.
  - Looked for first: a better original. NASA's image library has no higher-quality copy of this animation; the file in use is already 4K at 80 Mbps. So the detail had to come out of the frames we have.
  - What was done to the source:
    - Each of the 165 source frames is rebuilt from itself and its three neighbours on each side, wherever they agree (`fuse_frames.py`). 89–97% of each frame agreed. Noise on the ground fell from 1.43 to 0.92 levels (36% less). Nothing is invented: every value is an average of NASA's own values for that place.
    - On those cleaner frames the ground's and the modules' fine detail is drawn more firmly at three sizes, on brightness only ("clarity"). On single frames this would have sharpened the noise.
    - The astronaut is cut straight from NASA's 4K frames at the size shown (`astro_4k.py`): one resampling instead of four.
  - Every line of the last "still wrong" list, and what happened to it:

    | Listed as wrong | Now |
    |---|---|
    | "Immense" not met for the ground and the modules | Better, measured below. Still NASA's animation at 1:1: this brings out what its frames hold together, and adds no new information |
    | The glow's fall-off away from the ecliptic was our assumption | Replaced by the dust model in the Clementine paper ([arXiv astro-ph/0204111](https://arxiv.org/abs/astro-ph/0204111), eqs. 6–8, Table II; `zodi_shape.py`). Straight above the Sun the glow is 0.37–0.49 of the ecliptic's brightness at the same angle; we had 0.14. In the part of the sky this take looks at, old and new differ by a few percent, so the picture hardly changes. Uncertainty from the choice of scattering law: at most 30%, 15% on average. The formula is still used out to about 35° where it was measured to 30° |
    | The Moon's dimming with phase (0.026 magnitude a degree) was our figure | It is the figure of Krisciunas and Schaefer's moonlight model (1991), as quoted in [arXiv 1301.0326](https://arxiv.org/pdf/1301.0326): 0.026 a degree plus a term that adds 0.001 here. The number does not change. We read it in a later paper's quotation, not in the 1991 paper itself |
    | The landers' exhaust brightness is our drawing | Stays. The craft itself is now lit as the Sun's place says: seen 5–11° from the Sun, a thin lit edge, the rest in its own shadow, the engine's light on its underside |
    | The new people only stand or shift | Nine of the sixteen now bend to something on the ground, stay down and straighten, each on a round of 5.6 to 9.4 s. In daylight a white suit on bright ground is hard to see at this size; at night the helmet lamp's pool shows it |
    | The small people were not compared with real footage | Stays |
    | The city lights are barely visible; their strength is our choice | Stays |
    | His visor shows lamps that are behind our camera | Stays |
    | The shadow moves at time-lapse speed beside a rover at normal speed | Stays: one take cannot show hours and seconds at once |
    | The sound was not checked by ear | Stays. Nothing here can listen |
    | Clouds on the Earth are those of 8 January 2024 | Stays: 2039's cannot be known |
    | Mercury sits under the app's header | Stays: that is where it was |

  - Faults found by looking closer, which the owner had not named:

    | Found | Now |
    |---|---|
    | In the dark the far hill went blotchy: olive patches with black cores | Fixed. The ground's small hollows are raised to the ground round them and take its colour |
    | At night the modules' old shadows showed as grey patches on blue ground | Fixed. They take the night ground's colour and stay as shadows; the new yard lights hang on the Sun's side, so the shadows point away from them too |
    | Thin yellow and purple rims on every small ridge (NASA's lens effect), strongest toward the corners | Removed on the ground: colour there is kept only as it varies over 2.5 px and more. Strongly blue dark pixels in one test crop: 636 before, 194 now |
    | At first light the lit hilltop ended in a ruler-straight line | Fixed. The edge follows the ground and is about 10 px soft |
    | Faint coloured streaks across the dark mountain (NASA's lens flare) | Stays |
    | The far hill is drawn with long level streaks in the source | Stays. It gets a third of the clarity, so the streaks are not what is drawn out |
    | One 0.06 s stretch of full silence at 7.12 s | It is the pause set before the hit (the music is at zero from 6.55 to 7.18 s). It was in the fifth version too and was not reported there |

  - Fine detail, measured on the two files as sent (`detail_meter.py`, rows 700–1900, fifth version → this one):

    | | under 1 px | 1–3 px | 3–9 px |
    |---|---|---|---|
    | Daylight, four moments | +25% to +36% (mean +29%) | +16% | +8% |
    | Night, seven moments, whole frame | +4% to +18% (mean +10%) | +5% | +5% |
    | The modules at night (6.5 s) | +58% | +38% | |
    | The astronaut (23.5 s) | +35% | +18% | |
    | The sky hold (12.0 s) | +3% | +2% | +3% |

  - Counted (before → now):

    | | Before | Now |
    |---|---|---|
    | Source frames behind each picture | 1 | 7 where they agree |
    | Steady lamps on the base | 71 | 76: five yard lights on NASA's masts and module ends, each throwing a wide, dim light over the modules beside it |
    | People on foot | 12 | 16 |
    | People doing recognisable work | 0 | 9 |
    | Catalogue stars, beacons, rover lights, spacecraft | 1,495 / 8 / 2 / 8 | the same |

  - Measured on the final file: 600 frames at 24 a second, 31 MB, 9.9 Mbps (SSIM against its picture 0.979); no frame changes unevenly against its neighbours; the flicker scan finds the same real motion as in the fifth version (the dawn light's edge, lamps passing the frame's edge, the Earth during the tilt) and nothing new; pixels that jump for one frame by more than 6 levels are 3% fewer than in the fifth version, and those that jump by more than 12 levels are 18% more, in the seconds where the camera tilts past the Earth and where the last sunlit patch leaves the frame (the same motion, with more contrast in it); −15.0 LUFS, true peak −1.7 dBTP; no clicks, no clipping; narration heard back word for word; 2.3% of the picture darker than 8/255; mean brightness never under 30/255.
  - Requirement check, misses:
    - "Immense" is still not met as a number. Daylight gains about a third in the finest detail, the night about a tenth over the whole frame. The night's gain is mostly in what the yard lights now show.
    - During the fastest second of each pan the picture is blurred along the move by up to 9 px (the film shutter). That hides part of the gain there.
    - Yard lights show NASA's daylight picture of the modules, so the shadows inside their light have the Sun's length and direction.
    - A few blue spots remain in hollows on the sunlit hill.
    - Hong's scattering law was taken from two later papers that quote its numbers ([COBE/DIRBE study](https://www.cambridge.org/core/services/aop-cambridge-core/content/view/7FB7F6EEE948AC72C52033683B6806A2/S0252921100501766a.pdf/cobedirbe-studies-of-scattering-by-interplanetary-dust.pdf), [Clarke 1996](https://cambridge.org/core/services/aop-cambridge-core/content/view/559752291F17701581288AF6F6683DBF/S0252921100501808a.pdf/zodiacal-light-scattered-fraunhofer-line-profiles.pdf)), not from [Hong's paper](https://www.cambridge.org/core/journals/international-astronomical-union-colloquium/article/method-for-deriving-the-mean-volume-scattering-phase-function-for-zodiacal-dust/70C483336B5073361E31947125160CEE) itself; its third weight (0.005) is what the first two leave.
    - The Hugging Face token was not checked again this round. No AI step was used.
    - Credits for the caption are unchanged.
  - Time and cost: about 1 hour 40 minutes (the one-hour budget was lifted for this version). Three full renders and one stopped early; the first two were replaced after checks found the colour rims and the straight hilltop line. Nothing downloaded. No AI clip. AI credit spent: $0.

- **Owner's verdict on the sixth version (Nov 24, about 17:35 UTC+1):** "Pretty good." Take up to six hours, fix what is wrong, "make sure by the time you submit a video, nothing is really wrong", "add extreme amount of detail [...] maximize that out", "don't miss anything." Rules in `RULES.md` section 2 ("Nothing really wrong at hand-over; detail to the maximum").
- **Owner, Nov 24, about 22:55 UTC+1:** "Take more time if you need to, because I'm just gonna sleep [...] If you want to add more detail, add it. If you see something wrong, just do it overnight. I'll check it when I wake up." Worked through the night: ten independent reviews in all, renders 1 to 14, each review's faults fixed or answered (tables below).
- **Seventh version sent (Nov 25, about 05:30 UTC+1): 25.0 s, one shot, no cut.** Plan `tools/shorts-lab/moonbase-v18.json`, spec `tools/shorts-lab/specs/night_v18_one.json`. Same script and voice. Waiting for the verdict.
  - **The look has changed, and why.** An independent reviewer who had not seen the video called the sky "slate blue, not black [...] reads as air". Measured on NASA's frames: a blue lens glare over the whole picture (blue 83 against red 41 at 4° from the Sun, still blue 25 at 19°). It is now read from the sky of each frame and taken off. Three things follow:
    - The sky is black by day, with a small white glow at the Sun.
    - The night ground is grey, not blue. With the glare off, NASA's own shadows are neutral (0.16 to 0.24 of the lit ground in all three colours; the reel had used 0.217, 0.228, 0.296, and the blue in that was the glare). A shadow at dusk is grey at 0.24 of the lit ground; full night is darker (0.65 of that), because in a daytime shadow most of the light comes off the sunlit ground round it, and at night there is none.
    - Sunlit ground is a warmer grey (blue 192 against green and red 205; the sixth version was bluish, 228 / 220 / 218): that is NASA's ground with its blue glare off. Real lunar soil is a warm grey.
    - The far ridge shows as a dark mass with its lit crest. Before, it was the same blue as the sky.
    - The light now follows one Sun. It sinks toward the crest while the ridge's shadow spreads from the ridge's foot toward the camera; it stands on the crest just as the shadow reaches the camera; at dawn the light comes back nearest the camera first; and the take ends with the Sun half hidden on the crest behind a backlit astronaut. Until the third review the Sun stood still and the shadow swept sideways, which no ridge can do.
    - So the very end is darker than in the sixth version (mean brightness 24 to 32 against 60 over the last three seconds): the plain is in the ridge's shadow and the astronaut is seen against the light.
    If the owner prefers the blue night as a look, it is one setting (`shadow_rgb`); it would be a choice, not what the footage holds.
  - **Detail, what was done:**
    - NASA's lens effect had moved red and blue apart toward the frame's edges: up to 2.2 px (red) and 3.8 px (blue) at the left of the strip. Measured on 83,587 hard edges, fitted and undone (`colour_shift.py`); 0.05 and 0.5 px are left. Every edge there is cleaner and the coloured rims are gone at the source (strongly blue dark pixels on the lit hill: 246 → 25).
    - Camera moves now get up to speed, hold it and slow. Top speed 10 px a frame sideways (was 18.5), shutter 0.38 (was 0.5): the picture is blurred along a move by at most 3.9 px sideways (was up to 9) and 4.1 px in the tilt.
    - The astronaut is cut from NASA's 4K frames at 0.48 of their size (was 0.40): a fifth larger, with the suit's weave, patch and fittings readable.
    - The Earth's face is softened by 0.45 px (was 0.9), its edge darkens less, and two black gaps in the satellite picture are filled.
    - Sharpening: the finest band a little firmer (1 px at 1.1, was 0.9), which the blur measured on NASA's frames (0.72 px) justifies; the wider bands as in the sixth version (3 px at 0.5, 9 px at 0.2). After the first reviewer called the ground "over-sharpened and etched" they were cut to 0.15 and none. The second reviewer made the same remark after the cut, and measured detail had fallen (daylight by about a tenth, the night and the astronaut by a quarter to a half against the sixth version), so they were put back.
    - In the dark, the ground's own fine relief is shown at 1.0 (was 0.5), on brightness only and held under 14 levels, so it no longer outlines the modules.
    - A limiter meant to stop module rims glowing at night had been capping all of the ground's relief at 12 levels. It now acts on strong rims only (45): at night the finest detail rose by 37% on the same frames (2.28 to 3.12 at 6 s, 2.77 to 3.83 at 8 s).
    - The brightest sunlit ground is brought down without flattening its texture: only the broad level is lowered, so fine detail at 0 s rose by 11% against the first way of doing it.
    - The astronaut's outline was found again on NASA's 4K pixels (`astro_matte.py`): the old one, made on a half-size copy, cut 10 px into his shoulder and took in a strip of sky beside the backpack.
    - Tried and dropped: small stones scattered on the plain by a crater-count law. At this size they read as pepper noise. A stronger sharpening setting still (+10% detail, +5% noise): not used. Three other encoder settings: no measurable gain (SSIM within 0.0002); the encode costs no fine detail (it only smooths grain).
  - **The first independent review: 22 faults.** Each one and what happened:

    | # | Fault as reported | Now |
    |---|---|---|
    | 1 | The Sun in plain view, yet the plain, the rock and the astronaut in shadow | Fixed for what stands at the camera's height: the top of the rock and the astronaut's edges are sunlit. The plain stays dark: it is lower, in the ridge's shadow, as a valley is after sunset on the hill |
    | 2 | Sky slate blue with a foggy glow: reads as air; stars beside the Sun | Fixed. Glare off; no stars and no orbit points while the Sun is in view |
    | 3 | Astronaut: cut-out look, flat light, no rim from the Sun, etched texture, straight cut at the rock | Changed: a thin sunlit rim and a wider wrap on the edges turned to the Sun, his own sharpening removed, lamps only as small spots, the rock's own outline used where it is dark, his shadow on the rock top, the background less thrown out of focus (0.6, was 1.2) |
    | 4 | Visor mirrors a place that is not ours; white unshaded patches | The visor is held dark (0.55), so only its lamps show. The patches were suit that NASA's shot lit to white and that was taken for lamps: fixed |
    | 5 | Far ridge only a hairline; slope the same blue as the sky | Fixed: with the glare off the slope keeps the dozen levels of its own light and stands against a black sky |
    | 6 | The ridge gone at night, stars where its slope was | Fixed. The skyline is traced by hand (39 points) and followed; nothing of the sky is drawn below it |
    | 7 | Stair-stepped, blocky silhouette | Fixed. It was the edge of the old sky mask, not a ridge |
    | 8 | Shadow front a soft lobed edge like a hand-painted mask | Changed. Soft is right (the Sun is 0.53° wide; a ridge some kilometres off casts an edge tens of metres wide). Round lobes were not: a skyline is peaks, and each casts a long pointed finger along the Sun's ray. The edge is now made that way |
    | 9 | Sun-cast shadows unchanged at night; pools beside their lamps | Fixed: at night they are lifted out, and lamp light falls on ground without them (at first not under the four yard lights; after the third review not there either). A pool ahead of a rover's lamp is where a headlamp throws it |
    | 10 | Dark wispy mass on the mid ridge, like smoke | It was the shadow's lobed edge crossing the far hill: see 8 |
    | 11 | Foreground rock a smooth plastic gradient; blotchy rim; white crumbs | Partly. The gradient was the glare; the rock face is now an even dark. It has no texture in NASA's frames, so it stays a silhouette. Rim and crumbs are NASA's out-of-focus foreground |
    | 12 | Sunlit ground over-sharpened and etched; identical bumps; foreground smeared | Tested, not kept: see the sharpening line above. The streaked texture, the repeated small rocks and the soft near ground are NASA's |
    | 13 | Sunlit ridge patch crunchy | It gets a third of the sharpening. Its streaked texture is NASA's |
    | 14 | Earth soft beside sharp stars, dark outline, bright night side, thin ring at 15 s, too large, too high | Crisper, edge darkens less, gaps filled. Not wrong: the bright night side (it is lit by a nearly full Moon; exposed for the Milky Way it is bright), the thin crescent by day (the Earth is 21.6° from the Sun), its size (1.83° across, which is about 190 px through this lens) and its height (4.2° at the site, computed) |
    | 15 | Plume as searchlight shafts; a lander lands at 5 s and another descends at 20 s | The exhaust is a wide soft fan thinning with the square of the distance. The second lander now comes in along the line the first one lands on, so on a loop it is one lander |
    | 16 | Rainbow flare discs | Gone with the glare (they were NASA's lens spots in the sky) |
    | 17 | Sunset-like glow on the horizon with no source | Removed. It was our dust from a touchdown behind the ridge |
    | 18 | Night sky lifted to grey; Milky Way reads as cloud; magenta band | The band is gone (NASA's lens streak). The grey is the zodiacal light at its measured strength and the brown is NASA's star map: kept |
    | 19 | Crater a flat black ellipse | NASA's. At a Sun 4.5° up a small crater is full of shadow |
    | 20 | Subtitles left of centre, grey glow, crossing objects | Deliberate: room for the app's buttons on the right, and the glow keeps them readable on sunlit ground |
    | 21 | Orange painted-glow pools | Warm lamps are less orange (1.0, 0.90, 0.76; was 1.0, 0.84, 0.62) |
    | 22 | Ruler-straight double dark lines | NASA's hardware and its shadows |

  - **The second independent review** (a different reviewer, on the version with those fixes, 26 stills and 12 strips of four consecutive frames). Of the 22 it called 10 better, 12 unchanged, none worse, and added 12 new points. What was done after it:

    | Point | Now |
    |---|---|
    | Astronaut still flat, no bright rim; thin dark line down the backpack's edge; visor highlights; white patches on the forearm | Rim level 1.35 (was 0.85) with a wider wrap, the side turned to us darker (0.22 of his own shot's light), the cut's edge taken in by a pixel, the visor at 0.3 with no highlights, lamps allowed only on the helmet's rim |
    | The Sun's glow still a soft ball 560 px wide; its core only 226 of 255, no disc | The glow kept is half at 75 px and a twentieth at 300; the Sun is a white disc of its true size (0.53°, 56 px) |
    | White dashes of the crest left at night; a thin dark line along the crest | The crest now goes dark with the plain (it was only half darkened), and the sky's glow reaches the ridge |
    | Round painted lobes still in the dawn and the second shadow | The edge's slow wander cut to 0.3; its response to the ground's relief smoothed (at a dark-to-bright border it had cut the edge as with a knife) |
    | Long Sun shadows still at night beside one group of modules; hard black shadows of the rover and masts inside the ridge's shadow | Lifted out fully (up to 6 times their level, softly) |
    | The Earth by day a thin ring | The crescent tapers to its horns |
    | A faint grey ghost disc near the Sun | Gone: the sky near the Sun is drawn from the glow alone |
    | Stars and a grey sky while sunlit crest and hill are still in frame | Stars start at 5.0 s and are full at 7.0 s (were 3.4 and 6.0), when the sunlit ground has left the frame |
    | The lit patch on the rock top a mosaic of hard white blocks; a ragged white fringe on the dark slope at the bottom | The near foreground (the dark masses that reach the bottom of the picture, with their rims) is 2.4 px out of focus, as for a lens focused on the base |
    | Razor-edged wedges of light on the near slope; a white chip | The chip was my outline of the rock closing straight down: fixed. The wedges are the near slope's own silhouette against the darker plain behind it: they stay |
    | Shadowed ridge and rock olive beside a blue-violet plain | One neutral shadow colour everywhere (see above) |
    | Modules at night outlined as with a pencil | Fixed: the thin dark line the sharpening left beside each sunlit rim is held back with the rim |
    | The lander pops on the first frame and at the loop | Its strobe no longer flashes at 0.0 s |
    | A pink dot appears and vanishes between frames | A beacon blinking, on for 0.2 s: as meant |
    | Square blocks round the dark Earth when brightened; a green cast in the black | The encoder gives dark areas more of the bits (`aq-mode=3`); the sky's black is neutral (7, 7, 7) |
    | Unchanged and kept: the far slope flat (5), the rock face featureless (11), the ground's ripple and repeated rocks (12), the far patch (13), the night sky brighter than the night ground (18), the crater (19), the subtitles (20), warm pools (21), straight lines (22), dark tufts on the crest | NASA's picture, or deliberate, as in the first table. The night sky brighter than unlit ground is how a starlit night looks |

  - **The sixth version's "still wrong" list:**

    | Listed as wrong | Now |
    |---|---|
    | Motion blur up to 9 px hid part of the gain | At most 3.9 px sideways, 4.1 px in the tilt |
    | Yard lights showed shadows of the Sun's length | Fixed: no lamp shows the Sun's shadows now; its light falls on ground without them |
    | NASA's lens streaks on the dark mountain; the hill's level streaks; blue spots | Streaks gone from the sky, thinned on the mountain; blue spots 246 → 25; the hill's streaked texture stays (NASA's) |
    | The bending is hard to see in daylight | Five of the nine workers now kneel; figures have the proportions measured on NASA photograph AS11-40-5903 (helmet 0.22 of the height, each leg 0.13). Still small |
    | A 0.06 s full silence at 7.12 s | Gone: the music holds a trace through the pause |
    | Hong's numbers and the Moon's phase law read second-hand | Read in the papers themselves. Hong 1985, Table I: 0.698, −0.203, −0.813 with weights 0.665, 0.330, 0.005. Krisciunas and Schaefer 1991, eq. 9: m = −12.73 + 0.026\|α\| + 4×10⁻⁹α⁴ |
    | Sound not checked by ear | Still cannot be. More was measured: channels balanced to 0.02 dB, no hum or rumble, no clipping, no clicks. One faint tone at 9.6 kHz in the voice is 41 dB under the speech and absent in the pauses |
    | Small people not compared with real footage | Proportions now from a real photograph; motion still ours |
    | Exhaust brightness ours; visor; 2024 clouds; city lights barely visible | Stay |

  - **The third independent review** (another reviewer, on render 4, same method). Its strongest point was physical. What was done:

    | Point | Now |
    |---|---|
    | The Sun never moves: plain day at the start, plain night at the end, from the same Sun. A ridge's shadow needs the Sun at the crest | Fixed. The Sun sinks toward the ridge while its shadow crosses the plain (about 3° in 6.4 s), stays behind the ridge through the night, is back for the dawn, and at the end sinks again until it stands half hidden on the crest at 24.9 s. Its height is now set against the skyline as drawn in each frame (set in the reference frame's pixels it had ended a quarter hidden, not half) |
    | A flat, hard-edged disc over an all-dark plain reads as a full Moon | The disc carries a lens bloom, and at the end it sits on the crest. The plain is dark because it is in the ridge's shadow, which the Sun on the crest now shows |
    | Sunlit ground reads as snow | Its brightest levels are brought down (above 190 of 255, the rise cut to 0.72), so the Sun is the brightest thing in view. The near-white texture is NASA's |
    | Shadows at night point toward a lamp mast; tan pools; modules inside a yard pool stay dark | No lamp keeps the Sun's shadows now; warm lamps are whiter (1.0, 0.94, 0.86; were 1.0, 0.90, 0.76). Taller yard pools were tried and dropped: they laid a white haze over the modules |
    | The far slope ends in a straight upright edge on the left | Fixed: its treatment fades in over 300 px |
    | Pale dashes of the far crest at night | At night the far slope's lit patches go down to 0.4 of the plain's level |
    | Stars under a sunlit crest at dawn (14.2 s) | Stars fade out from 13.0 to 14.0 s, before the first light |
    | The Earth fades to a black disc within a second; in a deep exposure its sunlit part should bloom | A bloom round the bright parts of its face in the star exposure. The fade stays: it follows the exposure coming down for day (13.0 to 15.0 s) |
    | The dawn edge a soft lobed blob | Replaced by a different shadow (see the fourth review): at dawn the ridge's shadow now shrinks back toward its foot |
    | Hard wedges at the very bottom | The last rows are out of focus like the rest of the near foreground |
    | Astronaut still evenly grey, rim weak, pale halo, scalloped right shoulder, dark bar beside the backpack, marks on the forearm | The side turned to us is darker (0.20 of his shot's light, was 0.26), the rim wider and brighter (6 px at 1.5, was 4 px at 1.35). The scalloped shoulder, the bar and the marks are NASA's shot and its cut-out: they stay |
    | On a loop, end and start share one framing: the astronaut vanishes and night flips to day | Stays: a take that ends in night and starts in day cannot loop without that jump |
    | NASA's module shadows are 2 to 4 heights long; a Sun 4.5° up gives about 13 | NASA's picture: it stays |
    | Brown mottled night sky, crater, featureless rock face | As in the first table |

  - **The fourth independent review** (another reviewer, on render 6). What was done:

    | Point | Now |
    |---|---|
    | The night is a darkened daytime picture: the modules' Sun shadows stay, lamp light hugs the cluster and stops at the old shadow's outline | NASA's shadows are already about as dark as the night's ground (0.24 of lit ground), so at night they showed as smooth patches with a dark rim. Each old shadow on the ground is now given the ground's own fine texture, taken from sunlit ground on the same rows, at the level of the ground round it, under the lamps too. One lighter shadow beside a module on the right (70 of 255 on ground at 170) is still seen: a test that judged shadows against the ground close by also took the modules' grey hulls for shadows and was dropped |
    | The ridge's shadow looks painted: fingers fanning from a point on the plain; the ground at the ridge's foot lit while the plain beyond it is in shadow, ending on a straight line | Fixed with a new shadow. A ridge's shadow lies from its own foot toward the camera, so the foot is the first to go dark and the last to get light back, and peaks cast longer lobes along the Sun's direction. The old one was an edge turning round a point on the horizon, which left the foot lit |
    | The Earth a full disc at night beside a crescent by day; sepia sky brighter than by day; Earth too small against the Sun | Kept, with the reason: in an exposure long enough for the Milky Way, the Earth's night side lit by the nearly full Moon is about 20 times brighter than the Milky Way and shows its clouds; the crescent is then far over white. The night sky is brighter than the day sky because the exposure is far longer. The Earth is 1.83° across and the Sun's disc 0.53° (56 px): its glow makes it look larger, as an over-exposed Sun does |
    | The astronaut a pasted cut-out: lit from the front, no rim, a light halo, a straight cut at the rock | His outline is found again on NASA's 4K pixels (the notched shoulder and the strip of sky by the backpack are gone). His front, turned away from the Sun, is dark (0.15 of his shot's light); the lamp pool on his chest is mostly gone (his own helmet lamps cannot light it); the sunlit rim stays. The straight line at the bottom is the rock's crest: stays |
    | The ground engraved: black outlines on streaks and craters at night | Partly. The night's fine detail is NASA's relief, and the owner asked for detail; the dark outlines beside rims are held back. Stated as a choice |
    | The Sun's glow cut off by the ridge | Fixed: the bloom is the lens's and spills over the crest, in proportion to the part of the Sun in view |
    | Lit texture in front of the Sun's disc | The crest's sunlit rim: with the Sun just behind a ridge, its top edge catches the light |
    | The Sun has no lens star while the lamps do | Fixed: the same four-pointed star, longer |
    | Exhaust glowing white like a flame in air | Fixed: down to a faint trace near the nozzle (in vacuum a plume is nearly invisible) |
    | Small figures' shadows four times their height, the rover's twice | Fixed: drawn shadows are now as long, for their height, as the shadows of NASA's own objects in the frame |
    | The Sun should slide almost level at 85°S | True, and stated below |
    | The shadow crosses the plain in about 1.5 s while people and landers move in real time | Stated below (time-lapse for the light only) |
    | The lander the same image at 1, 5 and 23 s | One lander, seen on two passes of the loop |
    | Camera moves look machine-steady | Kept: a camera on a fixed mount or slider moves that way |
    | Black sky slightly green (3, 5, 2) after encoding; caption ends 4 frames early | Small. The caption ends with the voice |

  - **The fifth independent review** (another reviewer, on render 8). What was done:

    | Point | Now |
    |---|---|
    | The far ridge a flat card: its face in full sun while the plain at its foot is in its shadow, with a ruler-straight line between them | Fixed. The ridge's face is nearer its crest than its foot is, so it now loses the Sun first and gets it back last; only the crest line keeps the light. (The fault came with the new shadow of the fourth round: the face had kept the old rule) |
    | Night a darkened day plate: Sun-direction shadows of the right module group, the rover and the solar towers; ground only one stop darker than by day | The right group's and the rover's old shadows are lighter than the others (70 of 255 on ground at 170) and were missed; they are now traced on NASA's reference frame and filled with the ground's texture like the rest. The towers' two thin shadow lines are too thin to be told from the ground: they stay. The night's ground is darker (0.65 of NASA's shadow level): in a daytime shadow most of the light comes off the sunlit plain round it, and at night there is none |
    | Astronaut: straight cut at the rock, a white fringe on edges turned away from the Sun, lit from the front | The rim now comes from the Sun's side (upper right) and is narrower (4 px). His front is dark since render 8. The line at the bottom is the rock's crest |
    | Earth full at night, cross-dissolve to a crescent, same clouds for days, too large, too high | Kept, as in the fourth table. Its place is the one computed for the matched site and date (about 4.6° above the horizon; from 85°S the Earth stands about 5° up, give or take 6.7° with the Moon's libration). Its clouds do not move: time-lapse for the light only (below) |
    | Sky like an astrophotograph from Earth, fading out with the stars | Kept: the Milky Way's light is there without air; the fade is the exposure coming down for the dawn |
    | A rectangle with a straight vertical edge cutting a module at 10 to 13 s | Fixed. My own fault from the fourth round: the shadow fill borrowed texture with a shift that wrapped round the picture |
    | Lamp halos flat; they light no module faces | Partly: the lamps light the ground and what stands in their pools; they do not cast their own shadows |
    | The Sun's lens star drew a hairline across the sky with the Sun out of the picture | Fixed: only while the Sun is in the picture |
    | Two identical figures stacked 18 px apart | Fixed: the second walks beside the first |
    | The Sun 300 px above the crest at the start; shadows only 2 to 3 lengths | The Sun is where NASA's is; its shadows are NASA's (stated in the fourth table) |
    | The Sun sinks straight down at the end | Stated below |
    | Camera tilt stops in 8 frames | Kept: it eases in and out over 0.6 s; longer would blur it over the 4 px limit |
    | Waxy modules with dark outlines at 16 s | The source's own detail drawn firmer; a measured choice (see the sharpening line) |
    | The loop jumps from dusk to full day | Stated below |

  - **The sixth independent review** (another reviewer, on render 9). What was done:

    | Point | Now |
    |---|---|
    | A sunlit hill at the ridge's foot stays lit inside the ridge's shadow, ending on a straight line | Fixed. An old rule from before the new shadow ("nothing above the foot line can be reached") had kept it lit. And the geometry was corrected: NASA's first frame shows the plain lit right to the foot with its Sun 305 px above the crest, so the crest must stand well behind the foot. The shadow now reaches the foot when the Sun is 250 px above the crest, and the whole plain when it reaches the crest |
    | At 21 s the Sun stands well clear of the crest while the plain is already dark | Fixed by the same correction: with the whole visible plain in shadow the Sun is now at most 16 px (0.15°) above the crest |
    | Old Sun shadows still at night (a rover at 5 s, module shadows at 3 s); a bright smooth patch with an outline under a cluster at 12 s | At 3 and 5 s that ground is still in sunlight (the shadow has not reached it yet), so its shadows are right. The 12 s patch was an old shadow whose soft edge the fill did not reach: it now goes 6 px past the dark core, and the night's relief is no longer drawn along those edges |
    | Night sky brighter than by day and brown; drops at 13 to 14 s before any light | Kept as before (exposure). The stars and the exposure now fade from 13.4 s, as the Sun's edge clears the crest for the camera at 13.6 s |
    | Earth full, then a crescent by fading; blue at mid-grey | Kept, as in the fourth table |
    | A bright 1 to 2 px line down the right edge of the picture beside the astronaut | Fixed: the rim light was being drawn where the frame cuts him |
    | Astronaut ends on a straight line on the rock | The rock's traced top line was straight between its points; it now has small fixed bumps |
    | Lamps go out together at 15 s | With the corrected geometry the light comes back over about two seconds, nearest the camera first |
    | Exhaust still a white blob | Down to a trace (0.05) |
    | The Sun's spike shimmers frame to frame | Its arms are wider (2 px), so a fraction-of-a-pixel move no longer flickers |
    | Landers the same sprite twice; small figures pegs; crater and rock face NASA's; sharpening halos | As in the earlier tables |

  - **The seventh independent review** (another reviewer, on render 10). What was done:

    | Point | Now |
    |---|---|
    | A hard-edged grey disc on the ridge under the Sun (21 to 24.9 s, and at 2 s) | Fixed. A circle of 430 px round NASA's own Sun, made long ago so its glare would not be shaded, kept that part of the ridge out of the shadow once our Sun sank to the crest. Now nothing above the skyline counts as ground, and the circle is gone. (A first fix left a dark cap above the Sun: NASA's glare taken for ground. Caught on a test frame before the render) |
    | At dawn the foothills light before the ground at their foot, with a straight seam between them (17.25 to 17.4 s, 18 s) | Fixed: the ridge's face goes dark before its foot and gets the light back after it, set by the Sun's height |
    | Old shadows at night: the rover's long shadow and the masts' two thin shadow lines (5 s) | Fixed: traced on NASA's reference frame and filled like the others |
    | The Sun's horizontal spike crosses the whole frame | Shorter (70 px, was 110) |
    | Exhaust a grey smudge beside the lander | Gone: no plume drawn (in vacuum it is nearly invisible) |
    | The ridge's shadow grey (45), not black; sky brown and bright; Earth fades between full and crescent; frozen stars | Kept, as in the earlier tables (a shadow at dusk is filled by the sunlit ground round it, which NASA's own shadows show; exposure; time-lapse for the light only) |
    | The astronaut not lit by the Sun; visor black; cut by a straight rock edge | He is backlit: front dark, rim from the Sun's side. The visor is held dark on purpose (its reflection was of NASA's other set). The rock's top now has small bumps |
    | The Sun drifts right at the start and left at the end | NASA's camera drifts and turns back in the footage (the take uses it forward then backward); the Sun moves with the sky it is drawn on |
    | The camera move is a flat slide with no parallax | Stated below: the take is cut from one fixed 4K shot |

  - **The eighth independent review** (another reviewer, on render 11). What was done:

    | Point | Now |
    |---|---|
    | A straight seam between ridge and plain; the ridge's foot sunlit above a dark plain; a sunlit patch on the ridge fading as a whole in 6 frames | Fixed. The shadow now climbs the ridge's face from its foot to its crest as the Sun sinks (and comes back down at dawn), meeting the plain's edge at the foot. The seam was a dark band the lobes of the shadow's edge left at the foot: they now grow with the distance from the foot, as a peak's shadow does |
    | Old Sun shadows of a second rover and of the masts' panels at the end (21 to 24.9 s) | Traced and filled like the others |
    | The Sun's glow stops at the crest | Fixed: the wide glow is laid over the ground in front of it too |
    | Bright 1 px lines along a filled shadow at 12 s | Fixed: the night's relief is no longer drawn along any filled shadow's edge |
    | The astronaut darker (17) than the shadowed plain (46) | Fixed: his front is at the night's level, like the ground in shade (about 50), with the sunlit rim |
    | Shadow lengths 1 to 2 heights for a Sun on the crest; Earth's phase by fading; glowing night sky; 11.3 to 12.8 s the sky drifts 5 px against the ridge | As before: NASA's shadows; exposure; the source's own slight camera drift under a sky held to the stars |
    | Lamps light no end caps; craters flat; small figures blobs | As in the earlier tables |

  - **The ninth independent review** (another reviewer, on render 12). What was done:

    | Point | Now |
    |---|---|
    | The final Sun not hidden by the crest: a whole disc in front of the ridge that shrinks | Fixed: the crest cuts the disc and its bright bloom flat; only the wide glare goes over the ridge |
    | The caption blinks out for one frame at 1.25, 17.46 and 19.21 s | Fixed: phrases less than 0.3 s apart now meet exactly (in every earlier version too, it was a gap of 0.02 s rounded to a frame) |
    | The shadow's edge ruler-straight at 3 and 17 s | Its lobes are longer (the peaks' shadows) |
    | No shadow of the astronaut on the sunlit rock top in front of him | Stronger (0.7) |
    | A ghost of the sky lander 25 px beside it at 4 s; a glowing ball under it | Fixed: the side-jet puffs are gone, the engine's glow halved |
    | "NASA has said its astronauts would visit the south pole by 2030" needs a source | It is the goal's pending promise in the app, the source of that line since the first Moon base video |
    | Earth's phase by fading, frozen clouds, too large against the Sun; night sky brighter than the ground; Sun 3° up at the start; short module shadows; lamps with star spikes; figures as blobs | As in the earlier tables |

  - **The tenth independent review** (another reviewer, on render 13). What was done:

    | Point | Now |
    |---|---|
    | The second dusk runs several times faster than the first (the shadow jumps 50 to 100 px a frame at 20.5 s) | Fixed: the second dusk follows the first one's pace |
    | Large soft wedges on the shadow's edge read as doubled shadows of the modules | Smaller and rounder (between this review and the last) |
    | The astronaut's sunlit rim stays after the Sun sinks | Fixed: it fades with the part of the Sun above the crest |
    | Sunlit regolith cream-tinted, reads as snow; the black sky slightly green | Fixed by a small colour balance at encode: sunlit ground warm grey, shade and black neutral |
    | The added shadow (45) far lighter than the ridge face (5) | The ridge face is in its own shade, and NASA's own shadows on the plain are at the same level as the added one (0.24 of lit ground) |
    | A module's top in shadow before its base as the edge passes | Stated below: the picture has no heights, so the shadow is laid on it as on flat ground |
    | The astronaut's front does not change as the shadow crosses him | Kept: he stands at the camera's height, in the light the camera sees |
    | Sky, Earth, Sun's height and path, lamp pools, figures, crater | As in the earlier tables |

  - **Last check (an eleventh reviewer, render 14 against render 13, looking only for what got worse):** verdict render 14. All four of the tenth review's fixes worked. It found two overshoots: the second dusk now a little slower than the first (2.5 s from 90% to 10% of the plain lit, against 2.1 s; kept, the voice needs the light until 22 s), and the colour balance turning the dark shots faintly violet. The balance was then redone as a curve that touches only the sunlit ground's level (a little more blue) and the deepest shade and black (a little less green), so the dark shots stay neutral and the Sun's white core keeps its size.

  - **Stated plainly, because it cannot be fixed inside one take:**
    - Night falls in seconds while people and landers move at their own speed. Time is compressed for the light only.
    - Which way the shadow travels is ours. At the place and moment the sky was matched to (85°S, 17–21°W, 8 January 2039), the Sun is 3 days before local noon, climbing, and moving left along the horizon at 0.5° an hour; it would not set there for 11 days. The reel's shadow comes from the right because the story needs night to fall in this view.
    - The Sun goes down, comes back and goes down again within 25 s. That is the day's light in time-lapse, as the shadow is. Its path is ours and not right for the place: at 85°S the Sun moves almost level along the horizon (its height changes by at most about 5° for each 90° it moves sideways), so to sink 3° behind this ridge it would travel at least 35° to the side, far out of the picture. The reel shows it sinking straight down.
    - The shadow is laid on NASA's picture as on flat ground. The picture holds no heights, so as the edge passes a module its top darkens before its base, where a real module's top would keep the light a moment longer. It lasts a fraction of a second at each module.
    - The camera's moves are a frame moving over one fixed 4K shot of NASA's: there is no parallax between near and far, as there would be if a real camera moved. The moves are slow enough that this is hard to see.
    - The loop: the end (dusk, Sun on the crest) cuts to the start (day, Sun high). One take that ends at dusk and starts in day cannot loop without that jump.
    - The night ground still carries the fine shading the low Sun gives it (it is NASA's daylight picture, dimmed). In true shadow that shading would be softer.
  - **Measured on the file sent (render 14):**
    - File: 600 frames, 25.00 s, 30.0 MB, mean 9.6 Mbps (`aq-mode=3`, `maxrate` 9300k; highest 2 s 10.9 Mbps), frames evenly spaced. Captions meet with no gap except one deliberate pause of 0.36 s.
    - Sound: 100% word match with the subtitles; loudness −15.0 LUFS, true peak −1.7 dBTP; no clicks, no dropouts, no clipping; the voice 4.8 to 13.1 dB above the music in each passage.
    - Fine detail on the same ground as the sixth version (`matched.py`): under 1 px +21% on average, 1 to 3 px +7%, 3 to 9 px −1%. By daylight +14 to +74% (finest); at night −4 to −30% and in the last second −13%, where the picture is now darker for the reasons above. Against the fifth version: +55%, +25%, +7%.
    - Mean brightness per second: 89 90 85 78 50 24 24 26 28 31 37 39 39 34 22 68 81 103 100 92 72 53 32 24 24 (the sixth version: 109 91 83 57 44 41 40 40 36 33 34 34 34 33 33 37 90 111 111 63 50 58 60 60 60).
    - Colour on the file sent: sunlit ground 202 / 202 / 193 (red / green / blue; was 202 / 203 / 190), shade and the black sky without a green or violet cast.
    - No flicker found by the frame-to-frame scans (`flash_scan.py`, `shimmer.py`) beyond the moving edges of the shadow; every independent reviewer found no one-frame pops in the strips.
  - **Time and cost.** From about 17:35 UTC+1 on Nov 24 to about 05:30 UTC+1 on Nov 25, with the owner's overnight extension. Two container restarts cost one render each; renders now run in short chunks that resume. No AI credit spent ($0); no paid service used. The independent reviews ran as separate agents inside this session.
- **Owner's verdict on the seventh version (Nov 26, about 20:00 UTC+1):** to "If you prefer the old blue night, it's one setting": "old setting was better. Fix whats wrong and add immense detail pay great attention and make sure the shadows are accurate." Rules in `RULES.md` section 2 ("The old night was better; accurate shadows"). Eighth version: plan `tools/shorts-lab/moonbase-v19.json`, spec `tools/shorts-lab/specs/night_v19_one.json`.
- **Eighth version (Nov 26–27): the old blue night, and shadows checked against the Sun shown.** Plan `tools/shorts-lab/moonbase-v19.json`, spec `tools/shorts-lab/specs/night_v19_one.json`. Same script and voice.
  - **The blue night of the sixth version is back** (owner's choice): shadow colour 0.217 / 0.228 / 0.296, night level 0.94.
  - **Where the source's shadows point and how long they are (measured on the reference frame).**
    - Checked with the construction for a thin upright thing: the tip of its shadow lies where the line from the Sun through its top meets the line from the point on the horizon under the Sun through its foot.
    - NASA's shadows roughly fit its own Sun (4.6° up, at canvas 3090, 190). The plain's rock's tip is 9 px from its prediction (2210, 993 against 2201, 994). The left module cluster's shadow ends within about 60 px of its prediction (a module's top is not one point). The masts' panel shadows lie where predicted but are about 20% short and turned 5 to 10° from the Sun's ray (for example the mast at 2429, 1196: 82 px against 101).
    - So NASA lit the scene with about the Sun it shows, not an 18° Sun. The first draft of this version had read the shadows' length on the picture (2 to 4 times the height) as their length on the ground and taken the source's Sun for 18° up. The ground is seen foreshortened, so that was wrong: render 15 drew shadows 4 to 5 times too long, and an independent review measured two systems of length side by side (8.5 times the height for the rovers, 1.4 for the panels and the lander).
    - A least-squares meeting point of all thin dark lines was no use: the lines are near-parallel and many are tracks. The masts are the clean evidence, and they agree with the point under the Sun on the tracked horizon.
  - **One rule for every shadow.** As the Sun sinks below 4.6°, every shadow on the ground is tan(4.6°) / tan(elevation) as long, measured from its foot: 1.0 at the start, 1.7 with the Sun 2.7° up (3 s), 1.9 at 21.5 s, 2.6 with its centre on the crest. Each shadow's own pattern is redrawn along the Sun's ray (on flat ground depth along the ray goes as 1 / distance from the point under the Sun), at its typical dark; the deeper dark right under a module stays where it is. Its tip is as much softer as the lower Sun's penumbra adds.
    - **Masts, posts and panels:** NASA drew no shadow for any pole or post, and the masts' panel shadows are pale stripes, short and turned. Each pole and post now casts a shadow by the construction from its foot: a line as long as its height and the Sun make it, widening with nearness, fully dark only as far as its width over the Sun's 0.53° reaches, then fading. Each panel casts a solid shadow from where its bottom edge's shadow falls to where its top's does. NASA's stripes are lifted to the ground's level.
    - **Nothing is painted over the modules.** The modules', vehicles', lander's and rock's own shaded sides face the camera and are as dark as a shadow; read as shadows, render 15 stretched them across the modules as straight stripes and blocks. They are outlined by hand on the reference frame (11 outlines) and left out.
    - **The figures' drawn shadows:** exact length (the tip at nu / (1 − h cot(e) / f) from the point under the Sun), a penumbra of 0.53° / elevation of the length, drawn whole (render 15 cut some short at their box), in the source's neutral shadow tone instead of the night's blue.
  - **The astronaut.** With the Sun behind him his shadow falls toward us onto the rock top in front of him: a point there is in it when the line from it toward the Sun meets him a quarter to half way (he stands a step or two beyond). The sunlit facets in it take the shaded rock's level. The rock top's sunlight follows the part of the Sun above the crest. His side turned to us is lit by the plain in front of him and dims as the ridge's shadow covers it (lit parts 47 → 37–39, where render 15 rose 43 → 51).
  - **Independent review of render 16 (shadows first), and what was done:**

    | Fault found | Answer |
    |---|---|
    | Mast shadows as hatched stripes, cut off from the masts' feet; a "railway" double line with an over-bright gap by the bottom panel | Fixed. Every pole and post now casts its own shadow from its foot (NASA drew none: along each predicted line the ground is at 0.97 to 1.00 of its surroundings). It is a line as long as its height and the Sun make it, widening with nearness, fully dark only as far as the pole's width over the Sun's 0.53° reaches, then fading. The masts' panel shadows (NASA's stripes, at this stage) join it. The double line is rover tracks and is no longer stretched. Faint shadows are judged against the ground's typical level, so no gap is lifted above the plain |
    | Small figures' shadows do not lengthen from 0 to 2 s | Not a fault: by 2 s the camera has panned, and the figure measured is another one, bending over. Upright figures lengthen 27% (31.2 → 39.6 px, 21.5 → 27.4 px), as tan 4.6° / tan 3.6° requires |
    | A second, darker blot inside the module shadows (16 to 17 s); a fainter copy of a rover's shadow | Fixed. A wide shadow's middle had not been recognised as shadow, and another thing's lengthened shadow darkened it again. A lengthened shadow now covers only its own old place and bare ground, at its own level. Ground newly in shadow loses most of its fine shading, as in NASA's shadows, which also removed the seam at the old tip |
    | The astronaut's side facing us lit at 20 to 21 s | Not a fault: the region measured is sunlit plain, because he enters the frame there only after 21 s. His suit measures 33 to 40 |
    | The rock top in front of him brightens as the Sun sets | Fixed: his shadow no longer weakens as the Sun sinks. It takes away the direct light at any height. Now 34.6 → 32.0 |
    | The Sun's flat bright core is 87 px across, not 54 (0.53°) | Kept. It is the source's own glare, read from NASA's sky. A camera exposed for sunlit ground saturates beyond the disc: the lens spreads a small part of the Sun's light round it, and that part is still brighter than the ground |
    | The Sun's path is too steep for 85°S | Stated before: the path is ours, the day's light in time-lapse |
    | At 0 s one mast's shadow is shorter than the construction gives | Right, and true of all five: NASA's panel shadows are about 20% short. Fixed after the second review (below) |
    | Lengths at 19 s differ by 30% between a rover and a mast; directions at 19 s | Within what the estimated heights and the cables allow. At 0 s the reviewer's own check puts the figures' shadows through the point under the Sun, at the right length |
  - **Measured on render 18 (the second review's file):**
    - File: 600 frames, 25.00 s, 30.2 MB, mean 9.7 Mbps (highest 2 s 10.9 Mbps), frames evenly spaced. Captions as in the seventh version.
    - Sound: unchanged from the seventh version; 100% word match with the subtitles; no clicks, no dead silences, no clipping (peak 0.794).
    - Fine detail on the same ground as the sixth version (`matched.py`): under 1 px +20% on average, 1 to 3 px +5%, 3 to 9 px −6%. By daylight +18 to +77% (finest); at 6 s and 22 to 23.5 s lower, where the ridge's shadow now lies.
    - Mean brightness per second: 90 90 86 74 51 36 32 35 37 38 42 44 44 38 36 66 80 97 95 85 71 53 35 28 24 (the seventh version: 89 90 85 78 50 24 24 26 28 31 37 39 39 34 22 68 81 103 100 92 72 53 32 24 24): the blue night is lighter, as in the sixth version.
    - Flicker (`shimmer.py`, pixels off from both neighbouring frames, per second): the same as render 15 to within the scan's noise; nothing new from the longer shadows (they are found once and carried by the ground's motion).
  - **Second independent review (render 18), and what was done:**

    | Fault found | Answer |
    |---|---|
    | A black band across the bottom of the frame (up to 113 rows at 19.25 s) | Fixed. It was new in render 18. Where a frame shows ground past the reference frame's edge, the shadow maps read leftover values (OpenCV's polar warp leaves points outside the picture unset unless told to fill them), and the shadow factor went to its floor. The maps now fill those points, and nothing outside the reference frame is changed |
    | At 0 s the masts' shadows are 7 to 10° flatter and 25 to 35% shorter than the post shadows beside them, pale and striped | Partly a mix-up: the "posts" were the small drawn figures, which fit the construction to within 3° and 1 px. But it is right about the masts: NASA's panel shadows are about 20% short and turned 5 to 10° from the Sun's ray. They are now lifted, and each panel casts a solid shadow by the same construction, joined to its foot by its pole's shadow |
    | A small rover's shadow doubled, with a bright seam through it | Fixed. The lengthened part was at the same level as the old one, but the old tip's bright rim (the source's, and sharpening) stayed as a lit line. Nothing inside a longer shadow is now brighter than its level times the lit ground close by |
    | The near panel's shadow "doubled", its thin part too long | The double line is rover tracks in NASA's picture, which cross the pole's shadow. The pole's own shadow is 23% of the whole at 3 s, as its height gives |
    | The rock's face brightens 3 to 4 levels as the Sun sets; its top rim stays lit | The face rises in the sixth and seventh versions too (25 → 28, 10 → 18): the source's camera moves in, and a lighter part of the face comes into the measured box. The night's tone can now only darken it anyway. The rim stands at the camera's height and still sees half the Sun: about half the light (185 → 145 on the picture's levels) is right |
    | The Sun 4.7° up is higher than the south pole allows | The sky was matched to 85°S, where the Sun reaches about 6.5°; at the pole itself it would be under 1.6° |
    | The Sun's saturated core about 1° | As above: the source's glare, kept |
  - **Third, focused check (render 19), and what was done:**

    | Fault found | Answer |
    |---|---|
    | Frame edges | No band, garbage or hard line in any of the 600 frames (checked pixel by pixel) |
    | A small rover's shadow looks doubled at 2x: the old part crisp, the longer part softer and a little darker (46 against 58), its outline wider | Kept, stated: the longer part is the same shadow drawn out along the Sun's rays, softer because a far shadow edge is softer (the penumbra grows with distance). NASA's own part is sharper than a real shadow that long would be |
    | The panel's shadow by that rover reads as broken: a stub, two thin lines, a gap, then a bar at another angle | The two thin lines are rover tracks in NASA's picture. The stub is the base's shadow, the faint line along the tracks is the pole's, and the bar is the panel's, starting where the construction puts the panel's lower edge. The tracks run 8° off the Sun's ray, so they do not line up with it |
    | A lit patch at the right edge of the frame, by his arm, at 21 s | Fixed: where the frame cuts the astronaut, his outline goes on past the edge for his shadow (146 → 32) |
    | A grey band on the rock's left edge at 21 s | The edge of his shadow: with the Sun behind him and to the right, it falls down and to the left across the rock top |

  - **Measured on the file sent (render 20, which is render 19 with the astronaut's last four chunks redone):**
    - File: 600 frames, 25.00 s, 30.8 MB, mean 9.7 Mbps (highest 2 s 10.6 Mbps), frames evenly spaced; no dark band at any frame's edge (rows under 10 of 255 at the bottom: 0 in all 600 frames).
    - Sound unchanged; 100% word match; no clicks, no dead silences, no clipping.
    - Fine detail on the same ground as the sixth version (`matched.py`): under 1 px +19% on average, 1 to 3 px +5%, 3 to 9 px −3%. By daylight +17 to +76% (finest).
    - Mean brightness per second: 88 88 84 74 53 37 32 33 36 37 41 43 43 37 34 63 79 99 99 89 72 51 34 27 23.
  - **Stated plainly:**
    - The source's own dark band at the ridge's foot has no texture to recover (it is lens glare over black), so it stays near-black, at night too, as in the night the owner chose. The ridge's shadow we add on the plain is the night's blue.
    - The Sun's path, the night's length and the Sun coming back at the same place are ours, the day's light in time-lapse (as stated for the seventh version).
    - Shadows are laid on NASA's picture as on flat ground; things standing on the plain are outlined by hand and kept out of them.
  - **Time and cost.** From about 20:00 UTC+1 on Nov 26 to about 01:00 UTC+1 on Nov 27. Five full renders (15 to 19). No AI credit spent (/bin/bash); no paid service used. The independent reviews ran as separate agents inside this session.
**Blocked: the open AI image model test.** The plan was an Apache-licensed image model run on the CPU through `stable-diffusion.cpp`. This session's safety check refused the build three times; it was not worked around. **Owner's decision (Nov 21): skip the AI image test for now.** Revisit only if the real-data method cannot cover a goal (for example things that do not exist yet, such as a finished Moon base with people).

**Other findings**
- NASA publishes 257 spacecraft and hardware models as `.glb` (github.com/nasa/NASA-3D-Resources). For a Moon base they include the Habitat Demonstration Unit, the Space Exploration Vehicle (crew rover), the RASSOR digging robot, the Mark III and Z2 spacesuits, an astronaut, the Apollo Lunar Module, dishes and the Gateway core. Most are Draco-compressed, which the `bpy` pip package cannot read (only the Gateway and three simple models load as they are); they need decompressing first.
- NASA's Deep Star Maps 2020 at 64k is 0.0055° per pixel, which is 1:1 with a 1920 px frame at a 10.6° field of view. Orientation was verified against Antares (within 2 px).
- NASA GIBS serves daily true-colour imagery as tiles with no key. Single-day mosaics have visible boundaries between satellite passes; shots must be framed inside one pass.
- EOX "Sentinel-2 cloudless 2016" tiles (CC BY 4.0) are sharp on land (about 140 m per pixel at zoom 10 here, finer at higher zooms), but the sea has visible coverage halos and seams around the coast and reefs. Usable for land only, under a land mask; not tried in a render yet.
- `eoimages.gsfc.nasa.gov` (Blue Marble) and `sciencedirect.com` cannot be reached from this environment.
