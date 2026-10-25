-- PARALLAX reels — the Watch tab. Run after schema-media.sql.
-- Short vertical videos that introduce goals and their news, written by the `reels` function.
-- A reel is a sequence of scenes the site plays like a video: footage or a photo, big captions,
-- and animated numbers from the research.

create table if not exists reels (
  id bigint generated always as identity primary key,
  goal_id bigint not null references goals(id) on delete cascade,
  post_id bigint references posts(id) on delete set null,
  kind text not null check (kind in ('intro', 'breakthrough', 'setback', 'promise', 'people')),
  title text not null,
  scenes jsonb not null,            -- [{caption, sub, stat?: {value, unit, label}, visual?: {kind, url, poster, credit, license, source_url}}]
  score real not null default 0,    -- how strong the reel is, for ordering
  created_at timestamptz not null default now(),
  unique (goal_id, kind, post_id)
);
create unique index if not exists reels_one_intro on reels (goal_id) where kind = 'intro';
alter table reels enable row level security;
drop policy if exists "reels are public" on reels;
create policy "reels are public" on reels for select using (true);
grant select on reels to anon, authenticated;

alter table goals add column if not exists reels_at timestamptz;

select cron.unschedule(jobname) from cron.job where jobname = 'parallax-reels';
select cron.schedule('parallax-reels', '51 */2 * * *',
  replace((select command from cron.job where jobname = 'parallax-promises'), '/functions/v1/promises', '/functions/v1/reels'));
