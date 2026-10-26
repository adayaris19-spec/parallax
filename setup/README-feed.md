# Parallax feed: setup

This turns on the new Parallax: the feed where humanity's goals are the accounts.
It uses the same Supabase project as before. Everything is done in the Supabase
dashboard except step 5, which runs one command on your computer.

## What is in this folder

| File | What it is |
| --- | --- |
| `schema-feed.sql` | The tables for goals, their trees and posts |
| `functions/map-goal/index.ts` | Turns any goal into a goal account: tree, evidence, bottleneck, countdown, first posts |
| `functions/pulse/index.ts` | Checks new research for one goal per run and posts when something changes |
| `functions/promises/index.ts` | The promise keeper: finds dated promises in older research and checks them |
| `schema-promises.sql` | The table for promises |
| `schema-accounts.sql` | Profiles, follows and account deletion |
| `functions/branch/index.ts` and `schema-branch.sql` | Your branch: matches people's skills to problems |
| `schema-impact.sql` | Impact: steps people report taking on a problem |
| `seed-queue.sql` | Maps the starting goals a few a day, within the free OpenAlex budget |
| `seed.mjs` | Maps the starting list of goals |
| `../index.html` | The feed itself (the previous front page now lives at `instruments.html`) |

## 1. Create the tables

Supabase dashboard -> SQL Editor -> New query. Paste all of `schema-feed.sql` and press Run.

## 2. Add the secrets

Dashboard -> Edge Functions -> Secrets. Add:

