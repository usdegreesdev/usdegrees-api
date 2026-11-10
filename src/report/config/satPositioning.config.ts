/**
 * Configuration for the SAT score positioning section.
 *
 * The only literals the section's logic is allowed to hold: test-scale
 * constants, axis tuning, the (table-wide) data vintage, and the two
 * disclosure-category keys the resolver must be able to name. Nothing here is
 * college- or student-specific.
 */

/** SAT composite scale (two sections, 200–800 each; reported in steps of 10). */
export const SAT_SCALE = { min: 400, max: 1600, step: 10 } as const;

/** Axis tuning: padding around the data, and the tick/snap interval. */
export const SAT_AXIS = { pad: 50, tickStep: 100 } as const;

/**
 * Vintage of admissions.school_min_range / school_max_range (2024 College
 * Scorecard, IPEDS). Applies to the whole table, not per college.
 */
export const SAT_DATA_YEAR = 2024;

/** admission_disclosure_categories keys the resolver looks up by name. */
export const SAT_CATEGORY_KEYS = {
  closed: "F_INSTITUTION_CLOSED",
  noScoreData: "G_NO_SCORE_DATA",
} as const;

/** Layout weights used to paginate rows across A4 pages (see SatPositioning). */
export const SAT_LAYOUT = {
  chartedRowWeight: 10,
  fallbackRowWeight: 21,
  noteWeight: 10,
  firstPageCapacity: 70,
  nextPageCapacity: 80,
} as const;
