import { Router, Request, Response } from "express";
import jwt, { SignOptions } from "jsonwebtoken";
import { jwtVerify, createRemoteJWKSet, JWTPayload } from "jose";
import { DecodedIdToken } from "firebase-admin/auth";
import { firebaseAuth } from "../config/firebase";
import pool from "../db/client";
import { verifyToken } from "../middleware/auth";
import { User, UserProfile, ApiError, AuthRequest } from "../types/user";

import { JWT_SECRET as SECRET } from "../config/jwt";
import { authRateLimit } from "../middleware/rateLimit";
import { sendError, sendInternalError, tokenFailureCode } from "../utils/apiError";
import {
  decideEmailChange,
  findConflictingEmailOwner,
  releaseDeactivatedEmailOwner,
} from "../services/emailChange.service";

const router = Router();
const APP_JWT_TTL = process.env.APP_JWT_TTL || "30m";
const APP_JWT_SIGN_OPTIONS = {
  algorithm: "HS256",
  expiresIn: APP_JWT_TTL,
} as SignOptions;

// jwt.sign parses the TTL string at call time, so a malformed APP_JWT_TTL
// ("half an hour", "30 secs plz") would otherwise turn every login into a 500. Sign a
// throwaway token at module load to exercise that exact parser — no hand-rolled
// format check to drift out of sync with jsonwebtoken's accepted formats.
try {
  jwt.sign({}, SECRET, APP_JWT_SIGN_OPTIONS);
} catch (error) {
  throw new Error(
    `Invalid APP_JWT_TTL: ${JSON.stringify(APP_JWT_TTL)}. ` +
      `Expected a jsonwebtoken duration such as "30m", "1h", or a number of seconds. ` +
      `(${error instanceof Error ? error.message : String(error)})`,
  );
}

const APPLE_ISSUER = "https://appleid.apple.com";
const APPLE_CLIENT_ID = process.env.APPLE_CLIENT_ID;
// createRemoteJWKSet caches the JWKS response internally and re-fetches
// on a `kid` cache miss, so no separate caching layer is needed here.
const appleJwks = createRemoteJWKSet(new URL(`${APPLE_ISSUER}/auth/keys`));

const USER_COLUMNS =
  "id, firebase_uid, email, display_name, profile_image, role, email_verified, is_active, age_consent";

/**
 * Map Firebase's `firebase.sign_in_provider` onto an auth_provider value the
 * usdusers CHECK constraint accepts (google | apple | microsoft | credentials).
 * Email/password and anything unrecognized fall back to 'credentials'.
 */
function mapAuthProvider(signInProvider?: string): string {
  switch (signInProvider) {
    case "google.com":
      return "google";
    case "apple.com":
      return "apple";
    case "microsoft.com":
      return "microsoft";
    default:
      return "credentials";
  }
}

function toProfile(user: User): UserProfile {
  return {
    id: user.id,
    display_name: user.display_name,
    email: user.email,
    profile_image: user.profile_image,
    role: user.role,
    email_verified: user.email_verified,
    age_consent: user.age_consent,
  };
}

/**
 * POST /auth/login
 * Token exchange: verifies a Firebase ID token and mints a short-lived app JWT.
 *
 * Body:   { idToken: string }   (Firebase ID token from the frontend)
 * Returns: { token: string }    (app JWT, sub = Firebase UID)
 *
 * This is the ONLY endpoint that accepts a Firebase token. Everything else
 * uses the app JWT via the verifyToken middleware.
 */
