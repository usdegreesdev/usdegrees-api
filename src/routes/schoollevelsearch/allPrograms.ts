// routes/schoollevelsearch/allPrograms.ts
// GET /schools/:unitid/programs?q=comp&level=Undergraduate&credential_title=Bachelor's%20Degree&limit=20
//
// Powers the "Search All Programs" section on the university page.
// With no q, returns the first `limit` programs for the school (default result set).
// With q, filters by title ILIKE. With level, filters by degree_level_category.
// With credential_title, filters by exact credential_title match.

import { Router, Request, Response } from "express";
import pool from "../../db/client";
import { AllProgramsRow, AllProgramsResponse } from "../../types/schoolPrograms";
import { sendInternalError } from "../../utils/apiError";

const router = Router({ mergeParams: true });

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 20;

router.get("/", async (req: Request, res: Response) => {
  const unitidParam = req.params.unitid;
  if (Array.isArray(unitidParam)) {
    return res.status(400).json({ error: "Invalid unitid parameter" });
  }
  const unitid = parseInt(unitidParam, 10);
  const q = (req.query.q as string | undefined)?.trim() ?? "";
  const level = (req.query.level as string | undefined)?.trim() ?? "";
  const credentialTitle = (req.query.credential_title as string | undefined)?.trim() ?? "";

  const limitParam = parseInt((req.query.limit as string | undefined) ?? "", 10);
  const limit = Number.isFinite(limitParam) && limitParam > 0
    ? Math.min(limitParam, MAX_LIMIT)
    : DEFAULT_LIMIT;

  if (isNaN(unitid)) {
    return res.status(400).json({ error: "Invalid school id" });
  }

  try {
    const conditions: string[] = ["unitid = $1"];
    const params: (string | number)[] = [unitid];

    if (q) {
      params.push(`%${q}%`);
      conditions.push(`title ILIKE $${params.length}`);
    }

    if (level) {
      params.push(level);
      conditions.push(`degree_level_category = $${params.length}`);
    }

    if (credentialTitle) {
      params.push(credentialTitle);
      conditions.push(`credential_title = $${params.length}`);
    }

    params.push(limit);

    const sql = `
      SELECT
        title,
        cip_code,
        credential_title,
        credential_level,
        degree_level_category
      FROM   programs
      WHERE  ${conditions.join(" AND ")}
      ORDER  BY title ASC
      LIMIT  $${params.length}
    `;

    const { rows } = await pool.query<AllProgramsRow>(sql, params);

    const response: AllProgramsResponse = rows;
    return res.json(response);
  } catch (err) {
    return sendInternalError(req, res, err, "allPrograms");
  }
});

export default router;
