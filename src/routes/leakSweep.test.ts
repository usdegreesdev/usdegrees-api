import assert from "node:assert/strict";
import { test, before, after, mock } from "node:test";
import type { Server } from "http";
import jwt from "jsonwebtoken";

process.env.JWT_SECRET = "test-secret";
process.env.NODE_ENV = "test";
process.env.REPORT_DOWNLOAD_TOKEN_SECRET = "test-report-secret";
process.env.CATALOG_RATE_LIMIT_ANON_PER_MIN = "3";

let url = "";
let server: Server;
let failQueries = true;
let ipCounter = 0;

const PG_ERR_TEXT = 'relation "secret_table" does not exist at 10.0.0.5:5432 password authentication failed';
const SECRETS = ["secret_table", "42P01", "10.0.0.5", "password authentication", "relation", "ECONN", "stack", "node_modules", " at "];

function token(sub = "uid-sweep"): string {
  return jwt.sign({ sub }, "test-secret", { algorithm: "HS256" });
}

async function call(method: string, path: string, opts: { auth?: boolean; body?: unknown } = {}) {
  const { signClientIp } = require("../middleware/clientIp") as typeof import("../middleware/clientIp");
  const ip = `203.0.113.${++ipCounter}`;
  const res = await fetch(`${url}${path}`, {
    method,
    headers: {
      "X-Client-IP": ip,
      "X-Proxy-Signature": signClientIp(ip, "proxy-secret"),
      ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(opts.auth ? { Authorization: `Bearer ${token()}` } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let json: Record<string, any> = {};
  try {
    json = JSON.parse(text);
  } catch {
    /* non-JSON */
  }
  return { res, text, json };
}

function assertEnvelope(r: Awaited<ReturnType<typeof call>>, status: number, code: string) {
  assert.equal(r.res.status, status, r.text);
  assert.deepEqual(Object.keys(r.json).sort(), ["error", "requestId"], r.text);
  assert.deepEqual(Object.keys(r.json.error).sort(), ["code", "message"], r.text);
  assert.equal(r.json.error.code, code, r.text);
  assert.equal(r.json.requestId, r.res.headers.get("x-request-id"));
  for (const s of SECRETS) assert.ok(!r.text.includes(s), `leaked "${s}": ${r.text}`);
}

before(async () => {
  process.env.PROXY_IP_SECRET = "proxy-secret";
  const firebasePath = require.resolve("../config/firebase");
  require.cache[firebasePath] = {
    id: firebasePath,
    filename: firebasePath,
    loaded: true,
    exports: { firebaseAuth: {} },
  } as unknown as NodeJS.Module;

  const pool = require("../db/client").default;
  mock.method(pool, "query", async (sql: string) => {
    if (sql.includes("is_active FROM usdusers")) return { rows: [{ is_active: true }] };
    if (failQueries) throw Object.assign(new Error(PG_ERR_TEXT), { code: "42P01" });
    return { rows: [] };
  });
  mock.method(pool, "connect", async () => {
    throw Object.assign(new Error(PG_ERR_TEXT), { code: "ECONNREFUSED" });
  });

  const { startApp } = require("../testUtils/harness") as typeof import("../testUtils/harness");
  const { app } = require("../app") as typeof import("../app");
  const { errorHandler } = require("../middleware/errorHandler") as typeof import("../middleware/errorHandler");
  ({ url, server } = await startApp([
    ["/search", require("./search").default],
    ["/colleges", require("./colleges").default],
    ["/catalog", require("./catalog").default],
    ["/sitemap", require("./sitemap").default],
    ["/compare", require("./compare").default],
    ["/saved-colleges", require("./savedColleges").default],
    ["/report", require("./report").default],
    ["/athletics", require("./athletics").default],
    ["/programs", require("./programs").default],
    ["/tuition", require("./tuition").default],
    ["/campus", require("./campus").default],
    ["/college-summary", require("./collegeSummary").default],
    ["/outcomes", require("./outcomes").default],
    ["/overview", require("./overviewDetails").default],
    ["/courses", require("./courses").default],
    ["/popular-categories", require("./popularCategories").default],
    ["/schools", require("./schoollevelsearch").default],
    ["/analytics", require("./analytics").default],
  ]));
  app.use(errorHandler);
});
after(() => server.close());

// One forced-pg-error leak test per route family (public routes, then authenticated ones).
const FAMILIES: Array<[string, string, string, boolean?, unknown?]> = [
  ["search", "GET", "/search?limit=1&page=1"],
  ["colleges", "GET", "/colleges?limit=1"],
  ["colleges/search", "GET", "/colleges/search?query=bo"],
  ["colleges/:unitid", "GET", "/colleges/1"],
  ["catalog", "GET", "/catalog/programs-by-credential?credential_title=x"],
  ["sitemap", "GET", "/sitemap/universities"],
  ["athletics", "GET", "/athletics/division-benchmarks"],
  ["programs list", "GET", "/programs"],
  ["programs schools", "GET", "/programs/5201/schools"],
  ["programs academic", "GET", "/programs/1"],
  ["tuition", "GET", "/tuition/1"],
  ["campus", "GET", "/campus/1"],
  ["college-summary", "GET", "/college-summary/1"],
  ["outcomes", "GET", "/outcomes/1/5201"],
  ["overview", "GET", "/overview/1/5201"],
  ["courses", "GET", "/courses"],
  ["popular-categories", "GET", "/popular-categories"],
  ["schoollevelsearch autocomplete", "GET", "/schools/1/programs/autocomplete?q=co"],
  ["schoollevelsearch all", "GET", "/schools/1/programs"],
  ["compare colleges", "GET", "/compare/colleges?unitids=1,2", true],
  ["compare selected", "GET", "/compare/selected", true],
  ["compare matrix", "GET", "/compare/matrix", true],
  ["compare athletics", "GET", "/compare/athletics?unitids=1,2", true],
  ["saved colleges", "GET", "/saved-colleges", true],
  ["reports list", "GET", "/report", true],
  ["report fetch", "GET", "/report/abc/email-nonexistent-but-safe", true],
];

for (const [name, method, path, auth, body] of FAMILIES) {
  test(`leak test: ${name} - forced pg error returns the safe envelope`, async () => {
    failQueries = true;
    const r = await call(method, path, { auth, body });
    // Whatever the status, a failing DB must never put internal text on the wire.
    for (const s of SECRETS) assert.ok(!r.text.includes(s), `leaked "${s}": ${r.text}`);
    if (r.res.status >= 500) assertEnvelope(r, 500, "INTERNAL_ERROR");
    else assert.ok(r.res.status < 500);
  });
}

// The families above must actually reach the DB; assert the 500s explicitly for the
// ones whose handlers query unconditionally.
for (const [name, path, auth] of [
  ["search", "/search?limit=1&page=1", false],
  ["colleges", "/colleges?limit=1", false],
  ["catalog", "/catalog/programs-by-credential?credential_title=x", false],
  ["sitemap", "/sitemap/universities", false],
  ["tuition", "/tuition/1", false],
  ["campus", "/campus/1", false],
  ["college-summary", "/college-summary/1", false],
  ["programs academic", "/programs/1", false],
  ["outcomes", "/outcomes/1/5201", false],
  ["overview", "/overview/1/5201", false],
  ["courses", "/courses", false],
  ["saved colleges", "/saved-colleges", true],
  ["compare selected", "/compare/selected", true],
] as Array<[string, string, boolean]>) {
  test(`500 envelope asserted: ${name}`, async () => {
    failQueries = true;
    assertEnvelope(await call("GET", path, { auth }), 500, "INTERNAL_ERROR");
  });
}

// ------------------------------------------------------- echoed input

test("invalid unitid 400s use a fixed message and never echo the value", async () => {
  for (const base of ["/tuition", "/campus", "/college-summary", "/programs"]) {
    const r = await call("GET", `${base}/not-a-number-XYZ`);
    assert.equal(r.res.status, 400, `${base}: ${r.text}`);
    assert.equal(r.json.error.code, "INVALID_UNITID");
    assert.ok(!r.text.includes("XYZ"), r.text);
  }
});

test("404s do not echo unitid / cip_code", async () => {
  failQueries = false;
  for (const path of ["/outcomes/1/CIPMARK", "/overview/1/CIPMARK"]) {
    const r = await call("GET", path);
    assert.equal(r.res.status, 404, `${path}: ${r.text}`);
    assertEnvelope(r, 404, "NOT_FOUND");
    assert.ok(!r.text.includes("CIPMARK"), r.text);
  }
  failQueries = true;
});

// ------------------------------------------------------- rate limiters

test("catalog limiter 429 uses the RATE_LIMITED envelope and keeps Retry-After", async () => {
  const { signClientIp } = require("../middleware/clientIp") as typeof import("../middleware/clientIp");
  const headers = { "X-Client-IP": "198.18.0.77", "X-Proxy-Signature": signClientIp("198.18.0.77", "proxy-secret") };
  failQueries = false;
  let last: Response | undefined;
  let text = "";
  for (let i = 0; i < 5; i++) {
    last = await fetch(`${url}/colleges?limit=1`, { headers });
    text = await last.text();
  }
  assert.equal(last!.status, 429);
  const body = JSON.parse(text);
  assert.equal(body.error.code, "RATE_LIMITED");
  assert.equal(body.requestId, last!.headers.get("x-request-id"));
  assert.ok(Number(last!.headers.get("retry-after")) > 0, "Retry-After must be kept");
  failQueries = true;
});

test("report-generation limiter 429 uses the RATE_LIMITED envelope and keeps Retry-After", async () => {
  const { Router } = require("express") as typeof import("express");
  const { app } = require("../app") as typeof import("../app");
  const { reportGenerationRateLimit } = require("../middleware/rateLimit") as typeof import("../middleware/rateLimit");
  const r = Router();
  r.post("/", reportGenerationRateLimit, (_q: unknown, s: { json: (b: unknown) => void }) => s.json({ ok: true }));
  app.use("/limit-probe", r);
  let last: Response | undefined;
  let text = "";
  for (let i = 0; i < 11; i++) {
    last = await fetch(`${url}/limit-probe`, { method: "POST", headers: { "X-Forwarded-For": "198.18.0.99" } });
    text = await last.text();
  }
  assert.equal(last!.status, 429);
  assert.equal(JSON.parse(text).error.code, "RATE_LIMITED");
  assert.ok(Number(last!.headers.get("retry-after")) > 0);
});
