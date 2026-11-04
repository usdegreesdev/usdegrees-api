import React from "react";
import type { C1LitePayload, C1LiteNarrative } from "../services/reportPrompt";
import { theme } from "./theme";
import { pageStyle, PageHeader, PageFooter } from "./PageChrome";

export interface StudentProfileProps {
  payload: C1LitePayload;
  narrative: C1LiteNarrative;
  reportId: string;
  generatedDate: string;
  pageNumber: number;
  totalPages: number;
}

export default function StudentProfile({
  payload,
  narrative,
  reportId,
  generatedDate,
  pageNumber,
  totalPages,
}: StudentProfileProps) {
  const { student, schools, college_details } = payload;

  const graduationRateByUnitid = new Map(
    college_details.map((c) => [c.unitid, c.campus.graduation_rate]),
  );

  return (
    <div style={pageStyle}>
      <div>
        <PageHeader
          sectionLabel="SECTION 03 · STUDENT PROFILE & NET PRICE"
          title="Student Profile & Net Price"
        />

        {/* Profile Card */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1.2fr 1fr",
            gap: "20px",
            marginBottom: "25px",
          }}
        >
          <div
            style={{
              backgroundColor: theme.color.panelBg,
              border: `1px solid ${theme.color.hairline}`,
              borderRadius: "12px",
              padding: "18px",
            }}
          >
            <h3
              style={{
                fontSize: "12px",
                fontWeight: 700,
                color: theme.color.inkMuted,
                margin: "0 0 12px 0",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
              }}
            >
              Academic Profile
            </h3>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: "10px",
                fontSize: "12px",
              }}
            >
              <div>
                <span style={{ color: theme.color.inkMuted }}>Name: </span>
                <strong style={{ color: theme.color.ink }}>
                  {student.display_name}
                </strong>
              </div>
              <div>
                <span style={{ color: theme.color.inkMuted }}>
                  Preferred degree level:{" "}
                </span>
                <strong style={{ color: theme.color.ink }}>
                  {student.preferred_degree_level ?? "Not provided"}
                </strong>
              </div>
              <div>
                <span style={{ color: theme.color.inkMuted }}>GPA: </span>
                <strong style={{ color: theme.color.ink }}>
                  {student.gpa ?? "Not provided"}
                </strong>
              </div>
              <div>
                <span style={{ color: theme.color.inkMuted }}>SAT Score: </span>
                <strong style={{ color: theme.color.ink }}>
                  {student.sat_score ?? "Not provided"}
                </strong>
              </div>
              <div style={{ gridColumn: "1 / -1" }}>
                <span style={{ color: theme.color.inkMuted }}>
                  Family income:{" "}
                </span>
                <strong style={{ color: theme.color.ink }}>
                  {student.income_bracket_label ?? "Not provided"}
                </strong>
              </div>
            </div>
          </div>

          <div
            style={{
              backgroundColor: theme.color.panelBg,
              border: `1px solid ${theme.color.hairline}`,
              borderRadius: "12px",
              padding: "18px",
            }}
          >
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "6px",
                fontSize: "12px",
              }}
            >
              <div>
                <span style={{ color: theme.color.inkMuted }}>
                  High school:{" "}
                </span>
                <strong style={{ color: theme.color.ink }}>
                  {student.high_school_name ?? "Not provided"}
                </strong>
              </div>
              <div>
                <span style={{ color: theme.color.inkMuted }}>Email: </span>
                <strong style={{ color: theme.color.ink, wordBreak: "break-all" }}>
                  {student.email ?? "Not provided"}
                </strong>
              </div>
              <div>
                <span style={{ color: theme.color.inkMuted }}>Address: </span>
                <strong style={{ color: theme.color.ink }}>
                  {student.address ?? "Not provided"}
                </strong>
              </div>
            </div>
          </div>
        </div>

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
          <p style={{ margin: 0, color: theme.color.ink }}>
            {narrative.net_price_note}
          </p>
        </div>

        {/* Comparison Table */}
        <h3
          style={{
            fontSize: "13px",
            fontWeight: 700,
            color: theme.color.navy,
            margin: "0 0 10px 0",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
          }}
        >
          Net Price & Admissions Matrix
        </h3>
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            fontSize: "11px",
            marginBottom: "30px",
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
              <th style={{ padding: "10px", fontWeight: 600 }}>College</th>
              <th
                style={{ padding: "10px", fontWeight: 600, textAlign: "right" }}
              >
                Net Price
              </th>
              <th
                style={{ padding: "10px", fontWeight: 600, textAlign: "right" }}
              >
                Graduation Rate
              </th>
              <th
                style={{ padding: "10px", fontWeight: 600, textAlign: "right" }}
              >
                Admit Rate
              </th>
              <th
                style={{ padding: "10px", fontWeight: 600, textAlign: "right" }}
              >
                SAT (25th–75th)
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
                    padding: "10px",
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
                    padding: "10px",
                    textAlign: "right",
                    color: theme.color.inkMuted,
                  }}
                >
                  {s.net_price_bracket != null
                    ? `$${s.net_price_bracket.toLocaleString()}`
                    : "Not published"}
                </td>
                <td
                  style={{
                    padding: "10px",
                    textAlign: "right",
                    color: theme.color.navy,
                    fontWeight: "bold",
                  }}
                >
                  {(() => {
                    const gradRate = graduationRateByUnitid.get(s.unitid);
                    return gradRate != null ? `${gradRate}%` : "Not published";
                  })()}
                </td>
                <td
                  style={{
                    padding: "10px",
                    textAlign: "right",
                    color: theme.color.inkMuted,
                  }}
                >
                  {s.admit_rate != null ? `${s.admit_rate}%` : "Not published"}
                </td>
                <td
                  style={{
                    padding: "10px",
                    textAlign: "right",
                    color: theme.color.inkMuted,
                  }}
                >
                  {s.sat_25 != null && s.sat_75 != null
                    ? `${s.sat_25}–${s.sat_75}`
                    : "Not published"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
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
