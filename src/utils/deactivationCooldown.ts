/**
 * Hours a deactivated account's email must sit in cooldown before it can be
 * claimed again — by a brand-new signup (POST /user) or an existing user's
 * email change (PATCH /account/email). Single source of truth so neither path
 * can drift out of sync with the other.
 */
export const REACTIVATION_COOLDOWN_HOURS = 24;

export function cooldownEligibleAt(deactivatedAt: string | Date): number {
  const ts =
    deactivatedAt instanceof Date
      ? deactivatedAt.getTime()
      : new Date(deactivatedAt).getTime();
  return ts + REACTIVATION_COOLDOWN_HOURS * 60 * 60 * 1000;
}

export function isWithinCooldown(
  deactivatedAt: string | Date,
  now: number = Date.now(),
): boolean {
  return cooldownEligibleAt(deactivatedAt) > now;
}
