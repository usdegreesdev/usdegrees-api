import { Router, Request, Response } from "express";
import pool from "../db/client";
import { SearchQueryParams, SearchResult } from "../types/search-details";
import { normalizeEarningsFillMethod } from "../types/earnings";
import { appendInFilter, catalogGuard, parseCatalogPaging, parseMultiValue } from "../utils/catalogPaging";

// ---------------------------------------------------------------------------
// Types & Interfaces
// ---------------------------------------------------------------------------

/**
* Shape of each row returned by the search query.
* Nullable fields come from LEFT JOINs and may be absent for some programs.
*/

/**
* Accepted query-string parameters for the search endpoint.
*/


// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const router = Router();

function safeNum(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
* GET /search
*
* Returns enriched program records joined across schools, admissions,
* completion, and earnings_against_courses_merged tables.
*
* Query params:
*  - credential_title  exact match on programs.credential_title
*  - state             exact match on schools.state
*  - title             case-insensitive partial match on programs.title
*/
router.get("/", ...catalogGuard, async (req: Request, res: Response) => {
  const paging = parseCatalogPaging(req);
  if (!paging.ok) {
    res.status(400).json({ error: paging.error });
    return;
  }
  const { title } = req.query as SearchQueryParams;
  // state / credential_title accept comma-separated lists (max 10 each);
  // a single value behaves exactly as before (`= $n`).
  const credentialTitles = parseMultiValue(req.query.credential_title, "credential_title");
  const states = parseMultiValue(req.query.state, "state");
  if (!credentialTitles.ok) {
    res.status(400).json({ error: credentialTitles.error });
    return;
  }
  if (!states.ok) {
    res.status(400).json({ error: states.error });
    return;
  }
  const params: (string | number)[] = [];
  let whereSql = "";
  whereSql += appendInFilter("p.credential_title", credentialTitles.values, params);
  whereSql += appendInFilter("s.state", states.values, params);

  // How many leading entries of `params` are actually referenced by
  // `whereSql` — the title-match block below pushes extra params afterward
  // (for the relevance ORDER BY only) that a query using just `whereSql`
  // must not receive, or Postgres rejects the bind as a param-count mismatch.
  let whereParamCount = params.length;

  let relevanceSelect = "0 AS relevance_score";
  let orderByClause = "ORDER BY p.title ASC";

  if (title) {
    const trimmedTitle = title.trim();
    if (trimmedTitle) {
      // Strip trailing punctuation like '.' so 'Accounting and Related Services.' matches 'Accounting and Related Services'
      const cleanTitle = trimmedTitle.replace(/[\.\s]+$/, '');
      const lowerQuery = cleanTitle.toLowerCase();

      // Common degree acronym aliases
      const acronyms: Record<string, string> = {
        cs: "computer science",
        rn: "nursing",
        mba: "business administration",
        it: "information technology",
        bsn: "nursing",
        ds: "data science",
        ee: "electrical engineering",
        me: "mechanical engineering",
      };

      const expandedAcronym = acronyms[lowerQuery];

      params.push(`%${cleanTitle}%`);
      const titleParamIdx = params.length;

      if (expandedAcronym) {
        params.push(`%${expandedAcronym}%`);
        const expandedParamIdx = params.length;
        whereSql += ` AND (LOWER(p.title) LIKE LOWER($${titleParamIdx}) OR LOWER(p.title) LIKE LOWER($${expandedParamIdx}))`;
        whereParamCount = params.length;

        params.push(lowerQuery);
        const rawExactIdx = params.length;
        params.push(`${lowerQuery}%`);
        const rawPrefixIdx = params.length;
        params.push(`% ${lowerQuery}%`);
        const rawWordIdx = params.length;

        params.push(expandedAcronym);
        const expExactIdx = params.length;
        params.push(`${expandedAcronym}%`);
        const expPrefixIdx = params.length;

        relevanceSelect = `(CASE
          WHEN LOWER(p.title) = $${rawExactIdx}::text OR LOWER(p.title) = $${expExactIdx}::text THEN 1
          WHEN LOWER(p.title) LIKE $${rawPrefixIdx}::text OR LOWER(p.title) LIKE $${expPrefixIdx}::text THEN 2
          WHEN LOWER(p.title) LIKE $${rawWordIdx}::text THEN 3
          WHEN LOWER(p.title) LIKE $${titleParamIdx}::text THEN 4
          ELSE 5
        END) AS relevance_score`;
        orderByClause = `ORDER BY relevance_score ASC, p.title ASC`;
      } else {
        whereSql += ` AND LOWER(p.title) LIKE LOWER($${titleParamIdx})`;
        whereParamCount = params.length;

        params.push(lowerQuery);
        const rawExactIdx = params.length;
        params.push(`${lowerQuery}%`);
        const rawPrefixIdx = params.length;
        params.push(`% ${lowerQuery}%`);
        const rawWordIdx = params.length;

        relevanceSelect = `(CASE
          WHEN LOWER(p.title) = $${rawExactIdx}::text THEN 1
          WHEN LOWER(p.title) LIKE $${rawPrefixIdx}::text THEN 2
          WHEN LOWER(p.title) LIKE $${rawWordIdx}::text THEN 3
          WHEN LOWER(p.title) LIKE $${titleParamIdx}::text THEN 4
          ELSE 5
        END) AS relevance_score`;
        orderByClause = `ORDER BY relevance_score ASC, p.title ASC`;
      }
    }
  }

  // limit/page are validated and capped by parseCatalogPaging (max 20 anon /
  // 50 signed-in rows, max page 25) - no request can return an unbounded set.
  // The response shape still depends on whether the caller sent either param.
  const isPaginatedRequest = req.query.limit != null || req.query.page != null;
  const { limit: limitVal, offset: offsetVal } = paging;

  const sql = `
  SELECT DISTINCT
    -- programs
    p.title                     AS program_title,
    p.cip_code                  AS cip_code,
    p.credential_title          AS credential_title,
    p.credential_level          AS credential_level,
    p.school_type               AS school_type,

    -- schools
    s.name                      AS school_name,
    s.city                      AS city,
    s.state                     AS state,
    s.school_url                AS school_url,
    s.unitid                    AS unitid,
    s.is_active                 AS is_active,
    s.accreditor                AS accreditor,

    -- admissions (nullable)
    ad.admission_rate           AS admission_rate,
    ad.school_min_range         AS school_min_range,
    ad.school_max_range         AS school_max_range,

    -- completion (nullable)
    co.emp_factor               AS emp_factor,

    -- earnings
    ec.year_5                   AS earnings_year_5,
    ec.year_5_method            AS earnings_year_5_method,
    ec.grad_cohort               AS earnings_year_5_cohort,

    -- roi (nullable)
    roi_data.roi_20yr          AS roi_20yr,

    -- cost (nullable) — single source for the search results' sticker price,
    -- so the client never needs a separate per-school /tuition/:unitid call.
    cost_data.tuition_in_state   AS tuition_in_state,
    cost_data.sticker_price_by_api AS sticker_price_by_api,
    cost_data.booksupply         AS booksupply,
    cost_data.roomboard_oncampus AS roomboard_oncampus,
    cost_data.otherexpense_oncampus AS otherexpense_oncampus,
    (cost_data.tuition_in_state + cost_data.booksupply + cost_data.roomboard_oncampus + cost_data.otherexpense_oncampus) AS sticker_price,
    ${relevanceSelect}

  FROM programs p

  JOIN schools s ON p.unitid = s.unitid
  LEFT JOIN admissions ad ON p.unitid = ad.unitid
  LEFT JOIN completion co ON p.unitid = co.unitid
  LEFT JOIN LATERAL (
    SELECT tuition_in_state, sticker_price_by_api, booksupply, roomboard_oncampus, otherexpense_oncampus
    FROM costs
    WHERE unitid = p.unitid
    LIMIT 1
  ) cost_data ON TRUE
  LEFT JOIN LATERAL (
    SELECT year_5, year_5_method, grad_cohort
    FROM earnings_against_courses_merged e
    WHERE e.unitid = p.unitid
      AND replace(e.cip_code, '.', '') = p.cip_code
      AND e.credential_level = p.credential_level
    ORDER BY
      CASE COALESCE(e.year_5_method, 'user_reported')
        WHEN 'user_reported' THEN 0
        WHEN 'interpolated' THEN 1
        WHEN 'extrapolated' THEN 1
        WHEN 'low_confidence' THEN 2
        ELSE 3
      END,
      e.grad_cohort DESC
    LIMIT 1
  ) ec ON TRUE
  LEFT JOIN LATERAL (
    SELECT roi_20yr
    FROM roi
    WHERE unitid = p.unitid
    ORDER BY CASE
      WHEN credential_level = p.credential_level THEN 0
      ELSE 1
    END
    LIMIT 1
  ) roi_data ON TRUE
  WHERE 1=1 ${whereSql}
  ${orderByClause} LIMIT ${limitVal} OFFSET ${offsetVal}
  `;

  // Total number of programs matching the filters, ignoring LIMIT/OFFSET —
  // only needed when the caller actually paginates (search page), so the
  // frontend can compute page count. The LEFT JOIN LATERALs above are
  // one-row-in/one-row-out (ON TRUE, LIMIT 1) so they never change row
  // count; only programs/schools affect how many rows match.
  const countSql = `
  SELECT COUNT(*) AS total
  FROM programs p
  JOIN schools s ON p.unitid = s.unitid
  WHERE 1=1 ${whereSql}
  `;

  // ---------------------------------------------------------------------------
  // Execute
  // ---------------------------------------------------------------------------
  try {
    const [{ rows }, countRows] = await Promise.all([
      pool.query<SearchResult>(sql, params),
      isPaginatedRequest
        ? pool
            .query<{ total: string }>(countSql, params.slice(0, whereParamCount))
            .then((r) => r.rows)
        : Promise.resolve(null),
    ]);

    const shapedResults = rows.map((row) => {
      const earningsYear5Method = normalizeEarningsFillMethod(row.earnings_year_5_method);
      // Explicit field allowlist - never spread the raw row, so internal
      // columns (e.g. relevance_score) can't leak if the SELECT grows.
      return {
        program_title: row.program_title,
        cip_code: row.cip_code,
        credential_title: row.credential_title,
        credential_level: row.credential_level,
        school_type: row.school_type,
        school_name: row.school_name,
        city: row.city,
        state: row.state,
        school_url: row.school_url,
        is_active: row.is_active,
        accreditor: row.accreditor,
        unitid: safeNum(row.unitid),
        admission_rate: safeNum(row.admission_rate),
        school_min_range: safeNum(row.school_min_range),
        school_max_range: safeNum(row.school_max_range),
        emp_factor: safeNum(row.emp_factor),
        earnings_year_5: safeNum(row.earnings_year_5),
        earnings_year_5_method: earningsYear5Method,
        earnings_year_5_cohort: row.earnings_year_5_cohort ?? null,
        earnings_year_5_basis_is_estimated: earningsYear5Method !== "user_reported",
        roi_20yr: safeNum(row.roi_20yr),
        tuition_in_state: safeNum(row.tuition_in_state),
        sticker_price_by_api: safeNum(row.sticker_price_by_api),
        booksupply: safeNum(row.booksupply),
        roomboard_oncampus: safeNum(row.roomboard_oncampus),
        otherexpense_oncampus: safeNum(row.otherexpense_oncampus),
        sticker_price: safeNum(row.sticker_price),
      };
    });

    // Non-paginated callers (accreditor lookups, sitemap, compare-page
    // pickers, etc.) keep receiving the plain array they've always gotten.
    // Only the paginated search page needs — and gets — the total count.
    if (!isPaginatedRequest) {
      res.json(shapedResults);
      return;
    }

    res.json({
      results: shapedResults,
      total: safeNum(countRows?.[0]?.total) ?? 0,
    });
  } catch (err) {
    console.error("[/search] Query error:", (err as Error).message);
    res.status(500).json({
      error: "Internal server error",
      details: (err as Error).message,
    });
  }
});

export default router;
