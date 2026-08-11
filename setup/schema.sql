-- PARALLAX live backend — paste this whole file into Supabase SQL Editor and Run.
-- Creates the two tables the machine writes into, readable by the public site.

create table if not exists records (
  id bigint generated always as identity primary key,
  source text not null,                 -- 'arxiv' | 'ads'
  source_id text not null unique,       -- arXiv id / ADS bibcode (dedupe key)
  title text,
  abstract text,
  authors text,
  url text,
  published_at timestamptz,
  fetched_at timestamptz default now(),
  status text default 'new',            -- 'new' -> 'scored'
  relevance real,                       -- 0..1 from the intelligence gate
  relevant boolean,
  material boolean default false,
  extraction jsonb                      -- extracted measurements / touches
);

create table if not exists findings (
  id bigint generated always as identity primary key,
  record_id bigint references records(id) on delete cascade,
  kind text,                            -- 'material-change'
  title text,
  why text,
  severity int default 2,
  created_at timestamptz default now()
);

-- ---------------------------------------------------------------------------
-- THE SECOND EYE.
--
-- Everything above this line is the published record: what people have said.
-- Everything below is what the sky actually did, and what happens when the two
-- are held against each other.
--
-- A quantity is the unit of comparison. The same quantity — this planet's
-- density, this event's chirp mass — arrives from two directions: measured, by
-- an observatory that puts a number and an error bar on it, and reported, by a
-- paper that states it in an abstract. When those two disagree by more than
-- their combined error bars allow, something is wrong, and which of the two is
-- wrong is not for the machine to decide. It only has to notice.
-- ---------------------------------------------------------------------------

-- MEASURED. One row per quantity per object per observational source. Values
-- are stored twice: as reported by the archive, and normalised to a canonical
-- unit, because a comparison across two archives that disagree about whether a
-- radius is in Earth radii or Jupiter radii is not a discovery, it is a bug.
create table if not exists observations (
  id bigint generated always as identity primary key,
  source text not null,                 -- 'exoplanet-archive' | 'gwosc' | 'sbdb' | ...
  source_id text not null,              -- the archive's own key for this row
  object text not null,                 -- 'Kepler-10 b', 'GW150914', '(3200) Phaethon'
  quantity text not null,               -- 'radius' | 'mass' | 'density' | 'period' | ...
  value double precision,
  err double precision,                 -- symmetric 1-sigma where the archive gives one
  unit text,                            -- as the archive stated it
  value_si double precision,            -- normalised. null when no conversion is known.
  err_si double precision,
  unit_si text,
  epoch timestamptz,                    -- when the measurement refers to, not when we fetched
  ra double precision,
  dec double precision,
  reference text,                       -- the archive's own provenance string
  url text,
  fetched_at timestamptz default now(),
  meta jsonb,
  unique (source, source_id, quantity)
);

-- REPORTED. The same shape, pulled out of a paper's abstract. record_id is the
-- receipt: every reported value can be traced back to the text it came from,
-- which is what makes a claim checkable in eight seconds instead of taken on
-- faith.
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
  year int,                             -- of the paper, so drift over time is visible
  quote text,                           -- the sentence it was taken from
  confidence real,                      -- 0..1, how sure the extraction is
  created_at timestamptz default now()
);

-- THE CLAIM. Minted only from arithmetic on the two tables above — never from
-- a model's opinion. sigma is the whole argument: the disagreement divided by
-- what the two error bars jointly permit. A claim carries the condition that
-- would kill it, because one that cannot be killed is not allowed on the
-- frontier, and it carries the data its figure is drawn from, because a figure
-- that was illustrated rather than computed is decoration.
create table if not exists claims (
  id bigint generated always as identity primary key,
  claim_id text not null unique,        -- 'PARALLAX-2026-04417' — citable, permanent
  kind text not null,                   -- 'tension' | 'orphan' | 'revision' | 'lone-support'
  object text,
  quantity text,
  title text,
  statement text,
  sigma real,                           -- strength of the disagreement
  observed jsonb,                       -- the measured side, with its provenance
  reported jsonb,                       -- the published side, with its receipts
  kill text not null,                   -- what would end this claim
  cost text,                            -- what it would take to check
  figure jsonb,                         -- the data the computed figure is drawn from
  status text default 'open',           -- 'open' | 'confirmed' | 'refuted' | 'withdrawn'
  opened_at timestamptz default now(),
  last_moved_at timestamptz default now(),
  resolved_at timestamptz,
  resolution text                       -- filled when it closes. The scorecard reads this.
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

-- The site reads with the public anon key: allow read-only access.
alter table records      enable row level security;
alter table findings     enable row level security;
alter table observations enable row level security;
alter table measurements enable row level security;
alter table claims       enable row level security;
create policy "public read records"      on records      for select using (true);
create policy "public read findings"     on findings     for select using (true);
create policy "public read observations" on observations for select using (true);
create policy "public read measurements" on measurements for select using (true);
create policy "public read claims"       on claims       for select using (true);

create index if not exists records_status_idx    on records(status);
create index if not exists records_published_idx on records(published_at desc);
create index if not exists obs_object_idx        on observations(object);
create index if not exists obs_quantity_idx      on observations(quantity);
create index if not exists meas_object_idx       on measurements(object);
create index if not exists meas_quantity_idx     on measurements(quantity);
create index if not exists claims_status_idx     on claims(status);
create index if not exists claims_sigma_idx      on claims(sigma desc);
create index if not exists claims_moved_idx      on claims(last_moved_at desc);
