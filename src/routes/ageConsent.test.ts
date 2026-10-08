import assert from "node:assert/strict";
import { test, before, after, mock } from "node:test";
import type { Server } from "http";

process.env.JWT_SECRET = "test-secret";
process.env.NODE_ENV = "test";
process.env.REPORT_DOWNLOAD_TOKEN_SECRET = "test-report-secret";

let url = "";
let server: Server;
let ipCounter = 0;
let existingRow: { id: number; firebase_uid: string; email: string; is_active: boolean; age_consent: boolean } | null = null;
const writes: { sql: string; params: unknown[] }[] = [];

async function postUser(body: unknown) {
  const res = await fetch(`${url}/user`, {
    method: "POST",
    headers: {
      Authorization: "Bearer firebase-token",
      "Content-Type": "application/json",
      "X-Forwarded-For": `198.51.100.${++ipCounter}`,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { res, json: JSON.parse(text) as Record<string, any> };
}

before(async () => {
  const firebasePath = require.resolve("../config/firebase");
  require.cache[firebasePath] = {
    id: firebasePath,
    filename: firebasePath,
    loaded: true,
    exports: {
      firebaseAuth: {
        verifyIdToken: async () => ({ uid: "uid-1", email: "me@example.com", email_verified: true, firebase: {} }),
      },
    },
  } as unknown as NodeJS.Module;

  const pool = require("../db/client").default;
  mock.method(pool, "query", async (sql: string, params: unknown[] = []) => {
    if (sql.includes("SELECT id, firebase_uid, email, is_active FROM usdusers")) {
      return existingRow ? { rows: [existingRow], rowCount: 1 } : { rows: [], rowCount: 0 };
    }
    if (sql.includes("INSERT INTO usdusers")) {
      writes.push({ sql, params });
      return { rows: [{ id: 9, display_name: null, email: "me@example.com", profile_image: null, role: "user", email_verified: true, age_consent: params[7] }], rowCount: 1 };
    }
    if (sql.includes("UPDATE usdusers SET") && sql.includes("age_consent")) {
      writes.push({ sql, params });
      return { rows: [{ id: 1, display_name: null, email: "me@example.com", profile_image: null, role: "user", email_verified: true, age_consent: (existingRow?.age_consent ?? false) || params[6] === true }], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  });

  const { startApp } = require("../testUtils/harness") as typeof import("../testUtils/harness");
  const { app } = require("../app") as typeof import("../app");
  const { errorHandler } = require("../middleware/errorHandler") as typeof import("../middleware/errorHandler");
  ({ url, server } = await startApp([["/user", require("./user").default]]));
  app.use(errorHandler);
});
after(() => server.close());

test("POST /user: new identity without age_consent -> 400, no row written", async () => {
  existingRow = null;
  writes.length = 0;
  for (const body of [{}, { age_consent: false }]) {
    const r = await postUser(body);
    assert.equal(r.res.status, 400);
    assert.equal(r.json.error.code, "AGE_CONSENT_REQUIRED");
  }
  assert.equal(writes.length, 0);
});

test("POST /user: new identity with age_consent true -> 200, consent stored, apple provider accepted", async () => {
  existingRow = null;
  writes.length = 0;
  const r = await postUser({ age_consent: true, auth_provider: "apple" });
  assert.equal(r.res.status, 200);
  assert.equal(r.json.age_consent, true);
  assert.equal(writes[0].params[4], "apple");
  assert.equal(writes[0].params[7], true);
});

test("POST /user: existing user, missing/false age_consent -> 200 and never downgrades", async () => {
  existingRow = { id: 1, firebase_uid: "uid-1", email: "me@example.com", is_active: true, age_consent: true };
  for (const body of [{}, { age_consent: false }]) {
    writes.length = 0;
    const r = await postUser(body);
    assert.equal(r.res.status, 200);
    assert.equal(r.json.age_consent, true);
    assert.match(writes[0].sql, /age_consent\s+=\s+age_consent OR \$7/);
    assert.equal(writes[0].params[6], false);
  }
});

test("POST /user: unknown auth_provider -> 400 PROFILE_INVALID, no row written", async () => {
  existingRow = null;
  writes.length = 0;
  for (const auth_provider of ["facebook", 5]) {
    const r = await postUser({ age_consent: true, auth_provider });
    assert.equal(r.res.status, 400);
    assert.equal(r.json.error.code, "PROFILE_INVALID");
  }
  assert.equal(writes.length, 0);
});
