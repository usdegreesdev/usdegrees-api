import { Router, Request, Response } from "express";
import pool from "../db/client";
import { sitemapRateLimit } from "../middleware/rateLimit";

const router = Router();

/**
 * GET /sitemap/universities
 *
 * Sitemap feed: [{ unitid, slug, updated_at }] and nothing else. Same school
 * population the old sitemap got from /search (schools with at least one
 * program). `schools` has no slug or updated_at column today, so both are
 * null until one exists; the keys are kept so the contract is stable.
 */
router.get("/universities", sitemapRateLimit, async (_req: Request, res: Response) => {
  try {
    const { rows } = await pool.query<{ unitid: string | number }>(
      `SELECT s.unitid
         FROM schools s
        WHERE EXISTS (SELECT 1 FROM programs p WHERE p.unitid = s.unitid)
        ORDER BY s.unitid`,
    );
    res.set("Cache-Control", "public, max-age=3600");
    res.json(
      rows.map((r) => ({ unitid: Number(r.unitid), slug: null, updated_at: null })),
    );
  } catch (err) {
    console.error("[/sitemap/universities] Query error:", (err as Error).message);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
