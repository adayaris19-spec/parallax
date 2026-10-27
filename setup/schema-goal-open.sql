-- PARALLAX: open a goal page in ONE request. Before, the page asked for the goal by slug, waited,
-- then asked for its contents and funding: two round trips before anything showed. Runs with the
-- caller's permissions (row level security still applies). rpc/parallax_goal_open {"s": "fusion"}.
create or replace function parallax_goal_open(s text) returns jsonb
language sql stable security invoker set search_path = public as $$
  select case when g.id is null then null else jsonb_build_object(
    'goal', jsonb_build_object('id', g.id, 'slug', g.slug, 'handle', g.handle, 'name', g.name, 'summary', g.summary,
      'tagline', g.tagline, 'plain_summary', g.plain_summary, 'papers_count', g.papers_count, 'media', g.media,
      'status', g.status, 'stage', g.stage, 'progress', g.progress, 'horizon_low', g.horizon_low, 'horizon_high', g.horizon_high,
      'horizon_note', g.horizon_note, 'bottleneck_key', g.bottleneck_key, 'error', g.error, 'created_at', g.created_at,
      'mapped_at', g.mapped_at, 'pulsed_at', g.pulsed_at),
    'page', case when g.status = 'ready' then parallax_goal_page(g.id) end,
    'listings', coalesce((select jsonb_agg(jsonb_build_object('id', tp.id, 'node_key', tp.node_key, 'node_title', tp.node_title,
        'plan', tp.plan, 'target_cents', tp.target_cents,
        'teams', (select jsonb_build_object('id', t.id, 'name', t.name, 'kind', t.kind, 'website', t.website, 'country', t.country, 'about', t.about) from teams t where t.id = tp.team_id))
        order by tp.created_at) from team_problems tp where tp.goal_id = g.id and tp.status = 'active'), '[]'),
    'per_node', coalesce((select jsonb_agg(jsonb_build_object('node_key', f.node_key, 'raised_cents', f.raised_cents, 'backers', f.backers))
        from problem_funding f where f.goal_id = g.id), '[]'),
    -- Challenges on the goal's problems, with how many people are on each.
    'challenges', coalesce((select jsonb_agg(jsonb_build_object('id', ch.id, 'node_key', ch.node_key, 'title', ch.title, 'useful', ch.useful, 'task', ch.task,
        'done_when', ch.done_when, 'resources', ch.resources, 'skills', ch.skills, 'size', ch.size, 'status', ch.status, 'solved_post_id', ch.solved_post_id,
        'solved_by', (select p.meta->>'by_handle' from posts p where p.id = ch.solved_post_id),
        'takers', (select count(*) from challenge_takers t where t.challenge_id = ch.id)) order by ch.id)
        from challenges ch where ch.goal_id = g.id and ch.status <> 'retired'), '[]'),
    -- People's ratings and notes on the goal's ideas (the Ideas section shows them).
    'idea_scores', coalesce((select jsonb_agg(jsonb_build_object('idea_id', sc.idea_id, 'promising', sc.promising, 'flawed', sc.flawed, 'tried', sc.tried, 'test', sc.test))
        from idea_scores sc where sc.idea_id in (select i.id from ideas i where i.goal_id = g.id and i.status = 'open')), '[]'),
    'idea_notes', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (select n.idea_id, n.kind, n.note, n.created_at, n.handle, n.display_name
        from idea_notes n where n.idea_id in (select i.id from ideas i where i.goal_id = g.id and i.status = 'open') order by n.created_at desc limit 500) x), '[]')
  ) end
  from (select 1) one left join goals g on g.slug = s;
$$;
grant execute on function parallax_goal_open(text) to anon, authenticated;
notify pgrst, 'reload schema';
