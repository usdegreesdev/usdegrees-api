// routes/schoollevelsearch/autocomplete.ts
// GET /schools/:unitid/programs/autocomplete?q=comp
//
// Returns up to 10 unique program titles from a specific school
// that match the search query (case-insensitive, min 2 chars).
// Uses trigram similarity for fuzzy matching — fast even on 200k+ rows.

import { Router, Request, Response } from "express";
import pool from "../../db/client";
import { AutocompleteRow, AutocompleteResponse } from "../../types/schoolPrograms";
import { sendInternalError } from "../../utils/apiError";

const router = Router({ mergeParams: true }); // mergeParams gives access to :unitid

router.get("/", async (req: Request, res: Response) => {
  const unitidParam = req.params.unitid;
  if (Array.isArray(unitidParam)) {
    return res.status(400).json({ error: "Invalid unitid parameter" });
  }
  const unitid = parseInt(unitidParam, 10);
  const q = (req.query.q as string | undefined)?.trim() ?? "";

  // ── Input validation ──────────────────────────────────────────────────────
  if (isNaN(unitid)) {
    return res.status(400).json({ error: "Invalid school id" });
  }
  if (q.length < 2) {
    return res.status(400).json({ error: "Query must be at least 2 characters" });
  }

  try {
    // Uses pg_trgm GIN index on programs.title for fast ILIKE
    // DISTINCT removes duplicate titles (same program, multiple credential levels)
    const sql = `
      SELECT DISTINCT title
      FROM   programs
      WHERE  unitid = $1
        AND  title ILIKE $2
      ORDER  BY title ASC
      LIMIT  10
    `;

    const { rows } = await pool.query<AutocompleteRow>(sql, [
      unitid,
      `%${q}%`,
    ]);

    const response: AutocompleteResponse = { programs: rows };
    return res.json(response);
  } catch (err) {
    return sendInternalError(req, res, err, "autocomplete");
  }
});

export default router;
