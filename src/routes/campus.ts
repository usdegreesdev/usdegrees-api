/**
 * campusStudents.ts
 * Express Router: GET /campus-students/:unitid
 *
 * Returns campus size, student body composition, faculty ratio,
 * and repayment data for a given college (unitid).
 *
 * Tables used:
 *   students  — enrollment, demographics, size category, faculty ratio
 *   repayment — 1yr / 3yr repayment rates by completion status
 */

import { Router, Request, Response } from "express";
import pool from "../db/client";
import {
  ApiError,
  CampusStudentsResponse,
  Demographics,
  StudentRawRow,
} from "../types/campus";
import { sendError, sendInternalError } from "../utils/apiError";

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

/**
 * Coerce a value to number | null.
 * pg returns NUMERIC/INTEGER columns as strings in some driver versions;
 * parseFloat handles both the string and native-number cases safely.
 */
function toNum(val: unknown): number | null {
  if (val === null || val === undefined) return null;
  const n = typeof val === "string" ? parseFloat(val) : Number(val);
  return isNaN(n) ? null : n;
}

/**
 * Coerce a value to string | null.
 * Trims whitespace that can sneak in from fixed-width CHAR columns.
 */
function toStr(val: unknown): string | null {
  if (val === null || val === undefined) return null;
  const s = String(val).trim();
  return s.length === 0 ? null : s;
}

/**
 * Format a raw numeric ratio value into a human-readable "X:1" string.
 *
 * College Scorecard stores student_faculty_ratio as a plain number (e.g. 5).
 * If your column is already a formatted string (e.g. "5:1"), pass it
 * directly through toStr() and skip this helper.
 *
 * Set formatRatio = false in shapeResponse() if your DB already stores
 * the formatted string.
 */
function formatRatio(val: unknown): string | null {
  const n = toNum(val);
  if (n === null) return null;
  // Round to nearest integer for display; keep one decimal if < 10
  const display =
    n < 10 ? n.toFixed(1).replace(/\.0$/, "") : Math.round(n).toString();
  return `${display}:1`;
}

/**
 * Round a raw percentage value to the nearest integer.
 * IPEDS stores demographics_men / demographics_women as decimals (0–100).
 * If your column stores fractions (0.0–1.0), multiply by 100 first.
 */
function toPct(val: unknown): number | null {
  const n = toNum(val);
  if (n === null) return null;
  // If stored as a fraction (< 2), convert to percentage
  return n < 2 ? Math.round(n * 100) : Math.round(n);
}

/**
 * Build the shaped response from a raw DB row.
 */
function shapeResponse(
  unitid: number,
  row: StudentRawRow,
): CampusStudentsResponse {
  return {
    unitid,
    campus: {
      size_category: toStr(row.size_category),
      size: toNum(row.size),
      // Toggle between formatRatio() and toStr() depending on your column type:
      //   numeric column → formatRatio(row.student_faculty_ratio)
      //   text column    → toStr(row.student_faculty_ratio)
      student_faculty_ratio: formatRatio(row.student_faculty_ratio),
    },
    students: {
      grad_students: toNum(row.grad_students),
      demographics: {
        men: toPct(row.demographics_men),
        women: toPct(row.demographics_women),
      },
      faculty: {
        men: toNum(row.faculty_men),
        women: toNum(row.faculty_women),
      },
    },
    repayment: {
      all_borrowers_3yr: toNum(row.all_borrowers_3yr),
      graduates_3yr: toNum(row.graduates_3yr),
      non_completers_3yr: toNum(row.non_completers_3yr),
      yr1_overall: toNum(row.yr1_overall),
      yr3_overall: toNum(row.yr3_overall),
      yr3_completers: toNum(row.yr3_completers),
      yr3_noncompleters: toNum(row.yr3_noncompleters),
    },
  };
}

// ─────────────────────────────────────────────
// SQL
// ─────────────────────────────────────────────

/**
 * Straightforward single-table SELECT against the students table.
 *
 * Design decisions:
 *  - COALESCE on numeric fields so the frontend always receives a value
 *    or an explicit null — never an undefined / missing key.
 *  - LIMIT 1 collapses any accidental duplicate rows for the same unitid.
 *  - ORDER BY year DESC keeps the most recent record when the table stores
 *    historical snapshots. Remove if there is no year column.
 *  - All columns are aliased to snake_case to match the TypeScript interface
 *    and avoid any case-sensitivity surprises from pg.
 */
