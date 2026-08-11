-- PARALLAX — the second eye. Migration for a project that already has
-- `records` and `findings`.
--
-- Paste this whole file into the Supabase SQL Editor and Run. It is safe to run
-- more than once: every table is `if not exists`, every policy is dropped
-- before it is created, and the view is `create or replace`.
--
-- Do NOT re-run schema.sql on an existing project. Postgres has no
-- `create policy if not exists`, so the policies for `records` and `findings`
-- will fail on the second run. That is the only reason this file exists —
-- the contents below are identical to the new half of schema.sql.

-- MEASURED. One row per quantity per object per observational source. Values
-- are stored twice: as the archive reported them, and normalised to a canonical
-- unit, because a comparison across two archives that disagree about whether a
-- radius is in Earth radii or Jupiter radii is not a discovery, it is a bug.
create table if not exists observations (
  id bigint generated always as identity primary key,
  source text not null,
  source_id text not null,
  object text not null,
  quantity text not null,
  value double precision,
  err double precision,
  unit text,
  value_si double precision,
  err_si double precision,
  unit_si text,
  epoch timestamptz,
  ra double precision,
  dec double precision,
  reference text,
  url text,
  fetched_at timestamptz default now(),
  meta jsonb,
  unique (source, source_id, quantity)
);

-- REPORTED. The same shape, pulled out of a paper's abstract. record_id is the
-- receipt: every reported value traces back to the text it came from.
create table if not exists measurements (
  id bigint generated always as identity primary key,
  record_id bigint references records(id) on delete cascade,
  object text,
  quantity text,
  value double precision,
  err double precision,
  unit text,
  value_si double precision,
  err_si double precision,
  unit_si text,
  year int,
  quote text,
  confidence real,
  created_at timestamptz default now()
);

-- THE CLAIM. Minted only from arithmetic on the two tables above. sigma is the
-- whole argument: the disagreement divided by what the two error bars jointly
-- permit. `kill` is not null because a claim that cannot be killed is not
-- allowed on the frontier.
create table if not exists claims (
  id bigint generated always as identity primary key,
  claim_id text not null unique,
  kind text not null,
  object text,
  quantity text,
  title text,
  statement text,
  sigma real,
  observed jsonb,
  reported jsonb,
  kill text not null,
  cost text,
  figure jsonb,
  status text default 'open',
  opened_at timestamptz default now(),
  last_moved_at timestamptz default now(),
  resolved_at timestamptz,
  resolution text
);

-- The scorecard. Published accuracy is the moat, so the losses have to be as
-- readable as the wins — this view is deliberately not filtered.
create or replace view claim_scorecard as
  select
    kind,
    count(*)                                            as total,
    count(*) filter (where status = 'open')             as still_open,
    count(*) filter (where status = 'confirmed')        as confirmed,
    count(*) filter (where status = 'refuted')          as refuted,
    round(
      count(*) filter (where status = 'confirmed')::numeric
      / nullif(count(*) filter (where status in ('confirmed','refuted')), 0), 3
    )                                                   as hit_rate
  from claims
  group by kind;

alter table observations enable row level security;
alter table measurements enable row level security;
alter table claims       enable row level security;

drop policy if exists "public read observations" on observations;
drop policy if exists "public read measurements" on measurements;
drop policy if exists "public read claims"       on claims;
create policy "public read observations" on observations for select using (true);
create policy "public read measurements" on measurements for select using (true);
create policy "public read claims"       on claims       for select using (true);

create index if not exists obs_object_idx   on observations(object);
create index if not exists obs_quantity_idx on observations(quantity);
create index if not exists meas_object_idx  on measurements(object);
create index if not exists meas_quantity_idx on measurements(quantity);
create index if not exists claims_status_idx on claims(status);
create index if not exists claims_sigma_idx  on claims(sigma desc);
create index if not exists claims_moved_idx  on claims(last_moved_at desc);

-- Did it work? This should return three rows.
select table_name from information_schema.tables
where table_schema = 'public' and table_name in ('observations','measurements','claims')
order by table_name;
