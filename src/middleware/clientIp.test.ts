import assert from "node:assert/strict";
import { test, beforeEach } from "node:test";
import type { Request } from "express";
import { resolveClientIp, signClientIp } from "./clientIp";

const SECRET = "proxy-secret";

function fakeReq(headers: Record<string, string>, ip = "10.0.0.9"): Request {
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return { ip, header: (n: string) => lower[n.toLowerCase()] } as unknown as Request;
}

beforeEach(() => {
  process.env.PROXY_IP_SECRET = SECRET;
});

test("valid signature -> X-Client-IP is used", () => {
  const req = fakeReq({ "X-Client-IP": "203.0.113.7", "X-Proxy-Signature": signClientIp("203.0.113.7", SECRET) });
  assert.equal(resolveClientIp(req), "203.0.113.7");
});

test("forged signature -> X-Client-IP ignored, falls back to req.ip", () => {
  const req = fakeReq({ "X-Client-IP": "203.0.113.7", "X-Proxy-Signature": signClientIp("203.0.113.7", "wrong") });
  assert.equal(resolveClientIp(req), "10.0.0.9");
});

test("missing signature -> ignored", () => {
  assert.equal(resolveClientIp(fakeReq({ "X-Client-IP": "203.0.113.7" })), "10.0.0.9");
});

test("signature for a different IP -> ignored", () => {
  const req = fakeReq({ "X-Client-IP": "203.0.113.8", "X-Proxy-Signature": signClientIp("203.0.113.7", SECRET) });
  assert.equal(resolveClientIp(req), "10.0.0.9");
});

test("malformed signature (non-hex / wrong length) -> ignored, no throw", () => {
  for (const sig of ["zz", "", "abcd", "g".repeat(64)]) {
    assert.equal(resolveClientIp(fakeReq({ "X-Client-IP": "203.0.113.7", "X-Proxy-Signature": sig })), "10.0.0.9");
  }
});

test("non-IP X-Client-IP is ignored even with a valid signature", () => {
  const req = fakeReq({ "X-Client-IP": "not-an-ip", "X-Proxy-Signature": signClientIp("not-an-ip", SECRET) });
  assert.equal(resolveClientIp(req), "10.0.0.9");
});

test("PROXY_IP_SECRET unset -> header never trusted", () => {
  delete process.env.PROXY_IP_SECRET;
  const req = fakeReq({ "X-Client-IP": "203.0.113.7", "X-Proxy-Signature": signClientIp("203.0.113.7", "") });
  assert.equal(resolveClientIp(req), "10.0.0.9");
});
