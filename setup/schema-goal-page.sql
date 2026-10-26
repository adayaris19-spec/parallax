-- PARALLAX goal page in one request: everything public a goal page shows, as one JSON object
-- (it used to take about 18 requests). Runs with the caller's permissions (row level security
-- still applies). Called as rpc/parallax_goal_page {"gid": 3}.
create or replace function parallax_goal_page(gid bigint) returns jsonb
language sql stable security invoker set search_path = public as $$
  select jsonb_build_object(
    'nodes', coalesce((select jsonb_agg(to_jsonb(x) order by x.position) from (select key, parent_key, position, title, why, status, blocker_kind, blocker, evidence, independent_sources, plain_title, plain_why, plain_blocker from nodes where goal_id = gid) x), '[]'),
    'posts', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (select id, goal_id, node_key, kind, headline, body, plain_headline, plain_body, media, sources, independent_sources, expert_reviewed, reviewer, created_at, meta from posts where goal_id = gid order by created_at desc limit 50) x), '[]'),
    'promises', coalesce((select jsonb_agg(to_jsonb(x) order by x.due_year) from (select id, node_key, claim, quote, made_year, due_year, source, status, verdict, verdict_sources, independent_sources, checked_at from promises where goal_id = gid order by due_year limit 100) x), '[]'),
    'helpers', coalesce((select jsonb_agg(jsonb_build_object('node_key', node_key, 'people', people)) from node_contributors where goal_id = gid), '[]'),
    -- The library sample is only needed for goals whose true research counts aren't in yet.
    'years', case when exists (select 1 from node_field_years where goal_id = gid) then '[]'::jsonb else coalesce((select jsonb_agg(jsonb_build_object('node_key', node_key, 'year', year, 'n', n)) from node_years where goal_id = gid), '[]') end,
    'links', coalesce((select jsonb_agg(jsonb_build_object('a', a, 'b', b, 'n', n)) from node_links where goal_id = gid), '[]'),
    'reels', coalesce((select jsonb_agg(to_jsonb(x)) from (select kind, scenes from reels where goal_id = gid order by score desc limit 6) x), '[]'),
    'costs', coalesce((select jsonb_agg(to_jsonb(x)) from (select node_key, next_step, next_low, next_high, next_time, solve_low, solve_high, funders, basis, confidence, sources from node_costs where goal_id = gid) x), '[]'),
    'ideas', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (select id, goal_id, node_key, title, pitch, mechanism, first_test, test_low, test_high, borrowed_from, builds_on, prior_art, novelty, novelty_note, risk, created_at from ideas where goal_id = gid and status = 'open') x), '[]'),
    'asked', coalesce((select jsonb_agg(jsonb_build_object('node_key', node_key)) from idea_requests where goal_id = gid), '[]'),
    'orgs', coalesce((select jsonb_agg(to_jsonb(x) order by x.position) from (select ein, name, city, state, website, why, focused, claimed, logo_url, donate_url, position from goal_orgs where goal_id = gid) x), '[]'),
    'giving', coalesce((select jsonb_agg(to_jsonb(x)) from (select raised_cents, gifts, last_at from goal_giving where goal_id = gid) x), '[]'),
    'gifts', coalesce((select jsonb_agg(to_jsonb(x)) from (select org_name, amount_cents, who, created_at from recent_gifts where goal_id = gid limit 5) x), '[]'),
    'fundraisers', coalesce((select jsonb_agg(jsonb_build_object('ein', ein, 'url', url)) from goal_fundraisers where goal_id = gid), '[]'),
    'field', coalesce((select jsonb_agg(jsonb_build_object('node_key', node_key, 'year', year, 'n', n)) from node_field_years where goal_id = gid and year >= extract(year from now())::int - 13), '[]'),
    'evidence', coalesce((select jsonb_agg(to_jsonb(x)) from (select node_key, source, count, amount_cents, since_year, top, extra from node_evidence where goal_id = gid) x), '[]')
  );
$$;
grant execute on function parallax_goal_page(bigint) to anon, authenticated;
notify pgrst, 'reload schema';
