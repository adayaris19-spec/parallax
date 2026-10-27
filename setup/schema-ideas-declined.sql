-- PARALLAX: problems the AI declines to write ideas for (vaccine and pathogen biology). The goal
-- page shows the trials already testing approaches there instead. Set by the ideas function.
alter table nodes add column if not exists ideas_declined boolean not null default false;
alter table nodes add column if not exists tested_at timestamptz; -- last trial search for a declined problem (evidence function)
