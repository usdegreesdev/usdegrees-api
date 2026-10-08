import { Router, Request, Response } from "express";
import pool from "../db/client";
import { verifyToken } from "../middleware/auth";
import { AuthRequest } from "../types/user";
import { getAthleticsProfile } from "../services/athletics.service";
import { AthleticsProfile } from "../types/athletics";
import { EarningsAvgSalaryResolved } from "../types/earnings";
import { getEarningsForProgram } from "../services/earnings.service";
import { sendInternalError } from "../utils/apiError";

const router = Router();

const MAX_COMPARE_ATHLETICS = 4;
const MAX_COMPARE_MATRIX_ENTRIES = 5;

interface CollegeDropdownItem {
  unitid: number;
  school_name: string;
  city: string | null;
  state: string | null;
}

interface ApiError {
  error: string;
  details?: string;
}

function toNum(val: unknown): number | null {
  if (val === null || val === undefined) return null;
  const n = typeof val === "string" ? parseInt(val, 10) : Number(val);
  return isNaN(n) ? null : n;
}

function toStr(val: unknown): string | null {
  if (val === null || val === undefined) return null;
  const s = String(val).trim();
  return s.length === 0 ? null : s;
}

/**
 * GET /compare/colleges
 * Returns a lightweight list of colleges for use in compare-page dropdowns.
 *
 * Query params:
 *  - search: Optional. Filter by school name (case-insensitive partial match).
 *            When omitted, returns all colleges.
 *  - limit:  Max results to return (default 50, max 200).
 *
 * Example requests:
 *  GET /compare/colleges                        → All colleges (up to 50)
 *  GET /compare/colleges?search=Harvard         → Colleges matching "Harvard"
 *  GET /compare/colleges?search=mit&limit=10    → Up to 10 colleges matching "mit"
 *
 * Response: Array of { unitid, school_name, city, state }
 */
router.get(
  "/colleges",
  verifyToken,
  async (req: Request, res: Response<CollegeDropdownItem[] | ApiError>) => {
    try {
      const search = toStr(req.query.search);
      const limit = Math.min(200, Math.max(1, toNum(req.query.limit) ?? 50));

      const params: (string | number)[] = [];
      let whereClause = "";

      if (search) {
        params.push(`%${search}%`);
        whereClause = `WHERE LOWER(s.name) LIKE LOWER($1)`;
      }

      const sql = `
        SELECT
          s.unitid,
          s.name AS school_name,
          s.city,
          s.state
        FROM schools s
        ${whereClause}
        ORDER BY s.name ASC
        LIMIT $${params.length + 1}
      `;

      params.push(limit);

      const result = await pool.query<CollegeDropdownItem>(sql, params);

      const colleges: CollegeDropdownItem[] = result.rows.map((row) => ({
        unitid: toNum(row.unitid) ?? 0,
        school_name: toStr(row.school_name) ?? "Unknown",
        city: toStr(row.city),
        state: toStr(row.state),
      }));

      res.json(colleges);
    } catch (error) {
      sendInternalError(req, res, error, "compare");
    }
  },
);

// ===========================================================================
// /compare/selected — the caller's current comparison set, backed by the
// EXISTING user_compare_history table (history of comparison events).
//
// Model: each row = a SET of unitids (jsonb array) compared at created_at.
//   - current set      = compared_colleges of the caller's LATEST row
//   - POST add         = append a new row with union(current, added) if changed
//   - DELETE remove    = append a new row with (current - unitid); past rows kept
//   - addedAt(unitid)  = MIN(created_at) over the caller's rows containing it
// All routes are caller-scoped to their resolved usdusers.id.
// ===========================================================================

interface SelectedItem {
  unitid: number | null;
  name: string | null;
  location: string | null;
  tuitionInState: number | null; // costs.tuition_in_state (IN-STATE specifically)
  acceptanceRate: number | null; // admissions.admission_rate
  addedAt: string | Date | null; // earliest created_at across history
  schoolUrl: string | null; // schools.school_url, normalized to absolute
  schoolType: string | null; // programs.school_type, e.g. "Public, 4-year"
  accreditor: string | null; // schools.accreditor
  academics: {
    satRangeLow: number | null; // admissions.school_min_range (or summed p25 math+reading)
    satRangeHigh: number | null; // admissions.school_max_range (or summed p75 math+reading)
    graduationRate: number | null; // completion.completion_rate (raw fraction, same convention as acceptanceRate)
  };
  cost: {
    tuitionOutState: number | null; // costs.tuition_out_state
    stickerPrice: number | null; // costs.sticker_price_by_api
    avgDebt: number | null; // debt_income_ratio.avg_debt
    debtIncomeRatio: number | null; // debt_income_ratio.debt_income_ratio
  };
  outcomes: {
    programEarnings: number | null; // AVG(earnings_against_courses_merged.year_10) across the school's programs
    // "Median Graduate Salary" in the compare UI. When a `program` filter
    // matched this school, sourced from the SAME getEarningsForProgram()
    // resolution the outcomes tab uses for that (unitid, cip_code,
    // credential_level) — recency-first across every grad_cohort on file,
    // not a separate/legacy computation. Otherwise (no program filter / no
    // match) falls back to the school-wide AVG(avg_salary) across all
    // programs, as a bare number.
    avgSalary: EarningsAvgSalaryResolved | number | null;
    roi20Yr: number | null; // roi.roi_20yr
  };
  students: {
    size: number | null; // students.size — total enrollment
  };
  programs: {
    studentFacultyRatio: string | null; // students.student_faculty_ratio, formatted "5:1"
    repaymentSuccess: number | null; // repayment.repayment_success (raw fraction)
    popularFields: {
      fieldName: string;
      percentage: number;
      programCount: number;
    }[]; // program_distribution, top 5 by share
    degreeLevels: {
      level: string;
      totalPrograms: number;
      topTitles: string[];
    }[]; // programs, grouped by degree_level_category (Undergraduate/Graduate/Professional/Other)
    selectedProgram: {
      title: string;
      cipCode: string | null;
      degreeLevelCategory: string | null;
      credentialLevel: number | null;
      // Same getEarningsForProgram() resolution as outcomes.avgSalary above —
      // guarantees this matches exactly what the outcomes tab shows for the
      // same program (value, cohort, and estimated basis).
      earnings: EarningsAvgSalaryResolved | null;
    } | null; // set only when a `program` filter is passed and the school offers a matching title
  };
}

