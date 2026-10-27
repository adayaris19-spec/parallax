-- PARALLAX: people's own work on a problem. A step someone logs ("I did this") can carry a link to
-- what they made. Parallax reviews it (review-work function) and, if it holds up, publishes it on the
-- goal's feed as "Community work". Only the review function may set the review fields.
alter table contributions add column if not exists work_url text;
alter table contributions add column if not exists review_status text not null default 'none'; -- none | pending | published | not_published | unreadable
alter table contributions add column if not exists review jsonb;
alter table contributions add column if not exists reviewed_at timestamptz;
alter table contributions add column if not exists post_id bigint references posts(id) on delete set null;

-- People may add a link to their own steps, nothing else.
drop policy if exists "people update their own contributions" on contributions;
create policy "people update their own contributions" on contributions for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
revoke update on contributions from anon, authenticated;
grant update (work_url, note) on contributions to authenticated;

-- Review fields can't be written from the browser (service role only).
create or replace function parallax_contribution_guard() returns trigger language plpgsql as $$
begin
  if coalesce(current_setting('request.jwt.claims', true)::jsonb->>'role', '') <> 'service_role' then
    if tg_op = 'INSERT' then
      new.review_status := 'none'; new.review := null; new.reviewed_at := null; new.post_id := null;
    else
      new.review_status := old.review_status; new.review := old.review; new.reviewed_at := old.reviewed_at; new.post_id := old.post_id;
    end if;
  end if;
  if new.work_url is not null and new.work_url !~* '^https?://[^ ]+$' then new.work_url := null; end if;
  return new;
end $$;
drop trigger if exists parallax_contribution_guard on contributions;
create trigger parallax_contribution_guard before insert or update on contributions for each row execute function parallax_contribution_guard();
notify pgrst, 'reload schema';
