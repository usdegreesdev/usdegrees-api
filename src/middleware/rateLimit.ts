import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { sendError } from "../utils/apiError";

/**
 * Auth endpoints (login / token exchange) have no other abuse control —
 * limit by IP since the caller isn't authenticated yet.
 */
export const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => sendError(req, res, 429, "RATE_LIMITED"),
});

/**
 * Report generation triggers a real Gemini API call plus a headless-Chrome
 * PDF render per request — both cost money and compute. Limited per
 * authenticated user (req.userId, set by verifyToken) so one account can't
 * loop this to rack up unlimited Gemini/compute cost; falls back to IP for
 * any request that somehow reaches this without a resolved user.
 */
export const reportGenerationRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) =>
    (req as { userId?: string }).userId || ipKeyGenerator(req.ip || "unknown"),
  message: {
    error: "Report generation limit reached. Please try again later.",
  },
});

function envInt(name: string, fallback: number): number {
  const n = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * Public catalog routes (/search, /colleges, /colleges/search).
 * Anonymous callers are bucketed by client IP (signed X-Client-IP from the
 * Next server when valid, else req.ip � see clientIp middleware); signed-in
 * callers by user id with a higher ceiling. Must run after optionalAuth.
 * Limits are read at call time so they stay env-configurable.
 */
export const catalogRateLimit = rateLimit({
  windowMs: 60 * 1000,
  limit: (req) =>
    (req as { userId?: string }).userId
      ? envInt("CATALOG_RATE_LIMIT_AUTH_PER_MIN", 120)
      : envInt("CATALOG_RATE_LIMIT_ANON_PER_MIN", 60),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const userId = (req as { userId?: string }).userId;
    if (userId) return `user:${userId}`;
    return `ip:${ipKeyGenerator(req.clientIp || req.ip || "unknown")}`;
  },
  message: { error: "Too many requests. Please try again later." },
});

/** Sitemap feed: public, IP-keyed, cheap but a full-table read. */
export const sitemapRateLimit = rateLimit({
  windowMs: 60 * 1000,
  limit: (_req) => envInt("SITEMAP_RATE_LIMIT_PER_MIN", 30),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `ip:${ipKeyGenerator(req.clientIp || req.ip || "unknown")}`,
  message: { error: "Too many requests. Please try again later." },
});
