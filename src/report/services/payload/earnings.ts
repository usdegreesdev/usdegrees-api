/** Program earnings (year 1 / 5 / 10 of a single graduating cohort). */
import pool from "../../../db/client";
import { getEarningsPathForProgram } from "../../../services/earnings.service";

// ------------------------------------------------------------------
// Resolve a program's programs.credential_level from its CIP code. Shared by
// fetchProgramEarnings and fetchRoi so a program is only ever resolved once
// per school per report (previously each fetched it independently).
// ------------------------------------------------------------------
export async function resolveCredentialLevel(
  unitid: number,
  programCip: string,
): Promise<number | null> {
  const { rows } = await pool.query(
    `SELECT credential_level FROM programs WHERE unitid = $1 AND replace(cip_code, '.', '') = replace($2, '.', '') LIMIT 1`,
    [unitid, programCip],
  );
  return rows[0]?.credential_level ?? null;
}

// ------------------------------------------------------------------
// Program earnings (year_10) — program-level if cip+credential_level are
// both known, else aggregate.
//
// Delegates cohort selection to earnings.service.ts's getEarningsForProgram
// (the same recency-first resolver /compare and /search use) instead of a
// separate ORDER BY grad_cohort DESC query: that naive string-sort query
// ignored credential_level entirely and had no special handling for the
// '0000' sentinel grad_cohort ("unknown/aggregate placeholder", not a real
// class year — see earnings.service.ts) or for skipped_future/
// skipped_no_anchor rows, so it could surface either the placeholder cohort
// or an unrelated credential tier's figure as if it were a real citation.
// ------------------------------------------------------------------
// Parent-facing labels for the internal earnings method enum. Raw enum values
// (e.g. "user_reported") must never reach the report.
const EARNINGS_METHOD_LABELS: Record<string, string> = {
  user_reported: "Census-reported",
  interpolated: "Estimated (between two real values)",
  extrapolated: "Estimated (from one nearby real value)",
  low_confidence: "Estimated — low confidence",
  skipped_future: "Not published",
  skipped_no_anchor: "Not published",
};

export async function fetchProgramEarnings(
  unitid: number,
  programCip?: string,
  credentialLevel?: number | null,
) {
  const none = {
    earnings: null, vintage: null, method_flag: null, year1: null, year1_vintage: null,
    year5: null, latest_year1: null, latest_year1_vintage: null, estimated: false,
  };
  if (programCip && credentialLevel != null) {
    // ONE cohort row supplies year 1, year 5 and year 10 (never a mix of
    // cohorts); the newest year-1 is returned separately.
    const path = await getEarningsPathForProgram(unitid, programCip, credentialLevel);
    const real = (c: string | null | undefined) => (c && c !== "0000" ? Number(c) : null);
    const val = (m: { value: number | null } | null | undefined) =>
      m?.value != null ? Math.round(m.value) : null;
    const latest = path.latest_year_1;
    const latestFields = {
      latest_year1: val(latest),
      latest_year1_vintage: latest ? real(latest.cohort) : null,
    };
    if (!path.year_10 || path.year_10.value == null) {
      return { ...none, ...latestFields };
    }
    // Same cohort for all three values — a value from another cohort is never used.
    const estimated = [path.year_1, path.year_5, path.year_10].some(
      (m) => m != null && m.method !== "user_reported",
    );
    return {
      year1: val(path.year_1),
      year1_vintage: real(path.cohort),
      year5: val(path.year_5),
      earnings: Math.round(path.year_10.value),
      // '0000' means this figure isn't tied to any real graduating cohort —
      // citing it as a year would be worse than citing no year at all.
      vintage: real(path.cohort),
      method_flag: EARNINGS_METHOD_LABELS[path.year_10.method] ?? null,
      estimated,
      ...latestFields,
    };
  }
  // Aggregate across the school's programs (no specific program resolved).
  const { rows } = await pool.query(
    `SELECT year_10 FROM earnings_against_courses_merged WHERE unitid = $1 AND year_10 IS NOT NULL`,
    [unitid],
  );
  const vals = rows
    .map((r: { year_10: number | string }) => Number(r.year_10))
    .filter((v: number) => !Number.isNaN(v));
  if (!vals.length) return none;
  const avg = Math.round(
    vals.reduce((a: number, b: number) => a + b, 0) / vals.length,
  );
  return {
    ...none,
    earnings: avg,
    vintage: "school-level average" as string | null,
    method_flag: `School-level average across ${vals.length} programs`,
  };
}
