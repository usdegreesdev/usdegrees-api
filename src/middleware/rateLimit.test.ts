import assert from "node:assert/strict";
import { test, before, after } from "node:test";
import type { Server } from "http";
import { Router } from "express";
import { signClientIp } from "./clientIp";
import { startApp } from "../testUtils/harness";

const SECRET = "proxy-secret";
process.env.PROXY_IP_SECRET = SECRET;

let url: string;
let server: Server;

before(async () => {
  const { authRateLimit, reportGenerationRateLimit } = require("./rateLimit") as typeof import("./rateLimit");
  const mk = (limiter: typeof authRateLimit) => {
    const r = Router();
    r.post("/", limiter, (_q, s) => {
      s.json({ ok: true });
    });
    return r;
  };
  ({ url, server } = await startApp([
    ["/auth-probe", mk(authRateLimit)],
    ["/report-probe", mk(reportGenerationRateLimit)],
  ]));
});

after(() => server.close());

const signed = (ip: string) => ({ "X-Client-IP": ip, "X-Proxy-Signature": signClientIp(ip, SECRET) });
const hit = (path: string, headers: Record<string, string>) =>
  fetch(`${url}${path}`, { method: "POST", headers }).then((r) => r.status);

// All requests share one socket IP (127.0.0.1), so only X-Client-IP can separate buckets.
const cases: Array<[string, string, number]> = [
  ["authRateLimit", "/auth-probe", 20],
  ["reportGenerationRateLimit (no user id)", "/report-probe", 10],
];

for (const [name, path, limit] of cases) {
  test(`${name}: different signed X-Client-IPs get separate buckets`, async () => {
    const a = signed("203.0.113.10");
    const b = signed("203.0.113.11");
    for (let i = 0; i < limit; i++) assert.equal(await hit(path, a), 200);
    assert.equal(await hit(path, a), 429);
    assert.equal(await hit(path, b), 200, "visitor B must not share visitor A's bucket");
  });

  test(`${name}: unsigned or forged X-Client-IP falls back to req.ip`, async () => {
    const unsigned = { "X-Client-IP": "203.0.113.20" };
    const forged = { "X-Client-IP": "203.0.113.21", "X-Proxy-Signature": signClientIp("203.0.113.21", "wrong") };
    // Rotating spoofed IPs must all land in the single req.ip bucket.
    for (let i = 0; i < limit; i++) {
      const spoof = i % 2 ? unsigned : { ...forged, "X-Client-IP": `203.0.113.${100 + i}` };
      assert.equal(await hit(path, spoof), 200);
    }
    assert.equal(await hit(path, unsigned), 429);
    assert.equal(await hit(path, forged), 429);
  });
}
