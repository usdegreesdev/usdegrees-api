import { Router, Request, Response } from "express";
import pool from "../db/client";
import { User, UserProfile, UpsertUserBody, ApiError, AuthRequest } from "../types/user";
import { verifyToken } from "../middleware/auth";
import { firebaseAuth } from "../config/firebase";
import {
  sendEmailChangeRejection,
  sendError,
  sendInternalError,
  tokenFailureCode,
} from "../utils/apiError";
import {
  decideEmailChange,
  findConflictingEmailOwner,
  releaseDeactivatedEmailOwner,
} from "../services/emailChange.service";

const router = Router();

/**
 * GET /user/:id
 * Returns the CALLER'S OWN profile — :id must match the authenticated
 * caller's own usdusers.id. Previously this required only `verifyToken`
 * (any valid session) with no ownership check at all, letting any
 * authenticated user enumerate any other user's id/email/display_name/role/
 * email_verified/age_consent (IDOR). Ownership mismatches 404 (not 403), same
 * convention as GET /report/:reportId, so a probing request can't distinguish
 * "not yours" from "doesn't exist".
 */
router.get("/:id", verifyToken, async (req: AuthRequest & Request<{ id: string }>, res: Response<UserProfile | ApiError>) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return sendError(req, res, 400, "PROFILE_INVALID", "Invalid user ID.");
    }

    const result = await pool.query<User>(
      `SELECT id, firebase_uid, display_name, email, profile_image, role, email_verified, age_consent
       FROM usdusers WHERE id = $1`,
      [id]
    );

    if (result.rows.length === 0 || result.rows[0].firebase_uid !== req.userId) {
      return sendError(req, res, 404, "NOT_FOUND");
    }

    const row = result.rows[0];
    res.json({
      id: row.id,
      display_name: row.display_name,
      email: row.email,
      profile_image: row.profile_image,
      role: row.role,
      email_verified: row.email_verified,
      age_consent: row.age_consent,
    });
  } catch (error) {
    sendInternalError(req, res, error, "error/fetching/user");
  }
});

/**
 * GET /user/email/:email
 * Returns the CALLER'S OWN profile — :email must match the authenticated
 * caller's own email. Same IDOR fix as GET /user/:id above: previously any
 * authenticated user could look up any other user's PII by email.
 */
router.get("/email/:email", verifyToken, async (req: AuthRequest & Request<{ email: string }>, res: Response<UserProfile | ApiError>) => {
  try {
    const { email } = req.params;

    const result = await pool.query<User>(
      `SELECT id, firebase_uid, display_name, email, profile_image, role, email_verified, age_consent
       FROM usdusers WHERE email = $1`,
      [email]
    );

    if (result.rows.length === 0 || result.rows[0].firebase_uid !== req.userId) {
      return sendError(req, res, 404, "NOT_FOUND");
    }

    const row = result.rows[0];
    res.json({
      id: row.id,
      display_name: row.display_name,
      email: row.email,
      profile_image: row.profile_image,
      role: row.role,
      email_verified: row.email_verified,
      age_consent: row.age_consent,
    });
  } catch (error) {
    sendInternalError(req, res, error, "error/fetching/user/by/email");
  }
});

/**
 * POST /user
 * Creates (or updates) the CALLER'S OWN usdusers row. Used right after
 * Firebase client-side signup, when the frontend has a Firebase UID but no
 * DB row exists for it yet — i.e. before an app JWT can exist, so this
 * cannot require verifyToken the way every other route does.
 *
 * Auth: a Firebase ID token (Authorization: Bearer <idToken>), verified here
 * with firebaseAuth.verifyIdToken — the SAME check POST /auth/login uses.
 * uid/email/email_verified are ALWAYS derived from the verified token, NEVER
 * from the request body. This endpoint previously trusted a client-supplied
 * `email`/`role`/`email_verified` with no authentication at all, letting
 * anyone fabricate a "verified" account for an arbitrary email or overwrite
 * an existing user's row. firebase_uid is now stored on insert so a later
 * POST /auth/login resolves to this same row instead of relying on the
 * by-email relink fallback.
 */
