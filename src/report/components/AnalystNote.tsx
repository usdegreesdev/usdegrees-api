import React from "react";
import type { C1LitePayload, C1LiteNarrative } from "../services/reportPrompt";
import { theme } from "./theme";
import { pageStyle, PageHeader, PageFooter } from "./PageChrome";

export interface AnalystNoteProps {
  payload: C1LitePayload;
  narrative: C1LiteNarrative;
  reportId: string;
  generatedDate: string;
  pageNumber: number;
  totalPages: number;
}

export default function AnalystNote({
  payload,
  narrative,
  reportId,
  generatedDate,
  pageNumber,
  totalPages,
}: AnalystNoteProps) {
  const salutation = `Dear ${payload.student.display_name},`;

  // Split the analyst note into paragraphs on blank lines; fall back to a
  // single paragraph. We never synthesize extra content — only what the
  // model actually produced is shown.
  const paragraphs = (narrative.analyst_note || "")
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  return (
    <div style={pageStyle}>
      <div>
        <PageHeader sectionLabel="A NOTE BEFORE YOU READ" title="From the U.S.DEGREES Team" />

        <div
          style={{
            fontFamily: theme.font.family,
            fontSize: "15px",
            fontWeight: 700,
            color: theme.color.navy,
            margin: "8px 0 16px 0",
          }}
        >
          {salutation}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
          {paragraphs.map((p, i) => (
            <p
              key={i}
              style={{
                fontSize: "12.5px",
                lineHeight: "1.7",
                color: theme.color.ink,
                margin: 0,
              }}
            >
              {p}
            </p>
          ))}
        </div>

        {/* Signature block */}
        <div style={{ marginTop: "28px" }}>
          <div style={{ fontSize: "12.5px", color: theme.color.ink, marginBottom: "14px" }}>
            With diligence,
          </div>
          <div style={{ width: "48px", height: "2px", backgroundColor: theme.color.gold, marginBottom: "8px" }}></div>
          <div style={{ fontFamily: theme.font.family, fontSize: "14px", fontWeight: 700, color: theme.color.navy }}>
            U.S. Degrees · Report Team
          </div>
        </div>
      </div>

      <div>
        {/* Placement disclosure */}
        <div
          style={{
            backgroundColor: theme.color.panelBg,
            border: `1px solid ${theme.color.hairline}`,
            borderRadius: "8px",
            padding: "10px 14px",
            fontSize: "9.5px",
            fontStyle: "italic",
            color: theme.color.inkMuted,
            marginBottom: "12px",
          }}
        >
          No college, lender, or admissions consultant has paid for placement in this report.
          This report does not rank or recommend any school.
        </div>

        <PageFooter
          reportId={reportId}
          generatedDate={generatedDate}
          pageNumber={pageNumber}
          totalPages={totalPages}
        />
      </div>
    </div>
  );
}