| Name | Value |
| --- | --- |
| `ANTHROPIC_API_KEY` | Your key from console.anthropic.com (already there if the old `ingest` function works) |
| `ADMIN_TOKEN` | A long random string you make up, e.g. 40 random letters and digits. Keep it private. |
| `OPENALEX_API_KEY` | Strongly recommended. Free key from OpenAlex (https://help.openalex.org/api/authentication/). Without it, OpenAlex allows only a small number of searches a day shared by everyone on the same server address, and mapping fails with "OpenAlex answered 429". |
| `CONTACT_EMAIL` | Optional. Your email; OpenAlex answers faster for polite callers. |
| `PARALLAX_MODEL` | Optional. Defaults to `claude-opus-5-5`. Set `claude-sonnet-5-5` to cut model costs roughly in half. |
| `NEW_GOALS_PER_HOUR` | Optional. Defaults to 10. The most new goals the public search can create in an hour. |
| `SEARCHES_PER_HOUR` | Optional. Defaults to 60. The most public searches per hour that reach the model. Together these two cap what a stranger can spend: at most about $15 an hour. Your seed script is not capped. |

## 3. Deploy the two functions

Dashboard -> Edge Functions -> Deploy a new function -> Via editor.

1. Name it `map-goal`. Replace the sample code with all of `functions/map-goal/index.ts`. Deploy.
2. Name it `pulse`. Replace the sample code with all of `functions/pulse/index.ts`. Deploy.

Leave "Verify JWT" on for both. The site sends the public key with every call.

## 4. Schedule the pulse

Dashboard -> Database -> Extensions: turn on `pg_cron` and `pg_net`.
Then SQL Editor -> New query. Replace `<ADMIN_TOKEN>` with your token and run:

```sql
select cron.schedule('parallax-pulse', '*/10 * * * *', $$
  select net.http_post(
    url := 'https://zfmjjazkmolvywvayjzj.supabase.co/functions/v1/pulse',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpmbWpqYXprbW9sdnl3dmF5anpqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYwMzQ2NjEsImV4cCI6MjEwMTYxMDY2MX0.NA72AfuZ7axlxGBfKJwR4aNKyufjUz--fm3CG1_dCY8',
      'x-parallax-admin', '<ADMIN_TOKEN>'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 150000
  );
$$);
```

Every 10 minutes it checks the goal that has waited longest (each goal about once a day)
and restarts any goal whose mapping got stuck.

## 5. Map the starting goals

On your computer, in this repository's folder (needs Node 18 or newer):

```bash
ADMIN_TOKEN=<your token> node setup/seed.mjs
```

It maps 36 goals, from Mars to malaria. Each goal is accepted in about a minute and
finishes in the background a few minutes later. Open the site and watch them arrive.
To add your own instead: `ADMIN_TOKEN=... node setup/seed.mjs "your goal" "another goal"`.

## 6. Publish the site

`index.html` is the whole site: one file, no build step. Publish it the same way the old
page was published. Anyone can now search for a goal, and if it is not there yet,
press "Map this goal".

## 7. The promise keeper

The promise keeper finds dated promises in older research ("we expect X by 2015"),
quotes them word for word, and checks them once the deadline passes.

1. SQL Editor: run all of `schema-promises.sql`.
2. Deploy a third function named `promises` with `functions/promises/index.ts` (Verify JWT on).
3. Schedule it hourly, the same way as the pulse in step 4, with the URL ending in
   `/functions/v1/promises`, the job name `parallax-promises` and the schedule `41 * * * *`.

Each run handles one goal: it checks up to 4 promises whose deadline has passed, or, if none
are due, searches a goal's older research for new promises (each goal about once a month).
A promise is only shown as kept with two independent sources.

## 8. Accounts

Profiles, follows saved to accounts, follower counts and account deletion.

1. SQL Editor: run all of `schema-accounts.sql`.
2. Authentication -> URL Configuration: Site URL `https://adayaris19-spec.github.io/parallax/`, and add the
   same address followed by `**` under Redirect URLs.
3. Turn on Google sign-in (one time, about 10 minutes):
   1. Go to https://console.cloud.google.com/ and create a project named "Parallax".
   2. APIs & Services -> OAuth consent screen: choose External, app name "Parallax", your email as
      support and developer contact, then save. Under Audience, press Publish app so anyone can sign in.
   3. APIs & Services -> Credentials -> Create credentials -> OAuth client ID -> Web application.
      Under Authorized redirect URIs add `https://zfmjjazkmolvywvayjzj.supabase.co/auth/v1/callback`. Create.
   4. Copy the Client ID and Client secret into Supabase: Authentication -> Sign In / Providers -> Google.
      Turn it on and save.
   The site shows "Continue with Google" as soon as the provider is on; no code change is needed.
4. Email codes (later): connect an email service under Authentication -> Emails -> SMTP Settings
   (Supabase's built-in sender only reaches your own team), then set `EMAIL_CODE_SIGNIN = true`
   in `index.html`.

## 9. Your branch

Matches each signed-in person's skills to the problems where they can help, with a first step.

1. SQL Editor: run all of `schema-branch.sql`.
2. Deploy a function named `branch` with `functions/branch/index.ts` (Verify JWT on).

Matches are saved per person and reused until their skills, bio or follows change. Each person can
ask for new matches up to 4 times a day; `BRANCHES_PER_DAY` (default 300) caps new matches across
everyone. One match costs about one model call.

## 10. Impact ("I did this")

People mark a first step from Your branch as done, optionally saying what they did. It shows on
their public profile (marked self-reported), and each problem in a tree shows how many people
took a step on it. SQL Editor: run all of `schema-impact.sql`. No function is needed.

## 11. The Parallax Terminal (payments)

The Terminal (`#/terminal`) is the paid view: every goal side by side, every open
problem, how past promises held up, and spreadsheet downloads. Anyone can see a
preview; subscribers see everything. The feed stays free.

1. Run `schema-billing.sql`. It adds the `subscriptions` table and a daily snapshot
   of every goal (`goal_snapshots`, filled at 23:53 UTC) for the trend lines.
2. Deploy three functions: `terminal` and `billing` with Verify JWT on, and
   `stripe-webhook` with Verify JWT **off** (Stripe calls it and signs each call).
3. In Stripe, in **test mode** first:
   - Developers -> API keys: copy the secret key (`sk_test_...`) into the Supabase
     secret `STRIPE_SECRET_KEY`.
   - Developers -> Webhooks -> Add endpoint:
     `https://<project>.supabase.co/functions/v1/stripe-webhook`, events
     `checkout.session.completed`, `customer.subscription.created`,
     `customer.subscription.updated`, `customer.subscription.deleted`. Copy its
     signing secret (`whsec_...`) into `STRIPE_WEBHOOK_SECRET`.
   - Settings -> Billing -> Customer portal: press Save once, so "Manage billing" works.
4. Subscribe on the site with the test card `4242 4242 4242 4242`, any future date,
   any CVC. The Terminal unlocks within a few seconds.
5. To go live, repeat step 3 in live mode with the live keys.

The product and its $55/month price are created in Stripe on the first checkout
(lookup key `parallax_terminal_monthly`). Set `TERMINAL_PRICE_CENTS` to change the
price before that. Complimentary access: set a person's `subscriptions.status` to
`comp` (see the comment in `schema-billing.sql`).

### Terminal intelligence

Run `schema-intel.sql` and deploy the `intel` function (Verify JWT on). It schedules two jobs:
- every 2 hours, field data for the goal checked longest ago: research volume per year, the top
  institutions and countries in the last 3 full years (OpenAlex, 3 searches per goal, weekly per goal);
- every Monday at 06:47 UTC, the weekly analyst brief (one Claude call).

## 12. Back a problem (funding)

Teams (labs, nonprofits, companies, independent researchers) raise money for problems in a goal's
tree. Each team gets its own Stripe account through Stripe Connect, so money goes straight to them;
Parallax keeps 5% (`PARALLAX_FEE_BPS`, default 500). Backers can add card fees on top so the team
gets the full 95%.

1. Run `schema-funding.sql` and deploy the `fund` function (Verify JWT on). Redeploy `stripe-webhook`.
2. In Stripe: **Connect -> Get started** once, as a platform, so teams can be onboarded.
3. Add `charge.refunded` to the webhook's events (refunds then show on the site).
4. A team signs up at `#/team`, verifies with Stripe, and lists problems. Approve it after checking it is real:
   `update teams set approved = true where id = '<team id>';`
5. Backers press **Back** on a problem in the tree and pay through Stripe Checkout.

## 13. Plain language

Run `schema-plain.sql` and deploy the `simplify` function (Verify JWT on). Every hour it rewrites the
goal that most needs it in plain words: a one-line story of where the goal stands, and every
problem and post. Correct technical terms stay; everything around them gets short and clear. The
originals are kept, and the site shows the plain version when there is one.
To redo one goal now: POST `{"slug": "mars", "all": true}` with the admin header.

## 14. The research library

Run `schema-library.sql` and deploy the `library` function (Verify JWT on). Every 2 hours it grows
the library of the goal checked longest ago (monthly per goal): for every problem, the 200 most
relevant OpenAlex papers and the 100 most relevant from the last 5 years, plus NASA technical
reports (NTRS) and PubMed. OpenAlex charges per search, not per result, so this costs about 2
searches per problem. The AI still reads only the most relevant handful.
Test the sources: POST `{"probe": "lunar night power"}` with the admin header.

## 15. Pictures and guesses (the swipe feed)

Run `schema-media.sql` and deploy the `media` function (Verify JWT on). Hourly it finds a free picture
for each goal and post: NASA's Image Library (NASA media is generally not copyrighted; never imply NASA
endorses Parallax) and Openverse images under CC0, public domain, CC BY or CC BY-SA. Every picture is
shown with its credit and license, and is only kept if the file really loads.
Guesses ("When will this happen?") are stored through the `guess` function, one per person or device
per goal; only totals are public (`guess_totals`).
The old list feed is still at `#/list`.

## 16. Watch (short videos)

Run `schema-reels.sql` and deploy the `reels` function (Verify JWT on). Every 2 hours it writes short
vertical videos for the next goal that is due (when it has new posts, at most weekly; otherwise monthly): an intro, and the strongest
breakthroughs, setbacks, promise checks or teams. Each reel is 4-6 scenes (a caption, maybe one number
from the data, and NASA footage or an openly licensed photo checked by Claude). The site plays them at
`#/watch` with captions and music generated in the browser (no licences needed). No voice.

Each reel has a mood (epic, uplifting, tense, bittersweet, mysterious, calm) that picks its music, and
each scene a layout (bottom, center, top, big number, quote). For real footage and photos, add two
free keys as Edge Function secrets: `PIXABAY_API_KEY` (videos and photos, pixabay.com/api/docs) and
`UNSPLASH_ACCESS_KEY` (photos, unsplash.com/oauth/applications). Without them, only NASA and Wikimedia
Commons are searched. Pixabay files are copied into the public Storage bucket `reels-media` (their
rules forbid hotlinking); Unsplash photos load from Unsplash with credit, as their rules require. A photo editor prompt scores every candidate and keeps only 8/10 or better.
To redo a goal's reels: `POST /functions/v1/reels` with `{"slug":"<slug>","fresh":true}` and the admin header.

## 17. What it would take (cost estimates)

Run `schema-costs.sql` and deploy the `costs` function (Verify JWT on). Every hour it takes the next
goal with problems lacking a recent estimate (monthly refresh), two chapters per call. For each
problem Claude searches the web for real budgets, contracts and grants, then writes: the next concrete
step and its cost range and time, what solving it for this goal would cost, who pays for it today,
what the figures rest on, a confidence level, and up to 3 sources (only pages the search returned).
Web search costs $10 per 1,000 searches; one goal is roughly 60 searches. The goal page shows the
estimates in Right now, the problem panel, the research sheet, and a "What it would take" section.
To redo a goal: `POST /functions/v1/costs` with `{"slug":"<slug>","fresh":true}` and the admin header.

## 18. Ideas lab

Run `schema-ideas.sql` and deploy the `ideas` function (Verify JWT on). Every hour it collects
finished research batches, then submits the next goal's problems (4 at a time, the bottleneck and
blocked problems first) as an Anthropic message batch: no time limit, half price. For each problem
Claude reads its top 30 library papers, related problems, its next-step cost and problems from other
goals, proposes 3 testable ideas, and searches the web for prior art. A second call structures them:
pitch, why it might work, cheapest first test and its cost, what it borrows from, papers it builds on
(only from the library), what the prior-art search found (only pages it returned), and the main risk.
Ideas are refreshed every 60 days. Signed-in people react (Promising, Has a flaw, Already tried, I
could test this) with an optional note. Pages: `#/lab`, `#/lab/<goal>`, `#/idea/<id>`, a section
on each goal page, and the problem sheet.
One problem now: `POST /functions/v1/ideas` with `{"slug":"<slug>","key":"b3.1"}` and the admin header.

