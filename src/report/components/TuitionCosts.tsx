import React from "react";
import { monthYearFromIso } from "../utils/dataVintage";
import type { C1LitePayload } from "../services/reportPrompt";
import { theme } from "./theme";
import { STICKER_FOOTNOTE, type StickerScenario } from "../utils/stickerPrice";
import { pageStyle, PageHeader, PageFooter } from "./PageChrome";

export interface TuitionCostsProps {
  payload: C1LitePayload;
  reportId: string;
  generatedDate: string;
  pageNumber: number;
  totalPages: number;
}

// Bolded inside the sticker-price footnote (text itself is unchanged).
const COA_EMPHASIS =
  "College Scorecard's average cost of attendance is a different measure: it averages living costs across students who live on campus, off campus and with family, so it can be lower or higher than either scenario";

function Scenario({ s }: { s: StickerScenario }) {
  if (s.published) return <>{money(s.total)}</>;
  return (
    <>
      Not published
      <div style={{ fontSize: "8.5px", fontWeight: 400, color: theme.color.inkMuted }}>
        missing: {s.missing.join(", ")}
      </div>
    </>
  );
}

function money(v: number | null): string {
  return v != null ? `$${v.toLocaleString()}` : "Not published";
}

/**
 * One row per unique college (payload.college_details is already deduped by
 * unitid) — the full sticker/tuition/living-cost breakdown is school-level,
 * so it doesn't repeat when a college is compared under multiple programs.
 */
