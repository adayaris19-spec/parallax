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

**Known limits**
- The suit model has one pose, so the astronauts stand still. The excavator is parked.
- No motion blur.
- The soil roughness was set by eye and still has to be checked against published measurements.
