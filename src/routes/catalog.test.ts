import assert from "node:assert/strict";
import { test, before, after, mock } from "node:test";
import type { Server } from "http";
import jwt from "jsonwebtoken";

process.env.JWT_SECRET = "test-secret";
process.env.PROXY_IP_SECRET = "proxy-secret";
process.env.CATALOG_RATE_LIMIT_ANON_PER_MIN = "5";
process.env.CATALOG_RATE_LIMIT_AUTH_PER_MIN = "8";

let url = "";
let server: Server;
let sqlLog: string[] = [];
let ipCounter = 0;

const searchRow = {
  program_title: "Nursing",
  cip_code: "513801",
  credential_title: "Bachelor's Degree",
  credential_level: 3,
  school_type: "Public",
  school_name: "Boston University",
  city: "Boston",
  state: "MA",
  school_url: "bu.edu",
  unitid: "164988",
  is_active: true,
  accreditor: "NECHE",
  admission_rate: "0.2",
  earnings_year_5: "60000",
  earnings_year_5_method: "interpolated",
  earnings_year_5_cohort: "2019",
  relevance_score: 1,
  tuition_in_state: "50000",
};
const collegeRow = {
  unitid: "164988",
  school_name: "Boston University",
  city: "Boston",
  state: "MA",
  school_url: "bu.edu",
  school_type: "Public",
};

function token(sub = "uid-1"): string {
  return jwt.sign({ sub }, "test-secret", { algorithm: "HS256" });
}

/** Distinct, validly signed client IP per call so tests never share a bucket. */
function freshIpHeaders(): Record<string, string> {
  const { signClientIp } = require("../middleware/clientIp") as typeof import("../middleware/clientIp");
  const ip = `198.51.100.${++ipCounter}`;
  return { "X-Client-IP": ip, "X-Proxy-Signature": signClientIp(ip, "proxy-secret") };
}

let userCounter = 0;

function get(path: string, opts: { auth?: boolean; sub?: string; headers?: Record<string, string> } = {}) {
  return fetch(`${url}${path}`, {
    headers: {
      ...(opts.headers ?? freshIpHeaders()),
      ...(opts.auth ? { Authorization: `Bearer ${token(opts.sub ?? `uid-${++userCounter}`)}` } : {}),
    },
  });
}

const lastDataSql = () => [...sqlLog].reverse().find((s) => !s.includes("COUNT(*)") && !s.includes("usdusers")) ?? "";

before(async () => {
  const pool = require("../db/client").default;
  mock.method(pool, "query", async (sql: string) => {
    sqlLog.push(sql);
    if (sql.includes("usdusers")) return { rows: [{ is_active: true }] };
    if (sql.includes("COUNT(*)")) return { rows: [{ total: "123" }] };
    if (sql.includes("FROM programs p")) return { rows: [searchRow] };
    return { rows: [collegeRow] };
  });
  const { startApp } = require("../testUtils/harness") as typeof import("../testUtils/harness");
  ({ url, server } = await startApp([
    ["/search", require("./search").default],
    ["/colleges", require("./colleges").default],
  ]));
});
after(() => server.close());

// ---------------------------------------------------------------- /search

test("/search no params: capped at 20 rows (no 1000 default), array shape kept", async () => {
  sqlLog = [];
  const res = await get("/search");
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(await res.json()));
  assert.match(lastDataSql(), /LIMIT 20 OFFSET 0/);
});

test("/search anonymous limit=10000 is clamped to 20", async () => {
  sqlLog = [];
  const res = await get("/search?limit=10000&page=1");
  assert.equal(res.status, 200);
  assert.match(lastDataSql(), /LIMIT 20 OFFSET 0/);
});

test("/search authenticated limit=10000 is clamped to 50; limit=30 honoured", async () => {
  sqlLog = [];
  await get("/search?limit=10000&page=1", { auth: true });
  assert.match(lastDataSql(), /LIMIT 50 OFFSET 0/);
  await get("/search?limit=30&page=2", { auth: true });
  assert.match(lastDataSql(), /LIMIT 30 OFFSET 30/);
});

test("/search invalid bearer token -> treated as anonymous (20 cap), not 401", async () => {
  sqlLog = [];
  const res = await get("/search?limit=50&page=1", { headers: { ...freshIpHeaders(), Authorization: "Bearer garbage" } });
  assert.equal(res.status, 200);
  assert.match(lastDataSql(), /LIMIT 20 OFFSET 0/);
});

test("/search page beyond depth cap -> 400 (page=25 ok, 26 and 9999 rejected)", async () => {
  sqlLog = [];
  assert.equal((await get("/search?limit=20&page=25")).status, 200);
  assert.match(lastDataSql(), /OFFSET 480/);
  assert.equal((await get("/search?limit=20&page=26")).status, 400);
  assert.equal((await get("/search?page=9999", { auth: true })).status, 400);
});

