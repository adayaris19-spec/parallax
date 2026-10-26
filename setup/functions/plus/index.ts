// PARALLAX plus — Supabase Edge Function named `plus`. "Your week" for Parallax Plus ($20/month; Pro
// includes it): the weekly brief as a short video, what's coming next (trial readouts and promises
// coming due) and predictions. No AI here: everything comes from data Parallax already has.
// Request: POST {} with the person's access token (or none, for the sample).
// Answer:  {access: "full" | "preview", brief, coming, counts, mine, results, price, year_price}
const SB = Deno.env.get("SUPABASE_URL")!;
const SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PLUS_CENTS = Number(Deno.env.get("PLUS_PRICE_CENTS") ?? "2000");
const PLUS_YEAR_CENTS = Number(Deno.env.get("PLUS_YEAR_PRICE_CENTS") ?? String(PLUS_CENTS * 10));
const PAID = ["active", "trialing", "comp"];
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

// deno-lint-ignore no-explicit-any
async function db(path: string): Promise<any[]> {
  const r = await fetch(`${SB}/rest/v1/${path}`, { headers: { apikey: SRK, Authorization: `Bearer ${SRK}` } });
  if (!r.ok) throw new Error(`database ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}
async function userId(req: Request): Promise<string | null> {
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const r = await fetch(`${SB}/auth/v1/user`, { headers: { apikey: SRK, Authorization: `Bearer ${token}` } });
  if (!r.ok) return null;
  const u = await r.json().catch(() => null);
  return typeof u?.id === "string" ? u.id : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  try {
    const uid = await userId(req);
    const sub = uid ? (await db(`subscriptions?user_id=eq.${uid}&select=status,plan`))[0] : null;
    const full = !!sub && PAID.includes(sub.status); // Plus or Pro
    const Y = new Date().getUTCFullYear();
    const [briefs, goals, evidence, promises, counts, results, mine] = await Promise.all([
      db("briefs?select=week,content&order=id.desc&limit=1"),
      db("goals?status=eq.ready&select=id,slug,handle,name"),
      db("node_evidence?source=eq.trials&select=goal_id,node_key,extra"),
      db(`promises?status=eq.pending&due_year=gte.${Y}&due_year=lte.${Y + 2}&select=id,goal_id,node_key,claim,made_year,due_year&order=due_year.asc&limit=200`),
      db("prediction_counts?select=key,yes,no"),
      db("prediction_results?select=key,outcome,note,resolved_at,source_url"),
      uid ? db(`predictions?user_id=eq.${uid}&select=key,choice`) : Promise.resolve([]),
    ]);
    const goalOf = new Map(goals.map((g) => [g.id, g]));
    // What's coming: Phase 2/3 readouts in the next 18 months, then promises coming due.
    // deno-lint-ignore no-explicit-any
    const coming: any[] = [];
    const seen = new Set<string>();
    for (const e of evidence) for (const t of e.extra?.upcoming ?? []) {
      const g = goalOf.get(e.goal_id); if (!g || seen.has(t.nct)) continue; seen.add(t.nct);
      coming.push({ key: `trial:${t.nct}`, kind: "trial", date: t.date, goal: g.handle, slug: g.slug, node: e.node_key, title: t.title, detail: [t.phase, t.sponsor].filter(Boolean).join(" · "), url: `https://clinicaltrials.gov/study/${t.nct}`,
        question: `Will this ${t.phase || "trial"} meet its main goal?` });
    }
    for (const p of promises) {
      const g = goalOf.get(p.goal_id); if (!g) continue;
      coming.push({ key: `promise:${p.id}`, kind: "promise", date: String(p.due_year), goal: g.handle, slug: g.slug, node: p.node_key, title: p.claim, detail: `Promised in ${p.made_year}, due ${p.due_year}`, url: null,
        question: `Will this promise be kept by ${p.due_year}?` });
    }
    coming.sort((a, b) => a.date.localeCompare(b.date));
    // Remember every question shown, so it can be resolved after it leaves "Coming up" (resolve function).
    if (coming.length) await fetch(`${SB}/rest/v1/prediction_questions?on_conflict=key`, {
      method: "POST", headers: { apikey: SRK, Authorization: `Bearer ${SRK}`, "Content-Type": "application/json", Prefer: "resolution=ignore-duplicates,return=minimal" },
      body: JSON.stringify(coming.map((c) => ({ key: c.key, kind: c.kind, title: c.title, question: c.question, url: c.url, due: c.date, goal_id: goals.find((g) => g.slug === c.slug)?.id ?? null, node_key: c.node }))),
    }).catch(() => {});
    // Settled questions: the person's own calls, and anything settled in the last 60 days.
    const comingKeys = new Set(coming.map((c) => c.key));
    const myKeys = new Set(mine.map((m: { key: string }) => m.key));
    const recent = Date.now() - 60 * 86_400_000;
    const wanted = [...new Set([...results.filter((r) => myKeys.has(r.key) || new Date(r.resolved_at).getTime() > recent).map((r) => r.key), ...[...myKeys].filter((k) => !comingKeys.has(k))])];
    const qs = wanted.length ? await db(`prediction_questions?key=in.(${wanted.map((k) => `"${k}"`).join(",")})&select=key,kind,title,question,url,due,goal_id,status_note`) : [];
    const card = (q: { key: string; kind: string; title: string; question: string; url: string | null; due: string; goal_id: number; status_note: string | null }) => {
      const g = goalOf.get(q.goal_id);
      return g ? { key: q.key, kind: q.kind, date: q.due, goal: g.handle, slug: g.slug, title: q.title, question: q.question, url: q.url, status_note: q.status_note } : null;
    };
    const settled = qs.filter((q: { key: string }) => results.some((r) => r.key === q.key)).map(card).filter(Boolean)
      .sort((a, b) => String(results.find((r) => r.key === b!.key)?.resolved_at).localeCompare(String(results.find((r) => r.key === a!.key)?.resolved_at)));
    const waiting = qs.filter((q: { key: string }) => myKeys.has(q.key) && !results.some((r) => r.key === q.key)).map(card).filter(Boolean);
    const b = briefs[0] ? { week: briefs[0].week, ...briefs[0].content } : null;
    return json({
      access: full ? "full" : "preview",
      signed_in: !!uid,
      plan: sub?.plan ?? null,
      price: `$${(PLUS_CENTS / 100).toFixed(0)}/month`, year_price: `$${(PLUS_YEAR_CENTS / 100).toFixed(0)}/year`,
      // The sample: the brief's headline and first item, the next coming event, one question.
      brief: b ? (full ? b : { week: b.week, headline: b.headline, tldr: (b.tldr ?? []).slice(0, 1), moved: (b.moved ?? []).slice(0, 1) }) : null,
      coming: full ? coming : coming.slice(0, 1),
      coming_total: coming.length,
      counts: full ? counts : counts.filter((c) => c.key === coming[0]?.key),
      results,
      settled: full ? settled : settled.slice(0, 1), // the sample: the latest one
      waiting: full ? waiting : [],
      mine: full ? mine : [],
    });
  } catch (e) {
    console.error("plus failed:", e instanceof Error ? e.message : e);
    return json({ error: "Your week could not load right now. Please try again in a minute." }, 500);
  }
});
