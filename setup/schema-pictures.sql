-- PARALLAX goal pictures: each goal's approved shots from its videos (photos, and video posters),
-- intro video first. The site uses the first as the goal's avatar and the rest on feed cards.
-- Shots the photo editor approved (in the visuals library) come before any others, so a goal's
-- avatar is never an unchecked clip.
alter table goals add column if not exists pic text;
create or replace view goal_pictures as
  with shots as (
    select r.goal_id, (case when s->'visual'->>'kind' = 'video' then s->'visual'->>'poster' else s->'visual'->>'url' end) as url,
      (r.kind = 'intro') as intro, r.score, ord,
      exists (select 1 from visuals v where v.url = s->'visual'->>'url') as judged
    from reels r, jsonb_array_elements(r.scenes) with ordinality as e(s, ord)
    where coalesce(s->'visual'->>'url', '') <> '' and coalesce(s->'visual'->>'kind', '') <> 'anim'
  ), uniq as (
    select distinct on (goal_id, url) goal_id, url, intro, score, ord, judged from shots where url is not null
    order by goal_id, url, judged desc, intro desc, score desc
  )
  -- goals.pic: an avatar picked by hand (the clearest single subject at circle size) leads when set.
  select u.goal_id, (case when g.pic is not null then array[g.pic] else '{}' end || array_remove(array_agg(u.url order by u.judged desc, u.intro desc, u.score desc, u.ord), g.pic))[1:8] as pics
  from uniq u join goals g on g.id = u.goal_id group by u.goal_id, g.pic;
grant select on goal_pictures to anon, authenticated;
notify pgrst, 'reload schema';
