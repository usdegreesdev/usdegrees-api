import { Router, Response } from "express";
import { firebaseAuth } from "../config/firebase";
import pool from "../db/client";
import { verifyToken } from "../middleware/auth";
import { normalizeDegreeLevel } from "../constants/degreeLevels";
import { getValidStateCodes } from "../db/statesCache";
import { ApiError, AuthRequest } from "../types/user";
import { sendError, sendInternalError } from "../utils/apiError";
import {
  REACTIVATION_COOLDOWN_HOURS,
  cooldownEligibleAt,
} from "../utils/deactivationCooldown";
import {
  decideEmailChange,
  findConflictingEmailOwner,
  releaseDeactivatedEmailOwner,
} from "../services/emailChange.service";

const router = Router();
const accountRouter = Router();

/**
 * Allowlist of patchable profile fields: camelCase request key -> snake_case
 * DB column. Anything NOT in this map (email, role, auth_provider, firebase_uid,
 * is_active, etc.) is silently dropped and can never be patched here.
 */
/**
 * Allowlist of patchable SCALAR profile columns. preferredStates and
 * preferredPrograms are NOT here — they live in child tables and are handled
 * by a transactional replace below.
 */
const PROFILE_FIELD_MAP: Record<string, string> = {
  fullName: "display_name",
  phone: "phone",
  address: "address",
  gpa: "gpa",
  satScore: "sat_score",
  // Deprecated: kept only while the frontend still writes the split sub-scores
  // as a temporary fallback. Remove once fully migrated to satScore.
  satMath: "sat_math",
  satReadingWriting: "sat_reading_writing",
  actScore: "act_score",
  graduationYear: "graduation_year",
  highSchoolName: "high_school_name",
  preferredDegreeLevel: "preferred_degree_level",
  preferredCollegeType: "preferred_college_type",
};

/** Allowed values for preferred_college_type (empty/NULL = no preference). */
const COLLEGE_TYPES = ["Public", "Private"] as const;

/**
 * Fetch the full profile for a firebase_uid, joining the child tables into
 * preferred_states / preferred_programs arrays (empty -> []). Returns null if
 * no user row. Never includes the password hash.
 */
async function buildProfileResponse(
  firebaseUid: string,
): Promise<Record<string, unknown> | null> {
  const result = await pool.query(
    `SELECT
        u.*,
        COALESCE(
          (SELECT array_agg(s.state_code ORDER BY s.state_code)
             FROM usdusers_preferred_states s WHERE s.user_id = u.id),
          ARRAY[]::text[]
        ) AS preferred_states,
        COALESCE(
          (SELECT array_agg(p.program ORDER BY p.program)
             FROM usdusers_preferred_programs p WHERE p.user_id = u.id),
          ARRAY[]::text[]
        ) AS preferred_programs
      FROM usdusers u
      WHERE u.firebase_uid = $1`,
    [firebaseUid],
  );
  if (result.rows.length === 0) return null;

  const { password_hash, preferred_states, preferred_programs, ...rest } =
    result.rows[0];
  // Return the child-table sets under the snake_case keys the frontend reads.
  return {
    ...rest,
    preferred_states: preferred_states ?? [],
    preferred_programs: preferred_programs ?? [],
  };
}

/** Resolve the verified firebase_uid to the integer usdusers.id. */
async function resolveUserId(firebaseUid: string): Promise<string | null> {
  const r = await pool.query<{ id: string }>(
    "SELECT id FROM usdusers WHERE firebase_uid = $1",
    [firebaseUid],
  );
  return r.rows.length ? r.rows[0].id : null;
}

/** Max length of a preferred program name (matches the DB column intent). */
const MAX_PROGRAM_LENGTH = 150;

/**
 * Trim, drop empty, enforce the 150-char limit, and de-duplicate a string
 * array (for preferred programs). Values over the limit are skipped.
 */
