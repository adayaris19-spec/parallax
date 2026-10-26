-- PARALLAX Plus: predictions on what's coming (trial readouts, promises coming due).
-- A person makes one call per question; everyone can see the split; resolutions come later.
create table if not exists predictions (
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  key text not null check (length(key) <= 120),     -- e.g. trial:NCT06335173, promise:42
  choice text not null check (choice in ('yes', 'no')),
  created_at timestamptz not null default now(),
  primary key (user_id, key)
);
alter table predictions enable row level security;
drop policy if exists "own predictions" on predictions;
create policy "own predictions" on predictions for all using (auth.uid() = user_id)
  with check (auth.uid() = user_id and exists (select 1 from subscriptions s where s.user_id = auth.uid() and s.status in ('active', 'trialing', 'comp')));
grant select, insert, update, delete on predictions to authenticated;

-- What everyone thinks, per question (no names).
create or replace view prediction_counts as
  select key, count(*) filter (where choice = 'yes')::int as yes, count(*) filter (where choice = 'no')::int as no
  from predictions group by key;
grant select on prediction_counts to anon, authenticated;

-- How each question turned out (filled in when a readout or promise resolves).
create table if not exists prediction_results (
  key text primary key,
  outcome text not null check (outcome in ('yes', 'no')),
  note text,
  resolved_at timestamptz not null default now()
);
alter table prediction_results enable row level security;
drop policy if exists "results are public" on prediction_results;
create policy "results are public" on prediction_results for select using (true);
grant select on prediction_results to anon, authenticated;
notify pgrst, 'reload schema';
