# Watch video renderer

Turns each Watch video (a row in `reels`) into one continuous MP4, the same way the Instagram Reels
were made: footage with slow camera motion and crossfades, text baked in (laid out clear of the app's
header, buttons and Dive in link), and an original score timed to the joins. Free: it runs locally
with Playwright and ffmpeg, and stores files in R2 through the reels function's admin `upload` action.

    export PARALLAX_ANON_FILE=/path/to/anon PARALLAX_ADMIN_FILE=/path/to/admin_token
    python3 -m http.server 8765 &        # from the repo root: the animation recorder uses the site
    python3 render.py all                # every reel without a current render
    python3 render.py 390 391            # specific reels

Needs: Python 3 with numpy and scipy, Node with Playwright (Chromium), ffmpeg.
Each render records `{url, poster, dur, starts, v}` in `reels.render`; the app plays it when present
and falls back to the live scene player otherwise. Bump `VERSION` to re-render everything.
New videos made by the reels job (when it runs) need rendering here; until then they use the live player.
