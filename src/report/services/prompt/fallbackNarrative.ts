/**
 * Deterministic narrative built straight from the payload. Used when there is
 * no GEMINI_API_KEY or the model call fails. Every sentence is assembled from
 * payload fields only, so it satisfies the same rules and gates as the model.
 */
import {
  FIT_NA_SUBMITTED_REASON,
  FIT_UNAVAILABLE_SENTENCE,
  isSubmittedOnlyCategory,
} from "../../config/satPositioning.config";
import {
  formatDebtIncomeRatio,
  DEBT_RATIO_BASIS,
  DEBT_LABEL,
  DEBT_VS_EARNINGS_NOTE,
} from "../../utils/debtRatio";
import { scenarioDisplay } from "../../utils/stickerPrice";
import { schoolFigures } from "../../utils/missingValue";
import { graduationRateSummary } from "../../utils/gradRate";
import type { C1LitePayload, C1LiteNarrative } from "./types";

// ---------------- FALLBACK (no GEMINI_API_KEY) ----------------
// Mirrors the old generateReportAiContent()'s getFallbackMockContent(): when
// no API key is configured, build the narrative deterministically straight
// from the payload instead of failing the request. Every sentence is
// assembled from payload fields only, so it trivially satisfies R1–R6 and
// the acceptance gates (no invented numbers, no ranking/recommendation).
// USD with thousands separators. gateNumbersTraceable strips commas before
// tracing, so "$54,000" still matches the payload's bare 54000.
function money(v: number | null): string {
  return v != null
    ? `$${v.toLocaleString("en-US", { maximumFractionDigits: 0 })}`
    : "Not published";
}

// The two-minute read's cost clause: the student's income-bracket net price
// (net_price_public_income / net_price_private_income), or "not published".
// Sticker price is never substituted for it.
function costClause(s: C1LitePayload["schools"][number]): string {
  if (s.net_price_bracket != null) {
    return `Net price ${money(s.net_price_bracket)}${s.net_price_vintage ? ` (${s.net_price_vintage})` : ""}`;
  }
  return `Net price ${schoolFigures(s).net_price.display}`;
}

// Cost-of-attendance sentence for the fallback: each figure exactly as given,
// labelled separately; no combining, comparing or differences.
export function costOfAttendanceNote(payload: C1LitePayload): string {
  const parts = (payload.college_details ?? []).map((c) => {
    const t = c.tuition;
    const sc =
      t.scorecard_avg_coa != null
        ? `$${t.scorecard_avg_coa.toLocaleString("en-US")}${t.scorecard_avg_coa_year ? ` (${t.scorecard_avg_coa_year})` : ""}`
        : "Not published";
    return `${c.name}: sticker price for in-state tuition living on campus ${scenarioDisplay(t.sticker_in_state_on_campus)}; sticker price for out-of-state tuition living off campus ${scenarioDisplay(t.sticker_out_state_off_campus)}; College Scorecard average cost of attendance ${sc}.`;
  });
  return parts.length ? ` ${parts.join(" ")}` : "";
}

// The graduation-rate sentence: the payload's own string when present (the
// one the AI is told to copy), else rebuilt from college_details the same way.
export function gradRateSummaryFor(payload: C1LitePayload): string {
  if (payload.graduation_rate_summary != null) return payload.graduation_rate_summary;
  const withRate = (payload.college_details ?? []).filter(
    (c) => c?.campus?.graduation_rate && typeof c.campus.graduation_rate === "object",
  );
  return graduationRateSummary(withRate);
}

