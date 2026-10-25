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

The product and its $49/month price are created in Stripe on the first checkout
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

## 19. Keeping AI costs down

- Every AI call is logged in `ai_usage` (tokens, web searches, estimated price; `schema-usage.sql`).
  Spend by job and day: `select * from ai_spend;` in the SQL editor.
- Background work runs through Anthropic's Message Batches API at half price, with the same model and
  prompts: the daily research check (`pulse`, `schema-batches.sql`), cost estimates and ideas. One
  call submits; a later call collects. Mapping a new goal stays live, because someone is waiting.
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
