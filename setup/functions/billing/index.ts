// PARALLAX billing — Supabase Edge Function named `billing`.
//
// Starts a Stripe Checkout for the Parallax Terminal, opens the Stripe billing
// portal (cancel, change card, invoices), or reports the caller's plan. Card
// details only ever go to Stripe's own pages.
//
// Request: POST {"action": "checkout" | "portal" | "status" | "delete_account"} with the person's access token.
// Answer:  {"url": "..."} for checkout and portal; {"status": "...", "price": "$55/month"} for status.
//
// The Terminal's product and price are created in Stripe on first use (lookup key
// `parallax_terminal_monthly`), so there is nothing to set up in Stripe by hand
// except the webhook (see setup/README-feed.md).
//
// Secrets: STRIPE_SECRET_KEY (sk_test_... while testing, sk_live_... when live).
// Optional: TERMINAL_PRICE_CENTS (default 5500 = $55/month), PLUS_PRICE_CENTS (default 1200 = $12/month), SITE_URL.

import Stripe from "npm:stripe@22.6.2";

const SB = Deno.env.get("SUPABASE_URL")!;
const SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SITE = Deno.env.get("SITE_URL") ?? "https://adayaris19-spec.github.io/parallax/";
const CENTS = Number(Deno.env.get("TERMINAL_PRICE_CENTS") ?? "5500");
const LOOKUP = "parallax_terminal_monthly";

// Made on first use: the library refuses to start without a key, and the key may not be set yet.
let client: Stripe | null = null;
const stripeApi = () => (client ??= new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!.trim(), { httpClient: Stripe.createFetchHttpClient() }));

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

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

async function userFrom(req: Request): Promise<{ id: string; email: string } | null> {
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const r = await fetch(`${SB}/auth/v1/user`, { headers: { apikey: SRK, Authorization: `Bearer ${token}` } });
  if (!r.ok) return null;
  const u = await r.json();
  return typeof u?.id === "string" ? { id: u.id, email: u.email ?? "" } : null;
}

export const priceLabel = (cents: number) => `$${(cents / 100).toFixed(cents % 100 ? 2 : 0)}/month`;

// Yearly plan: 10 months' price for 12 (two months free).
const YEAR_CENTS = Number(Deno.env.get("TERMINAL_YEAR_PRICE_CENTS") ?? String(CENTS * 10));
const LOOKUP_YEAR = "parallax_terminal_yearly";

// Plus ($12/month, $120/year): the weekly video brief, what's coming, predictions. Pro includes it.
const PLUS_CENTS = Number(Deno.env.get("PLUS_PRICE_CENTS") ?? "1200");
// Pro: a free trial for first-time subscribers, card required, charged when it ends unless cancelled.
const TRIAL_DAYS = Number(Deno.env.get("PRO_TRIAL_DAYS") ?? "0"); // off for now; set to 7 to bring it back
const PLUS_YEAR_CENTS = Number(Deno.env.get("PLUS_YEAR_PRICE_CENTS") ?? String(PLUS_CENTS * 10));
// The current price for a lookup key. When the configured amount changes, a new Stripe price takes the
// lookup key; existing subscriptions keep the price they signed up at. Every price carries
// metadata.tier, so the webhook knows Plus from Pro even for old prices without the lookup key.
async function currentPrice(key: string, tier: "plus" | "pro", cents: number, interval: "month" | "year", product: () => Promise<string>): Promise<string> {
  const found = (await stripeApi().prices.list({ lookup_keys: [key], active: true, limit: 1 })).data[0];
  if (found && found.unit_amount === cents) {
    if (found.metadata?.tier !== tier) await stripeApi().prices.update(found.id, { metadata: { tier } });
    return found.id;
  }
  if (found) await stripeApi().prices.update(found.id, { metadata: { tier } }); // keep the old one recognisable
  return (await stripeApi().prices.create({ product: found ? String(found.product) : await product(), currency: "usd", unit_amount: cents, recurring: { interval }, lookup_key: key, transfer_lookup_key: true, metadata: { tier } })).id;
}
async function plusPrice(plan: "month" | "year" = "month"): Promise<string> {
  const key = plan === "year" ? "parallax_plus_yearly" : "parallax_plus_monthly";
  return currentPrice(key, "plus", plan === "year" ? PLUS_YEAR_CENTS : PLUS_CENTS, plan, async () => {
    const other = (await stripeApi().prices.list({ lookup_keys: [plan === "year" ? "parallax_plus_monthly" : "parallax_plus_yearly"], active: true, limit: 1 })).data[0];
    return other ? String(other.product) : (await stripeApi().products.create({ name: "Parallax Plus", description: "Your week in progress: a weekly video brief on the goals you follow, what's coming next, and predictions." })).id;
  });
}

