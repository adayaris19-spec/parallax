-- PARALLAX shared libraries: work done once, reused by every goal.
-- visuals: every photo or video the photo editor approved (8/10+), with what it shows. A new video
--   scene that wants the same kind of shot reuses one instead of searching and judging again.
-- budget_facts: every cost figure found while estimating (program, amount, year, source). A new
--   estimate starts from the figures already known and only searches the web for what is missing.

create table if not exists visuals (
  id bigserial primary key,
  url text not null unique,
  poster text, kind text not null check (kind in ('video', 'image')),
  credit text, license text, source_url text, source text,
  query text not null,           -- what the scene asked for, e.g. "rocket launch at night"
  caption text,                  -- the scene it was approved for
  score int,
  uses int not null default 1,
  tags tsvector generated always as (to_tsvector('english', coalesce(query, '') || ' ' || coalesce(caption, ''))) stored,
  created_at timestamptz not null default now()
);
create index if not exists visuals_tags_idx on visuals using gin(tags);
alter table visuals enable row level security;
drop policy if exists "visuals are public" on visuals;
create policy "visuals are public" on visuals for select using (true);
grant select on visuals to anon, authenticated;

create table if not exists budget_facts (
  id bigserial primary key,
  fact text not null,            -- "NASA awarded SpaceX $2.89B for the Starship lunar lander (2021)"
  amount_usd bigint,
  year int,
  source_title text, source_url text,
  goal_id bigint references goals(id) on delete set null,   -- where it was first found
  tags tsvector generated always as (to_tsvector('english', fact)) stored,
  created_at timestamptz not null default now(),
  unique (fact)
);
create index if not exists budget_facts_tags_idx on budget_facts using gin(tags);
alter table budget_facts enable row level security;
drop policy if exists "budget facts are public" on budget_facts;
create policy "budget facts are public" on budget_facts for select using (true);
grant select on budget_facts to anon, authenticated;

-- Best matches for a set of words (any of them), most relevant first.
create or replace function parallax_match_visuals(q text, n int default 6)
returns setof visuals language sql stable as $$
  select * from visuals
  where tags @@ to_tsquery('english', array_to_string(array(select lexeme from unnest(to_tsvector('english', q))), ' | '))
  order by ts_rank(tags, to_tsquery('english', array_to_string(array(select lexeme from unnest(to_tsvector('english', q))), ' | '))) desc, uses asc
  limit n;
$$;
create or replace function parallax_match_facts(q text, n int default 30)
returns setof budget_facts language sql stable as $$
  select * from budget_facts
  where tags @@ to_tsquery('english', array_to_string(array(select lexeme from unnest(to_tsvector('english', q))), ' | '))
  order by ts_rank(tags, to_tsquery('english', array_to_string(array(select lexeme from unnest(to_tsvector('english', q))), ' | '))) desc
  limit n;
$$;

create or replace function parallax_visual_used(vid bigint) returns void
language sql security definer set search_path = public as $$ update visuals set uses = uses + 1 where id = vid; $$;
revoke all on function parallax_visual_used(bigint) from public, anon, authenticated;
