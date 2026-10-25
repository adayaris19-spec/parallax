-- PARALLAX intel — run after schema-billing.sql. Data behind the Terminal's paid sections.
-- Read only through the terminal function (RLS on, no policies).

create table if not exists goal_intel (
  goal_id bigint primary key references goals(id) on delete cascade,
  query text,
  years jsonb not null default '[]',         -- [{year, papers}] whole field, last 16 years
  growth real,                               -- last 3 full years vs the 3 before
  papers_3y int,
  institutions jsonb not null default '[]',  -- [{name, papers}] last 3 years
  countries jsonb not null default '[]',     -- [{code, name, papers, share}] last 3 years
  updated_at timestamptz not null default now()
);
alter table goal_intel enable row level security;

create table if not exists briefs (
  id bigint generated always as identity primary key,
  week date not null,
  content jsonb not null,                    -- {headline, summary, moved[], watch[], money[]}
  signals int not null default 0,
  created_at timestamptz not null default now()
);
alter table briefs enable row level security;

-- Schedules reuse the headers of the existing promise-keeper job, so the admin token is not repeated here.
select cron.unschedule(jobname) from cron.job where jobname in ('parallax-intel', 'parallax-brief-weekly');
select cron.schedule('parallax-intel', '29 */2 * * *',
  replace((select command from cron.job where jobname = 'parallax-promises'), '/functions/v1/promises', '/functions/v1/intel'));
select cron.schedule('parallax-brief-weekly', '47 6 * * 1',
  replace(replace((select command from cron.job where jobname = 'parallax-promises'), '/functions/v1/promises', '/functions/v1/intel'),
          '''{}''::jsonb', '''{"action":"brief"}''::jsonb'));
