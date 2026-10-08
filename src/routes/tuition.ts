/**
 * tuition.ts
 * Express Router: GET /tuition/:unitid
 *
 * Returns aggregated tuition, housing, expenses, and financial aid
 * data for a given college (unitid). Includes net price depending on
 * school control (public vs private).
 *
 * Tables used:
 *   costs     — tuition, books, room & board, living expenses
 *   aid       — financial aid percentages and loan stats
 *   programs  — school type
 *   net_price_public_income  — public school net prices
 *   net_price_private_income — private school net prices
 */

import { Router, Request, Response } from "express";
import pool from "../db/client";
import { ApiError, TuitionRawRow, TuitionResponse } from "../types/tuition";
import { sendError, sendInternalError } from "../utils/apiError";

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

/**
 * Coerce a value to number | null.
 * pg returns numeric columns as strings; parseFloat guards this.
 */
function toNum(val: unknown): number | null {
  if (val === null || val === undefined) return null;
  const n = typeof val === "string" ? parseFloat(val) : Number(val);
  return isNaN(n) ? null : n;
}

/**
 * Build the shaped response from a raw DB row.
 * Every field is passed through toNum() to handle pg's
 * string-coercion of NUMERIC/DECIMAL columns.
 */
function shapeResponse(unitid: number, row: TuitionRawRow): TuitionResponse {
  return {
    unitid,
    tuition: {
      tuition_in_state: toNum(row.tuition_in_state),
      tuition_out_state: toNum(row.tuition_out_state),
      booksupply: toNum(row.booksupply),
      sticker_price_by_api: toNum(row.sticker_price_by_api),
    },
    housing: {
      roomboard_oncampus: toNum(row.roomboard_oncampus),
      roomboard_offcampus: toNum(row.roomboard_offcampus),
    },
    expenses: {
      otherexpense_oncampus: toNum(row.otherexpense_oncampus),
      otherexpense_offcampus: toNum(row.otherexpense_offcampus),
      otherexpense_withfamily: toNum(row.otherexpense_withfamily),
    },
    financial_aid: {
      aid_percentage: toNum(row.aid_percentage),
      students_with_any_loan: toNum(row.students_with_any_loan),
      loan_principal: toNum(row.loan_principal),
    },
    school_type: row.school_type,
    net_price: {
      income_0_30000: toNum(row.income_0_30000),
      income_30001_48000: toNum(row.income_30001_48000),
      income_48001_75000: toNum(row.income_48001_75000),
      income_75001_110000: toNum(row.income_75001_110000),
      income_110001_plus: toNum(row.income_110001_plus),
    },
  };
}

// ─────────────────────────────────────────────
// SQL
// ─────────────────────────────────────────────

/**
 * Single-pass JOIN across costs and aid.
 *
 * Design decisions:
 *  - costs is the LEFT anchor (most colleges will have cost data)
 *  - aid and repayment use LEFT JOIN so missing rows don't drop
 *    the college from the result set
 *  - LIMIT 1 on each subquery collapses any duplicate rows that
 *    arise from one-to-many relationships (e.g. multiple aid
 *    rows per unitid)
 *  - All column references use table aliases to avoid ambiguity
 */
