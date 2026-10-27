import pool from "../db/client";
import { getPack, getStripe } from "../config/stripe";

export interface ChargeDetails {
  receiptUrl: string | null;
  cardBrand: string | null;
  cardLast4: string | null;
  receiptEmail: string | null;
}

const NO_CHARGE: ChargeDetails = { receiptUrl: null, cardBrand: null, cardLast4: null, receiptEmail: null };

/**
 * Best-effort card + receipt details for a PaymentIntent (latest_charge). Any
 * failure yields nulls — this must never block fulfilment or a read. Nothing
 * sensitive (the URL, the Stripe objects) is logged.
 */
export async function fetchChargeDetails(paymentIntentId: string | null): Promise<ChargeDetails> {
  if (!paymentIntentId) return NO_CHARGE;
  try {
    const pi = await getStripe().paymentIntents.retrieve(paymentIntentId, { expand: ["latest_charge"] });
    const charge = pi.latest_charge;
    if (!charge || typeof charge === "string") return NO_CHARGE;
    const card = charge.payment_method_details?.card;
    return {
      receiptUrl: charge.receipt_url ?? null,
      cardBrand: card?.brand ?? null,
      cardLast4: card?.last4 ?? null,
      receiptEmail: charge.receipt_email ?? charge.billing_details?.email ?? null,
    };
  } catch (err) {
    console.warn(`[billing] charge lookup failed: ${(err as Error).name}`);
    return NO_CHARGE;
  }
}

/** "pi_3QabcdefXkL8" → "pi_3Q••••XkL8". Never returns the full id. */
export function maskStripeId(id: string | null): string {
  if (!id) return "";
  if (id.length <= 9) return `${id.slice(0, 2)}••••`;
  return `${id.slice(0, 5)}••••${id.slice(-4)}`;
}

export type PlanStatus = "active" | "exhausted" | "expired" | "none";
export type PaymentStatus = "paid" | "refunded" | "failed";

export interface BillingDetails {
  currentPlan: {
    planId: string;
    name: string;
    status: PlanStatus;
    creditsTotal: number;
    creditsUsed: number;
    creditsRemaining: number;
    purchasedAt: string;
    expiresAt: string | null;
    features: string[];
  } | null;
  lastPayment: {
    amount: number;
    currency: string;
    paidAt: string;
    status: PaymentStatus;
    cardBrand: string | null;
    cardLast4: string | null;
    receiptUrl: string | null;
    receiptEmail: string | null;
    reference: string;
  } | null;
  purchases: Array<{
    id: string;
    date: string;
    planName: string;
    credits: number;
    amount: number;
    currency: string;
    status: string;
    receiptUrl: string | null;
  }>;
  creditUsage: Array<{ id: string; date: string; description: string; credits: number }>;
}

export interface BillingPage extends BillingDetails {
  /** Pass back as ?purchasesCursor= for the next page; null when exhausted. */
  nextPurchasesCursor: string | null;
  /** Pass back as ?usageCursor= for the next page; null when exhausted. */
  nextUsageCursor: string | null;
}

export const BILLING_PAGE_SIZE = 20;

interface PaymentRow {
  id: number;
  stripe_session_id: string;
  payment_intent_id: string | null;
  pack_id: string;
  credits: number;
  amount_total: number;
  currency: string;
  status: PaymentStatus;
  receipt_url: string | null;
  card_brand: string | null;
  card_last4: string | null;
  receipt_email: string | null;
  created_at: Date;
  pack_name: string | null;
  features: string[] | null;
  validity_days: number | null;
}

const PAYMENT_COLUMNS = `p.id, p.stripe_session_id, p.payment_intent_id, p.pack_id, p.credits,
       p.amount_total, p.currency, p.status, p.receipt_url, p.card_brand, p.card_last4,
       p.receipt_email, p.created_at, cp.name AS pack_name, cp.features, cp.validity_days`;

const planName = (r: PaymentRow) => r.pack_name ?? getPack(r.pack_id)?.name ?? r.pack_id;

/**
 * Fills card/receipt fields missing on the user's latest payment from Stripe
 * and persists them, so later calls are DB-only. Scoped to the owner.
 */
async function backfillFromStripe(userId: number, row: PaymentRow): Promise<void> {
  if (row.status !== "paid" || !row.payment_intent_id) return;
  if (row.card_brand && row.card_last4 && row.receipt_url && row.receipt_email) return;

  const c = await fetchChargeDetails(row.payment_intent_id);
  if (!c.receiptUrl && !c.cardBrand && !c.cardLast4 && !c.receiptEmail) return;

  row.card_brand ??= c.cardBrand;
  row.card_last4 ??= c.cardLast4;
  row.receipt_url ??= c.receiptUrl;
  row.receipt_email ??= c.receiptEmail;
  try {
    await pool.query(
      `UPDATE stripe_payments
          SET card_brand = COALESCE(card_brand, $1), card_last4 = COALESCE(card_last4, $2),
              receipt_url = COALESCE(receipt_url, $3), receipt_email = COALESCE(receipt_email, $4)
        WHERE id = $5 AND user_id = $6`,
      [c.cardBrand, c.cardLast4, c.receiptUrl, c.receiptEmail, row.id, userId],
    );
  } catch (err) {
    console.warn(`[billing] persisting charge details failed: ${(err as Error).name}`);
  }
}

export interface BillingQuery {
  purchasesCursor?: number;
  usageCursor?: number;
}

