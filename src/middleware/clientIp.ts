import { createHmac, timingSafeEqual } from "crypto";
import { isIP } from "net";
import { Request, Response, NextFunction } from "express";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** IP to rate-limit on: signed X-Client-IP when valid, else req.ip. */
      clientIp?: string;
    }
  }
}

/**
 * Most traffic reaches this API from the Next.js server (proxy + SSR), so
 * req.ip is the Next server's IP, not the end user's. The Next server
 * forwards the real client IP in X-Client-IP together with
 * X-Proxy-Signature = hex HMAC-SHA256(X-Client-IP, PROXY_IP_SECRET).
 *
 * The header is trusted ONLY when the signature verifies (constant-time).
 * Anything else — missing secret, missing/forged/malformed signature,
 * non-IP value — falls back to req.ip. The header carries an IP only and
 * grants no data access; it just picks the rate-limit bucket.
 */
export function signClientIp(ip: string, secret: string): string {
  return createHmac("sha256", secret).update(ip).digest("hex");
}

function hasValidSignature(ip: string, signature: string, secret: string): boolean {
  const expected = Buffer.from(signClientIp(ip, secret), "hex");
  const given = Buffer.from(signature, "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export function resolveClientIp(req: Request): string {
  const secret = process.env.PROXY_IP_SECRET;
  const claimed = req.header("x-client-ip");
  const signature = req.header("x-proxy-signature");
  if (secret && claimed && signature && isIP(claimed) !== 0) {
    if (hasValidSignature(claimed, signature, secret)) return claimed;
  }
  return req.ip || "unknown";
}

export function clientIp(req: Request, _res: Response, next: NextFunction): void {
  req.clientIp = resolveClientIp(req);
  // Temporary: set DEBUG_CLIENT_IP=1 to confirm TRUST_PROXY_HOPS on Render.
  if (process.env.DEBUG_CLIENT_IP === "1") {
    console.log(
      `[client-ip] req.ip=${req.ip} xff=${req.header("x-forwarded-for") ?? "(none)"} ` +
        `x-client-ip=${req.header("x-client-ip") ?? "(none)"} resolved=${req.clientIp}`,
    );
  }
  next();
}
