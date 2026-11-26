# Shorts lab: free "real data" render tests (Nov 21, 2026)

Test scripts from the feasibility check in `docs/shorts/PROGRESS.md`. They are experiments, not the production renderer.

Each one builds a 1080×1920 picture in Blender (the free `bpy` Python package, CPU only) from public scientific data, so the detail in the frame is measured, not invented.

| Script | Picture | Data (all free to use) |
|---|---|---|
| `moon2.py`, `cam2.py`, `sky_crop.py`, `comp2.py` | Moon's south pole from 100 km, Earth above | NASA LOLA elevation `LDEM_80S_40M` and `_80M` (PDS); NASA SVS Deep Star Maps 2020, 64k; a DSCOVR EPIC Earth image |
| `pdb_parse.py`, `hiv.py` | HIV-1 capsid, every heavy atom | Protein Data Bank entry 3J3Q (CC0), Zhao et al., Nature 2013 |
| `gibs_fetch.py`, `earth.py`, `comp_earth.py` | Queensland coast and southern Great Barrier Reef from 480 km | NASA GIBS true colour, VIIRS on NOAA-20, 2026-08-11 |
| `base_scene.py`, `base_props.py`, `lunar_site.py`, `terrain.py`, `comp_real.py` | Moon base test: prototype hardware on the Connecting Ridge near the south pole, seen from head height (Nov 22) | See "Moon base test" below |
| `undraco.py`, `model_probe.py`, `sky_when.py` | Helpers: decompress NASA's `.glb` models, test-load them, list real dates when the Sun and Earth are where a shot needs them | NASA-3D-Resources; JPL DE421 and lunar orientation kernels (NAIF) |

Setup: `python3 -m venv venv && venv/bin/pip install bpy numpy opencv-python-headless scipy OpenEXR DracoPy skyfield`. Data files are downloaded separately and passed as paths; none are stored in this repository.

What is modelled rather than measured: lunar craters smaller than the 40 m data, the blue fill light in lunar shadows, the atmosphere glow on Earth, the capsid's colours and the out-of-focus specks behind it.

## Moon base test (Nov 22, 2026)

Made after the owner's verdict on the first moving clip: more separate things, something going on, and only what a real camera could record (`docs/shorts/RULES.md`, section 2).

Run: `python base_scene.py DATA OUT 0 119 120`, then `python comp_real.py OUT OUT_C 0 119`. One 1080×1920 frame takes about a minute on 4 CPU cores and about 7 GB of memory, so run one copy at a time.

**Measured or published**
- The place: 89.43° S, 223.3° E on the Connecting Ridge between Shackleton and de Gerlache craters. Terrain from NASA LOLA elevation grids `LDEM_875S_5M`, `LDEM_80S_40M` and `LDEM_80S_80M` (PDS). The 5 m grid stores heights in 0.5 m steps, which is noise at this scale, so it is smoothed and is real down to roughly 30 m.
- The sky: the directions, distances and sizes of the Sun and Earth, and the way Earth is turned and lit, are computed for 2026-09-06 00:00 UTC (01:00 UTC+1) from JPL's DE421 ephemeris and the lunar orientation kernels. The Sun stands 0.9° above the horizon and Earth 4.8°. Earth's face is NASA GIBS imagery of that day (VIIRS on NOAA-20). No stars: a camera exposed for sunlit ground cannot record them.
- The hardware: NASA's own 3D models of the Space Exploration Vehicle, the Habitat Demonstration Unit, the RASSOR excavator and the Z-2 suit (github.com/nasa/NASA-3D-Resources). These are prototypes NASA built and tested on Earth. None has flown.
- Gravity for the thrown dust: 1.62 m/s². With no air, each grain flies a parabola.

**Modelled by us**
- Everything on the ground smaller than about 30 m: craters (their number per square metre falls with the square of their diameter; the constant was set by eye and still has to be checked against published counts), soil roughness, rocks, wheel tracks and bootprints.
- Where the hardware stands, that a second rover is in the distance, and that the habitat rests on the ground. The rover's speed is 1.4 m/s (5 km/h); NASA's stated top speed for the vehicle still has to be looked up and cited.
- Work lights, the rover's flashing beacon and the amount of dust its wheels throw. NASA's models carry none of these.
- The camera response: exposure, lens glare, the film-like curve and sensor noise.

**Added Nov 22 (all modelled)**
- Dust on the hardware and paint toned down from pure white; a small camera wobble as if carried; motion blur with the shutter open for half of each frame.
- The near astronaut lifts one arm and turns a few degrees; the second holds a different arm pose. The suit has no skeleton, so this is one arm turning about the shoulder.

**Rendering fast**
- `prep_site_data.py OUT` fetches only the slices of NASA's grids the shot needs (266 MB). `.github/workflows/shorts-lab-render.yml` then splits the frames across 20 free GitHub runners; change `render-request.json` on the working branch to start it. A 120-frame shot takes about 15 minutes.
- `.github/workflows/shorts-lab-ai.yml` and `ai_pass.py` send frames of a finished render through public demos of open models (test only; needs the repository secret `HF_TOKEN`).

**Known limits**
- The suit model has one pose and no skeleton, so the astronauts cannot walk. The excavator is parked.
- Wheels and dust are not motion-blurred, only the camera and the rovers' bodies.
- The soil roughness was set by eye and still has to be checked against published measurements.

## Moon base video "the 354-hour night" (Nov 22, 2026)

The first complete video: five shots, narration, subtitles and score. Nothing is published; the result goes to the owner.

