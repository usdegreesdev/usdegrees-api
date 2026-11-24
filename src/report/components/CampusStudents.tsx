import { ENROLLMENT_12_MONTH_HEADER } from "../config/sizeCategories.config";
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
  return v != null ? v.toLocaleString() : "Not published";
}

const MEN_PIE = theme.color.navy;
const WOMEN_PIE = theme.color.gold;
const MEN_RING = "#6F8DBA";
const WOMEN_RING = "#DCC47A";
const NO_DATA = "#E4E0D4";

/** Annular slice between two fractions (0–1, clockwise from 12 o'clock). */
function slicePath(
  cx: number,
  cy: number,
  rIn: number,
  rOut: number,
  from: number,
  to: number,
): string {
  const pt = (r: number, f: number): [number, number] => {
    const a = f * 2 * Math.PI - Math.PI / 2;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  };
  // A full circle can't be drawn as one arc; split it in half.
  if (to - from >= 0.9999) {
    return `${slicePath(cx, cy, rIn, rOut, from, from + 0.5)} ${slicePath(cx, cy, rIn, rOut, from + 0.5, from + 1)}`;
  }
  const large = to - from > 0.5 ? 1 : 0;
  const [x1, y1] = pt(rOut, from);
  const [x2, y2] = pt(rOut, to);
  const [x3, y3] = pt(rIn, to);
  const [x4, y4] = pt(rIn, from);
  const inner =
    rIn > 0
      ? `L ${x3} ${y3} A ${rIn} ${rIn} 0 ${large} 0 ${x4} ${y4} Z`
      : "L " + cx + " " + cy + " Z";
  return `M ${x1} ${y1} A ${rOut} ${rOut} 0 ${large} 1 ${x2} ${y2} ${inner}`;
}

/** Two-slice (men / women) ring or pie; grey when neither value is published. */
const CX = 100;
const CY = 75;

function GenderSlices({
  men,
  women,
  rIn,
  rOut,
  menColor,
  womenColor,
  labels,
}: {
  men: number | null | undefined;
  women: number | null | undefined;
  rIn: number;
  rOut: number;
  menColor: string;
  womenColor: string;
  /** "inside" prints values on the slices (white); "outside" prints them beside the ring. */
  labels: "inside" | "outside";
}) {
  const total = (men ?? 0) + (women ?? 0);
  if (total <= 0) {
    return <path d={slicePath(CX, CY, rIn, rOut, 0, 1)} fill={NO_DATA} />;
  }
  const mf = (men ?? 0) / total;
  const slices = [
    { key: "m", from: 0, to: mf, pct: men, color: menColor, word: "Men" },
    { key: "w", from: mf, to: 1, pct: women, color: womenColor, word: "Women" },
  ].filter((s) => s.to - s.from > 0 && s.pct != null);

  return (
    <>
      {slices.map((s) => (
        <path
          key={s.key}
          d={slicePath(CX, CY, rIn, rOut, s.from, s.to)}
          fill={s.color}
          stroke="#fff"
          strokeWidth={0.8}
        />
      ))}
      {slices.map((s) => {
        const mid = (s.from + s.to) / 2;
        const ang = mid * 2 * Math.PI - Math.PI / 2;
        const pct = `${(s.pct as number).toFixed(0)}%`;
        if (labels === "inside") {
          // Thin slices can't hold text; the legend/caption still carries them.
          if (s.to - s.from < 0.12) return null;
          const r = rOut * 0.58;
          const x = CX + r * Math.cos(ang);
          const y = CY + r * Math.sin(ang);
          return (
            <text key={`l${s.key}`} x={x} y={y} textAnchor="middle" fill="#fff" fontWeight={700} fontSize={10}>
              <tspan x={x} dy="-1">{pct}</tspan>
              <tspan x={x} dy="10" fontSize={8.5} fontWeight={600}>{s.word}</tspan>
            </text>
          );
        }
        const r = rOut + 5;
        const cos = Math.cos(ang);
        const x = CX + r * cos;
        const y = CY + r * Math.sin(ang);
        return (
          <text
            key={`l${s.key}`}
            x={x}
            y={y}
            textAnchor={Math.abs(cos) < 0.25 ? "middle" : cos > 0 ? "start" : "end"}
            dominantBaseline="middle"
            fill={theme.color.ink}
            fontWeight={700}
            fontSize={9}
          >
            {pct} {s.word === "Men" ? "M" : "W"}
          </text>
        );
      })}
    </>
  );
}

/**
 * Inner pie = the student body's men / women split; outer ring = faculty
 * men / women. Both are shares of 100%, so the two layers read side by side.
 */