## 19. Stories

When a goal has news (a step forward, a setback, a problem solved, a new bottleneck, a promise checked),
it shows as a ring at the top of the feed for 48 hours (one story per goal per day). Stories play in
the Watch player (`#/stories/<goal>`). Most are built in the browser from the post Parallax already
wrote, with visuals from the shared photo library or the goal's own approved shots: no AI cost. A
problem solved or a new bottleneck gets a full video from the videos job within the hour, and that
video plays as the story. Watched stories are remembered in the browser.

## 20. Support a goal (donations through Every.org)

Run `schema-giving.sql`, deploy `orgs` (Verify JWT on) and `every-webhook` (Verify JWT **off**).
- `orgs` (hourly, watched goals, refreshed every 90 days): Claude proposes US nonprofits working on the
  goal; each must be a registered 501(c)(3) in IRS data (ProPublica Nonprofit Explorer) and have
  donations enabled on Every.org (its public nonprofit API). Up to 6 are kept, mission-focused first;
  universities are marked, because a gift goes to the whole university.
- The goal page shows a "Support this goal" box: the live total toward a community goal that grows
  in steps ($10K, $25K, $50K, ...), recent gifts, and the organisations with Donate buttons. Donate
  opens Every.org, which takes the gift, pays the nonprofit and sends the receipt. Parallax never
  holds money and takes no cut.
