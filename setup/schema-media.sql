-- PARALLAX media and guesses — run after schema-plain.sql.

-- A free picture for each goal and post, found by the `media` function.
-- {url, thumb, credit, license, source_url, source}. Only NASA media (not copyrighted) and
-- Openverse images under CC0, public domain, CC BY or CC BY-SA, always shown with the credit.
alter table goals add column if not exists media jsonb;
alter table posts add column if not exists media jsonb;
alter table posts add column if not exists image_query text;
grant select (media) on goals to anon, authenticated;

-- "When will it happen? Guess." One guess per person (or device) per goal.
create table if not exists guesses (
  goal_id bigint not null references goals(id) on delete cascade,
  who text not null,                     -- user id when signed in, else a random device id
  year int not null check (year between 2025 and 2200),
  created_at timestamptz not null default now(),
  primary key (goal_id, who)
);
alter table guesses enable row level security;   -- written only through guess(), read only as totals

create or replace function guess(goal bigint, yr int, device text) returns json
language plpgsql security definer set search_path = public as $$
declare who_ text := coalesce(auth.uid()::text, 'd:' || left(regexp_replace(coalesce(device, ''), '[^A-Za-z0-9-]', '', 'g'), 40));
begin
  if who_ = 'd:' then raise exception 'no device id'; end if;
  if yr < 2025 or yr > 2200 then raise exception 'year out of range'; end if;
  insert into guesses (goal_id, who, year) values (goal, who_, yr)
    on conflict (goal_id, who) do update set year = excluded.year, created_at = now();
  return (select json_build_object('people', count(*), 'median', percentile_disc(0.5) within group (order by year))
          from guesses where goal_id = goal);
end $$;
grant execute on function guess(bigint, int, text) to anon, authenticated;

create or replace view guess_totals as
  select goal_id, count(*)::int as people, percentile_disc(0.5) within group (order by year) as median
  from guesses group by goal_id;
grant select on guess_totals to anon, authenticated;

select cron.unschedule(jobname) from cron.job where jobname = 'parallax-media';
select cron.schedule('parallax-media', '37 * * * *',
  replace((select command from cron.job where jobname = 'parallax-promises'), '/functions/v1/promises', '/functions/v1/media'));
