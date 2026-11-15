-- goal_clips: a footage bank per goal for its short Watch videos. Clips found by the reels function's
-- footage_bank action (judged, then double-checked), copied to our storage, not yet used in a video.
create table if not exists goal_clips (
  id bigserial primary key,
  goal_id bigint not null references goals(id) on delete cascade,
  url text not null unique,
  poster text,
  shows text,
  credit text,
  license text,
  source_url text,
  source text,
  vertical boolean default false,
  fit int, quality int, dynamic int, rank int,
  created_at timestamptz default now()
);
create index if not exists goal_clips_goal_idx on goal_clips(goal_id, rank desc);
alter table goal_clips enable row level security;
drop policy if exists "goal clips are public" on goal_clips;
create policy "goal clips are public" on goal_clips for select using (true);
grant select on goal_clips to anon, authenticated;
-- ok: false for a goal's older clips that failed the check (kept only so they are not checked again).
alter table goal_clips add column if not exists ok boolean not null default true;
