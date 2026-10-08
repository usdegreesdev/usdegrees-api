import { Router, Request, Response } from "express";
import pool from "../db/client";
import { sendInternalError } from "../utils/apiError";
import {
  CATALOG_CAPS,
  catalogGuard,
  parseCatalogPaging,
} from "../utils/catalogPaging";

/**
 * Lookup endpoints for the compare bar. Both sit behind the same
 * optionalAuth + catalog rate limiter as /search.
 */
const router = Router();

function oneString(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  return t.length > 0 ? t : null;
}

/**
 * GET /catalog/programs-by-credential?credential_title=
 *
 * Distinct (program_title, cip_code) for one credential level, no
 * pagination. Bounded by distinct CIP x credential - a lookup table, not the
 * catalog (largest level today: 390 rows).
 */
router.get("/programs-by-credential", ...catalogGuard, async (req: Request, res: Response) => {
  const credentialTitle = oneString(req.query.credential_title);
  if (!credentialTitle) {
    res.status(400).json({ error: "credential_title is required" });
    return;
  }
  try {
    const { rows } = await pool.query<{ program_title: string; cip_code: string }>(
      `SELECT DISTINCT p.title AS program_title, p.cip_code AS cip_code
         FROM programs p
         JOIN schools s ON p.unitid = s.unitid
        WHERE p.credential_title = $1
        ORDER BY p.title ASC, p.cip_code ASC`,
      [credentialTitle],
    );
    // Reference data identical for every caller; overrides the tier header.
    res.set("Cache-Control", "public, max-age=3600");
    res.json(rows);
  } catch (err) {
    sendInternalError(req, res, err, "/catalog/programs-by-credential");
  }
});

/**
 * GET /catalog/schools-for-program?cip_code=&credential_title=&q=&page=&limit=
 */
router.get("/schools-for-program", ...catalogGuard, async (req: Request, res: Response) => {
  const cipCode = oneString(req.query.cip_code);
  const credentialTitle = oneString(req.query.credential_title);
  if (!cipCode || !credentialTitle) {
    res.status(400).json({ error: "cip_code and credential_title are required" });
    return;
  }

  let q: string | null = null;
  if (req.query.q !== undefined) {
    q = oneString(req.query.q);
    if (!q || q.length < CATALOG_CAPS.minTermLength) {
      res.status(400).json({ error: `q must be at least ${CATALOG_CAPS.minTermLength} characters` });
      return;
    }
  }

  const paging = parseCatalogPaging(req);
  if (!paging.ok) {
    res.status(400).json({ error: paging.error });
    return;
  }

  const params: (string | number)[] = [cipCode, credentialTitle];
  let nameSql = "";
  if (q) {
    // Escape LIKE wildcards so q is matched literally.
    params.push(`%${q.replace(/[\\%_]/g, "\\$&")}%`);
    nameSql = ` AND s.name ILIKE $${params.length}`;
  }
  const fromWhere = `
      FROM schools s
     WHERE s.unitid IN (
             SELECT p.unitid FROM programs p
              WHERE p.cip_code = $1 AND p.credential_title = $2
           )${nameSql}`;

  try {
    const [data, count] = await Promise.all([
      pool.query(
        `SELECT s.unitid, s.name AS school_name, s.city, s.state ${fromWhere}
          ORDER BY s.name ASC, s.unitid ASC
          LIMIT ${paging.limit} OFFSET ${paging.offset}`,
        params,
      ),
      pool.query<{ total: string }>(`SELECT COUNT(*) AS total ${fromWhere}`, params),
    ]);
    res.json({
      results: data.rows.map((r) => ({
        unitid: Number(r.unitid),
        school_name: r.school_name,
        city: r.city ?? null,
        state: r.state ?? null,
      })),
      total: Number(count.rows[0]?.total ?? 0),
    });
  } catch (err) {
    sendInternalError(req, res, err, "/catalog/schools-for-program");
  }
});

export default router;
