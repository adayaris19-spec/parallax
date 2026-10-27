-- PARALLAX goal pictures: each goal's approved shots from its videos (photos, and video posters),
-- intro video first. The site uses the first as the goal's avatar and the rest on feed cards.
-- Shots the photo editor approved (in the visuals library) come before any others, so a goal's
-- avatar is never an unchecked clip.
create or replace view goal_pictures as
  with shots as (
    select r.goal_id, (case when s->'visual'->>'kind' = 'video' then s->'visual'->>'poster' else s->'visual'->>'url' end) as url,
      (r.kind = 'intro') as intro, r.score, ord,
      exists (select 1 from visuals v where v.url = s->'visual'->>'url') as judged
    from reels r, jsonb_array_elements(r.scenes) with ordinality as e(s, ord)
    where coalesce(s->'visual'->>'url', '') <> ''
  ), uniq as (
    select distinct on (goal_id, url) goal_id, url, intro, score, ord, judged from shots where url is not null
    order by goal_id, url, judged desc, intro desc, score desc
  )
  select goal_id, (array_agg(url order by judged desc, intro desc, score desc, ord))[1:8] as pics from uniq group by goal_id;
grant select on goal_pictures to anon, authenticated;
notify pgrst, 'reload schema';
