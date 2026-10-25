-- PARALLAX V2 — the typed claim graph. Additive next to schema.sql: the v1
-- tables (records, findings) stay, and evidence references records so nothing
-- already ingested is orphaned. Paste into the Supabase SQL editor and run.
--
-- One graph, three sightlines: an OBJECT is described by CLAIMS, a claim rests
-- on EVIDENCE and on other claims, and a VALUE is the adopted synthesis of a
-- claim series over time. Provenance is a column, not a convention. A dossier
-- is a query over these tables, not a document.

-- a body, site, sample, mission or instrument
create table if not exists objects (
  id bigint generated always as identity primary key,
  kind text not null,                   -- 'asteroid' | 'body' | 'site' | 'sample' | 'mission' | 'instrument'
  designation text not null unique,     -- '101955 Bennu', 'OSIRIS-REx', 'lunar south pole'
  names text[],                         -- aliases the record uses
  parent_id bigint references objects(id),  -- a sample belongs to a mission belongs to a body
  orbit jsonb,                          -- for small bodies: SBDB elements, verbatim
  meta jsonb,
  created_at timestamptz default now()
);

-- a typed assertion, optionally about an object
create table if not exists claims (
  id bigint generated always as identity primary key,
  object_id bigint references objects(id) on delete set null,
  statement text not null,              -- plain sentence, physics words
  provenance text not null,             -- 'measured' | 'calculated' | 'assumed' | 'proposed' | 'claim'
  status text not null default 'open',  -- 'supported' | 'contested' | 'unsupported' | 'refuted' | 'as-heard' | 'open'
  quantity text,                        -- parameter name when the claim carries a number
  value numeric, uncertainty numeric, unit text,
  first_asserted int,                   -- year the record first carries it (the era ladder writes this)
  meta jsonb,
  created_at timestamptz default now()
);

-- a paper, dataset or analysis run: where a claim's support actually lives
create table if not exists evidence (
  id bigint generated always as identity primary key,
  record_id bigint references records(id) on delete set null,  -- v1 continuity: papers stay in records
  dataset_ref text,                     -- PDS product id, SBDB query, MAST obs id …
  instrument text, technique text,      -- 'OVIRS', 'liquid chromatography–mass spectrometry'
  lab text, aliquot text,               -- 'NASA Goddard astrobiology lab', 'OREX-803'
  year int,
  meta jsonb,
  created_at timestamptz default now()
);

-- the edges. claim↔evidence carries stance; claim↔claim carries the assumption
-- chains ('rests_on' is what the causal-provenance figure draws).
create table if not exists claim_edges (
  id bigint generated always as identity primary key,
  claim_id bigint not null references claims(id) on delete cascade,
  evidence_id bigint references evidence(id) on delete cascade,
  rests_on_claim_id bigint references claims(id) on delete cascade,
  stance text not null,                 -- 'supports' | 'contradicts' | 'replicates' | 'rests_on'
  sigma numeric,                        -- tension in sigma, when computable
  created_at timestamptz default now(),
  check (num_nonnulls(evidence_id, rests_on_claim_id) = 1)
);

-- parameter × object: every historical determination, exactly one adopted
create table if not exists value_series (
  id bigint generated always as identity primary key,
  object_id bigint references objects(id) on delete cascade,
  parameter text not null,              -- 'bulk density', 'mean diameter'
  value numeric not null, uncertainty numeric, unit text,
  provenance text not null,             -- same five classes
  year int not null,
  evidence_id bigint references evidence(id) on delete set null,
  adopted boolean default false,
  created_at timestamptz default now()
);

-- the site reads with the public anon key: read-only, like v1
alter table objects      enable row level security;
alter table claims       enable row level security;
alter table evidence     enable row level security;
alter table claim_edges  enable row level security;
alter table value_series enable row level security;
create policy "public read objects"      on objects      for select using (true);
create policy "public read claims"       on claims       for select using (true);
create policy "public read evidence"     on evidence     for select using (true);
create policy "public read claim_edges"  on claim_edges  for select using (true);
create policy "public read value_series" on value_series for select using (true);

create index if not exists claims_object_idx     on claims(object_id);
create index if not exists claims_status_idx     on claims(status);
create index if not exists edges_claim_idx       on claim_edges(claim_id);
create index if not exists values_param_idx      on value_series(object_id, parameter);
-- exactly one adopted value per parameter per object
create unique index if not exists values_adopted_one
  on value_series(object_id, parameter) where adopted;
