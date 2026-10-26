-- PARALLAX crossovers: problems shared by two goals, where solving one moves both.
-- Found two ways (crossovers function): research papers the two problems share, and a short Claude
-- pass over every goal's problem titles for overlaps papers miss. Each link carries one sentence on
-- how progress on one helps the other. Public read: the links themselves are free; Pro gets the
-- keystone ranking, ripples and the map built on them.
create table if not exists crossovers (
  goal_a bigint not null references goals(id) on delete cascade,
  key_a text not null,
  goal_b bigint not null references goals(id) on delete cascade,
  key_b text not null,
  shared_papers int not null default 0,
  source text not null default 'papers',   -- papers | ai | both
  why text,
  updated_at timestamptz not null default now(),
  primary key (goal_a, key_a, goal_b, key_b),
  check (goal_a < goal_b)
);
alter table crossovers enable row level security;
drop policy if exists "crossovers are public" on crossovers;
create policy "crossovers are public" on crossovers for select using (true);
grant select on crossovers to anon, authenticated;
alter table goals add column if not exists crossed_at timestamptz;

-- Problem pairs in different goals that cite the same papers (at least 5 in common).
create or replace function parallax_crossover_candidates(min_shared int default 5)
returns table (goal_a bigint, key_a text, goal_b bigint, key_b text, shared int)
language sql stable security definer set search_path = public as $$
  select a.goal_id, a.node_key, b.goal_id, b.node_key, count(*)::int
  from node_papers a join node_papers b on a.paper_id = b.paper_id and a.goal_id < b.goal_id
  group by 1, 2, 3, 4 having count(*) >= min_shared
$$;
revoke all on function parallax_crossover_candidates(int) from anon, authenticated;

select cron.unschedule('parallax-crossovers') where exists (select 1 from cron.job where jobname = 'parallax-crossovers');
select cron.schedule('parallax-crossovers', '33 */6 * * *',
  replace((select command from cron.job where jobname = 'parallax-promises'), '/functions/v1/promises', '/functions/v1/crossovers'));
notify pgrst, 'reload schema';
