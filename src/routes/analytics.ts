import { Router, Request, Response } from "express";
import jwt from "jsonwebtoken";
import pool from "../db/client";
import { JWT_SECRET } from "../config/jwt";
import { verifyToken } from "../middleware/auth";
import { AuthRequest } from "../types/user";
import { sendInternalError } from "../utils/apiError";

const router = Router();

interface ApplyClickBody {
  university_id?: unknown;
  university_name?: unknown;
  cip_code?: unknown;
  degree?: unknown;
  credential_level?: unknown;
  credential_title?: unknown;
  school_url?: unknown;
  clicked_at?: unknown;
}

function optionalString(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function optionalInteger(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}

/**
 * The stored value is rendered by the UI as an `href` in a `target="_blank"`
 * link, so anything but http(s) (`javascript:`, `data:`, ...) is a stored-XSS
 * vector.
 *
 * School URLs come from IPEDS as bare hostnames (`www.uaa.alaska.edu/`), which
 * are not parseable URLs and are NOT links when dropped into an href as-is.
 * So: if the value carries an explicit scheme it must be http(s); if it has no
 * scheme it is a hostname and gets `https://` prepended. Anything that still
 * fails to parse, or parses without a host, is dropped.
 */
function optionalHttpUrl(value: unknown): string | null {
  const raw = optionalString(value);
  if (raw === null) return null;

  // RFC 3986 scheme, e.g. `https:`, `javascript:`, `data:`.
  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw);
  // `//host/path` is protocol-relative, not a scheme.
  const candidate = hasScheme
    ? raw
    : `https://${raw.replace(/^\/+/, "")}`;

  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    if (!parsed.hostname) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

/** Strict pagination parse: unlike report's lenient fallback, a non-numeric
 *  value is a client bug and gets a 400 instead of being silently coerced. */
function parsePageParam(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number | null {
  if (value === undefined || value === "") return fallback;
  if (typeof value !== "string" && typeof value !== "number") return null;
  const n = Number(value);
  if (!Number.isInteger(n)) return null;
  return Math.min(max, Math.max(min, n));
}

/** Resolve the verified firebase_uid to the integer usdusers.id. */
async function resolveUserIdFromFirebaseUid(
  firebaseUid: string,
): Promise<number | null> {
  const r = await pool.query<{ id: number }>(
    "SELECT id FROM usdusers WHERE firebase_uid = $1",
    [firebaseUid],
  );
  return r.rows.length ? r.rows[0].id : null;
}

async function tryResolveUserId(req: Request): Promise<number | null> {
  const authHeader = req.headers.authorization;
  if (!authHeader) return null;
  if (!authHeader.startsWith("Bearer ") || !authHeader.slice(7).trim()) {
    throw new Error("Malformed Authorization header");
  }

  try {
    const payload = jwt.verify(authHeader.slice(7).trim(), JWT_SECRET, {
      algorithms: ["HS256"],
    }) as {
      sub?: string;
    };
    if (!payload.sub) return null;

    const result = await pool.query<{ id: number; is_active: boolean }>(
      "SELECT id, is_active FROM usdusers WHERE firebase_uid = $1",
      [payload.sub],
    );
    if (result.rows.length === 0 || result.rows[0].is_active === false) return null;
    return result.rows[0].id;
  } catch (error) {
    if (error instanceof Error && error.message === "Malformed Authorization header") {
      throw error;
    }
    return null;
  }
}

router.post("/apply-click", async (req: Request, res: Response) => {
  try {
    const body = req.body as ApplyClickBody;
    const userId = await tryResolveUserId(req);
    const clickedAt = optionalString(body.clicked_at);

    await pool.query(
      `INSERT INTO usd_apply_clicks
        (user_id, university_id, university_name, cip_code, degree, credential_level,
         credential_title, school_url, clicked_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8,
         COALESCE($9::timestamptz, CURRENT_TIMESTAMP))`,
      [
        userId,
        optionalString(body.university_id),
        optionalString(body.university_name),
        optionalString(body.cip_code),
        optionalString(body.degree),
        optionalInteger(body.credential_level),
        optionalString(body.credential_title),
        optionalHttpUrl(body.school_url),
        clickedAt,
      ],
    );

    return res.status(201).json({
      status: "success",
      message: "Apply click tracked successfully",
    });
  } catch (error) {
    if (error instanceof Error && error.message === "Malformed Authorization header") {
      return res.status(401).json({ error: "Malformed Authorization header" });
    }
    return sendInternalError(req, res, error, "analytics");
  }
});

interface ApplyClickRow {
  id: string;
  university_id: string | null;
  university_name: string | null;
  cip_code: string | null;
  degree: string | null;
  credential_level: number | null;
  credential_title: string | null;
  school_url: string | null;
  clicked_at: Date;
}

/**
 * The signed-in user's own Apply Now history, newest first.
 *
 * Scoped to the JWT's user_id — never a body/query value — so guest rows
 * (user_id IS NULL) can never be returned. Not deduped: this is a click log,
 * so two clicks on the same program are two rows.
 */
router.get(
  "/apply-clicks",
  verifyToken,
  async (req: AuthRequest, res: Response) => {
    try {
      const page = parsePageParam(req.query.page, 1, 1, Number.MAX_SAFE_INTEGER);
      const limit = parsePageParam(req.query.limit, 10, 1, 50);
      if (page === null || limit === null) {
        return res
          .status(400)
          .json({ error: "page and limit must be integers" });
      }

      const userId = await resolveUserIdFromFirebaseUid(req.userId as string);
      if (userId === null) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      // clicked_at is client-supplied and can collide, so id breaks the tie
      // and keeps paging stable.
      const [rowsResult, countResult] = await Promise.all([
        pool.query<ApplyClickRow>(
          `SELECT id, university_id, university_name, cip_code, degree,
                  credential_level, credential_title, school_url, clicked_at
             FROM usd_apply_clicks
            WHERE user_id = $1
            ORDER BY clicked_at DESC, id DESC
            LIMIT $2 OFFSET $3`,
          [userId, limit, (page - 1) * limit],
        ),
        pool.query<{ count: string }>(
          "SELECT COUNT(*) AS count FROM usd_apply_clicks WHERE user_id = $1",
          [userId],
        ),
      ]);

      const total = Number(countResult.rows[0]?.count ?? 0);

      return res.status(200).json({
        clicks: rowsResult.rows.map((row) => ({
          id: Number(row.id),
          universityId: row.university_id,
          universityName: row.university_name,
          cipCode: row.cip_code,
          degree: row.degree,
          credentialLevel: row.credential_level,
          credentialTitle: row.credential_title,
          // Defence in depth for rows written before the write path validated
          // the scheme — the UI drops this straight into an href.
          schoolUrl: optionalHttpUrl(row.school_url),
          clickedAt: new Date(row.clicked_at).toISOString(),
        })),
        page,
        limit,
        total,
        hasMore: page * limit < total,
      });
    } catch (error) {
      return sendInternalError(req, res, error, "analytics");
    }
  },
);

export default router;