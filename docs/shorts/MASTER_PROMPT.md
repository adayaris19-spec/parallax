# Master prompt: Parallax short-form video

Paste everything below the line into a new chat on this repository. It is written to be followed step by step; keep `docs/shorts/PROGRESS.md` updated as the work moves so any later chat can pick it up.

---

What we need to do first is pin down, properly and precisely, what kind of videos I'm looking for. You'll understand that by asking me questions and showing me examples, not by guessing. This chat is only about short-form video for Parallax's Watch section: making them consistently excellent, in the most efficient and precise way, and in line with my goals.

## Your job

Build a repeatable system that produces Parallax short videos I'd be proud to put next to NASA's and SpaceX's own. That means:

1. **A clear definition** of a good Parallax video, drawn out of me through questions and examples.
2. **One free production method**, researched and chosen to fit that definition.
3. **A rulebook** of measurable baseline rules.
4. **A skill** (`.claude/skills/parallax-shorts/`) that applies all of it every time.
5. **A pilot I approve** before anything goes live.

## Read before your first message

1. `CLAUDE.md`: what Parallax is, how we ship, my standing rules.
2. `docs/shorts/SUMMARY.md`: everything done so far, my verdicts in my own words, settled decisions, root causes, open problems, and the tech that exists.
3. `docs/shorts/reference/`: frame sheets of every version, and my NASA Instagram references. Look at the images.
4. The reference videos linked in section 10 of the summary. Download them, pull frames and listen to them. The Instagram Reel "Moon by 2020" is the best-received video so far, and the live v2 video is what I'm moving away from.

Then start Phase 1. Don't re-ask anything listed as settled in section 5 of the summary unless something we learn contradicts it; if it does, say so plainly.

## Ground rules

- **Questions:** ask one topic at a time, using the question tool. Each round gets 2–4 options, a recommended option where you have one, and a visual preview whenever the choice is visual.
  - Show, don't describe: a still frame, a 3-second clip or a contact sheet costs nothing to make.
- **Rules:** every answer I give becomes a measurable rule (seconds, pixels, colours, loudness, word counts), written into `docs/shorts/RULES.md` as we go.
- **Avoid list:** name what to avoid specifically ("no yellow word-highlight captions", "no clip enlarged beyond its real resolution"), never "avoid a generic look".
- **Money:**
  - No new paid services, subscriptions or credits. Paid AI video and image tools were already declined.
  - Small AI costs from Parallax's existing credit are fine, about 2 cents a script; report what you spend.
  - Show examples before spending on anything at scale.
- **Facts:** only from the goal's facts and the post's sources, with qualifiers kept. A bold hook must still be true.
- **Look before sending.** Check frames at full resolution and the audio before you send me anything. When you send a sample, say in plain words what changed and what is still wrong.
- **Stay on one approach.** Once a production method is chosen, don't mix in other approaches unless I agree.
- **Progress:** keep `docs/shorts/PROGRESS.md` as a checklist of the phases below, ticked as you go. Commit and push working files as you go, following `CLAUDE.md`.
- **Writing:** short and plain. No filler.

## Phase 1: Check your understanding

- **What to do:** in at most 10 bullets, tell me what you understand about my goals for these videos and what went wrong so far.
- **Done when:** I confirm or correct it.

## Phase 2: Discovery interview

Rounds of questions with examples, one topic per round, until each of these has a confirmed answer:

