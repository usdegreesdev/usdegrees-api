import { Request, RequestHandler } from "express";
import { optionalAuth } from "../middleware/auth";
import { catalogRateLimit } from "../middleware/rateLimit";
import { AuthRequest } from "../types/user";

/**
 * Hard caps for the public catalog routes (/search, /colleges,
 * /colleges/search). These live at the route layer; shared query functions
 * keep their own limits.
 */
export const CATALOG_CAPS = {
  defaultLimit: 20,
  anonMaxLimit: 20,
  authMaxLimit: 50,
  /** Deepest page a caller may request (any tier). */
  maxPage: 25,
  minTermLength: 2,
} as const;

export function maxLimitFor(req: AuthRequest): number {
  return req.userId ? CATALOG_CAPS.authMaxLimit : CATALOG_CAPS.anonMaxLimit;
}

export type PagingResult =
  | { ok: true; limit: number; page: number; offset: number }
  | { ok: false; error: string };

function parsePositiveInt(raw: unknown): number | null | undefined {
  if (raw === undefined) return undefined; // absent
  if (typeof raw !== "string" || !/^\d{1,9}$/.test(raw)) return null; // junk / repeated param
  const n = Number(raw);
  return n >= 1 ? n : null;
}

/**
 * Strict limit/page parsing.
 *  - non-numeric, zero, negative, or repeated limit/page -> 400
 *  - limit above the tier cap -> silently clamped to the cap
 *  - page deeper than CATALOG_CAPS.maxPage -> 400 (clamping would return
 *    misleading rows for a page the caller didn't ask for)
 */
export function parseCatalogPaging(req: AuthRequest | Request): PagingResult {
  const maxLimit = maxLimitFor(req as AuthRequest);
  const limitRaw = parsePositiveInt(req.query.limit);
  const pageRaw = parsePositiveInt(req.query.page);

  if (limitRaw === null) return { ok: false, error: "limit must be a positive integer" };
  if (pageRaw === null) return { ok: false, error: "page must be a positive integer" };

  const limit = Math.min(limitRaw ?? CATALOG_CAPS.defaultLimit, maxLimit);
  const page = pageRaw ?? 1;
  if (page > CATALOG_CAPS.maxPage) {
    return { ok: false, error: `page must be at most ${CATALOG_CAPS.maxPage}` };
  }
  return { ok: true, limit, page, offset: (page - 1) * limit };
}

/**
 * Sets tier-appropriate cache headers: signed-in responses are never cached;
 * anonymous responses may be cached briefly. Vary: Authorization either way
 * so a shared cache can't serve one tier's response to the other.
 */
const catalogCacheHeaders: RequestHandler = (req, res, next) => {
  res.vary("Authorization");
  res.set(
    "Cache-Control",
    (req as AuthRequest).userId ? "private, no-store" : "public, max-age=60",
  );
  next();
};

/** optionalAuth -> per-tier rate limit -> cache headers. */
export const catalogGuard: RequestHandler[] = [
  optionalAuth as RequestHandler,
  catalogRateLimit,
  catalogCacheHeaders,
];

export const MAX_MULTI_VALUES = 10;

export type MultiValueResult =
  | { ok: true; values: string[] }
  | { ok: false; error: string };

/**
 * Parses a comma-separated filter (e.g. state=MA,NY). Absent/empty -> no
 * values (no filter). More than MAX_MULTI_VALUES, or a repeated query param
 * (array/object), -> error. A single value parses to a one-element list.
 */
export function parseMultiValue(raw: unknown, name: string): MultiValueResult {
  if (raw === undefined) return { ok: true, values: [] };
  if (typeof raw !== "string") return { ok: false, error: `${name} must be a single comma-separated value` };
  const values = [...new Set(raw.split(",").map((v) => v.trim()).filter(Boolean))];
  if (values.length > MAX_MULTI_VALUES) {
    return { ok: false, error: `${name} accepts at most ${MAX_MULTI_VALUES} values` };
  }
  return { ok: true, values };
}

/** Appends `AND col = $n` / `AND col IN ($n,...)` and pushes the params. */
export function appendInFilter(
  column: string,
  values: string[],
  params: (string | number)[],
): string {
  if (values.length === 0) return "";
  const idx = values.map((v) => {
    params.push(v);
    return `$${params.length}`;
  });
  return values.length === 1 ? ` AND ${column} = ${idx[0]}` : ` AND ${column} IN (${idx.join(", ")})`;
}