const CAMPUS_STUDENTS_QUERY = `
  SELECT
    -- ── Campus ────────────────────────────────────────────
    COALESCE(s.size_category, NULL)          AS size_category,
    COALESCE(s.size, NULL)                   AS size,

    -- ── Enrollment ────────────────────────────────────────
    COALESCE(s.grad_students, NULL)          AS grad_students,

    -- ── Demographics ──────────────────────────────────────
    -- Stored as 0–100 (percent) or 0.0–1.0 (fraction).
    -- toPct() in the application layer normalises both cases.
    COALESCE(s.demographics_men, NULL)       AS demographics_men,
    COALESCE(s.demographics_women, NULL)     AS demographics_women,

    -- ── Faculty Ratio ─────────────────────────────────────
    -- Stored as a plain number (e.g. 5) in College Scorecard.
    -- formatRatio() in the application layer converts to "5:1".
    COALESCE(s.student_faculty_ratio, NULL)  AS student_faculty_ratio,

    -- ── Faculty Demographics ──────────────────────────────
    COALESCE(s.faculty_men, NULL)            AS faculty_men,
    COALESCE(s.faculty_women, NULL)          AS faculty_women,
    -- ── Repayment ─────────────────────────────────────────
    r.all_borrowers_3yr,
    r.graduates_3yr,
    r.non_completers_3yr,
    r.yr1_overall,
    r.yr3_overall,
    r.yr3_completers,
    r.yr3_noncompleters

  FROM (
    SELECT *
    FROM students
    WHERE unitid = $1
    LIMIT 1
  ) s

  -- Repayment data: LEFT JOIN + LATERAL LIMIT 1.
  LEFT JOIN LATERAL (
    SELECT
      all_borrowers_3yr,
      graduates_3yr,
      non_completers_3yr,
      yr1_overall,
      yr3_overall,
      yr3_completers,
      yr3_noncompleters
    FROM repayment
    WHERE unitid = s.unitid
    LIMIT 1
  ) r ON TRUE
`;

/*
 * ─── NOTE on COALESCE usage ──────────────────────────────────────────────────
 *
 * COALESCE(col, NULL) is a no-op but serves as a self-documenting marker.
 * Replace with meaningful defaults where the business logic warrants it:
 *
 *   COALESCE(s.size, 0)                 -- treat missing enrollment as 0
 *   COALESCE(s.size_category, 'Unknown') -- fallback label for the UI
 *
 * Keeping explicit NULLs here lets the frontend decide how to render
 * missing data (e.g. "N/A" vs hiding the field entirely).
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ─────────────────────────────────────────────
// Router
// ─────────────────────────────────────────────

const router = Router();

/**
 * Fetch + shape campus/student data for a single unitid, reused by both
 * GET /campus/:unitid and GET /college-summary/:unitid so the two
 * endpoints never drift on query or shaping logic.
 * Returns null when no student record exists for this unitid.
 */
export async function getCampusData(
  unitid: number,
): Promise<CampusStudentsResponse | null> {
  const result = await pool.query<StudentRawRow>(CAMPUS_STUDENTS_QUERY, [
    unitid,
  ]);
  if (result.rowCount === 0) return null;
  return shapeResponse(unitid, result.rows[0]);
}

/**
 * GET /campus/:unitid
 *
 * Path params:
 *   unitid  — integer college identifier (College Scorecard / IPEDS)
 *
 * Responses:
 *   200  CampusStudentsResponse  — data found
 *   400  ApiError               — unitid is not a valid integer
 *   404  ApiError               — no student record found for this unitid
 *   500  ApiError               — unexpected database / server error
 */
router.get(
  "/:unitid",
  async (req: Request<{ unitid: string }>, res: Response) => {
    // ── 1. Validate & parse unitid ─────────────────────────────
    const raw = req.params.unitid;
    const unitid = parseInt(raw, 10);

    if (isNaN(unitid) || unitid <= 0) {
      return sendError(req, res, 400, "INVALID_UNITID");
    }

    // ── 2. Query ───────────────────────────────────────────────
    let payload: CampusStudentsResponse | null;
    try {
      payload = await getCampusData(unitid);
    } catch (dbErr: unknown) {
      return sendInternalError(req, res, dbErr, "campus");
    }

    // ── 3. 404 guard ───────────────────────────────────────────
    if (payload === null) {
      return sendError(req, res, 404, "NOT_FOUND");
    }

    // ── 4. Return ──────────────────────────────────────────────
    return res.status(200).json(payload);
  },
);

export default router;
