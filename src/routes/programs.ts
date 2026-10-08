/**
 * programs.ts
 * Express Router: GET /programs/:unitid
 *
 * Returns:
 *  • Graduation rate
 *  • Student-faculty ratio
 *  • Loan repayment success
 *  • Popular fields of study
 *  • Comprehensive degree levels
 *
 * Tables used:
 *   completion
 *   students
 *   repayment
 *   program_distribution
 *   programs
 */

import { Router, Request, Response } from "express";
import { QueryResult } from "pg";
import pool from "../db/client";
import { verifyToken } from "../middleware/auth";
import { AuthRequest } from "../types/user";

import {
  ProgramsResponse,
  AcademicsRawRow,
  ProgramDistributionRawRow,
  FieldOfStudy,
  DegreeLevelRawRow,
  ApiError,
} from "../types/programs";
import { sendError, sendInternalError } from "../utils/apiError";

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function toNum(val: unknown): number | null {
  if (val === null || val === undefined) return null;

  const n = typeof val === "string" ? parseFloat(val) : Number(val);

  return isNaN(n) ? null : n;
}

function toStr(val: unknown): string | null {
  if (val === null || val === undefined) return null;

  const s = String(val).trim();

  return s.length === 0 ? null : s;
}

function toRatePct(val: unknown): number | null {
  const n = toNum(val);

  if (n === null) return null;

  return n < 2 ? Math.round(n * 100) : Math.round(n);
}

function formatRatio(val: unknown): string | null {
  const n = toNum(val);

  if (n === null) return null;

  const display =
    n < 10 ? n.toFixed(1).replace(/\.0$/, "") : Math.round(n).toString();

  return `${display}:1`;
}

// ─────────────────────────────────────────────
// Response Shapers
// ─────────────────────────────────────────────

function shapeAcademics(row: AcademicsRawRow): ProgramsResponse["academics"] {
  return {
    graduation_rate: toRatePct(row.completion_rate),

    student_faculty_ratio: formatRatio(row.student_faculty_ratio),

    repayment_success: toRatePct(row.repayment_success),
  };
}

function shapeFields(rows: ProgramDistributionRawRow[]): FieldOfStudy[] {
  return rows
    .filter((r) => r.field_name !== null && r.field_name !== "")

    .map((r) => ({
      field_name: toStr(r.field_name) as string,

      percentage: toNum(r.percentage) ?? 0,

      program_count: toNum(r.program_count) ?? 0,
    }))

    .sort((a, b) => b.percentage - a.percentage);
}

function shapeDegreeLevels(
  rows: DegreeLevelRawRow[],
): ProgramsResponse["comprehensive_degree_levels"] {
  return rows.map((r) => ({
    level: toStr(r.degree_level_category) ?? "Other",

    total_programs: toNum(r.total_programs) ?? 0,

    top_titles: Array.isArray(r.top_titles) ? r.top_titles.filter(Boolean) : [],
  }));
}

// ─────────────────────────────────────────────
// SQL Queries
// ─────────────────────────────────────────────

const ACADEMICS_QUERY = `
  SELECT
    comp.completion_rate,

    stu.student_faculty_ratio,

    rep.repayment_success

  FROM (
    SELECT completion_rate
    FROM completion
    WHERE unitid = $1
    LIMIT 1
  ) comp

  LEFT JOIN LATERAL (
    SELECT student_faculty_ratio
    FROM students
    WHERE unitid = $1
    LIMIT 1
  ) stu ON TRUE

  LEFT JOIN LATERAL (
    SELECT repayment_success
    FROM repayment
    WHERE unitid = $1
    LIMIT 1
  ) rep ON TRUE
`;

const FIELDS_QUERY = `
  SELECT
    field_name,
    percentage,
    program_count

  FROM program_distribution

  WHERE unitid = $1

  ORDER BY
    percentage DESC,
    field_name ASC

  LIMIT 20
`;

const DEGREE_LEVELS_QUERY = `
WITH ranked_programs AS (
  SELECT
    degree_level_category,
    title,

    ROW_NUMBER() OVER (
      PARTITION BY degree_level_category
      ORDER BY title ASC
    ) as rn

  FROM programs

  WHERE unitid = $1
)

SELECT
  p.degree_level_category,

  COUNT(*) as total_programs,

  ARRAY(
    SELECT DISTINCT rp.title
    FROM ranked_programs rp
    WHERE rp.degree_level_category =
      p.degree_level_category
    LIMIT 3
  ) as top_titles

FROM programs p

WHERE unitid = $1

GROUP BY p.degree_level_category

ORDER BY
  CASE
    WHEN p.degree_level_category =
      'Undergraduate' THEN 1

    WHEN p.degree_level_category =
      'Graduate' THEN 2

    WHEN p.degree_level_category =
      'Professional' THEN 3

    ELSE 4
  END
`;

// ─────────────────────────────────────────────
// Router
// ─────────────────────────────────────────────

const router = Router();

interface RouteApiError {
  error: string;
  details?: string;
}

interface ProgramListItem {
  title: string;
  cip_code: string | null;
  credential_level: number | null;
  credential_title: string | null;
}

interface SchoolListItem {
  unitid: number;
  school_name: string;
  city: string | null;
  state: string | null;
}

/**
 * GET /programs?credential_level=<1-8>&q=<search>&limit=<n>
 * Distinct programs at that credential level, across every school,
 * optionally keyword-searched by title. Powers the compare page's
 * Credential -> Program -> College search-bar flow.
 */
