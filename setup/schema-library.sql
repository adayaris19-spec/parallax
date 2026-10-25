-- PARALLAX library — run after schema-feed.sql.
-- Every paper and report Parallax has found for each problem, from OpenAlex, NASA's technical
-- reports (NTRS) and PubMed. Filled by the `library` function; the AI reads only the most relevant.

create table if not exists papers (
  id text primary key,            -- 'W2741809807' (OpenAlex), 'ntrs:20190001234', 'pmid:31234567'
  title text not null,
  year int,
  venue text,
  url text,
  first_author text,
  cites int,
  source text not null,           -- openalex | ntrs | pubmed
  created_at timestamptz not null default now()
);
create table if not exists node_papers (
  goal_id bigint not null references goals(id) on delete cascade,
  node_key text not null,
  paper_id text not null references papers(id) on delete cascade,
  rank int not null default 0,     -- order the source returned it in (lower = more relevant)
  primary key (goal_id, node_key, paper_id)
);
create index if not exists node_papers_goal on node_papers (goal_id, node_key, rank);
alter table papers enable row level security;
alter table node_papers enable row level security;
drop policy if exists "papers are public" on papers;
create policy "papers are public" on papers for select using (true);
drop policy if exists "paper links are public" on node_papers;
create policy "paper links are public" on node_papers for select using (true);
grant select on papers, node_papers to anon, authenticated;

alter table goals add column if not exists library_at timestamptz;
alter table goals add column if not exists papers_count int;
grant select (library_at, papers_count) on goals to anon, authenticated;

-- Every 2 hours at :11, grow the library of the goal checked longest ago (monthly per goal).
select cron.unschedule(jobname) from cron.job where jobname = 'parallax-library';
select cron.schedule('parallax-library', '11 */2 * * *',
  replace((select command from cron.job where jobname = 'parallax-promises'), '/functions/v1/promises', '/functions/v1/library'));

create or replace function parallax_goal_paper_count(gid bigint) returns int language sql stable as $$
  select count(distinct paper_id)::int from node_papers where goal_id = gid;
$$;
revoke execute on function parallax_goal_paper_count(bigint) from public, anon, authenticated;

-- Papers in the library by year published, for the Terminal's research chart.
create or replace view library_years as
  select year, count(*)::int as papers from papers where year is not null group by year;
grant select on library_years to anon, authenticated;
