-- PARALLAX accounts — run in the Supabase SQL Editor after schema-feed.sql.
-- Profiles (public), follows (public, like any social app), follower counts,
-- and account deletion. Sign-in itself is Supabase Auth (Google; email later).

create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  handle text unique not null check (handle ~ '^[A-Za-z0-9_]{3,20}$'),
  display_name text not null default '' check (char_length(display_name) <= 60),
  bio text not null default '' check (char_length(bio) <= 280),
  skills text[] not null default '{}' check (cardinality(skills) <= 12),
  created_at timestamptz not null default now()
);
alter table profiles enable row level security;
drop policy if exists "profiles are public" on profiles;
drop policy if exists "people edit their own profile" on profiles;
create policy "profiles are public" on profiles for select using (true);
create policy "people edit their own profile" on profiles for update
  using (auth.uid() = id) with check (auth.uid() = id);
-- Rows are created by the trigger below, never directly by the site.

create table if not exists follows (
  user_id uuid not null references auth.users(id) on delete cascade,
  goal_id bigint not null references goals(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, goal_id)
);
alter table follows enable row level security;
drop policy if exists "follows are public" on follows;
drop policy if exists "people follow for themselves" on follows;
drop policy if exists "people unfollow for themselves" on follows;
create policy "follows are public" on follows for select using (true);
create policy "people follow for themselves" on follows for insert with check (auth.uid() = user_id);
create policy "people unfollow for themselves" on follows for delete using (auth.uid() = user_id);
create index if not exists follows_goal_idx on follows(goal_id);

create or replace view goal_followers with (security_invoker = true) as
  select goal_id, count(*)::int as followers from follows group by goal_id;
grant select on goal_followers to anon, authenticated;

-- A new account gets a profile with a first name and a unique handle made from it.
create or replace function public.parallax_new_profile() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  first text := split_part(coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', ''), ' ', 1);
  base text := left(regexp_replace(coalesce(nullif(first, ''), split_part(coalesce(new.email, 'member'), '@', 1)), '[^A-Za-z0-9_]', '', 'g'), 14);
  h text;
begin
  if char_length(base) < 3 then base := 'member'; end if;
  h := base;
  while exists (select 1 from profiles where lower(handle) = lower(h)) loop
    h := base || (floor(random() * 9000) + 1000)::int;
  end loop;
  insert into profiles (id, handle, display_name) values (new.id, h, left(first, 60));
  return new;
end;
$$;
drop trigger if exists parallax_on_new_user on auth.users;
create trigger parallax_on_new_user after insert on auth.users
  for each row execute function public.parallax_new_profile();

-- Handles are unique regardless of capitals.
create unique index if not exists profiles_handle_lower_idx on profiles (lower(handle));

-- Anyone signed in can delete their own account and everything tied to it.
create or replace function public.delete_my_account() returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  delete from auth.users where id = auth.uid();
end;
$$;
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
