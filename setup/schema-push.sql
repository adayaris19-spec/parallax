-- PARALLAX web push: one row per device that turned on alerts, with the goals it follows.
-- Only the push function (service role) reads or writes it.
create table if not exists push_subscriptions (
  endpoint text primary key,
  p256dh text not null,
  auth text not null,
  goals text[] not null default '{}',
  created_at timestamptz not null default now(),
  last_sent_at timestamptz,
  sent_day date,
  sent_count int not null default 0
);
create index if not exists push_subscriptions_goals on push_subscriptions using gin (goals);
alter table push_subscriptions enable row level security;

select cron.unschedule('parallax-push') where exists (select 1 from cron.job where jobname = 'parallax-push');
select cron.schedule('parallax-push', '*/15 * * * *',
  replace(replace((select command from cron.job where jobname = 'parallax-promises'), '/functions/v1/promises', '/functions/v1/push'), '''{}''', '''{"action":"send"}'''));
notify pgrst, 'reload schema';
