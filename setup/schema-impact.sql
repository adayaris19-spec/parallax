-- PARALLAX impact — run in the Supabase SQL Editor after schema-accounts.sql.
-- Steps people report taking on a problem ("I did it"). Public, like the rest of a
-- profile; self-reported until verification exists.

create table if not exists contributions (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  goal_id bigint not null references goals(id) on delete cascade,
  node_key text not null,
  node_title text not null check (char_length(node_title) <= 300),
  step text not null check (char_length(step) <= 600),      -- the first step that was suggested
  note text not null default '' check (char_length(note) <= 500), -- what they say they did
  created_at timestamptz not null default now(),
  unique (user_id, goal_id, node_key)
);
alter table contributions enable row level security;
drop policy if exists "contributions are public" on contributions;
drop policy if exists "people add their own contributions" on contributions;
drop policy if exists "people remove their own contributions" on contributions;
create policy "contributions are public" on contributions for select using (true);
create policy "people add their own contributions" on contributions for insert with check (auth.uid() = user_id);
create policy "people remove their own contributions" on contributions for delete using (auth.uid() = user_id);
create index if not exists contributions_user_idx on contributions(user_id, created_at desc);
create index if not exists contributions_node_idx on contributions(goal_id, node_key);

-- How many people took a step on each problem.
create or replace view node_contributors with (security_invoker = true) as
  select goal_id, node_key, count(distinct user_id)::int as people from contributions group by goal_id, node_key;
grant select on node_contributors to anon, authenticated;
