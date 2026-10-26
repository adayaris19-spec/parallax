-- PARALLAX true research volume: papers per year for each problem's search across all of OpenAlex
-- (one group_by request per problem, monthly with the library). The goal page's research bars,
-- momentum and dot sizes use these when present, and fall back to the library sample (node_years).
create table if not exists node_field_years (
  goal_id bigint not null references goals(id) on delete cascade,
  node_key text not null,
  year int not null,
  n int not null,
  primary key (goal_id, node_key, year)
);
alter table node_field_years enable row level security;
drop policy if exists "field years are public" on node_field_years;
create policy "field years are public" on node_field_years for select using (true);
grant select on node_field_years to anon, authenticated;
alter table goals add column if not exists counts_at timestamptz;
notify pgrst, 'reload schema';
