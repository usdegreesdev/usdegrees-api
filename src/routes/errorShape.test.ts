import assert from "node:assert/strict";
import { test, before, after, beforeEach, mock } from "node:test";
import type { Server } from "http";
import jwt from "jsonwebtoken";

process.env.JWT_SECRET = "test-secret";
process.env.NODE_ENV = "test";

let url = "";
let server: Server;
let queryImpl: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
let verifyIdTokenImpl: (t: string) => Promise<unknown>;
let errorLog: unknown[][] = [];

const SECRETS = [
  "relation",
  "usdusers",
  "42P01",
  "ECONNREFUSED",
  "jwt malformed",
  "jwt expired",
  "invalid signature",
  "Decoding Firebase",
  "auth/",
  "secret-internal-string",
  "Unexpected token",
  "stack",
  " at ",
];

function appJwt(opts: jwt.SignOptions = {}): string {
  return jwt.sign({ sub: "uid-1" }, "test-secret", { algorithm: "HS256", ...opts });
}

async function call(
  method: string,
  path: string,
  opts: { token?: string; body?: string; headers?: Record<string, string> } = {},
) {
  const res = await fetch(`${url}${path}`, {
    method,
    headers: {
      ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
      ...opts.headers,
    },
    body: opts.body,
  });
  const text = await res.text();
  return { res, text, json: JSON.parse(text) as Record<string, any> };
}

/** The response must be exactly the safe shape and leak none of SECRETS. */
function assertSafe(r: { res: Response; text: string; json: Record<string, any> }, status: number, code: string) {
  assert.equal(r.res.status, status, r.text);
  assert.deepEqual(Object.keys(r.json).sort(), ["error", "requestId"], r.text);
  assert.deepEqual(Object.keys(r.json.error).sort(), ["code", "message"], r.text);
  assert.equal(r.json.error.code, code);
  assert.equal(typeof r.json.error.message, "string");
  assert.equal(r.json.requestId, r.res.headers.get("x-request-id"));
  for (const s of SECRETS) assert.ok(!r.text.includes(s), `response leaked "${s}": ${r.text}`);
}

before(async () => {
  // Stub Firebase Admin (real module initialises credentials at import).
  const firebasePath = require.resolve("../config/firebase");
  require.cache[firebasePath] = {
    id: firebasePath,
    filename: firebasePath,
    loaded: true,
    exports: {
      firebaseAuth: {
        verifyIdToken: (t: string) => verifyIdTokenImpl(t),
        createCustomToken: async () => "custom",
        deleteUser: async () => undefined,
        updateUser: async () => undefined,
      },
    },
  } as unknown as NodeJS.Module;

  const pool = require("../db/client").default;
  mock.method(pool, "query", (sql: string, params?: unknown[]) => queryImpl(sql, params));

  const { Router } = require("express") as typeof import("express");
  const boom = Router();
  boom.get("/string", async () => {
    throw "secret-internal-string";
  });
  boom.get("/object", () => {
    throw { code: "42P01", message: "relation usdusers does not exist" };
  });
  boom.get("/error", () => {
    throw new Error("connect ECONNREFUSED 10.0.0.5:5432");
  });
  boom.post("/json", (_req: unknown, res: { json: (b: unknown) => void }) => res.json({ ok: true }));

  const { startApp } = require("../testUtils/harness") as typeof import("../testUtils/harness");
  const { app } = require("../app") as typeof import("../app");
  const { errorHandler } = require("../middleware/errorHandler") as typeof import("../middleware/errorHandler");
  ({ url, server } = await startApp([
    ["/auth", require("./auth").default],
    ["/user", require("./user").default],
    ["/profile", require("./profile").default],
    ["/boom", boom],
  ]));
  app.use(errorHandler); // after every route, exactly as in server.ts
  console.error = (...args: unknown[]) => void errorLog.push(args);
});
after(() => server.close());

beforeEach(() => {
  errorLog = [];
  process.env.NODE_ENV = "test";
  queryImpl = async (sql) => (sql.includes("is_active FROM usdusers") ? { rows: [{ is_active: true }] } : { rows: [] });
  verifyIdTokenImpl = async () => {
    throw new Error("should not be called");
  };
});

// ------------------------------------------------------------ verifyToken

