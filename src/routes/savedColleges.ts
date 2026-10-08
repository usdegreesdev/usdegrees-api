/**
 * savedColleges.ts
 * Express Router for the authenticated user's saved colleges.
 *
 * Uses the EXISTING user_saved_colleges table (id, user_id, unitid, created_at).
 * - user_id is a FK to usdusers.id (integer PK), NOT firebase_uid. The token
 *   carries firebase_uid (req.userId); we resolve it to usdusers.id here.
 * - unitid is the IPEDS UNITID. Only the reference is stored; display fields
 *   are enriched at read time from schools / admissions / costs.
 *
 * All routes are behind the app-JWT middleware and scoped to the caller's own
 * rows (their resolved user_id) — a user can never read or delete another's.
 */
import { Router, Response } from "express";
import pool from "../db/client";
import { verifyToken } from "../middleware/auth";
import { AuthRequest, ApiError } from "../types/user";
import { sendInternalError } from "../utils/apiError";

const router = Router();

function toNum(val: unknown): number | null {
  if (val === null || val === undefined) return null;
  const n = Number(val);
  return Number.isFinite(n) ? n : null;
}

/** Resolve the verified firebase_uid (req.userId) to the integer usdusers.id. */
async function resolveUserId(firebaseUid: string): Promise<string | null> {
  const r = await pool.query<{ id: string }>(
    "SELECT id FROM usdusers WHERE firebase_uid = $1",
    [firebaseUid],
  );
  return r.rows.length ? r.rows[0].id : null;
}

/** Build "City, State" from nullable parts; null when nothing is available. */
function toLocation(city: unknown, state: unknown): string | null {
  const parts = [city, state]
    .map((v) => (v == null ? "" : String(v).trim()))
    .filter((v) => v.length > 0);
  return parts.length ? parts.join(", ") : null;
}

/**
 * Normalize a school URL for safe linking: null/empty -> null; already has
 * http(s):// -> untouched; otherwise prefix https://.
 */
function normalizeUrl(val: unknown): string | null {
  if (val === null || val === undefined) return null;
  const s = String(val).trim();
  if (!s) return null;
  return /^https?:\/\//i.test(s) ? s : `https://${s}`;
}

/**
 * POST /saved-colleges
 * body: { unitid }
 * Idempotent: ON CONFLICT (user_id, unitid) DO NOTHING. Returns the saved record.
 */
router.post("/", verifyToken, async (req: AuthRequest, res: Response) => {
  try {
    const unitid = toNum((req.body ?? {}).unitid);
    if (unitid === null || unitid <= 0 || !Number.isInteger(unitid)) {
      return res
        .status(400)
        .json({ error: "A valid integer unitid is required" });
    }

    const userId = await resolveUserId(req.userId as string);
    if (!userId) {
      return res.status(404).json({ error: "User not found" });
    }

    // Insert; if it already exists, DO NOTHING returns no row, so fall back to
    // selecting the existing record — either way the response is the saved row.
    const inserted = await pool.query(
      `INSERT INTO user_saved_colleges (user_id, unitid, created_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (user_id, unitid) DO NOTHING
       RETURNING id, unitid, created_at`,
      [userId, unitid],
    );

    const row =
      inserted.rows[0] ??
      (
        await pool.query(
          `SELECT id, unitid, created_at FROM user_saved_colleges
            WHERE user_id = $1 AND unitid = $2`,
          [userId, unitid],
        )
      ).rows[0];

    return res.status(inserted.rows[0] ? 201 : 200).json({
      id: toNum(row.id),
      unitid: toNum(row.unitid),
      createdAt: row.created_at,
    });
  } catch (error) {
    return sendInternalError(req, res, error, "savedColleges");
  }
});

/**
 * GET /saved-colleges
 * Returns the caller's saves, enriched with display fields by unitid.
 * [{ unitid, name, location, tuitionFee, acceptanceRate, createdAt }]
 * Any display field the source lacks is null (never a placeholder).
 */
router.get("/", verifyToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = await resolveUserId(req.userId as string);
    if (!userId) {
      return res.status(404).json({ error: "User not found" });
    }

    const result = await pool.query(
      `SELECT
         usc.unitid,
         usc.created_at,
         s.name              AS name,
         s.city              AS city,
         s.state             AS state,
         s.school_url        AS school_url,
         ad.admission_rate   AS admission_rate,
         c.tuition_in_state  AS tuition_in_state
       FROM user_saved_colleges usc
       LEFT JOIN schools s ON s.unitid = usc.unitid
       LEFT JOIN LATERAL (
         SELECT admission_rate FROM admissions WHERE unitid = usc.unitid LIMIT 1
       ) ad ON TRUE
       LEFT JOIN LATERAL (
         SELECT tuition_in_state FROM costs WHERE unitid = usc.unitid LIMIT 1
       ) c ON TRUE
       WHERE usc.user_id = $1
       ORDER BY usc.created_at DESC`,
      [userId],
    );

    const saved = result.rows.map((row) => ({
      unitid: toNum(row.unitid),
      name: row.name ?? null,
      location: toLocation(row.city, row.state),
      tuitionFee: toNum(row.tuition_in_state),
      acceptanceRate: toNum(row.admission_rate),
      createdAt: row.created_at,
      schoolUrl: normalizeUrl(row.school_url),
    }));

    return res.json(saved);
  } catch (error) {
    return sendInternalError(req, res, error, "savedColleges");
  }
});

/**
 * DELETE /saved-colleges/:unitid
 * Removes (user_id, unitid) for the caller. Returns { ok: true }.
 */
router.delete(
  "/:unitid",
  verifyToken,
  async (req: AuthRequest, res: Response<{ ok: true } | ApiError>) => {
    try {
      const unitid = toNum(req.params.unitid);
      if (unitid === null || unitid <= 0 || !Number.isInteger(unitid)) {
        return res
          .status(400)
          .json({ error: "A valid integer unitid is required" });
      }

      const userId = await resolveUserId(req.userId as string);
      if (!userId) {
        return res.status(404).json({ error: "User not found" });
      }

      await pool.query(
        "DELETE FROM user_saved_colleges WHERE user_id = $1 AND unitid = $2",
        [userId, unitid],
      );

      return res.json({ ok: true });
    } catch (error) {
      return sendInternalError(req, res, error, "savedColleges");
    }
  },
);

export default router;
