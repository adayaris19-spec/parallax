-- PARALLAX field counts, stored. The live views timed out (3 s limit for site visitors) once the
-- paper library grew, so node_years and node_links are now materialized views, refreshed after each
-- library run (parallax_refresh_field, called by the library function) and hourly as a backup.

drop view if exists node_years;
drop view if exists node_links;
drop materialized view if exists node_years;
drop materialized view if exists node_links;

create materialized view node_years as
  select np.goal_id, np.node_key, p.year, count(*)::int as n
  from node_papers np join papers p on p.id = np.paper_id
  where p.year between 2000 and extract(year from now())::int
  group by 1, 2, 3;
create unique index node_years_key on node_years (goal_id, node_key, year);

create materialized view node_links as
  select a.goal_id, a.node_key as a, b.node_key as b, count(*)::int as n
  from node_papers a join node_papers b on a.goal_id = b.goal_id and a.paper_id = b.paper_id and a.node_key < b.node_key
  group by 1, 2, 3
  having count(*) >= 3;
create unique index node_links_key on node_links (goal_id, a, b);

grant select on node_years, node_links to anon, authenticated;

create or replace function parallax_refresh_field() returns void
language plpgsql security definer set search_path = public as $$
begin
  refresh materialized view concurrently node_years;
  refresh materialized view concurrently node_links;
end $$;
revoke all on function parallax_refresh_field() from public, anon, authenticated;
grant execute on function parallax_refresh_field() to service_role;

select cron.unschedule('parallax-field') where exists (select 1 from cron.job where jobname = 'parallax-field');
select cron.schedule('parallax-field', '5 * * * *', $$ select parallax_refresh_field(); $$);

notify pgrst, 'reload schema';
