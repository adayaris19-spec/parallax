-- Why a goal matters: the stakes today (with a source when a number is quoted) and what solving it would change.
-- Written by hand for each goal (setup/goal-why.json); shown first on the goal page.
alter table goals add column if not exists why jsonb;
grant select (why) on goals to anon, authenticated;