router.post("/", async (req: Request<{}, UserProfile | ApiError, UpsertUserBody>, res: Response<UserProfile | ApiError>) => {
  try {
    const authHeader = req.headers["authorization"];
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return sendError(req, res, 401, "AUTH_TOKEN_MISSING");
    }
    const idToken = authHeader.split(" ")[1];

    let decoded;
    try {
      decoded = await firebaseAuth.verifyIdToken(idToken, true);
    } catch (verifyErr) {
      return sendError(req, res, 401, tokenFailureCode(verifyErr));
    }

    const uid = decoded.uid;
    // Same NOT NULL + UNIQUE fallback auth.ts's /login uses when a token has
    // no email on it.
    const email = decoded.email ?? `${uid}@placeholder.firebase`;
    const emailVerified = decoded.email_verified ?? false;

    const { display_name, profile_image, auth_provider, provider_user_id, age_consent } =
      req.body ?? {};

    // 1. Find the row by firebase_uid — the only trusted identity. Doing
    // this FIRST (rather than the old ON CONFLICT (email) DO UPDATE) is what
    // makes a Firebase-side email change (same uid, new email — e.g. after
    // verifyBeforeUpdateEmail) resolve to an UPDATE of this exact row below,
    // instead of an INSERT attempt that collides on usdusers_firebase_uid_key
    // because the old row (still holding the old email) already owns that uid.
    const existingResult = await pool.query<{
      id: number;
      firebase_uid: string | null;
      email: string;
      is_active: boolean;
    }>(
      `SELECT id, firebase_uid, email, is_active FROM usdusers WHERE firebase_uid = $1`,
      [uid],
    );
    let existing = existingResult.rows[0];

    // 2. First-time link for a pre-Firebase (migrated bcrypt) row ONLY: a row
    // that already owns this email but has never been claimed by any
    // Firebase identity (firebase_uid IS NULL) and isn't deactivated, gated
    // on the token's OWN verified email — an unverified, self-attested email
    // is not proof of ownership and must never claim someone else's row.
    if (!existing && emailVerified) {
      const relinked = await pool.query<{
        id: number;
        firebase_uid: string | null;
        email: string;
        is_active: boolean;
      }>(
        `UPDATE usdusers
            SET firebase_uid = $1, last_login = NOW()
          WHERE email = $2 AND firebase_uid IS NULL AND is_active = true
        RETURNING id, firebase_uid, email, is_active`,
        [uid, email],
      );
      existing = relinked.rows[0];
    }

    if (existing && existing.is_active === false) {
      return sendError(req, res, 403, "AUTH_USER_DISABLED");
    }

    // 3. Conflict + cooldown check whenever the target email isn't already
    // this row's own — covers both a brand-new signup and a confirmed
    // Firebase-side email change. Never let a blind INSERT/UPDATE silently
    // collide with, or worse, overwrite fields on, a DIFFERENT user's row.
    if (!existing || existing.email.toLowerCase() !== email.toLowerCase()) {
      const conflictOwner = await findConflictingEmailOwner(pool, email, uid);
      const decision = decideEmailChange({
        currentEmailVerified: true,
        existingOwner: conflictOwner,
      });

      if (!decision.allowed) {
        return sendEmailChangeRejection(req, res, decision);
      }

      if (decision.releaseFromUserId) {
        await releaseDeactivatedEmailOwner(pool, decision.releaseFromUserId, email);
      }
    }

    // 4. Write, scoped to firebase_uid — UPDATE the caller's own existing
    // row, or INSERT a fresh one. Never an ON CONFLICT (email) DO UPDATE
    // that could silently touch a different row.
    //
    // role is never client-writable (always 'user' on insert — no
    // authorization anywhere reads this column today, but it must never
    // become attacker-controlled, and is left untouched on update).
    // email/email_verified/firebase_uid come from the verified Firebase
    // token above, never the request body. email_verified only ratchets
    // true->true; a later unverified token can't un-verify a row that a
    // prior verified token already confirmed.
    let result;
    try {
      if (existing) {
        result = await pool.query<User>(
          `UPDATE usdusers SET
             email             = $2,
             display_name      = COALESCE($3, display_name),
             profile_image     = COALESCE($4, profile_image),
             email_verified    = $5 OR email_verified,
             provider_user_id  = COALESCE($6, provider_user_id),
             age_consent       = COALESCE($7, age_consent),
             last_login        = NOW()
           WHERE firebase_uid = $1
           RETURNING id, display_name, email, profile_image, role, email_verified, age_consent`,
          [
            uid,
            email,
            display_name ?? null,
            profile_image ?? null,
            emailVerified,
            provider_user_id ?? null,
            age_consent ?? false,
          ],
        );
      } else {
        result = await pool.query<User>(
          `INSERT INTO usdusers
             (firebase_uid, email, display_name, profile_image, auth_provider, role, email_verified, provider_user_id, age_consent, created_at, last_login)
           VALUES ($1, $2, $3, $4, $5, 'user', $6, $7, $8, NOW(), NOW())
           RETURNING id, display_name, email, profile_image, role, email_verified, age_consent`,
          [
            uid,
            email,
            display_name ?? null,
            profile_image ?? null,
            auth_provider ?? null,
            emailVerified,
            provider_user_id ?? null,
            age_consent ?? false,
          ],
        );
      }
    } catch (err) {
      const pgErr = err as { code?: string; constraint?: string };
      if (pgErr.code === "23505") {
        // Last-resort backstop against a concurrent request racing for the
        // same email or uid between the checks above and this write — not
        // the primary defense.
        console.error(
          `[POST /user] 409 — race on ${pgErr.constraint} for uid=${uid}, email="${email}"`,
        );
        return sendError(
          req,
          res,
          409,
          "EMAIL_ALREADY_IN_USE",
          "This email address is already associated with a different account. Please try again.",
        );
      }
      throw err;
    }

    const row = result.rows[0];
    res.status(200).json({
      id: row.id,
      display_name: row.display_name,
      email: row.email,
      profile_image: row.profile_image,
      role: row.role,
      email_verified: row.email_verified,
      age_consent: row.age_consent,
    });
  } catch (error) {
    sendInternalError(req, res, error, "error/upserting/user");
  }
});

export default router;
