# Parallax short-form video: everything so far (Oct 25 – Nov 21, 2026)

This is the record of the Watch videos work: what was built, what the owner said about each version, what is settled, what failed and why, and where everything is. It is the starting context for the dedicated short-form video chat (see `MASTER_PROMPT.md`). Times are UTC+1.

## 1. Where things stand (Nov 21)

- **Live in the app:** 61 Watch videos, all in the older "v2" style:
  - 26 intro, 11 setback, 10 news, 7 breakthrough, 6 promise, 1 people.
  - Each is cut into ~10-second parts, with text over stock footage and an original score.
  - The owner finds them empty, repetitive and dated.
- **Nothing newer is live.** Every later version exists only as samples, and the rollout was stopped on purpose until the style is right.
- **News videos are paused.** `news_make` returns `{paused: true}` unless the function secret `SHORTS_ON=1` is set.
- **Where the newest work lives:** the branch `claude/epic-noether-i0tmfw` (not merged to `main`), plus the deployed `reels` edge function, which was deployed from that branch.
- **Best result so far:** the latest sample (`ref-sample-v4-nasa-4k`) fixed the sharpness by using NASA's 4K footage. The owner's two remaining complaints:
  - **What's in the footage doesn't show the story.** A study about a laser melting fake Moon soil showed only the Moon.
  - **The overall standard:** the bar is NASA and SpaceX imagery.
- **Budget:** $100 of AI credit since Nov 8, with $86.47 left on Nov 21 and a refresh on Dec 8. Video work is a small part of that (section 8).

## 2. Where videos live in the product

- **Watch tab:** a vertical feed of short videos per goal, unseen first (localStorage `px.wseen`), ending with a caught-up card. News videos are labelled "News" and link to the goal's posts ("Read the update").
- **Data:** each video is a row in `reels`:
  - `scenes` is JSON: caption, sub, stat, visual and, for narrated scripts, `say` and `graphic`.
  - `render` is `{v, parts: [{url, poster, dur, starts, from, to}]}`. The app plays the parts back to back.
  - If `render` is empty, the app falls back to a live scene player.
- **Media:** files sit in Cloudflare R2 (`pub-e82a364f182748dabb3f95b2209b8fa0.r2.dev`). Rendered videos go under `renders/`.
- **Where videos are made:**
  - Scripts and footage: the Supabase edge function `setup/functions/reels/index.ts`.
  - Finished MP4s: rendered offline with `tools/watch-render/`, on this machine or by the GitHub Actions job `.github/workflows/watch-news.yml`.

## 3. Timeline

| When | Version | What it was | Owner's verdict |
|---|---|---|---|
| Oct 25 | First Watch videos | Text over gradients; one music bed for all goals | "I really like the text on the videos", but the background is "just a gradient screen", and the same sound everywhere |
| Oct 25–26 | Footage + per-goal music | Stock footage picked by an AI photo editor; music varies by mood | "Videos are really fixed now. Amazing." "Way better." |
| Oct 27 | Footage-first remakes | Scripts written around approved shots; strict judge; no clip reuse across goals | "50-50". Moon base and Mars great ("especially the first clip of the Moonbase"), but non-space goals lose relevance ("pictures of bed nets… talking about malaria"), plus repetition and reused clips |
| Oct 28 | **Instagram pack** (9 Reels + 3 carousels, never posted by us) | Fact-story Reels, 21–25 s: a real event arc, real footage of the event, big hooks, year stamps, per-Reel music | **"Oh, these are fire. Actually fire."** The best-received video work to date. In-app Watch then got this look |
| Oct 29–30 | Continuous playback | Watch plays like one Reel; smoother joins | "I want just smooth, seamless… one continuous video, not multiple little fragments" |
| Nov 1 | v2 renders (still live) | Pre-rendered MP4s cut into ~10 s parts for short attention spans | Kept |
| Nov 1 | Animation experiments | Motion graphics, animated and 3D scenes "in NASA's style" | Rejected: "not even remotely realistic… they look like blocks". Reverted |
| Nov 1–8 | News videos; cheaper models | A short video per new post, no AI, via GitHub Actions | Working; later paused |
| Nov 15 | v3 "Reels style" | AI writer (4–5 beats); 2–3 quick shots per scene; no labels or dark cards; slow scores only | "Feels like a slide show", "speech boxes" (labels, cards), "music doesn't match"; then "better, it's just repetitive… blurry" |
| Nov 15 | Footage bank + checks | Per-goal clip bank, judged twice; old clips re-checked (14 of 16 old Moon clips failed: clocks, smoke, embers, clouds, volcano); look-alike removal; NASA archive; story shapes and angles; 3 caption looks; 1080p | "Not exciting… not making me go 'oh my god, yes, I want this goal'" |
| Nov 21 | v4 narrated | Free AI narrator (Kokoro), word-by-word captions, graphics (paper clipping, counter, timeline, globe, chart) | "The chosen voice is good, it just looks cheap… needs that prestige feeling" |
| Nov 21 | v4 documentary look | Subtitles a phrase at a time, film grade, 24 fps, thin-type graphics | "The text is much better", but footage quality, black screens, "no sense of continuity… no climax" |
| Nov 21 | v4 journey | One shot per scene, push-in through every cut, graphics over footage, opening on the peak, 20–25 s | "I would like this video if I watched it in 2009… I legit see every pixel" |
| Nov 21 | v4 NASA 4K test | Same story over NASA's public-domain 4K "Tour of the Moon" | Sharpness fixed, but "it's also what is in the footage that is not meeting up" |

