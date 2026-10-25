// PARALLAX fund — Supabase Edge Function named `fund`. "Back a problem".
//
// Teams (labs, nonprofits, researchers) raise money for problems in a goal's tree. Each team has
// its own Stripe account (Stripe Connect, Express); a backer's payment goes to the team, and
// Parallax keeps 5% as an application fee. Parallax never holds the money.
//
// POST {action, ...} with the person's access token:
//   team_get                     my team, its listings, and a fresh payouts status from Stripe
//   team_save {name, kind, website, about, country}
//   team_onboard                 a Stripe link to verify the team and add its bank account
//   team_dashboard               a link to the team's Stripe dashboard (payouts, tax forms)
//   claim {slug, node_key, plan, target_cents?}   list a problem the team is working on
//   unclaim {id}
//   back {team_problem_id, amount_cents, cover_fees, anonymous, display_name, message}
//                                a Stripe Checkout link; signing in is optional for backers
//   approve {team_id}            admin only (header x-parallax-admin)
//
// Secrets: STRIPE_SECRET_KEY, ADMIN_TOKEN. Optional: SITE_URL, PARALLAX_FEE_BPS (default 500 = 5%).

import Stripe from "npm:stripe@22.6.2";

const SB = Deno.env.get("SUPABASE_URL")!;
const SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SITE = Deno.env.get("SITE_URL") ?? "https://adayaris19-spec.github.io/parallax/";
const ADMIN = Deno.env.get("ADMIN_TOKEN") ?? "";
const FEE_BPS = Number(Deno.env.get("PARALLAX_FEE_BPS") ?? "500");
const MIN = 500, MAX = 1_000_000; // $5 to $10,000

let client: Stripe | null = null;
const stripe = () => (client ??= new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!.trim(), { httpClient: Stripe.createFetchHttpClient() }));

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-parallax-admin",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
class Oops extends Error { constructor(msg: string, public status = 400) { super(msg); } }

