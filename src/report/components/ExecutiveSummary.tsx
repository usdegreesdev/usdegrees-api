import React from "react";
import type { C1LitePayload, C1LiteNarrative } from "../services/reportPrompt";
import { theme } from "./theme";
import { pageStyle, PageHeader, PageFooter } from "./PageChrome";
import { figureCompleteness, figureRowParts, type FigureMetric } from "../utils/missingValue";

export interface PageProps {
  payload: C1LitePayload;
  narrative: C1LiteNarrative;
  reportId: string;
  generatedDate: string;
  pageNumber: number;
  totalPages: number;
}

export default function ExecutiveSummary({
  payload,
  reportId,
  generatedDate,
  pageNumber,
  totalPages,
}: PageProps) {
  return (
    <div style={pageStyle}>
      <div>
        <PageHeader sectionLabel="SECTION 02 · EXECUTIVE SUMMARY" title="Executive Summary" />

        {/* Per-school figures in the order the student entered the schools —
            never sorted, never labelled higher or lower. */}
        <h3 style={{ fontSize: "13px", fontWeight: 700, color: theme.color.navy, margin: "0 0 12px 0", textTransform: "uppercase", letterSpacing: "0.05em" }}>
          Two-Minute Read of Cost & Outcomes by School
        </h3>
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          {FIGURE_ROWS.map(({ label, metric }) => (
            <div key={metric} style={{ display: "flex", alignItems: "flex-start", gap: "10px", padding: "10px 14px", backgroundColor: theme.color.panelBg, border: `1px solid ${theme.color.hairline}`, borderRadius: "8px" }}>
              <div style={{ flexGrow: 1 }}>
                <div style={{ fontSize: "10px", color: theme.color.navy, fontWeight: 700, textTransform: "uppercase" }}>{label}</div>
                <div style={{ fontSize: "12px", color: theme.color.ink, lineHeight: "1.5" }}>
                  {figureRowParts(payload.schools, metric).map((parts, i) => (
                    <React.Fragment key={i}>
                      {i > 0 && " · "}
                      {parts.map((p, j) => (p.bold ? <strong key={j}>{p.text}</strong> : <span key={j}>{p.text}</span>))}
                    </React.Fragment>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
        <p style={{ fontSize: "10px", lineHeight: "1.5", color: theme.color.inkMuted, margin: "8px 0 0 0" }}>
          {figureCompleteness(payload.schools).line}
        </p>
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

const FIGURE_ROWS: Array<{ label: string; metric: FigureMetric }> = [
  { label: "Net price", metric: "net_price" },
  { label: "Program earnings", metric: "program_earnings" },
  { label: "School-wide median federal debt of completers", metric: "typical_debt" },
];