- Live totals without any approval: the `giving` function (every 10 minutes, no AI) creates one Every.org
  fundraiser per goal and organisation with Parallax's own Every.org API keys (public key in the code,
  private key as the `EVERY_PRIVATE_KEY` secret), points the Donate buttons at them, and reads each
  fundraiser's total and supporters. Increases between checks show as recent gifts ("Someone gave $25").
- Optional, for donor first names in recent gifts: ask Every.org (partners@every.org) for a partner webhook pointing at
  `https://zfmjjazkmolvywvayjzj.supabase.co/functions/v1/every-webhook?key=<app_config.every_webhook_key>`.
  Put the token they issue in `site_config` (`every_webhook_token`); it is added to donate links.

## 21. Keeping AI costs down

- Every AI call is logged in `ai_usage` (tokens, web searches, estimated price; `schema-usage.sql`).
  Spend by job and day: `select * from ai_spend;` in the SQL editor.
- Background work runs through Anthropic's Message Batches API at half price, with the same model and
  prompts: the daily research check (`pulse`, `schema-batches.sql`), cost estimates and ideas. One
  call submits; a later call collects. Mapping a new goal stays live, because someone is waiting.
- Spend follows attention (`schema-attention.sql`): the site counts one visit per goal per browser
  session; cost estimates, ideas and videos go to goals with followers or visits in the last 30 days,
  most-watched first. A goal nobody looks at gets them once someone visits or follows it.
