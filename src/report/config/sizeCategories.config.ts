/**
 * School-size label cutoffs — the one place they live.
 *
 * The label and the number printed beside it both come from students.size
 * (Scorecard student.size, data year 2024), so they can never disagree. The
 * stored students.size_category column is NOT used: it does not follow
 * students.size (e.g. labels "Small" on schools of 632 and 11,668 students).
 *
 * `max` is exclusive; the last band is open-ended.
 */
export const SCHOOL_SIZE_BANDS: ReadonlyArray<{ label: string; max: number }> = [
  { label: "Very Small", max: 2000 },
  { label: "Small", max: 5000 },
  { label: "Medium", max: 15000 },
  { label: "Large", max: Infinity },
];

/** Label for a students.size value; null when the size is not published. */
export function schoolSizeLabel(size: number | null | undefined): string | null {
  if (size == null || !Number.isFinite(size) || size < 0) return null;
  return SCHOOL_SIZE_BANDS.find((b) => size < b.max)?.label ?? null;
}

/** Table column header for the enrollment counts (a different basis from students.size). */
export const ENROLLMENT_12_MONTH_HEADER = "12-month unduplicated";