## 4. The owner's standards, in their words

- **Purpose:** the videos should be "action and exciting, because Parallax pitches these goals so people can put money on it"; "inspire people and almost hype them up about this goal". No donate ask in the video.
- **Hook and climax:** "not making me go, oh my god, yes, I want to do this goal". The climax should be "more the hook part of it".
- **Content:** not "one fact and call it a day"; "what is in the footage… is not meeting up"; non-space goals must be as relevant as space ones.
- **Repetition:** "even if it's the same goal the footages shouldn't just repeat"; "I could watch 3 back to back max and I will be bored".
- **Continuity:** "every visual is just an individual 2 second clip that doesn't lead to anything".
- **Look:** "prestige feeling"; reference: a Netflix or Apple documentary.
- **Quality bar:** NASA and SpaceX imagery. Not "2009" or visibly pixelated.
- **Things the owner rejected:** slideshow feel; "speech boxes"; club or beat music; cartoonish or blocky animation; black screens; camera shake.
- **Money:** no new paid services or credits to keep topping up (declined fal.ai and Higgsfield). Small AI script costs from the existing credit are fine. "Give examples first so we save money."
- **Volume:** "I don't want to reduce the amount". This is in tension with "never repeat a clip" (section 7).

## 5. Settled decisions (don't re-ask)

1. **Narrated videos.**
   - Voice: Kokoro `am_michael` at speed 1.12 ("the chosen voice is good"). Free, runs on the CPU.
2. **Text:**
   - Documentary subtitles, a phrase at a time, sentence case, no colour highlight.
   - Thin, restrained type for graphics.
   - No labels, kickers, stamps or dark cards.
3. **Sound:**
   - No beat-driven "club" music. Slower cinematic scores suit better.
   - The score ducks under the voice; loudness is normalised.
4. **Look and pacing:**
   - Netflix/Apple documentary look.
   - Pacing follows the shot. The hook carries the most energy.
   - One visual journey per video, with graphics over footage and never on black.
   - Fewer, better shots. 20–25 seconds.
5. **Footage rules:**
   - Never the same clip twice across a goal's videos.
   - Only footage that passes the strict check: no cartoons, no text or logos, on topic.
6. **Writing:**
   - Every claim comes from the goal's facts or the post's sources, and qualifiers stay ("fake Moon soil", "in mice").
   - Hooks are bold but true, and make sense to a stranger.
   - Angles and story shapes vary; the ending fits the goal and never ends on the catch.
   - No calls to donate or follow.
7. **Process:**
   - Examples before any rollout or spend.
   - No new paid services.
8. **Graphics:** a study clipping, a counter, a timeline, a globe (NASA maps) and a chart. The owner liked all four types offered.

## 6. What failed and why (root causes)

1. **Pixelation.** Stock clips are landscape 1080p; a vertical frame uses the middle third (about 610 of 1920 pixels), stretched ~1.8x, then zoomed further. Our code also capped downloads at 1080p, and NASA clips came from their small `~medium` copies.
   - **Fix:** 4K sources (crop width of at least 1080 real pixels), vertical clips, NASA originals or Scientific Visualization Studio (SVS) 4K, and no enlargement above 1x.
2. **Irrelevance.** Footage was chosen for the goal's general world, not for what each line says. Most lab results have no footage of the actual thing.
   - Non-space goals are weakest: stock for malaria and TB is generic.
3. **Repetition.** Each goal has about 9–12 clips that pass the strict check, and a video uses 5. So "never repeat" allows about 2 narrated videos per goal before running dry.
4. **Slideshow feel.** Many 2-second unrelated clips, text cards, hard cuts.
   - Improved with one journey per video, but limited by what footage exists.
5. **"Looks cheap."** Karaoke captions, bright gradients and generic graphics.
   - Fixed by the documentary look; the text is now rated "much better".
6. **AI-generated animation.** Our own animated and 3D scenes looked like "blocks".
   - Paid AI video (Kling, Veo, Higgsfield) was declined, and the Claude subscription can't pay for those services.
