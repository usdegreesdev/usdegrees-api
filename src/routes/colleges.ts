/**
 * colleges.ts
 * Express Router: GET /colleges
 *
 * Returns a paginated list of all colleges with optional filtering by search term.
 *
 * Features:
 *  - Pagination (default 20 per page)
 *  - Search filtering (by school name, city, or state)
 *  - Sorted by school name
 *
 * Query params:
 *  - search: Filter colleges by name, city, or state (case-insensitive)
 *  - page: Page number (default 1)
 *  - limit: Items per page (default 20, max 20 anonymous / 50 signed-in)
 *  - page: max 25
 *
 * Example requests:
 *  GET /colleges                           → First 20 colleges
 *  GET /colleges?page=2&limit=20           → Next 20 colleges
 *  GET /colleges?search=Harvard            → Colleges matching "Harvard"
 *  GET /colleges?search=CA&limit=50        → Colleges in CA (up to 50 per page)
 */

import { Router, Request, Response } from "express";
import pool from "../db/client";
import { College, CollegesResponse, ApiError } from "../types/colleges";
import { getAthleticsProfile } from "../services/athletics.service";
import { AthleticsProfile } from "../types/athletics";
import { errorDetails } from "../utils/errors";
import {
  CATALOG_CAPS,
  catalogGuard,
  parseCatalogPaging,
} from "../utils/catalogPaging";

const router = Router();

/**
 * Helper to coerce values to number | null
 */
function toNum(val: unknown): number | null {
  if (val === null || val === undefined) return null;
  const n = typeof val === "string" ? parseInt(val, 10) : Number(val);
  return isNaN(n) ? null : n;
}

/**
 * Helper to coerce values to string | null
 */
function toStr(val: unknown): string | null {
  if (val === null || val === undefined) return null;
  const s = String(val).trim();
  return s.length === 0 ? null : s;
}

/**
 * GET /colleges
 * Returns paginated list of colleges with optional search filtering
 */
router.get(
  "/",
  ...catalogGuard,
  async (req: Request, res: Response<CollegesResponse | ApiError>) => {
    try {
      // Extract query parameters
      const paging = parseCatalogPaging(req);
      if (!paging.ok) {
        return res.status(400).json({ error: paging.error });
      }
      const { page, limit, offset } = paging;
      const search = toStr(req.query.search);

      // ─────────────────────────────────────────────
      // Build dynamic WHERE clause for search
      // ─────────────────────────────────────────────
      let whereClause = "";
      const params: (string | number)[] = [];

      if (search) {
        const searchTerm = `%${search}%`;
        whereClause = `
        WHERE 
          LOWER(s.name) LIKE LOWER($1)
          OR LOWER(s.city) LIKE LOWER($1)
          OR LOWER(s.state) LIKE LOWER($1)
      `;
        params.push(searchTerm);
      }

      // ─────────────────────────────────────────────
      // Query: Total count of matching colleges
      // ─────────────────────────────────────────────
      const countSql = `SELECT COUNT(*) as total FROM schools s ${whereClause}`;
      const countResult = await pool.query(countSql, params);
      const total = parseInt(countResult.rows[0].total, 10);

      // ─────────────────────────────────────────────
      // Query: Get paginated results
      // ─────────────────────────────────────────────
      const paramIndex = params.length + 1;
      const dataSql = `
      SELECT
        s.unitid,
        s.name AS school_name,
        s.city,
        s.state,
        s.school_url,
        p.school_type
      FROM schools s
      LEFT JOIN LATERAL (
        SELECT DISTINCT school_type
        FROM programs
        WHERE unitid = s.unitid
        LIMIT 1
      ) p ON TRUE
      ${whereClause}
      ORDER BY s.name ASC
      LIMIT $${paramIndex}
      OFFSET $${paramIndex + 1}
    `;

      const dataParams = [...params, limit, offset];
      const dataResult = await pool.query(dataSql, dataParams);

      // ─────────────────────────────────────────────
      // Format response
      // ─────────────────────────────────────────────
      const colleges: College[] = dataResult.rows.map((row) => ({
        unitid: toNum(row.unitid) ?? 0,
        school_name: toStr(row.school_name) ?? "Unknown",
        city: toStr(row.city),
        state: toStr(row.state),
        school_type: toStr(row.school_type),
        school_url: toStr(row.school_url),
      }));

      const hasMore = offset + colleges.length < total;

      res.json({
        data: colleges,
        total,
        page,
        limit,
        hasMore,
      });
    } catch (error) {
      console.error("Error fetching colleges:", error);
      res.status(500).json({
        error: "Failed to fetch colleges",
        details: errorDetails(error),
      });
    }
  },
);

/**
 * GET /colleges/search
 * Search colleges by name (case-insensitive partial match)
 *
 * Query params:
 *  - query: Search keyword (required) - matches against school name
 *  - limit: Maximum results to return (default 20, max 20 anonymous / 50 signed-in)
 *
 * Example requests:
 *  GET /colleges/search?query=stan&limit=5       → Colleges with "stan" in name
 *  GET /colleges/search?query=harvard              → Colleges with "harvard" in name
 *
 * Response: Direct array of college objects (not paginated)
 */
