// routes/schoollevelsearch/degreelevels.ts
// GET /schools/:unitid/programs/degrees?title=Computer%20Science
//
// Returns all available degree levels for a given program title
// within a specific school. No hardcoded values — purely DB-driven.
// Ordered by credential_level ASC (cert → associate → bachelor → master → doctoral).

import { Router, Request, Response } from "express";
import pool from "../../db/client";
import { DegreeLevelRow, DegreeLevelsResponse } from "../../types/schoolPrograms";
import { sendInternalError } from "../../utils/apiError";

const router = Router({ mergeParams: true });

router.get("/", async (req: Request, res: Response) => {
  const unitidParam = req.params.unitid;
  if (Array.isArray(unitidParam)) {
    return res.status(400).json({ error: "Invalid unitid parameter" });
  }
  const unitid = parseInt(unitidParam, 10);
  const title = (req.query.title as string | undefined)?.trim() ?? "";

  // ── Input validation ──────────────────────────────────────────────────────
  if (isNaN(unitid)) {
    return res.status(400).json({ error: "Invalid school id" });
  }
  if (!title) {
    return res.status(400).json({ error: "title query param is required" });
  }

  try {
    // Exact match on title (case-insensitive) scoped to this school.
    // DISTINCT ON removes duplicate (credential_title, credential_level) pairs.
    const sql = `
      SELECT DISTINCT
        credential_title,
        credential_level
      FROM   programs
      WHERE  unitid = $1
        AND  LOWER(title) = LOWER($2)
      ORDER  BY credential_level ASC
    `;

    const { rows } = await pool.query<DegreeLevelRow>(sql, [unitid, title]);

    if (rows.length === 0) {
      return res.status(404).json({
        error: "No degrees found for this program at this school",
      });
    }

    const response: DegreeLevelsResponse = { degrees: rows };
    return res.json(response);
  } catch (err) {
    return sendInternalError(req, res, err, "degreelevels");
  }
});

export default router;
