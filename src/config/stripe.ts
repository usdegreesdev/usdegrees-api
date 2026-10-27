import Stripe from "stripe";

let client: Stripe | null = null;

/** Lazily built so the API still boots (and non-billing routes work) without Stripe configured. */
export function getStripe(): Stripe {
  if (!client) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
    client = new Stripe(key);
  }
  return client;
}

export function getWebhookSecret(): string {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new Error("STRIPE_WEBHOOK_SECRET is not set");
  return secret;
}

export interface CreditPack {
  id: string;
  name: string;
  credits: number;
  /** Smallest currency unit (cents). Stripe's USD minimum charge is 50. */
  priceCents: number;
  currency: string;
}

// PLACEHOLDER pricing for the demo — the real packs/prices aren't fixed yet.
// Override via env or replace this list; checkout uses inline price_data, so
// no Stripe Dashboard products need to exist.
export const CREDIT_PACKS: CreditPack[] = [
  {
    id: "starter",
    name: "Starter pack",
    credits: Number(process.env.STRIPE_DEMO_PACK_CREDITS ?? 3),
    priceCents: Number(process.env.STRIPE_DEMO_PACK_PRICE_CENTS ?? 100),
    currency: "usd",
  },
];

export function getPack(id: string): CreditPack | undefined {
  return CREDIT_PACKS.find((p) => p.id === id);
}

/** When false (default) /report/generate ignores credits entirely. */
export function paymentRequired(): boolean {
  return process.env.STRIPE_REQUIRE_PAYMENT === "true";
}
