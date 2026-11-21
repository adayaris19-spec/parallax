# Shorts lab: free "real data" render tests (Nov 21, 2026)

Test scripts from the feasibility check in `docs/shorts/PROGRESS.md`. They are experiments, not the production renderer.

Each one builds a 1080×1920 picture in Blender (the free `bpy` Python package, CPU only) from public scientific data, so the detail in the frame is measured, not invented.

| Script | Picture | Data (all free to use) |
|---|---|---|
| `moon2.py`, `cam2.py`, `sky_crop.py`, `comp2.py` | Moon's south pole from 100 km, Earth above | NASA LOLA elevation `LDEM_80S_40M` and `_80M` (PDS); NASA SVS Deep Star Maps 2020, 64k; a DSCOVR EPIC Earth image |
| `pdb_parse.py`, `hiv.py` | HIV-1 capsid, every heavy atom | Protein Data Bank entry 3J3Q (CC0), Zhao et al., Nature 2013 |
| `gibs_fetch.py`, `earth.py`, `comp_earth.py` | Queensland coast and southern Great Barrier Reef from 480 km | NASA GIBS true colour, VIIRS on NOAA-20, 2026-08-11 |

Setup: `python3 -m venv venv && venv/bin/pip install bpy numpy opencv-python-headless scipy OpenEXR`. Data files are downloaded separately and passed as paths; none are stored in this repository.

What is modelled rather than measured: lunar craters smaller than the 40 m data, the blue fill light in lunar shadows, the atmosphere glow on Earth, the capsid's colours and the out-of-focus specks behind it.
