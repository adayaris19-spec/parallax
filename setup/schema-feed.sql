-- PARALLAX feed — paste this whole file into the Supabase SQL Editor and Run.
-- Adds the tables behind the feed: goals, the tree of each goal, and posts.
-- It does not touch the older `records` / `findings` tables.

create table if not exists goals (
  id bigint generated always as identity primary key,
  slug text not null unique,               -- 'mars'
  handle text not null unique,             -- 'Mars'  (shown as @Mars)
  name text not null,                      -- 'Humans living on Mars'
  summary text,
  requested_as text,                       -- what the person typed
  status text not null default 'mapping',  -- mapping | ready | failed
  stage text not null default 'tree',      -- tree | evidence | assess | synthesize | done
  work jsonb,                              -- working state while mapping
  progress real,                           -- 0..1, share of the tree that is solved
  horizon_low int,                         -- years from mapping date, estimate
  horizon_high int,
  horizon_note text,
  bottleneck_key text,                     -- key of the node holding back the most
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  mapped_at timestamptz,
  pulsed_at timestamptz
);

create table if not exists nodes (
  id bigint generated always as identity primary key,
  goal_id bigint not null references goals(id) on delete cascade,
  key text not null,                       -- 'b2' for a branch, 'b2.3' for a leaf
  parent_key text,                         -- null for a branch
  position int not null default 0,
  title text not null,
  why text,
  status text,                             -- solved | in_progress | blocked | open
  blocker_kind text,                       -- knowledge | materials | instruments | funding | attention | none
  blocker text,
  evidence jsonb not null default '[]',    -- [{id,title,url,year,venue,first_author}]
  independent_sources int not null default 0,
  query text,
  updated_at timestamptz not null default now(),
  unique (goal_id, key)
);

create table if not exists posts (
  id bigint generated always as identity primary key,
  goal_id bigint not null references goals(id) on delete cascade,
  node_key text,
  kind text not null,                      -- mapped | bottleneck | advance | setback | solved | forgotten
  headline text not null,
  body text,
  sources jsonb not null default '[]',     -- [{title,url,year,venue}]
  independent_sources int not null default 0,
  expert_reviewed boolean not null default false,
  reviewer text,
  created_at timestamptz not null default now()
);

-- One row per public search that reached the model, so the hourly cap can be enforced.
-- No read policy: only the Edge Functions (service role) can see it.
create table if not exists map_requests (
  id bigint generated always as identity primary key,
  query text,
  created_at timestamptz not null default now()
);
alter table map_requests enable row level security;
create index if not exists map_requests_created_idx on map_requests(created_at desc);

-- The site reads with the public anon key: read-only access for everyone.
-- All writes happen inside the Edge Functions with the service role key.
alter table goals enable row level security;
alter table nodes enable row level security;
alter table posts enable row level security;
drop policy if exists "public read goals" on goals;
drop policy if exists "public read nodes" on nodes;
drop policy if exists "public read posts" on posts;
create policy "public read goals" on goals for select using (true);
create policy "public read nodes" on nodes for select using (true);
create policy "public read posts" on posts for select using (true);

-- Keep the working state out of public reads: grant every column except `work`.
-- (The site must therefore name its columns; `select=*` on goals is refused.)
revoke select on goals from anon, authenticated;
grant select (id, slug, handle, name, summary, requested_as, status, stage, progress,
              horizon_low, horizon_high, horizon_note, bottleneck_key, error,
              created_at, updated_at, mapped_at, pulsed_at)
  on goals to anon, authenticated;

create index if not exists goals_status_idx on goals(status);
create index if not exists nodes_goal_idx on nodes(goal_id);
create index if not exists posts_created_idx on posts(created_at desc);
create index if not exists posts_goal_idx on posts(goal_id, created_at desc);
