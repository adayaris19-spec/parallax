-- PARALLAX challenges: concrete, bounded pieces of a problem that someone could solve from home
-- (public data, code, models, analysis), each with a measurable "done when". Written once per problem by
-- the challenges function and shared by everyone. People take them on and submit their work, which
-- review-work judges against the challenge's own bar.
create table if not exists challenges (
  id bigint generated always as identity primary key,
  goal_id bigint not null references goals(id) on delete cascade,
  node_key text not null,
  title text not null,
  useful text not null,      -- what it unblocks: who would use the result and how
  task text not null,        -- what to build or find
  done_when text not null,   -- the measurable bar
  resources jsonb not null default '[]',  -- [{title, url}] checked to be reachable
  skills text[] not null default '{}',
  size text,                 -- "a weekend", "1-2 weeks", "a month"
  status text not null default 'open',    -- open | solved | retired
  solved_post_id bigint references posts(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists challenges_goal on challenges(goal_id, node_key);
alter table challenges enable row level security;
drop policy if exists "challenges are public" on challenges;
create policy "challenges are public" on challenges for select using (true);
grant select on challenges to anon, authenticated;

-- People working on a challenge ("3 people on this").
create table if not exists challenge_takers (
  challenge_id bigint not null references challenges(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  created_at timestamptz not null default now(),
  primary key (challenge_id, user_id)
);
alter table challenge_takers enable row level security;
drop policy if exists "takers are public" on challenge_takers;
create policy "takers are public" on challenge_takers for select using (true);
drop policy if exists "people take challenges" on challenge_takers;
create policy "people take challenges" on challenge_takers for insert with check (auth.uid() = user_id);
drop policy if exists "people drop challenges" on challenge_takers;
create policy "people drop challenges" on challenge_takers for delete using (auth.uid() = user_id);
grant select on challenge_takers to anon, authenticated;
grant insert, delete on challenge_takers to authenticated;

-- A submission is a step (contribution) tied to the challenge it answers.
alter table contributions add column if not exists challenge_id bigint references challenges(id) on delete set null;
alter table goals add column if not exists challenges_at timestamptz;
notify pgrst, 'reload schema';

-- Hourly, reusing the admin headers of the promises job: one goal without challenges per run.
select cron.unschedule('parallax-challenges') where exists (select 1 from cron.job where jobname = 'parallax-challenges');
select cron.schedule('parallax-challenges', '9 * * * *',
  replace((select command from cron.job where jobname = 'parallax-promises'), '/functions/v1/promises', '/functions/v1/challenges'));

-- A person's workspace on a challenge they took on: status, their own to-do list and notes (private).
create table if not exists challenge_work (
  challenge_id bigint not null references challenges(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  status text not null default 'working',  -- working | ready | submitted
  todos jsonb not null default '[]',        -- [{t, done}]
  notes text not null default '',
  updated_at timestamptz not null default now(),
  primary key (challenge_id, user_id)
);
alter table challenge_work enable row level security;
drop policy if exists "own workspace" on challenge_work;
create policy "own workspace" on challenge_work for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
grant select, insert, update, delete on challenge_work to authenticated;
-- Handles of the people on a challenge (public, like follower lists).
create or replace view challenge_people as
  select t.challenge_id, p.handle, p.display_name, t.created_at from challenge_takers t join profiles p on p.id = t.user_id;
grant select on challenge_people to anon, authenticated;
notify pgrst, 'reload schema';