test("missing token -> 401 AUTH_TOKEN_MISSING", async () => {
  assertSafe(await call("GET", "/profile"), 401, "AUTH_TOKEN_MISSING");
});

test("malformed JWT -> 401 AUTH_TOKEN_INVALID, no jsonwebtoken text", async () => {
  assertSafe(await call("GET", "/profile", { token: "not.a.jwt" }), 401, "AUTH_TOKEN_INVALID");
});

test("JWT signed with the wrong secret -> AUTH_TOKEN_INVALID (no 'invalid signature')", async () => {
  const bad = jwt.sign({ sub: "uid-1" }, "other-secret", { algorithm: "HS256" });
  assertSafe(await call("GET", "/profile", { token: bad }), 401, "AUTH_TOKEN_INVALID");
});

test("expired JWT -> 401 AUTH_TOKEN_EXPIRED, no jsonwebtoken text", async () => {
  const expired = appJwt({ expiresIn: -60 });
  assertSafe(await call("GET", "/profile", { token: expired }), 401, "AUTH_TOKEN_EXPIRED");
});

test("unknown user and disabled user are indistinguishable (AUTH_USER_DISABLED, same message)", async () => {
  queryImpl = async () => ({ rows: [] });
  const missing = await call("GET", "/profile", { token: appJwt() });
  queryImpl = async () => ({ rows: [{ is_active: false }] });
  const disabled = await call("GET", "/profile", { token: appJwt() });
  assertSafe(missing, 403, "AUTH_USER_DISABLED");
  assertSafe(disabled, 403, "AUTH_USER_DISABLED");
  assert.equal(missing.json.error.message, disabled.json.error.message);
});

test("forced pg error in verifyToken -> 500 INTERNAL_ERROR, nothing internal leaked, logged with requestId", async () => {
  queryImpl = async () => {
    throw Object.assign(new Error('relation "usdusers" does not exist'), { code: "42P01" });
  };
  const r = await call("GET", "/profile", { token: appJwt() });
  assertSafe(r, 500, "INTERNAL_ERROR");
  const logged = errorLog.find((a) => String(a[0]).includes(r.json.requestId));
  assert.ok(logged, "full error must be logged against the requestId");
  assert.match(String((logged![1] as Error).message), /usdusers/);
});

// ------------------------------------------------------------ token exchange

test("POST /auth/login without idToken -> 400 AUTH_TOKEN_MISSING", async () => {
  assertSafe(await call("POST", "/auth/login", { body: "{}" }), 400, "AUTH_TOKEN_MISSING");
});

test("bad Firebase token -> 401 AUTH_TOKEN_INVALID, no Firebase text", async () => {
  verifyIdTokenImpl = async () => {
    throw Object.assign(new Error("Decoding Firebase ID token failed. Make sure you passed the entire string JWT"), {
      code: "auth/argument-error",
    });
  };
  assertSafe(await call("POST", "/auth/login", { body: JSON.stringify({ idToken: "garbage" }) }), 401, "AUTH_TOKEN_INVALID");
});

test("expired Firebase token -> 401 AUTH_TOKEN_EXPIRED", async () => {
  verifyIdTokenImpl = async () => {
    throw Object.assign(new Error("Firebase ID token has expired"), { code: "auth/id-token-expired" });
  };
  assertSafe(await call("POST", "/auth/login", { body: JSON.stringify({ idToken: "x" }) }), 401, "AUTH_TOKEN_EXPIRED");
});

test("pg failure during exchange -> 500 AUTH_EXCHANGE_FAILED, no pg text", async () => {
  verifyIdTokenImpl = async () => ({ uid: "u1", email: "a@b.co", email_verified: true, firebase: { sign_in_provider: "google.com" } });
  queryImpl = async () => {
    throw Object.assign(new Error("connect ECONNREFUSED 10.0.0.5:5432"), { code: "ECONNREFUSED" });
  };
  assertSafe(await call("POST", "/auth/login", { body: JSON.stringify({ idToken: "x" }) }), 500, "AUTH_EXCHANGE_FAILED");
});

