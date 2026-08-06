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

-- The site reads with the public anon key: allow read-only access.
alter table records enable row level security;
alter table findings enable row level security;
create policy "public read records"  on records  for select using (true);
create policy "public read findings" on findings for select using (true);

create index if not exists records_status_idx    on records(status);
create index if not exists records_published_idx on records(published_at desc);
