import { randomUUID } from "crypto";
import { Request, Response, NextFunction } from "express";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Correlates a client-visible error with the full server-side log. */
      requestId?: string;
    }
  }
}

// An upstream proxy may already have assigned one; accept it only if it is a
// short, log-safe token so it can't smuggle newlines or markup into logs.
const SAFE_ID = /^[A-Za-z0-9._-]{8,64}$/;

export function requestId(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.header("x-request-id");
  req.requestId = incoming && SAFE_ID.test(incoming) ? incoming : randomUUID();
  res.setHeader("X-Request-Id", req.requestId);
  next();
}
