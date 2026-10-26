-- PARALLAX health check. parallax_health() lists what needs attention, one row per problem:
-- failing background jobs, stuck AI batches, goals missing a piece, failed mappings.
-- The GitHub workflow .github/workflows/health.yml calls it daily and opens (or closes) an issue.
-- It reveals only short status lines, so the site's public key may call it.
create or replace function parallax_health()
returns table (level text, area text, message text)
language plpgsql security definer set search_path = public, net, cron as $$
declare r record;
begin
  -- Background jobs that answered with an error in the last 6 hours (pg_net keeps about 6 hours).
  -- Timeouts are left out: long jobs keep running after the scheduler stops waiting.
  for r in
    select coalesce(
      substring(replace(content, '\"', '"') from '"message":"([^"]{1,160})'),
      substring(replace(content, '\"', '"') from '"error":"([^"]{1,160})'),
      left(content, 160), 'no message') as msg, count(*) as n, max(created) as last
    from net._http_response
    where created > now() - interval '6 hours' and status_code >= 400
    group by 1 order by 2 desc limit 8
  loop
    level := case when r.n >= 3 then 'error' else 'warning' end; area := 'background jobs';
    message := format('%s× in the last 6 hours (last %s UTC): %s', r.n, to_char(r.last at time zone 'utc', 'HH24:MI'), r.msg);
    return next;
  end loop;

  -- Scheduler entries that failed to run at all.
  for r in
    select j.jobname, count(*) as n, max(d.return_message) as msg
    from cron.job_run_details d join cron.job j on j.jobid = d.jobid
    where d.start_time > now() - interval '24 hours' and d.status = 'failed'
    group by 1
  loop
    level := 'error'; area := 'scheduler'; message := format('%s failed %s× in 24 hours: %s', r.jobname, r.n, left(r.msg, 160)); return next;
  end loop;

  -- AI batches still pending after 6 hours (they normally finish within about an hour).
  for r in
    select 'videos' as what, count(*) as n, min(created_at) as oldest from reel_jobs where status = 'pending' and created_at < now() - interval '6 hours'
    union all select 'ideas', count(*), min(created_at) from idea_jobs where status = 'pending' and created_at < now() - interval '6 hours'
    union all select 'cost estimates', count(*), min(created_at) from cost_jobs where status = 'pending' and created_at < now() - interval '6 hours'
    union all select 'pulse checks', count(*), min(created_at) from pulse_jobs where status = 'pending' and created_at < now() - interval '6 hours'
  loop
    if r.n > 0 then level := 'warning'; area := 'AI batches'; message := format('%s %s batch(es) pending since %s UTC', r.n, r.what, to_char(r.oldest at time zone 'utc', 'Mon DD HH24:MI')); return next; end if;
  end loop;

  -- Goals that failed to map.
  for r in select slug, coalesce(error, 'no message') as err from goals where status = 'failed' loop
    level := 'error'; area := 'goals'; message := format('%s failed to map: %s', r.slug, left(r.err, 160)); return next;
  end loop;

  -- Ready goals missing a piece 8 hours after they were mapped.
  for r in
    select g.slug, array_remove(array[
      case when g.library_at is null then 'research library' end,
      case when g.counts_at is null then 'research counts' end,
      case when not exists (select 1 from goal_orgs o where o.goal_id = g.id) then 'charities (money box)' end,
      case when not exists (select 1 from node_costs c where c.goal_id = g.id) then 'cost estimates' end,
      case when not exists (select 1 from ideas i where i.goal_id = g.id) then 'ideas' end,
      case when not exists (select 1 from reels v where v.goal_id = g.id) then 'videos' end,
      case when g.evidence_at is null then 'funding and trials' end
    ], null) as missing
    from goals g
    where g.status = 'ready' and coalesce(g.mapped_at, g.created_at) < now() - interval '8 hours'
  loop
    if cardinality(r.missing) > 0 then level := 'warning'; area := 'goal pages'; message := format('%s is missing: %s', r.slug, array_to_string(r.missing, ', ')); return next; end if;
  end loop;

  -- Money box: charities without a donation page.
  for r in
    select count(*) as n from goal_orgs o where not exists (select 1 from goal_fundraisers f where f.goal_id = o.goal_id and f.ein = o.ein)
  loop
    if r.n > 0 then level := 'warning'; area := 'giving'; message := format('%s charities have no Every.org donation page yet', r.n); return next; end if;
  end loop;

  -- Mistake reports from visitors in the last 24 hours (text shortened, links and @-mentions removed).
  for r in
    select m.page, regexp_replace(regexp_replace(left(m.message, 220), 'https?://\S+', '[link]', 'g'), '@', '', 'g') as msg, m.created_at
    from mistake_reports m where m.created_at > now() - interval '24 hours' order by m.created_at desc limit 10
  loop
    level := 'warning'; area := 'mistake report'; message := format('%s · %s', coalesce(nullif(r.page, ''), 'no page'), r.msg); return next;
  end loop;

  -- Nothing seeded for a day while the queue still has goals.
  if exists (select 1 from seed_queue where sent_at is null)
     and not exists (select 1 from goals where created_at > now() - interval '24 hours') then
    level := 'warning'; area := 'seeding'; message := 'No new goal in 24 hours although the queue still has some'; return next;
  end if;
end $$;
revoke all on function parallax_health() from public;
grant execute on function parallax_health() to anon, authenticated, service_role;
notify pgrst, 'reload schema';
