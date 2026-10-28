-- PARALLAX terminal cache: the Pro report takes seconds to build and is the same for everyone with
-- the same access, so the terminal function keeps a copy for 5 minutes. Service role only.
create table if not exists terminal_cache (full_access boolean primary key, body jsonb not null, at timestamptz not null default now());
alter table terminal_cache enable row level security;