test("thrown non-Error value during exchange -> AUTH_EXCHANGE_FAILED", async () => {
  verifyIdTokenImpl = async () => {
    throw "secret-internal-string"; // eslint-disable-line no-throw-literal
  };
  // verifyIdToken failures are treated as bad tokens; make the DB step throw a string instead.
  verifyIdTokenImpl = async () => ({ uid: "u1", email: "a@b.co", email_verified: true, firebase: {} });
  queryImpl = async () => {
    throw "secret-internal-string"; // eslint-disable-line no-throw-literal
  };
  assertSafe(await call("POST", "/auth/login", { body: JSON.stringify({ idToken: "x" }) }), 500, "AUTH_EXCHANGE_FAILED");
});

test("POST /user with a bad Firebase token -> AUTH_TOKEN_INVALID; without header -> AUTH_TOKEN_MISSING", async () => {
  verifyIdTokenImpl = async () => {
    throw Object.assign(new Error("Decoding Firebase ID token failed"), { code: "auth/argument-error" });
  };
  assertSafe(await call("POST", "/user", { token: "garbage", body: "{}" }), 401, "AUTH_TOKEN_INVALID");
  assertSafe(await call("POST", "/user", { body: "{}" }), 401, "AUTH_TOKEN_MISSING");
});

// ------------------------------------------------------------ profile

test("PATCH /profile invalid satScore -> 400 PROFILE_INVALID", async () => {
  const r = await call("PATCH", "/profile", { token: appJwt(), body: JSON.stringify({ satScore: 5 }) });
  assert.equal(r.res.status, 400);
  assert.equal(r.json.error.code, "PROFILE_INVALID");
  assert.equal(r.json.requestId, r.res.headers.get("x-request-id"));
});

test("forced pg error in PATCH /profile -> 500 INTERNAL_ERROR, no pg text", async () => {
  queryImpl = async (sql) => {
    if (sql.includes("is_active FROM usdusers")) return { rows: [{ is_active: true }] };
    throw Object.assign(new Error('relation "usdusers" does not exist'), { code: "42P01" });
  };
  const r = await call("PATCH", "/profile", { token: appJwt(), body: JSON.stringify({ fullName: "x" }) });
  assertSafe(r, 500, "INTERNAL_ERROR");
});

// ------------------------------------------------------------ global handler

test("global handler: thrown string, plain object and Error all -> safe INTERNAL_ERROR", async () => {
  assertSafe(await call("GET", "/boom/string"), 500, "INTERNAL_ERROR");
  assertSafe(await call("GET", "/boom/object"), 500, "INTERNAL_ERROR");
  assertSafe(await call("GET", "/boom/error"), 500, "INTERNAL_ERROR");
});

test("global handler: malformed JSON body -> 400 INVALID_REQUEST without parser text", async () => {
  assertSafe(await call("POST", "/boom/json", { body: "{not json" }), 400, "INVALID_REQUEST");
});

test("production never returns debug detail; development may", async () => {
  process.env.NODE_ENV = "production";
  const prod = await call("GET", "/boom/error");
  assertSafe(prod, 500, "INTERNAL_ERROR");
  assert.ok(!("debug" in prod.json));

  process.env.NODE_ENV = "development";
  const dev = await call("GET", "/boom/error");
  assert.equal(dev.res.status, 500);
  assert.match(dev.json.debug.message, /ECONNREFUSED/);

  delete process.env.NODE_ENV; // unset must behave like production
  const unset = await call("GET", "/boom/error");
  assert.ok(!("debug" in unset.json));
});

test("requestId: a well-formed incoming X-Request-Id is reused, an unsafe one is replaced", async () => {
  const ok = await call("GET", "/boom/error", { headers: { "X-Request-Id": "abc-12345678" } });
  assert.equal(ok.json.requestId, "abc-12345678");
  const bad = await call("GET", "/boom/error", { headers: { "X-Request-Id": "bad id!" } });
  assert.notEqual(bad.json.requestId, "bad id!");
  assert.match(bad.json.requestId, /^[0-9a-f-]{36}$/);
});

test("auth rate limiter responds with the safe shape (429 RATE_LIMITED)", async () => {
  let last;
  for (let i = 0; i < 25; i++) {
    last = await call("POST", "/auth/login", { body: "{}", headers: { "X-Forwarded-For": "203.0.113.200" } });
  }
  assertSafe(last!, 429, "RATE_LIMITED");
});
