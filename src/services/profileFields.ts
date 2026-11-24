/** Validation for the scalar fields a PATCH /profile body may set. */
import { normalizeDegreeLevel } from "../constants/degreeLevels";
import { HOUSEHOLD_INCOME_RANGES } from "../constants/householdIncome";

/**
 * Allowlist of patchable SCALAR profile columns: camelCase request key ->
 * snake_case DB column. Anything NOT in this map (email, role, auth_provider,
 * firebase_uid, is_active, etc.) is silently dropped and can never be patched.
 * preferredStates and preferredPrograms are NOT here — they live in child
 * tables and are handled by a transactional replace in the route.
 */
export const PROFILE_FIELD_MAP: Record<string, string> = {
  fullName: "display_name",
  phone: "phone",
  address: "address",
  gpa: "gpa",
  satScore: "sat_score",
  // Deprecated: kept only while the frontend still writes the split sub-scores
  // as a temporary fallback. Remove once fully migrated to satScore.
  satMath: "sat_math",
  satReadingWriting: "sat_reading_writing",
  actScore: "act_score",
  graduationYear: "graduation_year",
  highSchoolName: "high_school_name",
  preferredDegreeLevel: "preferred_degree_level",
  preferredCollegeType: "preferred_college_type",
  householdIncomeRange: "household_income_range",
};

/** Earliest accepted graduation year. */
export const MIN_GRADUATION_YEAR = 2000;

/** Allowed values for preferred_college_type (empty/NULL = no preference). */
export const COLLEGE_TYPES = ["Public", "Private"] as const;

/** Outcome of validating one scalar profile field from a PATCH body. */
export type FieldResult =
  | { kind: "ok"; value: unknown } // write this value (null clears the column)
  | { kind: "skip" } // invalid, silently dropped
  | { kind: "invalid"; message: string }; // reject the whole request with 400

const invalid = (message: string): FieldResult => ({ kind: "invalid", message });

/** Validate/normalize one PATCH value for its DB column. */
export function validateProfileField(column: string, value: unknown): FieldResult {
  if (column === "preferred_degree_level") {
    // Accept only the 8 canonical values (legacy short forms mapped).
    // null explicitly clears; any other invalid value is stripped.
    if (value === null) return { kind: "ok", value };
    const canonical = normalizeDegreeLevel(value);
    return canonical === null ? { kind: "skip" } : { kind: "ok", value: canonical };
  }

  if (column === "preferred_college_type") {
    // Empty string (or explicit null) clears the preference; when set it
    // must be one of the canonical types.
    if (value === null || (typeof value === "string" && value.trim() === "")) {
      return { kind: "ok", value: null };
    }
    if (
      typeof value === "string" &&
      (COLLEGE_TYPES as readonly string[]).includes(value.trim())
    ) {
      return { kind: "ok", value: value.trim() };
    }
    return invalid(
      `preferredCollegeType must be one of ${COLLEGE_TYPES.join(", ")}, or empty to clear`,
    );
  }

  if (column === "household_income_range") {
    // null clears it; otherwise it must be one of the stable slab ids.
    const valid =
      value === null ||
      (typeof value === "string" &&
        (HOUSEHOLD_INCOME_RANGES as readonly string[]).includes(value));
    return valid
      ? { kind: "ok", value }
      : invalid("householdIncomeRange must be a valid income range, or null to clear");
  }

  if (column === "sat_score") {
    // A single total SAT score: null clears it; otherwise an integer 400..1600.
    if (value === null) return { kind: "ok", value };
    const n = typeof value === "string" ? Number(value.trim()) : value;
    if (typeof n !== "number" || !Number.isInteger(n) || n < 400 || n > 1600) {
      return invalid("satScore must be an integer between 400 and 1600, or null to clear");
    }
    return { kind: "ok", value: n };
  }

  if (column === "graduation_year") {
    // null clears it; otherwise a whole year >= 2000 (future years allowed).
    if (value === null) return { kind: "ok", value };
    const n = typeof value === "string" ? Number(value.trim()) : value;
    if (typeof n !== "number" || !Number.isInteger(n) || n < MIN_GRADUATION_YEAR) {
      return invalid("Please enter a valid graduation year.");
    }
    return { kind: "ok", value: n };
  }

  return { kind: "ok", value: typeof value === "string" ? value.trim() : value };
}