test("/search rejects non-numeric / zero / negative / repeated limit & page", async () => {
  for (const q of ["limit=abc", "limit=0", "limit=-5", "limit=1e3", "limit=10&limit=20", "page=abc", "page=0", "page=1.5"]) {
    assert.equal((await get(`/search?${q}`)).status, 400, q);
  }
});

test("/search response carries only allowlisted fields (no relevance_score), keeps earnings method fields", async () => {
  const res = await get("/search?limit=10&page=1");
  const body = (await res.json()) as { results: Array<Record<string, unknown>>; total: number };
  assert.equal(body.total, 123);
  const row = body.results[0];
  assert.ok(!("relevance_score" in row));
  assert.ok("earnings_year_5_method" in row);
  assert.ok("earnings_year_5_basis_is_estimated" in row);
  assert.equal(row.earnings_year_5_basis_is_estimated, true);
});

test("/search cache headers: anonymous public<=60s, authenticated private no-store, Vary: Authorization", async () => {
  const anon = await get("/search?limit=5");
  assert.equal(anon.headers.get("cache-control"), "public, max-age=60");
  assert.match(anon.headers.get("vary") ?? "", /Authorization/i);
  const authed = await get("/search?limit=5", { auth: true });
  assert.equal(authed.headers.get("cache-control"), "private, no-store");
  assert.match(authed.headers.get("vary") ?? "", /Authorization/i);
});

// -------------------------------------------------------------- /colleges

test("/colleges: anon clamped to 20, auth to 50, page depth capped", async () => {
  sqlLog = [];
  const anon = (await (await get("/colleges?limit=10000")).json()) as { limit: number };
  assert.equal(anon.limit, 20);
  const authed = (await (await get("/colleges?limit=10000", { auth: true })).json()) as { limit: number };
  assert.equal(authed.limit, 50);
  assert.equal((await get("/colleges?page=9999")).status, 400);
  assert.equal((await get("/colleges?limit=abc")).status, 400);
  assert.equal((await get("/colleges")).status, 200); // no term required
});

// ------------------------------------------------------- /colleges/search

test("/colleges/search: 1-char and empty term -> 400; 2 chars ok", async () => {
  assert.equal((await get("/colleges/search?query=b")).status, 400);
  assert.equal((await get("/colleges/search?query=%20b%20")).status, 400);
  assert.equal((await get("/colleges/search")).status, 400);
  assert.equal((await get("/colleges/search?query=bo")).status, 200);
});

test("/colleges/search: limit max 20 anon / 50 auth", async () => {
  const pool = require("../db/client").default;
  const seen: unknown[][] = [];
  const orig = pool.query;
  pool.query = async (sql: string, params: unknown[]) => {
    if (sql.includes("LIMIT $2")) seen.push(params);
    return orig(sql, params);
  };
  try {
    await get("/colleges/search?query=bo&limit=10000");
    await get("/colleges/search?query=bo&limit=10000", { auth: true });
  } finally {
    pool.query = orig;
  }
  assert.equal(seen[0][1], 20);
  assert.equal(seen[1][1], 50);
});

// ------------------------------------------------------------ rate limit

test("anonymous is rate limited per client IP: 429 after 5 requests, other IPs unaffected", async () => {
  const ipA = freshIpHeaders();
  const codes: number[] = [];
  for (let i = 0; i < 7; i++) codes.push((await get("/search?limit=1", { headers: ipA })).status);
  assert.deepEqual(codes, [200, 200, 200, 200, 200, 429, 429]);
  assert.equal((await get("/search?limit=1")).status, 200); // different IP
});

test("forged X-Client-IP cannot dodge the limit or poison another IP's bucket", async () => {
  // Same socket IP (127.0.0.1), rotating spoofed X-Client-IP with bad signatures.
  const codes: number[] = [];
  for (let i = 0; i < 7; i++) {
    codes.push(
      (
        await get("/colleges?limit=1", {
          headers: { "X-Client-IP": `203.0.113.${i + 1}`, "X-Proxy-Signature": "00".repeat(32) },
        })
      ).status,
    );
  }
  assert.equal(codes[codes.length - 1], 429);
  assert.equal(codes.filter((c) => c === 200).length, 5);
});

test("authenticated users are limited per user id (8/min), independent of IP", async () => {
  const codes: number[] = [];
  for (let i = 0; i < 10; i++) codes.push((await get("/search?limit=1", { auth: true, sub: "rate-user" })).status);
  assert.equal(codes.filter((c) => c === 200).length, 8);
  assert.equal(codes[9], 429);
});
