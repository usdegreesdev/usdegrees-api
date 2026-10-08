import assert from "node:assert/strict";
import { test, before, after, mock } from "node:test";
import type { Server } from "http";

process.env.JWT_SECRET = "test-secret";
process.env.SITEMAP_RATE_LIMIT_PER_MIN = "3";

let url = "";
let server: Server;

before(async () => {
  const pool = require("../db/client").default;
  mock.method(pool, "query", async () => ({
    rows: [{ unitid: "100654", name: "leak", city: "x" }, { unitid: 100663, name: "leak" }],
  }));
  const { startApp } = require("../testUtils/harness") as typeof import("../testUtils/harness");
  ({ url, server } = await startApp([["/sitemap", require("./sitemap").default]]));
});
after(() => server.close());

test("returns only unitid, slug, updated_at, with 1h public cache", async () => {
  const res = await fetch(`${url}/sitemap/universities`, { headers: { "X-Forwarded-For": "198.51.100.1" } });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("cache-control"), "public, max-age=3600");
  const body = (await res.json()) as Array<Record<string, unknown>>;
  assert.deepEqual(body[0], { unitid: 100654, slug: null, updated_at: null });
  for (const row of body) assert.deepEqual(Object.keys(row).sort(), ["slug", "unitid", "updated_at"]);
});

test("is rate limited (429 after threshold)", async () => {
  const codes: number[] = [];
  for (let i = 0; i < 5; i++) {
    codes.push((await fetch(`${url}/sitemap/universities`, { headers: { "X-Forwarded-For": "198.51.100.2" } })).status);
  }
  assert.deepEqual(codes, [200, 200, 200, 429, 429]);
});
