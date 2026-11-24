/**
 * Profile routes (GET/PATCH /profile). Data logic lives in
 * services/profile.service.ts and services/profileFields.ts; account routes
 * (delete, email) are in routes/account.ts.
 */
import { Router, Response } from "express";
import pool from "../db/client";
import { verifyToken } from "../middleware/auth";
import { AuthRequest } from "../types/user";
import { sendError, sendInternalError } from "../utils/apiError";
import { REACTIVATION_COOLDOWN_HOURS } from "../utils/deactivationCooldown";
import { resolveUserId } from "../services/userLookup";
import { PROFILE_FIELD_MAP, validateProfileField } from "../services/profileFields";
import {
  buildProfileResponse,
  normalizePrograms,
  normalizeStateCodes,
} from "../services/profile.service";
import accountRouter from "./account";

const router = Router();

/**
 * GET /profile
 * Returns the authenticated user's profile, including preferred_states and
 * preferred_programs arrays joined from the child tables.
 */
router.get("/", verifyToken, async (req: AuthRequest, res: Response) => {
  try {
    const profile = await buildProfileResponse(req.userId as string);
    if (!profile) {
      return sendError(req, res, 403, "AUTH_USER_DISABLED");
    }
    res.json(profile);
  } catch (error) {
    sendInternalError(req, res, error, "get/profile/error");
  }
});

/**
 * PATCH /profile
 * Updates editable profile fields. Identity fields (email, role, email_verified)
 * are NOT editable here — email is mirrored from the verified Firebase token on
 * login; never trusted from the client.
 */
router.patch("/", verifyToken, async (req: AuthRequest, res: Response) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    console.log("[profile/patch]", {
      userId: req.userId,
      bodyKeys: Object.keys(body),
    });

    // ── Scalar columns ───────────────────────────────────────────────
    const sets: string[] = [];
    const values: unknown[] = [];
    let i = 1;

    for (const [key, column] of Object.entries(PROFILE_FIELD_MAP)) {
      if (!(key in body) || body[key] === undefined) continue;

      const result = validateProfileField(column, body[key]);
      if (result.kind === "skip") continue;
      if (result.kind === "invalid") {
        return sendError(req, res, 400, "PROFILE_INVALID", result.message);
      }

      sets.push(`${column} = $${i++}`);
      values.push(result.value);
    }

    // ── Child-table sets (transactional replace) ─────────────────────
    const hasStates =
      "preferredStates" in body && body.preferredStates !== undefined;
    const hasPrograms =
      "preferredPrograms" in body && body.preferredPrograms !== undefined;

    if (sets.length === 0 && !hasStates && !hasPrograms) {
      return sendError(req, res, 400, "PROFILE_INVALID", "No updatable fields provided.");
    }

    const userId = await resolveUserId(req.userId as string);
    if (!userId) {
      return sendError(req, res, 403, "AUTH_USER_DISABLED");
    }

    const stateCodes = hasStates
      ? await normalizeStateCodes(body.preferredStates)
      : [];
    const programs = hasPrograms
      ? normalizePrograms(body.preferredPrograms)
      : [];

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      if (sets.length > 0) {
        await client.query(
          `UPDATE usdusers SET ${sets.join(", ")} WHERE id = $${i}`,
          [...values, userId],
        );
      }

      // REPLACE-the-set: delete all of the caller's rows, insert the new set.
      // Empty array therefore clears all rows. Never injects defaults.
      if (hasStates) {
        await client.query(
          "DELETE FROM usdusers_preferred_states WHERE user_id = $1",
          [userId],
        );
        if (stateCodes.length > 0) {
          await client.query(
            `INSERT INTO usdusers_preferred_states (user_id, state_code)
               SELECT $1, unnest($2::text[])
               ON CONFLICT (user_id, state_code) DO NOTHING`,
            [userId, stateCodes],
          );
        }
      }

      if (hasPrograms) {
        await client.query(
          "DELETE FROM usdusers_preferred_programs WHERE user_id = $1",
          [userId],
        );
        if (programs.length > 0) {
          await client.query(
            `INSERT INTO usdusers_preferred_programs (user_id, program)
               SELECT $1, unnest($2::text[])
               ON CONFLICT (user_id, program) DO NOTHING`,
            [userId, programs],
          );
        }
      }

      await client.query("COMMIT");
    } catch (txErr) {
      await client.query("ROLLBACK");
      throw txErr;
    } finally {
      client.release();
    }

    const profile = await buildProfileResponse(req.userId as string);
    res.json(profile);
  } catch (error) {
    sendInternalError(req, res, error, "update/profile/error");
  }
});

// Re-exported so server.ts and other importers keep their existing paths.
export { accountRouter, REACTIVATION_COOLDOWN_HOURS };
export default router;