export default function TuitionCosts({
  payload,
  reportId,
  generatedDate,
  pageNumber,
  totalPages,
}: TuitionCostsProps) {
  const { college_details } = payload;
  const releaseMonth = monthYearFromIso(payload.data_vintage?.release_date);
  // Few colleges leave the page mostly empty, so rows get extra breathing room.
  const roomy = college_details.length <= 2;
  // 5+ colleges would overflow the page, so tighten rows/columns a little.
  const compact = college_details.length >= 5;
  const cellPad = roomy ? "12px 6px" : compact ? "3px 4px" : "6px";
  const tableFont = compact ? "9px" : "10.5px";

  const th = (align: "left" | "right" = "right"): React.CSSProperties => ({
    padding: cellPad,
    fontWeight: 600,
    textAlign: align,
  });
  const td: React.CSSProperties = {
    padding: cellPad,
    textAlign: "right",
    color: theme.color.ink,
  };
  const tableStyle: React.CSSProperties = {
    width: "100%",
    borderCollapse: "collapse",
    fontSize: tableFont,
    border: `1px solid ${theme.color.hairline}`,
  };
  const headRow: React.CSSProperties = {
    backgroundColor: theme.color.navy,
    color: theme.color.white,
    textAlign: "left",
  };
  const bodyRow = (i: number): React.CSSProperties => ({
    borderBottom: `1px solid ${theme.color.hairline}`,
    backgroundColor: i % 2 === 0 ? theme.color.panelBgAlt : theme.color.panelBg,
  });
  const nameCell: React.CSSProperties = {
    padding: cellPad,
    fontWeight: 700,
    color: theme.color.navy,
  };
  const subHeading: React.CSSProperties = {
    fontSize: "13px",
    fontWeight: 700,
    color: theme.color.navy,
    margin: "0 0 10px 0",
    textTransform: "uppercase",
    letterSpacing: "0.05em",
  };
  const note: React.CSSProperties = {
    fontSize: compact ? "9px" : "10px",
    lineHeight: compact ? "1.4" : "1.5",
    color: theme.color.inkMuted,
  };

  return (
    <div style={pageStyle}>
      <div>
        <PageHeader
          sectionLabel="SECTION 08 · TUITION & COSTS"
          title="Tuition & Cost of Attendance"
        />

        <p
          style={{
            fontSize: "11.5px",
            lineHeight: "1.6",
            color: theme.color.ink,
            margin: compact ? "0 0 12px 0" : "0 0 20px 0",
          }}
        >
          Tuition and cost-of-attendance components as reported to IPEDS, and
          the net price for your household income range
          {payload.student.income_bracket_label
            ? ` (${payload.student.income_bracket_label})`
            : ""}
          .
        </p>

        {/* Table 1 — cost components */}
        <h3 style={subHeading}>Cost Components</h3>
        <table style={{ ...tableStyle, marginBottom: compact ? "16px" : "28px" }}>
          <thead>
            <tr style={headRow}>
              <th style={th("left")}>College</th>
              <th style={th()}>Tuition (In-State)</th>
              <th style={th()}>Tuition (Out-of-State)</th>
              <th style={th()}>Room & Board (On-Campus)</th>
              <th style={th()}>Room & Board (Off-Campus)</th>
              <th style={th()}>Books & Supplies</th>
              <th style={th()}>Other Expense (On-Campus)</th>
              <th style={th()}>Other Expense (Off-Campus)</th>
              <th style={th()}>Other Expense (With Family)</th>
            </tr>
          </thead>
          <tbody>
            {college_details.map((c, i) => (
              <tr key={c.unitid} style={bodyRow(i)}>
                <td style={nameCell}>{c.name}</td>
                <td style={td}>{money(c.tuition.tuition_in_state)}</td>
                <td style={td}>{money(c.tuition.tuition_out_state)}</td>
                <td style={td}>{money(c.tuition.room_board_on_campus)}</td>
                <td style={td}>{money(c.tuition.room_board_off_campus)}</td>
                <td style={td}>{money(c.tuition.books_supply)}</td>
                <td style={td}>{money(c.tuition.other_expense_on_campus)}</td>
                <td style={td}>{money(c.tuition.other_expense_off_campus)}</td>
                <td style={td}>{money(c.tuition.other_expense_with_family)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Table 2 — sticker vs. income-based net price */}
        <h3 style={subHeading}>Sticker Price & Net Price</h3>
        <table style={{ ...tableStyle, marginBottom: "16px" }}>
          <thead>
            <tr style={headRow}>
              <th style={th("left")}>College</th>
              <th style={th()}>Net Price</th>
              <th style={th()}>Sticker price: in-state, living on campus</th>
              <th style={th()}>Sticker price: out-of-state, living off campus</th>
              <th style={th()}>Scorecard average cost of attendance</th>
            </tr>
          </thead>
          <tbody>
            {college_details.map((c, i) => (
              <tr key={c.unitid} style={bodyRow(i)}>
                <td style={nameCell}>
                  {c.name}{" "}
                  <span style={{ fontWeight: 400, color: theme.color.ink }}>
                    Unitid - {c.unitid}
                  </span>
                </td>
                <td style={{ ...td, color: theme.color.navy, fontWeight: 700 }}>
                  {money(c.tuition.net_price)}
                </td>
                <td style={td}>
                  <Scenario s={c.tuition.sticker_in_state_on_campus} />
                </td>
                <td style={td}>
                  <Scenario s={c.tuition.sticker_out_state_off_campus} />
                </td>
                <td style={td}>
                  {money(c.tuition.scorecard_avg_coa)}
                  {c.tuition.scorecard_avg_coa != null &&
                  c.tuition.scorecard_avg_coa_year ? (
                    <div style={{ fontSize: "8.5px", color: theme.color.inkMuted }}>
                      {c.tuition.scorecard_avg_coa_year}
                    </div>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <p style={{ ...note, margin: 0 }}>
          {STICKER_FOOTNOTE.split(COA_EMPHASIS).map((part, i, arr) => (
            <React.Fragment key={i}>
              {part}
              {i < arr.length - 1 && <strong>{COA_EMPHASIS}</strong>}
            </React.Fragment>
          ))}
        </p>
        <p style={{ ...note, margin: "8px 0 0 0" }}>
          Net Price is the average annual price after grants and scholarships for
          students in your household income range, taken from the U.S.
          Department of Education's College Scorecard API{releaseMonth ? ` (${releaseMonth} release)` : ""}, which reports net price by income bracket for each school.
          It shows “Not published” when the school reports no figure for your
          bracket.
        </p>
        <p style={{ ...note, fontStyle: "italic", margin: "8px 0 0 0" }}>
          Net Price is an estimate only, based on income-range averages rather
          than your individual aid offer. For more accurate details, visit the
          admissions or financial aid office of the respective university.
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
