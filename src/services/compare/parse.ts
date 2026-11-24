/** Small pure helpers for parsing request values and shaping compare rows. */
import {
  normalizeCipCode,
  normalizeDegreeBucket,
  normalizeStateCode,
} from "../../utils/preferenceAlignment";

export function toNum(val: unknown): number | null {
  if (val === null || val === undefined) return null;
  const n = typeof val === "string" ? parseInt(val, 10) : Number(val);
  return isNaN(n) ? null : n;
}

export function toStr(val: unknown): string | null {
  if (val === null || val === undefined) return null;
  const s = String(val).trim();
  return s.length === 0 ? null : s;
}

/**
 * Normalize a school URL for safe linking: null/empty -> null; already has
 * http(s):// -> untouched; otherwise prefix https://.
 */
export function normalizeUrl(val: unknown): string | null {
  if (val === null || val === undefined) return null;
  const s = String(val).trim();
  if (!s) return null;
  return /^https?:\/\//i.test(s) ? s : `https://${s}`;
}

/** Collect unitids from a { unitid } or { unitids: [...] } body as positive ints. */
export function collectUnitids(body: Record<string, unknown>): number[] {
  const raw: unknown[] = Array.isArray(body.unitids)
    ? body.unitids
    : body.unitid !== undefined
      ? [body.unitid]
      : [];
  const out: number[] = [];
  const seen = new Set<number>();
  for (const v of raw) {
    const n = toNum(v);
    if (n === null || !Number.isInteger(n) || n <= 0 || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}

/** Float-safe numeric parse (admission_rate etc. arrive from pg as strings). */
export function toFloat(val: unknown): number | null {
  if (val === null || val === undefined) return null;
  const n = typeof val === "string" ? parseFloat(val) : Number(val);
  return Number.isFinite(n) ? n : null;
}

/** Normalized alignment fields for one enriched row (selected program + school state). */
export function alignmentFields(row: Record<string, unknown>): {
  cipCode: string | null;
  degreeLevel: string | null;
  stateCode: string | null;
} {
  return {
    cipCode: normalizeCipCode(row.sel_program_cip),
    degreeLevel:
      normalizeDegreeBucket(row.sel_program_credential_level) ??
      normalizeDegreeBucket(row.sel_program_credential_title),
    stateCode: normalizeStateCode(row.state),
  };
}

/** Format a raw ratio (e.g. 14.2) as "14:1", matching /programs' convention. */
export function formatRatio(val: unknown): string | null {
  const n = toFloat(val);
  if (n === null) return null;
  const display =
    n < 10 ? n.toFixed(1).replace(/\.0$/, "") : Math.round(n).toString();
  return `${display}:1`;
}

export function toLocation(city: unknown, state: unknown): string | null {
  const parts = [city, state]
    .map((v) => (v == null ? "" : String(v).trim()))
    .filter((v) => v.length > 0);
  return parts.length ? parts.join(", ") : null;
}
