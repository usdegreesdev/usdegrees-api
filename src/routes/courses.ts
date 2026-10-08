import { Router, Request, Response } from "express";
import { Course } from "../types/search-details";
import pool from "../db/client";
import { sendInternalError } from "../utils/apiError";


const router = Router();

// GET /courses?credential_title=&state_code=
// Returns DISTINCT program titles, max 20
router.get("/", async (req: Request, res: Response) => {
  const { credential_title, state } = req.query as Record<string, string>;

  const params: string[] = [];

  let sql = `
    SELECT DISTINCT p.title
    FROM programs p
    JOIN schools s ON p.unitid = s.unitid
    WHERE 1=1
  `;

  if (credential_title) {
    params.push(credential_title);
    sql += ` AND p.credential_title = $${params.length}`;
  }

  if (state) {
    params.push(state);
    sql += ` AND s.state = $${params.length}`;
  }

  sql += " ORDER BY p.title ASC";

  try {
    res.setHeader("Cache-Control", "public, max-age=3600, s-maxage=3600");
    const { rows } = await pool.query<Course>(sql, params);
    res.json(rows);
  }
  catch (err: any) {
  console.error("========== COURSES ERROR ==========");
  console.error(err);
  console.error("SQL:", sql);
  console.error("PARAMS:", params);

  sendInternalError(req, res, err, "courses");
}
});

export default router;