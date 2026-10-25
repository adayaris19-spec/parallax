-- PARALLAX giving: donations to registered US nonprofits working on a goal, through Every.org.
-- Parallax never holds the money: Every.org takes the gift, pays the nonprofit and sends the receipt.
-- goal_orgs: nonprofits researched for each goal, each verified as a 501(c)(3) in IRS data (ProPublica).
-- donations: filled by Every.org's partner webhook, so goal pages can show a live total.

create table if not exists goal_orgs (
  goal_id bigint not null references goals(id) on delete cascade,
  ein text not null check (ein ~ '^[0-9]{9}$'),
  name text not null,
  city text, state text,
  website text,
  why text not null,                 -- one line: what it does for this goal
  focused boolean not null default true,  -- its whole mission is this kind of work (vs. a university)
  problems text[] not null default '{}',
  donate_url text not null,
  position int not null default 0,
  checked_at timestamptz not null default now(),
  primary key (goal_id, ein)
);
alter table goal_orgs enable row level security;
drop policy if exists "orgs are public" on goal_orgs;
create policy "orgs are public" on goal_orgs for select using (true);
grant select on goal_orgs to anon, authenticated;
alter table goals add column if not exists orgs_at timestamptz;

create table if not exists donations (
  charge_id text primary key,
  goal_id bigint references goals(id) on delete set null,
  ein text,
  org_name text,
  amount_cents bigint not null,
  donor_name text,                   -- only when the donor chose to share it
  frequency text,
  status text not null default 'completed',
  created_at timestamptz not null default now()
);
alter table donations enable row level security; -- written by the webhook only

-- Public: totals per goal and the latest gifts (first name and amount only).
create or replace view goal_giving as
  select goal_id, sum(amount_cents)::bigint as raised_cents, count(*)::int as gifts, max(created_at) as last_at
  from donations where status = 'completed' and goal_id is not null group by goal_id;
create or replace view recent_gifts as
  select goal_id, org_name, amount_cents, coalesce(nullif(split_part(donor_name, ' ', 1), ''), 'Someone') as who, created_at
  from donations where status = 'completed' and goal_id is not null order by created_at desc limit 200;
grant select on goal_giving, recent_gifts to anon, authenticated;

-- Hourly at :33, reusing the admin headers of the promises job.
select cron.unschedule('parallax-orgs') where exists (select 1 from cron.job where jobname = 'parallax-orgs');
select cron.schedule('parallax-orgs', '33 * * * *',
  replace((select command from cron.job where jobname = 'parallax-promises'), '/functions/v1/promises', '/functions/v1/orgs'));
alter table goal_orgs add column if not exists logo_url text; alter table goal_orgs add column if not exists claimed boolean not null default false;

-- Settings. site_config is public (read by the site); app_config is private (service role only).
create table if not exists site_config (key text primary key, value text not null default '');
alter table site_config enable row level security;
drop policy if exists "site config is public" on site_config;
create policy "site config is public" on site_config for select using (true);
grant select on site_config to anon, authenticated;
create table if not exists app_config (key text primary key, value text not null);
alter table app_config enable row level security;
-- The key in Every.org's webhook address, so only Every.org can record donations.
insert into app_config (key, value) values ('every_webhook_key', encode(gen_random_bytes(18), 'hex')) on conflict (key) do nothing;
-- Every.org's partner webhook token goes on donate links once Every.org issues it.
insert into site_config (key, value) values ('every_webhook_token', '') on conflict (key) do nothing;