1. **Purpose and feeling:** what a viewer should feel and do after watching (the videos exist to make people want a goal to happen).
2. **Subject matter:** what each video is about, how stories are chosen (news, the goal's story, a person, a number), and what must be on screen for each kind of line.
3. **Structure and timing:** total length; the hook in the first second; scene length; where the peak sits; the ending.
4. **Visual continuity:** how shots connect (journey, match cuts, a hero subject), and transitions.
5. **Spacing and composition:** the app's safe areas (header about 230 px at the top, buttons about 330 px at the bottom, side buttons on the right), where text sits, negative space, and vertical framing.
6. **Colour and grade:** palette per goal family; contrast; grain or none.
7. **Type and captions:** subtitles vs. key phrases; size, weight, position, timing.
8. **Graphics:** which kinds, how often, and their style.
9. **Voice and sound:** delivery and pace of the narrator; music style per mood; sound effects; mix.
10. **Variety rules:** what must differ between videos of the same goal, and between goals.
11. **The bar:** what "NASA/SpaceX quality" means in concrete, checkable terms.

**Done when:** `RULES.md` has a draft rule for every topic, and I've confirmed it.

## Phase 3: Reference hunt

- **Collect:** 10–15 strong short-form videos (YouTube Shorts, Instagram Reels, TikTok) about space and science, close to what Parallax does. Start with NASA, ESA, JPL, SpaceX and top science explainers. Use web search, and fetch pages where possible; say honestly when a platform can't be read.
- **For each one, write down:** the link; why it works; length; average shot length; how much text; voice or not; music; colour; how it opens and ends.
- **Show them to me in small batches.** I pick the best one; that becomes the north star.
- **Done when:** `docs/shorts/NORTH_STAR.md` holds the chosen reference and its measured specs (shot lengths, text density, loudness and so on, measured from frames and audio where you can download it, otherwise estimated and marked as such).

## Phase 4: Find the free production method

1. **List every free way to produce videos that match the north star**, including at least:
   - NASA's Scientific Visualization Studio (4K, public domain).
   - NASA's image library originals.
   - ESA (with credit; check commercial limits), NOAA, Wikimedia Commons.
   - Open-access papers' figures (CC BY).
   - Pexels and Pixabay 4K and vertical footage.
   - Our own 3D (Blender or three.js).
   - The free Kokoro voice we already use.
2. **Score each option against:**
   - how close it looks to the north star;
   - whether it can show what each line actually says;
   - real resolution after a vertical crop (at least 1080 real pixels wide, never enlarged);
   - licence;
   - $0 ongoing cost;
   - automation (GitHub Actions or the edge function);
   - coverage across all 26 goals, health and climate included.
3. **Recommend one primary pipeline and at most one fallback**, with one test render each.
4. **Done when:** I approve the choice, recorded in `docs/shorts/DECISION.md`.

## Phase 5: The rulebook

Finish `RULES.md`. It must cover:
- timing and spacing;
- colour and type;
- voice and sound (loudness target);
- coherence: one subject and one visual journey per video;
- content selection: which stories get a video, and when to skip one;
- accuracy;
- variety.

It also needs two closing pieces:
- **Hard quality gates** that a script can check, for example:
  - no enlargement above 1.0x;
  - no logos or burned-in text in footage;
  - no black frames;
  - no caption overlap;
  - length within range;
  - loudness on target.
- **A scorecard** I can use to rate any video.

## Phase 6: Build the skill

Build `.claude/skills/parallax-shorts/` following Anthropic's skill authoring best practices:
- **Tests first:** pick 3 test stories (space, medicine, climate) and make baseline videos with no skill. Write down what fails.
- **Main skill file:** `SKILL.md` stays under 500 lines, with a description in the third person that says what it does and when to use it.
- **Supporting files:** rules, north star and source guides go in reference files one level deep. Fragile steps (checking resolution, black frames, loudness, caption overlap) become scripts, not prose.
- **Test with a fresh session:** a fresh session uses the skill on the test stories, and its failures come back here for fixing.

The model used for this phase is set when the chat starts.

## Phase 7: Pilot and rollout plan

1. Render the 3 pilot videos with the skill.
2. I score them on the scorecard. Iterate until I approve.
3. Then write the rollout plan for the existing videos and news videos (including turning `SHORTS_ON` back on and moving the renderer into the GitHub job), with cost and time.

Nothing goes live without my go-ahead.

Start with Phase 1 now.
