import { Request, Response, NextFunction } from "express";
import { errorBody } from "../utils/apiError";

/**
 * Global Express error handler - mount AFTER all routes.
 *
 * Whatever was thrown (Error, pg error, string, undefined...) the client gets
 * the safe { error: { code, message }, requestId } shape. The full error is
 * logged with the request id. Body-parser failures (malformed JSON, oversized
 * body) are the only errors whose status we pass through, and only as
 * INVALID_REQUEST with the generic message.
 */
export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (res.headersSent) {
    next(err);
    return;
  }

  const status = (err as { status?: unknown; statusCode?: unknown } | null)?.status ??
    (err as { statusCode?: unknown } | null)?.statusCode;
  const isClientError =
    typeof status === "number" &&
    status >= 400 &&
    status < 500 &&
    typeof (err as { type?: unknown }).type === "string"; // body-parser errors carry `type`

  console.error(
    `[error] requestId=${req.requestId ?? "unknown"} ${req.method} ${req.path}`,
    err,
  );

  if (isClientError) {
    res.status(status as number).json(errorBody(req, "INVALID_REQUEST", undefined, err));
    return;
  }
  res.status(500).json(errorBody(req, "INTERNAL_ERROR", undefined, err));
}
