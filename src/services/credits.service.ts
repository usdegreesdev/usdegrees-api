import pool from "../db/client";

export async function getCredits(userId: number): Promise<number> {
  const r = await pool.query<{ report_credits: number }>(
    "SELECT report_credits FROM usdusers WHERE id = $1",
    [userId],
  );
  return r.rows[0]?.report_credits ?? 0;
}

/** Atomically spends one credit; false if the user has none. */
export async function consumeCredit(userId: number): Promise<boolean> {
  const r = await pool.query(
    `UPDATE usdusers SET report_credits = report_credits - 1
     WHERE id = $1 AND report_credits > 0`,
    [userId],
  );
  return (r.rowCount ?? 0) > 0;
}

/** Gives back a credit spent on a generation that failed. */
export async function refundCredit(userId: number): Promise<void> {
  await pool.query(
    "UPDATE usdusers SET report_credits = report_credits + 1 WHERE id = $1",
    [userId],
  );
}

export interface FulfilmentInput {
  sessionId: string;
  paymentIntentId: string | null;
  userId: number;
  packId: string;
  credits: number;
  amountTotal: number;
  currency: string;
  receiptUrl: string | null;
  cardBrand?: string | null;
  cardLast4?: string | null;
  receiptEmail?: string | null;
}

export interface PaymentRow {
  stripe_session_id: string;
  pack_id: string;
  credits: number;
  amount_total: number;
  currency: string;
  receipt_url: string | null;
  created_at: Date;
}

/** The user's payments, newest first. */
export async function listPayments(userId: number, limit = 50): Promise<PaymentRow[]> {
  const r = await pool.query<PaymentRow>(
    `SELECT stripe_session_id, pack_id, credits, amount_total, currency, receipt_url, created_at
     FROM stripe_payments WHERE user_id = $1
     ORDER BY created_at DESC, id DESC LIMIT $2`,
    [userId, limit],
  );
  return r.rows;
}

/** One of the user's payments by Checkout Session id (scoped to the owner). */
export async function findPaymentBySession(userId: number, sessionId: string): Promise<PaymentRow | null> {
  const r = await pool.query<PaymentRow>(
    `SELECT stripe_session_id, pack_id, credits, amount_total, currency, receipt_url, created_at
     FROM stripe_payments WHERE stripe_session_id = $1 AND user_id = $2`,
    [sessionId, userId],
  );
  return r.rows[0] ?? null;
}

/**
 * Records a paid Checkout Session and grants its credits. Idempotent: the
 * UNIQUE stripe_session_id means a replayed webhook inserts nothing and grants
 * nothing. Returns true only the first time.
 */
export async function fulfilCheckout(input: FulfilmentInput): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const ins = await client.query(
      `INSERT INTO stripe_payments
         (stripe_session_id, payment_intent_id, user_id, pack_id, credits, amount_total, currency, receipt_url,
          card_brand, card_last4, receipt_email)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (stripe_session_id) DO NOTHING`,
      [input.sessionId, input.paymentIntentId, input.userId, input.packId, input.credits, input.amountTotal, input.currency, input.receiptUrl,
       input.cardBrand ?? null, input.cardLast4 ?? null, input.receiptEmail ?? null],
    );
    if ((ins.rowCount ?? 0) === 0) {
      await client.query("ROLLBACK");
      return false;
    }
    await client.query(
      "UPDATE usdusers SET report_credits = report_credits + $1 WHERE id = $2",
      [input.credits, input.userId],
    );
    await client.query("COMMIT");
    return true;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
