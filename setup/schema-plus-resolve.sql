-- PARALLAX Plus: resolving predictions automatically (resolve function, daily).
-- Every question Plus shows is remembered here, so it can still be resolved after it leaves
-- "Coming up" (a trial's date passes, a promise gets judged).
create table if not exists prediction_questions (
  key text primary key,                 -- trial:NCT..., promise:<id>
  kind text not null,
  title text, question text, url text, due text,
  goal_id bigint references goals(id) on delete cascade,
  node_key text,
  first_seen timestamptz not null default now(),
  checked_at timestamptz,
  status_note text                      -- why it is still open (e.g. "completed, no results posted yet")
);
alter table prediction_questions enable row level security; -- service role only (the plus function serves it)

-- 'void': the question can't be answered (trial withdrawn before it started); calls on it don't count.
alter table prediction_results drop constraint if exists prediction_results_outcome_check;
alter table prediction_results add constraint prediction_results_outcome_check check (outcome in ('yes', 'no', 'void'));
alter table prediction_results add column if not exists source_url text;
alter table prediction_results add column if not exists how text; -- rule | ai | promise

select cron.unschedule('parallax-resolve') where exists (select 1 from cron.job where jobname = 'parallax-resolve');
select cron.schedule('parallax-resolve', '41 6 * * *',
  replace((select command from cron.job where jobname = 'parallax-promises'), '/functions/v1/promises', '/functions/v1/resolve'));
notify pgrst, 'reload schema';
