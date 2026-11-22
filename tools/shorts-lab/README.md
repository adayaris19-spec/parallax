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

