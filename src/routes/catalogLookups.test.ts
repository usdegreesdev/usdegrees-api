import assert from "node:assert/strict";
import { test, before, after, mock } from "node:test";
import type { Server } from "http";
import jwt from "jsonwebtoken";

process.env.JWT_SECRET = "test-secret";
process.env.PROXY_IP_SECRET = "proxy-secret";
process.env.CATALOG_RATE_LIMIT_ANON_PER_MIN = "5";

let url = "";
let server: Server;
let calls: Array<{ sql: string; params: unknown[] }> = [];
let ipCounter = 0;
let userCounter = 0;

function headers(auth = false): Record<string, string> {
  const { signClientIp } = require("../middleware/clientIp") as typeof import("../middleware/clientIp");
  const ip = `192.0.2.${++ipCounter}`;
  return {
    "X-Client-IP": ip,
    "X-Proxy-Signature": signClientIp(ip, "proxy-secret"),
    ...(auth ? { Authorization: `Bearer ${jwt.sign({ sub: `u${++userCounter}` }, "test-secret", { algorithm: "HS256" })}` } : {}),
  };
}
const get = (path: string, auth = false) => fetch(`${url}${path}`, { headers: headers(auth) });
const last = (re: RegExp) => [...calls].reverse().find((c) => re.test(c.sql));

before(async () => {
  const pool = require("../db/client").default;
  mock.method(pool, "query", async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    if (sql.includes("usdusers")) return { rows: [{ is_active: true }] };
    if (sql.includes("COUNT(*)")) return { rows: [{ total: "77" }] };
    if (sql.includes("SELECT DISTINCT p.title")) {
      return { rows: [{ program_title: "Accounting", cip_code: "520301" }] };
    }
    if (sql.includes("FROM schools s")) {
      return { rows: [{ unitid: "1", school_name: "A", city: "B", state: "MA", extra: "leak" }] };
    }
    return { rows: [] };
  });
  const { startApp } = require("../testUtils/harness") as typeof import("../testUtils/harness");
  ({ url, server } = await startApp([
    ["/catalog", require("./catalog").default],
    ["/search", require("./search").default],
  ]));
});
after(() => server.close());

const BACH = "Bachelor%27s%20Degree";
const MAST = "Master%27s%20Degree";

// ------------------------------------------------- programs-by-credential

test("programs-by-credential: credential_title required -> 400", async () => {
  assert.equal((await get("/catalog/programs-by-credential")).status, 400);
  assert.equal((await get("/catalog/programs-by-credential?credential_title=%20")).status, 400);
});

test("programs-by-credential: returns {program_title,cip_code}, public 1h cache, sorted+distinct SQL", async () => {
  const res = await get(`/catalog/programs-by-credential?credential_title=${BACH}`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("cache-control"), "public, max-age=3600");
  assert.deepEqual(await res.json(), [{ program_title: "Accounting", cip_code: "520301" }]);
  const c = last(/SELECT DISTINCT p\.title/)!;
  assert.match(c.sql, /ORDER BY p\.title ASC/);
  assert.doesNotMatch(c.sql, /LIMIT/);
  assert.deepEqual(c.params, ["Bachelor's Degree"]);
});

test("programs-by-credential: shares the catalog rate limiter (429)", async () => {
  const h = headers();
  const codes: number[] = [];
  for (let i = 0; i < 7; i++) {
    codes.push((await fetch(`${url}/catalog/programs-by-credential?credential_title=x`, { headers: h })).status);
  }
  assert.deepEqual(codes, [200, 200, 200, 200, 200, 429, 429]);
});

// ---------------------------------------------------- schools-for-program

test("schools-for-program: cip_code and credential_title required", async () => {
  assert.equal((await get("/catalog/schools-for-program")).status, 400);
  assert.equal((await get("/catalog/schools-for-program?cip_code=520301")).status, 400);
  assert.equal((await get(`/catalog/schools-for-program?credential_title=${MAST}`)).status, 400);
});

test("schools-for-program: shape is {results:[4 fields], total}", async () => {
  const res = await get(`/catalog/schools-for-program?cip_code=520301&credential_title=${MAST}`);
  assert.equal(res.status, 200);
  const body = (await res.json()) as { results: Array<Record<string, unknown>>; total: number };
  assert.equal(body.total, 77);
  assert.deepEqual(Object.keys(body.results[0]).sort(), ["city", "school_name", "state", "unitid"]);
});

test("schools-for-program: q needs >=2 chars; q is ILIKE-escaped and parameterised", async () => {
  const base = "/catalog/schools-for-program?cip_code=1&credential_title=x";
  assert.equal((await get(`${base}&q=b`)).status, 400);
  assert.equal((await get(`${base}&q=`)).status, 400);
  assert.equal((await get(`${base}&q=bo%25_`)).status, 200);
  const c = last(/ILIKE/)!;
  assert.match(c.sql, /s\.name ILIKE \$3/);
  assert.equal(c.params[2], "%bo\\%\\_%");
});

test("schools-for-program: caps 20 anon / 50 auth, page depth 25, bad values 400", async () => {
  const base = "/catalog/schools-for-program?cip_code=1&credential_title=x";
  await get(`${base}&limit=10000`);
  assert.match(last(/LIMIT/)!.sql, /LIMIT 20 OFFSET 0/);
  await get(`${base}&limit=10000&page=2`, true);
  assert.match(last(/LIMIT/)!.sql, /LIMIT 50 OFFSET 50/);
  assert.equal((await get(`${base}&page=25`)).status, 200);
  assert.equal((await get(`${base}&page=26`)).status, 400);
  assert.equal((await get(`${base}&limit=abc`)).status, 400);
});

test("schools-for-program: cache headers follow the tier", async () => {
  const base = "/catalog/schools-for-program?cip_code=1&credential_title=x";
  assert.equal((await get(base)).headers.get("cache-control"), "public, max-age=60");
  assert.equal((await get(base, true)).headers.get("cache-control"), "private, no-store");
});

// ------------------------------------------------ /search multi-value

test("/search: single state / credential_title unchanged (= $n)", async () => {
  await get(`/search?state=MA&credential_title=${BACH}&limit=5`);
  const c = last(/FROM programs p/)!;
  assert.match(c.sql, /p\.credential_title = \$1 AND s\.state = \$2/);
  assert.deepEqual(c.params.slice(0, 2), ["Bachelor's Degree", "MA"]);
});

test("/search: comma-separated values become IN (...)", async () => {
  await get(`/search?state=MA,NY,%20CA&credential_title=${BACH},${MAST}&limit=5`);
  const c = last(/FROM programs p/)!;
  assert.match(c.sql, /p\.credential_title IN \(\$1, \$2\) AND s\.state IN \(\$3, \$4, \$5\)/);
  assert.deepEqual(c.params.slice(0, 5), ["Bachelor's Degree", "Master's Degree", "MA", "NY", "CA"]);
});

test("/search: 10 values ok, 11 -> 400, repeated param -> 400", async () => {
  const ten = Array.from({ length: 10 }, (_, i) => `S${i}`).join(",");
  assert.equal((await get(`/search?state=${ten}&limit=1`)).status, 200);
  assert.equal((await get(`/search?state=${ten},S10&limit=1`)).status, 400);
  assert.equal((await get(`/search?credential_title=${ten},S10&limit=1`)).status, 400);
  assert.equal((await get("/search?state=MA&state=NY")).status, 400);
});