router.get(
  "/",
  verifyToken,
  async (
    req: AuthRequest,
    res: Response<ProgramListItem[] | RouteApiError>,
  ) => {
    try {
      const credentialLevel = toNum(req.query.credential_level);
      if (
        credentialLevel === null ||
        !Number.isInteger(credentialLevel) ||
        credentialLevel < 1 ||
        credentialLevel > 8
      ) {
        return res
          .status(400)
          .json({ error: "A valid credential_level (1-8) is required" });
      }

      const q = toStr(req.query.q);
      const limit = Math.min(200, Math.max(1, toNum(req.query.limit) ?? 50));

      const { rows } = await pool.query<{
        title: string;
        cip_code: string | null;
        credential_level: number | null;
        credential_title: string | null;
      }>(
        `SELECT title, cip_code, credential_level, credential_title
           FROM (
             SELECT DISTINCT ON (title, cip_code)
                    title, cip_code, credential_level, credential_title
               FROM programs
              WHERE credential_level = $1
                AND ($2::text IS NULL OR title ILIKE '%' || $2 || '%')
              ORDER BY title, cip_code
           ) sub
          ORDER BY title
          LIMIT $3`,
        [credentialLevel, q, limit],
      );

      return res.json(
        rows.map((r) => ({
          title: r.title,
          cip_code: r.cip_code,
          credential_level: toNum(r.credential_level),
          credential_title: r.credential_title,
        })),
      );
    } catch (error) {
      return sendInternalError(req, res, error, "programs");
    }
  },
);

/**
 * GET /programs/:cip_code/schools?credential_level=<1-8>&q=<search>&limit=<n>
 * Schools offering that program at that credential level — reverse of
 * GET /schools/:id/programs. Powers the compare page's
 * Credential -> Program -> College search-bar flow.
 */
router.get(
  "/:cip_code/schools",
  verifyToken,
  async (
    req: AuthRequest,
    res: Response<SchoolListItem[] | RouteApiError>,
  ) => {
    try {
      const cipCode = toStr(req.params.cip_code);
      if (!cipCode) {
        return res.status(400).json({ error: "A valid cip_code is required" });
      }

      const credentialLevel = toNum(req.query.credential_level);
      if (
        credentialLevel === null ||
        !Number.isInteger(credentialLevel) ||
        credentialLevel < 1 ||
        credentialLevel > 8
      ) {
        return res
          .status(400)
          .json({ error: "A valid credential_level (1-8) is required" });
      }

      const q = toStr(req.query.q);
      const limit = Math.min(200, Math.max(1, toNum(req.query.limit) ?? 50));

      const { rows } = await pool.query<{
        unitid: number;
        school_name: string;
        city: string | null;
        state: string | null;
      }>(
        `SELECT s.unitid, s.name AS school_name, s.city, s.state
           FROM (
             SELECT DISTINCT unitid FROM programs
              WHERE cip_code = $1 AND credential_level = $2
           ) p
           JOIN schools s ON s.unitid = p.unitid
          WHERE ($3::text IS NULL OR s.name ILIKE '%' || $3 || '%')
          ORDER BY s.name ASC
          LIMIT $4`,
        [cipCode, credentialLevel, q, limit],
      );

      return res.json(
        rows.map((r) => ({
          unitid: toNum(r.unitid) ?? 0,
          school_name: r.school_name,
          city: r.city,
          state: r.state,
        })),
      );
    } catch (error) {
      return sendInternalError(req, res, error, "programs");
    }
  },
);

/**
 * GET /programs/:unitid
 */

router.get(
  "/:unitid",

  async (req: Request<{ unitid: string }>, res: Response) => {
    // ─────────────────────────────────────
    // 1. Validate unitid
    // ─────────────────────────────────────

    const raw = req.params.unitid;

    const unitid = parseInt(raw, 10);

    if (isNaN(unitid) || unitid <= 0) {
      return sendError(req, res, 400, "INVALID_UNITID");
    }

    // ─────────────────────────────────────
    // 2. Execute Queries
    // ─────────────────────────────────────

    let academicsResult: QueryResult<AcademicsRawRow>;

    let fieldsResult: QueryResult<ProgramDistributionRawRow>;

    let degreeLevelsResult: QueryResult<DegreeLevelRawRow>;

    try {
      [academicsResult, fieldsResult, degreeLevelsResult] = await Promise.all([
        pool.query<AcademicsRawRow>(ACADEMICS_QUERY, [unitid]),

        pool.query<ProgramDistributionRawRow>(FIELDS_QUERY, [unitid]),

        pool.query<DegreeLevelRawRow>(DEGREE_LEVELS_QUERY, [unitid]),
      ]);
    } catch (dbErr: unknown) {
      return sendInternalError(req, res, dbErr, "programs");
    }

    // ─────────────────────────────────────
    // 3. Not Found Guard
    // ─────────────────────────────────────

    if (academicsResult.rowCount === 0) {
      return sendError(req, res, 404, "NOT_FOUND");
    }

    // ─────────────────────────────────────
    // 4. Build Response
    // ─────────────────────────────────────

    const payload: ProgramsResponse = {
      unitid,

      academics: shapeAcademics(academicsResult.rows[0]),

      popular_fields: shapeFields(fieldsResult.rows),

      comprehensive_degree_levels: shapeDegreeLevels(degreeLevelsResult.rows),
    };

    return res.status(200).json(payload);
  },
);

export default router;