- Ideas check prior work in OpenAlex (free, real papers, short abstracts) instead of web search.
- Videos: the photo editor's judgement runs as a batch too (`reel_jobs`); finished videos appear
  within the hour. Cost estimates cache what the model has read between search steps.
- The research check runs daily for watched goals and weekly for the rest (nothing is missed).
- Videos judge candidate photos from small previews (about 320-640 px) that each source provides.
- Shared libraries (`schema-libraries.sql`), so work done once is reused by every goal:
  `visuals` keeps every photo or video the photo editor approved; a new scene that asks for the same
  kind of shot reuses one (no search, no judging; at most 4 uses each, never twice in one goal).
  `budget_facts` keeps every sourced cost figure found; a new estimate starts from the known figures
  and searches the web less (4-10 searches per chapter depending on what is known). One-off fill from
  existing estimates: `POST /functions/v1/costs` with `{"action":"backfill"}`.
- Work is only redone when something changed: cost estimates after 6 months or when the problem
  changes; ideas for each goal's 6 most important problems (refreshed every 120 days), and for any
  other problem when someone asks; videos when there are new posts (at most weekly), else monthly.

## If the AI is unavailable

If the Anthropic account runs out of credit or the API is down, nothing breaks for visitors: the
feed, trees and promises keep showing. New searches say "try again later", the pulse and promise
keeper skip a goal until the next day instead of retrying (which would spend the day's OpenAlex
searches), and the seeding job retries failed or lost goals up to 3 times on later runs.

## Expert review

Advisors mark a post reviewed in the dashboard (Table Editor -> posts): set
`expert_reviewed` to true and `reviewer` to their name. The post then shows "expert reviewed".
A proper reviewer screen comes later.

## What it costs to run

Rough figures on `claude-opus-5-5`, to check against your real bill in the first week:

- Mapping a goal: about 5 model calls, roughly $0.50 to $1.50 each goal.
- Pulsing: one call per goal per day when there is new research, roughly $0.05 to $0.15.
  At 100 goals that is about $5 to $15 a day.
- OpenAlex and Supabase's free tier cost nothing at this size.

## If something goes wrong

- A goal page says "Mapping hit a problem": the error is shown on the page. To retry it, run
  `curl -X POST https://zfmjjazkmolvywvayjzj.supabase.co/functions/v1/map-goal -H "Authorization: Bearer <anon key>" -H "x-parallax-admin: <ADMIN_TOKEN>" -H "Content-Type: application/json" -d '{"continue":"<slug>","retry":true}'`
- Edge Functions -> map-goal -> Logs shows every call and error.

