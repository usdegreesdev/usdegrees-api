// routes/schoollevelsearch/searchPrograms.ts
// GET /schools/:unitid/programs/search?title=Computer%20Science&credential_title=Bachelor's%20Degree
//
// Returns complete program details for a specific school + program + degree level.
// Joins: schools, admissions, completion, earnings_against_courses_merged (most recent cohort).

import { Router, Request, Response } from "express";
import pool from "../../db/client";
import { ProgramSearchRow, ProgramSearchResponse } from "../../types/schoolPrograms";
import { normalizeEarningsFillMethod } from "../../types/earnings";
import { sendInternalError } from "../../utils/apiError";

const router = Router({ mergeParams: true });

router.get("/", async (req: Request, res: Response) => {
  const unitidParam = req.params.unitid;
  if (Array.isArray(unitidParam)) {
    return res.status(400).json({ error: "Invalid unitid parameter" });
  }
  const unitid = parseInt(unitidParam, 10);
  const title = (req.query.title as string | undefined)?.trim() ?? "";
  const credential_title = (req.query.credential_title as string | undefined)?.trim() ?? "";

  // ── Input validation ──────────────────────────────────────────────────────
  if (isNaN(unitid)) {
    return res.status(400).json({ error: "Invalid school id" });
  }
  if (!title) {
    return res.status(400).json({ error: "title query param is required" });
  }
  if (!credential_title) {
    return res.status(400).json({ error: "credential_title query param is required" });
  }

  try {
    // earnings_against_courses_merged has multiple rows per program (one per grad_cohort).
    // LATERAL JOIN picks the single most recent cohort row for year_5 salary.
    // Rollback: swap earnings_against_courses_merged -> earnings_against_courses
    // and drop year_5_method if the merged data needs to be reverted.
    const sql = `
      SELECT
        -- ── School ──────────────────────────────────────────────────
        s.name                            AS school_name,
        s.city,
        s.state,

        -- ── Program ─────────────────────────────────────────────────
        p.title                           AS program_title,
        p.cip_code,
        p.credential_title,
        p.credential_level,
        p.school_type,

        -- ── Admissions (college-level) ───────────────────────────────
        adm.admission_rate,

        -- ── Employment (college-level) ───────────────────────────────
        comp.emp_factor,

        -- ── Earnings: year_5 from most recent cohort ─────────────────
        eac.year_5,
        eac.year_5_method

      FROM programs p

      JOIN schools s
        ON  s.unitid = p.unitid

      LEFT JOIN admissions adm
        ON  adm.unitid = p.unitid

      LEFT JOIN completion comp
        ON  comp.unitid = p.unitid

      -- Pick the most recent cohort for this program's cip_code + credential_level
      LEFT JOIN LATERAL (
        SELECT year_5, year_5_method
        FROM   earnings_against_courses_merged
        WHERE  unitid           = p.unitid
          AND  cip_code         = p.cip_code
          AND  credential_level = p.credential_level
        ORDER  BY grad_cohort DESC
        LIMIT  1
      ) eac ON TRUE

      WHERE p.unitid           = $1
        AND LOWER(p.title)     = LOWER($2)
        AND LOWER(p.credential_title) = LOWER($3)

      LIMIT 1
    `;

    const { rows } = await pool.query<ProgramSearchRow>(sql, [
      unitid,
      title,
      credential_title,
    ]);

    if (rows.length === 0) {
      return res.status(404).json({ error: "Program not found" });
    }

    const r = rows[0];

    const response: ProgramSearchResponse = {
      school: {
        name: r.school_name,
        city: r.city,
        state: r.state,
      },
      program: {
        title: r.program_title,
        cip_code: r.cip_code,
        credential_title: r.credential_title,
        credential_level: r.credential_level,
        school_type: r.school_type ?? null,
      },
      admissions: {
        // Stored as decimal (0.04) — return as-is; frontend can format to "4%"
        admission_rate: r.admission_rate != null
          ? parseFloat(Number(r.admission_rate).toFixed(4))
          : null,
      },
      employment: {
        emp_factor: r.emp_factor != null
          ? parseFloat(Number(r.emp_factor).toFixed(1))
          : null,
      },
      earnings: {
        year_5: r.year_5 != null ? Math.round(Number(r.year_5)) : null,
        year_5_method: normalizeEarningsFillMethod(r.year_5_method),
      },
    };

    return res.json(response);
  } catch (err) {
    return sendInternalError(req, res, err, "searchPrograms");
  }
});

export default router;