router.get(
  "/search",
  ...catalogGuard,
  async (req: Request, res: Response<College[] | ApiError>) => {
    try {
      // Extract query parameters
      const query = toStr(req.query.query);
      const paging = parseCatalogPaging(req);
      if (!paging.ok) {
        return res.status(400).json({ error: paging.error });
      }
      // Autocomplete-style: result count only; a page param is still
      // validated (and capped) but unused.
      const limit = paging.limit;

      // Validate required parameter
      if (!query || query.length < CATALOG_CAPS.minTermLength) {
        return res.status(400).json({
          error: `query must be at least ${CATALOG_CAPS.minTermLength} characters`,
        });
      }

      // ─────────────────────────────────────────────
      // Query: Search colleges by school name
      // ─────────────────────────────────────────────
      const searchTerm = `%${query}%`;
      const sql = `
      SELECT
        s.unitid,
        s.name AS school_name,
        s.city,
        s.state,
        s.school_url,
        p.school_type
      FROM schools s
      LEFT JOIN LATERAL (
        SELECT DISTINCT school_type
        FROM programs
        WHERE unitid = s.unitid
        LIMIT 1
      ) p ON TRUE
      WHERE LOWER(s.name) LIKE LOWER($1)
      ORDER BY s.name ASC
      LIMIT $2
    `;

      const result = await pool.query(sql, [searchTerm, limit]);

      // ─────────────────────────────────────────────
      // Format response
      // ─────────────────────────────────────────────
      const colleges: College[] = result.rows.map((row) => ({
        unitid: toNum(row.unitid) ?? 0,
        school_name: toStr(row.school_name) ?? "Unknown",
        city: toStr(row.city),
        state: toStr(row.state),
        school_type: toStr(row.school_type),
        school_url: toStr(row.school_url),
      }));

      res.json(colleges);
    } catch (error) {
      console.error("Error searching colleges:", error);
      res.status(500).json({
        error: "Failed to search colleges",
        details: errorDetails(error),
      });
    }
  },
);

/**
 * GET /colleges/:unitid
 * Returns details for a single college
 */
router.get(
  "/:unitid",
  async (req: Request, res: Response<College | ApiError>) => {
    try {
      const { unitid } = req.params;
      const id = toNum(unitid);

      if (!id) {
        return res.status(400).json({
          error: "Invalid college ID",
        });
      }

      const sql = `
      SELECT
        s.unitid,
        s.name AS school_name,
        s.city,
        s.state,
        s.school_url,
        p.school_type
      FROM schools s
      LEFT JOIN LATERAL (
        SELECT DISTINCT school_type
        FROM programs
        WHERE unitid = s.unitid
        LIMIT 1
      ) p ON TRUE
      WHERE s.unitid = $1
    `;

      const result = await pool.query(sql, [id]);

      if (result.rows.length === 0) {
        return res.status(404).json({
          error: "College not found",
        });
      }

      const row = result.rows[0];
      const college: College = {
        unitid: toNum(row.unitid) ?? 0,
        school_name: toStr(row.school_name) ?? "Unknown",
        city: toStr(row.city),
        state: toStr(row.state),
        school_type: toStr(row.school_type),
        school_url: toStr(row.school_url),
      };

      res.json(college);
    } catch (error) {
      console.error("Error fetching college:", error);
      res.status(500).json({
        error: "Failed to fetch college",
        details: errorDetails(error),
      });
    }
  },
);

/**
 * GET /colleges/:unitid/athletics
 * Returns the combined athletics disclosure profile (EADA data) for a
 * single school: summary financials, roster breakdown, division benchmark,
 * and the pre-written summary paragraph.
 *
 * Query params:
 *  - year: Optional. Pin to a specific survey_year. Defaults to the most
 *          recent survey_year on file for the unitid.
 *
 * 404 if the unitid has no athletic_summary row. Schools with no
 * athletic_sports rows still return 200 with roster: [] and
 * hasRosterData: false rather than erroring (~500 of 1,954 schools).
 */
router.get(
  "/:unitid/athletics",
  async (req: Request, res: Response<AthleticsProfile | ApiError>) => {
    try {
      const id = toNum(req.params.unitid);
      if (!id) {
        return res.status(400).json({ error: "Invalid college ID" });
      }

      const year = toStr(req.query.year) ?? undefined;
      const profile = await getAthleticsProfile(id, year);

      if (!profile) {
        return res.status(404).json({
          error: "Athletics data not found for this college",
        });
      }

      res.json(profile);
    } catch (error) {
      console.error("Error fetching athletics profile:", error);
      res.status(500).json({
        error: "Failed to fetch athletics profile",
        details: errorDetails(error),
      });
    }
  },
);

export default router;