export function buildFallbackNarrative(payload: C1LitePayload): C1LiteNarrative {
  const { schools, student } = payload;

  const two_minute_lines = schools.map((s) => ({
    school: s.display_name,
    line: `${costClause(s)}; Program Earnings from PSEO data ${money(s.program_earnings)}.`,
  }));

  const executive_summary = `This report compares ${schools.length} program${schools.length === 1 ? "" : "s"} for ${student.display_name} on published net price, admissions, program earnings, and school-wide median federal debt of completers — it does not rank or recommend a school. ${
    student.sat_score == null ? "No SAT score was provided, so academic fit is not shown." : "Academic fit is shown where the disclosure category allows it."
  }`;

  const gradSummary = gradRateSummaryFor(payload);
  const estimatesUsed = schools.some((s) => s.earnings_estimated === true);
  const estimateSentences = estimatesUsed
    ? ` Where Census PSEO program earnings data is unavailable, a clearly labelled estimate derived only from real reported earnings is shown; estimates are never chained from other estimates and are not official Census-published figures.`
    : "";
  const analyst_note_base = `This report evaluates ${schools.length} program${schools.length === 1 ? "" : "s"} for ${student.display_name} using federally sourced figures. Most figures come directly from public federal datasets.${estimateSentences} Where a figure is not published it is shown as "Not published" rather than substituted with an estimate or typical value. This report does not rank schools or recommend one over another — the following pages lay out cost, admissions, earnings, and debt so your family can weigh the trade-offs directly. Confirm all figures with each institution before making a decision.`;
  // AnalystNote splits on blank lines, so the graduation sentence is its own paragraph.
  const analyst_note = gradSummary ? `${analyst_note_base}\n\n${gradSummary}` : analyst_note_base;

  const net_price_note =
    (student.income_bracket_label
      ? `Net price below reflects the ${student.income_bracket_label} income bracket.`
      : "No household income range was provided, so net price is not published.") +
    costOfAttendanceNote(payload);

  const studentSat = student.sat_score;
  const fit_sentences = schools.map((s) => {
    if (s.fit_label === "Not applicable") {
      return {
        school: s.display_name,
        sentence: isSubmittedOnlyCategory(s.sat_data_category)
          ? `${s.disclosure.badge_label}: ${FIT_NA_SUBMITTED_REASON}. ${s.disclosure.supporting_copy}`
          : `Academic Fit: Not applicable. ${s.disclosure.supporting_copy}`,
      };
    }
    if (s.fit_label === "Unavailable") {
      return {
        school: s.display_name,
        sentence: `${s.display_name}: ${FIT_UNAVAILABLE_SENTENCE}`,
      };
    }
    if (s.sat_25 == null || s.sat_75 == null || studentSat == null) {
      return {
        school: s.display_name,
        sentence: `${s.display_name}: SAT band ${s.sat_25 != null && s.sat_75 != null ? `${s.sat_25}–${s.sat_75}` : "Not published"}. ${s.disclosure.supporting_copy}`,
      };
    }
    const relation =
      studentSat < s.sat_25 ? "falls below" : studentSat > s.sat_75 ? "falls above" : "falls within";
    return {
      school: s.display_name,
      sentence: `${s.display_name}: Published SAT range: ${s.sat_25}–${s.sat_75}. The student's SAT score of ${studentSat} ${relation} this range, indicating a ${s.fit_label} academic fit. This classification is an Admission Fit Estimate and does not represent admission probability or likelihood of acceptance. Check the school's website for current admission requirements.`,
    };
  });

  const earnings_paragraph = schools
    // Earnings vintage year is deliberately omitted here; only the method flag
    // (e.g. Census-reported) is surfaced next to the figure.
    .map((s) => {
      const f = schoolFigures(s).program_earnings;
      return `${s.display_name}: ${f.display}${f.value != null && s.earnings_method_flag ? ` (${s.earnings_method_flag})` : ""}.`;
    })
    .join(" ");

  // debt_income_ratio is the payload value (median debt of completers ÷ school median
  // earnings at DEBT_RATIO_BASIS) — the same value the Section 04 table shows.
  // Never recomputed here.
  const debt_burden_paragraph = schools
    .map((s) => `${s.display_name}: school-wide ${DEBT_LABEL} ${schoolFigures(s).typical_debt.display}, debt-to-income ratio ${formatDebtIncomeRatio(s.debt_income_ratio)}${s.debt_income_ratio != null ? ` (school-wide ${DEBT_LABEL} ÷ school median earnings ${s.debt_income_basis_label ?? DEBT_RATIO_BASIS.label})` : ""}.`)
    .join(" ") + ` ${DEBT_VS_EARNINGS_NOTE} The ratio describes the whole school, not the program shown, and is not comparable to the program-level Median Earnings (Yr 10).`;

  const plain_english_question = `With net price, admissions fit, program earnings, and school-wide median federal debt of completers on the table for ${schools.map((s) => s.display_name).join(", ")}, the question for your family is which cost-and-value structure you can carry — not which school ranks highest.`;

  return {
    two_minute_lines,
    executive_summary,
    analyst_note,
    net_price_note,
    fit_sentences,
    earnings_paragraph,
    debt_burden_paragraph,
    plain_english_question,
  };
}
