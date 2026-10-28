-- PARALLAX daily stories: the story circles at the top of the feed, one fresh 3-4 slide story per
-- goal per day (written by the `stories` function), different from the Watch videos.
create table if not exists daily_stories (
  goal_id bigint not null references goals(id) on delete cascade,
  day date not null,
  title text,
  slides jsonb not null,
  created_at timestamptz not null default now(),
  primary key (goal_id, day)
);
alter table daily_stories enable row level security;
drop policy if exists "daily stories are public" on daily_stories;
create policy "daily stories are public" on daily_stories for select using (true);
grant select on daily_stories to anon, authenticated;
notify pgrst, 'reload schema';
-- Hourly at :53 (up to 6 goals a run, so every goal has its story by early morning UTC).
-- The command copies the reels job's (same project URL and keys), pointed at /functions/v1/stories.
select cron.unschedule('parallax-stories') where exists (select 1 from cron.job where jobname = 'parallax-stories');
select cron.schedule('parallax-stories', '53 * * * *',
  replace((select command from cron.job where jobname = 'parallax-reels'), '/functions/v1/reels', '/functions/v1/stories'));
