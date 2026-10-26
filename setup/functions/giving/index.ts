// PARALLAX giving — Supabase Edge Function named `giving`. Live totals for "Support this goal".
//
// Each goal lists organisations (goal_orgs). For every goal and organisation this creates one Every.org
// fundraiser with Parallax's Every.org API keys (self-serve, no approval), so every gift through
// Parallax lands on a fundraiser Parallax can read. Every 10 minutes it reads each fundraiser's total
// and supporters. When a total goes up, the increase is recorded as a recent gift (Every.org does
// not share names this way). Parallax never holds money: Every.org takes the gift and pays the charity.
//
// POST {} with header x-parallax-admin: <ADMIN_TOKEN>. Secrets: ADMIN_TOKEN, EVERY_PRIVATE_KEY.

const SB = Deno.env.get("SUPABASE_URL")!;
const SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ADMIN = Deno.env.get("ADMIN_TOKEN") ?? "";
const PUB = "pk_live_a811d4b82f70d8c53b438007484bc44b"; // Every.org public key (meant to be public)
const PRIV = Deno.env.get("EVERY_PRIVATE_KEY") ?? "";
const API = "https://partners.every.org/v0.2";
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

async function db(path: string, init: { method?: string; body?: unknown; prefer?: string } = {}, attempt = 0): Promise<any> { // deno-lint-ignore no-explicit-any
  const r = await fetch(`${SB}/rest/v1/${path}`, {
    method: init.method ?? "GET",
    headers: { apikey: SRK, Authorization: `Bearer ${SRK}`, "Content-Type": "application/json", ...(init.prefer ? { Prefer: init.prefer } : {}) },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const text = await r.text();
  // Supabase's servers sometimes disagree by a moment about the time ("JWT issued at future"):
  // waiting a second and trying again succeeds.
  if (r.status === 401 && text.includes("PGRST303") && attempt < 2) { await new Promise((ok) => setTimeout(ok, 1500)); return db(path, init, attempt + 1); }
  if (!r.ok) throw new Error(`database ${r.status}: ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

async function every(path: string, init: RequestInit = {}) {
  for (let i = 0; ; i++) {
    const r = await fetch(`${API}${path}`, { ...init, signal: AbortSignal.timeout(15000) });
    if (r.status === 429 && i < 2) { await r.body?.cancel(); await new Promise((res) => setTimeout(res, 1500 * (i + 1))); continue; }
    const text = await r.text();
    if (!r.ok) throw new Error(`every.org ${r.status} on ${path.split("?")[0]}: ${text.slice(0, 160)}`);
    return JSON.parse(text);
  }
}

// Create the missing fundraisers (one per goal and organisation).
async function create() {
  const [orgs, have, goals] = await Promise.all([
    db(`goal_orgs?select=goal_id,ein,name`),
    db(`goal_fundraisers?select=goal_id,ein`),
    db(`goals?status=eq.ready&select=id,slug,name,tagline`),
  ]);
  const made: string[] = [], errors: string[] = [];
  for (const o of orgs) {
    if (have.some((h: { goal_id: number; ein: string }) => h.goal_id === o.goal_id && h.ein === o.ein)) continue;
    const g = goals.find((x: { id: number }) => x.id === o.goal_id);
    if (!g) continue;
    try {
      const np = (await every(`/nonprofit/${o.ein}?apiKey=${PUB}`)).data.nonprofit;
      const f = (await every(`/fundraiser`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Basic ${btoa(`${PUB}:${PRIV}`)}` },
        body: JSON.stringify({
          nonprofitId: np.id, title: String(g.name).slice(0, 100),
          description: `Raised through Parallax, the feed of human progress. ${g.tagline ? `${g.tagline} ` : ""}Every gift goes to ${o.name} through Every.org.`.slice(0, 1000),
          currency: "USD", goal: null, raisedOffline: null, startDate: null, endDate: null,
        }),
      })).data.fundraiser;
      await db("goal_fundraisers", { method: "POST", prefer: "return=minimal", body: { goal_id: o.goal_id, ein: o.ein, nonprofit_id: np.id, fundraiser_id: f.id, url: `https://www.every.org/${np.primarySlug}/f/${f.slug}` } });
      made.push(`${g.slug}: ${o.name}`);
    } catch (e) { errors.push(`${o.name}: ${String(e).slice(0, 120)}`); }
  }
  return { made, errors };
}

// Read every fundraiser's total; record increases as recent gifts.
async function refresh() {
  const [rows, orgs, cfg] = await Promise.all([
    db(`goal_fundraisers?select=*`),
    db(`goal_orgs?select=goal_id,ein,name`),
    db(`site_config?key=eq.every_webhook_token&select=value`).catch(() => []),
  ]);
  const webhookOn = !!cfg[0]?.value; // with the webhook, gifts are recorded with names instead
  let changed = 0;
  for (const f of rows) {
    try {
      const r = await every(`/nonprofit/${f.nonprofit_id}/fundraiser/${f.fundraiser_id}/raised?apiKey=${PUB}`);
      const raised = Math.round(Number(r.raised ?? 0)), supporters = Number(r.supporters ?? 0);
      if (raised > f.raised_cents && !webhookOn) {
        const org = orgs.find((o: { goal_id: number; ein: string }) => o.goal_id === f.goal_id && o.ein === f.ein);
        await db("donations", { method: "POST", prefer: "return=minimal", body: { charge_id: `seen:${f.fundraiser_id}:${raised}`, goal_id: f.goal_id, ein: f.ein, org_name: org?.name ?? null, amount_cents: raised - f.raised_cents, donor_name: null, status: "completed" } }).catch(() => {});
      }
      if (raised !== f.raised_cents || supporters !== f.supporters) changed++;
      await db(`goal_fundraisers?fundraiser_id=eq.${f.fundraiser_id}`, { method: "PATCH", prefer: "return=minimal", body: { raised_cents: raised, supporters, checked_at: new Date().toISOString() } });
    } catch { /* try again next time */ }
  }
  return { checked: rows.length, changed };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (!ADMIN || req.headers.get("x-parallax-admin") !== ADMIN) return json({ error: "not allowed" }, 403);
  try {
    const created = PRIV ? await create() : { made: [], errors: ["EVERY_PRIVATE_KEY is not set"] };
    return json({ created, refreshed: await refresh() });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message.slice(0, 200) : "failed" }, 500);
  }
});
