import jwt, { SignOptions, VerifyOptions } from "jsonwebtoken";
import { REPORT_DOWNLOAD_TOKEN_SECRET as SECRET } from "../config/reportDownloadSecret";

const EXPIRES_IN_MINUTES = 12; // within the required 10-15 min window
const TOKEN_TYPE = "report_download";
const SIGN_OPTIONS: SignOptions = {
  algorithm: "HS256",
  expiresIn: `${EXPIRES_IN_MINUTES}m`,
};
const VERIFY_OPTIONS: VerifyOptions = { algorithms: ["HS256"] };

interface ReportDownloadTokenPayload {
  reportRef: string;
  type: typeof TOKEN_TYPE;
}

/** Issue a short-lived, single-purpose token authorizing download of one report's PDF. */
export function signReportDownloadToken(reportReferenceId: string): { token: string; expiresAt: Date } {
  const payload: ReportDownloadTokenPayload = {
    reportRef: reportReferenceId,
    type: TOKEN_TYPE,
  };
  const token = jwt.sign(payload, SECRET, SIGN_OPTIONS);
  const expiresAt = new Date(Date.now() + EXPIRES_IN_MINUTES * 60 * 1000);
  return { token, expiresAt };
}

/** Verify a download token, returning the report_reference_id it authorizes, or null if invalid/expired. */
export function verifyReportDownloadToken(token: string): string | null {
  try {
    const payload = jwt.verify(token, SECRET, VERIFY_OPTIONS) as ReportDownloadTokenPayload;
    if (payload.type !== TOKEN_TYPE) return null;
    return payload.reportRef || null;
  } catch {
    return null;
  }
}
