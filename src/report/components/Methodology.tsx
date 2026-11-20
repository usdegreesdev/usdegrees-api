import React from "react";
import type { C1LitePayload } from "../services/reportPrompt";
import { theme } from "./theme";
import { pageStyle, PageHeader, PageFooter } from "./PageChrome";
import { debtRatioMethodology, debtRatioRefreshed } from "../utils/debtRatio";
import { STICKER_METHODOLOGY } from "../utils/stickerPrice";
import { GRAD_RATE_METHODOLOGY } from "../utils/gradRate";
import { missingFiguresMethodology } from "../utils/missingValue";
import { dataYearsSentence } from "../utils/dataVintage";
import { earningsLabelsUsed, EARNINGS_LABEL_TEXT, NOT_PUBLISHED_LABEL_TEXT } from "../utils/earningsLabels";

export interface MethodologyProps {
  payload: C1LitePayload;
  reportId: string;
  generatedDate: string;
  pageNumber: number;
  totalPages: number;
}

export default function Methodology({
  payload,
  reportId,
  generatedDate,
  pageNumber,
  totalPages,
}: MethodologyProps) {
  const earned = earningsLabelsUsed(payload?.schools ?? []);
  return (
    <div style={pageStyle}>
      <div>
        <PageHeader
          sectionLabel="SECTION 10 · MODELS & DISCLAIMERS"
          title="Calculation Methodology & Disclaimers"
        />

        {/* Methodology Details */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "14px",
            marginBottom: "18px",
          }}
        >
          <div>
            <h3
              style={{
                fontSize: "13px",
                fontWeight: 700,
                color: theme.color.navy,
                margin: "0 0 6px 0",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
              }}
            >
              Calculation Methodology
            </h3>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "6px",
                fontSize: "12px",
                color: theme.color.ink,
                lineHeight: "1.4",
              }}
            >
              <div>
                <strong>• Admission Fit:</strong> Compares the student&apos;s
                total SAT score with the school&apos;s published SAT average or
                middle 50% range. GPA is not used, because no published GPA
                data is available for colleges. Not applicable at open-admission,
                test-not-used, test-optional or scores-considered-if-submitted,
                or closed institutions.
              </div>
              <div>
                <strong>• Debt-to-Income Ratio:</strong>{" "}
                {debtRatioMethodology(
                  debtRatioRefreshed(
                    payload?.schools ?? [],
                    payload?.report_meta?.generated_date ?? "",
                  ),
                )}
              </div>
              <div>
                <strong>• {GRAD_RATE_METHODOLOGY.split(":")[0]}:</strong>
                {GRAD_RATE_METHODOLOGY.slice(GRAD_RATE_METHODOLOGY.indexOf(":") + 1)}
              </div>
              <div>
                <strong>• {STICKER_METHODOLOGY.split(":")[0]}:</strong>
                {STICKER_METHODOLOGY.slice(STICKER_METHODOLOGY.indexOf(":") + 1)}
              </div>
              <div>
                <strong>• Missing figures:</strong>{" "}
                {missingFiguresMethodology(payload?.federal_aid_fetched_on)}
              </div>
              {dataYearsSentence(payload?.data_vintage) && (
                <div>
                  <strong>•</strong> {dataYearsSentence(payload?.data_vintage)}
                </div>
              )}
              <div>
                <strong>• Program earnings:</strong> Program-level earnings
                come from Census PSEO for one graduating cohort: year 1, year 5
                and year 10 after graduation are all read from that same
                cohort. A newer cohort&apos;s year 1, when shown, is labelled
                separately. {earned.estimated
                  ? "Where PSEO program earnings are missing, a clearly labelled estimate derived only from real reported earnings is shown; estimates are never chained from other estimates."
                  : "No estimated earnings appear in this report."}
                {(earned.labels.length > 0 || earned.anyNotPublished) && (
                  <div
                    style={{
                      marginTop: "7px",
                      marginLeft: "12px",
                      paddingLeft: "10px",
                      borderLeft: `2px solid ${theme.color.gold}`,
                      fontSize: "10.5px",
                      lineHeight: "1.45",
                      color: theme.color.inkMuted,
                    }}
                  >
                    <div style={{ fontWeight: 700, color: theme.color.navy, marginBottom: "3px" }}>
                      Earnings labels used in this report:
                    </div>
                    {earned.labels.map((l) => (
                      <div key={l}>
                        <strong>{l}:</strong> {EARNINGS_LABEL_TEXT[l]}
                      </div>
                    ))}
                    {earned.anyNotPublished && (
                      <div>
                        <strong>Not published:</strong> {NOT_PUBLISHED_LABEL_TEXT}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div>
            <h3
              style={{
                fontSize: "13px",
                fontWeight: 700,
                color: theme.color.navy,
                margin: "0 0 6px 0",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
              }}
            >
              Disclaimer & Limits
            </h3>
            <p
              style={{
                fontSize: "11px",
                lineHeight: "1.5",
                color: theme.color.inkMuted,
                margin: 0,
              }}
            >
              Neutral and comparative only — this report does not rank or
              recommend a school. Figures come from public federal datasets
              {earned.estimated ? "; labelled estimates appear only where Census PSEO program earnings are missing. " : ". "}
              Confirm all figures with each institution before
              deciding.
            </p>
          </div>
        </div>

        {/* Branding Sign-off */}
        <div
          style={{
            backgroundColor: theme.color.panelBg,
            border: `1px solid ${theme.color.hairline}`,
            borderRadius: "12px",
            padding: "20px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div>
            <div
              style={{
                fontSize: "11px",
                fontWeight: 700,
                color: theme.color.inkMuted,
                textTransform: "uppercase",
                marginBottom: "4px",
              }}
            >
              Report Status
            </div>
            <div
              style={{
                fontSize: "14px",
                fontWeight: 700,
                color: theme.color.navy,
              }}
            >
              SOURCES DOCUMENTED
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: "11px", color: theme.color.inkMuted }}>
              Generated on: <strong>{generatedDate}</strong>
            </div>
            <div style={{ fontSize: "11px", color: theme.color.inkMuted }}>
              Reference ID: <strong>{reportId}</strong>
            </div>
          </div>
        </div>
      </div>

      <PageFooter
        reportId={reportId}
        generatedDate={generatedDate}
        pageNumber={pageNumber}
        totalPages={totalPages}
      />
    </div>
  );
}
