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

/**
 * Categories whose SAT range reflects only students who submitted scores.
 * These schools get neutral wording (no "fit"/"stretch" verdict) on the SAT
 * positioning page and "Fit is not applicable" on the academic-fit page.
 */
export const SAT_SUBMITTED_ONLY_CATEGORIES: ReadonlySet<string> = new Set([
  "H_TEST_CONSIDERED",
  "C_TEST_OPTIONAL",
]);

export const isSubmittedOnlyCategory = (c: string | null | undefined): boolean =>
  c != null && SAT_SUBMITTED_ONLY_CATEGORIES.has(c);

/** Page-4 reason, printed after the school's own badge label (the same label the SAT page shows). */
export const FIT_NA_SUBMITTED_REASON =
  "fit is not applicable";

/**
 * fit_label "Unavailable": the school publishes no SAT average or full SAT
 * band, so no fit can be calculated (~700 schools). Written verbatim by both
 * the AI narrative and the fallback sentences.
 */
export const FIT_UNAVAILABLE_SENTENCE =
  "Academic Fit: Unavailable. This school does not publish the SAT data needed to compare a test score against it, so no fit classification is shown.";

/** Layout weights used to paginate rows across A4 pages (see SatPositioning). */
export const SAT_LAYOUT = {
  chartedRowWeight: 10,
  /** Header line (name, badge, "No score data") of a no-range school; its copy block is weighed from text length. */
  fallbackHeaderWeight: 5,
  /** Copy block under a row: ~chars per rendered line, weight per line, fixed padding/gap weight, website link line. */
  notesLineChars: 125,
  notesLineWeight: 1.6,
  notesPadWeight: 2.5,
  notesLinkWeight: 1.8,
  noteWeight: 10,
  /** The merged submitted-scores note is slightly longer than the default note. */
  submittedNoteExtraWeight: 2,
  firstPageCapacity: 70,
  nextPageCapacity: 80,
  /**
   * Compact layout (4+ colleges where some carry copy): tighter rows and copy
   * so five colleges fit one page. Weights are ~px / 9.3.
   */
  compact: {
    chartedRowWeight: 8.8,
    fallbackHeaderWeight: 4.6,
    notesLineChars: 150,
    notesLineWeight: 1.3,
    notesPadWeight: 1.4,
    notesLinkWeight: 1.4,
    firstPageCapacity: 86,
    firstPageCapacityNoChips: 92,
    nextPageCapacity: 92,
  },
} as const;
