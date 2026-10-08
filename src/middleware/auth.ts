import { Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import pool from "../db/client";
import { AuthRequest } from "../types/user";
import { JWT_SECRET as SECRET } from "../config/jwt";
import { sendError, sendInternalError, tokenFailureCode } from "../utils/apiError";

interface AppJwtPayload {
  sub: string; // Firebase UID
}

/**
 * Protected-route middleware.
 *
 * - Reads the app JWT from `Authorization: Bearer <token>`.
 * - Verifies it with JWT_SECRET and pulls the Firebase UID from `sub`.
 * - Rejects soft-deleted users (is_active === false) even if the JWT is still
 *   valid, so a deleted account cannot keep using an unexpired token.
 *
 * Apply to every protected route — NOT to /auth/login (that takes a Firebase
 * token, not an app JWT).
 */
export const verifyToken = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  const authHeader = req.headers["authorization"];

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    sendError(req, res, 401, "AUTH_TOKEN_MISSING");
    return;
  }

  const token = authHeader.split(" ")[1];

  let payload: AppJwtPayload;
  try {
    payload = jwt.verify(token, SECRET, { algorithms: ["HS256"] }) as AppJwtPayload;
  } catch (err) {
    // 401 (not 403) so the client re-exchanges a fresh Firebase ID token and
    // retries — an expired app JWT is an auth-refresh case, not "forbidden".
    console.warn(
      `[verifyToken] 401 — jwt.verify failed: ${(err as Error).name}: ${(err as Error).message}`,
    );
    sendError(req, res, 401, tokenFailureCode(err));
    return;
  }

  const uid = payload.sub;
  if (!uid) {
    console.warn("[verifyToken] 401 — token has no sub claim");
    sendError(req, res, 401, "AUTH_TOKEN_INVALID");
    return;
  }

  try {
    const result = await pool.query<{ is_active: boolean }>(
      "SELECT is_active FROM usdusers WHERE firebase_uid = $1",
      [uid],
    );

    if (result.rows.length === 0) {
      console.warn(
        `[verifyToken] 403 — no usdusers row for firebase_uid=${uid}`,
      );
      sendError(req, res, 403, "AUTH_USER_DISABLED");
      return;
    }
    if (result.rows[0].is_active === false) {
      console.warn(
        `[verifyToken] 403 — account inactive for firebase_uid=${uid}`,
      );
      sendError(req, res, 403, "AUTH_USER_DISABLED");
      return;
    }

    req.userId = uid;
    next();
  } catch (err) {
    sendInternalError(req, res, err, "verifyToken");
  }
};

/**
 * Optional-auth middleware for public routes that serve a richer tier to
 * signed-in users (higher page-size cap, per-user rate limit).
 *
 * Same JWT + is_active checks as verifyToken, but every failure — missing
 * header, bad/expired token, unknown or inactive account, DB error — leaves
 * the request anonymous (req.userId unset) instead of responding 401/403/500.
 * Failing down to the anonymous tier never grants more access.
 */
export const optionalAuth = async (
  req: AuthRequest,
  _res: Response,
  next: NextFunction,
): Promise<void> => {
  const authHeader = req.headers["authorization"];
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    next();
    return;
  }

  try {
    const payload = jwt.verify(authHeader.split(" ")[1], SECRET, {
      algorithms: ["HS256"],
    }) as AppJwtPayload;
    const uid = payload.sub;
    if (uid) {
      const result = await pool.query<{ is_active: boolean }>(
        "SELECT is_active FROM usdusers WHERE firebase_uid = $1",
        [uid],
      );
      if (result.rows.length > 0 && result.rows[0].is_active !== false) {
        req.userId = uid;
      }
    }
  } catch {
    // Invalid/expired token or DB error → stay anonymous.
  }
  next();
};