async function db(path: string, init: { method?: string; body?: unknown; prefer?: string } = {}) {
  const r = await fetch(`${SB}/rest/v1/${path}`, {
    method: init.method ?? "GET",
    headers: { apikey: SRK, Authorization: `Bearer ${SRK}`, "Content-Type": "application/json", ...(init.prefer ? { Prefer: init.prefer } : {}) },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`database ${r.status} on ${path.split("?")[0]}: ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

async function userFrom(req: Request): Promise<{ id: string; email: string } | null> {
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const r = await fetch(`${SB}/auth/v1/user`, { headers: { apikey: SRK, Authorization: `Bearer ${token}` } });
  if (!r.ok) return null;
  const u = await r.json().catch(() => null);
  return typeof u?.id === "string" ? { id: u.id, email: u.email ?? "" } : null;
}

// Card fees the backer can choose to cover, so the team still gets its full 95%.
export const coverFor = (cents: number) => Math.ceil(cents * 0.029 + 30);
export const feeFor = (cents: number) => Math.round(cents * FEE_BPS / 10_000);

const str = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);
const myTeam = async (uid: string) => (await db(`teams?owner=eq.${uid}&select=*`))[0] ?? null;

// Ask Stripe whether the team can receive money yet, and remember the answer.
// deno-lint-ignore no-explicit-any
async function refreshPayouts(team: any) {
  if (!team?.stripe_account_id) return team;
  const acct = await stripe().accounts.retrieve(team.stripe_account_id);
  const ready = !!acct.details_submitted && acct.capabilities?.transfers === "active";
  if (ready !== team.payouts_ready) await db(`teams?id=eq.${team.id}`, { method: "PATCH", body: { payouts_ready: ready } });
  return { ...team, payouts_ready: ready, needs: acct.requirements?.currently_due?.length ?? 0 };
}

function stripeMessage(e: unknown): string {
  // deno-lint-ignore no-explicit-any
  const err = e as any;
  if (String(err?.message ?? "").includes("signed up for Connect")) return "Stripe Connect is not switched on for this Stripe account yet.";
  if (err?.type?.startsWith?.("Stripe")) return `Stripe: ${String(err.message).slice(0, 200)}`;
  return "";
}

async function handle(req: Request) {
  const body = await req.json().catch(() => ({}));
  const action = String(body.action ?? "");

  if (action === "approve") {
    if (!ADMIN || req.headers.get("x-parallax-admin") !== ADMIN) throw new Oops("not allowed", 403);
    await db(`teams?id=eq.${encodeURIComponent(body.team_id)}`, { method: "PATCH", body: { approved: body.approved !== false } });
    return { ok: true };
  }
  if (!Deno.env.get("STRIPE_SECRET_KEY")) throw new Oops("Payments are not switched on yet.", 503);
  const user = await userFrom(req);

  if (action === "back") {
    const amount = Math.round(Number(body.amount_cents));
    if (!Number.isFinite(amount) || amount < MIN || amount > MAX) throw new Oops("Choose an amount between $5 and $10,000.");
    const tp = (await db(`team_problems?id=eq.${Number(body.team_problem_id)}&status=eq.active&select=id,goal_id,node_key,node_title,team_id`))[0];
    if (!tp) throw new Oops("That listing is no longer raising money.", 404);
    let team = (await db(`teams?id=eq.${tp.team_id}&select=*`))[0];
    team = await refreshPayouts(team);
    if (!team?.approved || !team.payouts_ready || !team.stripe_account_id) throw new Oops("This team cannot receive money right now.", 409);
    const goal = (await db(`goals?id=eq.${tp.goal_id}&select=slug,handle`))[0];
    const cover = body.cover_fees ? coverFor(amount) : 0;
    const fee = feeFor(amount);
    const row = (await db("backings", {
      method: "POST", prefer: "return=representation",
      body: {
        team_problem_id: tp.id, user_id: user?.id ?? null, amount_cents: amount, cover_cents: cover, fee_cents: fee,
        anonymous: !!body.anonymous, display_name: str(body.display_name, 60), message: str(body.message, 280),
      },
    }))[0];
    const back = `${SITE}#/g/${encodeURIComponent(goal.slug)}/tree/${encodeURIComponent(tp.node_key)}`;
    const session = await stripe().checkout.sessions.create({
      mode: "payment",
      line_items: [
        { quantity: 1, price_data: { currency: "usd", unit_amount: amount, product_data: { name: `Back: ${tp.node_title}`.slice(0, 250), description: `For ${team.name}, working on this problem for @${goal.handle} on Parallax.` } } },
        ...(cover ? [{ quantity: 1, price_data: { currency: "usd", unit_amount: cover, product_data: { name: "Card fees, so the team gets the full amount" } } }] : []),
      ],
      payment_intent_data: {
        application_fee_amount: fee + cover,
        transfer_data: { destination: team.stripe_account_id },
        metadata: { backing_id: String(row.id), team_problem_id: String(tp.id) },
        description: `Parallax: ${tp.node_title}`.slice(0, 300),
      },
      customer_email: user?.email || undefined,
      metadata: { kind: "backing", backing_id: String(row.id) },
      success_url: `${back}/backed`,
      cancel_url: back,
    });
    await db(`backings?id=eq.${row.id}`, { method: "PATCH", body: { stripe_session_id: session.id } });
    return { url: session.url };
  }

  if (!user) throw new Oops("Sign in first.", 401);

  if (action === "team_get") {
    let team = await myTeam(user.id);
    if (team) team = await refreshPayouts(team).catch(() => team);
    const listings = team ? await db(`team_problems?team_id=eq.${team.id}&select=id,goal_id,node_key,node_title,plan,target_cents,status,created_at&order=created_at.desc`) : [];
    const totals = listings.length ? await db(`team_problem_funding?team_problem_id=in.(${listings.map((l: { id: number }) => l.id).join(",")})`) : [];
    if (team) { team.has_stripe = !!team.stripe_account_id; delete team.stripe_account_id; }
    return { team, listings, totals, fee_percent: FEE_BPS / 100 };
  }

  if (action === "team_save") {
    const name = str(body.name, 80);
    if (name.length < 2) throw new Oops("Add your team's name.");
    const kind = ["lab", "nonprofit", "company", "individual"].includes(body.kind) ? body.kind : "lab";
    const country = /^[A-Z]{2}$/.test(String(body.country)) ? body.country : "US";
    const website = str(body.website, 200);
    if (website && !/^https?:\/\//i.test(website)) throw new Oops("The website should start with https://");
    const fields = { name, kind, website, about: str(body.about, 600), country };
    const team = await myTeam(user.id);
    if (team?.stripe_account_id && team.country !== country) throw new Oops("The country can't change after payouts are set up.");
    if (team) await db(`teams?id=eq.${team.id}`, { method: "PATCH", body: fields });
    else await db("teams", { method: "POST", prefer: "return=minimal", body: { owner: user.id, ...fields } });
    return { ok: true };
  }

  const team = await myTeam(user.id);
  if (!team) throw new Oops("Create your team first.");

  if (action === "team_onboard") {
    let acct = team.stripe_account_id;
    if (!acct) {
      const a = await stripe().accounts.create({
        type: "express",
        country: team.country,
        email: user.email || undefined,
        capabilities: { transfers: { requested: true } },
        business_profile: { name: team.name, url: team.website || undefined, product_description: "Research toward goals listed on Parallax" },
        metadata: { team_id: team.id },
      });
      acct = a.id;
      await db(`teams?id=eq.${team.id}`, { method: "PATCH", body: { stripe_account_id: acct } });
    }
    const link = await stripe().accountLinks.create({ account: acct, type: "account_onboarding", return_url: `${SITE}#/team/ready`, refresh_url: `${SITE}#/team/again` });
    return { url: link.url };
  }

  if (action === "team_dashboard") {
    if (!team.stripe_account_id) throw new Oops("Set up payouts first.");
    const l = await stripe().accounts.createLoginLink(team.stripe_account_id);
    return { url: l.url };
  }

  if (action === "claim") {
    const goal = (await db(`goals?slug=eq.${encodeURIComponent(str(body.slug, 80))}&status=eq.ready&select=id`))[0];
    if (!goal) throw new Oops("That goal was not found.");
    const node = (await db(`nodes?goal_id=eq.${goal.id}&key=eq.${encodeURIComponent(str(body.node_key, 40))}&parent_key=not.is.null&select=key,title,status`))[0];
    if (!node) throw new Oops("That problem was not found.");
    if (node.status === "solved") throw new Oops("That problem is already solved.");
    const plan = str(body.plan, 800);
    if (plan.length < 20) throw new Oops("Say in a sentence or two what the money will do (at least 20 characters).");
    const target = body.target_cents ? Math.round(Number(body.target_cents)) : null;
    if (target != null && (!Number.isFinite(target) || target < 50000 || target > 100000000)) throw new Oops("A target should be between $500 and $1,000,000, or left empty.");
    await db("team_problems?on_conflict=team_id,goal_id,node_key", {
      method: "POST", prefer: "resolution=merge-duplicates,return=minimal",
      body: { team_id: team.id, goal_id: goal.id, node_key: node.key, node_title: node.title.slice(0, 300), plan, target_cents: target, status: "active" },
    });
    return { ok: true };
  }

  if (action === "unclaim") {
    await db(`team_problems?id=eq.${Number(body.id)}&team_id=eq.${team.id}`, { method: "PATCH", body: { status: "closed" } });
    return { ok: true };
  }

  throw new Oops("Unknown action.");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  try {
    return json(await handle(req));
  } catch (e) {
    if (e instanceof Oops) return json({ error: e.message }, e.status);
    const msg = stripeMessage(e);
    console.error("fund failed:", msg || (e instanceof Error ? e.message : e));
    return json({ error: msg || "Something went wrong. Please try again." }, msg ? 400 : 500);
  }
});