router.post(
  "/login",
  authRateLimit,
  async (
    req: Request<{}, { token: string } | ApiError, { idToken?: string }>,
    res: Response,
  ) => {
    console.log("[auth/login] hit", {
      hasIdToken: !!req.body?.idToken,
      from: req.ip,
    });
    try {
      // req.body can be undefined in Express 5 when no JSON body is sent.
      const idToken = req.body?.idToken;

      if (!idToken) {
        console.warn("[auth/login] 400 — missing idToken in body");
        return sendError(req, res, 400, "AUTH_TOKEN_MISSING");
      }

      // Verify the Firebase token with the revoked-check enabled.
      let decoded: DecodedIdToken;
      try {
        decoded = await firebaseAuth.verifyIdToken(idToken, true);
      } catch (err) {
        const code = (err as { code?: string })?.code ?? "unknown";
        const message = err instanceof Error ? err.message : String(err);
        console.warn(
          `[auth/login] 401 — verifyIdToken failed (code=${code}): ${message}`,
        );
        return sendError(req, res, 401, tokenFailureCode(err));
      }

      console.log(`[auth/login] token verified for uid=${decoded.uid}`);

      const uid = decoded.uid;
      const email = decoded.email ?? null;
      const emailVerified = decoded.email_verified ?? false;

      // Fallbacks for NOT NULL columns the token may not supply.
      // email is NOT NULL + UNIQUE; if a token ever lacks one, key a placeholder
      // off the uid so we never insert null or collide.
      const emailValue = email ?? `${uid}@placeholder.firebase`;
      const displayName =
        decoded.name || (email ? email.split("@")[0] : null) || "New User";

      // auth_provider has a CHECK constraint: google | apple | microsoft |
      // credentials. Map Firebase's sign_in_provider onto an allowed value.
      const authProvider = mapAuthProvider(decoded.firebase?.sign_in_provider);

      // 1. Find the row by Firebase UID — the only trusted identity.
      let result = await pool.query<User>(
        `SELECT ${USER_COLUMNS} FROM usdusers WHERE firebase_uid = $1`,
        [uid],
      );
      let user = result.rows[0];

      // 2. First-time link for a pre-Firebase (migrated bcrypt) row ONLY:
      //    a row that already owns this email but has never been claimed by
      //    any Firebase identity (firebase_uid IS NULL) and isn't
      //    deactivated. Gated on the INCOMING TOKEN'S email_verified — an
      //    unverified, self-attested email is not proof of ownership and
      //    must never be enough to claim someone else's existing row (that
      //    was the account-takeover-by-email-match hole this replaces: the
      //    previous version relinked on a bare email match with no
      //    verification, firebase_uid-null, or is_active check at all, and
      //    could reassign ANY existing account — including one already
      //    claimed by a different firebase_uid — to an attacker who merely
      //    typed the same email string).
      if (!user && email && emailVerified) {
        const relinked = await pool.query<User>(
          `UPDATE usdusers
              SET firebase_uid = $1, last_login = NOW()
            WHERE email = $2 AND firebase_uid IS NULL AND is_active = true
          RETURNING ${USER_COLUMNS}`,
          [uid, email],
        );
        user = relinked.rows[0];
        if (user) {
          console.warn(
            `[auth/login] linked pre-Firebase usdusers.id=${user.id} (email="${email}") to firebase_uid=${uid}`,
          );
        }
      }

      // 3. Reject soft-deleted accounts.
      if (user && user.is_active === false) {
        return sendError(req, res, 403, "AUTH_USER_DISABLED");
      }

      // 4. Detect a target email this row doesn't already legitimately own —
      //    either a brand-new signup (no row yet) or a confirmed Firebase-side
      //    email change (found by firebase_uid, token email differs from
      //    what's on file — Firebase already required the user to click a
      //    verification link at the NEW address via verifyBeforeUpdateEmail
      //    before its own record updated). Either way, run the SAME
      //    ownership + cooldown check PATCH /account/email enforces before
      //    ever writing this email onto a row — never trust the token's
      //    email blindly, and never let the raw UNIQUE constraint be the
      //    only thing standing between this and an account hijack.
      const targetEmail = user ? user.email : emailValue;
      if (!user || targetEmail.toLowerCase() !== emailValue.toLowerCase()) {
        const conflictOwner = await findConflictingEmailOwner(
          pool,
          emailValue,
          uid,
        );
        const decision = decideEmailChange({
          currentEmailVerified: true,
          existingOwner: conflictOwner,
        });

        if (!decision.allowed) {
          console.warn(
            `[auth/login] blocked — uid=${uid} tried to claim email="${emailValue}": ${decision.code}`,
          );
          return sendError(
            req,
            res,
            decision.code === "EMAIL_ALREADY_IN_USE" ? 409 : 403,
            decision.code,
            decision.message,
          );
        }

        if (decision.releaseFromUserId) {
          await releaseDeactivatedEmailOwner(
            pool,
            decision.releaseFromUserId,
            emailValue,
          );
        }
      }

      // 5. Idempotent upsert keyed on firebase_uid: insert on first login,
      //    otherwise mirror email/email_verified and bump last_login. Profile
      //    fields (display_name, profile_image) are only set on insert so we
      //    never clobber edits the user made via PATCH /profile. The conflict
      //    + cooldown check above already ran, so this should never hit
      //    usdusers_email_key — the catch below is a last-resort backstop
      //    against a concurrent request racing for the same email between
      //    that check and this write, not the primary defense.
      try {
        const upserted = await pool.query<User>(
          `INSERT INTO usdusers
             (firebase_uid, email, display_name, profile_image, email_verified,
              auth_provider, role, is_active, created_at, last_login)
           VALUES ($1, $2, $3, $4, $5, $6, 'student', true, NOW(), NOW())
           ON CONFLICT (firebase_uid) DO UPDATE SET
             email          = EXCLUDED.email,
             email_verified = EXCLUDED.email_verified,
             last_login     = NOW()
           RETURNING ${USER_COLUMNS}`,
          [
            uid,
            emailValue,
            displayName,
            decoded.picture ?? null,
            emailVerified,
            authProvider,
          ],
        );
        user = upserted.rows[0];
      } catch (err) {
        const pgErr = err as { code?: string; constraint?: string };
        if (
          pgErr.code === "23505" &&
          pgErr.constraint === "usdusers_email_key"
        ) {
          console.error(
            `[auth/login] 409 — email collision racing uid=${uid} for email="${emailValue}"`,
          );
          return sendError(
            req,
            res,
            409,
            "EMAIL_ALREADY_IN_USE",
            "This email address is already associated with a different account. Please contact support to resolve this before signing in again.",
          );
        }
        throw err;
      }

      const token = jwt.sign({ sub: uid }, SECRET, APP_JWT_SIGN_OPTIONS);
      console.log(`[auth/login] 200 — app JWT issued for uid=${uid}`);
      return res.json({ token });
    } catch (error) {
      return sendInternalError(req, res, error, "auth/login", "AUTH_EXCHANGE_FAILED");
    }
  },
);

