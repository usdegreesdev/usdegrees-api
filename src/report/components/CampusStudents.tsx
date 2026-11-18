import React from "react";
import type { C1LitePayload } from "../services/reportPrompt";
import { theme } from "./theme";
import { pageStyle, PageHeader, PageFooter } from "./PageChrome";
import GradRateCell from "./GradRateCell";
import { GRAD_RATE_LABEL, GRAD_RATE_MEASURES, MIN_GRAD_RATE_COHORT } from "../utils/gradRate";

export interface CampusStudentsProps {
  payload: C1LitePayload;
  reportId: string;
  generatedDate: string;
  pageNumber: number;
  totalPages: number;
}

function pct(v: number | null): string {
  return v != null ? `${v}%` : "Not published";
}

// Demographics percentages always render with one decimal place.
function pctDecimal(v: number | null): string {
  return v != null ? `${v.toFixed(1)}%` : "Not published";
}

function num(v: number | null): string {
  return v != null ? v.toLocaleString() : "Not Published";
}

/**
 * One row per unique college (payload.college_details is already deduped by
 * unitid), never per compared program — campus/student data doesn't vary by
 * program, so a college compared under three programs still gets one row.
 */
export default function CampusStudents({
  payload,
  reportId,
  generatedDate,
  pageNumber,
  totalPages,
}: CampusStudentsProps) {
  const { college_details } = payload;

  return (
    <div style={pageStyle}>
      <div>
        <PageHeader
          sectionLabel="SECTION 06 · CAMPUS & STUDENTS"
          title="Campus & Student Body"
        />

        <p
          style={{
            fontSize: "11.5px",
            lineHeight: "1.6",
            color: theme.color.ink,
            margin: "0 0 20px 0",
          }}
        >
          Enrollment, class composition, and retention as reported to IPEDS;
          graduation rate from College Scorecard. These figures describe the
          institution overall, not any specific program.
        </p>

        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            fontSize: "10.5px",
            marginBottom: "10px",
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
                Undergrad Enrollment
              </th>
              <th
                style={{ padding: "8px", fontWeight: 600, textAlign: "right" }}
              >
                Grad Enrollment
              </th>
              <th
                style={{ padding: "8px", fontWeight: 600, textAlign: "right" }}
              >
                Student:Faculty
              </th>
              <th
                style={{ padding: "8px", fontWeight: 600, textAlign: "right" }}
              >
                Graduation Rate
                <div style={{ fontSize: "8.5px", fontWeight: 400 }}>
                  within 150% of normal time
                </div>
              </th>
              <th
                style={{ padding: "8px", fontWeight: 600, textAlign: "right" }}
              >
                Retention Rate
              </th>
            </tr>
          </thead>
          <tbody>
            {college_details.map((c, i) => (
              <tr
                key={c.unitid}
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
                  {c.name}
                </td>
                <td
                  style={{
                    padding: "8px",
                    textAlign: "right",
                    color: theme.color.ink,
                  }}
                >
                  {num(c.campus.enrollment_undergrad)}
                </td>
                <td
                  style={{
                    padding: "8px",
                    textAlign: "right",
                    color: theme.color.ink,
                  }}
                >
                  {num(c.campus.enrollment_grad)}
                </td>
                <td
                  style={{
                    padding: "8px",
                    textAlign: "right",
                    color: theme.color.ink,
                  }}
                >
                  {c.campus.student_faculty_ratio != null
                    ? `${c.campus.student_faculty_ratio}:1`
                    : "Not published"}
                </td>
                <td
                  style={{
                    padding: "8px",
                    textAlign: "right",
                    color: theme.color.ink,
                  }}
                >
                  <GradRateCell rate={c.campus.graduation_rate} />
                </td>
                <td
                  style={{
                    padding: "8px",
                    textAlign: "right",
                    color: theme.color.ink,
                  }}
                >
                  {pct(c.campus.retention_rate)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <p
          style={{
            fontSize: "10px",
            lineHeight: "1.6",
            color: theme.color.inkMuted,
            margin: "0 0 24px 0",
          }}
        >
          Undergraduate and graduate enrollment figures reflect the unduplicated
          count of students enrolled at any point during the most recent
          12-month reporting period (not a single-day snapshot), as reported by
          the institution to IPEDS. {GRAD_RATE_LABEL}: {GRAD_RATE_MEASURES}, from
          College Scorecard; it excludes part-time and transfer-in students and
          counts students who transfer out as non-completers. Rates based on
          fewer than {MIN_GRAD_RATE_COHORT} students are not published.
        </p>

        <h3
          style={{
            fontSize: "13px",
            fontWeight: 700,
            color: theme.color.navy,
            margin: "0 0 12px 0",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
          }}
        >
          Student Body Composition
        </h3>
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          {college_details.map((c) => (
            <div
              key={c.unitid}
              style={{
                border: `1px solid ${theme.color.hairline}`,
                borderRadius: "10px",
                padding: "12px 14px",
                backgroundColor: theme.color.panelBg,
                fontSize: "11px",
                color: theme.color.ink,
              }}
            >
              <div
                style={{
                  fontWeight: 700,
                  color: theme.color.navy,
                  marginBottom: "4px",
                }}
              >
                {c.name}
              </div>
              <div style={{ color: theme.color.inkMuted }}>
                {c.campus.demographics_men_pct != null ||
                c.campus.demographics_women_pct != null
                  ? `${pctDecimal(c.campus.demographics_men_pct)} men · ${pctDecimal(c.campus.demographics_women_pct)} women`
                  : "Demographic breakdown not published"}
                {c.campus.size_category ? ` · ${c.campus.size_category}` : ""}
              </div>
            </div>
          ))}
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
