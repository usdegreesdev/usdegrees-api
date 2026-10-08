import type { Pool, PoolClient } from "pg";
import { cooldownEligibleAt, isWithinCooldown } from "../utils/deactivationCooldown";

/** Anything with pg's `.query()` — a `Pool` or a checked-out `PoolClient`. */
export type Queryable = Pick<Pool, "query"> | Pick<PoolClient, "query">;

export type EmailChangeRejectionCode =
  | "CURRENT_EMAIL_NOT_VERIFIED"
  | "EMAIL_ALREADY_IN_USE"
  | "EMAIL_IN_COOLDOWN";

export type EmailChangeDecision =
  | { allowed: true; releaseFromUserId?: number }
  | {
      allowed: false;
      code: EmailChangeRejectionCode;
      message: string;
      /** ISO 8601 UTC; only set for EMAIL_IN_COOLDOWN. */
      eligibleAt?: string;
    };

export interface ExistingEmailOwner {
  id: number;
  isActive: boolean;
  deactivatedAt: string | null;
}

/**
 * Pure decision for whether an authenticated user may change their email to
 * a target address that may already be associated with another usdusers
 * row — verified, unverified, or deactivated and still inside (or past) its
 * reuse cooldown.
 *
 * `existingOwner` must already exclude the requesting user's own row —
 * same-email-as-self is a caller-side no-op, not a conflict, and is not
 * something this function decides.
 */
export function decideEmailChange(params: {
  currentEmailVerified: boolean;
  existingOwner: ExistingEmailOwner | null;
  now?: number;
}): EmailChangeDecision {
  if (!params.currentEmailVerified) {
    return {
      allowed: false,
      code: "CURRENT_EMAIL_NOT_VERIFIED",
      message:
        "Verify your current email address before requesting a change.",
    };
  }

  const owner = params.existingOwner;
  if (!owner) {
    return { allowed: true };
  }

  if (owner.isActive === false && owner.deactivatedAt) {
    if (isWithinCooldown(owner.deactivatedAt, params.now)) {
      return {
        allowed: false,
        code: "EMAIL_IN_COOLDOWN",
        message:
          "This email was recently deleted and is still in its cooldown period. Please try again later.",
        eligibleAt: new Date(cooldownEligibleAt(owner.deactivatedAt)).toISOString(),
      };
    }
    // Cooldown elapsed: the deactivated row still holds the email column
    // (kept for records) and must be released before it can be reused.
    return { allowed: true, releaseFromUserId: owner.id };
  }

  return {
    allowed: false,
    code: "EMAIL_ALREADY_IN_USE",
    message: "This email address is already associated with another account.",
  };
}

/**
 * Any OTHER usdusers row already holding `email` (case-insensitive) —
 * verified or not, active or deactivated — excluding the caller's own row by
 * `firebase_uid`. Shared by every write path that can change usdusers.email
 * (PATCH /account/email, and the Firebase-email-change sync in /auth/login
 * and /auth/apple), so none of them can re-derive this check slightly
 * differently and drift out of sync with the others.
 */
export async function findConflictingEmailOwner(
  db: Queryable,
  email: string,
  excludeFirebaseUid: string,
): Promise<ExistingEmailOwner | null> {
  const result = await db.query<{
    id: number;
    is_active: boolean;
    deactivated_at: string | null;
  }>(
    `SELECT id, is_active, deactivated_at FROM usdusers
      WHERE LOWER(email) = $1 AND firebase_uid IS DISTINCT FROM $2`,
    [email.toLowerCase(), excludeFirebaseUid],
  );
  const row = result.rows[0];
  return row
    ? { id: row.id, isActive: row.is_active, deactivatedAt: row.deactivated_at }
    : null;
}

/**
 * Releases a deactivated row's claim on `email` once decideEmailChange has
 * confirmed its cooldown has elapsed — renamed to a namespaced placeholder
 * (kept for records) so the caller can then claim the bare address. Mirrors
 * the release POST /user already does for brand-new signups reusing a
 * cooled-down email.
 */
export async function releaseDeactivatedEmailOwner(
  db: Queryable,
  ownerId: number,
  email: string,
): Promise<void> {
  await db.query(`UPDATE usdusers SET email = $1 WHERE id = $2`, [
    `deleted+${ownerId}+${email}`,
    ownerId,
  ]);
}
