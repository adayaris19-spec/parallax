-- PARALLAX evidence: real, checkable signals per problem from free public sources (evidence function).
-- source 'grants' = federal grants from USAspending.gov (last 3 years, all agencies);
-- source 'trials' = active or recruiting studies on ClinicalTrials.gov. A row exists only when found.
create table if not exists node_evidence (
  goal_id bigint not null references goals(id) on delete cascade,
  node_key text not null,
  source text not null,
  count int not null,
  amount_cents bigint,
  since_year int,
  top jsonb not null default '[]',
  extra jsonb not null default '{}',
  checked_at timestamptz not null default now(),
  primary key (goal_id, node_key, source)
);
create table if not exists node_evidence_checks (
  goal_id bigint not null references goals(id) on delete cascade,
  node_key text not null,
  checked_at timestamptz not null,
  primary key (goal_id, node_key)
);
alter table node_evidence enable row level security;
alter table node_evidence_checks enable row level security;
drop policy if exists "evidence is public" on node_evidence;
create policy "evidence is public" on node_evidence for select using (true);
grant select on node_evidence to anon, authenticated;
alter table goals add column if not exists evidence_at timestamptz;

-- Every 20 minutes (one goal, or part of one, per run), reusing the admin headers of the promises job.
select cron.unschedule('parallax-evidence') where exists (select 1 from cron.job where jobname = 'parallax-evidence');
select cron.schedule('parallax-evidence', '7,27,47 * * * *',
  replace((select command from cron.job where jobname = 'parallax-promises'), '/functions/v1/promises', '/functions/v1/evidence'));
notify pgrst, 'reload schema';