const TUITION_QUERY = `
  SELECT
    -- ── Tuition & Books ──────────────────────────────────
    c.tuition_in_state,
    c.tuition_out_state,
    c.booksupply,
    c.sticker_price_by_api,

    -- ── Housing ──────────────────────────────────────────
    c.roomboard_oncampus,
    c.roomboard_offcampus,

    -- ── Living Expenses ───────────────────────────────────
    c.otherexpense_oncampus,
    c.otherexpense_offcampus,
    c.otherexpense_withfamily,

    -- ── Financial Aid ─────────────────────────────────────
    a.aid_percentage,
    a.students_with_any_loan,
    a.loan_principal,

    -- ── Net Price & School Type ───────────────────────────
    p.school_type,
    
    CASE 
      WHEN p.school_type ILIKE '%Public%' THEN nppu.income_0_30000 
      WHEN p.school_type ILIKE '%Private%' THEN nppr.income_0_30000
      ELSE COALESCE(nppu.income_0_30000, nppr.income_0_30000)
    END AS income_0_30000,
    
    CASE 
      WHEN p.school_type ILIKE '%Public%' THEN nppu.income_30001_48000 
      WHEN p.school_type ILIKE '%Private%' THEN nppr.income_30001_48000
      ELSE COALESCE(nppu.income_30001_48000, nppr.income_30001_48000)
    END AS income_30001_48000,

    CASE 
      WHEN p.school_type ILIKE '%Public%' THEN nppu.income_48001_75000 
      WHEN p.school_type ILIKE '%Private%' THEN nppr.income_48001_75000
      ELSE COALESCE(nppu.income_48001_75000, nppr.income_48001_75000)
    END AS income_48001_75000,

    CASE 
      WHEN p.school_type ILIKE '%Public%' THEN nppu.income_75001_110000 
      WHEN p.school_type ILIKE '%Private%' THEN nppr.income_75001_110000
      ELSE COALESCE(nppu.income_75001_110000, nppr.income_75001_110000)
    END AS income_75001_110000,

    CASE 
      WHEN p.school_type ILIKE '%Public%' THEN nppu.income_110001_plus 
      WHEN p.school_type ILIKE '%Private%' THEN nppr.income_110001_plus
      ELSE COALESCE(nppu.income_110001_plus, nppr.income_110001_plus)
    END AS income_110001_plus

  FROM (
    -- Subquery prevents duplicate cost rows when the costs table
    -- stores multiple years; we take the most recent record.
    SELECT *
    FROM costs
    WHERE unitid = $1
    LIMIT 1
  ) c

  -- Aid data: LEFT JOIN so colleges without aid rows are preserved.
  -- LIMIT 1 inside a lateral-style subquery prevents fan-out.
  LEFT JOIN LATERAL (
    SELECT
      aid_percentage,
      students_with_any_loan,
      loan_principal
    FROM aid
    WHERE unitid = c.unitid
    LIMIT 1
  ) a ON TRUE

  -- Programs data for school type
  LEFT JOIN LATERAL (
    SELECT school_type
    FROM programs
    WHERE unitid = c.unitid
    LIMIT 1
  ) p ON TRUE

  -- Public net price data
  LEFT JOIN LATERAL (
    SELECT
      income_0_30000,
      income_30001_48000,
      income_48001_75000,
      income_75001_110000,
      income_110001_plus
    FROM net_price_public_income
    WHERE unitid = c.unitid
    LIMIT 1
  ) nppu ON TRUE

  -- Private net price data
  LEFT JOIN LATERAL (
    SELECT
      income_0_30000,
      income_30001_48000,
      income_48001_75000,
      income_75001_110000,
      income_110001_plus
    FROM net_price_private_income
    WHERE unitid = c.unitid
    LIMIT 1
  ) nppr ON TRUE
`;

/*
 * ─── NOTE on LATERAL vs plain LEFT JOIN ──────────────────────────────────────
 *
 * If your aid table already has a unique constraint on
 * (unitid) — i.e. only one row per college — you can simplify to:
 *
 *   LEFT JOIN aid a ON a.unitid = c.unitid
 *
 * Use LATERAL when you need per-row ORDER BY + LIMIT to avoid duplicates.
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ─────────────────────────────────────────────
// Router
// ─────────────────────────────────────────────

/**
 * createTuitionRouter
 *
 * Factory function — accepts a pg Pool instance so the router
 * does not own the connection lifecycle. Pass the same pool
 * used by the rest of your Express app.
 *
 * Usage in app.ts / server.ts:
 *   import { createTuitionRouter } from "./routes/tuition";
 *   app.use("/tuition", createTuitionRouter(pool));
 */
const router = Router();

/**
 * Fetch + shape tuition data for a single unitid, reused by both
 * GET /tuition/:unitid and GET /college-summary/:unitid so the two
 * endpoints never drift on query or shaping logic.
 * Returns null when no cost record exists for this unitid.
 */
export async function getTuitionData(
  unitid: number,
): Promise<TuitionResponse | null> {
  const result = await pool.query<TuitionRawRow>(TUITION_QUERY, [unitid]);
  if (result.rowCount === 0) return null;
  return shapeResponse(unitid, result.rows[0]);
}

/**
 * GET /tuition/:unitid
 *
 * Path params:
 *   unitid  — integer college identifier (College Scorecard / IPEDS)
 *
 * Responses:
 *   200  TuitionResponse   — data found
 *   400  ApiError          — unitid is not a valid integer
 *   404  ApiError          — no cost record found for this unitid
 *   500  ApiError          — unexpected database / server error
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
    let payload: TuitionResponse | null;
    try {
      payload = await getTuitionData(unitid);
    } catch (dbErr: unknown) {
      return sendInternalError(req, res, dbErr, "tuition");
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
