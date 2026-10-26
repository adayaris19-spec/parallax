-- PARALLAX goal pictures: each goal's approved shots from its videos (photos, and video posters),
-- intro video first. The site uses the first as the goal's avatar and the rest on feed cards.
create or replace view goal_pictures as
  with shots as (
    select r.goal_id, (case when s->'visual'->>'kind' = 'video' then s->'visual'->>'poster' else s->'visual'->>'url' end) as url,
      (r.kind = 'intro') as intro, r.score, ord
    from reels r, jsonb_array_elements(r.scenes) with ordinality as e(s, ord)
    where coalesce(s->'visual'->>'url', '') <> ''
  ), uniq as (
    select distinct on (goal_id, url) goal_id, url, intro, score, ord from shots where url is not null
    order by goal_id, url, intro desc, score desc
  )
  select goal_id, (array_agg(url order by intro desc, score desc, ord))[1:8] as pics from uniq group by goal_id;
grant select on goal_pictures to anon, authenticated;
notify pgrst, 'reload schema';
