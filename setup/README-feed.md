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
