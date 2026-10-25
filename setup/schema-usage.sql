-- PARALLAX AI cost log: one row per AI call (written by the edge functions with the service role).
create table if not exists ai_usage (
  id bigserial primary key,
  job text not null,
  model text,
  input_tokens int, output_tokens int, cache_read int, cache_write int,
  searches int not null default 0,
  batch boolean not null default false,
  cost_usd numeric(10,5) not null default 0,
  at timestamptz not null default now()
);
create index if not exists ai_usage_at_idx on ai_usage(at);
alter table ai_usage enable row level security; -- service role only

-- Spend by job, per day (read in the SQL editor or via the Management API).
create or replace view ai_spend as
  select date_trunc('day', at)::date as day, job, count(*)::int as calls, sum(searches)::int as searches,
    round(sum(cost_usd), 2) as usd
  from ai_usage group by 1, 2 order by 1 desc, 5 desc;
revoke all on ai_spend from anon, authenticated;