// The Terminal's prices, created once and found by their lookup keys afterwards.
async function terminalPrice(plan: "month" | "year" = "month"): Promise<string> {
  const key = plan === "year" ? LOOKUP_YEAR : LOOKUP;
  return currentPrice(key, "pro", plan === "year" ? YEAR_CENTS : CENTS, plan, async () => {
    const other = (await stripeApi().prices.list({ lookup_keys: [plan === "year" ? LOOKUP : LOOKUP_YEAR], active: true, limit: 1 })).data[0];
    return other ? String(other.product) : (await stripeApi().products.create({ name: "Parallax Pro", description: "Every goal at once: money flows, the race, the trial pipeline, crossovers, opportunities and a weekly brief, with exports." })).id;
  });
}

async function customerFor(user: { id: string; email: string }): Promise<string> {
  const row = (await db(`subscriptions?user_id=eq.${user.id}&select=stripe_customer_id`))?.[0];
  if (row?.stripe_customer_id) return row.stripe_customer_id;
  const c = await stripeApi().customers.create({ email: user.email || undefined, metadata: { user_id: user.id } });
  await db("subscriptions?on_conflict=user_id", {
    method: "POST",
    prefer: "resolution=merge-duplicates,return=minimal",
    body: { user_id: user.id, stripe_customer_id: c.id, updated_at: new Date().toISOString() },
  });
  return c.id;
}

