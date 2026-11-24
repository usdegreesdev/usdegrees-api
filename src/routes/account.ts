/**
 * Account lifecycle routes (mounted at /account): delete, availability,
 * email change and email pre-check.
 */
import { Router, Response } from "express";
import { firebaseAuth } from "../config/firebase";
import pool from "../db/client";
import { verifyToken } from "../middleware/auth";
import { ApiError, AuthRequest } from "../types/user";
import { sendEmailChangeRejection, sendError, sendInternalError } from "../utils/apiError";
import { cooldownEligibleAt } from "../utils/deactivationCooldown";
import {
  decideEmailChange,
  findConflictingEmailOwner,
  releaseDeactivatedEmailOwner,
} from "../services/emailChange.service";

const accountRouter = Router();

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
        return sendEmailChangeRejection(req, res, decision);
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
      | { available: false; code: string; details: string; eligibleAt?: string }
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
          ...(decision.eligibleAt ? { eligibleAt: decision.eligibleAt } : {}),
        });
      }
      return res.json({ available: true });
    } catch (error) {
      sendInternalError(req, res, error, "email/availability/check/error");
    }
  },
);

export default accountRouter;
