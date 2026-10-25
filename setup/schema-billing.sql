-- PARALLAX billing — run in the Supabase SQL Editor after schema-accounts.sql.
-- One row per account that has (or had) a Parallax Terminal subscription.
-- Written only by the billing and stripe-webhook functions; people can read their own row.

create table if not exists subscriptions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  stripe_customer_id text unique,
  stripe_subscription_id text,
  status text not null default 'none',   -- active | trialing | past_due | canceled | incomplete | unpaid | comp | none
  plan text,
  current_period_end timestamptz,
  updated_at timestamptz not null default now()
);
alter table subscriptions enable row level security;
drop policy if exists "people read their own subscription" on subscriptions;
create policy "people read their own subscription" on subscriptions for select using (auth.uid() = user_id);

-- Complimentary access (the founder, advisors, press): set status to 'comp' by hand, e.g.
--   insert into subscriptions (user_id, status, plan) values ('<user id>', 'comp', 'terminal')
--   on conflict (user_id) do update set status = 'comp';

-- Daily snapshots of every goal, so the Terminal can show how each one moves over time.
create table if not exists goal_snapshots (
  goal_id bigint not null references goals(id) on delete cascade,
  day date not null default current_date,
  progress real,
  leaves int not null default 0,
  solved int not null default 0,
  blocked int not null default 0,
  primary key (goal_id, day)
);
alter table goal_snapshots enable row level security; -- read only through the terminal function

create or replace function parallax_snapshot() returns void language sql security definer set search_path = public as $$
  insert into goal_snapshots (goal_id, day, progress, leaves, solved, blocked)
  select g.id, current_date, g.progress,
         count(n.*) filter (where n.parent_key is not null),
         count(n.*) filter (where n.parent_key is not null and n.status = 'solved'),
         count(n.*) filter (where n.parent_key is not null and n.status = 'blocked')
  from goals g left join nodes n on n.goal_id = g.id
  where g.status = 'ready'
  group by g.id
  on conflict (goal_id, day) do update set progress = excluded.progress, leaves = excluded.leaves,
    solved = excluded.solved, blocked = excluded.blocked;
$$;
revoke execute on function parallax_snapshot() from public, anon, authenticated;

-- Every day at 23:53 UTC (needs the pg_cron extension, already on for the other jobs).
select cron.unschedule('parallax-snapshot-daily') where exists (select 1 from cron.job where jobname = 'parallax-snapshot-daily');
select cron.schedule('parallax-snapshot-daily', '53 23 * * *', 'select parallax_snapshot()');
select parallax_snapshot();
