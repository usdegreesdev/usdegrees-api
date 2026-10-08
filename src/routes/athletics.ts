/**
 * athletics.ts
 * Express Router: GET /athletics/division-benchmarks
 *
 * Serves precomputed per-division averages (athletic_division_benchmarks),
 * refreshed by `npm run refresh:athletic-benchmarks` whenever EADA data is
 * re-imported. Cheap and cacheable — never scans athletic_summary directly.
 */

import { Router, Request, Response } from "express";
import pool from "../db/client";
import { ApiError } from "../types/athletics";
import { sendInternalError } from "../utils/apiError";

const router = Router();

interface DivisionBenchmark {
  division: string;
  surveyYear: string;
  avgAthletesTotal: number | null;
  avgAidPerAthlete: number | null;
  avgRecruitingExpense: number | null;
  avgRevenue: number | null;
  avgExpense: number | null;
}

function toNum(val: unknown): number | null {
  if (val === null || val === undefined) return null;
  const n = typeof val === "string" ? Number(val) : val;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

/**
 * GET /athletics/division-benchmarks
 * Returns per-division averages for every division on file.
 *
 * Query params:
 *  - year: Optional. Filter to a specific survey_year (defaults to all
 *          years present in the table).
 */
router.get(
  "/division-benchmarks",
  async (req: Request, res: Response<DivisionBenchmark[] | ApiError>) => {
    try {
      const year =
        typeof req.query.year === "string" ? req.query.year : null;

      const params: string[] = [];
      let whereClause = "";
      if (year) {
        params.push(year);
        whereClause = "WHERE survey_year = $1";
      }

      const sql = `
        SELECT division, survey_year, avg_athletes_total, avg_aid_per_athlete,
               avg_recruiting_expense, avg_revenue, avg_expense
        FROM athletic_division_benchmarks
        ${whereClause}
        ORDER BY division ASC
      `;

      const result = await pool.query(sql, params);

      const benchmarks: DivisionBenchmark[] = result.rows.map((row) => ({
        division: row.division,
        surveyYear: row.survey_year,
        avgAthletesTotal: toNum(row.avg_athletes_total),
        avgAidPerAthlete: toNum(row.avg_aid_per_athlete),
        avgRecruitingExpense: toNum(row.avg_recruiting_expense),
        avgRevenue: toNum(row.avg_revenue),
        avgExpense: toNum(row.avg_expense),
      }));

      res.json(benchmarks);
    } catch (error) {
      sendInternalError(req, res, error, "athletics");
    }
  },
);

export default router;
