/** Profile data logic: the GET response builder and the preferred states/programs normalizers. */
import pool from "../db/client";
import { getValidStateCodes } from "../db/statesCache";
import {
  normalizeDegreeBucket,
  normalizeStateCode,
  programLabelsToCipFamilies,
} from "../utils/preferenceAlignment";

/**
 * Fetch the full profile for a firebase_uid, joining the child tables into
 * preferred_states / preferred_programs arrays (empty -> []). Returns null if
 * no user row. Never includes the password hash.
 */
export async function buildProfileResponse(
  firebaseUid: string,
): Promise<Record<string, unknown> | null> {
  const result = await pool.query(
    `SELECT
        u.*,
        COALESCE(
          (SELECT array_agg(s.state_code ORDER BY s.state_code)
             FROM usdusers_preferred_states s WHERE s.user_id = u.id),
          ARRAY[]::text[]
        ) AS preferred_states,
        COALESCE(
          (SELECT array_agg(p.program ORDER BY p.program)
             FROM usdusers_preferred_programs p WHERE p.user_id = u.id),
          ARRAY[]::text[]
        ) AS preferred_programs
      FROM usdusers u
      WHERE u.firebase_uid = $1`,
    [firebaseUid],
  );
  if (result.rows.length === 0) return null;

  const { password_hash, preferred_states, preferred_programs, ...rest } =
    result.rows[0];
  const states: string[] = preferred_states ?? [];
  const programs: string[] = preferred_programs ?? [];
  const degreeBucket = normalizeDegreeBucket(rest.preferred_degree_level);
  // Return the child-table sets under the snake_case keys the frontend reads,
  // plus the normalized alignment-check fields (unknown -> []; no DB lookup).
  return {
    ...rest,
    preferred_states: states,
    preferred_programs: programs,
    preferredDegreeLevels: degreeBucket ? [degreeBucket] : [],
    preferredFieldCipFamilies: programLabelsToCipFamilies(programs),
    preferredStateCodes: [
      ...new Set(
        states
          .map(normalizeStateCode)
          .filter((c): c is string => c !== null),
      ),
    ].sort(),
  };
}

/** Max length of a preferred program name (matches the DB column intent). */
const MAX_PROGRAM_LENGTH = 150;

/**
 * Trim, drop empty, enforce the 150-char limit, and de-duplicate a string
 * array (for preferred programs). Values over the limit are skipped.
 */
export function normalizePrograms(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of value) {
    if (typeof v !== "string") continue;
    const t = v.trim();
    if (!t || t.length > MAX_PROGRAM_LENGTH || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

/** Uppercase, validate against the states set, de-duplicate (for preferred states). */
export async function normalizeStateCodes(value: unknown): Promise<string[]> {
  if (!Array.isArray(value)) return [];
  const valid = await getValidStateCodes();
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of value) {
    if (typeof v !== "string") continue;
    const code = v.trim().toUpperCase();
    if (!valid.has(code) || seen.has(code)) continue;
    seen.add(code);
    out.push(code);
  }
  return out;
}
