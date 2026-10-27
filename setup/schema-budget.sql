-- PARALLAX AI budget guard. The Anthropic credit is finite until it refreshes; new goals cost about
-- $2.80 each, and keeping the existing goals running costs about $1.50 a day. New goals pause while
-- (balance − spend since as_of) is below what the remaining days need plus a buffer and one more goal.
-- Update the balance when it changes:  update parallax_budget set balance_usd = 62.82, as_of = now();
create table if not exists parallax_budget (
  id int primary key default 1 check (id = 1),
  balance_usd numeric not null,        -- credit left at as_of
  as_of timestamptz not null default now(),
  refresh_on date not null,            -- the credit refreshes; the guard is off from this day
  daily_usd numeric not null default 1.5,
  buffer_usd numeric not null default 4,
  goal_usd numeric not null default 2.8
);
alter table parallax_budget enable row level security; -- no policies: not public

create or replace function parallax_budget_ok() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select current_date >= b.refresh_on
        or b.balance_usd - coalesce((select sum(cost_usd) from ai_usage where at > b.as_of), 0)
           >= (b.refresh_on - current_date) * b.daily_usd + b.buffer_usd + b.goal_usd
    from parallax_budget b where b.id = 1), true);
$$;

-- What's left, for a quick check.
create or replace function parallax_budget_status() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('balance_at_start', b.balance_usd, 'since', b.as_of,
    'spent', round(coalesce((select sum(cost_usd) from ai_usage where at > b.as_of), 0)::numeric, 2),
    'left', round((b.balance_usd - coalesce((select sum(cost_usd) from ai_usage where at > b.as_of), 0))::numeric, 2),
    'reserve_for_running', round(((b.refresh_on - current_date) * b.daily_usd + b.buffer_usd)::numeric, 2),
    'new_goals_ok', parallax_budget_ok(), 'refresh_on', b.refresh_on)
  from parallax_budget b where b.id = 1;
$$;
revoke all on function parallax_budget_ok() from public, anon, authenticated;
revoke all on function parallax_budget_status() from public, anon, authenticated;
