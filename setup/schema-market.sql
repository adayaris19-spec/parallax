-- PARALLAX market data for Pro (market function, USAspending.gov): each goal's federal grant funding
-- by quarter and its top recipients (recent year vs the one before), and new $1M+ grants.
-- Service role only: the terminal function serves it to Pro subscribers.
create table if not exists goal_money (
  goal_id bigint primary key references goals(id) on delete cascade,
  phrases text[] not null default '{}',
  quarters jsonb not null default '[]',
  recipients jsonb not null default '[]',
  updated_at timestamptz not null default now()
);
alter table goal_money enable row level security;
create table if not exists grant_awards (
  goal_id bigint not null references goals(id) on delete cascade,
  award_id text not null,
  node_key text,
  recipient text, agency text, amount bigint, start_date date, description text, url text,
  first_seen timestamptz not null default now(),
  primary key (goal_id, award_id)
);
alter table grant_awards enable row level security;
-- Active trials for health goals, by phase and sponsor (written by the evidence function).
create table if not exists trial_pipeline (
  goal_id bigint not null references goals(id) on delete cascade,
  nct text not null,
  node_key text,
  title text, phase text, status text, sponsor text, sponsor_class text, completion text, enrollment int,
  checked_at timestamptz not null default now(),
  primary key (goal_id, nct)
);
alter table trial_pipeline enable row level security;
alter table goals add column if not exists market_at timestamptz;

select cron.unschedule('parallax-market') where exists (select 1 from cron.job where jobname = 'parallax-market');
select cron.schedule('parallax-market', '19 * * * *',
  replace((select command from cron.job where jobname = 'parallax-promises'), '/functions/v1/promises', '/functions/v1/market'));
notify pgrst, 'reload schema';