7. **The NASA Instagram references are real photographs**, not AI. They're astronaut photos from the space station, plus telescope images. NASA's material is public domain, so this look is reachable for free for space goals.

## 7. Open problems

1. **Show what's said:** footage chosen per line, or only make videos for stories that have strong visuals, or use the study's own figures.
2. **A 4K / vertical source for non-space goals:** medicine, climate, water, food.
3. **Volume vs. never-repeat vs. quality:** fewer videos per goal, or more clips per goal.
4. **Small defects in the last samples:**
   - A NASA trailer clip showed a logo.
   - The SVS tour has an "LRO" label at one point.
   - One washed-out shot under a counter.
   - The length came out at 28 s instead of 20–25 s.
5. **Goal profile pictures:** some are "really poor looking, and unrelated almost". Untouched since Nov 15.
6. **The rollout itself:**
   - Rewrite and re-render the 61 videos.
   - Turn news back on (`SHORTS_ON=1`) and port `render4.py` into the GitHub job.
   - Merge the branch.

## 8. Costs

- **AI used by video work** (from the `ai_usage` table):
  - The reels job since Oct 25: $42.55, mostly October's footage judging and scripts.
  - The new writer and checks ("shorts"): $0.26.
  - The footage bank ("bank"): $0.43.
- **Per narrated script:** about 2 cents (a draft plus the checking pass), on a mid-priced model.
- **Footage bank:** about $0.10 per goal per search.
- **Free:** voice, rendering, graphics, NASA and stock footage.

## 9. Technical inventory

**Edge function `reels`** (`setup/functions/reels/index.ts`, deployed v113). Admin actions take the `x-parallax-admin` header.
- `footage_bank {slug, dry}`:
  - Searches Pexels (portrait) and Pixabay; for space goals, also NASA's image library.
  - A cheap model judges each clip, then a better model double-checks it.
  - Also re-checks the goal's old clips, saves the passes to `goal_clips`, then runs `bank_dedupe`.
- `bank_dedupe {slug}`: labels each clip's look and scale (`space/orbit/aerial/ground/close/macro`); keeps the best 2 of each look.
- `shorts_preview {post_id | reel_id}`: writes narrated scripts without saving anything.
  - Writer: `writeShorts` with the `SHORTS_SYSTEM` prompt.
  - A second checking pass fixes claims, qualifiers, length and the ending.
  - Clips come from `clipPool`: banked quality 8+ (7+ if too few), skipping clips used by the goal's other narrated videos, ordered far to near.
  - The real study's title, journal, year and author fill the clipping graphic.
- `remake {reel_id}`: rewrites an old video as two new ones.
- `news_make`: gated by `SHORTS_ON`.
- Render support: `render_queue`, `render_set`, `file {path}`, and upload with `?upload=renders/<name>.mp4`.
- `hires {urls}`: for a stored clip, finds the highest-resolution original from its source page.
- A render token (the GitHub job) is limited to `file`, `hires`, `news_make`, `render_queue`, `render_set` and upload.

**Tables:**
- `reels`.
- `goal_clips`: url, poster, shows, credit, license, source_url, source, vertical, fit, quality, dynamic, rank, `ok`, `scale`. Schema in `setup/schema-goal-clips.sql`. Banked so far: moon-base (11 ok) and restore-coral-reefs (8 ok).
- `visuals`; `goals.why` (25 goals, `setup/goal-why.json`); `posts.sources` (title, venue, year, first_author, url); `ai_usage`.

**Renderers** (`tools/watch-render/`):
- `render.py`: v2 is live. The branch has v3, which outputs 1080p and uses the 3 caption looks in `overlay3.html`.
- `render4.py`: the narrated renderer.
  - Kokoro voice (`tts.py`), documentary subtitles burned in with libass (Inter Display Medium).
  - Graphics drawn frame by frame by `gfx.html` through `gfxrec.js`; transparent over dimmed footage, except the globe.
  - One push-in shot per scene with zoom-through joins, a film grade at 24 fps, and the score from `score3.py` ducking under the voice (loudness −15 LUFS).
  - A scene's `visual.local` and `visual.start` pick a moment in a long local original (used for the NASA 4K tour).
- Local setup:
  - `pip install kokoro-onnx soundfile`, with the model files `kokoro-v1.0.onnx` and `voices-v1.0.bin` from the kokoro-onnx GitHub release `model-files-v1.0`, located through `KOKORO_DIR`.
  - `KOKORO_PY` points to that Python.
  - Graphics assets (`three.module.min.js` 0.160.0 and the NASA Moon map `lroc_color_poles_4k`) are served from `$WATCH_RENDER_DIR/gfx` on port 8766.
  - `python3 -m http.server 8765` runs from the repo root for `render.py`.

