/**
 * gradRate.ts — the ONE place the displayed graduation rate is resolved,
 * formatted, labelled and explained.
 *
 * Source: completion.grad_rate_150nt_pct (College Scorecard headline rate,
 * already a PERCENT, e.g. 64.57 — never multiply by 100) and
 * completion.grad_rate_cohort (students behind it). See the COMMENT ON COLUMN
 * for each in the database.
 *
 * Never read completion.completion_rate, completion.emp_factor or any
 * completion.completed_*yrs column for a graduation rate, and never fall back
 * to them when grad_rate_150nt_pct is null. Those columns cover federal-aid
 * recipients only, on separate cohorts per time point, and are wrong for most
 * institutions (e.g. Illinois Eastern Community Colleges: completion_rate
 * 16.74, real rate 64.57). A null here means "Not published", full stop.
 */

/**
 * Rates built on fewer students than this are suppressed. 52 institutions
 * report exactly 0% on cohorts of 1–5 students. With 10: 4,680 institutions
 * show a rate; without a threshold: 5,014.
 */
export const MIN_GRAD_RATE_COHORT = 10;

/** The only completion columns a graduation rate may be read from. */
export const GRAD_RATE_COLUMNS = [
  "grad_rate_150nt_pct",
  "grad_rate_cohort",
  "grad_rate_source_field",
  "grad_rate_fetched_on",
] as const;

/** Columns that must never feed a displayed graduation rate. */
export const DEPRECATED_COMPLETION_COLUMNS = [
  "completion_rate",
  "emp_factor",
  "completed_2yrs",
  "completed_3yrs",
  "completed_4yrs",
  "completed_6yrs",
  "completed_8yrs",
] as const;

export const GRAD_RATE_LABEL = "Graduation rate within 150% of normal time";

/** What the figure measures — used in table notes, prompt and fallback. */
export const GRAD_RATE_MEASURES =
  "first-time, full-time students who finished at that same institution";

export const GRAD_RATE_METHODOLOGY =
  `Graduation Rate: College Scorecard's graduation rate within 150% of normal time ` +
  `(for example, six years for a four-year degree), for ${GRAD_RATE_MEASURES}. ` +
  `It excludes part-time and transfer-in students, and counts students who transfer ` +
  `out as non-completers. The cohort shown beside each rate is the number of students ` +
  `the rate is based on. A rate is shown as Not published when College Scorecard ` +
  `publishes none, or when its cohort has fewer than ${MIN_GRAD_RATE_COHORT} students.`;

export const GRAD_RATE_NOT_PUBLISHED = "Not published";

export type GradRateStatus =
  | "published"
  | "no_rate" // Scorecard publishes no rate (null)
  | "small_cohort"; // cohort below MIN_GRAD_RATE_COHORT, or cohort not reported

export interface GradRate {
  status: GradRateStatus;
  /** Raw percent from grad_rate_150nt_pct (e.g. 64.57). Null unless published. */
  value: number | null;
  /** One decimal, e.g. "64.6%". Null unless published. */
  value_display: string | null;
  /** Cohort size; kept even when suppressed so the reason can name it. */
  cohort: number | null;
  /** "(cohort of 717 students)" when published, else null. */
  cohort_display: string | null;
  /** Value-or-reason, e.g. "64.6% (cohort of 717 students)". Use as given. */
  display: string;
  /** Why it is not published; null when published. */
  reason: string | null;
  source_field: string | null;
  fetched_on: string | null;
}

export interface GradRateRow {
  grad_rate_150nt_pct?: unknown;
  grad_rate_cohort?: unknown;
  grad_rate_source_field?: unknown;
  grad_rate_fetched_on?: unknown;
}

function finite(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function students(n: number): string {
  return `${n.toLocaleString("en-US")} student${n === 1 ? "" : "s"}`;
}

/**
 * 64.57 → "64.6%". The input is already a percent. Rounds half-up on the
 * stored hundredths so float error can't flip a digit (8.35 → 8.4).
 */
export function formatGradRatePct(pct: number): string {
  const tenths = Math.round(Math.round(pct * 100) / 10);
  return `${(tenths / 10).toFixed(1)}%`;
}

export function resolveGradRate(row: GradRateRow | null | undefined): GradRate {
  const pct = finite(row?.grad_rate_150nt_pct);
  const cohortRaw = finite(row?.grad_rate_cohort);
  const cohort = cohortRaw != null ? Math.round(cohortRaw) : null;
  const f = row?.grad_rate_fetched_on;
  const base = {
    cohort,
    source_field: row?.grad_rate_source_field != null ? String(row.grad_rate_source_field) : null,
    fetched_on:
      f instanceof Date ? f.toISOString().slice(0, 10) : f != null ? String(f) : null,
  };
  const suppressed = (status: GradRateStatus, reason: string): GradRate => ({
    ...base,
    status,
    value: null,
    value_display: null,
    cohort_display: null,
    display: `${GRAD_RATE_NOT_PUBLISHED} — ${reason}`,
    reason,
  });

  // Out-of-range values are treated as not published rather than shown.
  if (pct == null || pct < 0 || pct > 100) {
    return suppressed("no_rate", "College Scorecard publishes no graduation rate for this institution");
  }
  if (cohort == null) {
    return suppressed("small_cohort", "the cohort size is not reported");
  }
  if (cohort < MIN_GRAD_RATE_COHORT) {
    return suppressed("small_cohort", `a cohort of ${students(cohort)} is too small to report`);
  }
  const value_display = formatGradRatePct(pct);
  const cohort_display = `(cohort of ${students(cohort)})`;
  return {
    ...base,
    status: "published",
    value: pct,
    value_display,
    cohort_display,
    display: `${value_display} ${cohort_display}`,
    reason: null,
  };
}

/**
 * For the website API routes, which keep their existing 0–100 number field:
 * the published percent or null. Never scaled — the column is already a percent.
 */
export function publishedGradRatePct(row: GradRateRow | null | undefined): number | null {
  return resolveGradRate(row).value;
}

/**
 * One sentence, shared verbatim by the fallback narrative and the AI prompt,
 * so the two cannot disagree.
 */
export function graduationRateSummary(
  colleges: Array<{ name: string; campus: { graduation_rate: GradRate } }>,
): string {
  if (!colleges.length) return "";
  const parts = colleges.map((c) => `${c.name} ${c.campus.graduation_rate.display}`);
  return `${GRAD_RATE_LABEL}, ${GRAD_RATE_MEASURES}: ${parts.join("; ")}.`;
}
