import React from "react";
import type { C1LitePayload } from "../services/reportPrompt";
import { theme } from "./theme";
import { pageStyle, PageHeader, PageFooter } from "./PageChrome";
import { formatUsd } from "./format";

export interface AthleticsProps {
  payload: C1LitePayload;
  reportId: string;
  generatedDate: string;
  pageNumber: number;
  totalPages: number;
}

const MAX_PER_PAGE = 3;

/**
 * Splits colleges across Athletics pages, at most MAX_PER_PAGE each, filling
 * pages evenly in the original order: 1–3 → one page, 4 → 2+2, 5 → 3+2.
 */
export function athleticsPageSizes(count: number): number[] {
  if (count <= 0) return [0];
  const pages = Math.ceil(count / MAX_PER_PAGE);
  const sizes: number[] = [];
  let remaining = count;
  for (let p = pages; p > 0; p--) {
    const size = Math.ceil(remaining / p);
    sizes.push(size);
    remaining -= size;
  }
  return sizes;
}

/** Number of pages Section 07 occupies for this many colleges. */
export function athleticsPageCount(collegeCount: number): number {
  return athleticsPageSizes(collegeCount).length;
}

const money = formatUsd;
const NOT_PUBLISHED = "Not published";

function num(v: number | null): string {
  return v != null ? v.toLocaleString() : NOT_PUBLISHED;
}

// Division averages use one rule everywhere: one decimal place.
function avg1(v: number | null): string {
  return v != null
    ? v.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 })
    : NOT_PUBLISHED;
}

/** "-", empty and null all mean the source did not publish the value. */
function textOrNotPublished(v: string | null | undefined): string {
  const t = v?.trim();
  return t && t !== "-" ? t : NOT_PUBLISHED;
}

/**
 * Three or fewer cards share each page, so every sport is printed in full.
 */
function formatSportsLineFromRoster(roster: { sport: string }[]) {
  return roster.map((r) => r.sport).join(", ");
}

type College = C1LitePayload["college_details"][number];

const label = (small = false): React.CSSProperties => ({
  color: theme.color.inkMuted,
  textTransform: "uppercase",
  fontSize: small ? "8px" : "9px",
  fontWeight: 700,
});

