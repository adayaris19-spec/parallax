-- PARALLAX mistake reports: anyone can report a mistake from the "How Parallax works" page. Visitors
-- can only add (not read) reports; the daily health check lists new ones for the owner.
create table if not exists mistake_reports (
  id bigint generated always as identity primary key,
  page text not null default '' check (length(page) <= 300),
  message text not null check (length(message) between 3 and 2000),
  created_at timestamptz not null default now()
);
alter table mistake_reports enable row level security;
drop policy if exists "anyone can report" on mistake_reports;
create policy "anyone can report" on mistake_reports for insert to anon, authenticated with check (true);
grant insert on mistake_reports to anon, authenticated;
-- At most 30 reports an hour site-wide, so a flood can't fill the table.
create or replace function parallax_report_limit() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from mistake_reports where created_at > now() - interval '1 hour') >= 30 then
    raise exception 'Too many reports right now. Please try again later.';
  end if;
  return new;
end $$;
drop trigger if exists mistake_reports_limit on mistake_reports;
create trigger mistake_reports_limit before insert on mistake_reports for each row execute function parallax_report_limit();
notify pgrst, 'reload schema';