- Plan: `night-video.json` (lines, each shot's job, cuts, voice and score settings).
- Shots: `night_video.py` (surface shots 1, 2, 3 and 5) and `pole_light.py` (the filler). All five are requested together in `render-request.json`; the workflow renders them in chunks of 7 frames and returns one clip per shot.
- Assembly: `make_video.py PLAN CLIPS VOICE OUT.mp4`. Voice files are made with Kokoro (`am_michael`, speed 1.12), one per sentence, and aligned with a local speech recogniser for the subtitle timings.

**Measured or published**
- Terrain: NASA LOLA elevation. Every surface shot is on the Connecting Ridge near the south pole: the habitat 75 m west of the summit, the sunlit shot on the west slope 210 m from it.
- Dates: 22–23 April 2026 for the night shots, a week when that terrain hid the Sun from the summit for about 40 hours (our own calculation from LOLA and the ephemeris); 6 September 2026 for the sunlit shot; October 2026 for the filler.
- Sun, Earth and stars: positions, Earth's turn and phase from JPL DE421 and the lunar orientation kernels; Earth's clouds from NASA GIBS for the same days; stars from NASA's Deep Star Maps 2020.
- Hardware: NASA's Habitat Demonstration Unit and Z-2 suit prototypes (NASA-3D-Resources).

**Modelled by us**
- That a habitat stands there at all. No base exists; the first line says "would", and the peak line says none has run through a night.
- All ground detail under about 30 m, rocks, bootprints, every lamp and its brightness, how the people move, the camera and its exposure.
- Earthlight is a single lamp scaled from the Sun by Earth's phase; it is not measured.

**Known limits**
- At the night exposure Earth is a white disc, as a camera would record it, and can be mistaken for the Moon.
- People turn and lift one arm; they do not walk.
- The habitat model is clean and simple at close range.

## Orbiter over the south pole (Nov 22, 2026)

A 3.5 s shot made to set a higher bar after the first complete video was judged "like a school project". Not published.

- Shot: `lro_pass.py` (scene) and `lro_model.py` (the spacecraft). Explainer layer: `explain.py` with `lro-explain.json`. Example with its line: `lro-example.json` through `make_video.py`.
- Frames are rendered at 1.5 times delivery size and scaled down in `comp_real.py` (`OUTW=1080`), with no grain (`GRAIN=0`) and little softness (`SOFT=0.3`).

**Measured or published**
- Terrain: NASA LOLA elevation, 40 m grid under and ahead of the spacecraft, 80 m grid to the horizon.
- Sun and Earth: JPL DE421 for 16 October 2026 00:00 UTC, chosen so the Sun lights the pole from the side and Earth is above the Moon's edge as seen from 50 km up. Earth's clouds: NASA GIBS, the same day.
- Spacecraft: NASA's "Lunar Reconnaissance Orbiter (A)" model for the shapes. Its solar array, antenna boom and dish ship as loose parts; they are placed where NASA's assembled model (B) has them. It flies as the real one does: instruments to the Moon, array to the Sun, dish to Earth, 50 km up at 1.66 km/s.
- Place names: Shackleton crater (89.67°S, 129.78°E) and the pole, drawn where the terrain puts them in each frame.
- Source card: the paper the app lists for this fact, "Illumination conditions of the lunar polar regions using LOLA topography" (Mazarico et al., Icarus; the app's record gives 2010).

**Modelled by us**
- Where on its orbit the spacecraft is at that moment (no tracking data used).
- Every surface finish: blanket foil, paint, bare metal. The model ships with flat colours only.
- The solar cells. The model draws them as thousands of small triangles with gaps, which reads as a lattice close up; they are replaced by one panel face with a rectangular cell pattern of ours.
- The camera. No spacecraft flies beside the orbiter.

**Known limits**
- The close frames take up to 14 minutes each on one machine, so 84 frames took 74 minutes on 17 machines.
- Nothing on the spacecraft moves in the shot; in 3.5 s nothing on the real one would.
- Black sky fills about a third of the frame; Earth above the Moon's edge needs that much sky.

## Moon base video, restart (Nov 22, 2026)

The plan is `moonbase-v3.json`: 8 shots, 23.4 s, every shot made 3D, with a graphics layer over five of them.

- Shots come from `night_video.py` (SHOT 3, 7, 2, 6, 5), `pole_light.py` (the sunlight sweep) and `lro_pass.py` (the orbiter; with `NOCRAFT=1` a free camera gliding toward Shackleton crater).
- Graphics are drawn by `explain.py` from the specs in `specs/`: a running counter (`s1`, `s2`), a temperature (`s3`), place names with the source paper (`s5`), and the year strip (`s6`). `label_offset` in a spec is the shot frame a trimmed clip starts on, so names stay on their places.
- The year strip is `summit-sunlight-2026.json`: for each hour of 2026, the share of the Sun's disc above the horizon at the Connecting Ridge summit, computed from NASA LOLA terrain and the JPL ephemeris. It is our calculation, shown with its method named.
- `make_video.py` joins the shots, places the narration, writes subtitles and the score, and sets loudness.
- Measured or published: terrain, Sun and Earth positions, Earth's clouds for the day, the orbiter's shape, the habitat's and astronaut's shapes (NASA models). Modelled: all surface finishes, the lamps, where things stand, every camera. In night shots Earth is held back to what an eye would see; at the exposure that shows stars it would be a white disc.

## Moon base video, second restart: new places and scales (Nov 22, 2026)

The plan is `moonbase-v4.json`. The owner's verdict on the first restart was "the same Moon, zoomed in or zoomed out", so five of the eight shots are new kinds of picture.

- `moon_globe.py` renders the Moon from space. Four views (`VIEW`): 1 night sweeping across the far side with Earth over the dark edge; 2 Earth turning above the south pole through a long lens; 3 the south polar cap from above, sunlight circling it; 4 the night side lit by Earth alone, with stars and the thin sunlit edge.
  - Measured or published: the Moon's colour (NASA SVS CGI Moon Kit, the LRO camera's mosaic) and relief (LOLA, 16 samples per degree; LOLA's 80 m polar grid inside 9° of the south pole); the Sun, Earth and Earth's turn at each frame's moment (JPL DE421); Earth's clouds on the day (NASA GIBS); the stars (NASA SVS Deep Star Maps 2020).
  - Modelled: the camera's place and exposure; the thin blue edge of Earth's air. The Moon is shaded as its dust scatters light (Lommel-Seeliger), which is why it does not darken toward the edge like a ball.
  - Not shown, on purpose: stars beside sunlit ground (an exposure for sunlit ground cannot record them). View 4 is a long exposure, so they appear there, at the same strength as in the surface night shots.
- `earth_day.py` makes the day's picture of Earth for close views: the two VIIRS satellites' pictures joined (the darker of the two at each place drops the sea glint under each track; one fills the other's gaps), and the cap around a sunlit pole, which has no picture, filled with the ice next to it.
- `night_video.py` SHOT 8 is the finale: a person on the summit of the Connecting Ridge on 7 September 2026, 00:00 UTC (01:00 UTC+1), seen through a 412 mm lens from 100 m down the south slope, 0.5 m above the ground. Earth stood 3.6° above the horizon there at that moment, so it sits behind the person's head and shoulders. The place was found by searching the real terrain for a spot where that line of sight is clear and the horizon lies under Earth.
  - Modelled: the person (NASA's Z2 suit model), where they stand, the stones and bootprints, the camera.
- Tried and dropped: night falling on the summit seen from the ground toward the Sun (SHOT 9). With the Sun under 1° up, ground facing the camera is almost unlit; the frame was black with a white dot at any exposure.

## Action shots: a space film (Nov 22-23, 2026)

The owner's direction after the second restart: made 3D of the real place, showing events. These shots come from the rover scene (`base_scene.py` with `base_props.py`), on the ridge's west slope on 6 September 2026.

- `RIDE=1` makes the camera travel with the near rover (`RIDE_F` metres ahead, `RIDE_S` to its left, `RIDE_H` up; `LOOK_F`, `LOOK_H` where it looks). `ROVER_V` is the speed; 2.8 m/s is the rover's published top speed. `CONVOY` puts the second rover that many metres behind the first, with its own dust. `FSTOP` gives the lens an aperture.
- Dust: `DUST` grains per rover, `DUSTR` their size, `DUST_TH0`/`DUST_TH1` how far round the wheel they can leave it, `DUST_ALB` how bright they are. Each grain leaves the rim at the rim's speed and then only gravity acts.
- `LANDER=1` adds a tall crew lander descending at `LND_U`, `LND_V` (modelled from NASA's published pictures of the Artemis lander; approximate). `SPRAY` is the number of soil grains its blast drives off.
- `DIG=1` turns the digging robot's drums and sheds soil (not good enough to use yet).
- The plan for the two-shot opening is `moonbase-v5-opening.json`.

## Source first: NASA's own footage and renderings (Nov 23, 2026)

After the owner scrapped hand-built 3D. The method and the open choice are in `docs/shorts/DECISION.md`.

- `moonbase-v6-nasa.json` is the plan of the proof reel. Its pictures are fetched from nasa.gov and images.nasa.gov, not stored here.
- `still_move.py` makes a slow camera move over a large still, resampled from the full picture for every frame.
- `ai_pass.py` with `ai-request.json` (workflow `shorts-lab-ai.yml`) sends a public picture as the first frame to an open video model's free demo. It needs the repository secret `HF_TOKEN` for more than a guest's allowance.
- 30 fps footage is played at 24 fps (every frame shown once, 20% slower) so nothing judders.

## Moon base reel, option B (Nov 23, 2026)

- Plan: `moonbase-v7.json`. Seven shots are 9:16 windows of NASA's 3840×2160 animation; the eighth is AI-moved (`ai-request.json`, kind `ltx23`).
- A window is cut with ffmpeg: `crop=1215:2160:X:0,scale=1080:1920` (full height, scaled down) or `crop=1080:1920:X:Y` (1:1), then `setpts=N/24/TB` so each source frame is shown once at 24 frames a second.
- Before a shot is used, its frames are compared one to the next: a frame that hardly differs from the one before while its neighbours move four times as much is a repeat and is dropped.
- NASA's videos carry a small "Animation" tag at the bottom left and sometimes a drawn route line; the window is placed to leave them out.

## Moon base reel, one night in one place (Nov 23, 2026)

The owner's format after the option B reel: one base, one event (the Sun leaves, the lamps come on, the Sun returns), with real sound.

- Plan: `moonbase-v8.json`. Five shots; the wide view of the base opens the reel and comes back.
- `night_fall.py SOURCE.mp4 SPEC.json OUT.mp4 [frames to write as stills]` lays a travelling shadow, the night and lamps over a sunlit moving shot. `specs/night_take1.json` is the fall, `specs/night_take2.json` the return (the same camera move backwards). In a spec: `window` is the 1080×1920 cut of the source; `vp` the point on the horizon the shadow edge turns about; `edge_deg` the edge's angle over time; `deep` how dark the night gets; `lamps` are points picked on real objects in frame `ref_frame`. It also writes `OUT_lamps.json`, the time each lamp switches, for the sound.
- `sfx.py` makes the sound effects from arithmetic: radio tones, helmet breathing, a suit hum, relay sounds, thumps. No recordings. The plan lists them under `sound`.
- `make_video.py` now also reads `sound`, `music_env` (the score's level over time), `score_cuts` (where the chords change) and `subs.halo` (a soft dark glow behind the subtitles).
- The source shot is `https://www.nasa.gov/wp-content/uploads/2026/05/moon-base-v-1-1-5-22-26.mp4`; the close shots are from `Moon_Base_Update-Oct-Lunar_Rovers` on images.nasa.gov (18.6 s and 26.25 s in).

## Moon base reel, "fourteen days of night" (Nov 23, 2026, night)

After the owner's verdict on the one-place reel: more different pictures, better continuity, the new wording, film-style sound.

- Plan: `moonbase-v9.json`. Nine shots. Four are different 1080×1920 windows of the same NASA take (`specs/night_v9_1_sun.json`, `_2_base`, `_7_dawn`, `_8_return`).
- One shadow for all framings: `specs/base_vp_track.json` holds, for every source frame, the point the shadow edge turns about, in the source's own pixels. A spec names it with `vp_track`; write it again with `WRITE_TRACK=file python night_fall.py SOURCE SPEC OUT`.
- New in a spec: `bands` (a shadow with a front edge `lead` and a back edge `trail`, so light returns from the side the dark came from), `start`, `sky_max` (for sky lifted by lens glare), `protect` (circles never touched: the Earth), `ground_top` (a line above which nothing is shadowed).
- `sfx.py` gained `boom`, `riser`, `swell` and `floods`.
- The other NASA shots are cut with ffmpeg from the 4K originals on images.nasa.gov (the November update is 59.94 frames a second with every picture doubled: `select='not(mod(n\,2))'` first) and graded with `curves` toward the night's colour; the values are in the progress log's commit.

## Moon base reel with continuous takes and hidden joins (Nov 23-24, 2026)

After the owner's verdict on the nine-shot reel: a fuller opening, joins that do not read as cuts, far more small detail.

- Plan: `moonbase-v10.json`. Six shots; the two long ones are camera moves across one wide picture of the whole base.
- `night_fall.py` can now make a picture wider than the frame (`size`), with lamps picked in different frames (`ref` per lamp), an edge whose softness follows its distance (`edge_soft_k`), a sky threshold that varies across the picture (`sky_max` as a list), real stars (`stars`, `star_level`), blinking beacons (`blink` on a lamp) and lights that travel (`movers`: `orbiter`, `lander`, `dust`). `PART=a,b` renders output frames a to b-1, so a long take can be made by two runs side by side and joined with ffmpeg's concat.
  - A wide take needs about 5 GB of memory per run; two runs at once is the limit here.
  - Stars come from the HYG catalogue (`hyg/v3/hyg_v38.csv.gz` in github.com/astronexus/HYG-Database, CC BY-SA 4.0). The file is not kept here; point `STAR_CATALOGUE_DIR` at the folder that holds it.
- `pan_window.py WIDE.mp4 PATH.json OUT.mp4` moves a 1080×1920 frame across the wide picture at 1:1, easing in and out, with the blur a film shutter would give. The two paths used: `{"x": [[-0.4, 1340], [6.4, 0], [8, 0]]}` for take 1 and `{"x": [[0, 0], [1.9, 0], [6.2, 1630], [8, 1630]]}` for take 2.
- `seam.py PLAN.json CLIPS_DIR OUT_DIR` trims the shots and reworks the frames at each join (`joins` in the plan: `whip`, `flare` or `cut`), then writes a plan for `make_video.py`.
- `sfx.py` gained `whoosh`.
- Order of work: `night_fall.py` (twice per take with `PART`), concat, `pan_window.py`, `seam.py`, `make_video.py`, then the checks.

## Moon base reel as one unbroken take (Nov 23, 2026, late)

The owner rejected the whips and the flare: no cut and no transition effect of any kind.

- Plan: `moonbase-v11.json`, one shot. Spec: `specs/night_v11_one.json`.
- `night_fall.py` now also moves the camera itself (`path`): it works on a 3510×1920 strip of NASA's take, computes only the part in view, and writes the 1080×1920 frame directly. `"order": "pingpong"` runs the 165 source frames there and back, so the take lasts 594 frames.
- Run it once with `PREPARE=1` (decodes the strip to `FRAME_CACHE_DIR`, 3.3 GB, and follows the lamps), then three times side by side with `PART=0,198`, `PART=198,396`, `PART=396,594`, and join the three files with ffmpeg's concat. The whole take renders in about 6 minutes.
- New in a spec: `discs` (the Earth's disc: it hides the stars behind it, and its crescent is cleaned of the source's rainbow rim), `spikes` on a lamp, and movers `walker` and `rover` (lights that travel over the ground, tied to a followed lamp by `anchor`). A `lander` is now drawn as a craft (body, legs, foil band, a strobe) whose flame lights the ground as it comes down.
- `seam.py` and `pan_window.py` are kept but not used by this reel.

## Moon base reel: one take with the sky and an astronaut (Nov 24, 2026)

The owner passed the one take but found it the same view throughout, asked for the facts of the place to be checked, and for nothing to read as digital.

- Plan: `moonbase-v12.json`, one shot. Spec: `specs/night_v12_one.json`. Render as before (`PREPARE=1`, then three `PART` runs, then concat); the last third takes about 7 minutes.
- New in a spec for `night_fall.py`:
  - `sky_ext` and `path.y`: rows of sky made above the source, so the camera can tilt up off the picture. `path.sway` adds a few pixels of slow drift.
  - `stars.sky_map`: the faint stars and the Milky Way from NASA's Deep Star Maps 2020. Cut the part in view out of the map first: `python sky_cut.py SPEC.json starmap_2020_32k.exr starmap_crop.npy` (the map is 1.5 GB, from svs.gsfc.nasa.gov/4851; neither it nor the cut is kept here). Put the cut in `STAR_CATALOGUE_DIR`.
  - `earth`: the planet is followed frame by frame and redrawn with the crescent its angle from the Sun gives (`elong_deg`), in the source's own colours.
  - `edge_relief_deg` and `edge_fingers`: the shadow's edge follows the ground's relief and is drawn out along the Sun's rays (`sun_ground` is the point on the horizon under the Sun). `edge_soft_range` limits how soft the edge gets.
  - `overlay`: a foreground shot with a black sky, stood in front of the view at one place in the wide picture (`at_x`, `at_y`, `scale`), cut from its own sky and ground, darkened as a figure with the Sun behind it (`shade`, `rim`, `sun_dir`), with the view behind going out of focus (`defocus`). Its file is looked for in `OVERLAY_DIR`.
  - `finish`: grain, lens fall-off and a trace of softness over the whole frame. `defringe` tones down coloured lens fringes on hard edges.
  - A mover of type `station`; lamps with `gain` 0 and a small `size` serve as status lights.
- The astronaut clip: frames 100–175 of the November update shot (every second picture of the 59.94 fps original, since each is doubled), slowed with ffmpeg: `minterpolate=fps=48:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1,setpts=N/24/TB`.
- `sky_crop.py` is the older tool for the view from orbit; `sky_cut.py` is the one for a `night_fall.py` spec.

## Moon base reel: flowing script, people on the plain (Nov 24, 2026, second version)

The owner was happy with the take, found the script "not really fluent", and asked for more detail and more accuracy.

- Plan: `moonbase-v13.json`, 25.0 s. Spec: `specs/night_v13_one.json` (600 frames; render with `PART=0,215`, `215,430`, `430,600`).
- The narration is four passages instead of eight sentences: `tts.py` makes each passage in one piece, `align.py` times its words, and a line in the plan carries several subtitle phrases (`text` and the word numbers they start at in `split`).
- New in a spec for `night_fall.py`:
  - `sky_exposure`: how far the faint sky (star map, zodiacal light) is opened over time. Low while lamps are in frame, 1 when the camera has tilted off them.
  - `stars.zodiacal`: a lens-shaped glow along the ecliptic that brightens toward the Sun (`level` at 20° from the Sun, `slope`, `width_deg`, `flare`).
  - A mover of type `person`: a figure on foot tied to a followed lamp (`anchor`), `height` in pixels. In sunlight it has a shadow that points away from the Sun's horizon point and whose length is height / tan(`sun_elev_deg`), foreshortened as the ground is there; it takes no sunlight inside a shadow the source already has. In the dark it carries a helmet lamp.
  - A lamp with `glint`: a short flash as the edge of the sunlight crosses it. A lamp with `silent` makes no switch sound.
  - `overlay.veil`: how much of the view's glare lies over the foreground figure.
- Low spacecraft now cross at about 20 px a second: 1.63 km/s at 100 km up, seen from about 470 km, is 0.2° a second.

## Moon base reel: no flicker, the astronaut behind the rock (Nov 24, 2026, third version)

The owner saw things glitching, a picture less smooth and clear, and an astronaut who looked awkward and floaty.

- Plan: `moonbase-v14.json`. Spec: `specs/night_v14_one.json`. Render as the version before.
- Finding flicker: `flash_scan.py PICTURE.mp4` lists everything that is brighter or darker for one or two frames, with the camera's move taken out. Run it on the picture without subtitles (`<output>_work/picture.mp4`). It also lists near ground that moves against the far ground (depth, not flicker): line that part up on its own before believing it.
- What it and a look at NASA's file turned up, and the fix in `night_fall.py`:
  - In NASA's file the thin lit ridge lines break up for single frames: strongly every 32nd frame (decoded frames 27, 59, 91, 123, 155), less at 107 and 139. `repair_frames` in the spec takes the far ground of each (down to `repair_rows`, default 900 to 1050) from the frame before it, moved onto its place. The near ground is left alone: it moves up to 2.3 px a frame against the far ground, and a copied frame would make it jerk.
  - The sky layers (stars, star map, zodiacal light) were placed to whole pixels while the ground moved by fractions, so the whole sky stepped 1 px at a time. They are now placed to a fraction of a pixel, and the frame the camera sees is cut with cubic instead of linear interpolation.
  - Where the source turns back it reversed in one frame. `turn_ease` (frames) makes it slow, stop and start back: the nearest source frame is used, moved by the part of the camera's move that is missing.
  - Lamps stuttered for three frames as they struck and shimmered up to 39 times a second; the lander's flame flickered up to 23 times a second. Lamps now come up once and drift slowly; nothing we add varies faster than 2 times a second.
  - The lander's path was straight between its keys, so its speed jumped at each key (up to 3.9 px a frame in one frame). It is now rounded over a second (at most 0.8).
  - The glints of the version before are gone.
- The astronaut is no longer a strip of video laid over the view:
  - `astro_stab.py DIR/` takes NASA's camera move out of his shot, so he holds still (real frames only, no made-up ones).
  - `astro_cut.py DIR/` removes his sky and his ground and steadies the outline over five frames. It writes `astro_cut.npy`; put it in `OVERLAY_DIR`.
  - `rock_track.py FRAMES.raw W H REF X0,Y0,X1,Y1 OUT.json` follows the foreground rock through the source (`specs/rock_track.json`).
  - In the spec, `overlay` now has `cut` (the file), `anchor` (the point of the cut-out that is placed), `at` (where it stands in the wide picture), `scale`, `shade`, `show_from` and `from_t` (when he is first drawn and when his own frames start to run; they run to the end, turn softly and run back), and `rock`: `track`, `crest` (the rock's top edge in the reference frame), `tie` (how much of the rock's shift he follows), `contact` and `spill` (his light on the rock's top).
- Stars: `sky_cut.py` now also takes the 64k map (4 GB) and brings it down to the take's scale by area.
- `start` 194 puts the moments where the source turns back at 5.6 s, 12.4 s (camera on the sky) and 19.25 s (before the rock comes into view); with `turn_ease` 20 each is a soft stop.
- Final file: the plan's `crf`, `maxrate`, `tune` and `gop` go to the encoder. This reel: 18, 10M, film, a keyframe every 2 s.


## Moon base reel: the sky of a real date (Nov 24, 2026, fourth version)

The owner: fix what was listed as wrong, and add detail.

- Plan: `moonbase-v15.json`. Spec: `specs/night_v15_one.json`. Render as before.
- `earth_face.py "2039-01-08 14:00" EPHEMERIS_DIR GIBS.jpg OUT.npy [RADIUS_PX]` prints where the Sun, the Earth and the planets stand as seen from the Moon at that moment (JPL DE440, `de440s.bsp` from naif.jpl.nasa.gov, 32 MB, not kept here) and writes the face of the Earth turned to the Moon, south up, from one day of NASA GIBS imagery.
- How the date was found: every January from 2026 to 2040, the moment the Earth stands 21.5 degrees from the Sun on the side NASA's frame shows; among those, the one with the Sun near ecliptic longitude 292 degrees and the Earth nearest the ecliptic (NASA drew it level with the Sun). 8 January 2039: Earth 0.44 degrees off.
- New in a spec for `night_fall.py`:
  - `earth.offset`: where our Earth is drawn relative to where the source has it (the source's is erased). The sky layers, `discs` and `protect` now move with the Earth's own track, steadied, because the sky is infinitely far; they used to move with the far ridge and slid up to 25 px against the Earth.
  - `stars.planets`: `name`, `dlon` (degrees of longitude from the Sun), `lat`, `mag`, `ci` (colour).
  - `stars.sky_map.f10`: the map's sum for a 10th-magnitude star (0.0399 for the 64k map at 105 px a degree, measured on 2,070 catalogue stars; the map is a true flux scale, slope -0.388 against -0.400). It puts the map in S10 units.
  - `stars.sky_map.zodiacal`: `s10` / sin(angle from the Sun) ^ `power` on the ecliptic (393 and 2.45: Clementine's fit, eq. 5 of arXiv astro-ph/0204111, valid 3 to 30 degrees), `flatten` for the fall-off away from the ecliptic (0.45, our assumption). It is added to the map before the exposure curve. `stars.zodiacal` (a level picked by eye) is no longer used.
  - `stars.sky_map.earth_night`: `file` from `earth_face.py`, `at`, `s10_white` (what a white surface facing the Moon sends back: 70,000 S10 by our arithmetic).
  - `stars.sky_map.shoulder`: the exposure curve presses bright parts together.
  - `overlay.lamp_pool`: where the figure's own helmet lamps fall (`at`, `radius`, `level`); the rest of it takes `shade`.
- `flash_scan.py` now moves each frame's neighbours onto it place by place (optical flow), so depth motion and travelling things are no longer counted and all frames can be scanned. With a second argument it writes strips of the strongest finds.
- A lander now fires short attitude jets (a quarter of a second, about every 1.8 s).

## Moon base reel: a real place, a fuller base (Nov 24, 2026, fifth version)

The owner: fix what is wrong, and far more detail.

- Plan: `moonbase-v16.json`. Spec: `specs/night_v16_one.json`. Render as before.
- `moon_site.py KERNEL_DIR "2039-01-08 14:00" 4.5 4.1 21.5` prints how high the Sun and the Earth stand at the Moon's south pole and at a few named places at that moment, and searches the south polar region for the place where they stand as given. For this take: about 85°S, 17–21°W.
- `earth_face.py` takes a sixth argument, the night-lights map (GIBS layer `VIIRS_Black_Marble`, 2880×1440), and also writes `OUT_day.npy` (the face's colours) and `OUT_lights.npy` (city lights where it is night there).
- New in a spec for `night_fall.py`:
  - `earth.face_day`: the sunlit crescent takes the colours of the face turned to the Moon, reddened along the day-night line.
  - `stars.sky_map.earth_night.lights`, `lights_s10`: city lights on the night side.
  - a planet in `stars.planets` is held just under white, so its colour shows (`ci` 1.8 for Mars).
  - `night_detail`: how much of the source's fine relief is added back on dark ground (0.5).
  - `finish.sharpen` and `finish.halation`.
- New in the spec itself: 10 work lights on module legs, joints and ends (marked `silent`, so the sound does not count them), 8 more `person` movers, a second `rover` light, 2 more `orbiter`s, `stars.mag_limit` 8.6.


## Moon base reel: the source cleaned, its own detail drawn out (Nov 24, 2026, sixth version)

The owner: take your time for this one.

- Plan: `moonbase-v17.json`. Spec: `specs/night_v17_one.json`.
- `fuse_frames.py IN.raw 3510 1920 OUT.raw 3` rebuilds every decoded source frame from itself and its three neighbours on each side, wherever they agree. Run it on the cache `night_fall.py` made, write to a second folder under the same file name, and point `FRAME_CACHE_DIR` at that folder. `CHECK=85` does one frame and prints what it gained. `PART=a,b` lets several runs share the work. For this take: 89–97% of each frame agreed with its neighbours, and the noise on the ground fell from 1.43 to 0.92 levels.
- `astro_4k.py DIR/ NASA_4K.mp4 0.4 OUT.npy` makes the astronaut's cut straight from the 4K frames at the size it is shown. It repeats the hold-still move of `astro_stab.py` and uses the outline of `astro_cut.py`, and prints a check on each. The spec then has `overlay.scale` 1.0.
- `zodi_shape.py specs/zodi_shape.json` works out how the zodiacal light falls off away from the ecliptic, from the dust model in the Clementine paper (its eqs. 6–8 and Table II, with Hong's 1985 scattering law), and prints how much the choice of scattering law matters.
- `detail_meter.py OLD.mp4 NEW.mp4 1.0,8.0,16.5 700:1900` prints the fine detail two videos carry at three sizes, and the noise.
- New in a spec for `night_fall.py`:
  - `clarity`: `bands` ([size in px, strength] each), `limit` (levels), `far` (less on the far hillside). Brightness only. Use it only with fused frames.
  - `chroma_soft`: colour on the ground is kept only as it varies over this many pixels and more; it removes the source's yellow and purple lens rims.
  - `stars.sky_map.zodiacal.shape`: the table from `zodi_shape.py`, in place of `flatten`.
  - `hollows`: `max_px`, `lift`, `object_lift`. At night the ground's small hollows are raised to the ground round them; the shadows of objects are raised less; both take the night ground's colour.
  - on a `lander`: `lit_part` (how much of its width the Sun lights) and `flame_light` (the engine's light on its underside).
  - on a `person`: `work`: [seconds per round, offset, degrees]. They bend to the ground, stay down, and straighten.
  - `overlay.clarity`: the same step for the cut-out figure.
  - `crest_edge`: `ragged`, `soft`. Where the high ground's light ends is an edge that follows the ground and is a few pixels soft, not a level line.
  - a lamp marked `yard` is an ordinary lamp with a wide `reach`; the mark is only a label.
- Render:

  ```
  export STAR_CATALOGUE_DIR=<catalogues> FRAME_CACHE_DIR=<fused cache> OVERLAY_DIR=<folder with astro_cut4k.npy>
  PREPARE=1 python night_fall.py nasa_moonbase.mp4 specs/night_v17_one.json out.mp4
  PART=0,215 python night_fall.py nasa_moonbase.mp4 specs/night_v17_one.json one_a.mp4     (and 215,430 and 430,600 beside it)
  ```

## Moon base reel: colours put back together, a steadier camera, nothing left wrong that can be fixed here (Nov 24, 2026, seventh version)

The owner: take up to six hours, fix what is wrong, maximise the detail, miss nothing.

- Plan: `moonbase-v18.json`. Spec: `specs/night_v18_one.json`.
- `colour_shift.py IN.raw 3510 1920 OUT.raw` measures how far NASA's lens effect has moved red and blue against green (on the frames' own hard edges, to a fraction of a pixel), fits it as a smooth shift away from a middle point, and moves the two colours back. Run it on the cache `fuse_frames.py` wrote, into a third folder under the same file name. `MEASURE=1` only measures. For this take: red up to 2.2 px and blue up to 3.8 px off at the left edge of the strip before; 0.05 and 0.5 px after.
- New in a spec for `night_fall.py`:
  - `path.ramp`, `path.ramp_y`: seconds a camera move takes to get up to speed and to slow down; in between its speed is steady. The same travel then has a much lower top speed than an S-curve gives, so the shutter blurs less.
  - `dark_clean`: `size`, `below`, `faint`. Thin faint lines in the dark (the source's lens streaks) are taken out; anything clearly brighter is left.
  - `night_rims`: `limit`, `size`. In the night picture, thin edges that the Sun lit are held back, so modules have no pale outline with the Sun gone.
  - `night_detail_limit`: the night's extra ground detail is brightness only and held under this many levels.
  - on a `person`: `work` takes a fourth number, how far they go down on their knees (0 to 1); `trail`: how much darker the ground is left where they have walked. A figure's shadow follows its pose.
  - the small figures' proportions are measured on NASA photograph AS11-40-5903.
- `zodi_shape.py` now uses the numbers of Hong's own Table I (0.698, −0.203, −0.813; weights 0.665, 0.330, 0.005).
- `astro_4k.py ... 0.48 ...`: the astronaut is shown a fifth larger than before, still brought down from 4K in one step.
  - `skyline`: the top of the ground across the wide picture, traced by hand on the reference frame ([x, y] points); `skyline_near_x`: left of this the ground is a near sunlit hill that finds its own edge. Nothing below the line is ever treated as sky.
  - `sky_clean`: the source's lens glare is read from its own sky (per frame, by distance from the Sun; cached beside the frame cache) and taken off sky and ground. `core`: the glow kept round the Sun is half at this many pixels; `disc`: the Sun's own radius in pixels; `floor`: the black of the sky; `neutral`, `dark_neutral`: what is left of the glow, and dark ground, are made grey; `flank`: the unlit slope between skyline and plain is made even at `level`.
  - `shadow_rgb`: the night's level against sunlit ground. Now 0.236, 0.235, 0.246: grey, at the upper end of what the source's own broad shadows measure with the glare off (0.21 to 0.24) (it was 0.217, 0.228, 0.296; the blue was the glare).
  - `edge_fingers.peaked`, `.octaves`: the skyline that casts the travelling shadow is made of peaks, so its edge has pointed fingers; `edge_wander`, `edge_relief_soft`: the edge's slow wander and its response to the ground's relief are turned down and smoothed.
  - `hollows.object_lift`, `.object_soft`: how far the Sun's shadows of objects are lifted out of the night, and how softly. Lamp light falls on ground without them, except under a lamp marked `yard`.
  - `foreground_soft`: the dark rock and slope that reach the bottom of the picture, with their lit rims, are thrown a little out of focus.
  - `overlay.sun_rim` (the edges turned to the Sun catch it), `.visor` (held dark; lamps only on the helmet's rim round it), `.lamp_max_px`, `.edge_in`, `.rock.in_sun` (the rock by the camera keeps its sunlight when the plain is in shadow), `.rock.outline`, `.rock.shadow`.
  - points of light in orbit follow `star_level`: none while the exposure is for sunlit ground.
- `make_video.py`: a plan may carry `x264` (extra encoder settings; `aq-mode=3` gives dark areas more of the bits).
- Two independent reviews were run on stills taken once a second (and, the second time, on strips of four consecutive frames): a fresh reviewer told only to find faults. Their lists and what was done about each are in `docs/shorts/PROGRESS.md`.
- Order of work on the source: decode (by `night_fall.py`) → `fuse_frames.py` → `colour_shift.py` → `PREPARE=1` → render.

Added after the third independent review (seventh version, render 6):
- `sun_drop`: key track, pixels the Sun stands below the source's place through the take. Set, the whole sky above the skyline is redrawn from the measured glow centred on the Sun's new place (NASA's own Sun is painted out), and the disc with its bloom is drawn there on sky only, so the ridge hides whatever of it is below the crest.
- `highlight` {`from`, `slope`}: sunlit ground above `from` rises at `slope` of its rate (brightness only).
- `sky_clean.flank.night`: the far slope's level at night as a part of the plain's; the flank's treatment fades in over 300 px from `skyline_near_x`.
- Lamps: `tall` (pool height as a part of its reach, default 0.34); `keep_shadows` (the pool shows the source's shadows; none uses it now). `yard` alone no longer keeps them.
- `earth.bloom`: glow round the bright parts of the Earth's face in the star exposure, times `star_level`.
- `trail_fingers`: how much of the fingers the edge by which light comes back carries (1 = as the leading edge).
- `foreground_soft.rows_from` / `rows_over` / `rows_amount`: the last rows of the picture out of focus as well.

Added after the fourth independent review (renders 7 and 8):
- `sun_height` (replaces `sun_drop`): key track, the height of the Sun's centre above the skyline where it stands, in pixels of each frame (0 = half hidden). A drop given in the reference frame's pixels missed the crest by up to 25 px, because the source frame and the traced skyline do not sit exactly as the reference frame has them. The glow and the bloom follow the part of the disc in view, to the power 0.45 (the picture's levels follow light to about that power); with the Sun behind the ridge there is none (no air on the Moon). The bloom is laid over the finished picture, ground included, so it spills over the crest.
- `sun_spikes` [length px, level]: the four-pointed lens star the lamps have, on the Sun.
- `front` {`sun_x`, `scale`, `power`, `soft`}: the ridge's shadow lies from the ridge's foot (`ground_top`) toward the camera. Each bit of ground is placed by its distance from the foot along the line to the point on the horizon under the Sun: on flat ground seen from a height, distance goes as 1 / (rows below the horizon). With it, `bands` uses one track (`front_t`) that rises at dusk and falls at dawn (light comes back nearest the camera first and at the ridge's foot last). Without it, the old model: an edge turning round the vanishing point (`shadow_coord`).
- `shadow_fill` {`flat`, `texture_px`, `offsets`}: at night, the Sun's old shadows on the ground (dark patches wider than tall that do not reach the bottom) are given the ground's own fine texture, taken from sunlit ground on the same rows a little to the side, at the level of the night's ground round them. NASA's shadows are already about as dark as the night's ground, so they had stood out as smooth patches with a dark rim.
- `night_rims.limit` now 45: the limiter acts on strong rims only. At 12 it held back the ground's own relief too, and cost 37% of the night's fine detail.
- `highlight`: taken off the broad brightness only (blur `base_px`), the same amount from all three colours; the fine detail keeps its strength.
- `drawn_shadow_scale` (1): drawn figures' shadows as a part of what the Sun shown gives (earlier versions shortened them to match NASA's shadows read wrongly as 2 to 4 heights on the ground).
- `lift_soft` / `lift_bilateral`: how an old shadow is smoothed before it is raised (tested; no measurable change, not used).
- `old_shadow_rel`: also judge an old shadow against the lit ground close by. Tested and not used: it takes the modules' grey hulls for shadows.
- `astro_matte.py IN.npy OUT.npy [BAND]`: the astronaut's outline found again on the 4K pixels (GrabCut in a band of BAND px round the old outline, median of three frames). It follows the shaded top of the right shoulder, which the old one cut into, and leaves out the strip of dark sky beside the backpack. `overlay.cut` is now `astro_cut4k_m.npy`.

Added after the fifth independent review (render 9):
- `bands: [{"lead": "@sun"}]` with `front.crest_px`: one track, `sun_height`, drives both the Sun and the ridge's shadow. A bit of ground falls into the shadow when the Sun, seen from it, drops to the crest; with u = its distance from the ridge's foot over its distance from the camera, that is when the Sun's height above the crest (seen from the camera) is `crest_px` / u. So the Sun stands on the crest exactly when the shadow reaches the camera.
- `front.ridge_face_first` and `front.rim_px`: the ridge's own face, between its foot and its crest, loses the Sun first and gets it back last; only its top `rim_px` pixels (the crest line) keep the light as long as the high ground does. Without it the face stayed sunlit while the plain at its foot was in its shadow, and the line between them was straight.
- `shadow_fill.zones` [{`poly`, `rel`}]: places traced on the reference frame where the Sun's old shadows are lighter than the "dark" test catches; there a pixel darker than `rel` of the sunlit ground close by counts as shadow. Each zone moves with the tracked lamp nearest to it. The fill shifts its borrowed texture without wrapping round (a wrap had left a seam).
- `deep` at night 0.65: the night's ground is darker than NASA's daytime shadows, because in a daytime shadow most of the fill light comes off the sunlit plain round it, and at night there is none.
- `sun_spikes` are drawn only while the Sun's image falls on the picture.

Added after the sixth independent review (render 10):
- `front.h_foot`: the crest stands well behind the ridge's foot. The shadow reaches the foot only once the Sun is `h_foot` px above the crest (seen from the camera), and the whole plain to the camera when it reaches the crest. With the camera at 0 and the crest at 1 along the line of sight, the edge lies at h / (crest_px + h) and the foot at h_foot / (crest_px + h_foot). Without it the crest stood right over the foot, and a Sun at NASA's height would already have shadowed a band at the foot, which NASA's picture does not show.
- The `ground_top` rule ("nothing above this line is ground the shadow can reach") is off when `front.ridge_face_first` is on: it had kept a hill at the ridge's foot sunlit through the dusk.
- `shadow_fill.reach_px`: how far past an old shadow's dark core the fill goes (its soft edge is wider; 6). The night's relief is not drawn along the edges of old shadows either.
- `overlay.rock.crest_rough`: fixed small bumps (px) along the rock's traced top line, which was straight between its points.
- The astronaut's rim light is not drawn where the picture's edge cuts him.

Added after the seventh independent review (render 11):
- Nothing above the traced skyline is ground. The source's glare round its own Sun had been taken for ground (it is bright, so not "sky"), and was darkened at night; the old way round it was a `protect` circle of 430 px round the source's Sun, which, once the Sun sinks to the crest, kept a disc of the ridge's face out of the shadow. The circle is now 90 px.
- `front.h_face`: the ridge's face goes dark as the Sun sinks from `h_face` to `h_foot` above the crest, so before the ground at its foot, and gets the light back after it.
- More `shadow_fill.zones` (the rover's shadow and the masts' shadows on the plain right of the base).

Added after the eighth independent review (render 12):
- The ridge's face (between its foot, `ground_top`, and the traced skyline): each point at height q on it (0 foot, 1 crest) loses the Sun when the Sun sinks below `front.h_foot` x (1 - q) ^ `front.face_power` above the crest, so the shadow climbs the face from the foot to the crest at dusk and comes back down at dawn, meeting the plain's edge at the foot. It replaces `h_face` and the face's one-block darkening.
- `front.rel_grow`: in the front model the lobes of the shadow's edge and the ground's relief grow with the distance from the ridge's foot (full at 60 of the 200 scale): a peak lengthens the shadow by a part of its length, and at the foot by nothing. Fixed in size, they had left a dark band at the foot with a straight top.
- The wide glow drawn round the Sun (the measured lens glare) is laid over the ground in front of the Sun as well.
- `overlay.shade` at the night's level (0.236, 0.235, 0.246): a white suit in shade is as bright, for its whiteness, as the ground in shade.

Added after the ninth independent review (render 13):
- The Sun's bright bloom close round its disc is drawn on the sky only (with `sky_clean.bloom_spill`, 0.2, of it over the ridge), so the crest cuts it flat with the disc; the wide glare and the measured glow go over everything. Laid over the ridge in full, the bloom had looked like a whole disc in front of the crest.
- Landers: `core` (the engine's glowing point and its glow, 0.5) and `jets` (false: the side-jet puffs 21 px off the body read as a ghost of the craft).
- `edge_fingers.deg` 28 with `front.rel_grow` 30: the lobes of the shadow's edge are as long as a peak's shadow should make them.
- `overlay.rock.shadow` 0.7: the astronaut's shadow on the sunlit rock top in front of him.
- Plan `sub_bridge` (seconds) in `make_video.py`: a caption that follows the last within that time takes over exactly where it ends. A gap of a fraction of a frame had shown as a one-frame blink.

Added after the tenth independent review (render 14):
- The second dusk's `sun_height` keys follow the first dusk's (the same Sun heights the same time after the light is full), so the shadow crosses the plain at the same pace both times.
- `edge_fingers.deg` 22 and `peaked` 0.7: lobes between the ninth review's "ruler-straight" and the tenth's "detached wedges".
- The astronaut's rim light is scaled by the part of the Sun above the crest.
- Plan `grade` (at encode), a curve per colour: `lutrgb=g='clip(val-1.0*exp(-pow((val-35)/25,2))-1.6*exp(-pow(val/7,2)),0,255)':b='clip(val+6*exp(-pow((val-200)/35,2)),0,255)'`. A little more blue only around the sunlit ground's level (cream, 190 against 203, to warm grey, 193 against 202) and a little less green only in deep shade and black. A first try with `colorbalance` (blue in all highlights) turned the dark shots faintly violet and pushed the Sun's near-white glow into clipping.

Eighth version (spec `specs/night_v19_one.json`, plan `moonbase-v19.json`): the owner chose the old blue night and asked for accurate shadows.
- `shadow_rgb` back to 0.217, 0.228, 0.296 (blue) and `deep` to the sixth version's (0.94 at night).
- `edge_fingers.sun_ground` on the horizon (3090, 681). Shadows on flat ground point away from the point on the horizon under the Sun; at y 880 (200 px below the horizon) the drawn figures' shadows and the lobes ran about 6 degrees off NASA's own. NASA's thin shadows were measured to meet the horizon at x 3000 to 3300.
- `long_shadows` {`source_elev_deg`, `max_factor`, `objects`, `casters`, `caster_rel`, `rel`, `min_px`, `max_px`, `max_angle`, `skip_bottom`, `directions`, `strength`}: NASA's shadows fit its own Sun, 4.6 degrees up (`source_elev_deg`). Checked with the construction for a thin upright thing: the shadow's tip is where the line from the Sun through its top meets the line from the point on the horizon under the Sun through its foot. Each mast's panel shadow lies where that puts it, to a few pixels; so do the modules' and the rock's. (An earlier version read the shadows' length on the picture, 2 to 4 times the height, as if it were their length on the ground, and took the source's Sun for 18 degrees up: the ground is seen foreshortened, so that was wrong, and it drew shadows 4 to 5 times too long.) As the Sun shown sinks, every shadow on the ground is f = tan(4.6°) / tan(elevation) as long, measured from its foot: 1 at the start, 1.7 with the Sun 2.7° up, 2.6 with its centre on the crest. On flat ground, depth along a ray from the point on the horizon under the Sun goes as 1 / (distance from it), so a point of a shadow at r from a foot at rF moves to 1 / (1/rF - f (1/rF - 1/r)); each shadow's own pattern is redrawn that way, at its typical dark (the deeper dark right under a module stays where it is). Shadows are found once on the reference frame (darker than `rel` of the sunlit ground close by, on the plain, drawn out along the ray) and carried to every frame by the ground's homography from the tracked lamps. `objects`: outlines traced on the reference frame round the modules, vehicles, the lander and the plain's rock. Their shaded sides face the camera and are as dark as a shadow; read as shadows, they were stretched across the modules as straight stripes. Nothing inside is read as a shadow or darkened. `casters`: [foot x, foot y, top y, half width] of thin things whose shadow lies apart from them (the masts' panels): the shadow is found in a band along its ray (fainter, `caster_rel`) and measured from the foot, so it moves away from the mast as it lengthens, and its old place is lifted to the lit ground. The tip is softer by the share a lower Sun's penumbra adds (0.53° / elevation − 0.53° / 4.6°, of the length). The result is a factor on the picture, in the source's own neutral shadow tone.
- `sun_elev(t)`: the Sun's height above the horizon from `sun_height` and `front.crest_px` (px per degree 105); used by the long shadows and the drawn figures' shadows (`drawn_shadow_scale` back to 1).
- `drawn_shadow_level` (0.25): the drawn figures' shadows in the source's neutral shadow tone (a part of the lit ground), not the night's colour. Their length is exact: along the ray, the tip is at nu / (1 - h cot(e) / f) from the point under the Sun (f = 105 px per degree in radians); the tip's penumbra is 0.53° / elevation of the length; the box they are drawn in holds the whole shadow.
- `overlay.cast_shadow` {`w`, `level`, `soft`, `lit_from`}: the astronaut's shadow on the rock top in front of him. A point there is in it when the line from it toward the Sun meets him; on the picture that line runs from the point to the Sun's place, and reaches his depth a part `w` of the way (0.12 to 0.45: he stands a step or two beyond the rock top). The rock's sunlit facets in it take the level of the shaded rock round them, by `level` x the square root of the part of the Sun shown. `overlay.rock.by_disc`: the rock top keeps as much sunlight as there is Sun above the crest (in light). `overlay.fill_floor` (0.4): his side turned to us is lit by the sunlit plain in front of him; it dims with the share of that plain still in sunlight, down to this floor (the Earth, the rock, his lamps).
- `front.disc_penumbra`: the ridge's shadow (plain and face) is how much of the Sun's disc the crest hides as seen from each bit of ground (`disc_hidden`), not a fixed soft edge. Near the ridge, with the Sun high, the edge is sharp; as the Sun comes within its own width of the crest the whole plain is in the penumbra. The hidden share is mixed as light (`in_light`): half the Sun leaves the ground at about three quarters of its lit level, so the light holds until the last sliver.