## 22. Video storage (Cloudflare R2)

Reel media lives in a Cloudflare R2 bucket (`parallax-media`): free up to 10 GB, with free downloads.
Supabase Edge Function secrets: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`
(an Object Read & Write token for the bucket) and `R2_PUBLIC_URL` (the bucket's `https://pub-….r2.dev`
address, not the S3 API endpoint). Optional `R2_BUCKET` if the bucket has another name.
Without them, or if an upload fails, `reels` falls back to Supabase Storage (`reels-media`).
Admin actions on `reels`: `{"action":"r2_check"}` tests upload and public read;
`{"action":"move_media"}` copies Supabase-hosted media to R2; `{"action":"drop_old"}` deletes
Supabase copies nothing references.

## 23. True research volume

`schema-field-counts.sql` adds `node_field_years`: papers per year for each problem's search across
all of OpenAlex, counted with one `group_by=publication_year` request per problem (no papers are
downloaded). The `library` function refreshes one goal's counts per run (monthly per goal), right
after growing a library; `POST {"counts": true, "slug": "..."}` counts one goal now. The goal page's
research bars, momentum and dot sizes use these counts, falling back to the library sample
(`node_years`) for goals not yet counted. Free: about 25 OpenAlex requests per goal per month.

## 24. Real funding and clinical trials

`schema-evidence.sql` adds `node_evidence` (plus `node_evidence_checks` for resuming) and the
`parallax-evidence` cron (at :07, :27 and :47). The `evidence` function (no AI, free public APIs)
checks each problem:
- **Federal grants** from USAspending.gov (last 3 years, all agencies): count, dollars obligated,
  by agency, and the largest awards. USAspending matches phrases, so it tries the first three search
  words, then phrases containing the goal's key words, then the first two words. A phrase is kept
  only if enough of its largest grants carry it in their title, and, for mostly-health grants
  without the goal's key word, only if they name the goal's subject.
- **Clinical trials** from ClinicalTrials.gov (active or recruiting), for health problems only, with
  the full search words. Studies naming the goal's subject are listed first; if none of the first 20
  do, nothing is shown.
One goal per run (resumable), refreshed monthly. `POST {"slug": "..."}` runs one goal now,
`{"probe": "search words"}` tests a search, `{"redo": true}` re-checks every goal.
The goal page shows a summary in the field panel and the detail in each problem's research sheet.

## 25. Share previews and offline speed

- `scripts/build-share.mjs` writes `g/<slug>/index.html` (that goal's title, description and preview
  image, then forwards to `#/g/<slug>`) and `share/<slug>.png` (a 1200x630 card), plus
  `share/parallax.png` for the home page. The site's Share buttons link to `g/<slug>/`.
  `.github/workflows/share.yml` rebuilds them every 6 hours (and on demand from the Actions tab) and
  commits only changes. When the site moves to its own domain, set `SITE_BASE` in that workflow.
- `sw.js` (service worker): the page shell loads from the phone instantly and refreshes in the
  background; fonts and libraries are kept; database reads fall back to the last copy offline.
  To force everyone onto a new shell immediately, bump `V` in sw.js.

## 26. Health check and alerts

`schema-health.sql` adds `parallax_health()`, listing what needs attention: background jobs that
answered with errors (last 6 hours), scheduler failures, AI batches pending over 6 hours, goals that
failed to map, ready goals missing a piece 8 hours after mapping (library, research counts,
charities, cost estimates, ideas, videos, funding and trials), charities without a donation page,
and seeding stalled for a day. `.github/workflows/health.yml` runs `scripts/health.mjs` daily at
07:13 UTC: it opens one GitHub issue tagging the owner (so GitHub emails them), updates it when the
list changes, and closes it when everything is healthy. Run it any time from the Actions tab.

Self-healing that goes with it: AI batches with nothing finished after 4 hours are cancelled (not
billed) and resubmitted; up to 3 cost or idea batches run at once so one slow batch can't block every
goal; `giving` retries Supabase's brief "JWT issued at future" clock errors.

