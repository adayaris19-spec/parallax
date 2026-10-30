-- Watch videos rendered offline like the Instagram Reels: one continuous MP4 per reel (footage,
-- crossfades, baked-in text, an original score). {url, poster, dur, starts, v}. The app plays it when
-- present and falls back to the live scene player otherwise.
alter table reels add column if not exists render jsonb;