**Free sources verified:**
- NASA Scientific Visualization Studio: 4K, public domain, with an API at `svs.gsfc.nasa.gov/api/<id>` that lists every file and its size. Example: 4619 "Tour of the Moon 4K Redux" (`moontour_notitle_2160p30.mp4`, 666 MB).
- NASA's image library: originals as `~orig.mp4`.
- Pexels and Pixabay (4K when the uploader provided it; many are only 1080p).
- ESA (CC BY-SA 3.0 IGO, credit needed; commercial use restricted).
- SpaceX's Flickr photos (check the licence per photo).

## 10. Reference library

Videos are stored in R2 (public, unlisted URLs). Frame sheets and NASA references are in `docs/shorts/reference/`.

| Reference | What it shows | Verdict |
|---|---|---|
| [ref-ig-reel-moon-by-2020](https://pub-e82a364f182748dabb3f95b2209b8fa0.r2.dev/renders/ref-ig-reel-moon-by-2020.mp4) · `frames-ig-reel-moon-by-2020.jpg` | Instagram Reel, Oct 28: promise vs reality. "Back on the Moon by 2020" → "2020 came. Nobody went." → new deadline → Artemis II footage → "Still no landing." | "Fire". The style the owner asked to get back to |
| [ref-ig-reel-lunar-night](https://pub-e82a364f182748dabb3f95b2209b8fa0.r2.dev/renders/ref-ig-reel-lunar-night.mp4) · `frames-ig-reel-lunar-night.jpg` | Instagram Reel, Oct 28 | Liked; its music was the one kept |
| [ref-ig-reel-lithium-2023](https://pub-e82a364f182748dabb3f95b2209b8fa0.r2.dev/renders/ref-ig-reel-lithium-2023.mp4) | Instagram Reel, Oct 28 | Liked |
| [moon-base-191 (live v2)](https://pub-e82a364f182748dabb3f95b2209b8fa0.r2.dev/renders/moon-base-191-p1-v2.mp4) · `frames-live-v2-moon-base.jpg` | What's live now | "Really empty… one fact… boring" |
| [ref-sample-v3-reels-style](https://pub-e82a364f182748dabb3f95b2209b8fa0.r2.dev/renders/ref-sample-v3-reels-style.mp4) · `frames-sample-v3-reels-style.jpg` | v3 with footage bank and NASA clips | "Not exciting"; repetitive Moon spheres |
| [ref-sample-v4-narrated-documentary](https://pub-e82a364f182748dabb3f95b2209b8fa0.r2.dev/renders/ref-sample-v4-narrated-documentary.mp4) · `frames-sample-v4-narrated-documentary.jpg` | Narrated, documentary look | Text "much better"; black screens; no continuity |
| [ref-sample-v4-journey](https://pub-e82a364f182748dabb3f95b2209b8fa0.r2.dev/renders/ref-sample-v4-journey.mp4) · `frames-sample-v4-journey.jpg` | One journey, graphics over footage | "2009… I see every pixel" |
| [ref-sample-v4-nasa-4k](https://pub-e82a364f182748dabb3f95b2209b8fa0.r2.dev/renders/ref-sample-v4-nasa-4k.mp4) · `frames-sample-v4-nasa-4k.jpg`, `detail-nasa-4k-sharpness.jpg` | NASA 4K tour footage | Sharp, but the footage doesn't show the story |
| `nasa-instagram-grid.jpg`, `nasa-instagram-iss-city-lights.jpg`, `nasa-instagram-iss-nile.jpg` | The owner's NASA Instagram references (Nov 1): real astronaut and telescope photos | The visual bar, also wanted for non-space goals |

## 11. Research done so far

- **Short-form craft:**
  - Speech in the first 3 seconds holds viewers better than music-only videos ([Emplifi](https://emplifi.io/?p=23678)).
  - Explainer channels mix footage with graphics made for each video: clippings, maps, charts, texture ([Johnny Harris](https://medium.com/@LMK_writing/how-johnny-harris-mastered-visual-storytelling-on-youtube-343ddf9160ec), [Vox](https://www.premiumbeat.com/blog/replicating-vox-motion-graphic/)).
  - Casual, creator-style delivery tends to beat polished packages ([Digital Content Next](https://digitalcontentnext.org/?p=47738)).
  - Recommended cut rhythm varies widely between sources (every 2–3 s to every 8–12 s); no controlled study was found.
- **Free voice:** Kokoro is the leading open-weight voice; Piper is lighter but sounds more synthetic ([findskill.ai](https://findskill.ai/blog/best-open-source-tts-2026/)).
- **Footage:** NASA SVS is public domain with 4K for most newer visualizations ([SVS help](https://svs.gsfc.nasa.gov/help/)).
- **Claude guidance used for the next phase:** [Prompting best practices](https://platform.claude.com/docs/build-with-claude/prompt-engineering/claude-prompting-best-practices), [Skill authoring best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices), [Claude Code memory](https://code.claude.com/docs/en/memory).