/**
 * Everything the Plan Details popup shows. `firebaseUid` MUST come from the
 * verified JWT; every query below is scoped to the user it resolves to.
 * Returns null if the uid has no user row.
 */
export async function getBillingDetails(firebaseUid: string, q: BillingQuery = {}): Promise<BillingPage | null> {
  const u = await pool.query<{ id: number; report_credits: number }>(
    "SELECT id, report_credits FROM usdusers WHERE firebase_uid = $1",
    [firebaseUid],
  );
  const user = u.rows[0];
  if (!user) return null;
  const userId = user.id;
  const limit = BILLING_PAGE_SIZE + 1; // one extra row tells us whether there is a next page

  const [lastRes, planRes, totalRes, purchasesRes, usageRes] = await Promise.all([
    pool.query<PaymentRow>(
      `SELECT ${PAYMENT_COLUMNS} FROM stripe_payments p
         LEFT JOIN credit_packs cp ON cp.id = p.pack_id
        WHERE p.user_id = $1 ORDER BY p.id DESC LIMIT 1`,
      [userId],
    ),
    pool.query<PaymentRow>(
      `SELECT ${PAYMENT_COLUMNS} FROM stripe_payments p
         LEFT JOIN credit_packs cp ON cp.id = p.pack_id
        WHERE p.user_id = $1 AND p.status = 'paid' ORDER BY p.id DESC LIMIT 1`,
      [userId],
    ),
    pool.query<{ total: string }>(
      "SELECT COALESCE(SUM(credits), 0)::text AS total FROM stripe_payments WHERE user_id = $1 AND status = 'paid'",
      [userId],
    ),
    pool.query<PaymentRow>(
      `SELECT ${PAYMENT_COLUMNS} FROM stripe_payments p
         LEFT JOIN credit_packs cp ON cp.id = p.pack_id
        WHERE p.user_id = $1 AND ($2::int IS NULL OR p.id < $2)
        ORDER BY p.id DESC LIMIT $3`,
      [userId, q.purchasesCursor ?? null, limit],
    ),
    pool.query<{ id: number; created_at: Date; names: string[] | null }>(
      `SELECT r.id, r.created_at,
              (SELECT json_agg(s.name ORDER BY rc.display_order)
                 FROM usdreport_colleges rc JOIN schools s ON s.unitid = rc.unitid
                WHERE rc.report_id = r.id) AS names
         FROM usdreports r
        WHERE r.user_id = $1 AND r.credit_spent AND r.pdf_data IS NOT NULL
          AND ($2::int IS NULL OR r.id < $2)
        ORDER BY r.id DESC LIMIT $3`,
      [userId, q.usageCursor ?? null, limit],
    ),
  ]);

  const last = lastRes.rows[0] ?? null;
  const plan = planRes.rows[0] ?? null;
  if (last) await backfillFromStripe(userId, last);

  let currentPlan: BillingDetails["currentPlan"] = null;
  if (plan) {
    const creditsTotal = Number(totalRes.rows[0]?.total ?? 0);
    const creditsRemaining = user.report_credits;
    const creditsUsed = Math.max(0, creditsTotal - creditsRemaining);
    const expiresAt = plan.validity_days
      ? new Date(plan.created_at.getTime() + plan.validity_days * 86_400_000)
      : null;
    const status: PlanStatus =
      expiresAt && expiresAt.getTime() < Date.now() ? "expired" : creditsRemaining > 0 ? "active" : "exhausted";
    currentPlan = {
      planId: plan.pack_id,
      name: planName(plan),
      status,
      creditsTotal,
      creditsUsed,
      creditsRemaining,
      purchasedAt: plan.created_at.toISOString(),
      expiresAt: expiresAt ? expiresAt.toISOString() : null,
      features: plan.features ?? [],
    };
  }

  const lastPayment: BillingDetails["lastPayment"] = last && {
    amount: last.amount_total,
    currency: last.currency,
    paidAt: last.created_at.toISOString(),
    status: last.status,
    cardBrand: last.card_brand,
    cardLast4: last.card_last4,
    receiptUrl: last.receipt_url,
    receiptEmail: last.receipt_email,
    reference: maskStripeId(last.payment_intent_id ?? last.stripe_session_id),
  };

  const purchaseRows = purchasesRes.rows.slice(0, BILLING_PAGE_SIZE);
  const usageRows = usageRes.rows.slice(0, BILLING_PAGE_SIZE);

  return {
    currentPlan,
    lastPayment,
    purchases: purchaseRows.map((p) => ({
      id: String(p.id),
      date: p.created_at.toISOString(),
      planName: planName(p),
      credits: p.credits,
      amount: p.amount_total,
      currency: p.currency,
      status: p.status,
      receiptUrl: p.receipt_url,
    })),
    creditUsage: usageRows.map((r) => ({
      id: String(r.id),
      date: r.created_at.toISOString(),
      description: r.names?.length ? `College Decision Report: ${r.names.join(" vs ")}` : "College Decision Report",
      credits: 1,
    })),
    nextPurchasesCursor:
      purchasesRes.rows.length > BILLING_PAGE_SIZE ? String(purchaseRows[purchaseRows.length - 1].id) : null,
    nextUsageCursor:
      usageRes.rows.length > BILLING_PAGE_SIZE ? String(usageRows[usageRows.length - 1].id) : null,
  };
}
