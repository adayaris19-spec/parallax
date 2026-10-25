-- PARALLAX funding ("Back a problem") — run after schema-billing.sql.
--
-- Teams (labs, nonprofits, researchers) raise money for problems in a goal's tree. Money goes
-- straight to the team's own Stripe account (Stripe Connect); Parallax keeps 5%.
-- Every write goes through the `fund` function and the Stripe webhook; people only read here.

create table if not exists teams (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null unique references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 80),
  kind text not null default 'lab' check (kind in ('lab', 'nonprofit', 'company', 'individual')),
  website text not null default '' check (char_length(website) <= 200),
  about text not null default '' check (char_length(about) <= 600),
  country text not null default 'US' check (country ~ '^[A-Z]{2}$'),
  stripe_account_id text unique,
  payouts_ready boolean not null default false,  -- Stripe has verified them and can send them money
  approved boolean not null default false,       -- Parallax has reviewed them
  created_at timestamptz not null default now()
);
alter table teams enable row level security;
drop policy if exists "approved teams are public; owners see their own" on teams;
create policy "approved teams are public; owners see their own" on teams for select
  using ((approved and payouts_ready) or owner = auth.uid());
-- The Stripe account id stays private.
revoke select on teams from anon, authenticated;
grant select (id, owner, name, kind, website, about, country, payouts_ready, approved, created_at) on teams to anon, authenticated;

create table if not exists team_problems (
  id bigint generated always as identity primary key,
  team_id uuid not null references teams(id) on delete cascade,
  goal_id bigint not null references goals(id) on delete cascade,
  node_key text not null,
  node_title text not null,
  plan text not null check (char_length(plan) between 20 and 800), -- what the money will do
  target_cents int check (target_cents is null or target_cents between 50000 and 100000000),
  status text not null default 'active' check (status in ('active', 'closed')),
  created_at timestamptz not null default now(),
  unique (team_id, goal_id, node_key)
);
alter table team_problems enable row level security;
drop policy if exists "listings of public teams are public" on team_problems;
create policy "listings of public teams are public" on team_problems for select
  using (exists (select 1 from teams t where t.id = team_id and ((t.approved and t.payouts_ready) or t.owner = auth.uid())));
grant select on team_problems to anon, authenticated;

create table if not exists backings (
  id bigint generated always as identity primary key,
  team_problem_id bigint not null references team_problems(id) on delete restrict,
  user_id uuid references auth.users(id) on delete set null,
  amount_cents int not null check (amount_cents between 500 and 1000000),   -- what the backer gives the problem
  cover_cents int not null default 0,                                       -- optional, covers card fees
  fee_cents int not null,                                                   -- Parallax's 5%
  currency text not null default 'usd',
  display_name text not null default '' check (char_length(display_name) <= 60),
  anonymous boolean not null default false,
  message text not null default '' check (char_length(message) <= 280),
  status text not null default 'pending' check (status in ('pending', 'paid', 'refunded', 'expired')),
  stripe_session_id text unique,
  stripe_payment_intent text,
  created_at timestamptz not null default now(),
  paid_at timestamptz
);
alter table backings enable row level security;
drop policy if exists "people see their own backings" on backings;
create policy "people see their own backings" on backings for select using (user_id = auth.uid());
grant select on backings to authenticated;

-- Public totals. These views run as their owner so they can add up backings without exposing who
-- paid what, except names people chose to show.
create or replace view problem_funding as
  select tp.goal_id, tp.node_key, sum(b.amount_cents)::bigint as raised_cents, count(*)::int as backers
  from backings b join team_problems tp on tp.id = b.team_problem_id
  join teams t on t.id = tp.team_id and t.approved and t.payouts_ready
  where b.status = 'paid' group by tp.goal_id, tp.node_key;
create or replace view team_problem_funding as
  select b.team_problem_id, sum(b.amount_cents)::bigint as raised_cents, count(*)::int as backers
  from backings b where b.status = 'paid' group by b.team_problem_id;
create or replace view recent_backers as
  select b.team_problem_id, case when b.anonymous or b.display_name = '' then 'Someone' else b.display_name end as name,
         b.amount_cents, b.message, b.paid_at
  from backings b where b.status = 'paid' order by b.paid_at desc;
grant select on problem_funding, team_problem_funding, recent_backers to anon, authenticated;

-- Approving a team (after checking it is real):
--   update teams set approved = true where id = '<team id>';
