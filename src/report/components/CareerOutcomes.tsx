import React from "react";
import type { C1LitePayload, C1LiteNarrative } from "../services/reportPrompt";
import { theme } from "./theme";
import { pageStyle, PageHeader, PageFooter } from "./PageChrome";

/**
 * debt_income_ratio is derived in reportPayload.service (typical debt ÷
 * program earnings) rather than read from the reported federal column, so
 * this cell always reconciles with the two columns beside it. It is rendered
 * as a debt : income ratio rather than a bare decimal — the payload number is
 * the debt side against an income of 1, so 0.52 prints as "0.52 : 1". The
 * numeral itself is unchanged from the payload, which gateNumbersTraceable
 * requires of the narrative citing the same value.
 */
const MISSING_RATIO = "Cannot be calculated due to missing values";

function debtToIncome(ratio: number | null): string {
  return ratio != null ? `${ratio} : 1` : MISSING_RATIO;
}

export interface CareerOutcomesProps {
  payload: C1LitePayload;
  narrative: C1LiteNarrative;
  reportId: string;
  generatedDate: string;
  pageNumber: number;
  totalPages: number;
}

export default function CareerOutcomes({
  payload,
  narrative,
  reportId,
  generatedDate,
  pageNumber,
  totalPages,
}: CareerOutcomesProps) {
  const { schools } = payload;

  return (
    <div style={pageStyle}>
      <div>
        <PageHeader
          sectionLabel="SECTION 03 · EARNINGS & DEBT"
          title="Program Earnings & Typical Debt"
        />

        {/* Narrative */}
        <div
          style={{
            backgroundColor: theme.color.panelBg,
            borderRadius: "10px",
            padding: "14px",
            border: `1px solid ${theme.color.hairline}`,
            marginBottom: "20px",
            fontSize: "11.5px",
            lineHeight: "1.5",
          }}
        >
          <div
            style={{
              fontWeight: 700,
              color: theme.color.navy,
              textTransform: "uppercase",
              fontSize: "10px",
              marginBottom: "4px",
            }}
          >
            Program Earnings
          </div>
          <p style={{ margin: "0 0 12px 0", color: theme.color.ink }}>
            {narrative.earnings_paragraph}
          </p>
          <div
            style={{
              fontWeight: 700,
              color: theme.color.navy,
              textTransform: "uppercase",
              fontSize: "10px",
              marginBottom: "4px",
            }}
          >
            Typical Debt at Completion
          </div>
          <p style={{ margin: 0, color: theme.color.ink }}>
            {narrative.debt_burden_paragraph}
          </p>
        </div>

        {/* Outcomes Data Table */}
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            fontSize: "10.5px",
            marginBottom: "25px",
            border: `1px solid ${theme.color.hairline}`,
          }}
        >
          <thead>
            <tr
              style={{
                backgroundColor: theme.color.navy,
                color: theme.color.white,
                textAlign: "left",
              }}
            >
              <th style={{ padding: "8px", fontWeight: 600 }}>College</th>
              <th
                style={{ padding: "8px", fontWeight: 600, textAlign: "right" }}
              >
                Program Earnings (Yr 10)
              </th>
              <th
                style={{ padding: "8px", fontWeight: 600, textAlign: "right" }}
              >
                Typical Debt
              </th>
              <th
                style={{ padding: "8px", fontWeight: 600, textAlign: "right" }}
              >
                Debt-to-Income Ratio
              </th>
            </tr>
          </thead>
          <tbody>
            {schools.map((s, i) => (
              <tr
                key={i}
                style={{
                  borderBottom: `1px solid ${theme.color.hairline}`,
                  backgroundColor:
                    i % 2 === 0 ? theme.color.panelBgAlt : theme.color.panelBg,
                }}
              >
                <td
                  style={{
                    padding: "8px",
                    fontWeight: 700,
                    color: theme.color.navy,
                  }}
                >
                  {s.name}
                  {s.program_name && (
                    <div
                      style={{
                        fontSize: "9px",
                        fontWeight: 600,
                        color: theme.color.inkMuted,
                      }}
                    >
                      {s.program_name}
                    </div>
                  )}
                </td>
                <td
                  style={{
                    padding: "8px",
                    textAlign: "right",
                    color: theme.color.navy,
                    fontWeight: 700,
                  }}
                >
                  {s.program_earnings != null
                    ? `$${s.program_earnings.toLocaleString()}`
                    : "Not published"}
                </td>
                <td
                  style={{
                    padding: "8px",
                    textAlign: "right",
                    color: theme.color.ink,
                  }}
                >
                  {s.avg_debt != null
                    ? `$${s.avg_debt.toLocaleString()}${s.avg_debt === 0 ? " *" : ""}`
                    : "Not published"}
                </td>
                {(() => {
                  const ratio = debtToIncome(s.debt_income_ratio);
                  const missing = ratio === MISSING_RATIO;
                  return (
                    <td
                      style={{
                        padding: "8px",
                        textAlign: "right",
                        // The fallback sentence is prose in a numeric column —
                        // muted and smaller so it doesn't read as a figure.
                        color: missing ? theme.color.inkMuted : theme.color.ink,
                        fontWeight: missing ? 400 : 600,
                        fontSize: missing ? "9px" : undefined,
                        fontStyle: missing ? "italic" : undefined,
                      }}
                    >
                      {ratio}
                    </td>
                  );
                })()}
              </tr>
            ))}
          </tbody>
        </table>

        {schools.some((s) => s.avg_debt === 0) && (
          <p
            style={{
              fontSize: "10px",
              lineHeight: "1.5",
              color: theme.color.inkMuted,
              margin: "-12px 0 12px 0",
            }}
          >
            * A typical debt value of $0 may indicate that the college does not
            offer financial aid or that the actual reported student debt is
            zero. For further details, please contact the college’s admissions
            office.
          </p>
        )}

        {/* Earnings method footnotes — vintage years are deliberately omitted;
            only the method flag (e.g. Census-reported) is surfaced. Schools with
            no method flag contribute no line. */}

            
        {/* <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
          {schools
            .filter((s) => s.earnings_method_flag)
            .map((s, i) => (
              <div
                key={i}
                style={{ fontSize: "9px", color: theme.color.inkFaint }}
              >
                {s.display_name}: earnings ({s.earnings_method_flag})
              </div>
            ))}
        </div> */}
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
