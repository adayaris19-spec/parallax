-- PARALLAX batch jobs: background AI work runs through Anthropic's Message Batches API (half price).
-- One call submits, a later call collects. Service role only.

create table if not exists pulse_jobs (
  batch_id text primary key,
  goal_id bigint not null references goals(id) on delete cascade,
  recs jsonb not null, by_leaf jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'done', 'failed')),
  created_at timestamptz not null default now()
);
alter table pulse_jobs enable row level security;

create table if not exists cost_jobs (
  batch_id text primary key,
  goal_id bigint not null references goals(id) on delete cascade,
  chapters jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'done', 'failed')),
  created_at timestamptz not null default now()
);
alter table cost_jobs enable row level security;

-- Anyone signed in can ask for ideas on a problem; the ideas function serves these first.
create table if not exists idea_requests (
  goal_id bigint not null references goals(id) on delete cascade,
  node_key text not null,
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  created_at timestamptz not null default now(),
  primary key (goal_id, node_key)
);
alter table idea_requests enable row level security;
drop policy if exists "requests are public" on idea_requests;
drop policy if exists "people ask for themselves" on idea_requests;
create policy "requests are public" on idea_requests for select using (true);
create policy "people ask for themselves" on idea_requests for insert with check (auth.uid() = user_id);
grant select on idea_requests to anon;
grant select, insert on idea_requests to authenticated;