function CollegeBlock({ c }: { c: College }) {
  const a = c.athletics;
  const blockStyle: React.CSSProperties = {
    border: `1px solid ${theme.color.hairline}`,
    borderRadius: "12px",
    padding: "16px",
    backgroundColor: theme.color.panelBg,
    // A college block is never split across two pages.
    pageBreakInside: "avoid",
    breakInside: "avoid",
  };

  if (!a) {
    return (
      <div style={blockStyle}>
        <div
          style={{
            fontWeight: 700,
            color: theme.color.navy,
            marginBottom: "4px",
            fontSize: "13px",
          }}
        >
          {c.name}
        </div>
        <div style={{ fontSize: "11px", color: theme.color.inkMuted }}>
          Not available in the federal EADA database; the institution may not be required to report athletics data under federal disclosure requirements.
        </div>
      </div>
    );
  }

  // No per-sport rows means the sports data was not published — it is not
  // zero sports, and the athlete totals derived from those rows are not
  // zero either.
  const sportsKnown = a.hasRosterData && a.roster.length > 0;
  const sportsCount = sportsKnown ? a.roster.length : null;

  return (
    <div style={blockStyle}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          marginBottom: "10px",
        }}
      >
        <div>
          <div style={{ fontWeight: 700, color: theme.color.navy, fontSize: "13px" }}>
            {c.name}
          </div>
          <div style={{ fontSize: "10.5px", color: theme.color.inkMuted }}>
            Survey year {textOrNotPublished(a.surveyYear)}
          </div>
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
          {textOrNotPublished(a.division)}
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
          gap: "10px",
          fontSize: "10.5px",
          marginBottom: "10px",
        }}
      >
        <div>
          <div style={label()}>Sports Offered</div>
          <div style={{ color: theme.color.ink, fontWeight: 700 }}>
            {sportsCount != null
              ? `${sportsCount} ${sportsCount === 1 ? "sport" : "sports"}`
              : NOT_PUBLISHED}
          </div>
        </div>
        <div>
          <div style={label()}>Roster spots (M / W)</div>
          <div style={{ color: theme.color.ink, fontWeight: 700 }}>
            {sportsKnown
              ? `${num(a.summary.athletesMen)} / ${num(a.summary.athletesWomen)}`
              : NOT_PUBLISHED}
          </div>
          {sportsKnown && (
            <div style={{ color: theme.color.inkMuted, fontSize: "9px" }}>
              Unduplicated athletes: {num(a.summary.athletesTotal)}
            </div>
          )}
        </div>
        <div>
          <div style={label()}>Athletic Revenue</div>
          <div style={{ color: theme.color.ink, fontWeight: 700 }}>
            {money(a.summary.athleticRevenue)}
          </div>
        </div>
        <div>
          <div style={label()}>Athletic Expense</div>
          <div style={{ color: theme.color.ink, fontWeight: 700 }}>
            {money(a.summary.athleticExpense)}
          </div>
        </div>
      </div>

      {sportsKnown && (
        <div
          style={{
            marginBottom: "6px",
            paddingTop: "5px",
            borderTop: `1px solid ${theme.color.hairline}`,
            display: "flex",
            alignItems: "center",
            gap: "6px",
            lineHeight: 1.2,
          }}
        >
          <div style={{ ...label(), flexShrink: 0 }}>Sports Offered</div>
          <div
            style={{
              color: theme.color.navy,
              fontWeight: 700,
              fontSize: "9px",
              lineHeight: 1.4,
              flex: 1,
            }}
          >
            {formatSportsLineFromRoster(a.roster)}
          </div>
        </div>
      )}

      {sportsKnown &&
        a.summary.athleticRevenue != null &&
        a.summary.athleticRevenue === a.summary.athleticExpense && (
          <div
            style={{
              fontSize: "9.5px",
              color: theme.color.inkFaint,
              paddingBottom: "6px",
            }}
          >
            Revenue equals expense as reported to EADA.
          </div>
        )}

      {sportsKnown && a.divisionBenchmark && (
        <div
          style={{
            fontSize: "9.5px",
            color: theme.color.inkFaint,
            borderTop: `1px solid ${theme.color.hairline}`,
            paddingTop: "8px",
          }}
        >
          {a.divisionBenchmark.division} division average: {avg1(a.divisionBenchmark.avgAthletesTotal)} athletes, {money(a.divisionBenchmark.avgAidPerAthlete)} aid/athlete
        </div>
      )}
    </div>
  );
}

/**
 * One card per unique college (payload.college_details is already deduped by
 * unitid) — athletics data is school-level (EADA reporting), so it doesn't
 * repeat when a college is compared under multiple programs. At most three
 * cards per page; later pages repeat the header marked "(continued)".
 */
export default function Athletics({
  payload,
  reportId,
  generatedDate,
  pageNumber,
  totalPages,
}: AthleticsProps) {
  const { college_details } = payload;
  const sizes = athleticsPageSizes(college_details.length);
  let cursor = 0;
  const pages = sizes.map((size) => {
    const slice = college_details.slice(cursor, cursor + size);
    cursor += size;
    return slice;
  });

  return (
    <>
      {pages.map((colleges, pageIdx) => (
        <div key={pageIdx} style={pageStyle}>
          <div>
            <PageHeader
              sectionLabel={
                pageIdx === 0
                  ? "SECTION 08 · ATHLETICS"
                  : "SECTION 08 · ATHLETICS (continued)"
              }
              title="Athletics Program Overview"
            />

            {pageIdx === 0 && (
              <p
                style={{
                  fontSize: "11.5px",
                  lineHeight: "1.5",
                  color: theme.color.ink,
                  margin: "0 0 20px 0",
                }}
              >
                Sourced from Equity in Athletics Disclosure Act (EADA) filings, the
                most recent survey year on file per institution. Shown for
                informational context only — not a factor in academic fit or cost
                comparisons elsewhere in this report. Roster spots count an athlete once for each sport; unduplicated athletes is the EADA total of individual athletes.
              </p>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
              {colleges.map((c) => (
                <CollegeBlock key={c.unitid} c={c} />
              ))}
            </div>
          </div>

          <PageFooter
            reportId={reportId}
            generatedDate={generatedDate}
            pageNumber={pageNumber + pageIdx}
            totalPages={totalPages}
          />
        </div>
      ))}
    </>
  );
}
