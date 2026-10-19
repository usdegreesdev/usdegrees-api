import React from "react";
import type { C1LitePayload } from "../services/reportPrompt";
import { theme } from "./theme";
import { pageStyle, PageHeader, PageFooter } from "./PageChrome";

export interface MethodologyProps {
  payload: C1LitePayload;
  reportId: string;
  generatedDate: string;
  pageNumber: number;
  totalPages: number;
}

export default function Methodology({
  reportId,
  generatedDate,
  pageNumber,
  totalPages,
}: MethodologyProps) {
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
            gap: "20px",
            marginBottom: "30px",
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
                gap: "8px",
                fontSize: "12px",
                color: theme.color.ink,
                lineHeight: "1.4",
              }}
            >
              <div>
                <strong>• 20-Year ROI:</strong> A precomputed figure reported
                directly from federal cohort data (avg_salary and total_cost
                inputs, keyed by school and credential level). Not estimated or
                projected by this report.
              </div>
              <div>
                <strong>• Admission Fit:</strong> Measures student academic
                placement (GPA, SAT) compared to the middle 50% range of the
                historical freshman cohort. Not applicable at open-admission,
                test-not-used, or closed institutions.
              </div>
              <div>
                <strong>• Debt-to-Income Ratio:</strong> A published federal
                outcome label (avg_debt vs. cohort earnings) — reported as-is,
                not computed or interpreted by this report.
              </div>
              <div>
                <strong>
                  • Program Earnings Data Imputation — U.S. Degrees Methodology:
                </strong>{" "}
                Where PSEO program earnings are missing, U.S. Degrees may
                provide modelled values derived only from real, reported
                earnings data using credential- and field-specific growth
                patterns. Estimates are never chained from other estimates, and
                values without a valid real-data anchor are not generated.
                {/* Earnings methodology labels */}
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
                  <div
                    style={{
                      fontWeight: 700,
                      color: theme.color.navy,
                      marginBottom: "3px",
                    }}
                  >
                    Earnings value labels:
                  </div>

                  <div>
                    <strong>Census-reported:</strong> Real PSEO value — measured, not
                    estimated.
                  </div>

                  <div>
                    <strong>Estimated (between two real values):</strong>{" "}
                    Estimated between two real points; most reliable estimate.
                  </div>

                  <div>
                    <strong>Estimated (from one nearby real value):</strong>{" "}
                    Estimated from a nearer real-data anchor.
                  </div>

                  <div>
                    <strong>Estimated — low confidence:</strong> Single-anchor
                    or declining-trajectory estimate; use with caution.
                  </div>

                  <div>
                    <strong>Not published:</strong> No value is shown because
                    the outcome year has not yet occurred or no real value was
                    available to anchor an estimate.
                  </div>
                </div>
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
              This report is neutral and comparative only — it does not rank,
              recommend, or select a school. Most figures come directly from
              public federal datasets. Where Census PSEO program earnings data
              is unavailable, we may show a clearly labelled estimate derived
              only from real reported earnings, using the U.S. Degrees earnings
              imputation methodology. Estimates are never chained from other
              estimates and are not presented as official Census-published
              figures. Where no reported value or valid real-data anchor
              exists, no estimate is generated. Confirm all figures directly
              with each institution before making a decision.
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
              SOURCES DOCUMENTED · CALCULATIONS RE-CHECKED
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
