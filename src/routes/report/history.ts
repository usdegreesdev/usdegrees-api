import { Router, Response } from "express";
import {
  getReportForUser,
  listReportsForUser,
} from "../../report/services/reportHistory.service";
import {
  signReportDownloadToken,
} from "../../utils/reportDownloadToken";
import { verifyToken } from "../../middleware/auth";
import { AuthRequest } from "../../types/user";
import { sendReportDownloadEmail } from "../../utils/mailer";
import { sendInternalError } from "../../utils/apiError";
import {
  ApiError,
  getUserEmail,
  resolveUserId,
  toParamString,
  toPositiveInt,
} from "./shared";

const router = Router();

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

interface ReportDetailResponse {
  reportId: string;
  createdAt: string;
  colleges: { unitid: number; name: string }[];
  downloadUrl: string;
  expiresAt: string;
}

router.get(
  "/",
  verifyToken,
  async (req: AuthRequest, res: Response<ReportListResponse | ApiError>) => {
    try {
      const firebaseUid = req.userId;
      if (!firebaseUid) {
        return res.status(401).json({
          error: "Unauthorized: Missing user authentication context.",
        });
      }

      const userId = await resolveUserId(firebaseUid);
      if (!userId) {
        return res.status(404).json({ error: "User not found." });
      }

      const page = Math.max(1, toPositiveInt(req.query.page, 1));
      const limit = Math.min(50, Math.max(1, toPositiveInt(req.query.limit, 10)));
      const { reports, total } = await listReportsForUser(userId, page, limit);
      const hasMore = (page - 1) * limit + reports.length < total;

      return res.status(200).json({ reports, total, page, limit, hasMore });
    } catch (error) {
      return sendInternalError(req, res, error, "report");
    }
  },
);

router.get(
  "/:reportId",
  verifyToken,
  async (req: AuthRequest, res: Response<ReportDetailResponse | ApiError>) => {
    try {
      const firebaseUid = req.userId;
      if (!firebaseUid) {
        return res.status(401).json({
          error: "Unauthorized: Missing user authentication context.",
        });
      }

      const userId = await resolveUserId(firebaseUid);
      if (!userId) {
        return res.status(404).json({ error: "User not found." });
      }

      const report = await getReportForUser(
        userId,
        toParamString(req.params.reportId),
      );
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
      return sendInternalError(req, res, error, "report");
    }
  },
);

router.post(
  "/:reportId/email",
  verifyToken,
  async (req: AuthRequest, res: Response<Record<string, never> | ApiError>) => {
    try {
      const firebaseUid = req.userId;
      if (!firebaseUid) {
        return res.status(401).json({
          error: "Unauthorized: Missing user authentication context.",
        });
      }

      const userId = await resolveUserId(firebaseUid);
      if (!userId) {
        return res.status(404).json({ error: "User not found." });
      }

      const report = await getReportForUser(
        userId,
        toParamString(req.params.reportId),
      );
      if (!report) {
        return res.status(404).json({ error: "Report not found." });
      }

      const email = await getUserEmail(userId);
      if (!email) {
        return res.status(404).json({ error: "User not found." });
      }

      const { token } = signReportDownloadToken(report.reportId);
      const publicAppUrl = process.env.PUBLIC_APP_URL || "http://localhost:8000";
      const downloadUrl = `${publicAppUrl}/report/${report.reportId}/download?token=${token}`;

      await sendReportDownloadEmail({
        to: email,
        reportId: report.reportId,
        createdAt: report.createdAt,
        collegeNames: report.colleges.map((college) => college.name),
        downloadUrl,
      });

      return res.status(200).json({});
    } catch (error) {
      return sendInternalError(req, res, error, "report");
    }
  },
);

export default router;
