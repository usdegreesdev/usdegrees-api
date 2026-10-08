import { Request, Response } from "express";

/**
 * Stable, client-facing error contract:
 *
 *   { error: { code: "<STABLE_CODE>", message: "<safe generic text>" }, requestId }
 *
 * `code` is what the frontend maps on; `message` is a fixed, human-safe string
 * that never contains pg / Firebase / jsonwebtoken / crypto text. The full
 * error is logged server-side against `requestId` only.
 */
export type ErrorCode =
  | "AUTH_TOKEN_MISSING"
  | "AUTH_TOKEN_INVALID"
  | "AUTH_TOKEN_EXPIRED"
  | "AUTH_USER_DISABLED"
  | "AUTH_EXCHANGE_FAILED"
  | "PROFILE_INVALID"
  | "EMAIL_ALREADY_IN_USE"
  | "EMAIL_IN_COOLDOWN"
  | "CURRENT_EMAIL_NOT_VERIFIED"
  | "RATE_LIMITED"
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "INVALID_REQUEST"
  | "INTERNAL_ERROR";

const DEFAULT_MESSAGES: Record<ErrorCode, string> = {
  AUTH_TOKEN_MISSING: "Authentication is required.",
  AUTH_TOKEN_INVALID: "Authentication failed.",
  AUTH_TOKEN_EXPIRED: "Your session has expired. Please sign in again.",
  AUTH_USER_DISABLED: "This account is unavailable.",
  AUTH_EXCHANGE_FAILED: "Sign-in could not be completed. Please try again.",
  PROFILE_INVALID: "The profile data provided is invalid.",
  EMAIL_ALREADY_IN_USE: "This email address is already associated with another account.",
  EMAIL_IN_COOLDOWN: "This email address is temporarily unavailable. Please try again later.",
  CURRENT_EMAIL_NOT_VERIFIED: "Please verify your current email address first.",
  RATE_LIMITED: "Too many requests. Please try again later.",
  NOT_FOUND: "Not found.",
  FORBIDDEN: "Forbidden.",
  INVALID_REQUEST: "The request is invalid.",
  INTERNAL_ERROR: "Something went wrong. Please try again.",
};

export interface ApiErrorBody {
  error: { code: ErrorCode; message: string };
  requestId: string;
  /** Only ever present when NODE_ENV === "development". */
  debug?: { name?: string; message?: string };
}

/** Detailed output is opt-in for local development only - never in prod/unset. */
function debugEnabled(): boolean {
  return process.env.NODE_ENV === "development";
}

export function errorBody(
  req: Request,
  code: ErrorCode,
  message?: string,
  cause?: unknown,
): ApiErrorBody {
  const body: ApiErrorBody = {
    error: { code, message: message ?? DEFAULT_MESSAGES[code] },
    requestId: req.requestId ?? "unknown",
  };
  if (cause !== undefined && debugEnabled()) {
    body.debug =
      cause instanceof Error
        ? { name: cause.name, message: cause.message }
        : { message: String(cause) };
  }
  return body;
}

/**
 * Sends a safe error. `message` must be app-authored text (never derived from
 * a caught exception); omit it to use the code's default.
 */
export function sendError(
  req: Request,
  res: Response,
  status: number,
  code: ErrorCode,
  message?: string,
): void {
  res.status(status).json(errorBody(req, code, message));
}

/**
 * Logs the full error server-side with the request id, then sends a safe
 * generic body. Use in every catch block that previously echoed the error.
 */
export function sendInternalError(
  req: Request,
  res: Response,
  err: unknown,
  context: string,
  code: ErrorCode = "INTERNAL_ERROR",
  status = 500,
): void {
  console.error(`[${context}] requestId=${req.requestId ?? "unknown"}`, err);
  res.status(status).json(errorBody(req, code, undefined, err));
}

/**
 * Maps a token-verification failure from Firebase Admin, jose, or
 * jsonwebtoken onto AUTH_TOKEN_EXPIRED / AUTH_TOKEN_INVALID. Anything that
 * isn't clearly "expired" is INVALID - never revealing why.
 */
export function tokenFailureCode(err: unknown): "AUTH_TOKEN_EXPIRED" | "AUTH_TOKEN_INVALID" {
  const e = err as { name?: unknown; code?: unknown } | null;
  if (
    e?.name === "TokenExpiredError" || // jsonwebtoken
    e?.code === "auth/id-token-expired" || // firebase-admin
    e?.code === "ERR_JWT_EXPIRED" // jose
  ) {
    return "AUTH_TOKEN_EXPIRED";
  }
  return "AUTH_TOKEN_INVALID";
}
