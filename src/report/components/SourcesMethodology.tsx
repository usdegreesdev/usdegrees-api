import React from "react";
import type { C1LitePayload } from "../services/reportPrompt";
import { theme } from "./theme";
import { pageStyle, PageHeader, PageFooter } from "./PageChrome";

export interface SourcesMethodologyProps {
  payload: C1LitePayload;
  reportId: string;
  generatedDate: string;
  pageNumber: number;
  totalPages: number;
}

interface SourceRow {
  source: string;
  domain: string;
  usedFor: string;
  notes: string;
}

const SOURCES: SourceRow[] = [
  {
    source: "College Scorecard API",
    domain: "collegescorecard.ed.gov",
    usedFor:
      "University Details, Academic Data, Completion Rates, Median Debt, Graduation Rate, Admission Rate, SAT Ranges, Retention",
    notes: "U.S. Dept. of Education",
  },
  {
    source: "Post-Secondary Employment Outcomes (PSEO)",
    domain: "lehd.ces.census.gov",
    usedFor:
      "Graduate earnings, employment outcomes, and earnings by degree field and institution",
    notes:
      "U.S. Census Bureau Longitudinal Employer-Household Dynamics (LEHD) program",
  },
  {
    source: "IPEDS",
    domain: "nces.ed.gov/ipeds",
    usedFor:
      "Sticker tuition, room & board, demographics, student–faculty ratio, enrollment counts - Verifications",
    notes:
      "Integrated Postsecondary Education Data System, U.S. Dept. of Education",
  },
  {
    source: "College Navigator",
    domain: "nces.ed.gov/collegenavigator",
    usedFor:
      "Cross-verification of institutional identifiers, program availability, and accreditation status",
    notes: "NCES public lookup tool",
  },
  {
    source: "Athletics Disclosure (EADA)",
    domain: "ope.ed.gov/athletics",
    usedFor:
      "Athletics data is sourced from the U.S. Department of Education's Equity in Athletics Disclosure Act (EADA) database.",
    notes: "Equity in Athletics Disclosure Act, U.S. Dept. of Education",
  },
];

export default function SourcesMethodology({
  reportId,
  generatedDate,
  pageNumber,
  totalPages,
}: SourcesMethodologyProps) {
  const th: React.CSSProperties = {
    padding: "10px",
    fontWeight: 600,
    textAlign: "left",
    verticalAlign: "top",
  };
  const td: React.CSSProperties = {
    padding: "10px",
    verticalAlign: "top",
    color: theme.color.ink,
    lineHeight: "1.45",
  };

  return (
    <div style={pageStyle}>
      <div>
        <PageHeader
          sectionLabel="SECTION 09 · PRIMARY SOURCES"
          title="Primary Data Sources"
        />

        {/* Plain-language brief */}
        <p
          style={{
            fontSize: "12px",
            lineHeight: "1.6",
            color: theme.color.ink,
            margin: "0 0 20px 0",
          }}
        >
          Every figure in this report is drawn from public federal datasets. We
          maintain no commercial relationships with the institutions evaluated,
          and no sponsored placement of any kind appears in these pages. Using
          government-published data keeps the comparison transparent, auditable,
          and free of the incentives that shape marketing materials — you can
          trace each metric back to its original source below.
        </p>

        {/* Sources Table */}
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            fontSize: "10.5px",
            border: `1px solid ${theme.color.hairline}`,
          }}
        >
          <thead>
            <tr
              style={{
                backgroundColor: theme.color.navy,
                color: theme.color.white,
              }}
            >
              <th style={{ ...th, width: "22%" }}>Source</th>
              <th style={{ ...th, width: "46%" }}>What we used it for</th>
              <th style={{ ...th, width: "32%" }}>Notes</th>
            </tr>
          </thead>
          <tbody>
            {SOURCES.map((row, i) => (
              <tr
                key={i}
                style={{
                  borderBottom: `1px solid ${theme.color.hairline}`,
                  backgroundColor:
                    i % 2 === 0 ? theme.color.panelBgAlt : theme.color.panelBg,
                }}
              >
                <td style={td}>
                  <strong style={{ color: theme.color.navy }}>
                    {row.source}
                  </strong>
                  <div
                    style={{
                      color: theme.color.gold,
                      fontSize: "9.5px",
                      marginTop: "2px",
                    }}
                  >
                    {row.domain}
                  </div>
                </td>
                <td style={td}>{row.usedFor}</td>
                <td style={{ ...td, color: theme.color.inkMuted }}>
                  {row.notes}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Footnote on no-fabrication policy */}
        <div
          style={{
            marginTop: "22px",
            padding: "14px 16px",
            backgroundColor: theme.color.panelBg,
            border: `1px solid ${theme.color.hairline}`,
            borderLeft: `3px solid ${theme.color.gold}`,
            borderRadius: "8px",
          }}
        >
          <p
            style={{
              fontSize: "10.5px",
              fontStyle: "italic",
              lineHeight: "1.6",
              color: theme.color.inkMuted,
              margin: 0,
            }}
          >
            We do not buy, sell, or blend data with commercial or institutional
            sources. Missing figures in the underlying federal datasets are
            shown as N/A — never estimated, except for program earnings where
            Census PSEO data is unavailable. Such earnings estimates are
            clearly labelled and derived only from real reported earnings using
            program- and credential-level growth patterns. They are never
            generated from other estimates and should be treated as indicative,
            not as measured earnings for a specific program.
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
