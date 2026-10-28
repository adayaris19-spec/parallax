-- PARALLAX paced seeding — maps the starting goals a few at a time so the free
-- OpenAlex key ($1 of searches a day) is never exhausted by seeding alone.
--
-- Each tick does ONE thing:
--   1. if a goal failed (budget ran out, model unavailable...), retry it (at most 3 times), else
--   2. map the next goal waiting in the queue.
-- A queued goal whose request never produced a goal (the model was down when it was
-- understood) goes back in the queue, at most 3 times.
-- Scheduled every hour (up to 24 goals a day while the budget allows; prepaid OpenAlex credit covers the libraries). Run in the SQL Editor after replacing
-- <ANON_KEY> and <ADMIN_TOKEN>. To stop it: select cron.unschedule('parallax-seed');

create table if not exists seed_queue (
  id bigint generated always as identity primary key,
  query text not null unique,
  sent_at timestamptz
);
alter table seed_queue add column if not exists attempts int not null default 0;
alter table goals add column if not exists retries int not null default 0;
alter table seed_queue enable row level security; -- no policies: not public

insert into seed_queue (query) values
  ('A permanent human base on the Moon'),
  ('Fusion power on the grid'),
  ('Grid-scale storage for renewable energy'),
  ('Cheap, safe solid-state batteries'),
  ('Removing carbon dioxide from the air at gigaton scale'),
  ('Room-temperature superconductors'),
  ('Quantum computers that solve useful problems'),
  ('A cure for Alzheimer''s'),
  ('Detecting cancer early with a blood test'),
  ('Slowing human aging'),
  ('Eradicating malaria'),
  ('Ending tuberculosis'),
  ('A cure for HIV'),
  ('A universal flu vaccine'),
  ('Beating antibiotic-resistant bacteria'),
  ('Stopping the next pandemic before it spreads'),
  ('Lab-grown organs for transplant'),
  ('Repairing spinal cord injuries'),
  ('Restoring sight to the blind'),
  ('Brain-computer interfaces that restore movement and speech'),
  ('Effective treatment for depression for everyone'),
  ('Curing type 1 diabetes'),
  ('Feeding 10 billion people sustainably'),
  ('Clean drinking water for everyone'),
  ('Cheap desalination of seawater'),
  ('Clean air in every city'),
  ('Restoring coral reefs'),
  ('Cleaning plastic out of the oceans'),
  ('Safely disposing of nuclear waste'),
  ('Predicting earthquakes'),
  ('Protecting Earth from asteroid impacts'),
  ('Cleaning up space debris in orbit'),
  ('Finding life beyond Earth'),
  ('Identifying what dark matter is'),
  ('Understanding how consciousness arises in the brain')
on conflict (query) do nothing;

create or replace function parallax_seed_tick() returns text
language plpgsql security definer set search_path = public as $fn$
declare
  fn_url  text := 'https://zfmjjazkmolvywvayjzj.supabase.co/functions/v1/map-goal';
  hdrs    jsonb := jsonb_build_object(
    'Content-Type', 'application/json',
    'Authorization', 'Bearer <ANON_KEY>',
    'x-parallax-admin', '<ADMIN_TOKEN>');
  stuck   text;
  nxt     record;
begin
  update seed_queue q set sent_at = null
   where q.sent_at < now() - interval '90 minutes' and q.attempts < 3
     and not exists (select 1 from goals g where g.requested_as = q.query);

  select slug into stuck from goals
   where status = 'failed' and retries < 3 and updated_at < now() - interval '3 hours'
   order by updated_at asc limit 1;
  if stuck is not null then
    update goals set retries = retries + 1 where slug = stuck;
    perform net.http_post(url := fn_url, headers := hdrs,
      body := jsonb_build_object('continue', stuck, 'retry', true), timeout_milliseconds := 150000);
    return 'retried ' || stuck;
  end if;

  -- Budget guard (schema-budget.sql): new goals pause while the AI credit is needed to keep the
  -- existing goals running until it refreshes. Retries above still run.
  if not parallax_budget_ok() then
    return 'paused: saving the AI budget until it refreshes';
  end if;

  select id, query into nxt from seed_queue where sent_at is null order by id limit 1;
  if nxt.id is null then
    return 'queue empty';
  end if;
  update seed_queue set sent_at = now(), attempts = attempts + 1 where id = nxt.id;
  perform net.http_post(url := fn_url, headers := hdrs,
    body := jsonb_build_object('query', nxt.query), timeout_milliseconds := 150000);
  return 'sent ' || nxt.query;
end;
$fn$;
revoke all on function parallax_seed_tick() from public, anon, authenticated;

select cron.unschedule('parallax-seed') where exists (select 1 from cron.job where jobname = 'parallax-seed');
select cron.schedule('parallax-seed', '17 * * * *', $$ select parallax_seed_tick(); $$);