function CompositionDonut({ c }: { c: C1LitePayload["college_details"][number] }) {
  const k = c.campus;
  return (
    <svg width="100%" height="82" viewBox="0 14 200 122" role="img" aria-label={`${c.name} student and faculty composition`}>
      <GenderSlices men={k.faculty_men_pct} women={k.faculty_women_pct} rIn={47} rOut={57} menColor={MEN_RING} womenColor={WOMEN_RING} labels="outside" />
      <GenderSlices men={k.demographics_men_pct} women={k.demographics_women_pct} rIn={0} rOut={42} menColor={MEN_PIE} womenColor={WOMEN_PIE} labels="inside" />
    </svg>
  );
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
          sectionLabel="SECTION 07 · CAMPUS & STUDENTS"
          title="Campus & Student Body"
        />

        <p
          style={{
            fontSize: "11.5px",
            lineHeight: "1.6",
            color: theme.color.ink,
            margin: "0 0 10px 0",
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
            fontSize: "9.5px",
            marginBottom: "8px",
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
              <th style={{ padding: "6px 8px", fontWeight: 600 }}>College</th>
              <th
                style={{ padding: "6px 8px", fontWeight: 600, textAlign: "right" }}
              >
                Size of college
                <div style={{ fontSize: "8px", fontWeight: 400 }}>student body</div>
              </th>
              <th
                style={{ padding: "6px 8px", fontWeight: 600, textAlign: "right" }}
              >
                Undergrad enrollment
                <div style={{ fontSize: "8px", fontWeight: 400 }}>{ENROLLMENT_12_MONTH_HEADER}</div>
              </th>
              <th
                style={{ padding: "6px 8px", fontWeight: 600, textAlign: "right" }}
              >
                Grad enrollment
                <div style={{ fontSize: "8px", fontWeight: 400 }}>{ENROLLMENT_12_MONTH_HEADER}</div>
              </th>
              <th
                style={{ padding: "6px 8px", fontWeight: 600, textAlign: "right" }}
              >
                Student:Faculty
              </th>
              <th
                style={{ padding: "6px 8px", fontWeight: 600, textAlign: "right" }}
              >
                Graduation Rate
                <div style={{ fontSize: "8.5px", fontWeight: 400 }}>
                  within 150% of normal time
                </div>
              </th>
              <th
                style={{ padding: "6px 8px", fontWeight: 600, textAlign: "right" }}
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
                    padding: "4px 8px",
                    fontWeight: 700,
                    color: theme.color.navy,
                  }}
                >
                  {c.name}
                </td>
                <td
                  style={{
                    padding: "4px 8px",
                    textAlign: "right",
                    color: theme.color.ink,
                  }}
                >
                  {num(c.campus.size)}
                </td>
                <td
                  style={{
                    padding: "4px 8px",
                    textAlign: "right",
                    color: theme.color.ink,
                  }}
                >
                  {num(c.campus.enrollment_undergrad)}
                </td>
                <td
                  style={{
                    padding: "4px 8px",
                    textAlign: "right",
                    color: theme.color.ink,
                  }}
                >
                  {c.campus.enrollment_grad == null && c.campus.no_graduate_programs
                    ? "No graduate programs"
                    : num(c.campus.enrollment_grad)}
                </td>
                <td
                  style={{
                    padding: "4px 8px",
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
                    padding: "4px 8px",
                    textAlign: "right",
                    color: theme.color.ink,
                  }}
                >
                  <GradRateCell rate={c.campus.graduation_rate} />
                </td>
                <td
                  style={{
                    padding: "4px 8px",
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
            margin: "0 0 10px 0",
          }}
        >
          Size of college is the institution's reported student body size; the enrollment columns use a different basis. Undergraduate and graduate enrollment figures reflect the unduplicated
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
          Student Faculty Composition
        </h3>
        {/* Legend: inner pie = students, outer ring = faculty */}
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "6px 18px",
            fontSize: "9.5px",
            color: theme.color.inkMuted,
            marginBottom: "8px",
          }}
        >
          <span>
            <strong style={{ color: theme.color.ink }}>Inner pie:</strong> students
          </span>
          <span>
            <strong style={{ color: theme.color.ink }}>Outer ring:</strong> faculty
          </span>
          {(
            [
              ["Men", MEN_PIE, MEN_RING],
              ["Women", WOMEN_PIE, WOMEN_RING],
            ] as const
          ).map(([label, pie, ring]) => (
            <span key={label} style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
              <span style={{ width: 9, height: 9, borderRadius: 2, background: pie, display: "inline-block" }} />
              <span style={{ width: 9, height: 9, borderRadius: 2, background: ring, display: "inline-block" }} />
              {label}
            </span>
          ))}
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
            gap: "8px",
          }}
        >
          {college_details.map((c) => {
            const k = c.campus;
            const studentsKnown =
              k.demographics_men_pct != null || k.demographics_women_pct != null;
            const facultyKnown =
              k.faculty_men_pct != null || k.faculty_women_pct != null;
            return (
              <div
                key={c.unitid}
                style={{
                  border: `1px solid ${theme.color.hairline}`,
                  borderRadius: "10px",
                  padding: "6px 6px 7px",
                  backgroundColor: theme.color.panelBg,
                  fontSize: "9.5px",
                  color: theme.color.ink,
                  textAlign: "center",
                  breakInside: "avoid",
                  pageBreakInside: "avoid",
                }}
              >
                <div
                  style={{
                    fontWeight: 700,
                    color: theme.color.navy,
                    fontSize: "10px",
                    lineHeight: 1.25,
                    minHeight: "25px",
                    marginBottom: "4px",
                  }}
                >
                  {c.name}
                </div>
                <CompositionDonut c={c} />
                <div style={{ color: theme.color.inkMuted, marginTop: "2px" }}>
                  {k.size != null
                    ? `${k.size.toLocaleString()} students`
                    : "Size: Not published"}
                </div>
                <div style={{ marginTop: "3px", lineHeight: 1.35 }}>
                  <strong>Students:</strong>{" "}
                  {studentsKnown
                    ? `${pctDecimal(k.demographics_men_pct)} M · ${pctDecimal(k.demographics_women_pct)} W`
                    : "Not published"}
                  <br />
                  <strong>Faculty:</strong>{" "}
                  {facultyKnown
                    ? `${pctDecimal(k.faculty_men_pct ?? null)} M · ${pctDecimal(k.faculty_women_pct ?? null)} W`
                    : "Not published"}
                </div>
              </div>
            );
          })}
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