/**
 * POST /auth/apple
 * Verifies an Apple identity token directly against Apple's JWKS — independent
 * of the Firebase-based /auth/login flow — and mints the same kind of app JWT.
 *
 * Body:   { id_token: string }   (Apple identity token from Sign in with Apple)
 * Returns: { token: string, firebaseToken: string, user: UserProfile }
 *
 * Unlike /auth/login this returns the full user object inline, since there's
 * no separate Firebase-driven /auth/me sync call in the Apple flow.
 *
 * `firebaseToken` is a Firebase custom token (uid = appleUid) minted in
 * addition to the app JWT. The Google/Microsoft/email flow gets its "stay
 * logged in across a refresh" behavior for free from the Firebase client SDK's
 * persisted session (established via signInWithPopup/signInWithCredential
 * *before* the frontend ever calls this API). Sign in with Apple never goes
 * through the Firebase client SDK, so without this token Apple users have no
 * persisted session for the frontend to restore on reload — only a bare
 * short-lived app JWT that silently expires. The frontend must call
 * `signInWithCustomToken(firebaseToken)` right after this request so Apple
 * users get the same persisted Firebase session everyone else gets.
 */
router.post(
  "/apple",
  authRateLimit,
  async (
    req: Request<
      {},
      { token: string; firebaseToken: string; user: UserProfile } | ApiError,
      { id_token?: string; full_name?: string }
    >,
    res: Response<
      { token: string; firebaseToken: string; user: UserProfile } | ApiError
    >,
  ) => {
    try {
      const idToken = req.body?.id_token;

      if (!idToken) {
        return sendError(req, res, 400, "AUTH_TOKEN_MISSING");
      }

      if (!APPLE_CLIENT_ID) {
        console.error(`[auth/apple] requestId=${req.requestId} APPLE_CLIENT_ID is not configured`);
        return sendError(req, res, 500, "AUTH_EXCHANGE_FAILED");
      }

      let payload: JWTPayload;
      try {
        ({ payload } = await jwtVerify(idToken, appleJwks, {
          issuer: APPLE_ISSUER,
          audience: APPLE_CLIENT_ID,
        }));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(`[auth/apple] 401 — jwtVerify failed: ${message}`);
        return sendError(req, res, 401, tokenFailureCode(err));
      }

      const sub = payload.sub;
      if (!sub) {
        return sendError(req, res, 401, "AUTH_TOKEN_INVALID");
      }

      // Firebase custom-token uids must be <=128 chars (enforced client-side
      // by firebase-admin, no network round-trip). We namespace `sub` with an
      // "apple:" prefix below, which eats 6 of that budget — reject rather
      // than silently truncate, since truncating risks colliding two
      // different Apple accounts whose `sub` differs only past the cut.
      if (`apple:${sub}`.length > 128) {
        console.error(
          `[auth/apple] 400 — Apple sub too long for Firebase uid (len=${sub.length})`,
        );
        return sendError(req, res, 400, "AUTH_TOKEN_INVALID");
      }

      const email = typeof payload.email === "string" ? payload.email : null;
      // Apple encodes this as a boolean or a stringified boolean depending on
      // token version, so normalize both.
      const emailVerified =
        payload.email_verified === true || payload.email_verified === "true";

      const emailValue = email ?? `${sub}@privaterelay.appleid.com`;
      // Apple only sends full_name on the very first authorization for a given
      // sub — the frontend passes it through here so we can seed display_name
      // at account creation. It's ignored below on every subsequent login
      // (the INSERT...ON CONFLICT never overwrites display_name), so there's
      // no need to gate this on "is this a new user" — it just never matters
      // again once the row exists.
      const fullName = req.body?.full_name?.trim() || null;
      const displayName =
        fullName || (email ? email.split("@")[0] : "New User");

      // Namespace the Apple `sub` into firebase_uid so this row keys the same
      // way Firebase-issued users do — verifyToken and GET /auth/me look users
      // up by firebase_uid = JWT `sub`, and reusing that column here avoids
      // touching either of them for a second identity source.
      const appleUid = `apple:${sub}`;

      // 1. Find the row by provider_user_id (Apple's stable subject).
      let result = await pool.query<User>(
        `SELECT ${USER_COLUMNS} FROM usdusers WHERE provider_user_id = $1 AND auth_provider = 'apple'`,
        [sub],
      );
      let user = result.rows[0];

      // 2. First-time link for an existing account (e.g. Google or
      //    credentials) signing in with Apple for the first time — ONLY when
      //    that row has never been claimed by any Firebase/provider identity
      //    (firebase_uid IS NULL) and isn't deactivated, and ONLY when Apple
      //    itself attests the email is verified. Previously this matched on
      //    a bare email string with no verification, no firebase_uid-null
      //    check, and no is_active check — meaning it could reassign ANY
      //    existing account, including one already claimed by a different
      //    identity, to whoever authenticated with the same email string.
      //    That is exactly the account-takeover-by-email-match this closes.
      if (!user && email && emailVerified) {
        const relinked = await pool.query<User>(
          `UPDATE usdusers
              SET firebase_uid = $1, provider_user_id = $2, last_login = NOW()
            WHERE email = $3 AND firebase_uid IS NULL AND is_active = true
          RETURNING ${USER_COLUMNS}`,
          [appleUid, sub, email],
        );
        user = relinked.rows[0];
        if (user) {
          console.warn(
            `[auth/apple] linked pre-existing usdusers.id=${user.id} (email="${email}") to provider_user_id=${sub}`,
          );
        }
      }

      if (user && user.is_active === false) {
        return sendError(req, res, 403, "AUTH_USER_DISABLED");
      }

      // 3. Same conflict + cooldown check /auth/login runs before ever
      //    writing an email onto a row: covers a brand-new sign-in (no row
      //    yet) and a confirmed email change (row found by provider_user_id,
      //    Apple's token email differs from what's on file).
      const targetEmail = user ? user.email : emailValue;
      if (!user || targetEmail.toLowerCase() !== emailValue.toLowerCase()) {
        const conflictOwner = await findConflictingEmailOwner(
          pool,
          emailValue,
          appleUid,
        );
        const decision = decideEmailChange({
          currentEmailVerified: true,
          existingOwner: conflictOwner,
        });

        if (!decision.allowed) {
          console.warn(
            `[auth/apple] blocked — sub=${sub} tried to claim email="${emailValue}": ${decision.code}`,
          );
          return sendError(
            req,
            res,
            decision.code === "EMAIL_ALREADY_IN_USE" ? 409 : 403,
            decision.code,
            decision.message,
          );
        }

        if (decision.releaseFromUserId) {
          await releaseDeactivatedEmailOwner(
            pool,
            decision.releaseFromUserId,
            emailValue,
          );
        }
      }

      // 4. Idempotent upsert keyed on firebase_uid (the column with the
      //    UNIQUE constraint — see firebase_auth.sql): insert on first
      //    sign-in, otherwise mirror email/email_verified and bump
      //    last_login. Profile fields are only set on insert so we never
      //    clobber PATCH edits. The conflict + cooldown check above already
      //    ran, so this is a last-resort backstop against a concurrent
      //    request racing for the same email, not the primary defense.
      try {
        const upserted = await pool.query<User>(
          `INSERT INTO usdusers
             (firebase_uid, provider_user_id, email, display_name, profile_image,
              email_verified, auth_provider, role, is_active, created_at, last_login)
           VALUES ($1, $2, $3, $4, NULL, $5, 'apple', 'student', true, NOW(), NOW())
           ON CONFLICT (firebase_uid) DO UPDATE SET
             email             = EXCLUDED.email,
             email_verified    = EXCLUDED.email_verified,
             provider_user_id  = EXCLUDED.provider_user_id,
             last_login        = NOW()
           RETURNING ${USER_COLUMNS}`,
          [appleUid, sub, emailValue, displayName, emailVerified],
        );
        user = upserted.rows[0];
      } catch (err) {
        const pgErr = err as { code?: string; constraint?: string };
        if (pgErr.code === "23505" && pgErr.constraint === "usdusers_email_key") {
          console.error(
            `[auth/apple] 409 — email collision racing sub=${sub} for email="${emailValue}"`,
          );
          return sendError(
            req,
            res,
            409,
            "EMAIL_ALREADY_IN_USE",
            "This email address is already associated with a different account. Please contact support to resolve this before signing in again.",
          );
        }
        throw err;
      }

      const token = jwt.sign(
        { sub: user.firebase_uid },
        SECRET,
        APP_JWT_SIGN_OPTIONS,
      );

      // Mint a Firebase custom token for the same uid so the frontend can
      // establish a real Firebase client session (see JSDoc above) — that's
      // what makes the login survive a page refresh, same as every other
      // provider.
      let firebaseToken: string;
      try {
        firebaseToken = await firebaseAuth.createCustomToken(appleUid);
      } catch (err) {
        return sendInternalError(req, res, err, "auth/apple createCustomToken", "AUTH_EXCHANGE_FAILED");
      }

      return res.json({ token, firebaseToken, user: toProfile(user) });
    } catch (error) {
      return sendInternalError(req, res, error, "auth/apple", "AUTH_EXCHANGE_FAILED");
    }
  },
);

/**
 * GET /auth/me
 * Alias of GET /profile — returns the current user's profile from the app JWT.
 * Kept for frontend backward-compatibility.
 */
router.get(
  "/me",
  verifyToken,
  async (req: AuthRequest, res: Response<UserProfile | ApiError>) => {
    try {
      const result = await pool.query<User>(
        `SELECT ${USER_COLUMNS} FROM usdusers WHERE firebase_uid = $1`,
        [req.userId],
      );

      if (result.rows.length === 0) {
        return sendError(req, res, 403, "AUTH_USER_DISABLED");
      }

      res.json(toProfile(result.rows[0]));
    } catch (error) {
      sendInternalError(req, res, error, "auth/me");
    }
  },
);

export default router;
