# Parallax

Parallax is "the feed of human progress". It follows humanity's biggest goals (26 today: a Moon base, Mars, fusion, curing HIV, ending malaria, clean water, restoring coral reefs, and more) and shows how close each one is, what moved, what's in the way, and how people can help.

Live at https://adayaris19-spec.github.io/parallax (a custom domain, parallaxprogress.com, is planned).

## Product

- **Feed:** sourced posts per goal (advances, setbacks, promises), sortable by Newest, Popular and Following.
- **Watch:** a vertical feed of short videos per goal, unseen first. This is the short-form section; all video work is documented in `docs/shorts/`.
- **Ideas and Challenges:** separate tabs. Ideas are proposals; challenges are tasks people can do from home.
- **Goal pages:** Why it matters → Right now → What it would take → Support → Field → Latest → ideas link.
- **Parallax Plus:** $15/month. Its copy never says "for professionals".
- **Support:** donations via Every.org. There is also a weekly email digest.

## Stack and where things live

- **App:** a single page, `index.html`, served by GitHub Pages from `main`. Bump the cache version in `sw.js` (`px-vNN`) on every `index.html` change.
- **Back end:** Supabase (project `zfmjjazkmolvywvayjzj`).
  - Edge functions are in `setup/functions/<name>/index.ts`.
  - Schemas are in `setup/schema-*.sql`.
  - Deploy a function through the Management API (`/v1/projects/<ref>/functions/deploy?slug=<name>`); the `reels` function uses `verify_jwt: true`.
- **Media:** Cloudflare R2. Videos and renders are under `renders/`.
- **Videos:**
  - Scripts and footage: `setup/functions/reels`.
  - Rendering: `tools/watch-render/`.
  - News video job: `.github/workflows/watch-news.yml`.
- **AI budget:** the `parallax_budget` table, with `parallax_budget_status()` for the balance. Spend is logged in `ai_usage`. The balance refreshes monthly, next on Dec 8 2026.

## How we ship

- Work on the session's branch; commit and push as you go.
- The owner's standing workflow: each finished change goes to `main` by pull request and merge, then the branch is synced with `main`.
- Commit messages end with the attribution lines this session gives. Never put model names in commits, PRs, code comments or docs.
- Never commit secrets, local SQL scratch files, or example MP4s. Store reference videos in R2 instead.

## Owner's standing rules

- **Accuracy:** strict. No AI fluff, no invented numbers. Every public claim traces to a source.
- **Times:** in UTC+1.
- **Show first:** examples before spending money or rolling anything out.
- **No new paid services** or subscriptions unless the owner asks. Small AI costs from the existing budget are fine; report them.
- **Secrets:** never ask the owner to paste secrets or keys in chat. They add them in the Supabase or GitHub dashboards themselves. Don't write to the Supabase secret store, and don't print or store credentials.
- **Privacy:** the owner's email and personal details stay private.
- **Design:** not much green in the Ideas UI.
- **Public repo:** this repository is public; anything committed here is visible to anyone.

## Short-form video

Start with `docs/shorts/SUMMARY.md` (history, verdicts, settled decisions, open problems) and `docs/shorts/MASTER_PROMPT.md` (the plan for the video work). Progress is tracked in `docs/shorts/PROGRESS.md` once that work starts.
