import assert from "node:assert/strict";
import { test, before, after, mock } from "node:test";
import type { Server } from "http";
import jwt from "jsonwebtoken";

process.env.JWT_SECRET = "test-secret";
process.env.NODE_ENV = "test";

let url = "";
let server: Server;
let ipCounter = 0;

const users = [
  { id: 1, firebase_uid: "uid-none", report_credits: 0, is_active: true },
  { id: 2, firebase_uid: "uid-paid", report_credits: 2, is_active: true },
  { id: 3, firebase_uid: "uid-other", report_credits: 9, is_active: true },
];

const payment = (over: Record<string, unknown>) => ({
  id: 1,
  stripe_session_id: "cs_test_aaaaaaaaaaaa",
  payment_intent_id: "pi_3QabcdefghijklmnXkL8",
  pack_id: "starter",
  credits: 3,
  amount_total: 100,
  currency: "usd",
  status: "paid",
  receipt_url: "https://pay.stripe.com/receipts/own",
  card_brand: "visa",
  card_last4: "4242",
  receipt_email: "me@example.com",
  created_at: new Date("2026-10-01T10:00:00Z"),
  pack_name: "Starter pack",
  features: ["Downloadable PDF"],
  validity_days: null,
  ...over,
});

const payments = [
  { user_id: 2, ...payment({ id: 10 }) },
  { user_id: 3, ...payment({ id: 11, receipt_url: "https://pay.stripe.com/receipts/OTHER", payment_intent_id: "pi_3QOTHERUSERxxxxxxxx" }) },
];
const reports = [
  { user_id: 2, id: 100, created_at: new Date("2026-10-02T10:00:00Z"), names: ["Harvard University", "MIT"] },
  { user_id: 3, id: 101, created_at: new Date("2026-10-03T10:00:00Z"), names: ["OTHER USER COLLEGE"] },
];

const token = (sub: string) => jwt.sign({ sub }, "test-secret", { algorithm: "HS256" });

async function getBilling(auth: string | null, query = "") {
  const res = await fetch(`${url}/me/billing${query}`, {
    headers: {
      ...(auth ? { Authorization: `Bearer ${auth}` } : {}),
      "X-Forwarded-For": `198.51.100.${++ipCounter}`,
    },
  });
  return { res, text: await res.clone().text(), json: (await res.json()) as any };
}

before(async () => {
  const pool = require("../db/client").default;
  // Minimal fake DB: each query returns only rows whose user_id matches the
  // user-id parameter it was given — so a leak would show up as foreign rows.
  mock.method(pool, "query", async (sql: string, params: unknown[] = []) => {
    if (sql.includes("SELECT is_active FROM usdusers")) {
      const u = users.find((x) => x.firebase_uid === params[0]);
      return { rows: u ? [{ is_active: u.is_active }] : [], rowCount: u ? 1 : 0 };
    }
    if (sql.includes("SELECT id, report_credits FROM usdusers")) {
      const u = users.find((x) => x.firebase_uid === params[0]);
      return { rows: u ? [{ id: u.id, report_credits: u.report_credits }] : [], rowCount: u ? 1 : 0 };
    }
    if (sql.includes("SUM(credits)")) {
      const total = payments.filter((p) => p.user_id === params[0] && p.status === "paid").reduce((a, p) => a + p.credits, 0);
      return { rows: [{ total: String(total) }], rowCount: 1 };
    }
    if (sql.includes("FROM stripe_payments p")) {
      let rows = payments.filter((p) => p.user_id === params[0]);
      if (sql.includes("p.status = 'paid'")) rows = rows.filter((p) => p.status === "paid");
      rows = rows.sort((a, b) => b.id - a.id).slice(0, sql.includes("LIMIT 1") ? 1 : Number(params[2]));
      return { rows, rowCount: rows.length };
    }
    if (sql.includes("FROM usdreports r")) {
      const rows = reports.filter((r) => r.user_id === params[0]).slice(0, Number(params[2]));
      return { rows, rowCount: rows.length };
    }
    return { rows: [], rowCount: 0 };
  });

  const { startApp } = require("../testUtils/harness") as typeof import("../testUtils/harness");
  const { app } = require("../app") as typeof import("../app");
  const { errorHandler } = require("../middleware/errorHandler") as typeof import("../middleware/errorHandler");
  ({ url, server } = await startApp([["/me", require("./me").default]]));
  app.use(errorHandler);
});
after(() => server.close());

test("GET /me/billing: no token -> 401", async () => {
  const r = await getBilling(null);
  assert.equal(r.res.status, 401);
});

test("GET /me/billing: user who never paid -> 200, null plan, empty arrays", async () => {
  const r = await getBilling(token("uid-none"));
  assert.equal(r.res.status, 200);
  assert.equal(r.json.currentPlan, null);
  assert.equal(r.json.lastPayment, null);
  assert.deepEqual(r.json.purchases, []);
  assert.deepEqual(r.json.creditUsage, []);
});

test("GET /me/billing: one purchase plus usage", async () => {
  const r = await getBilling(token("uid-paid"));
  assert.equal(r.res.status, 200);
  assert.deepEqual(r.json.currentPlan, {
    planId: "starter",
    name: "Starter pack",
    status: "active",
    creditsTotal: 3,
    creditsUsed: 1,
    creditsRemaining: 2,
    purchasedAt: "2026-10-01T10:00:00.000Z",
    expiresAt: null,
    features: ["Downloadable PDF"],
  });
  assert.equal(r.json.lastPayment.amount, 100);
  assert.equal(r.json.lastPayment.cardBrand, "visa");
  assert.equal(r.json.lastPayment.cardLast4, "4242");
  assert.equal(r.json.lastPayment.status, "paid");
  assert.equal(r.json.lastPayment.reference, "pi_3Q••••XkL8");
  assert.equal(r.json.purchases.length, 1);
  assert.equal(r.json.purchases[0].planName, "Starter pack");
  assert.equal(r.json.creditUsage.length, 1);
  assert.equal(r.json.creditUsage[0].description, "College Decision Report: Harvard University vs MIT");
  assert.equal(r.json.creditUsage[0].credits, 1);
  assert.equal(r.json.nextPurchasesCursor, null);
  assert.equal(r.json.nextUsageCursor, null);
  // Full Stripe ids must never leave the server.
  assert.ok(!r.text.includes("pi_3QabcdefghijklmnXkL8"));
  assert.ok(!r.text.includes("cs_test_aaaaaaaaaaaa"));
});

test("GET /me/billing: never exposes another user's rows, even when asked", async () => {
  const r = await getBilling(token("uid-paid"), "?userId=3&user_id=3");
  assert.equal(r.res.status, 200);
  assert.ok(!r.text.includes("OTHER"));
  assert.ok(!r.text.includes("pi_3QOTHER"));
  assert.equal(r.json.purchases.length, 1);
  assert.equal(r.json.creditUsage.length, 1);

  const other = await getBilling(token("uid-other"));
  assert.ok(other.text.includes("OTHER USER COLLEGE"));
  assert.ok(!other.text.includes("Harvard"));
  assert.equal(other.json.currentPlan.creditsRemaining, 9);
});

test("GET /me/billing: malformed cursor -> 400", async () => {
  const r = await getBilling(token("uid-paid"), "?purchasesCursor=abc");
  assert.equal(r.res.status, 400);
});
