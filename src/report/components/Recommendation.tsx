import React from "react";
import type { C1LitePayload, C1LiteNarrative } from "../services/reportPrompt";
import { theme } from "./theme";
import { pageStyle, PageHeader, PageFooter } from "./PageChrome";

export interface RecommendationProps {
  payload: C1LitePayload;
  narrative: C1LiteNarrative;
  reportId: string;
  generatedDate: string;
  pageNumber: number;
  totalPages: number;
}

/**
 * Formerly "Recommendation & Institutional Fit" — the C1-Lite report makes no
 * recommendation, so this page instead lays out fit context per school and
 * closes with the neutral decision framing (plain_english_question). No
 * ranking, no strengths/weaknesses scoring, no winner.
 *
 * Split across two pages: the per-school fit cards (RecommendationFit) and
 * the closing decision-framing panel (RecommendationQuestion). With more
 * than a couple of compared schools, the fit cards plus the question panel
 * overflowed a single fixed-height A4 page.
 */
export function RecommendationFit({
  payload,
  narrative,
  reportId,
  generatedDate,
  pageNumber,
  totalPages,
}: RecommendationProps) {
  const sentenceFor = (displayName: string) =>
    narrative.fit_sentences.find((f) => f.school === displayName)?.sentence ??
    null;

  return (
    <div style={pageStyle}>
      <div>
        <PageHeader
          sectionLabel="SECTION 05 · ACADEMIC FIT"
          title="Academic Fit by School"
        />

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "16px",
          }}
        >
          {payload.schools.map((s, i) => (
            <div
              key={i}
              style={{
                border: `1px solid ${theme.color.hairline}`,
                borderRadius: "12px",
                padding: "16px",
                backgroundColor: theme.color.panelBg,
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                  marginBottom: "10px",
                }}
              >
                <div>
                  <h4
                    style={{
                      fontFamily: theme.font.family,
                      fontSize: "15px",
                      fontWeight: 700,
                      color: theme.color.navy,
                      margin: "0 0 4px 0",
                    }}
                  >
                    {s.name}
                  </h4>
                  {s.program_name && (
                    <div
                      style={{
                        fontSize: "11px",
                        fontWeight: 600,
                        color: theme.color.gold,
                        margin: "0 0 4px 0",
                      }}
                    >
                      {s.program_name}
                    </div>
                  )}
                  <span
                    style={{ fontSize: "11px", color: theme.color.inkMuted }}
                  >
                    {s.city}, {s.state}
                  </span>
                </div>
                <div
                  style={{
                    padding: "4px 10px",
                    borderRadius: "20px",
                    fontSize: "11px",
                    fontWeight: 700,
                    color: theme.color.navy,
                    backgroundColor: theme.color.panelBgAlt,
                    border: `1px solid ${theme.color.hairline}`,
                  }}
                >
                  {s.fit_label}
                  {s.fit_score != null ? ` · ${s.fit_score}` : ""}
                </div>
              </div>
              <p
                style={{
                  fontSize: "11.5px",
                  color: theme.color.ink,
                  lineHeight: "1.5",
                  margin: 0,
                }}
              >
                {sentenceFor(s.display_name) ??
                  "Fit sentence not available for this school."}
              </p>
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

export function RecommendationQuestion({
  narrative,
  reportId,
  generatedDate,
  pageNumber,
  totalPages,
}: RecommendationProps) {
  return (
    <div style={pageStyle}>
      <div>
        <PageHeader
          sectionLabel="SECTION 09 · THE DECISION"
          title="The Decision Ahead"
        />

        {/* Neutral decision framing — no winner named */}
        <div
          style={{
            backgroundColor: theme.color.panelBgAlt,
            border: `1px solid ${theme.color.goldSoft}`,
            borderLeft: `3px solid ${theme.color.gold}`,
            borderRadius: "12px",
            padding: "20px",
          }}
        >
          <h3
            style={{
              fontSize: "14px",
              fontWeight: 700,
              color: theme.color.gold,
              margin: "0 0 10px 0",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
            }}
          >
            A Question to Weigh, Not an Answer
          </h3>
          <p
            style={{
              fontSize: "12.5px",
              lineHeight: "1.65",
              color: theme.color.navy,
              fontWeight: 500,
              margin: 0,
            }}
          >
            {narrative.plain_english_question}
          </p>
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
