/** Campus & student-body figures (students + completion tables). */
import pool from "../../../db/client";
import { ScaledField, toPercent } from "../../../utils/fieldScale";
import { schoolSizeLabel } from "../../config/sizeCategories.config";
import { GRAD_RATE_COLUMNS, resolveGradRate } from "../../utils/gradRate";

// ------------------------------------------------------------------
// Campus & student body (students table) — school-level, not program-level.
// ------------------------------------------------------------------
export async function fetchCampus(unitid: number) {
  // Graduation rate: completion.grad_rate_150nt_pct + grad_rate_cohort only
  // (see utils/gradRate.ts). completion_rate / emp_factor / completed_*yrs
  // are deprecated and are deliberately not selected, so they can't leak
  // into the payload or the AI prompt.
  const [studentsResult, completionResult, levelResult] = await Promise.all([
    pool.query(
      `SELECT undergrad_12_month, grad_12_month, student_faculty_ratio,
              retention_rate, demographics_men, demographics_women,
              faculty_men, faculty_women, size
         FROM students WHERE unitid = $1 LIMIT 1`,
      [unitid],
    ),
    pool.query(
      `SELECT ${GRAD_RATE_COLUMNS.join(", ")} FROM completion WHERE unitid = $1 LIMIT 1`,
      [unitid],
    ),
    pool.query(
      `SELECT max(credential_level) AS max_level FROM programs WHERE unitid = $1`,
      [unitid],
    ),
  ]);
  const maxLevel = levelResult.rows[0]?.max_level;
  const data = studentsResult.rows[0];
  const completion = completionResult.rows[0];
  const num = (v: unknown) => (v != null ? Number(v) : null);
  // Scales come from utils/fieldScale (retention_rate/demographics_* are
  // 0–1 fractions; grad_rate_150nt_pct is already 0–100).
  const wholePct = (f: ScaledField, v: unknown) => {
    const p = toPercent(f, v);
    return p === null ? null : Math.round(p);
  };
  // Demographics keep one decimal place (e.g. 39.5%) instead of rounding to
  // a whole number, per the Student Body Composition section's display.
  const oneDecimalPct = (f: ScaledField, v: unknown) => {
    const p = toPercent(f, v);
    return p === null ? null : Math.round(p * 10) / 10;
  };
  return {
    enrollment_undergrad: num(data?.undergrad_12_month),
    enrollment_grad: num(data?.grad_12_month),
    // "No graduate programs" only when grad enrollment is null AND the school's
    // highest program level is 4 or below (programs.credential_level).
    no_graduate_programs:
      data?.grad_12_month == null && maxLevel != null && Number(maxLevel) <= 4,
    student_faculty_ratio: num(data?.student_faculty_ratio),
    graduation_rate: resolveGradRate(completion),
    retention_rate: wholePct("students.retention_rate", data?.retention_rate),
    demographics_men_pct: oneDecimalPct("students.demographics_men", data?.demographics_men),
    demographics_women_pct: oneDecimalPct("students.demographics_women", data?.demographics_women),
    faculty_men_pct: oneDecimalPct("students.faculty_men", data?.faculty_men),
    faculty_women_pct: oneDecimalPct("students.faculty_women", data?.faculty_women),
    // Label and number both come from students.size (sizeCategories.config).
    size: num(data?.size),
    size_category: schoolSizeLabel(num(data?.size)),
  };
}
