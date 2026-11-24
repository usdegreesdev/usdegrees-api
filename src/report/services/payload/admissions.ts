/** Admissions: SAT bands, admit rate, and the verbatim disclosure copy for a school's category. */
import pool from "../../../db/client";

export const ADMISSIONS_VINTAGE = "IPEDS";

// Disclosure categories that make an academic fit score meaningless. Test-
// optional / scores-considered-if-submitted schools (isSubmittedOnlyCategory)
// are also "Not applicable": their SAT range covers only submitters.
export const NO_FIT_CATEGORIES = new Set([
  "A_OPEN_ADMISSION",
  "B_NOT_USED",
  "F_INSTITUTION_CLOSED",
]);

// ------------------------------------------------------------------
// Disclosure (verbatim copy the AI must not rewrite)
// ------------------------------------------------------------------
export async function fetchDisclosure(category: string) {
  const { rows } = await pool.query(
    `SELECT badge_label, supporting_copy, disclaimer_tier, disclaimer_text, show_admission_rate_required
       FROM admission_disclosure_categories WHERE category = $1 LIMIT 1`,
    [category],
  );
  if (!rows.length) throw new Error(`no disclosure row for "${category}"`);
  return rows[0];
}

// ------------------------------------------------------------------
// Admissions (SAT bands, admit rate, disclosure category)
// ------------------------------------------------------------------
export async function fetchAdmissions(unitid: number) {
  const { rows } = await pool.query(
    `SELECT admission_rate, sat_avg_overall, sat_p25_math, sat_p75_math, sat_p25_reading,
            sat_p75_reading, school_min_range, school_max_range, sat_disclosure_category,
            publish_publicly
       FROM admissions WHERE unitid = $1 LIMIT 1`,
    [unitid],
  );
  return rows[0] ?? null;
}
