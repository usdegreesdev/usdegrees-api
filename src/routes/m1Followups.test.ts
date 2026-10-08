import assert from "node:assert/strict";
import { test, before, after, mock } from "node:test";
import type { Server } from "http";
import jwt from "jsonwebtoken";
import { decideEmailChange } from "../services/emailChange.service";

process.env.JWT_SECRET = "test-secret";
process.env.NODE_ENV = "test";
process.env.REPORT_DOWNLOAD_TOKEN_SECRET = "test-report-secret";

const HOUR = 60 * 60 * 1000;
const DEACTIVATED_AT = new Date(Date.now() - 1 * HOUR).toISOString();
const EXPECTED_ELIGIBLE_AT = new Date(Date.parse(DEACTIVATED_AT) + 24 * HOUR).toISOString();

let url = "";
let server: Server;
let ipCounter = 0;

const appJwt = () => jwt.sign({ sub: "uid-cd" }, "test-secret", { algorithm: "HS256" });

async function call(method: string, path: string, opts: { auth?: boolean; body?: unknown } = {}) {
  const res = await fetch(`${url}${path}`, {
    method,
    headers: {
      "X-Forwarded-For": `198.51.100.${++ipCounter}`,
      ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(opts.auth ? { Authorization: `Bearer ${appJwt()}` } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  return { res, text, json: JSON.parse(text) as Record<string, any> };
}

before(async () => {
  const firebasePath = require.resolve("../config/firebase");
  require.cache[firebasePath] = {
    id: firebasePath,
    filename: firebasePath,
    loaded: true,
    exports: {
      firebaseAuth: {
        verifyIdToken: async () => ({ uid: "new-uid", email: "taken@example.com", email_verified: true, firebase: {} }),
      },
    },
  } as unknown as NodeJS.Module;

  const pool = require("../db/client").default;
  mock.method(pool, "query", async (sql: string) => {
    // POST /user: no existing row for this uid
    if (sql.includes("SELECT id, firebase_uid, email, is_active FROM usdusers")) return { rows: [], rowCount: 0 };
    if (sql.includes("is_active FROM usdusers")) return { rows: [{ is_active: true }] };
    // email-change flow: caller row, then the conflicting (recently deactivated) owner
    if (sql.includes("SELECT id, email, email_verified FROM usdusers")) {
      return { rows: [{ id: 1, email: "me@example.com", email_verified: true }], rowCount: 1 };
    }
    if (sql.includes("SELECT email_verified FROM usdusers")) return { rows: [{ email_verified: true }], rowCount: 1 };
    if (sql.includes("LOWER(email) = $1 AND firebase_uid IS DISTINCT FROM")) {
      return { rows: [{ id: 44, is_active: false, deactivated_at: DEACTIVATED_AT }], rowCount: 1 };
    }
    if (sql.includes("SELECT deactivated_at, is_active")) {
      return { rows: [{ deactivated_at: DEACTIVATED_AT, is_active: false }], rowCount: 1 };
    }
    // anything else (login lookups, tuition/campus/summary/programs): zero rows
    return { rows: [], rowCount: 0 };
  });

  const { startApp } = require("../testUtils/harness") as typeof import("../testUtils/harness");
  const { app } = require("../app") as typeof import("../app");
  const { errorHandler } = require("../middleware/errorHandler") as typeof import("../middleware/errorHandler");
  const profile = require("./profile");
  ({ url, server } = await startApp([
    ["/auth", require("./auth").default],
    ["/user", require("./user").default],
    ["/account", profile.accountRouter],
    ["/tuition", require("./tuition").default],
    ["/campus", require("./campus").default],
    ["/college-summary", require("./collegeSummary").default],
    ["/programs", require("./programs").default],
  ]));
  app.use(errorHandler);
});
after(() => server.close());

// ------------------------------------------------ 1. EMAIL_IN_COOLDOWN

test("decideEmailChange: cooldown carries eligibleAt (ISO UTC) and no date in the message", () => {
  const d = decideEmailChange({
    currentEmailVerified: true,
    existingOwner: { id: 44, isActive: false, deactivatedAt: DEACTIVATED_AT },
  });
  assert.equal(d.allowed, false);
  if (d.allowed) return;
  assert.equal(d.code, "EMAIL_IN_COOLDOWN");
  assert.equal(d.eligibleAt, EXPECTED_ELIGIBLE_AT);
  assert.match(d.eligibleAt!, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.ok(!/\d{4}/.test(d.message), d.message);
});

test("other rejections have no eligibleAt", () => {
  const d = decideEmailChange({
    currentEmailVerified: true,
    existingOwner: { id: 5, isActive: true, deactivatedAt: null },
  });
  assert.equal(d.allowed, false);
  if (!d.allowed) assert.equal("eligibleAt" in d, false);
});

function assertCooldownEnvelope(r: Awaited<ReturnType<typeof call>>) {
  assert.equal(r.res.status, 403, r.text);
  assert.deepEqual(Object.keys(r.json).sort(), ["error", "requestId"]);
  assert.deepEqual(Object.keys(r.json.error).sort(), ["code", "eligibleAt", "message"]);
  assert.equal(r.json.error.code, "EMAIL_IN_COOLDOWN");
  assert.equal(r.json.error.eligibleAt, EXPECTED_ELIGIBLE_AT);
  assert.ok(!r.json.error.message.includes(EXPECTED_ELIGIBLE_AT), "date must not be in the message");
  assert.equal(r.json.requestId, r.res.headers.get("x-request-id"));
}

test("PATCH /account/email -> 403 EMAIL_IN_COOLDOWN with eligibleAt", async () => {
  assertCooldownEnvelope(await call("PATCH", "/account/email", { auth: true, body: { newEmail: "taken@example.com" } }));
});

test("POST /auth/login -> 403 EMAIL_IN_COOLDOWN with eligibleAt", async () => {
  assertCooldownEnvelope(await call("POST", "/auth/login", { body: { idToken: "x" } }));
});

test("POST /user -> 403 EMAIL_IN_COOLDOWN with eligibleAt", async () => {
  const res = await fetch(`${url}/user`, {
    method: "POST",
    headers: { Authorization: "Bearer firebase-token", "Content-Type": "application/json", "X-Forwarded-For": "198.51.100.250" },
    body: "{}",
  });
  const text = await res.text();
  assertCooldownEnvelope({ res, text, json: JSON.parse(text) });
});

test("GET /account/email-available reports code + eligibleAt (200 preview body)", async () => {
  const r = await call("GET", "/account/email-available?email=taken@example.com", { auth: true });
  assert.equal(r.res.status, 200);
  assert.equal(r.json.available, false);
  assert.equal(r.json.code, "EMAIL_IN_COOLDOWN");
  assert.equal(r.json.eligibleAt, EXPECTED_ELIGIBLE_AT);
  assert.ok(!r.json.details.includes(EXPECTED_ELIGIBLE_AT));
});

test("eligibleAt matches /account/availability's eligibleAt exactly (same name, same format)", async () => {
  const r = await call("GET", "/account/availability?email=taken@example.com");
  assert.equal(r.json.eligibleAt, EXPECTED_ELIGIBLE_AT);
});

// ------------------------------------------------ 3. no-row lookups are 404

test("tuition / campus / college-summary / programs with no rows -> 404 NOT_FOUND (not 500)", async () => {
  for (const path of ["/tuition/987654", "/campus/987654", "/college-summary/987654", "/programs/987654"]) {
    const r = await call("GET", path);
    assert.equal(r.res.status, 404, `${path}: ${r.text}`);
    assert.equal(r.json.error.code, "NOT_FOUND");
    assert.ok(!r.text.includes("987654"), r.text);
  }
});