/**
 * Normalize a school URL for safe linking: null/empty -> null; already has
 * http(s):// -> untouched; otherwise prefix https://.
 */
function normalizeUrl(val: unknown): string | null {
  if (val === null || val === undefined) return null;
  const s = String(val).trim();
  if (!s) return null;
  return /^https?:\/\//i.test(s) ? s : `https://${s}`;
}

/** Resolve the verified firebase_uid (req.userId) to the integer usdusers.id. */
async function resolveUserId(firebaseUid: string): Promise<string | null> {
  const r = await pool.query<{ id: string }>(
    "SELECT id FROM usdusers WHERE firebase_uid = $1",
    [firebaseUid],
  );
  return r.rows.length ? r.rows[0].id : null;
}

/** Collect unitids from a { unitid } or { unitids: [...] } body as positive ints. */
function collectUnitids(body: Record<string, unknown>): number[] {
  const raw: unknown[] = Array.isArray(body.unitids)
    ? body.unitids
    : body.unitid !== undefined
      ? [body.unitid]
      : [];
  const out: number[] = [];
  const seen = new Set<number>();
  for (const v of raw) {
    const n = toNum(v);
    if (n === null || !Number.isInteger(n) || n <= 0 || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}

/** Float-safe numeric parse (admission_rate etc. arrive from pg as strings). */
function toFloat(val: unknown): number | null {
  if (val === null || val === undefined) return null;
  const n = typeof val === "string" ? parseFloat(val) : Number(val);
  return Number.isFinite(n) ? n : null;
}

/** Format a raw ratio (e.g. 14.2) as "14:1", matching /programs' convention. */
function formatRatio(val: unknown): string | null {
  const n = toFloat(val);
  if (n === null) return null;
  const display =
    n < 10 ? n.toFixed(1).replace(/\.0$/, "") : Math.round(n).toString();
  return `${display}:1`;
}

function toLocation(city: unknown, state: unknown): string | null {
  const parts = [city, state]
    .map((v) => (v == null ? "" : String(v).trim()))
    .filter((v) => v.length > 0);
  return parts.length ? parts.join(", ") : null;
}

/** The caller's current comparison set = unitids in their latest history row. */
async function getCurrentSet(userId: string): Promise<number[]> {
  const r = await pool.query<{ compared_colleges: unknown }>(
    `SELECT compared_colleges FROM user_compare_history
      WHERE user_id = $1 ORDER BY created_at DESC, id DESC LIMIT 1`,
    [userId],
  );
  if (r.rows.length === 0 || !Array.isArray(r.rows[0].compared_colleges))
    return [];
  return (r.rows[0].compared_colleges as unknown[])
    .map((v) => toNum(v))
    .filter((n): n is number => n !== null && Number.isInteger(n));
}

/**
 * Enriched current set with per-unitid earliest addedAt.
 * When `programTitle` is given, each school is matched against its own
 * `programs.title` (ILIKE, so "Accounting and Computer Science" matches the
 * "Accounting and Computer Science." row) and `selectedProgram` carries that
 * program's own CIP-level earnings instead of the school-wide average.
 */
async function getSelectedEnriched(
  userId: string,
  programTitle?: string,
): Promise<SelectedItem[]> {
  const programParam = programTitle ? `%${programTitle}%` : null;
  const { rows } = await pool.query(
    `WITH latest AS (
        SELECT compared_colleges
          FROM user_compare_history
         WHERE user_id = $1
         ORDER BY created_at DESC, id DESC
         LIMIT 1
     ),
     sel AS (
        SELECT (jsonb_array_elements_text((SELECT compared_colleges FROM latest)))::bigint AS unitid
     ),
     added AS (
        -- earliest created_at for every unitid that ever appeared in the
        -- caller's history (robust to number/string element storage).
        SELECT (e.val)::bigint AS unitid, MIN(h.created_at) AS added_at
          FROM user_compare_history h
          CROSS JOIN LATERAL jsonb_array_elements_text(h.compared_colleges) AS e(val)
         WHERE h.user_id = $1
         GROUP BY (e.val)::bigint
     )
     SELECT
        sel.unitid,
        added.added_at,
        s.name                 AS name,
        s.city                 AS city,
        s.state                AS state,
        s.school_url           AS school_url,
        s.accreditor           AS accreditor,
        p.school_type          AS school_type,
        ad.admission_rate      AS admission_rate,
        ad.school_min_range    AS sat_low,
        ad.school_max_range    AS sat_high,
        ad.sat_p25_math        AS sat_p25_math,
        ad.sat_p75_math        AS sat_p75_math,
        ad.sat_p25_reading     AS sat_p25_reading,
        ad.sat_p75_reading     AS sat_p75_reading,
        comp.completion_rate   AS completion_rate,
        c.tuition_in_state     AS tuition_in_state,
        c.tuition_out_state    AS tuition_out_state,
        c.sticker_price_by_api AS sticker_price,
        debt.avg_debt          AS avg_debt,
        debt.debt_income_ratio AS debt_income_ratio,
        earnSalary.avg_salary  AS avg_salary,
        roi.roi_20yr           AS roi_20yr,
        earn.avg_year10        AS program_earnings,
        stu.student_faculty_ratio AS student_faculty_ratio,
        stu.size                AS student_size,
        rep.repayment_success  AS repayment_success,
        fields.top_fields      AS top_fields,
        degLevels.degree_levels AS degree_levels,
        selProg.title           AS sel_program_title,
        selProg.cip_code        AS sel_program_cip,
        selProg.credential_level AS sel_program_credential_level,
        selProg.degree_level_category AS sel_program_degree_level,
        progEarn.year_10        AS sel_program_earnings,
        progEarn.year_10_method AS sel_program_earnings_method
     FROM sel
     JOIN added ON added.unitid = sel.unitid
     LEFT JOIN schools s ON s.unitid = sel.unitid
     LEFT JOIN LATERAL (
        SELECT school_type FROM programs WHERE unitid = sel.unitid LIMIT 1
     ) p ON TRUE
     LEFT JOIN LATERAL (
        SELECT admission_rate, school_min_range, school_max_range,
               sat_p25_math, sat_p75_math, sat_p25_reading, sat_p75_reading
          FROM admissions WHERE unitid = sel.unitid LIMIT 1
     ) ad ON TRUE
     LEFT JOIN LATERAL (
        SELECT completion_rate FROM completion WHERE unitid = sel.unitid LIMIT 1
     ) comp ON TRUE
     LEFT JOIN LATERAL (
        SELECT tuition_in_state, tuition_out_state, sticker_price_by_api
          FROM costs WHERE unitid = sel.unitid LIMIT 1
     ) c ON TRUE
     LEFT JOIN LATERAL (
        SELECT avg_debt, debt_income_ratio
          FROM debt_income_ratio WHERE unitid = sel.unitid LIMIT 1
     ) debt ON TRUE
     LEFT JOIN LATERAL (
        SELECT roi_20yr FROM roi
         WHERE unitid = sel.unitid
         ORDER BY roi_20yr DESC NULLS LAST LIMIT 1
     ) roi ON TRUE
     LEFT JOIN LATERAL (
        -- earnings_against_courses_merged is the source of truth; rollback
        -- to earnings_against_courses (raw, no fill-method tracking) if needed.
        SELECT AVG(year_10) AS avg_year10 FROM earnings_against_courses_merged
         WHERE unitid = sel.unitid AND year_10 IS NOT NULL
     ) earn ON TRUE
     LEFT JOIN LATERAL (
        -- Median Graduate Salary — school-wide average of
        -- earnings_against_courses_merged.avg_salary across the school's
        -- programs (same aggregation shape as the earn CTE above for year_10).
        SELECT AVG(avg_salary) AS avg_salary FROM earnings_against_courses_merged
         WHERE unitid = sel.unitid AND avg_salary IS NOT NULL
     ) earnSalary ON TRUE
     LEFT JOIN LATERAL (
        SELECT student_faculty_ratio, size FROM students WHERE unitid = sel.unitid LIMIT 1
     ) stu ON TRUE
     LEFT JOIN LATERAL (
        SELECT repayment_success FROM repayment WHERE unitid = sel.unitid LIMIT 1
     ) rep ON TRUE
     LEFT JOIN LATERAL (
        SELECT jsonb_agg(t.* ORDER BY t.percentage DESC) AS top_fields
          FROM (
             SELECT field_name, percentage, program_count FROM program_distribution
              WHERE unitid = sel.unitid
              ORDER BY percentage DESC LIMIT 5
          ) t
     ) fields ON TRUE
     LEFT JOIN LATERAL (
        SELECT jsonb_agg(
                 jsonb_build_object(
                   'level', dl.degree_level_category,
                   'total_programs', dl.total_programs,
                   'top_titles', dl.top_titles
                 )
                 ORDER BY CASE dl.degree_level_category
                            WHEN 'Undergraduate' THEN 1
                            WHEN 'Graduate' THEN 2
                            WHEN 'Professional' THEN 3
                            ELSE 4
                          END
               ) AS degree_levels
          FROM (
             SELECT
                p.degree_level_category,
                COUNT(*) AS total_programs,
                ARRAY(
                   SELECT DISTINCT p2.title FROM programs p2
                    WHERE p2.unitid = sel.unitid
                      AND p2.degree_level_category = p.degree_level_category
                    ORDER BY p2.title ASC LIMIT 3
                ) AS top_titles
             FROM programs p
             WHERE p.unitid = sel.unitid
             GROUP BY p.degree_level_category
          ) dl
     ) degLevels ON TRUE
     LEFT JOIN LATERAL (
        SELECT title, cip_code, credential_level, degree_level_category
          FROM programs
         WHERE unitid = sel.unitid
           AND $2::text IS NOT NULL
           AND title ILIKE $2
         ORDER BY title ASC
         LIMIT 1
     ) selProg ON TRUE
     LEFT JOIN LATERAL (
        -- earnings_against_courses_merged is the source of truth; rollback
        -- to earnings_against_courses (raw, no fill-method tracking) if needed.
        SELECT year_10, year_10_method FROM earnings_against_courses_merged
         WHERE unitid = sel.unitid
           AND selProg.cip_code IS NOT NULL
           AND replace(cip_code, '.', '') = replace(selProg.cip_code, '.', '')
           AND year_10 IS NOT NULL
         ORDER BY grad_cohort DESC
         LIMIT 1
     ) progEarn ON TRUE
     ORDER BY added.added_at ASC, sel.unitid ASC`,
    [userId, programParam],
  );

  const items = rows.map(async (row) => {
    const sat25 =
      toFloat(row.sat_low) ??
      (row.sat_p25_math != null && row.sat_p25_reading != null
        ? toFloat(row.sat_p25_math)! + toFloat(row.sat_p25_reading)!
        : null);
    const sat75 =
      toFloat(row.sat_high) ??
      (row.sat_p75_math != null && row.sat_p75_reading != null
        ? toFloat(row.sat_p75_math)! + toFloat(row.sat_p75_reading)!
        : null);

    const popularFields: {
      fieldName: string;
      percentage: number;
      programCount: number;
    }[] = Array.isArray(row.top_fields)
      ? row.top_fields
          .filter((f: { field_name?: string }) => f?.field_name)
          .map(
            (f: {
              field_name: string;
              percentage: unknown;
              program_count: unknown;
            }) => ({
              fieldName: f.field_name,
              percentage: toFloat(f.percentage) ?? 0,
              programCount: toNum(f.program_count) ?? 0,
            }),
          )
      : [];

    const degreeLevels: {
      level: string;
      totalPrograms: number;
      topTitles: string[];
    }[] = Array.isArray(row.degree_levels)
      ? row.degree_levels.map(
          (d: {
            level: string;
            total_programs: unknown;
            top_titles: unknown;
          }) => ({
            level: toStr(d.level) ?? "Other",
            totalPrograms: toNum(d.total_programs) ?? 0,
            topTitles: Array.isArray(d.top_titles)
              ? d.top_titles.filter(Boolean)
              : [],
          }),
        )
      : [];

    // Same getEarningsForProgram() resolution the outcomes tab calls for this
    // exact (unitid, cip_code, credential_level) — guarantees compare's
    // avg_salary matches outcomes exactly (value, cohort, estimated basis)
    // instead of a second, parallel computation over the same table.
    const selUnitid = toNum(row.unitid);
    const selCip = toStr(row.sel_program_cip);
    const selCredentialLevel = toNum(row.sel_program_credential_level);
    const selectedProgramEarnings =
      row.sel_program_title != null &&
      selUnitid != null &&
      selCip != null &&
      selCredentialLevel != null
        ? (await getEarningsForProgram(selUnitid, selCip, selCredentialLevel))
            .avg_salary
        : null;

    return {
      unitid: toNum(row.unitid),
      name: row.name ?? null,
      location: toLocation(row.city, row.state),
      tuitionInState: toFloat(row.tuition_in_state),
      acceptanceRate: toFloat(row.admission_rate),
      addedAt: row.added_at ?? null,
      schoolUrl: normalizeUrl(row.school_url),
      schoolType: toStr(row.school_type),
      accreditor: toStr(row.accreditor),
      academics: {
        satRangeLow: sat25,
        satRangeHigh: sat75,
        graduationRate: toFloat(row.completion_rate),
      },
      cost: {
        tuitionOutState: toFloat(row.tuition_out_state),
        stickerPrice: toFloat(row.sticker_price),
        avgDebt: toFloat(row.avg_debt),
        debtIncomeRatio: toFloat(row.debt_income_ratio),
      },
      outcomes: {
        // Prefer the exact selected-program figure over the school-wide
        // average whenever a program filter matched this school.
        programEarnings:
          toFloat(row.sel_program_earnings) ?? toFloat(row.program_earnings),
        // Sourced from getEarningsForProgram() (same as outcomes) when a
        // program filter matched this school; otherwise the school-wide
        // aggregate.
        avgSalary:
          row.sel_program_title != null
            ? selectedProgramEarnings
            : toFloat(row.avg_salary),
        roi20Yr: toFloat(row.roi_20yr),
      },
      students: {
        size: toNum(row.student_size),
      },
      programs: {
        studentFacultyRatio: formatRatio(row.student_faculty_ratio),
        repaymentSuccess: toFloat(row.repayment_success),
        popularFields,
        degreeLevels,
        selectedProgram: row.sel_program_title
          ? {
              title: row.sel_program_title,
              cipCode: toStr(row.sel_program_cip),
              degreeLevelCategory: toStr(row.sel_program_degree_level),
              credentialLevel: toNum(row.sel_program_credential_level),
              earnings: selectedProgramEarnings,
            }
          : null,
      },
    };
  });

  return Promise.all(items);
}

/**
 * POST /compare/selected   body { unitid } | { unitids: [...] }
 * Adds college(s) to the caller's comparison set. Idempotent: re-adding a
 * present college changes nothing (no new row → earliest addedAt preserved).
 * Returns the enriched current set.
 */
router.post(
  "/selected",
  verifyToken,
  async (req: AuthRequest, res: Response) => {
    try {
      const incoming = collectUnitids(
        (req.body ?? {}) as Record<string, unknown>,
      );
      if (incoming.length === 0) {
        return res
          .status(400)
          .json({ error: "A valid unitid or unitids[] is required" });
      }

      const userId = await resolveUserId(req.userId as string);
      if (!userId) return res.status(404).json({ error: "User not found" });

      const current = await getCurrentSet(userId);
      const set = new Set(current);
      let changed = false;
      for (const u of incoming) {
        if (!set.has(u)) {
          set.add(u);
          changed = true;
        }
      }

      if (changed) {
        await pool.query(
          `INSERT INTO user_compare_history (user_id, compared_colleges, created_at)
         VALUES ($1, $2::jsonb, NOW())`,
          [userId, JSON.stringify([...set])],
        );
      }

      return res.json(await getSelectedEnriched(userId));
    } catch (error) {
      return sendInternalError(req, res, error, "compare");
    }
  },
);

/**
 * GET /compare/selected?program=<title>
 * Returns the caller's current comparison set, enriched, each with addedAt
 * (earliest created_at for that unitid). Empty -> [].
 *
 * Optional `program` query param matches each school's own programs.title
 * (ILIKE) and, when it hits, fills programs.selectedProgram with that exact
 * program's CIP-level earnings instead of a generic top-3 title sample.
 */
router.get(
  "/selected",
  verifyToken,
  async (req: AuthRequest, res: Response) => {
    try {
      const userId = await resolveUserId(req.userId as string);
      if (!userId) return res.status(404).json({ error: "User not found" });
      const program = toStr(req.query.program) ?? undefined;
      return res.json(await getSelectedEnriched(userId, program));
    } catch (error) {
      return sendInternalError(req, res, error, "compare");
    }
  },
);

/**
 * DELETE /compare/selected/:unitid
 * Removes a college from the caller's CURRENT set by appending a new history
 * row with (current - unitid). Past history rows are never modified.
 */
router.delete(
  "/selected/:unitid",
  verifyToken,
  async (req: AuthRequest, res: Response) => {
    try {
      const unitid = toNum(req.params.unitid);
      if (unitid === null || !Number.isInteger(unitid) || unitid <= 0) {
        return res
          .status(400)
          .json({ error: "A valid integer unitid is required" });
      }

      const userId = await resolveUserId(req.userId as string);
      if (!userId) return res.status(404).json({ error: "User not found" });

      const current = await getCurrentSet(userId);
      if (current.includes(unitid)) {
        const next = current.filter((u) => u !== unitid);
        await pool.query(
          `INSERT INTO user_compare_history (user_id, compared_colleges, created_at)
         VALUES ($1, $2::jsonb, NOW())`,
          [userId, JSON.stringify(next)],
        );
      }

      return res.json({ ok: true });
    } catch (error) {
      return sendInternalError(req, res, error, "compare");
    }
  },
);

// ===========================================================================
// /compare/matrix — the caller's per-program compare-matrix selections,
// backed by the NEW compare_matrix_entries table. Distinct from
// /compare/selected (bare-unitid, user_compare_history-backed): the matrix
// tracks unitid + specific program (cip_code/credential_level), so the same
// college can appear more than once under different programs.
//
// PUT is a full-list replace (delete-then-insert in one transaction) to
// match how the frontend already maintains this list client-side — not an
// incremental add/remove like /compare/selected.
// ===========================================================================

interface MatrixEntry {
  unitid: number;
  cipCode: string | null;
  credentialLevel: string | null;
  programName: string | null;
  credentialTitle: string | null;
}

/** Fetch the caller's current compare-matrix rows, camelCased. Empty -> []. */
async function fetchMatrixEntries(userId: string): Promise<MatrixEntry[]> {
  const { rows } = await pool.query<{
    unitid: string;
    cip_code: string | null;
    credential_level: string | null;
    program_name: string | null;
    credential_title: string | null;
  }>(
    `SELECT unitid, cip_code, credential_level, program_name, credential_title
       FROM compare_matrix_entries
      WHERE user_id = $1
      ORDER BY id ASC`,
    [userId],
  );

  return rows.map((r) => ({
    unitid: toNum(r.unitid) ?? 0,
    cipCode: r.cip_code,
    credentialLevel: r.credential_level,
    programName: r.program_name,
    credentialTitle: r.credential_title,
  }));
}

/**
 * GET /compare/matrix
 * Returns the caller's current compare-matrix rows. Empty -> [].
 */
router.get(
  "/matrix",
  verifyToken,
  async (req: AuthRequest, res: Response<MatrixEntry[] | ApiErrorBody>) => {
    try {
      const userId = await resolveUserId(req.userId as string);
      if (!userId) return res.status(404).json({ error: "User not found" });

      return res.json(await fetchMatrixEntries(userId));
    } catch (error) {
      return sendInternalError(req, res, error, "compare");
    }
  },
);

/**
 * PUT /compare/matrix   body { entries: [{ unitid, cipCode?, credentialLevel?,
 *                                           programName?, credentialTitle? }] }
 * Replaces ALL of the caller's compare-matrix rows with the given list
 * (delete-then-insert in one transaction). An empty entries[] clears the
 * matrix. Every entry must have a valid positive-integer unitid.
 */
router.put(
  "/matrix",
  verifyToken,
  async (req: AuthRequest, res: Response<MatrixEntry[] | ApiErrorBody>) => {
    try {
      const userId = await resolveUserId(req.userId as string);
      if (!userId) return res.status(404).json({ error: "User not found" });

      const entries = (req.body as { entries?: unknown[] } | undefined)
        ?.entries;
      if (!Array.isArray(entries)) {
        return res.status(400).json({ error: "entries[] is required" });
      }

      const normalized: MatrixEntry[] = [];
      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i] as Record<string, unknown> | null;
        const unitid = toNum(entry?.unitid);
        if (unitid === null || !Number.isInteger(unitid) || unitid <= 0) {
          return res.status(400).json({
            error: `Invalid entry at index ${i}: missing unitid`,
          });
        }
        normalized.push({
          unitid,
          cipCode: toStr(entry?.cipCode),
          credentialLevel: toStr(entry?.credentialLevel),
          programName: toStr(entry?.programName),
          credentialTitle: toStr(entry?.credentialTitle),
        });
      }

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          "DELETE FROM compare_matrix_entries WHERE user_id = $1",
          [userId],
        );

        if (normalized.length > 0) {
          const values: Array<string | number | null> = [];
          const placeholders = normalized
            .map((e, idx) => {
              const base = idx * 6;
              values.push(
                userId,
                e.unitid,
                e.cipCode,
                e.credentialLevel,
                e.programName,
                e.credentialTitle,
              );
              return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6})`;
            })
            .join(", ");

          await client.query(
            `INSERT INTO compare_matrix_entries (user_id, unitid, cip_code, credential_level, program_name, credential_title)
             VALUES ${placeholders}`,
            values,
          );
        }

        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }

      return res.json(normalized);
    } catch (error) {
      return sendInternalError(req, res, error, "compare");
    }
  },
);

/**
 * POST /compare/matrix/entry
 * body { unitid, cipCode?, credentialLevel?, programName?, credentialTitle? }
 * Upserts a single compare-matrix entry (dedupe key: unitid + cipCode +
 * credentialLevel, null-safe). Atomic relative to other mutations on the
 * same user's matrix — unlike PUT /matrix, safe for multiple independent UI
 * surfaces to call concurrently without clobbering each other's rows.
 * Enforces the MAX_COMPARE_MATRIX_ENTRIES cap on NEW entries only (updating
 * an existing entry never counts against the cap).
 * Response: the caller's full updated matrix.
 */
router.post(
  "/matrix/entry",
  verifyToken,
  async (req: AuthRequest, res: Response<MatrixEntry[] | ApiErrorBody>) => {
    try {
      const userId = await resolveUserId(req.userId as string);
      if (!userId) return res.status(404).json({ error: "User not found" });

      const body = (req.body ?? {}) as Record<string, unknown>;
      const unitid = toNum(body.unitid);
      if (unitid === null || !Number.isInteger(unitid) || unitid <= 0) {
        return res.status(400).json({ error: "A valid unitid is required" });
      }
      const cipCode = toStr(body.cipCode);
      const credentialLevel = toStr(body.credentialLevel);
      const programName = toStr(body.programName);
      const credentialTitle = toStr(body.credentialTitle);

      const client = await pool.connect();
      let limitReached = false;
      try {
        await client.query("BEGIN");
        // Serializes concurrent POSTs for the same user within this
        // transaction so the cap check below can't race two inserts past
        // MAX_COMPARE_MATRIX_ENTRIES (COUNT(*) can't itself take FOR UPDATE).
        await client.query("SELECT pg_advisory_xact_lock($1::bigint)", [
          userId,
        ]);

        const existing = await client.query<{ id: string }>(
          `SELECT id FROM compare_matrix_entries
            WHERE user_id = $1 AND unitid = $2
              AND cip_code IS NOT DISTINCT FROM $3
              AND credential_level IS NOT DISTINCT FROM $4
            FOR UPDATE`,
          [userId, unitid, cipCode, credentialLevel],
        );

        if (existing.rows.length > 0) {
          await client.query(
            `UPDATE compare_matrix_entries
                SET program_name = $2, credential_title = $3
              WHERE id = $1`,
            [existing.rows[0].id, programName, credentialTitle],
          );
        } else {
          const { rows: countRows } = await client.query<{ count: number }>(
            "SELECT COUNT(*)::int AS count FROM compare_matrix_entries WHERE user_id = $1",
            [userId],
          );
          if ((countRows[0]?.count ?? 0) >= MAX_COMPARE_MATRIX_ENTRIES) {
            limitReached = true;
          } else {
            await client.query(
              `INSERT INTO compare_matrix_entries
                 (user_id, unitid, cip_code, credential_level, program_name, credential_title)
               VALUES ($1, $2, $3, $4, $5, $6)`,
              [
                userId,
                unitid,
                cipCode,
                credentialLevel,
                programName,
                credentialTitle,
              ],
            );
          }
        }

        await client.query(limitReached ? "ROLLBACK" : "COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }

      if (limitReached) {
        return res.status(409).json({
          error: "Compare limit reached",
          code: "COMPARE_LIMIT_REACHED",
          details: `A maximum of ${MAX_COMPARE_MATRIX_ENTRIES} entries can be compared at once`,
        });
      }

      return res.json(await fetchMatrixEntries(userId));
    } catch (error) {
      return sendInternalError(req, res, error, "compare");
    }
  },
);

/**
 * DELETE /compare/matrix/entry/:unitid
 * Removes EVERY compare-matrix entry for that college (used by surfaces
 * that don't track a specific program). Response: the full updated matrix.
 *
 * Optional ?details=true: instead of the bare matrix, responds with the
 * same remaining rows enriched exactly like GET /compare/matrix/details,
 * each nested under a `details` key (row order matches compare_matrix_entries
 * id ASC, same as /matrix/details).
 */
router.delete(
  "/matrix/entry/:unitid",
  verifyToken,
  async (
    req: AuthRequest,
    res: Response<
      MatrixEntry[] | (MatrixEntry & { details: SelectedItem })[] | ApiErrorBody
    >,
  ) => {
    try {
      const unitid = toNum(req.params.unitid);
      if (unitid === null || !Number.isInteger(unitid) || unitid <= 0) {
        return res
          .status(400)
          .json({ error: "A valid integer unitid is required" });
      }

      const userId = await resolveUserId(req.userId as string);
      if (!userId) return res.status(404).json({ error: "User not found" });

      await pool.query(
        "DELETE FROM compare_matrix_entries WHERE user_id = $1 AND unitid = $2",
        [userId, unitid],
      );

      if (toStr(req.query.details) === "true") {
        return res.json(await getMatrixEnrichedRows(userId));
      }
      return res.json(await fetchMatrixEntries(userId));
    } catch (error) {
      return sendInternalError(req, res, error, "compare");
    }
  },
);

/**
 * DELETE /compare/matrix/entry/:unitid/:cipCode/:credentialLevel
 * Removes one specific program entry (used by the compare page's own
 * per-program remove). Response: the full updated matrix.
 *
 * Optional ?details=true: same enrichment as above.
 */
router.delete(
  "/matrix/entry/:unitid/:cipCode/:credentialLevel",
  verifyToken,
  async (
    req: AuthRequest,
    res: Response<
      MatrixEntry[] | (MatrixEntry & { details: SelectedItem })[] | ApiErrorBody
    >,
  ) => {
    try {
      const unitid = toNum(req.params.unitid);
      if (unitid === null || !Number.isInteger(unitid) || unitid <= 0) {
        return res
          .status(400)
          .json({ error: "A valid integer unitid is required" });
      }
      const cipCode = toStr(req.params.cipCode);
      const credentialLevel = toStr(req.params.credentialLevel);

      const userId = await resolveUserId(req.userId as string);
      if (!userId) return res.status(404).json({ error: "User not found" });

      await pool.query(
        `DELETE FROM compare_matrix_entries
          WHERE user_id = $1 AND unitid = $2
            AND cip_code IS NOT DISTINCT FROM $3
            AND credential_level IS NOT DISTINCT FROM $4`,
        [userId, unitid, cipCode, credentialLevel],
      );

      if (toStr(req.query.details) === "true") {
        return res.json(await getMatrixEnrichedRows(userId));
      }
      return res.json(await fetchMatrixEntries(userId));
    } catch (error) {
      return sendInternalError(req, res, error, "compare");
    }
  },
);

/**
 * Enriched compare-matrix rows, in the SAME shape as getSelectedEnriched's
 * SelectedItem — one entry per compare_matrix_entries row (so the same
 * college can appear more than once under different programs). Unlike
 * getSelectedEnriched (which matches `programs.title` via ILIKE against a
 * single ?program= query param), each row here resolves its own
 * selectedProgram from its OWN cip_code/credential_level, so every row's
 * program is resolved in one call — no per-program round trip needed.
 */
async function getMatrixEnrichedRows(
  userId: string,
): Promise<(MatrixEntry & { details: SelectedItem })[]> {
  const { rows } = await pool.query(
    `WITH entries AS (
        SELECT id, unitid, cip_code, credential_level, program_name, credential_title, created_at
          FROM compare_matrix_entries
         WHERE user_id = $1
         ORDER BY id ASC
     )
     SELECT
        entries.unitid          AS unitid,
        entries.cip_code        AS entry_cip_code,
        entries.credential_level AS entry_credential_level,
        entries.program_name    AS entry_program_name,
        entries.credential_title AS entry_credential_title,
        entries.created_at      AS added_at,
        s.name                 AS name,
        s.city                 AS city,
        s.state                AS state,
        s.school_url           AS school_url,
        s.accreditor           AS accreditor,
        p.school_type          AS school_type,
        ad.admission_rate      AS admission_rate,
        ad.school_min_range    AS sat_low,
        ad.school_max_range    AS sat_high,
        ad.sat_p25_math        AS sat_p25_math,
        ad.sat_p75_math        AS sat_p75_math,
        ad.sat_p25_reading     AS sat_p25_reading,
        ad.sat_p75_reading     AS sat_p75_reading,
        comp.completion_rate   AS completion_rate,
        c.tuition_in_state     AS tuition_in_state,
        c.tuition_out_state    AS tuition_out_state,
        c.sticker_price_by_api AS sticker_price,
        debt.avg_debt          AS avg_debt,
        debt.debt_income_ratio AS debt_income_ratio,
        earnSalary.avg_salary  AS avg_salary,
        roi.roi_20yr           AS roi_20yr,
        earn.avg_year10        AS program_earnings,
        stu.student_faculty_ratio AS student_faculty_ratio,
        stu.size                AS student_size,
        rep.repayment_success  AS repayment_success,
        fields.top_fields      AS top_fields,
        degLevels.degree_levels AS degree_levels,
        selProg.title           AS sel_program_title,
        selProg.cip_code        AS sel_program_cip,
        selProg.credential_level AS sel_program_credential_level,
        selProg.degree_level_category AS sel_program_degree_level,
        progEarn.year_10        AS sel_program_earnings,
        progEarn.year_10_method AS sel_program_earnings_method
     FROM entries
     LEFT JOIN schools s ON s.unitid = entries.unitid
     LEFT JOIN LATERAL (
        SELECT school_type FROM programs WHERE unitid = entries.unitid LIMIT 1
     ) p ON TRUE
     LEFT JOIN LATERAL (
        SELECT admission_rate, school_min_range, school_max_range,
               sat_p25_math, sat_p75_math, sat_p25_reading, sat_p75_reading
          FROM admissions WHERE unitid = entries.unitid LIMIT 1
     ) ad ON TRUE
     LEFT JOIN LATERAL (
        SELECT completion_rate FROM completion WHERE unitid = entries.unitid LIMIT 1
     ) comp ON TRUE
     LEFT JOIN LATERAL (
        SELECT tuition_in_state, tuition_out_state, sticker_price_by_api
          FROM costs WHERE unitid = entries.unitid LIMIT 1
     ) c ON TRUE
     LEFT JOIN LATERAL (
        SELECT avg_debt, debt_income_ratio
          FROM debt_income_ratio WHERE unitid = entries.unitid LIMIT 1
     ) debt ON TRUE
     LEFT JOIN LATERAL (
        SELECT roi_20yr FROM roi
         WHERE unitid = entries.unitid
         ORDER BY roi_20yr DESC NULLS LAST LIMIT 1
     ) roi ON TRUE
     LEFT JOIN LATERAL (
        SELECT AVG(year_10) AS avg_year10 FROM earnings_against_courses_merged
         WHERE unitid = entries.unitid AND year_10 IS NOT NULL
     ) earn ON TRUE
     LEFT JOIN LATERAL (
        SELECT AVG(avg_salary) AS avg_salary FROM earnings_against_courses_merged
         WHERE unitid = entries.unitid AND avg_salary IS NOT NULL
     ) earnSalary ON TRUE
     LEFT JOIN LATERAL (
        SELECT student_faculty_ratio, size FROM students WHERE unitid = entries.unitid LIMIT 1
     ) stu ON TRUE
     LEFT JOIN LATERAL (
        SELECT repayment_success FROM repayment WHERE unitid = entries.unitid LIMIT 1
     ) rep ON TRUE
     LEFT JOIN LATERAL (
        SELECT jsonb_agg(t.* ORDER BY t.percentage DESC) AS top_fields
          FROM (
             SELECT field_name, percentage, program_count FROM program_distribution
              WHERE unitid = entries.unitid
              ORDER BY percentage DESC LIMIT 5
          ) t
     ) fields ON TRUE
     LEFT JOIN LATERAL (
        SELECT jsonb_agg(
                 jsonb_build_object(
                   'level', dl.degree_level_category,
                   'total_programs', dl.total_programs,
                   'top_titles', dl.top_titles
                 )
                 ORDER BY CASE dl.degree_level_category
                            WHEN 'Undergraduate' THEN 1
                            WHEN 'Graduate' THEN 2
                            WHEN 'Professional' THEN 3
                            ELSE 4
                          END
               ) AS degree_levels
          FROM (
             SELECT
                p.degree_level_category,
                COUNT(*) AS total_programs,
                ARRAY(
                   SELECT DISTINCT p2.title FROM programs p2
                    WHERE p2.unitid = entries.unitid
                      AND p2.degree_level_category = p.degree_level_category
                    ORDER BY p2.title ASC LIMIT 3
                ) AS top_titles
             FROM programs p
             WHERE p.unitid = entries.unitid
             GROUP BY p.degree_level_category
          ) dl
     ) degLevels ON TRUE
     LEFT JOIN LATERAL (
        -- Match THIS row's own cip_code/credential_level (not a title ILIKE
        -- against a single query param) so every row resolves independently
        -- in this one query.
        SELECT title, cip_code, credential_level, degree_level_category
          FROM programs
         WHERE unitid = entries.unitid
           AND entries.cip_code IS NOT NULL
           AND entries.credential_level IS NOT NULL
           AND replace(cip_code, '.', '') = replace(entries.cip_code, '.', '')
           AND credential_level::text = entries.credential_level
         ORDER BY title ASC
         LIMIT 1
     ) selProg ON TRUE
     LEFT JOIN LATERAL (
        SELECT year_10, year_10_method FROM earnings_against_courses_merged
         WHERE unitid = entries.unitid
           AND selProg.cip_code IS NOT NULL
           AND replace(cip_code, '.', '') = replace(selProg.cip_code, '.', '')
           AND year_10 IS NOT NULL
         ORDER BY grad_cohort DESC
         LIMIT 1
     ) progEarn ON TRUE
     ORDER BY entries.id ASC`,
    [userId],
  );

  const items = rows.map(async (row) => {
    const sat25 =
      toFloat(row.sat_low) ??
      (row.sat_p25_math != null && row.sat_p25_reading != null
        ? toFloat(row.sat_p25_math)! + toFloat(row.sat_p25_reading)!
        : null);
    const sat75 =
      toFloat(row.sat_high) ??
      (row.sat_p75_math != null && row.sat_p75_reading != null
        ? toFloat(row.sat_p75_math)! + toFloat(row.sat_p75_reading)!
        : null);

    const popularFields: {
      fieldName: string;
      percentage: number;
      programCount: number;
    }[] = Array.isArray(row.top_fields)
      ? row.top_fields
          .filter((f: { field_name?: string }) => f?.field_name)
          .map(
            (f: {
              field_name: string;
              percentage: unknown;
              program_count: unknown;
            }) => ({
              fieldName: f.field_name,
              percentage: toFloat(f.percentage) ?? 0,
              programCount: toNum(f.program_count) ?? 0,
            }),
          )
      : [];

    const degreeLevels: {
      level: string;
      totalPrograms: number;
      topTitles: string[];
    }[] = Array.isArray(row.degree_levels)
      ? row.degree_levels.map(
          (d: {
            level: string;
            total_programs: unknown;
            top_titles: unknown;
          }) => ({
            level: toStr(d.level) ?? "Other",
            totalPrograms: toNum(d.total_programs) ?? 0,
            topTitles: Array.isArray(d.top_titles)
              ? d.top_titles.filter(Boolean)
              : [],
          }),
        )
      : [];

    const selUnitid = toNum(row.unitid);
    const selCip = toStr(row.sel_program_cip);
    const selCredentialLevel = toNum(row.sel_program_credential_level);
    const selectedProgramEarnings =
      row.sel_program_title != null &&
      selUnitid != null &&
      selCip != null &&
      selCredentialLevel != null
        ? (await getEarningsForProgram(selUnitid, selCip, selCredentialLevel))
            .avg_salary
        : null;

    const details: SelectedItem = {
      unitid: toNum(row.unitid),
      name: row.name ?? null,
      location: toLocation(row.city, row.state),
      tuitionInState: toFloat(row.tuition_in_state),
      acceptanceRate: toFloat(row.admission_rate),
      addedAt: row.added_at ?? null,
      schoolUrl: normalizeUrl(row.school_url),
      schoolType: toStr(row.school_type),
      accreditor: toStr(row.accreditor),
      academics: {
        satRangeLow: sat25,
        satRangeHigh: sat75,
        graduationRate: toFloat(row.completion_rate),
      },
      cost: {
        tuitionOutState: toFloat(row.tuition_out_state),
        stickerPrice: toFloat(row.sticker_price),
        avgDebt: toFloat(row.avg_debt),
        debtIncomeRatio: toFloat(row.debt_income_ratio),
      },
      outcomes: {
        programEarnings:
          toFloat(row.sel_program_earnings) ?? toFloat(row.program_earnings),
        avgSalary:
          row.sel_program_title != null
            ? selectedProgramEarnings
            : toFloat(row.avg_salary),
        roi20Yr: toFloat(row.roi_20yr),
      },
      students: {
        size: toNum(row.student_size),
      },
      programs: {
        studentFacultyRatio: formatRatio(row.student_faculty_ratio),
        repaymentSuccess: toFloat(row.repayment_success),
        popularFields,
        degreeLevels,
        selectedProgram: row.sel_program_title
          ? {
              title: row.sel_program_title,
              cipCode: toStr(row.sel_program_cip),
              degreeLevelCategory: toStr(row.sel_program_degree_level),
              credentialLevel: toNum(row.sel_program_credential_level),
              earnings: selectedProgramEarnings,
            }
          : null,
      },
    };

    return {
      unitid: toNum(row.unitid) ?? 0,
      cipCode: row.entry_cip_code,
      credentialLevel: row.entry_credential_level,
      programName: row.entry_program_name,
      credentialTitle: row.entry_credential_title,
      details,
    };
  });

  return Promise.all(items);
}

/** Enriched compare-matrix rows in the SelectedItem shape (used by GET /matrix/details). */
async function getMatrixEnriched(userId: string): Promise<SelectedItem[]> {
  const rows = await getMatrixEnrichedRows(userId);
  return rows.map((r) => r.details);
}

/**
 * GET /compare/matrix/details
 * Enriched details for the caller's compare-matrix rows, in the same shape
 * as GET /compare/selected (tuition, acceptance rate, SAT range, cost,
 * outcomes, programs.selectedProgram). Unlike /compare/selected, every row's
 * selectedProgram is resolved from that row's OWN cipCode/credentialLevel in
 * this single call — no per-program ?program= round trip needed.
 */
router.get(
  "/matrix/details",
  verifyToken,
  async (req: AuthRequest, res: Response) => {
    try {
      const userId = await resolveUserId(req.userId as string);
      if (!userId) return res.status(404).json({ error: "User not found" });

      return res.json(await getMatrixEnriched(userId));
    } catch (error) {
      return sendInternalError(req, res, error, "compare");
    }
  },
);

interface ApiErrorBody {
  error: string;
  details?: string;
  code?: string;
}

/**
 * GET /compare/athletics?unitids=100654,100663,100706
 * Bulk variant of GET /colleges/:unitid/athletics for the college comparison
 * feature. Returns one profile per unitid, in the order requested. Unitids
 * with no athletic_summary row are silently omitted (not an error) so a
 * comparison set can mix schools with and without athletics data.
 *
 * Query params:
 *  - unitids: Required. Comma-separated list of unitids, max 4 (matches
 *             the existing comparison UI constraint).
 */
router.get(
  "/athletics",
  async (req: Request, res: Response<AthleticsProfile[] | ApiErrorBody>) => {
    try {
      const raw = toStr(req.query.unitids);
      if (!raw) {
        return res
          .status(400)
          .json({ error: "unitids query parameter is required" });
      }

      const unitids: number[] = [];
      const seen = new Set<number>();
      for (const part of raw.split(",")) {
        const n = toNum(part.trim());
        if (n === null || !Number.isInteger(n) || n <= 0 || seen.has(n))
          continue;
        seen.add(n);
        unitids.push(n);
      }

      if (unitids.length === 0) {
        return res
          .status(400)
          .json({ error: "unitids must contain at least one valid unitid" });
      }
      if (unitids.length > MAX_COMPARE_ATHLETICS) {
        return res.status(400).json({
          error: `A maximum of ${MAX_COMPARE_ATHLETICS} unitids can be compared at once`,
        });
      }

      const profiles = await Promise.all(
        unitids.map((id) => getAthleticsProfile(id)),
      );

      res.json(profiles.filter((p): p is AthleticsProfile => p !== null));
    } catch (error) {
      sendInternalError(req, res, error, "compare");
    }
  },
);

export default router;
