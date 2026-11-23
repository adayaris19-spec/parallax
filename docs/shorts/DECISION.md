# Production method: decision record

Status: **the owner chose option B on Nov 23, 2026** (agency footage first, AI motion on the free allowance). Not yet approved as final: the first reel made this way is with the owner. Nothing here is live.

## Why the old method was dropped

The owner scrapped hand-built 3D on Nov 23: "this is still not the level of detail that we are aiming for", "the physics of this is still wrong", "it's not even a full reel".

- The free machines have 4 processor cores and no graphics card. One 1080×1920 frame of a detailed scene took 1.5 to 4 minutes; a 23 s video is 562 frames.
- NASA's free 3D models are plain. Every richer object had to be built by hand in code.
- Each new shot was a new hand-built scene, so each round of feedback cost hours.

## What the search found (Nov 23)

Figures marked "reported" come from third-party pages and must be checked at the source before money is spent.

**1. The agencies already publish film-grade pictures of our goals, free to use.**
- NASA released a Moon Base set in 2026: a 4K concept animation ("Living and Working on the Moon", May 22), five 4K renderings (astronauts, rovers, landers, solar masts, habitats), a 4K trailer and monthly update videos. Sources: nasa.gov video and image pages; images.nasa.gov (search "moon base").
- NASA's rules: its pictures and video are generally not copyrighted; credit NASA; no implied endorsement; the NASA logo is not free to use on its own; identifiable people need their permission for commercial use; shots made by partners (tagged with a company name) may carry that company's rights. Source: nasa.gov/nasa-brand-center/images-and-media.
- Limits: only what an agency has drawn or filmed exists; the trailer has titles burned into its shots; the renderings are stills.

**2. Open AI video models can add motion to a still.** The look of the result follows the look of the first frame, so a film-grade first frame gives a film-grade clip.
- Tested Nov 23: NASA's base rendering as first frame, Wan 2.2 on a public demo, from a free GitHub machine with no account. Two 5 s clips came back in 80 s and 99 s, at 480×832 and 16 fps. The astronauts move naturally. Errors seen: a hand tool changes shape; wheel marks appear on ground nothing has driven on.
- Sharper open model: LTX-2.5 (1088×1920 native, free for commercial use under $10M revenue, per its model card). Its public demo asks for 272 s of graphics-card time for one 5 s clip at 832×1472.
- Free graphics-card time, per Hugging Face's documentation: 2 minutes a day without an account, 5 minutes with a free account, 40 minutes with PRO ($9 a month).
  - Free account: about one sharp 5 s clip a day, or about four small ones.
  - PRO: about eight sharp clips a day, which is one video a day.
- Kaggle gives 30 hours a week of a 16 GB card and can be driven by script, but its terms allow "internal, personal, non-commercial use" only.

**3. Hosted generators (reported prices).**
- Pay per second by API: xAI Grok Imagine $0.02–0.08 per second at 1080p; Google's video model $0.104 per second at 1080p. A 23 s video made entirely this way: about $0.50 to $2.40.
- Subscriptions without an API (a person clicks): Google AI Plus $4.99 a month, about 40 clips; Adobe Firefly has a free plan without watermark and with commercial use, daily count unpublished.
- Free tiers of Kling, Runway, Hailuo, Vidu and Higgsfield: watermarked or not for commercial use.
- Reviewers rate Seedance 2.5 and Wan 3.0 highest for realism and physics; neither is open.

**4. Other routes looked at.**
- Keeping 3D as a hidden guide and letting an AI model repaint it (Wan VACE): geometry holds, surface detail is invented; needs the same graphics-card time as route 2.
- Unreal Engine 5: free for this use, needs a real graphics card; no free accurate lunar set found.

## Recommended method: source first, AI for motion

1. For each goal, collect the agencies' own film-grade footage and renderings (NASA, ESA, NIH, WHO, NOAA and the like), keeping only pieces whose rights are clear.
2. Cut the reel from the moving footage first.
3. Where only a still exists, or a shot is missing, an AI video model animates the still. First frame (and where possible last frame) come from the source picture, so hardware and place stay as the agency drew them.
4. Every AI clip is checked frame by frame for physics and continuity (nothing appears before its cause; no dust hanging; shapes hold). A clip that fails is made again or dropped.
5. Voice, subtitles, score and the audio check stay as they are (`make_video.py`).

Proof sent to the owner Nov 23: a full 23.4 s reel made this way without the AI step (plan `tools/shorts-lab/moonbase-v6-nasa.json`), and one AI-moved sample clip.

## The choice the owner has to make

| Option | Cost | What it gives |
|---|---|---|
| A | $0 | Agency footage and renderings only; stills move by a slow camera push. Full videos the same day. |
| B | $0, owner adds a free Hugging Face token as the GitHub secret `HF_TOKEN` | A plus AI motion, about one sharp clip a day; a full video takes about a week. |
| C | $9 a month (Hugging Face PRO) | A plus AI motion on every still, about one full video a day, open models only. |
| D | about $1–3 per video (a pay-per-second API) | A plus AI motion from the strongest hosted models at 1080p. Needs an API key added by the owner. |

Recommendation: C or D. A alone is honest and sharp but half its shots are stills.

## Open points before anything goes live

- NASA's logo is visible on suits in some renderings; confirm that showing NASA's own pictures with credit is acceptable for Parallax, which sells Plus.
- Decide where the credit line goes (caption or a small line on screen).
- Goals without agency imagery (for example curing HIV) need their own source list.

## After the choice (Nov 23)

- The token is still missing. The AI workflow looked for a repository secret under `HF_TOKEN` and six other usual names, and for a repository variable: none is present. Until it is, AI clips run on the no-account allowance: about one clip a day.
- The better demo for our purpose is LTX-2.3 (`Lightricks/LTX-2-3`): 24 frames a second, any size (1088×1920 works), about 94 s a clip. Wan 2.2's demo is capped at 832 px and 16 frames a second.
- With a free account's 5 minutes a day, that is about two to three clips a day, not one. To be confirmed once the token works.
- For the Moon base, NASA's own moving footage covered seven of eight shots. AI motion was needed for one.
- Other goals: NOAA Fisheries and USGS publish public-domain coral video; for malaria the search found public-domain stills but no free video. Each goal needs its source list before its first video (rule in `RULES.md`).
- One-place reel (Nov 23, evening): no agency footage shows night falling on a base, and without the token no AI clip could be made for it. The night, the travelling shadow and the lamps were laid over NASA's sunlit shot by our own compositing (`tools/shorts-lab/night_fall.py`). This adds an ingredient to option B; it stays only if the owner agrees.
