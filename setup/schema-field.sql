-- PARALLAX problem field: data for the goal page's instrument.
-- node_years: papers per problem per year (from the library). node_links: problems that share papers.

create or replace view node_years as
  select np.goal_id, np.node_key, p.year, count(*)::int as n
  from node_papers np join papers p on p.id = np.paper_id
  where p.year between 2000 and extract(year from now())::int
  group by 1, 2, 3;

create or replace view node_links as
  select a.goal_id, a.node_key as a, b.node_key as b, count(*)::int as n
  from node_papers a join node_papers b on a.goal_id = b.goal_id and a.paper_id = b.paper_id and a.node_key < b.node_key
  group by 1, 2, 3
  having count(*) >= 3;

grant select on node_years, node_links to anon, authenticated;
