import { Router, Request, Response } from "express";
import Stripe from "stripe";
import pool from "../db/client";
import { verifyToken } from "../middleware/auth";
import { AuthRequest } from "../types/user";
import { sendError, sendInternalError } from "../utils/apiError";
import { CREDIT_PACKS, getPack, getStripe, getWebhookSecret } from "../config/stripe";
import { fetchChargeDetails } from "../services/billing.service";
import { findPaymentBySession, fulfilCheckout, getCredits, listPayments } from "../services/credits.service";

const router = Router();

async function resolveUser(firebaseUid: string) {
  const r = await pool.query<{ id: number; email: string; stripe_customer_id: string | null }>(
    "SELECT id, email, stripe_customer_id FROM usdusers WHERE firebase_uid = $1",
    [firebaseUid],
  );
  return r.rows[0] ?? null;
}

/** GET /billing/packs — purchasable credit packs. */
router.get("/packs", (_req, res) => {
  res.json({
    packs: CREDIT_PACKS.map((p) => ({
      id: p.id,
      name: p.name,
      credits: p.credits,
      priceCents: p.priceCents,
      currency: p.currency,
    })),
  });
});

/** GET /billing/credits — the signed-in user's remaining report credits. */
router.get("/credits", verifyToken, async (req: AuthRequest, res: Response) => {
  try {
    const user = await resolveUser(req.userId!);
    if (!user) return sendError(req, res, 404, "NOT_FOUND");
    res.json({ credits: await getCredits(user.id) });
  } catch (err) {
    sendInternalError(req, res, err, "billing/credits");
  }
});

/** GET /billing/payments — the signed-in user's payments, newest first (max 50). */
router.get("/payments", verifyToken, async (req: AuthRequest, res: Response) => {
  try {
    const user = await resolveUser(req.userId!);
    if (!user) return sendError(req, res, 404, "NOT_FOUND");
    const rows = await listPayments(user.id, 50);
    res.json({
      payments: rows.map((p) => ({
        sessionId: p.stripe_session_id,
        packId: p.pack_id,
        packName: getPack(p.pack_id)?.name ?? p.pack_id,
        credits: p.credits,
        amountCents: p.amount_total,
        currency: p.currency,
        receiptUrl: p.receipt_url,
        createdAt: p.created_at.toISOString(),
      })),
    });
  } catch (err) {
    sendInternalError(req, res, err, "billing/payments");
  }
});

/**
 * GET /billing/checkout-status?session_id=cs_... — lets the frontend confirm a
 * payment after Stripe's redirect instead of trusting the URL. DB first; Stripe
 * only on a miss. Never grants credits (only the webhook does).
 */
router.get("/checkout-status", verifyToken, async (req: AuthRequest, res: Response) => {
  try {
    const sessionId = req.query.session_id;
    if (typeof sessionId !== "string" || !/^cs_[A-Za-z0-9_]+$/.test(sessionId)) {
      return sendError(req, res, 400, "INVALID_REQUEST");
    }
    const user = await resolveUser(req.userId!);
    if (!user) return sendError(req, res, 404, "NOT_FOUND");

    const payment = await findPaymentBySession(user.id, sessionId);
    if (payment) {
      return res.json({
        status: "paid",
        credits: payment.credits,
        amountCents: payment.amount_total,
        currency: payment.currency,
        receiptUrl: payment.receipt_url,
        createdAt: payment.created_at.toISOString(),
      });
    }

    let session: Stripe.Checkout.Session;
    try {
      session = await getStripe().checkout.sessions.retrieve(sessionId);
    } catch {
      // Unknown / malformed-for-Stripe id: same answer as someone else's session.
      return res.json({ status: "unknown" });
    }
    if (session.metadata?.userId !== String(user.id)) {
      return res.json({ status: "unknown" });
    }
    return res.json({ status: session.payment_status === "paid" ? "processing" : "unpaid" });
  } catch (err) {
    sendInternalError(req, res, err, "billing/checkout-status");
  }
});

/**
 * POST /billing/checkout-session { packId } → { url, sessionId }
 * Frontend redirects the browser to `url` (Stripe-hosted Checkout). Credits are
 * granted by the webhook, never by the success redirect.
 */
router.post("/checkout-session", verifyToken, async (req: AuthRequest, res: Response) => {
  try {
    const pack = getPack(typeof req.body?.packId === "string" ? req.body.packId : "starter");
    if (!pack) return sendError(req, res, 400, "INVALID_REQUEST");

    const user = await resolveUser(req.userId!);
    if (!user) return sendError(req, res, 404, "NOT_FOUND");

    const stripe = getStripe();

    let customerId = user.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: { userId: String(user.id) },
      });
      customerId = customer.id;
      await pool.query("UPDATE usdusers SET stripe_customer_id = $1 WHERE id = $2", [customerId, user.id]);
    }

    const frontend = process.env.FRONTEND_URL || "http://localhost:3000";
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer: customerId,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: pack.currency,
            unit_amount: pack.priceCents,
            product_data: { name: `${pack.name} (${pack.credits} reports)` },
          },
        },
      ],
      // The webhook trusts this metadata (set server-side, never client-supplied).
      metadata: { userId: String(user.id), packId: pack.id },
      client_reference_id: String(user.id),
      success_url: `${frontend}/profile?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${frontend}/billing/cancel`,
    });

    res.json({ url: session.url, sessionId: session.id });
  } catch (err) {
    sendInternalError(req, res, err, "billing/checkout-session");
  }
});

async function handleCheckoutCompleted(session: Stripe.Checkout.Session): Promise<void> {
  // Delayed payment methods complete the session unpaid; the later
  // async_payment_succeeded event brings us back here with "paid".
  if (session.payment_status !== "paid") return;

  const userId = Number(session.metadata?.userId);
  const pack = getPack(session.metadata?.packId ?? "");
  if (!Number.isInteger(userId) || !pack) {
    console.error(`[billing/webhook] session ${session.id} has unusable metadata`, session.metadata);
    return;
  }

  const paymentIntentId = typeof session.payment_intent === "string" ? session.payment_intent : null;
  const charge = await fetchChargeDetails(paymentIntentId);

  const granted = await fulfilCheckout({
    sessionId: session.id,
    paymentIntentId,
    ...charge,
    userId,
    packId: pack.id,
    credits: pack.credits,
    amountTotal: session.amount_total ?? pack.priceCents,
    currency: session.currency ?? pack.currency,
  });
  console.log(
    `[billing/webhook] session ${session.id} user=${userId} ${granted ? `granted ${pack.credits}` : "already fulfilled"}`,
  );
}

/**
 * POST /billing/webhook — Stripe → us. Mounted in app.ts with express.raw()
 * BEFORE express.json(), because signature verification needs the exact bytes.
 */
export async function stripeWebhook(req: Request, res: Response): Promise<void> {
  const signature = req.headers["stripe-signature"];
  if (typeof signature !== "string") {
    res.status(400).send("Missing signature");
    return;
  }

  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(req.body as Buffer, signature, getWebhookSecret());
  } catch (err) {
    console.warn(`[billing/webhook] signature verification failed: ${(err as Error).message}`);
    res.status(400).send("Invalid signature");
    return;
  }

  try {
    switch (event.type) {
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded":
        await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
        break;
      default:
        break;
    }
    res.json({ received: true });
  } catch (err) {
    // 500 makes Stripe retry; fulfilment is idempotent so retries are safe.
    console.error("[billing/webhook] handler failed", err);
    res.status(500).send("Webhook handler failed");
  }
}

export default router;
