/**
 * The ONE place a field's scale is declared in the API. No route decides
 * whether a value is a fraction or a percent, and nothing infers it from
 * magnitude (no `n < 2 ? n * 100 : n`): a fraction field is always ×100, a
 * percent field never is. Scales are from the Supabase column comments.
 *
 * Mirrored by usdegrees-web src/lib/fieldScale.ts.
 */
export const FIELD_SCALES = {
  // 0–1 fractions
  "students.retention_rate": "fraction",
  "students.demographics_men": "fraction",
  "students.demographics_women": "fraction",
  "students.faculty_men": "fraction",
  "students.faculty_women": "fraction",
  "admissions.admission_rate": "fraction",
  "aid.students_with_any_loan": "fraction",
  // percents
  "completion.grad_rate_150nt_pct": "percent",
  "repayment.graduates_3yr": "percent",
  "repayment.non_completers_3yr": "percent",
  "repayment.repayment_success": "percent",
  "aid.aid_percentage": "percent",
  /** May be negative (observed −98.55 to 683.57). */
  "earnings.growth_rate": "percent",
  // deprecated / empty — never display
  "completion.completion_rate": "deprecated",
  "completion.emp_factor": "deprecated",
  "students.graduation_rate": "deprecated",
} as const;

export type ScaledField = keyof typeof FIELD_SCALES;
export type Scale = (typeof FIELD_SCALES)[ScaledField];

const finite = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** The field's value as a 0–100 percent, or null. A real 0 stays 0. */
export function toPercent(field: ScaledField, value: unknown): number | null {
  const scale: Scale = FIELD_SCALES[field];
  if (scale === "deprecated") return null;
  const n = finite(value);
  if (n === null) return null;
  return scale === "fraction" ? n * 100 : n;
}

/** The field's value as a 0–1 fraction, or null. */
export function toFraction(field: ScaledField, value: unknown): number | null {
  const scale: Scale = FIELD_SCALES[field];
  if (scale === "deprecated") return null;
  const n = finite(value);
  if (n === null) return null;
  return scale === "fraction" ? n : n / 100;
}
