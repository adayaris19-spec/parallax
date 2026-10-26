-- PARALLAX weekly email for Plus and Pro subscribers (digest function). On by default for paid
-- subscribers; each email has a one-click unsubscribe link (unsub_token), and the switch is in the app.
create table if not exists email_prefs (
  user_id uuid primary key references auth.users(id) on delete cascade default auth.uid(),
  weekly boolean not null default true,
  unsub_token uuid not null default gen_random_uuid(),
  last_sent_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table email_prefs enable row level security;
drop policy if exists "own email prefs" on email_prefs;
create policy "own email prefs" on email_prefs for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
grant select, insert, update on email_prefs to authenticated;

-- Mondays 13:13 UTC (after the weekly brief at 06:47), with a catch-up run at 15:13 (sends skip anyone
-- already sent this week).
select cron.unschedule('parallax-digest') where exists (select 1 from cron.job where jobname = 'parallax-digest');
select cron.schedule('parallax-digest', '13 13,15 * * 1',
  replace((select command from cron.job where jobname = 'parallax-push'), '/functions/v1/push', '/functions/v1/digest'));
notify pgrst, 'reload schema';
