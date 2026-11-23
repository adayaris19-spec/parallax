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

