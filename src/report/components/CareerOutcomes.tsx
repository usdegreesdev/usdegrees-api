import React from "react";
import type { C1LitePayload, C1LiteNarrative } from "../services/reportPrompt";
import { theme } from "./theme";
import { pageStyle, PageHeader, PageFooter } from "./PageChrome";
import { dataYearsSentence } from "../utils/dataVintage";
import { formatUsd } from "./format";
import { BoldValues } from "./BoldValues";

import NoAidBox from "./NoAidBox";
import {
  schoolFigures,
  takesNoFederalAid,
  TABLE_NOT_PUBLISHED,
  typicalDebtFootnote,
  cohortText,
} from "../utils/missingValue";
import {
  formatDebtIncomeRatio,
  debtRatioDisclaimer,
  schoolEarningsColumnLabel,
  MISSING_RATIO_TEXT,
} from "../utils/debtRatio";

export interface CareerOutcomesProps {
  payload: C1LitePayload;
  narrative: C1LiteNarrative;
  reportId: string;
  generatedDate: string;
  pageNumber: number;
  totalPages: number;
}

type School = C1LitePayload["schools"][number];

// With five compared programs the table plus its disclaimers overflow one
// page, so the last two move to a continuation page (Section 04A).
const FIRST_PAGE_ROWS_WHEN_SPLIT = 3;
const SPLIT_AT = 5;

