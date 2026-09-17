import { Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import pool from "../db/client";
import { AuthRequest } from "../types/user";
import { JWT_SECRET as SECRET } from "../config/jwt";

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
    res.status(401).json({ error: "Missing or invalid Authorization header" });
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
    res.status(401).json({ error: "Invalid or expired token" });
    return;
  }

  const uid = payload.sub;
  if (!uid) {
    console.warn("[verifyToken] 401 — token has no sub claim");
    res.status(401).json({ error: "Invalid token payload" });
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
      res
        .status(403)
        .json({ error: "Account is inactive or no longer exists" });
      return;
    }
    if (result.rows[0].is_active === false) {
      console.warn(
        `[verifyToken] 403 — account inactive for firebase_uid=${uid}`,
      );
      res
        .status(403)
        .json({ error: "Account is inactive or no longer exists" });
      return;
    }

    req.userId = uid;
    next();
  } catch (err) {
    console.error("Auth middleware DB error:", (err as Error).message);
    res.status(500).json({ error: "Authentication check failed" });
  }
};