## 27. How Parallax works, and mistake reports

`#/how` explains where every number comes from, what the AI does, and the limits, with sections
linkable as `#/how/<section>` (map, status, time, research, cost, funding, posts, ideas, money,
limits, mistake). It is linked from the first-visit intro, every goal page and Explore.
`schema-reports.sql` adds `mistake_reports` (visitors can add, not read; at most 30 an hour). The
daily health check lists new reports in its GitHub issue (links and @-mentions removed).

## 28. Alerts (web push)

`schema-push.sql` adds `push_subscriptions` (one row per device with the goals it follows; service
role only) and the `parallax-push` cron (every 15 minutes). The `push` function makes its signing
keys (VAPID) on first use and keeps them in `app_config`, so nothing needs setting up. After someone
follows a goal the site offers alerts; the cron sends new advances, setbacks, solved problems,
bottlenecks and promise checks on followed goals, at most 3 a day per device, and drops devices the
push service says are gone. Works on Android and desktop browsers, and on iPhone once Parallax is
added to the Home Screen (iOS 16.4+).

## 29. Terminal: goal index, radar, catalysts, watchlists

- Goal index (Terminal home), Opportunity radar and Catalysts calendar come from the `terminal`
  function; visitors get samples cut on the server (3 index rows, unnamed radar dots plus 2 named,
  the next 2 catalysts). The radar's opportunity corner is research growth in the top third and
  matched federal funding in the bottom third; "no matching grants" never counts.
