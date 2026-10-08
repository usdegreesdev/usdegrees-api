import assert from "node:assert/strict";
import { test, before, after, beforeEach, mock } from "node:test";
import type { Server } from "http";

process.env.JWT_SECRET = "test-secret";
process.env.NODE_ENV = "test";
process.env.REPORT_DOWNLOAD_TOKEN_SECRET = "test-report-secret";
process.env.APPLE_CLIENT_ID = "com.example.test";

type Row = {
  id: number;
  firebase_uid: string;
  email: string;
  display_name: string;
  profile_image: null;
  role: string;
  email_verified: boolean;
  is_active: boolean;
  age_consent: boolean;
};

let url = "";
let server: Server;
let ipCounter = 0;
let stored: Row | null = null;
let inserts = 0;

const mkRow = (age_consent: boolean): Row => ({
  id: 1,
  firebase_uid: "uid-1",
  email: "me@example.com",
  display_name: "Me",
  profile_image: null,
  role: "student",
  email_verified: true,
  is_active: true,
  age_consent,
});

async function post(path: string, body: unknown) {
  const res = await fetch(`${url}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Forwarded-For": `198.51.100.${++ipCounter}` },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { res, json: JSON.parse(text) as Record<string, any> };
}

before(async () => {
  const stub = (rel: string, exports: unknown) => {
    const p = require.resolve(rel);
    require.cache[p] = { id: p, filename: p, loaded: true, exports } as unknown as NodeJS.Module;
  };
  stub("../config/firebase", {
    firebaseAuth: {
      verifyIdToken: async () => ({ uid: "uid-1", email: "me@example.com", email_verified: true, firebase: { sign_in_provider: "google.com" } }),
      createCustomToken: async () => "custom-token",
    },
  });
  stub("../services/appleToken", {
    verifyAppleIdToken: async () => ({ sub: "apple-sub", email: "me@example.com", email_verified: "true" }),
  });

  const pool = require("../db/client").default;
  mock.method(pool, "query", async (sql: string, params: unknown[] = []) => {
    if (/^\s*SELECT .* FROM usdusers WHERE (firebase_uid|provider_user_id) = \$1/s.test(sql)) {
      return stored ? { rows: [stored], rowCount: 1 } : { rows: [], rowCount: 0 };
    }
    if (sql.includes("INSERT INTO usdusers")) {
      inserts++;
      const isApple = sql.includes("'apple'");
      const consent = (isApple ? params[5] : params[6]) === true;
      const uid = params[0] as string;
      stored = stored
        ? { ...stored, age_consent: stored.age_consent || consent }
        : { ...mkRow(consent), firebase_uid: uid };
      return { rows: [stored], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  });

  const { startApp } = require("../testUtils/harness") as typeof import("../testUtils/harness");
  const { app } = require("../app") as typeof import("../app");
  const { errorHandler } = require("../middleware/errorHandler") as typeof import("../middleware/errorHandler");
  ({ url, server } = await startApp([["/auth", require("./auth").default]]));
  app.use(errorHandler);
});
after(() => server.close());
beforeEach(() => {
  stored = null;
  inserts = 0;
});

const endpoints: Array<[string, string, Record<string, unknown>]> = [
  ["/auth/login", "login", { idToken: "x" }],
  ["/auth/apple", "apple", { id_token: "x" }],
];

for (const [path, label, base] of endpoints) {
  test(`${label}: new identity without age_consent -> 400, no row`, async () => {
    for (const extra of [{}, { age_consent: false }]) {
      const r = await post(path, { ...base, ...extra });
      assert.equal(r.res.status, 400);
      assert.equal(r.json.error.code, "AGE_CONSENT_REQUIRED");
    }
    assert.equal(inserts, 0);
    assert.equal(stored, null);
  });

  test(`${label}: new identity with age_consent true -> 200, consent stored`, async () => {
    const r = await post(path, { ...base, age_consent: true });
    assert.equal(r.res.status, 200);
    assert.equal(inserts, 1);
    assert.equal(stored?.age_consent, true);
  });

  test(`${label}: existing user without age_consent -> 200, unchanged`, async () => {
    for (const consent of [true, false]) {
      stored = mkRow(consent);
      if (path === "/auth/apple") stored.firebase_uid = "apple:apple-sub";
      const r = await post(path, base);
      assert.equal(r.res.status, 200, JSON.stringify(r.json));
      assert.equal(stored?.age_consent, consent);
    }
  });

  test(`${label}: existing user with age_consent false -> stored true stays true`, async () => {
    stored = mkRow(true);
    if (path === "/auth/apple") stored.firebase_uid = "apple:apple-sub";
    const r = await post(path, { ...base, age_consent: false });
    assert.equal(r.res.status, 200, JSON.stringify(r.json));
    assert.equal(stored?.age_consent, true);
  });
}
