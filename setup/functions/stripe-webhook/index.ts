// PARALLAX stripe-webhook — Supabase Edge Function named `stripe-webhook`.
// Deploy with "Verify JWT" OFF: Stripe calls it, and it checks Stripe's signature instead.
//
// Keeps the `subscriptions` table in step with Stripe: a finished checkout, a
// renewal, a failed payment or a cancellation all update the person's status.
// Also marks backings ("Back a problem") paid, or refunded.
//
// In Stripe: Developers -> Webhooks -> Add endpoint
//   URL:    https://<project>.supabase.co/functions/v1/stripe-webhook
//   Events: checkout.session.completed, customer.subscription.created,
//           customer.subscription.updated, customer.subscription.deleted, charge.refunded
// Then copy the endpoint's signing secret into the Supabase secret STRIPE_WEBHOOK_SECRET.
//
// Secrets: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET.

import Stripe from "npm:stripe@22.6.2";

const SB = Deno.env.get("SUPABASE_URL")!;
const SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
// Made on first use: the library refuses to start without a key, and the key may not be set yet.
let client: Stripe | null = null;
const stripeApi = () => (client ??= new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, { httpClient: Stripe.createFetchHttpClient() }));
const crypto = Stripe.createSubtleCryptoProvider();

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
async function record(sub: any, fallbackUser?: string | null) {
  const customer = typeof sub.customer === "string" ? sub.customer : sub.customer?.id;
  let userId: string | null = sub.metadata?.user_id ?? fallbackUser ?? null;
  if (!userId && customer) userId = (await db(`subscriptions?stripe_customer_id=eq.${customer}&select=user_id`))?.[0]?.user_id ?? null;
  if (!userId) return "no user";
  // A complimentary account stays complimentary whatever Stripe says.
  const current = (await db(`subscriptions?user_id=eq.${userId}&select=status`))?.[0];
  if (current?.status === "comp") return "comp kept";
  // The period end moved from the subscription onto its items in newer API versions.
  const end = sub.current_period_end ?? sub.items?.data?.[0]?.current_period_end ?? null;
  await db("subscriptions?on_conflict=user_id", {
    method: "POST",
    prefer: "resolution=merge-duplicates,return=minimal",
    body: {
      user_id: userId,
      stripe_customer_id: customer ?? null,
      stripe_subscription_id: sub.id,
      status: sub.status,
      plan: "terminal",
      current_period_end: end ? new Date(end * 1000).toISOString() : null,
      updated_at: new Date().toISOString(),
    },
  });
  return `${userId} -> ${sub.status}`;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("POST only", { status: 405 });
  if (!Deno.env.get("STRIPE_SECRET_KEY") || !Deno.env.get("STRIPE_WEBHOOK_SECRET")) return new Response("not configured", { status: 503 });
  const sig = req.headers.get("stripe-signature") ?? "";
  const raw = await req.text();
  let event: Stripe.Event;
  try {
    event = await stripeApi().webhooks.constructEventAsync(raw, sig, Deno.env.get("STRIPE_WEBHOOK_SECRET") ?? "", undefined, crypto);
  } catch {
    return new Response("bad signature", { status: 400 });
  }
  try {
    let note = "ignored";
    if (event.type === "checkout.session.completed") {
      const s = event.data.object as Stripe.Checkout.Session;
      if (s.mode === "payment" && s.metadata?.kind === "backing") {
        // A backer paid for a problem: mark it paid so it counts toward the problem's total.
        const id = Number(s.metadata.backing_id);
        if (s.payment_status === "paid" && id) {
          await db(`backings?id=eq.${id}&status=eq.pending`, {
            method: "PATCH", prefer: "return=minimal",
            body: { status: "paid", paid_at: new Date().toISOString(), stripe_payment_intent: typeof s.payment_intent === "string" ? s.payment_intent : s.payment_intent?.id ?? null },
          });
          note = `backing ${id} paid`;
        }
      } else if (s.mode === "subscription" && s.subscription) {
        const sub = await stripeApi().subscriptions.retrieve(typeof s.subscription === "string" ? s.subscription : s.subscription.id);
        note = await record(sub, s.client_reference_id);
      }
    } else if (event.type === "charge.refunded") {
      const c = event.data.object as Stripe.Charge;
      const pi = typeof c.payment_intent === "string" ? c.payment_intent : c.payment_intent?.id;
      if (pi && c.refunded) { await db(`backings?stripe_payment_intent=eq.${pi}`, { method: "PATCH", prefer: "return=minimal", body: { status: "refunded" } }); note = "backing refunded"; }
    } else if (event.type.startsWith("customer.subscription.")) {
      note = await record(event.data.object);
    }
    return new Response(JSON.stringify({ received: true, note }), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    console.error("webhook failed:", e instanceof Error ? e.message : e);
    return new Response("error", { status: 500 }); // Stripe retries
  }
});