function normalizePrograms(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of value) {
    if (typeof v !== "string") continue;
    const t = v.trim();
    if (!t || t.length > MAX_PROGRAM_LENGTH || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

/** Uppercase, validate against the states set, de-duplicate (for preferred states). */
async function normalizeStateCodes(value: unknown): Promise<string[]> {
  if (!Array.isArray(value)) return [];
  const valid = await getValidStateCodes();
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of value) {
    if (typeof v !== "string") continue;
    const code = v.trim().toUpperCase();
    if (!valid.has(code) || seen.has(code)) continue;
    seen.add(code);
    out.push(code);
  }
  return out;
}

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
      let value: unknown = body[key];

      if (column === "preferred_degree_level") {
        // Accept only the 8 canonical values (legacy short forms mapped).
        // null explicitly clears; any other invalid value is stripped.
        if (value !== null) {
          const canonical = normalizeDegreeLevel(value);
          if (canonical === null) continue; // strip invalid silently
          value = canonical;
        }
      } else if (column === "preferred_college_type") {
        // Empty string (or explicit null) clears the preference; when set it
        // must be one of the canonical types.
        if (value === null || (typeof value === "string" && value.trim() === "")) {
          value = null;
        } else if (
          typeof value === "string" &&
          (COLLEGE_TYPES as readonly string[]).includes(value.trim())
        ) {
          value = value.trim();
        } else {
          return sendError(
            req,
            res,
            400,
            "PROFILE_INVALID",
            `preferredCollegeType must be one of ${COLLEGE_TYPES.join(
              ", ",
            )}, or empty to clear`,
          );
        }
      } else if (column === "sat_score") {
        // A single total SAT score: null clears it; otherwise it must be an
        // integer in the valid 400..1600 range.
        if (value !== null) {
          const n = typeof value === "string" ? Number(value.trim()) : value;
          if (typeof n !== "number" || !Number.isInteger(n) || n < 400 || n > 1600) {
            return sendError(
              req,
              res,
              400,
              "PROFILE_INVALID",
              "satScore must be an integer between 400 and 1600, or null to clear",
            );
          }
          value = n;
        }
      } else if (typeof value === "string") {
        value = value.trim();
      }

      sets.push(`${column} = $${i++}`);
      values.push(value);
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

// REACTIVATION_COOLDOWN_HOURS re-exported for existing importers (POST /user).
export { REACTIVATION_COOLDOWN_HOURS };

interface DeactivationBody {
  reason_code?: string;
  reason_label?: string;
  other_reason?: string;
  improvement_feedback?: string;
  acknowledged?: boolean;
}

/**
 * POST /account/delete
 * Soft-deletes the user: marks the DB row inactive, stamps deactivated_at, and
 * records the reason/feedback in usduser_deactivations. The Firebase user is
 * DELETED (not just disabled) so the email is freed — the person may register a
 * brand-new account with the same email once REACTIVATION_COOLDOWN_HOURS have
 * elapsed (enforced in POST /user). The usdusers row is kept for records.
 */
accountRouter.post(
  "/delete",
  verifyToken,
  async (
    req: AuthRequest & { body?: DeactivationBody },
    res: Response<{ ok: true } | ApiError>,
  ) => {
    try {
      const uid = req.userId as string;
      const {
        reason_code,
        reason_label,
        other_reason,
        improvement_feedback,
        acknowledged,
      } = (req.body ?? {}) as DeactivationBody;

      const updated = await pool.query<{ id: number }>(
        `UPDATE usdusers
            SET is_active = false, deactivated_at = NOW()
          WHERE firebase_uid = $1
        RETURNING id`,
        [uid],
      );

      const userRow = updated.rows[0];
      if (!userRow) {
        return sendError(req, res, 403, "AUTH_USER_DISABLED");
      }

      // Record why the user is leaving. reason_label holds the exact text the
      // user selected; other_reason holds free-text when they pick "Other".
      await pool.query(
        `INSERT INTO usduser_deactivations
           (user_id, reason_code, reason_label, other_reason,
            improvement_feedback, acknowledged, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
        [
          userRow.id,
          reason_code ?? "unspecified",
          reason_label ?? "Unspecified",
          other_reason ?? null,
          improvement_feedback ?? null,
          acknowledged ?? true,
        ],
      );

      // Delete the Firebase user so the email can be reused after the cooldown.
      await firebaseAuth.deleteUser(uid);

      res.json({ ok: true });
    } catch (error) {
      sendInternalError(req, res, error, "account/delete/error");
    }
  },
);

/**
 * GET /account/availability?email=...
 * Public. Tells the frontend whether an email can register/sign in right now, or
 * is still inside the post-deactivation cooldown. Used to show a clear "you can
 * register again after <date>" message instead of a generic auth error.
 */
accountRouter.get(
  "/availability",
  async (
    req: AuthRequest,
    res: Response<
      { available: boolean; cooldown?: boolean; eligibleAt?: string } | ApiError
    >,
  ) => {
    try {
      const email = String(req.query.email ?? "")
        .trim()
        .toLowerCase();
      if (!email) {
        return sendError(req, res, 400, "PROFILE_INVALID", "email is required.");
      }

      const result = await pool.query<{
        deactivated_at: string | null;
        is_active: boolean;
      }>(
        `SELECT deactivated_at, is_active
           FROM usdusers
          WHERE LOWER(email) = $1`,
        [email],
      );

      const row = result.rows[0];
      if (!row || row.is_active !== false || !row.deactivated_at) {
        return res.json({ available: true });
      }

      const eligibleAtMs = cooldownEligibleAt(row.deactivated_at);

      if (eligibleAtMs > Date.now()) {
        return res.json({
          available: false,
          cooldown: true,
          eligibleAt: new Date(eligibleAtMs).toISOString(),
        });
      }

      return res.json({ available: true });
    } catch (error) {
      sendInternalError(req, res, error, "account/availability/error");
    }
  },
);

interface ChangeEmailBody {
  newEmail?: string;
}

/**
 * PATCH /account/email
 * Changes the authenticated user's email address.
 *
 * Identity comes ONLY from req.userId (the Firebase UID carried in the
 * verified app JWT via verifyToken) — email/auth_provider/provider_user_id
 * are never read from the request body, so a client cannot point this at
 * another account by supplying different identity fields.
 *
 * Enforces, in order:
 *  1. The caller's CURRENT email must already be verified (being logged in
 *     is not the same as having a verified email).
 *  2. The new email must not belong to any OTHER usdusers row — verified or
 *     not. Never auto-merges/re-links; a conflict is always rejected.
 *  3. If the new email belonged to a deactivated row, the same
 *     REACTIVATION_COOLDOWN_HOURS window POST /user enforces for signup
 *     reuse applies here too (see decideEmailChange).
 *
 * These checks (and the final UNIQUE constraint on usdusers.email, which is
 * the hard backstop against two concurrent requests racing for the same
 * email) hold regardless of what the API is called with — they are not
 * something a disabled UI button can substitute for.
 */
accountRouter.patch(
  "/email",
  verifyToken,
  async (
    req: AuthRequest & { body?: ChangeEmailBody },
    res: Response<{ email: string } | ApiError>,
  ) => {
    try {
      const uid = req.userId as string;
      const rawNewEmail = (req.body ?? {}).newEmail;
      if (typeof rawNewEmail !== "string" || !rawNewEmail.trim()) {
        return sendError(req, res, 400, "PROFILE_INVALID", "newEmail is required.");
      }
      const newEmail = rawNewEmail.trim().toLowerCase();

      const callerResult = await pool.query<{
        id: number;
        email: string;
        email_verified: boolean;
      }>(
        `SELECT id, email, email_verified FROM usdusers WHERE firebase_uid = $1`,
        [uid],
      );
      const caller = callerResult.rows[0];
      if (!caller) {
        return sendError(req, res, 403, "AUTH_USER_DISABLED");
      }

      if (newEmail === caller.email.toLowerCase()) {
        return sendError(
          req,
          res,
          400,
          "PROFILE_INVALID",
          "New email must be different from your current email.",
        );
      }

      // Any OTHER row already holding this email — verified, unverified, or
      // a deactivated row still inside (or past) its cooldown. Excludes the
      // caller's own row by firebase_uid, not by id, so it can never match a
      // client-supplied id.
      const existingOwner = await findConflictingEmailOwner(pool, newEmail, uid);

      const decision = decideEmailChange({
        currentEmailVerified: caller.email_verified,
        existingOwner,
      });

      if (!decision.allowed) {
        const status =
          decision.code === "EMAIL_ALREADY_IN_USE" ? 409 : 403;
        return sendError(req, res, status, decision.code, decision.message);
      }

      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        // Cooldown elapsed on the old deactivated row — release its claim on
        // this email (kept for records under a namespaced placeholder,
        // matching POST /user's release logic) before the UPDATE below.
        if (decision.releaseFromUserId) {
          await releaseDeactivatedEmailOwner(
            client,
            decision.releaseFromUserId,
            newEmail,
          );
        }

        // firebase_uid (from the verified app JWT) is the ONLY identity used
        // here, so this can only ever update the caller's own row. The
        // UNIQUE constraint on usdusers.email is still the final backstop if
        // a concurrent request claimed this exact email between the SELECT
        // above and this UPDATE.
        const updated = await client.query<{ id: number; email: string }>(
          `UPDATE usdusers SET email = $1, email_verified = false
            WHERE firebase_uid = $2
          RETURNING id, email`,
          [newEmail, uid],
        );

        if (updated.rows.length === 0) {
          await client.query("ROLLBACK");
          return sendError(req, res, 403, "AUTH_USER_DISABLED");
        }

        // Mirror onto the Firebase user BEFORE committing the DB row, and
        // roll the DB back if it fails. Doing this AFTER commit (the
        // previous version) let the two drift: usdusers.email would advance
        // to the new address while Firebase's own record silently stayed on
        // the old one. That drift compounds — Firebase's built-in
        // "your sign-in email was changed" revert-notification always goes
        // to whatever email Firebase itself last had on file, so once it
        // fell behind, EVERY subsequent change kept notifying that same
        // stale address instead of the account's actual current email. Now
        // the DB write only survives if Firebase's record was updated too,
        // so the two can never diverge.
        try {
          await firebaseAuth.updateUser(uid, {
            email: newEmail,
            emailVerified: false,
          });
        } catch (firebaseErr) {
          await client.query("ROLLBACK");
          console.error(
            `[account/email] Firebase updateUser failed for uid=${uid}, DB change rolled back:`,
            firebaseErr instanceof Error
              ? firebaseErr.message
              : String(firebaseErr),
          );
          return sendError(
            req,
            res,
            500,
            "INTERNAL_ERROR",
            "Could not update your sign-in email. Please try again or contact support.",
          );
        }

        await client.query("COMMIT");

        return res.json({ email: updated.rows[0].email });
      } catch (txErr) {
        await client.query("ROLLBACK");
        const pgErr = txErr as { code?: string; constraint?: string };
        if (pgErr.code === "23505" && pgErr.constraint === "usdusers_email_key") {
          return sendError(req, res, 409, "EMAIL_ALREADY_IN_USE");
        }
        throw txErr;
      } finally {
        client.release();
      }
    } catch (error) {
      sendInternalError(req, res, error, "change/email/error");
    }
  },
);

/**
 * GET /account/email-available?email=...
 * Authenticated pre-check for the frontend to call BEFORE it kicks off
 * Firebase's verifyBeforeUpdateEmail, so a doomed-to-conflict email change is
 * rejected up front instead of confusingly surfacing at the next login (once
 * Firebase has already sent — and the user has already clicked — a
 * verification link for an email they can never actually land on). Runs the
 * exact same decideEmailChange used by PATCH /account/email and the
 * /auth/login sync; this is a preview, not a separate/weaker check.
 */
accountRouter.get(
  "/email-available",
  verifyToken,
  async (
    req: AuthRequest,
    res: Response<
      | { available: true }
      | { available: false; code: string; details: string }
      | ApiError
    >,
  ) => {
    try {
      const uid = req.userId as string;
      const email = String(req.query.email ?? "")
        .trim()
        .toLowerCase();
      if (!email) {
        return sendError(req, res, 400, "PROFILE_INVALID", "email is required.");
      }

      const callerResult = await pool.query<{ email_verified: boolean }>(
        `SELECT email_verified FROM usdusers WHERE firebase_uid = $1`,
        [uid],
      );
      const caller = callerResult.rows[0];
      if (!caller) {
        return sendError(req, res, 403, "AUTH_USER_DISABLED");
      }

      const existingOwner = await findConflictingEmailOwner(pool, email, uid);
      const decision = decideEmailChange({
        currentEmailVerified: caller.email_verified,
        existingOwner,
      });

      if (!decision.allowed) {
        return res.json({
          available: false,
          code: decision.code,
          details: decision.message,
        });
      }
      return res.json({ available: true });
    } catch (error) {
      sendInternalError(req, res, error, "email/availability/check/error");
    }
  },
);

export { accountRouter };
export default router;
