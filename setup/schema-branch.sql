-- PARALLAX "your branch" — run in the Supabase SQL Editor after schema-accounts.sql.
-- Each person's matches between their skills and the problems on Parallax.
-- Private: only the person can read their own row. Written by the `branch` function.

create table if not exists branches (
  user_id uuid primary key references auth.users(id) on delete cascade,
  items jsonb not null default '[]',
  basis text,                       -- fingerprint of the skills, bio and follows it was made from
  generated_at timestamptz not null default now(),
  runs_today int not null default 0,
  runs_day date not null default current_date
);
alter table branches enable row level security;
drop policy if exists "people read their own branch" on branches;
create policy "people read their own branch" on branches for select using (auth.uid() = user_id);
create index if not exists branches_generated_idx on branches(generated_at desc);
