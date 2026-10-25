-- PARALLAX cost estimates: what each problem would take, researched by Claude with web search.
-- next_*: the next concrete step that would move the problem forward. solve_*: solving it for this goal.
-- Amounts in US dollars. Sources are pages Claude actually found while researching.

create table if not exists node_costs (
  goal_id bigint not null references goals(id) on delete cascade,
  node_key text not null,
  next_step text not null,
  next_low bigint, next_high bigint,
  next_time text,
  solve_low bigint, solve_high bigint,
  funders text,
  basis text,
  confidence text check (confidence in ('low', 'medium', 'high')),
  sources jsonb not null default '[]',
  estimated_at timestamptz not null default now(),
  primary key (goal_id, node_key)
);
alter table node_costs enable row level security;
drop policy if exists "costs are public" on node_costs;
create policy "costs are public" on node_costs for select using (true);
grant select on node_costs to anon, authenticated;

-- Hourly at :43, reusing the admin headers of the promises job.
select cron.unschedule('parallax-costs') where exists (select 1 from cron.job where jobname = 'parallax-costs');
select cron.schedule('parallax-costs', '43 * * * *',
  replace((select command from cron.job where jobname = 'parallax-promises'), '/functions/v1/promises', '/functions/v1/costs'));
