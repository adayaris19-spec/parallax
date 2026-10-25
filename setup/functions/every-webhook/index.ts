// PARALLAX every-webhook — Supabase Edge Function named `every-webhook` (Verify JWT OFF: Every.org
// calls it). Every.org's partner webhook reports each completed donation made through a Parallax
// donate link; this records it so goal pages show a live total. The address carries a private key
// (app_config.every_webhook_key) so nobody else can add donations:
//   https://<project>.supabase.co/functions/v1/every-webhook?key=<every_webhook_key>
// Parallax never holds the money: Every.org takes it and pays the nonprofit.

const SB = Deno.env.get("SUPABASE_URL")!;
const SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

async function db(path: string, init: { method?: string; body?: unknown; prefer?: string } = {}) {
  const r = await fetch(`${SB}/rest/v1/${path}`, {
    method: init.method ?? "GET",
    headers: { apikey: SRK, Authorization: `Bearer ${SRK}`, "Content-Type": "application/json", ...(init.prefer ? { Prefer: init.prefer } : {}) },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`database ${r.status}: ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

// deno-lint-ignore no-explicit-any
function metadata(m: any): Record<string, string> {
  if (!m) return {};
  if (typeof m === "object") return m;
  try { return JSON.parse(atob(String(m))); } catch { /* not base64 */ }
  try { return JSON.parse(String(m)); } catch { return {}; }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const key = new URL(req.url).searchParams.get("key") ?? "";
  const want = (await db(`app_config?key=eq.every_webhook_key&select=value`).catch(() => []))[0]?.value;
  if (!want || key !== want) return json({ error: "not allowed" }, 403);
  // deno-lint-ignore no-explicit-any
  const d: any = await req.json().catch(() => null);
  if (!d?.chargeId) return json({ error: "no charge" }, 400);
  const meta = metadata(d.partnerMetadata);
  const goals = meta.goal ? await db(`goals?slug=eq.${encodeURIComponent(meta.goal)}&select=id`) : [];
  const amount = Math.round(Number(String(d.amount ?? "0").replace(/[^0-9.]/g, "")) * 100);
  const name = [d.firstName, d.lastName].filter(Boolean).join(" ").trim();
  await db("donations?on_conflict=charge_id", {
    method: "POST", prefer: "resolution=merge-duplicates,return=minimal",
    body: {
      charge_id: String(d.chargeId), goal_id: goals[0]?.id ?? null, ein: d.toNonprofit?.ein ? String(d.toNonprofit.ein).replace(/\D/g, "") : null,
      org_name: d.toNonprofit?.name ?? null, amount_cents: amount, donor_name: name || null, frequency: d.frequency ?? null,
      status: String(d.status ?? "completed").toLowerCase().includes("fail") ? "failed" : "completed",
    },
  });
  return json({ ok: true });
});
