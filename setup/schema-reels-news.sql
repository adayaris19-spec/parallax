-- Watch news videos: one per new post, built without AI from the post's own words (reels function, news_make).
alter table reels drop constraint if exists reels_kind_check;
alter table reels add constraint reels_kind_check check (kind in ('intro', 'breakthrough', 'setback', 'promise', 'people', 'news'));
