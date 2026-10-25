-- PARALLAX Ideas lab: Claude proposes ideas for each problem; people react.
-- ideas: written by the `ideas` function (service role). Grounded in the problem's library papers and
-- checked against prior art with web search. idea_reactions: one per person per idea, with an optional note.

create table if not exists ideas (
  id bigserial primary key,
  goal_id bigint not null references goals(id) on delete cascade,
  node_key text not null,
  title text not null,
  pitch text not null,
  mechanism text,
  first_test text,
  test_low bigint, test_high bigint,
  borrowed_from text,
  builds_on jsonb not null default '[]',
  prior_art jsonb not null default '[]',
  novelty text check (novelty in ('new', 'partly', 'tried')),
  novelty_note text,
  risk text,
  status text not null default 'open' check (status in ('open', 'archived')),
  created_at timestamptz not null default now()
);
create index if not exists ideas_goal_idx on ideas(goal_id, node_key);
alter table ideas enable row level security;
drop policy if exists "ideas are public" on ideas;
create policy "ideas are public" on ideas for select using (true);
grant select on ideas to anon, authenticated;

alter table goals add column if not exists ideas_at timestamptz;

create table if not exists idea_reactions (
  idea_id bigint not null references ideas(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  kind text not null check (kind in ('promising', 'flawed', 'tried', 'test')),
  note text not null default '' check (char_length(note) <= 600),
  created_at timestamptz not null default now(),
  primary key (idea_id, user_id)
);
alter table idea_reactions enable row level security;
drop policy if exists "reactions are public" on idea_reactions;
drop policy if exists "people react for themselves" on idea_reactions;
drop policy if exists "people change their own reaction" on idea_reactions;
drop policy if exists "people remove their own reaction" on idea_reactions;
create policy "reactions are public" on idea_reactions for select using (true);
create policy "people react for themselves" on idea_reactions for insert with check (auth.uid() = user_id);
create policy "people change their own reaction" on idea_reactions for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "people remove their own reaction" on idea_reactions for delete using (auth.uid() = user_id);
grant select on idea_reactions to anon;
grant select, insert, update, delete on idea_reactions to authenticated;

-- Counts per idea, and the notes with who wrote them.
create or replace view idea_scores with (security_invoker = true) as
  select idea_id,
    count(*) filter (where kind = 'promising')::int as promising,
    count(*) filter (where kind = 'flawed')::int as flawed,
    count(*) filter (where kind = 'tried')::int as tried,
    count(*) filter (where kind = 'test')::int as test
  from idea_reactions group by idea_id;
create or replace view idea_notes with (security_invoker = true) as
  select r.idea_id, r.kind, r.note, r.created_at, p.handle, p.display_name
  from idea_reactions r join profiles p on p.id = r.user_id
  where r.note <> '';
grant select on idea_scores, idea_notes to anon, authenticated;

-- Idea research runs as Anthropic message batches (no time limit, half price): one run submits,
-- a later run collects. idea_jobs tracks them.
create table if not exists idea_jobs (
  batch_id text primary key,
  goal_id bigint not null references goals(id) on delete cascade,
  keys text[] not null,
  context jsonb not null default '{}',
  status text not null default 'pending' check (status in ('pending', 'done', 'failed')),
  note text,
  created_at timestamptz not null default now()
);
alter table idea_jobs enable row level security; -- service role only

-- Hourly at :27, reusing the admin headers of the promises job.
select cron.unschedule('parallax-ideas') where exists (select 1 from cron.job where jobname = 'parallax-ideas');
select cron.schedule('parallax-ideas', '27 * * * *',
  replace((select command from cron.job where jobname = 'parallax-promises'), '/functions/v1/promises', '/functions/v1/ideas'));
