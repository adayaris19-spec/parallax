-- PARALLAX promise keeper — run in the Supabase SQL Editor after schema-feed.sql.
-- Promises are dated claims about the future found in older research ("we expect
-- X by 2015"), quoted word for word, and checked once their deadline has passed.

create table if not exists promises (
  id bigint generated always as identity primary key,
  goal_id bigint not null references goals(id) on delete cascade,
  node_key text,                         -- the problem in the goal's tree it is about
  claim text not null,                   -- the promise in plain words
  quote text not null,                   -- the exact sentence from the paper
  made_year int not null,
  due_year int not null,
  source jsonb not null,                 -- {id,title,url,year,venue,first_author}
  status text not null default 'pending',-- pending | kept | partly | broken | unclear
  verdict text,                          -- what actually happened, in plain words
  verdict_sources jsonb not null default '[]',
  independent_sources int not null default 0,
  checked_at timestamptz,
  created_at timestamptz not null default now(),
  unique (goal_id, quote)
);
alter table promises enable row level security;
drop policy if exists "public read promises" on promises;
create policy "public read promises" on promises for select using (true);
create index if not exists promises_goal_idx on promises(goal_id, due_year);

-- Promise posts carry the quote and verdict with them.
alter table posts add column if not exists meta jsonb;
grant select (meta) on posts to anon, authenticated;

-- When each goal's literature was last searched for promises (not public).
alter table goals add column if not exists promises_checked_at timestamptz;