- `schema-watchlists.sql`: `watchlists` (a subscriber's goals and alert rules), `radar_opportunities`
  (written by the terminal function, with when each first appeared), `watch_alerts` (sent once),
  `push_subscriptions.user_id`, and a daily `parallax-radar` cron. The `push` function adds each
  paying subscriber's watchlist: posts on watched goals, Phase 2/3 trial readouts and promises due
  within 30 days, and new opportunities; up to 6 alerts a day for subscribers.

## 30. Parallax Plus ($12/month; Pro includes it)

`#/plus` ("Your week in progress"): the weekly brief as a short video in the Watch player (the goals
the person follows first), what's coming next (Phase 2/3 trial readouts and promises coming due) as
cards, and predictions on each ("Will this Phase 2 meet its main goal?"), with everyone's split and
a personal track record once `prediction_results` are filled in. Served by the `plus` function (no
AI); visitors get a sample. `schema-plus.sql`: `predictions` (only paying subscribers can save one),
`prediction_counts`, `prediction_results`. Billing: `{"action":"checkout","tier":"plus"}` creates
Plus prices on first use ($12/month, $120/year; PLUS_PRICE_CENTS / PLUS_YEAR_PRICE_CENTS override);
the Stripe webhook records `plan = 'plus'` for them; the Terminal and watchlists stay Pro-only.

## 31. Pro-only market data: money, the race, the pipeline

Pro shows data the free site never does:

- **Money** (`market` function, USAspending.gov): each goal's federal grant money by quarter, and every new grant of $1M+ in the last 90 days, matched to a problem. Searches use the phrases already checked for each goal's problems, but only those that carry the goal's subject words; a grant counts only when a phrase is in its description and the subject appears near the start (its title). Weekly per goal, cron `parallax-market` at :19.
- **The race**: per goal, organizations ranked by combined share of grant money (last 12 months, with rank a year earlier), active trials they sponsor and papers (goal_intel). Biggest movers: broke into a top 10 or climbed 5+ places.
- **Pipeline** (`evidence` function writes `trial_pipeline`): every active trial on the health goals with phase, sponsor and type, size and results date. `POST evidence {"pipeline":"<slug>"}` refills one goal without redoing grants.

Run `setup/schema-market.sql` once. Previews are cut on the server: one grant, three names, counts only.

## 32. Plus predictions resolve themselves

Run `setup/schema-plus-resolve.sql` once (questions table, `void` outcome, daily cron `parallax-resolve` at 06:41 UTC), and deploy the `resolve` function (`verify_jwt` true).

- The `plus` function saves every question it shows to `prediction_questions`, so a question can still be settled after it leaves "Coming up".
- **Promises:** the promises function's verdict decides. Kept is yes; partly kept or broken is no; unclear stays open.
- **Trials:** checked weekly once their results month has passed (ClinicalTrials.gov).
  - Withdrawn: void. Calls on it don't count.
  - Stopped early: no, unless it stopped because it worked.
  - Posted p-values for the main outcome: any below 0.05 is yes, otherwise no.
  - Otherwise: Claude (Sonnet, about a cent) reads the posted results text and the earliest papers naming the trial number (Europe PMC: free, no daily budget). Its answer is yes, no or unclear; unclear stays open.
- Everyone who made a call gets a push alert when it settles ("You called it ✓"), once per question.
- Test one question without saving: `POST resolve {"key":"trial:NCT...","dry":true}`.

## 33. Crossovers: problems shared between goals

Run `setup/schema-crossovers.sql` once (the `crossovers` table with public read, the candidate function, and cron `parallax-crossovers` every 6 hours). Deploy the `crossovers` function with `verify_jwt` true.

- **Papers:** problem pairs in different goals that cite at least 5 of the same papers.
- **Claude:** two short calls per goal (titles only, cents). The first checks the paper pairs and proposes overlaps papers missed. The second is a strict check that drops analogies.
  - Rejected pairs stay in the table as `rejected`, so later scans don't add them back.
  - Every goal is re-checked monthly. New goals go first.
  - `POST crossovers {"action":"audit"}` re-checks every AI-found link.
- **Pro:** a Crossovers tab with three parts:
  - the goal web (tap a line to see the shared problems);
  - keystone problems (clusters of linked problems, most goals first);
  - ripples (moves and big grants on one goal that reach another), flagged new since your last visit. Overview leads with them.
- **Free:** posts on a shared problem say "Also moves @Goal".
- **Plus:** "Ripple of the week" card and video scene.
- **Alerts:** Pro watchlists have a "Ripples from other goals" switch, on by default. A move from the last 3 days, or a $5M+ grant, on another goal that reaches a watched goal sends one alert per goal, once.

## 34. The weekly email (Plus and Pro)

Run `setup/schema-digest.sql` once. It creates `email_prefs` (weekly on by default, plus a one-click unsubscribe token) and the cron `parallax-digest`, which runs Mondays at 13:13 UTC with a catch-up at 15:13.

Deploy `digest` with **verify_jwt false**, because the unsubscribe link is opened straight from an email. Admin actions check `x-parallax-admin`.

- **Content:** the week in 30 seconds, ripples (Pro), new $1M+ grants (Pro), your settled calls and record, and what's coming up. Goals you watch, or get alerts for, come first.
- **Sending:** through Resend. Add the secret `RESEND_API_KEY` in Supabase (Edge Functions → Secrets). Until a domain is verified in Resend, its test sender can only email the Resend account's own address. After verifying a domain, add the secret `DIGEST_FROM`, e.g. `Parallax <weekly@yourdomain>`.
- **Test:**
  - `POST digest {"action":"test","email":"you@…"}` sends one now.
  - `GET digest?action=preview&email=…` (admin header) shows the email as a web page.
- **Off switch in the app:** Pro → Calendar → Watchlist → Email, and on the Plus page.

## 35. Prices

**Current prices:** Plus is $12/month or $120/year. Pro is $55/month or $550/year.

**Changing a price:** set `PLUS_PRICE_CENTS`, `PLUS_YEAR_PRICE_CENTS`, `TERMINAL_PRICE_CENTS` or `TERMINAL_YEAR_PRICE_CENTS`, or edit the defaults in `billing`, `plus` and `terminal`.

- On the next checkout, `billing` creates a new Stripe price and moves the lookup key onto it (`transfer_lookup_key`). Existing subscribers keep the price they signed up at.
- Every price carries `metadata.tier` (`plus` or `pro`), and `stripe-webhook` reads it. That way, an old price that has lost its lookup key still maps to the right plan.
