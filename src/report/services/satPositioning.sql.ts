/**
 * SQL for the SAT positioning section (pure strings — no DB connection), plus
 * the query-layer check that none of it reads a synthetic SAT source.
 */

// Columns this feature may read from `admissions`. Nothing else — see
// assertSatQueryClean().
export const SAT_COLLEGES_SQL = `
  SELECT s.unitid,
         s.name,
         s.school_url,
         a.school_min_range,
         a.school_max_range,
         a.publish_publicly,
         dc.category,
         dc.badge_label,
         dc.badge_color,
         dc.supporting_copy,
         dc.disclaimer_text,
         dc.contact_guidance,
         dc.show_badge_with_range
    FROM schools s
    LEFT JOIN admissions a ON a.unitid = s.unitid
    LEFT JOIN admission_disclosure_categories dc ON dc.category = a.sat_disclosure_category
   WHERE s.unitid = ANY($1::bigint[])`;

export const SAT_STUDENT_SQL = `
  SELECT u.sat_score, u.sat_math, u.sat_reading_writing
    FROM usdreports r
    JOIN usdusers u ON u.id = r.user_id
   WHERE r.report_reference_id = $1
   LIMIT 1`;

export const SAT_REPORT_COLLEGES_SQL = `
  SELECT rc.unitid, rc.display_order
    FROM usdreport_colleges rc
    JOIN usdreports r ON r.id = rc.report_id
   WHERE r.report_reference_id = $1
   ORDER BY rc.display_order, rc.id`;

export const SAT_DEFAULT_CATEGORY_SQL = `
  SELECT category, badge_label, badge_color, supporting_copy, disclaimer_text,
         contact_guidance, show_badge_with_range
    FROM admission_disclosure_categories
   WHERE category = $1`;

/**
 * Columns/relations that fabricate or approximate SAT ranges. None may appear
 * in this feature's SQL (acceptance gate 2 asserts it at the query layer).
 */
const FORBIDDEN_SQL = [
  /\bsat_rw_(min|max)\b/i,
  /\bsat_math_(min|max)\b/i,
  /\bsat_mid_\w+/i,
  /\bsat_avg_overall\b/i,
  /\bsat_p(25|75)_\w+/i,
  /\badmissions_sat_ui\b/i,
  /\btemp_sat\b/i,
  /\badmissions_backup_old\b/i,
];

export function satQueryViolations(sql: string): string[] {
  return FORBIDDEN_SQL.filter((re) => re.test(sql)).map(
    (re) => `forbidden SAT source in query: ${re.source}`,
  );
}

export function assertSatQueryClean(sql: string): void {
  const v = satQueryViolations(sql);
  if (v.length) throw new Error(v.join("; "));
}