/** Number of pages Section 04 occupies for this many compared programs. */
export function careerOutcomesPageCount(schoolCount: number): number {
  return schoolCount >= SPLIT_AT ? 2 : 1;
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
  const split = careerOutcomesPageCount(schools.length) === 2;
  const firstRows = split ? schools.slice(0, FIRST_PAGE_ROWS_WHEN_SPLIT) : schools;
  const secondRows = split ? schools.slice(FIRST_PAGE_ROWS_WHEN_SPLIT) : [];

  const renderTable = (rows: School[], offset: number) => (
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
          {[
            ["Earnings (Yr 1)", "after graduation"],
            ["Earnings (Yr 5)", "after graduation"],
            ["Median Earnings (Yr 10)", "after graduation"],
            [schoolEarningsColumnLabel(), "after first enrolling; school-wide, all entrants who received aid"],
          ].map(([t, sub]) => (
            <th
              key={t}
              style={{ padding: "8px", fontWeight: 600, textAlign: "right" }}
            >
              {t}
              <div style={{ fontSize: "8px", fontWeight: 400, opacity: 0.85 }}>{sub}</div>
            </th>
          ))}
          <th style={{ padding: "8px", fontWeight: 600, textAlign: "right" }}>
            School-wide median federal debt of completers
          </th>
          <th style={{ padding: "8px", fontWeight: 600, textAlign: "right" }}>
            Debt-to-Income Ratio
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((s, idx) => {
          const i = offset + idx;
          return (
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
              {[s.earnings_year_1, s.earnings_year_5].map((v, k) => (
                <td
                  key={k}
                  style={{ padding: "8px", textAlign: "right", color: theme.color.ink }}
                >
                  {v != null ? formatUsd(v) : "Not published"}
                </td>
              ))}
              <td
                style={{
                  padding: "8px",
                  textAlign: "right",
                  color: theme.color.navy,
                  fontWeight: 700,
                }}
              >
                {s.program_earnings != null
                  ? formatUsd(s.program_earnings)
                  : "Not published"}
                {s.program_earnings != null && (
                  <div style={{ fontSize: "8px", fontWeight: 400, color: theme.color.inkMuted }}>
                    {cohortText(s.earnings_vintage)} (years 1, 5 and 10 from this one cohort)
                  </div>
                )}
              </td>
              <td style={{ padding: "8px", textAlign: "right", color: theme.color.ink }}>
                {s.debt_income_earnings != null
                  ? formatUsd(s.debt_income_earnings)
                  : "Not published"}
              </td>
              <td style={{ padding: "8px", textAlign: "right", color: theme.color.ink }}>
                {(() => {
                  const td = schoolFigures(s).typical_debt;
                  if (td.value != null) return td.display;
                  return takesNoFederalAid(s) ? <NoAidBox /> : TABLE_NOT_PUBLISHED;
                })()}
              </td>
              {(() => {
                const ratio = formatDebtIncomeRatio(s.debt_income_ratio);
                const missing = ratio === MISSING_RATIO_TEXT;
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
          );
        })}
      </tbody>
    </table>
  );

  // The same disclaimers print under every table, scoped to its own rows.
  const renderDisclaimers = (rows: School[]) => {
    const newer = rows.filter(
      (s) =>
        s.earnings_latest_year_1 != null &&
        s.earnings_latest_year_1_cohort != null &&
        s.earnings_latest_year_1_cohort !== s.earnings_year_1_vintage,
    );
    return (
      <>
        <p
          style={{
            fontSize: "8.5px",
            lineHeight: "1.45",
            color: theme.color.inkMuted,
            margin: "-12px 0 12px 0",
          }}
        >
          {debtRatioDisclaimer()}
        </p>

        <p
          style={{
            fontSize: "10px",
            lineHeight: "1.5",
            color: theme.color.inkMuted,
            margin: "-12px 0 12px 0",
          }}
        >
          {typicalDebtFootnote(
            rows.filter((s) => takesNoFederalAid(s)).map((s) => s.name),
          )}
        </p>

        {/* Newest year 1 on file, only where it is a different cohort than the row above. */}
        {newer.length > 0 && (
          <p
            style={{
              fontSize: "10px",
              lineHeight: "1.5",
              color: theme.color.inkMuted,
              margin: "-4px 0 12px 0",
            }}
          >
            Newest year-1 earnings on file (a separate, newer cohort — not part of the one-cohort path in the table):{" "}
            {newer
              .map(
                (s) =>
                  `${s.name} ${formatUsd(s.earnings_latest_year_1)} (${s.earnings_latest_year_1_cohort} cohort)`,
              )
              .join("; ")}
            .
          </p>
        )}

        {dataYearsSentence(payload.data_vintage) && (
          <p
            style={{
              fontSize: "10px",
              lineHeight: "1.5",
              color: theme.color.inkMuted,
              margin: "-4px 0 12px 0",
            }}
          >
            {dataYearsSentence(payload.data_vintage)}
          </p>
        )}
      </>
    );
  };

  const narrativeHeading: React.CSSProperties = {
    fontWeight: 700,
    color: theme.color.navy,
    textTransform: "uppercase",
    fontSize: "10px",
    marginBottom: "4px",
  };

  return (
    <>
      <div style={pageStyle}>
        <div>
          <PageHeader
            sectionLabel="SECTION 04 · EARNINGS & DEBT"
            title="Program Earnings & School-wide Debt"
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
            <div style={narrativeHeading}>Program Earnings</div>
            <p style={{ margin: "0 0 12px 0", color: theme.color.ink }}>
              <BoldValues text={narrative.earnings_paragraph} />
            </p>
            <div style={narrativeHeading}>
              School-wide median federal debt of completers
            </div>
            <p style={{ margin: 0, color: theme.color.ink }}>
              <BoldValues text={narrative.debt_burden_paragraph} />
            </p>
          </div>

          {renderTable(firstRows, 0)}
          {/* Disclaimers print once, after the last table. */}
          {!split && renderDisclaimers(schools)}
        </div>

        <PageFooter
          reportId={reportId}
          generatedDate={generatedDate}
          pageNumber={pageNumber}
          totalPages={totalPages}
        />
      </div>

      {split && (
        <div style={pageStyle}>
          <div>
            <PageHeader
              sectionLabel="SECTION 04A · EARNINGS & DEBT"
              title="Program Earnings & School-wide Debt"
            />
            {renderTable(secondRows, FIRST_PAGE_ROWS_WHEN_SPLIT)}
            {renderDisclaimers(schools)}
          </div>

          <PageFooter
            reportId={reportId}
            generatedDate={generatedDate}
            pageNumber={pageNumber + 1}
            totalPages={totalPages}
          />
        </div>
      )}
    </>
  );
}
