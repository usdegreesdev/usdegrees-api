import React from "react";
import type { C1LitePayload, C1LiteNarrative } from "../services/reportPrompt";
import { theme } from "./theme";
import { pageStyle, PageHeader, PageFooter } from "./PageChrome";
import { formatUsd } from "./format";

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
  narrative,
  reportId,
  generatedDate,
  pageNumber,
  totalPages,
}: PageProps) {
  const { derived_flags } = payload;

  return (
    <div style={pageStyle}>
      <div>
        <PageHeader sectionLabel="SECTION 02 · EXECUTIVE SUMMARY" title="Executive Summary" />

        {/* Narrative Grid */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "16px", marginBottom: "22px" }}>
          <div style={{ backgroundColor: theme.color.panelBg, borderRadius: "12px", padding: "18px", border: `1px solid ${theme.color.hairline}` }}>
            <h3 style={{ fontSize: "13px", fontWeight: 700, color: theme.color.navy, margin: "0 0 8px 0", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Decision Context
            </h3>
            <p style={{ fontSize: "12.5px", lineHeight: "1.6", margin: 0, color: theme.color.ink }}>
              {narrative.executive_summary}
            </p>
          </div>

          <div style={{ backgroundColor: theme.color.panelBgAlt, borderRadius: "12px", padding: "18px", border: `1px solid ${theme.color.goldSoft}`, borderLeft: `3px solid ${theme.color.gold}` }}>
            <h3 style={{ fontSize: "13px", fontWeight: 700, color: theme.color.gold, margin: "0 0 8px 0", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Critical Finding
            </h3>
            <p style={{ fontSize: "12.5px", lineHeight: "1.6", margin: 0, color: theme.color.navy, fontWeight: 500 }}>
              {narrative.critical_finding}
            </p>
          </div>
        </div>

        {/* Two-minute read: one factual line per school */}
        <h3 style={{ fontSize: "13px", fontWeight: 700, color: theme.color.navy, margin: "0 0 12px 0", textTransform: "uppercase", letterSpacing: "0.05em" }}>
          Two-Minute Read
        </h3>
        <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginBottom: "22px" }}>
          {narrative.two_minute_lines.map((line, idx) => (
            <div key={idx} style={{ display: "flex", alignItems: "flex-start", gap: "10px", padding: "10px 14px", backgroundColor: theme.color.panelBg, border: `1px solid ${theme.color.hairline}`, borderRadius: "8px" }}>
              <div style={{ flexGrow: 1 }}>
                <div style={{ fontSize: "10px", color: theme.color.navy, fontWeight: 700, textTransform: "uppercase" }}>{line.school}</div>
                <div style={{ fontSize: "12px", color: theme.color.ink, lineHeight: "1.5" }}>{line.line}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Ranges — factual spread across the selected schools, not a ranking */}
        <h3 style={{ fontSize: "13px", fontWeight: 700, color: theme.color.navy, margin: "0 0 12px 0", textTransform: "uppercase", letterSpacing: "0.05em" }}>
          Cost & Outcomes Range
        </h3>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "12px" }}>
          <RangeTile label="Net Price Range" low={derived_flags.cost_range_low} high={derived_flags.cost_range_high} />
          <RangeTile label="Program Earnings Range" low={derived_flags.earnings_range_low} high={derived_flags.earnings_range_high} />
          <RangeTile label="Typical Debt Range" low={derived_flags.debt_range_low} high={derived_flags.debt_range_high} />
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

function RangeTile({ label, low, high }: { label: string; low: string; high: string }) {
  const hasData = low !== "" && high !== "";
  return (
    <div style={{ padding: "10px 14px", backgroundColor: theme.color.panelBg, border: `1px solid ${theme.color.hairline}`, borderRadius: "8px" }}>
      <div style={{ fontSize: "10px", color: theme.color.inkMuted, fontWeight: 700, textTransform: "uppercase" }}>{label}</div>
      <div style={{ fontSize: "12.5px", fontWeight: 700, color: theme.color.ink }}>
        {hasData ? `${formatUsd(Number(low))} – ${formatUsd(Number(high))}` : "Not published"}
      </div>
    </div>
  );
}
