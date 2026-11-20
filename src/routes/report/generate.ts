import { Router, Response } from "express";
import pool from "../../db/client";
import { generateC1LiteReport } from "../../report/services/ai.service";
import { generateReportPdf } from "../../report/services/pdf.service";
import {
  attachReportPdfAndColleges,
  createPendingReport,
} from "../../report/services/reportHistory.service";
import { verifyToken } from "../../middleware/auth";
import { reportGenerationRateLimit } from "../../middleware/rateLimit";
import { AuthRequest } from "../../types/user";
import { cleanProgramName } from "../../report/utils/programName";
import { sendError, sendInternalError } from "../../utils/apiError";
import { ApiError, resolveUserId } from "./shared";

const router = Router();

interface SelectedCollegeEntry {
  unitid: number;
  cipCode?: string | null;
  programName?: string | null;
  credentialTitle?: string | null;
}

interface GenerateReportRequest {
  selectedColleges: SelectedCollegeEntry[];
  programId: number;
}

// Each request invokes Gemini and renders a PDF, so generation is rate-limited
// per authenticated user to control API and compute costs.
router.post(
  "/generate",
  verifyToken,
  reportGenerationRateLimit,
  async (req: AuthRequest, res: Response<{ reportId: string } | ApiError>) => {
    try {
      const { selectedColleges, programId } = req.body as GenerateReportRequest;
      const firebaseUid = req.userId;

      if (!firebaseUid) {
        return res.status(401).json({
          error: "Unauthorized: Missing user authentication context.",
        });
      }

      // Resolve the authenticated user's real id; never use another user's row.
      const userId = await resolveUserId(firebaseUid);
      if (!userId) {
        return res.status(404).json({ error: "User not found." });
      }

      if (!Array.isArray(selectedColleges) || selectedColleges.length === 0) {
        return res.status(400).json({
          error: "A non-empty selectedColleges array of school entries is required.",
        });
      }

      console.log(
        "[report/generate] incoming selectedColleges:",
        JSON.stringify(selectedColleges),
      );

      // Accept legacy unitids as well as per-program college entries.
      const invalidIndex = selectedColleges.findIndex((entry) => {
        const unitid =
          typeof entry === "object" && entry !== null
            ? (entry as SelectedCollegeEntry).unitid
            : entry;
        return (
          unitid == null ||
          !Number.isInteger(Number(unitid)) ||
          Number(unitid) <= 0
        );
      });
      if (invalidIndex !== -1) {
        return res.status(400).json({
          error: `Invalid school entry at index ${invalidIndex}: missing unitid`,
        });
      }

      const normalizedColleges = selectedColleges.map((entry) =>
        typeof entry === "object" && entry !== null
          ? {
              unitid: Number(entry.unitid),
              cipCode: entry.cipCode ?? null,
              programName: cleanProgramName(entry.programName),
              credentialTitle: entry.credentialTitle ?? null,
            }
          : {
              unitid: Number(entry),
              cipCode: null,
              programName: null,
              credentialTitle: null,
            },
      );

      // Per-entry CIP codes take precedence over the reference program's code.
      let programCip: string | undefined;
      if (programId) {
        const result = await pool.query<{ cip_code: string }>(
          "SELECT cip_code FROM programs WHERE id = $1",
          [programId],
        );
        programCip = result.rows[0]?.cip_code;
      }

      const { reportReferenceId, createdAt } = await createPendingReport(userId);
      const result = await generateC1LiteReport({
        userId,
        reportReferenceId,
        schools: normalizedColleges.map((college) => ({
          unitid: college.unitid,
          programCip: college.cipCode ?? programCip,
          programName: college.programName ?? undefined,
        })),
        incomeBracket: null,
      });

      if (!result.passed) {
        // A pending row with no PDF is retained for manual review.
        console.error(
          `[report/generate] C1-Lite gates failed for report ${reportReferenceId}:`,
          `requestId=${req.requestId}`,
          result.gateErrors,
        );
        return sendError(req, res, 422, "REPORT_VALIDATION_FAILED");
      }

      const pdfBuffer = await generateReportPdf({
        payload: result.payload,
        narrative: result.narrative,
        reportId: reportReferenceId,
        generatedDate: result.payload.report_meta.generated_date,
      });

      await attachReportPdfAndColleges({
        reportReferenceId,
        pdfData: pdfBuffer,
        colleges: normalizedColleges.map((college) => ({
          unitid: college.unitid,
          cipCode: college.cipCode ?? programCip ?? null,
          programName: college.programName,
        })),
      });

      console.log(
        `[report/generate] Report persisted: ${reportReferenceId} (created ${createdAt})`,
      );
      return res.status(200).json({ reportId: reportReferenceId });
    } catch (error) {
      return sendInternalError(req, res, error, "report");
    }
  },
);

export default router;
