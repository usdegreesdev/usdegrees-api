/** Plain record lookups: the student, the pending report row, a school, and its federal-aid status. */
import pool from "../../../db/client";
import { normalizeAidStatus, type FederalAidStatus } from "../../utils/missingValue";

// ------------------------------------------------------------------
// Federal aid status (school_federal_aid_status). No row, or a failed lookup,
// is UNKNOWN (null) and is treated like 'participates' downstream: the
// generic "not published" reason, never "takes no federal student aid".
// ------------------------------------------------------------------
export async function fetchFederalAid(
  unitid: number,
): Promise<{ status: FederalAidStatus | null; fetched_on: string | null }> {
  try {
    const { rows } = await pool.query(
      `SELECT federal_aid_status, to_char(fetched_on, 'YYYY-MM-DD') AS fetched_on
         FROM school_federal_aid_status WHERE unitid = $1 LIMIT 1`,
      [unitid],
    );
    const r = rows[0];
    if (!r) return { status: null, fetched_on: null };
    // to_char in SQL: a DATE read through the driver is local midnight, and
    // .toISOString() on a UTC+ host would print the day before.
    return {
      status: normalizeAidStatus(r.federal_aid_status),
      fetched_on: r.fetched_on != null ? String(r.fetched_on) : null,
    };
  } catch (err) {
    console.warn(`federal aid status lookup failed for ${unitid}; treating as unknown`, err);
    return { status: null, fetched_on: null };
  }
}

export async function fetchStudent(userId: number) {
  const { rows } = await pool.query(
    `SELECT display_name, email, address, gpa, sat_score, sat_math, sat_reading_writing, act_score,
            graduation_year, high_school_name, preferred_degree_level, preferred_college_type,
            household_income_range
       FROM usdusers WHERE id = $1 LIMIT 1`,
    [userId],
  );
  if (!rows.length) throw new Error(`user fetch (${userId}): no row`);
  return rows[0];
}

export async function fetchReportMeta(reportReferenceId: string) {
  const { rows } = await pool.query(
    `SELECT report_reference_id, created_at FROM usdreports WHERE report_reference_id = $1 LIMIT 1`,
    [reportReferenceId],
  );
  if (!rows.length)
    throw new Error(`report fetch (${reportReferenceId}): no row`);
  return rows[0];
}

export async function fetchSchool(unitid: number) {
  const { rows } = await pool.query(
    `SELECT name, city, state, accreditor, address, zip, is_active FROM schools WHERE unitid = $1 LIMIT 1`,
    [unitid],
  );
  if (!rows.length) throw new Error(`school fetch (${unitid}): no row`);
  return rows[0];
}
