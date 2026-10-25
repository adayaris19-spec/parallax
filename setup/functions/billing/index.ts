// PARALLAX billing — Supabase Edge Function named `billing`.
//
// Starts a Stripe Checkout for the Parallax Terminal, opens the Stripe billing
// portal (cancel, change card, invoices), or reports the caller's plan. Card
// details only ever go to Stripe's own pages.
//
// Request: POST {"action": "checkout" | "portal" | "status"} with the person's access token.
// Answer:  {"url": "..."} for checkout and portal; {"status": "...", "price": "$49/month"} for status.
//
// The Terminal's product and price are created in Stripe on first use (lookup key
// `parallax_terminal_monthly`), so there is nothing to set up in Stripe by hand
// except the webhook (see setup/README-feed.md).
//
// Secrets: STRIPE_SECRET_KEY (sk_test_... while testing, sk_live_... when live).
// Optional: TERMINAL_PRICE_CENTS (default 4900 = $49/month), SITE_URL.

import Stripe from "npm:stripe@22.6.2";

const SB = Deno.env.get("SUPABASE_URL")!;
const SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SITE = Deno.env.get("SITE_URL") ?? "https://adayaris19-spec.github.io/parallax/";
const CENTS = Number(Deno.env.get("TERMINAL_PRICE_CENTS") ?? "4900");
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

// The Terminal's price, created once and found by its lookup key afterwards.
async function terminalPrice(): Promise<string> {
  const found = await stripeApi().prices.list({ lookup_keys: [LOOKUP], active: true, limit: 1 });
  if (found.data[0]) return found.data[0].id;
  const product = await stripeApi().products.create({
    name: "Parallax Terminal",
    description: "Every goal on Parallax in one view: progress, countdowns, bottlenecks, momentum and promise track record, with exports.",
  });
  const price = await stripeApi().prices.create({
    product: product.id,
    currency: "usd",
    unit_amount: CENTS,
    recurring: { interval: "month" },
    lookup_key: LOOKUP,
  });
  return price.id;
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
      const row = user ? (await db(`subscriptions?user_id=eq.${user.id}&select=status,current_period_end`))?.[0] : null;
      // `stripe` says whether payments can work right now, without exposing anything secret.
      let stripe = "missing key";
      if (Deno.env.get("STRIPE_SECRET_KEY")) {
        try { await stripeApi().balance.retrieve(); stripe = "ok"; } catch (e) { stripe = stripeProblem(e); }
      }
      return json({ status: row?.status ?? "none", current_period_end: row?.current_period_end ?? null, price: priceLabel(CENTS), stripe });
    }
    if (!user) return json({ error: "Sign in first." }, 401);
    if (!Deno.env.get("STRIPE_SECRET_KEY")) return json({ error: "Payments are not switched on yet." }, 503);

    if (body.action === "checkout") {
      const row = (await db(`subscriptions?user_id=eq.${user.id}&select=status`))?.[0];
      if (row && ["active", "trialing", "comp"].includes(row.status)) return json({ already: true });
      const [price, customer] = await Promise.all([terminalPrice(), customerFor(user)]);
      const session = await stripeApi().checkout.sessions.create({
        mode: "subscription",
        customer,
        client_reference_id: user.id,
        line_items: [{ price, quantity: 1 }],
        subscription_data: { metadata: { user_id: user.id } },
        allow_promotion_codes: true,
        success_url: `${SITE}#/terminal/welcome`,
        cancel_url: `${SITE}#/terminal`,
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
