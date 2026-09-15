import { Router, Response } from "express";
import * as fs from "fs";
import { generateC1LiteReport } from "../report/services/ai.service";
import {
  generateReportPdf,
  getReportPdfPath,
} from "../report/services/pdf.service";
import {
  createPendingReport,
  attachReportPdfAndColleges,
  listReportsForUser,
  getReportForUser,
  getReportPdfSourceByReferenceId,
} from "../report/services/reportHistory.service";
import {
  signReportDownloadToken,
  verifyReportDownloadToken,
} from "../utils/reportDownloadToken";
import { verifyToken } from "../middleware/auth";
import { reportGenerationRateLimit } from "../middleware/rateLimit";
import { AuthRequest } from "../types/user";
import pool from "../db/client";
import { errorDetails } from "../utils/errors";
import { sendReportDownloadEmail } from "../utils/mailer";

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

interface ApiError {
  error: string;
  details?: string;
}

function toPositiveInt(val: unknown, fallback: number): number {
  const n = typeof val === "string" ? parseInt(val, 10) : Number(val);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Express 5 types route params as `string | string[]` (for `foo[]`-style segments); a single `:x` segment is always a plain string at runtime. */
function toParamString(val: string | string[]): string {
  return Array.isArray(val) ? val[0] : val;
}

/** Resolve the verified firebase_uid to the integer usdusers.id. */
async function resolveUserId(firebaseUid: string): Promise<number | null> {
  const r = await pool.query<{ id: number }>(
    "SELECT id FROM usdusers WHERE firebase_uid = $1",
    [firebaseUid],
  );
  return r.rows.length ? r.rows[0].id : null;
}

async function getUserEmail(userId: number): Promise<string | null> {
  const r = await pool.query<{ email: string }>(
    "SELECT email FROM usdusers WHERE id = $1",
    [userId],
  );
  return r.rows.length ? r.rows[0].email : null;
}

// Report generation triggers a real Gemini API call and a headless-Chrome PDF
// render per request — rate-limited per authenticated user (see
// middleware/rateLimit.ts) so a single account can't loop this endpoint to
// run up unlimited Gemini/compute cost.
router.post(
  "/generate",
  verifyToken,
  reportGenerationRateLimit,
  async (req: AuthRequest, res: Response<{ reportId: string } | ApiError>) => {
    try {
      const { selectedColleges, programId } = req.body as GenerateReportRequest;
      const firebaseUid = req.userId;

      if (!firebaseUid) {
        return res
          .status(401)
          .json({
            error: "Unauthorized: Missing user authentication context.",
          });
      }

      // Resolve the authenticated user's real id. Never fall back to another
      // user's row — the report must only ever contain this user's own data.
      const userId = await resolveUserId(firebaseUid);
      if (!userId) {
        return res.status(404).json({ error: "User not found." });
      }

      if (
        !selectedColleges ||
        !Array.isArray(selectedColleges) ||
        selectedColleges.length === 0
      ) {
        return res
          .status(400)
          .json({
            error:
              "A non-empty selectedColleges array of school entries is required.",
          });
      }

      console.log(
        "[report/generate] incoming selectedColleges:",
        JSON.stringify(selectedColleges),
      );

      // Accept either a bare unitid (legacy) or a { unitid, cipCode,
      // programName, credentialTitle } object — same college can now appear
      // more than once under different programs.
      const invalidIndex = selectedColleges.findIndex((entry) => {
        const unitid = typeof entry === "object" && entry !== null ? (entry as SelectedCollegeEntry).unitid : entry;
        return unitid == null || !Number.isInteger(Number(unitid)) || Number(unitid) <= 0;
      });
      if (invalidIndex !== -1) {
        return res.status(400).json({
          error: `Invalid school entry at index ${invalidIndex}: missing unitid`,
        });
      }

      const normalizedColleges = selectedColleges.map((entry) => {
        if (typeof entry === "object" && entry !== null) {
          return {
            unitid: Number(entry.unitid),
            cipCode: entry.cipCode ?? null,
            programName: entry.programName ?? null,
            credentialTitle: entry.credentialTitle ?? null,
          };
        }
        return { unitid: Number(entry), cipCode: null, programName: null, credentialTitle: null };
      });

      // Resolve the reference program's CIP code (if given) so every
      // selected school's earnings/ROI are pulled at the program level
      // rather than school-aggregated. Per-entry cipCode (from the compare
      // list) always takes precedence; this is only the fallback for
      // entries that didn't specify their own program.
      let programCip: string | undefined;
      if (programId) {
        const progRes = await pool.query<{ cip_code: string }>(
          "SELECT cip_code FROM programs WHERE id = $1",
          [programId],
        );
        programCip = progRes.rows[0]?.cip_code;
      }

      // Reserve the durable report_reference_id before generation so the
      // content itself cites the same id that ends up persisted.
      const { reportReferenceId, createdAt } =
        await createPendingReport(userId);

      // NOTE: no income bracket is captured anywhere in intake yet (no
      // column on usdusers, no field on this request). Net price renders as
      // the posted (non-personalized) figure until intake captures it.
      const result = await generateC1LiteReport({
        userId,
        reportReferenceId,
        schools: normalizedColleges.map((c) => ({
          unitid: c.unitid,
          programCip: c.cipCode ?? programCip,
          programName: c.programName ?? undefined,
        })),
        incomeBracket: null,
      });

      if (!result.passed) {
        // Do NOT render or ship the PDF. The pending usdreports row (created
        // above, pdf_data still NULL) is the flag for manual review.
        console.error(
          `[report/generate] C1-Lite gates failed for report ${reportReferenceId}:`,
          result.gateErrors,
        );
        return res.status(422).json({
          error:
            "Report generation did not pass acceptance checks and was withheld.",
          details: result.gateErrors.join("; "),
        });
      }

      // Render to a PDF buffer using Puppeteer — kept in memory, never
      // written to disk. Both the payload (numbers/tables) and the
      // narrative (generated prose) feed the .tsx components.
      const pdfBuffer = await generateReportPdf({
        payload: result.payload,
        narrative: result.narrative,
        reportId: reportReferenceId,
        generatedDate: result.payload.report_meta.generated_date,
      });

      await attachReportPdfAndColleges({
        reportReferenceId,
        pdfData: pdfBuffer,
        colleges: normalizedColleges.map((c) => ({
          unitid: c.unitid,
          cipCode: c.cipCode ?? programCip ?? null,
          programName: c.programName,
        })),
      });

      console.log(
        `[report/generate] Report persisted: ${reportReferenceId} (created ${createdAt})`,
      );

      // The report_reference_id is the only identifier the frontend should
      // ever see or use — fetch the PDF via GET /report/:reportId, which
      // mints a fresh short-lived signed download URL.
      return res.status(200).json({ reportId: reportReferenceId });
    } catch (error) {
      console.error("Error generating college decision report:", error);
      return res.status(500).json({
        error: "Failed to generate report",
        details: errorDetails(error),
      });
    }
  },
);

interface ReportListResponse {
  reports: {
    reportId: string;
    createdAt: string;
    colleges: { unitid: number; name: string }[];
  }[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}

/**
 * GET /report — current user's report history, newest first.
 * Auth required; scoped to req.user via resolveUserId, never a query param.
 */
router.get(
  "/",
  verifyToken,
  async (req: AuthRequest, res: Response<ReportListResponse | ApiError>) => {
    try {
      const firebaseUid = req.userId;
      if (!firebaseUid) {
        return res
          .status(401)
          .json({
            error: "Unauthorized: Missing user authentication context.",
          });
      }
      const userId = await resolveUserId(firebaseUid);
      if (!userId) {
        return res.status(404).json({ error: "User not found." });
      }

      const page = Math.max(1, toPositiveInt(req.query.page, 1));
      const limit = Math.min(
        50,
        Math.max(1, toPositiveInt(req.query.limit, 10)),
      );

      const { reports, total } = await listReportsForUser(userId, page, limit);
      const hasMore = (page - 1) * limit + reports.length < total;

      return res.status(200).json({ reports, total, page, limit, hasMore });
    } catch (error) {
      console.error("Error listing reports:", error);
      return res.status(500).json({
        error: "Failed to list reports",
        details: errorDetails(error),
      });
    }
  },
);

interface ReportDetailResponse {
  reportId: string;
  createdAt: string;
  colleges: { unitid: number; name: string }[];
  downloadUrl: string;
  expiresAt: string;
}

/**
 * GET /report/:reportId — single report for re-viewing/re-downloading.
 * :reportId is report_reference_id. Ownership mismatches 404 (not 403) so a
 * probing request can't distinguish "not yours" from "doesn't exist".
 */
router.get(
  "/:reportId",
  verifyToken,
  async (req: AuthRequest, res: Response<ReportDetailResponse | ApiError>) => {
    try {
      const firebaseUid = req.userId;
      if (!firebaseUid) {
        return res
          .status(401)
          .json({
            error: "Unauthorized: Missing user authentication context.",
          });
      }
      const userId = await resolveUserId(firebaseUid);
      if (!userId) {
        return res.status(404).json({ error: "User not found." });
      }

      const reportId = toParamString(req.params.reportId);
      const report = await getReportForUser(userId, reportId);
      if (!report) {
        return res.status(404).json({ error: "Report not found." });
      }

      const { token, expiresAt } = signReportDownloadToken(report.reportId);
      const publicAppUrl = process.env.PUBLIC_APP_URL || "http://localhost:8000";
      const downloadUrl = `${publicAppUrl}/report/${report.reportId}/download?token=${token}`;

      return res.status(200).json({
        reportId: report.reportId,
        createdAt: report.createdAt,
        colleges: report.colleges,
        downloadUrl,
        expiresAt: expiresAt.toISOString(),
      });
    } catch (error) {
      console.error("Error fetching report:", error);
      return res.status(500).json({
        error: "Failed to fetch report",
        details: errorDetails(error),
      });
    }
  },
);

/**
 * POST /report/:reportId/email — emails the authenticated user a fresh signed
 * download link for their own report. Reuses the same ownership check and
 * link-signing logic as GET /report/:reportId; ownership mismatches 404 for
 * the same reason (a probing request can't distinguish "not yours" from
 * "doesn't exist").
 */
router.post(
  "/:reportId/email",
  verifyToken,
  async (req: AuthRequest, res: Response<Record<string, never> | ApiError>) => {
    try {
      const firebaseUid = req.userId;
      if (!firebaseUid) {
        return res
          .status(401)
          .json({
            error: "Unauthorized: Missing user authentication context.",
          });
      }
      const userId = await resolveUserId(firebaseUid);
      if (!userId) {
        return res.status(404).json({ error: "User not found." });
      }

      const reportId = toParamString(req.params.reportId);
      const report = await getReportForUser(userId, reportId);
      if (!report) {
        return res.status(404).json({ error: "Report not found." });
      }

      const email = await getUserEmail(userId);
      if (!email) {
        return res.status(404).json({ error: "User not found." });
      }

      // Signed fresh at send time — the link is only valid ~10-15 minutes,
      // so any previously-issued token could already be stale.
      const { token } = signReportDownloadToken(report.reportId);
      const publicAppUrl = process.env.PUBLIC_APP_URL || "http://localhost:8000";
      const downloadUrl = `${publicAppUrl}/report/${report.reportId}/download?token=${token}`;

      await sendReportDownloadEmail({
        to: email,
        reportId: report.reportId,
        createdAt: report.createdAt,
        collegeNames: report.colleges.map((c) => c.name),
        downloadUrl,
      });

      return res.status(200).json({});
    } catch (error) {
      console.error("Error emailing report:", error);
      return res.status(500).json({
        error: "Failed to email report",
        details: errorDetails(error),
      });
    }
  },
);

/**
 * GET /report/:reportId/download — streams the PDF for a signed, short-lived
 * token minted by GET /report/:reportId. Possession of a valid token is the
 * authorization (same semantics as a cloud signed URL), so this route is
 * intentionally not behind verifyToken.
 */
router.get(
  "/:reportId/download",
  async (req, res: Response<Buffer | ApiError | void>) => {
    try {
      const reportId = toParamString(req.params.reportId);
      const token = req.query.token;

      if (typeof token !== "string" || !token) {
        return res.status(401).json({ error: "Missing download token." });
      }

      const tokenReportRef = verifyReportDownloadToken(token);
      if (!tokenReportRef || tokenReportRef !== reportId) {
        return res
          .status(401)
          .json({ error: "Invalid or expired download link." });
      }

      const source = await getReportPdfSourceByReferenceId(reportId);
      if (!source) {
        return res.status(404).json({ error: "Report not found." });
      }

      // DB-stored PDF (pdf_data) is the source of truth for every row created
      // after the storage migration.
      if (source.pdfData && source.pdfData.length > 0) {
        res.setHeader("Content-Type", source.mimeType || "application/pdf");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="report-${reportId}.pdf"`,
        );
        return res.send(source.pdfData);
      }

      // Legacy fallback: rows created before the migration only ever had
      // pdf_storage_path populated. Serve those from disk rather than 404ing
      // on every report generated before this fix shipped.
      if (source.pdfStoragePath) {
        const absolutePath = getReportPdfPath(source.pdfStoragePath);
        if (fs.existsSync(absolutePath)) {
          return res.download(absolutePath, `report-${reportId}.pdf`);
        }
      }

      return res.status(404).json({ error: "Report file not found." });
    } catch (error) {
      console.error("Error downloading report:", error);
      return res.status(500).json({
        error: "Failed to download report",
        details: errorDetails(error),
      });
    }
  },
);

export default router;
