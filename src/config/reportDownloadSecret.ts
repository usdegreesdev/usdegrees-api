/**
 * Report-download token secret loader. Deliberately separate from JWT_SECRET
 * (see config/jwt.ts) — download tokens are embedded in URLs and emailed to
 * users, giving them far more exposure surface (browser history, email
 * archives, proxy/access logs, Referer headers) than an app-auth Bearer
 * token ever has. Sharing a secret between the two means a leak surfaced via
 * the more-exposed channel compromises full account-auth as well. Fails at
 * boot rather than silently falling back to JWT_SECRET, so a misconfigured
 * deploy never goes live re-coupling the two.
 */
const secret = process.env.REPORT_DOWNLOAD_TOKEN_SECRET;

if (!secret || secret.trim().length === 0) {
  throw new Error(
    "REPORT_DOWNLOAD_TOKEN_SECRET environment variable is not set. Refusing to start: " +
      "report-download tokens must not be signed with the app auth JWT secret.",
  );
}

export const REPORT_DOWNLOAD_TOKEN_SECRET = secret;
