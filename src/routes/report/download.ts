import { Router, Response } from "express";
import * as fs from "fs";
import {
  getReportPdfPath,
} from "../../report/services/pdf.service";
import { getReportPdfSourceByReferenceId } from "../../report/services/reportHistory.service";
import { verifyReportDownloadToken } from "../../utils/reportDownloadToken";
import { sendInternalError } from "../../utils/apiError";
import { ApiError, toParamString } from "./shared";

const router = Router();

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
        return res.status(401).json({ error: "Invalid or expired download link." });
      }

      const source = await getReportPdfSourceByReferenceId(reportId);
      if (!source) {
        return res.status(404).json({ error: "Report not found." });
      }

      if (source.pdfData && source.pdfData.length > 0) {
        res.setHeader("Content-Type", source.mimeType || "application/pdf");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="report-${reportId}.pdf"`,
        );
        return res.send(source.pdfData);
      }

      // Keep serving reports created before PDFs were stored in the database.
      if (source.pdfStoragePath) {
        const absolutePath = getReportPdfPath(source.pdfStoragePath);
        if (fs.existsSync(absolutePath)) {
          return res.download(absolutePath, `report-${reportId}.pdf`);
        }
      }

      return res.status(404).json({ error: "Report file not found." });
    } catch (error) {
      return sendInternalError(req, res, error, "report");
    }
  },
);

export default router;
