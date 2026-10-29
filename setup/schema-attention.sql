-- PARALLAX attention: goal page visits per day, so AI spend follows what people actually look at.
-- The expensive extras (cost estimates, ideas, videos) go to goals with followers or recent visits;
-- a goal nobody has visited in 30 days waits until someone does.

create table if not exists goal_views (
  goal_id bigint not null references goals(id) on delete cascade,
  day date not null default current_date,
  views int not null default 0,
  primary key (goal_id, day)
);
alter table goal_views enable row level security; -- written only through parallax_view()

create or replace function parallax_view(g bigint) returns void
language sql security definer set search_path = public as $$
  insert into goal_views (goal_id, day, views) values (g, current_date, 1)
  on conflict (goal_id, day) do update set views = goal_views.views + 1;
$$;
revoke all on function parallax_view(bigint) from public;
grant execute on function parallax_view(bigint) to anon, authenticated;

-- A follower counts like 5 visits.
create or replace view goal_attention as
  select g.id as goal_id,
    coalesce(f.followers, 0) as followers,
    coalesce(v.views, 0) as views_30d,
    coalesce(f.followers, 0) * 5 + coalesce(v.views, 0) as score
  from goals g
  left join goal_followers f on f.goal_id = g.id
  left join (select goal_id, sum(views)::int as views from goal_views where day > current_date - 30 group by 1) v on v.goal_id = g.id;
revoke all on goal_attention from anon, authenticated;

-- Feed "Popular" order: one score per goal (followers x5 + visits in 30 days), nothing personal.
create or replace view goal_popularity as select goal_id, score from goal_attention;
grant select on goal_popularity to anon, authenticated;
