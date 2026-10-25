-- PARALLAX plain language — run after schema-feed.sql.
-- Plain-language versions written by the `simplify` function. The originals stay as they are;
-- the site shows the plain version when there is one.

alter table goals add column if not exists tagline text;          -- one sentence: where things stand
alter table goals add column if not exists plain_summary text;
alter table goals add column if not exists simplified_at timestamptz;
grant select (tagline, plain_summary, simplified_at) on goals to anon, authenticated;

alter table nodes add column if not exists plain_title text;
alter table nodes add column if not exists plain_why text;
alter table nodes add column if not exists plain_blocker text;

alter table posts add column if not exists plain_headline text;
alter table posts add column if not exists plain_body text;

-- Every hour at :23, simplify the goal that most needs it (new goals, new posts).
select cron.unschedule(jobname) from cron.job where jobname = 'parallax-simplify';
select cron.schedule('parallax-simplify', '23 * * * *',
  replace((select command from cron.job where jobname = 'parallax-promises'), '/functions/v1/promises', '/functions/v1/simplify'));
