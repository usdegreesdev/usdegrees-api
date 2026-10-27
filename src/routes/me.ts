import { Router, Response } from "express";
import { verifyToken } from "../middleware/auth";
import { AuthRequest } from "../types/user";
import { sendError, sendInternalError } from "../utils/apiError";
import { getBillingDetails } from "../services/billing.service";

const router = Router();

/** Absent → undefined; a positive-integer string → number; anything else → null (invalid). */
function parseCursor(v: unknown): number | undefined | null {
  if (v === undefined) return undefined;
  if (typeof v !== "string" || !/^[1-9]\d{0,9}$/.test(v)) return null;
  const n = Number(v);
  return n <= 2_147_483_647 ? n : null;
}

/**
 * GET /me/billing — plan, credits, purchases and credit usage for the
 * signed-in user. The user comes ONLY from the verified JWT (req.userId);
 * no id is read from the query or body. ?purchasesCursor= / ?usageCursor=
 * page each list (use the next*Cursor values from the previous response).
 */
router.get("/billing", verifyToken, async (req: AuthRequest, res: Response) => {
  try {
    const purchasesCursor = parseCursor(req.query.purchasesCursor);
    const usageCursor = parseCursor(req.query.usageCursor);
    if (purchasesCursor === null || usageCursor === null) {
      return sendError(req, res, 400, "INVALID_REQUEST");
    }
    const details = await getBillingDetails(req.userId!, { purchasesCursor, usageCursor });
    if (!details) return sendError(req, res, 404, "NOT_FOUND");
    res.json(details);
  } catch (err) {
    sendInternalError(req, res, err, "me/billing");
  }
});

export default router;
