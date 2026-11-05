import React from "react";
import { theme } from "./theme";

/**
 * Editorial two-column "questions to ask" table plus closing disclosure block,
 * used on the Decision page. Flat, rule-based styling (no cards/shadows) built
 * only from existing theme tokens; `warning` is the muted brown accent.
 */

export interface QuestionRow {
  question: string;
  why: string;
}

export const DECISION_QUESTIONS: QuestionRow[] = [
  {
    question:
      "Does the OBBBA Legacy Provision apply to our student in any way?",
    why: "For an incoming freshman with no prior loans it shouldn't — but let the school confirm it in writing. If anyone in the family has prior federal loans connected to this student, the answer can change.",
  },
  {
    question:
      "Given the new $20,000-per-year and $65,000-lifetime Parent PLUS caps, what does the school expect families in our income bracket to do about the difference?",
    why: "This makes the school acknowledge its funding gap, and state its plan — bridge grants, payment plans, or “private loans.” Even that last answer tells you something important.",
  },
  {
    question:
      "Do you offer institutional bridge grants or emergency funds for later-year funding gaps?",
    why: "Some schools quietly reserve aid for continuing students. Ask before Year 1, not in the middle of Year 3.",
  },
  {
    question:
      "If our finances change, what is your aid-reconsideration (professional judgment) process, and what is its deadline?",
    why: "Every school has one; few advertise it. A job loss or medical event can legitimately change your aid mid-degree — if you ask in time.",
  },
  {
    question:
      "Is the student being considered for merit aid — and exactly what GPA or credit load keeps it for all four years?",
    why: "Merit aid that disappears after Year 1 is a discount on the brochure, not on the degree. Get the renewal conditions in writing.",
  },
  {
    question:
      "What share of your students borrow private loans, and does the school certify them?",
    why: "This reveals how normal the funding gap is at this school. And remember: any “preferred lender” list is a suggestion, not a requirement — you may use any lender, or none.",
  },
];

const MONO = "'Courier New', Courier, monospace";
const brown = theme.color.warning;

const label: React.CSSProperties = {
  fontFamily: MONO,
  fontSize: "8.5px",
  fontWeight: 700,
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  color: brown,
};

export function QuestionsTable({
  rows = DECISION_QUESTIONS,
}: {
  rows?: QuestionRow[];
}) {
  return (
    <div style={{ marginTop: "16px" }}>
      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          tableLayout: "fixed",
        }}
      >
        <colgroup>
          <col style={{ width: "45%" }} />
          <col style={{ width: "55%" }} />
        </colgroup>
        <thead>
          <tr style={{ borderTop: `2px solid ${theme.color.navy}` }}>
            <th
              style={{
                ...label,
                textAlign: "left",
                padding: "8px 14px 8px 0",
                borderBottom: `1px solid ${theme.color.navy}`,
              }}
            >
              The Question
            </th>
            <th
              style={{
                ...label,
                textAlign: "left",
                padding: "8px 0 8px 14px",
                borderBottom: `1px solid ${theme.color.navy}`,
              }}
            >
              Why It Matters
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr
              key={i}
              style={{
                pageBreakInside: "avoid",
                breakInside: "avoid",
                borderBottom: `1px solid ${theme.color.hairline}`,
              }}
            >
              <td
                style={{
                  verticalAlign: "top",
                  padding: "9px 14px 9px 0",
                  fontFamily: theme.font.family,
                  fontSize: "10.5px",
                  fontWeight: 700,
                  lineHeight: 1.45,
                  color: theme.color.navy,
                  wordBreak: "break-word",
                }}
              >
                <span style={{ ...label, marginRight: "6px" }}>{i + 1}.</span>
                “{r.question}”
              </td>
              <td
                style={{
                  verticalAlign: "top",
                  padding: "9px 0 9px 14px",
                  fontSize: "10.5px",
                  lineHeight: 1.5,
                  color: theme.color.ink,
                  wordBreak: "break-word",
                }}
              >
                {r.why}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div
        style={{
          marginTop: "16px",
          borderLeft: `3px solid ${brown}`,
          padding: "2px 0 2px 14px",
          pageBreakInside: "avoid",
          breakInside: "avoid",
        }}
      >
        <div style={{ ...label, marginBottom: "6px" }}>
          What we will not do — and why that protects you
        </div>
        <p
          style={{
            fontFamily: theme.font.family,
            fontSize: "10.5px",
            lineHeight: 1.55,
            fontStyle: "italic",
            color: theme.color.ink,
            margin: 0,
          }}
        >
          USDegrees.com does not negotiate with aid offices, file forms, or act
          on your behalf; we are research and analysis only. That is deliberate:
          because no school, lender, or consultant pays us anything, every
          question above is designed for your benefit alone. This page arms your
          own conversation — no one else in it works for you.
        </p>
      </div>
    </div>
  );
}