// A short, safe description of a Stripe failure (never includes the key).
// deno-lint-ignore no-explicit-any
function stripeProblem(e: any): string {
  const key = (Deno.env.get("STRIPE_SECRET_KEY") ?? "").trim();
  if (!/^(sk|rk)_(test|live)_/.test(key)) return "the saved key is not a secret key (it should start with sk_test_)";
  if (e?.type === "StripeAuthenticationError") return "Stripe did not accept the key";
  if (e?.type === "StripePermissionError") return "the key is missing permissions";
  return `${e?.type ?? "error"}: ${String(e?.message ?? e).replace(/(sk|rk|pk)_(test|live)_\w+/g, "[key]").slice(0, 160)}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  try {
    const body = await req.json().catch(() => ({}));
    const user = await userFrom(req);
    if (body.action === "status") {
      const row = user ? (await db(`subscriptions?user_id=eq.${user.id}&select=status,plan,current_period_end`))?.[0] : null;
      // `stripe` says whether payments can work right now, without exposing anything secret.
      let stripe = "missing key";
      if (Deno.env.get("STRIPE_SECRET_KEY")) {
        try { await stripeApi().balance.retrieve(); stripe = "ok"; } catch (e) { stripe = stripeProblem(e); }
      }
      return json({ status: row?.status ?? "none", plan: row?.plan ?? null, plus_price: priceLabel(PLUS_CENTS), plus_year_price: `$${(PLUS_YEAR_CENTS / 100).toFixed(0)}/year`, current_period_end: row?.current_period_end ?? null, trial_days: TRIAL_DAYS, price: priceLabel(CENTS), year_price: `$${(YEAR_CENTS / 100).toFixed(YEAR_CENTS % 100 ? 2 : 0)}/year`, stripe });
    }
    if (!user) return json({ error: "Sign in first." }, 401);

    // Deleting an account first cancels any paid plan in Stripe, so nobody is charged for an account
    // that no longer exists; then the account and everything tied to it is removed.
    if (body.action === "delete_account") {
      const row = (await db(`subscriptions?user_id=eq.${user.id}&select=stripe_customer_id`))?.[0];
      if (row?.stripe_customer_id && Deno.env.get("STRIPE_SECRET_KEY")) {
        const subs = await stripeApi().subscriptions.list({ customer: row.stripe_customer_id, status: "all", limit: 20 });
        for (const s of subs.data) if (!["canceled", "incomplete_expired"].includes(s.status)) await stripeApi().subscriptions.cancel(s.id);
      }
      const r = await fetch(`${SB}/auth/v1/admin/users/${user.id}`, { method: "DELETE", headers: { apikey: SRK, Authorization: `Bearer ${SRK}` } });
      if (!r.ok) throw new Error(`delete user ${r.status}: ${(await r.text()).slice(0, 120)}`);
      return json({ deleted: true });
    }
    if (!Deno.env.get("STRIPE_SECRET_KEY")) return json({ error: "Payments are not switched on yet." }, 503);

    if (body.action === "checkout") {
      const row = (await db(`subscriptions?user_id=eq.${user.id}&select=status,plan,stripe_subscription_id`))?.[0];
      const tier = body.tier === "plus" ? "plus" : "pro";
      if (row && ["active", "trialing", "comp"].includes(row.status)) {
        // Already subscribed: Pro covers Plus; moving between plans happens in the billing portal.
        if (row.plan !== "plus" || tier === "plus") return json({ already: true });
        return json({ switch: true, error: "You have Plus. Switch to Pro from Manage billing." });
      }
      const [price, customer] = await Promise.all([tier === "plus" ? plusPrice(body.plan === "year" ? "year" : "month") : terminalPrice(body.plan === "year" ? "year" : "month"), customerFor(user)]);
      // One Pro trial per person: only if they have never had a subscription (here or in Stripe).
      let trial = false;
      if (tier === "pro" && TRIAL_DAYS > 0 && !row?.stripe_subscription_id) trial = !(await stripeApi().subscriptions.list({ customer, status: "all", limit: 1 })).data.length;
      const session = await stripeApi().checkout.sessions.create({
        mode: "subscription",
        customer,
        client_reference_id: user.id,
        line_items: [{ price, quantity: 1 }],
        payment_method_collection: "always", // a card upfront, also for the trial
        subscription_data: { metadata: { user_id: user.id }, ...(trial ? { trial_period_days: TRIAL_DAYS, trial_settings: { end_behavior: { missing_payment_method: "cancel" } } } : {}) },
        allow_promotion_codes: true,
        custom_text: { submit: { message: `Renews automatically until you cancel; cancel any time from Manage billing. By subscribing you accept the Parallax terms (${SITE}#/terms) and privacy policy (${SITE}#/privacy).` } },
        success_url: tier === "plus" ? `${SITE}#/plus` : `${SITE}#/terminal/welcome`,
        cancel_url: tier === "plus" ? `${SITE}#/plus` : `${SITE}#/terminal`,
      });
      return json({ url: session.url });
    }

    if (body.action === "portal") {
      const customer = await customerFor(user);
      const portal = await stripeApi().billingPortal.sessions.create({ customer, return_url: `${SITE}#/terminal` });
      return json({ url: portal.url });
    }
    return json({ error: "Unknown action." }, 400);
  } catch (e) {
    console.error("billing failed:", stripeProblem(e));
    return json({ error: "Billing is unavailable right now. Please try again later." }, 500);
  }
});
