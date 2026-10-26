-- PARALLAX Terminal watchlists: subscribers pick goals to watch and what to be alerted about.
-- Alerts go to the devices they turned alerts on from while signed in (push_subscriptions.user_id).
create table if not exists watchlists (
  user_id uuid primary key references auth.users(id) on delete cascade default auth.uid(),
  goals text[] not null default '{}',
  rules jsonb not null default '{"signals": true, "catalysts": true, "opportunities": true}',
  updated_at timestamptz not null default now()
);
alter table watchlists enable row level security;
drop policy if exists "own watchlist" on watchlists;
create policy "own watchlist" on watchlists for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
grant select, insert, update, delete on watchlists to authenticated;

alter table push_subscriptions add column if not exists user_id uuid references auth.users(id) on delete set null;
create index if not exists push_subscriptions_user on push_subscriptions (user_id);

-- Problems in the radar's opportunity corner, with when each first appeared (written by the terminal
-- function), so watchers can be told about new ones.
create table if not exists radar_opportunities (
  goal_id bigint not null references goals(id) on delete cascade,
  node_key text not null,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  primary key (goal_id, node_key)
);
alter table radar_opportunities enable row level security;

-- Alerts already sent per person (catalysts and opportunities), so each is sent once.
create table if not exists watch_alerts (
  user_id uuid not null references auth.users(id) on delete cascade,
  key text not null,
  sent_at timestamptz not null default now(),
  primary key (user_id, key)
);
alter table watch_alerts enable row level security;

-- Refresh the radar daily even when nobody opens the Terminal.
select cron.unschedule('parallax-radar') where exists (select 1 from cron.job where jobname = 'parallax-radar');
select cron.schedule('parallax-radar', '55 5 * * *',
  replace((select command from cron.job where jobname = 'parallax-promises'), '/functions/v1/promises', '/functions/v1/terminal'));
notify pgrst, 'reload schema';
