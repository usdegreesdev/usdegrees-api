/**
 * reportPrompt.ts — C1-LITE neutral report writer (GEMINI)
 * ------------------------------------------------------------------
 * Runs on gemini-2.5-flash, mirroring your existing ai.service.ts:
 * fetch → responseMimeType "application/json" → responseSchema.
 *
 * NEUTRALITY: unlike the current generateReportAiContent(), this NEVER
 * recommends, ranks, or selects a school (master prompt R6 / gate G8).
 * There is no "recommendation" field. Families decide.
 *
 * NUMBERS: the model may only place numbers that appear in the payload
 * (R1). It never computes, subtracts, estimates, or rounds.
 */

import type { AthleticsProfile } from "../../types/athletics";
import type { SatPositioning } from "./satPositioning";
import { gateSatNarrative, runSatGates } from "./satPositioningGates";
import {
  FIT_NA_SUBMITTED_REASON,
  isSubmittedOnlyCategory,
} from "../config/satPositioning.config";
import { formatDebtIncomeRatio, DEBT_RATIO_BASIS } from "../utils/debtRatio";
import { scenarioDisplay, type StickerScenario } from "../utils/stickerPrice";
import {
  schoolFigures,
  type FigureCompleteness,
  type SchoolFigures,
} from "../utils/missingValue";
import {
  GRAD_RATE_LABEL,
  GRAD_RATE_MEASURES,
  graduationRateSummary,
  type GradRate,
} from "../utils/gradRate";

// ---------------- PAYLOAD (built by reportPayload.service) ----------------
export interface C1LitePayload {
  report_meta: {
    report_reference_id: string;
    created_at: string;
    generated_date: string;
    methodology_version: string;
  };
  student: {
    display_name: string;
    email: string | null;
    address: string | null;
    gpa: number | null;
    sat_score: number | null;
    sat_math: number | null;
    sat_reading_writing: number | null;
    act_score: number | null;
    graduation_year: number | null;
    high_school_name: string | null;
    preferred_degree_level: string | null;
    preferred_college_type: string | null;
    income_bracket_field: string | null;
    income_bracket_label: string | null;
  };
  schools: Array<{
    name: string; unitid: string; sector: string;
    program_name: string | null;
    // School name plus, when a specific program was compared, that program —
    // e.g. "Ivy Tech — Computer Science". This is the identity used for
    // per-school narrative labels (two_minute_lines, fit_sentences) and
    // derived_flags, so the same college compared under two programs gets
    // two distinguishable entries instead of colliding on a shared name.
    display_name: string;
    city: string; state: string; accreditor: string | null;
    net_price_bracket: number | null; net_price_vintage: string | null;
    admit_rate: number | null; admit_rate_vintage: string | null;
    sat_25: number | null; sat_75: number | null; sat_vintage: string | null;
    fit_score: number | null; fit_label: string | null;
    sat_data_category: string;
    disclosure: {
      badge_label: string; supporting_copy: string;
      disclaimer_tier: number; disclaimer_text: string | null;
      show_admission_rate_required: boolean;
    };
    program_earnings: number | null;
    // A real number (the grad_cohort year) when resolved from a specific
    // program's earnings; the literal string "school-level average" when
    // aggregated across the school's programs (see reportPayload.service.ts
    // fetchProgramEarnings); null when nothing is publishable.
    earnings_vintage: number | string | null;
    // First-year (1 year after graduation) earnings and its cohort year, for
    // the page-4 context line. Null when not published.
    earnings_year_1?: number | null; earnings_year_1_vintage?: number | null;
    earnings_method_flag: string | null; roi_ratio: string | null;
    sticker_price: number | null; sticker_vintage: string | null;
    avg_debt: number | null; debt_income_ratio: number | null;
    debt_income_ratio_display: string | null; debt_vintage: string | null;
    // Basis of the ratio: the school-level earnings it was divided by and the
    // label for that point in time (from DEBT_RATIO_BASIS).
    debt_income_earnings: number | null; debt_income_basis_label: string;
    debt_income_earnings_fetched_on: string | null;
    // 'no_federal_aid' | 'participates' | 'unknown' (no row). Unknown is
    // treated like 'participates' (generic "not published" reason).
    federal_aid_status?: string;
    // Value-or-reason per metric (see utils/missingValue.ts). Use as given.
    figures?: SchoolFigures;
  }>;
  // How many schools have a published figure for each metric.
  figure_completeness?: FigureCompleteness;
  // Latest school_federal_aid_status.fetched_on among the report's schools.
  federal_aid_fetched_on?: string | null;
  derived_flags: {
    merit_flag_schools: string[]; reach_flag_schools: string[];
    best_roi_school: string;
  };
  // College-level detail (NOT program-specific) — exactly one entry per
  // unique unitid, even when that college appears multiple times in
  // `schools` under different compared programs. Powers the Campus &
  // Students, Tuition & Costs, and Athletics pages.
  // Plain-text definition of the debt-to-income figures (same text as the
  // methodology page block; see debtRatioDefinitions).
  debt_income_ratio_definition: string;
  // What the graduation rate measures (same text as the methodology page).
  graduation_rate_definition?: string;
  // One sentence with every college's graduation rate display string, shared
  // verbatim by the AI prompt and the fallback narrative.
  graduation_rate_summary?: string;
  college_details: Array<{
    unitid: string;
    name: string;
    city: string;
    state: string;
    address: string | null;
    zip: string | null;
    campus: {
      enrollment_undergrad: number | null;
      enrollment_grad: number | null;
      student_faculty_ratio: number | null;
      // completion.grad_rate_150nt_pct + grad_rate_cohort, resolved by
      // utils/gradRate.ts (value-or-reason). Never completion_rate.
      graduation_rate: GradRate;
      retention_rate: number | null;
      demographics_men_pct: number | null;
      demographics_women_pct: number | null;
      size_category: string | null;
    };
    tuition: {
      // Sticker price scenarios, summed in code from the four components
      // (utils/stickerPrice.ts). Not published + missing[] if any is null.
      sticker_in_state_on_campus: StickerScenario;
      sticker_out_state_off_campus: StickerScenario;
      // College Scorecard's own average cost of attendance
      // (costs.sticker_price_by_api) and its year (costs.sticker_price_year).
      scorecard_avg_coa: number | null;
      scorecard_avg_coa_year: string | null;
      // Net price at the student's household-income bracket, from
      // net_price_public_income / net_price_private_income by school type.
      net_price: number | null;
      tuition_in_state: number | null;
      tuition_out_state: number | null;
      room_board_on_campus: number | null;
      room_board_off_campus: number | null;
      books_supply: number | null;
      other_expense_on_campus: number | null;
      other_expense_off_campus: number | null;
      other_expense_with_family: number | null;
    };
    athletics: AthleticsProfile | null;
  }>;
  // SAT score positioning (computed in TypeScript — see satPositioning.ts).
  // The model must not generate or rewrite any number in this block.
  sat_positioning: SatPositioning;
}

// ---------------- NARRATIVE (what Gemini returns) ----------------
export interface C1LiteNarrative {
  two_minute_lines: Array<{ school: string; line: string }>;
  critical_finding: string;
  executive_summary: string;
  analyst_note: string;
  net_price_note: string;
  fit_sentences: Array<{ school: string; sentence: string }>;
  earnings_paragraph: string;
  debt_burden_paragraph: string; // typical debt + debt-to-income only; NO loan forecast
  plain_english_question: string; // neutral decision framing — NOT a recommendation
}

// ---------------- PROMPT TEXT ----------------
export function buildPromptText(payload: C1LitePayload): string {
  return `
You are the report writer for USDegrees.com, a strictly neutral college decision
platform. Plain English, ~9th-grade reading level. You NEVER rank, recommend, praise,
or criticize a school. You price schools and describe outcomes; families decide.

This is the C1-LITE edition. You have sticker price, net price, admission, earnings,
typical debt at completion (avg_debt), a school-level debt-to-income ratio
(debt_income_ratio) and a school-level graduation rate (see GRADUATION RATE) supplied as
data. You have NO funding gap, NO loan forecast, NO monthly payment / PLUS projection, NO
campus-safety, completion-rate, employment-rate or trajectory data — never mention or invent
any of those. avg_debt is a reported typical figure, NOT a projection you compute.

HARD RULES (a violation fails the report):
R1. Every number you write must appear character-for-character in the DATA PAYLOAD, except
    that dollar amounts are written in USD format with thousands separators — payload 54000
    is written "$54,000". Adding commas is the ONLY change you may make to a payload number.
    Never compute, subtract, estimate, round, or infer a number. Comparative phrases
    ("$2,600 more than X") are forbidden unless that difference is itself a payload field.
R2. If a field is null, describe it as not published — never substitute a typical value.
R3. Never use outside knowledge about any school. Only the payload exists.
R4. Neutral voice. No superlatives, no advice verbs ("you should choose"), no ranking
    ("best", "top pick", "we recommend"). Describe trade-offs; never select one.
R5. Cite each figure with its vintage tag from the payload — except program_earnings in
    earnings_paragraph, which carries its method flag but no vintage year.
R6. Banned words: premier, cutting-edge, state-of-the-art, in the heart of, foster,
    fostering, world-class, unparalleled, prestigious, elite, renowned, dedicated to.

TRACEABILITY: could a fact-checker trace every claim to a specific payload field? If not,
do not write it.

BRANCHES:
- For each school, honor its disclosure block. If show_admission_rate_required is false OR
  admit_rate is null, do not state an admit rate. Copy disclosure.supporting_copy verbatim;
  never rewrite it. Append disclaimer_text unchanged if present.
- If fit_label is "Not applicable", write "Academic Fit: Not applicable." followed by the
  disclosure.supporting_copy verbatim, explaining why a test-score-based fit classification
  cannot be calculated. Do not report a fit score.
- If fit_label is "Not applicable" and sat_data_category is "H_TEST_CONSIDERED" or
  "C_TEST_OPTIONAL", the reason is exactly: "Fit is not applicable: test scores are optional or
  considered if submitted." Use it in place of any wording that implies open admission, then the
  disclosure.supporting_copy verbatim. Never describe these schools as a fit, strong fit or stretch.
- If fit_label starts with "Not shown", the student gave no SAT score: do not name any fit
  category (no "Target/Match" or "Reach"); say fit is not shown because no SAT score was provided.
- There is no "Safety" tier — fit_label is only "Target/Match", "Reach", "Not applicable", or "Not shown – no SAT score provided".
  When fit_label is "Target/Match" or "Reach", state the published SAT range (sat_25–sat_75),
  where the student's sat_score falls relative to it, and the resulting fit_label. Always add:
  "This classification is an Admission Fit Estimate and does not represent admission
  probability or likelihood of acceptance. Check the school's website for current admission
  requirements." Never phrase a category as a chance or likelihood of getting in.
- merit_flag_schools: note the student's SAT exceeds the school's 75th percentile;
  use "may qualify" only, never promise aid.
- reach_flag_schools: supportive framing — admission would rest on non-test strengths,
  first year may be more demanding, early support helps. Never discourage.
- If student.sat_score is null, omit fit scores and say once that no SAT was provided.
- net_price_bracket is the student's net price for their household income bracket
  (student.income_bracket_label). It is the ONLY figure you may call "net price".
- net_price_bracket null → say net price is not published for that school. Never substitute
  sticker_price for it and never call sticker_price "net price".

MISSING FIGURES: each school has figures.net_price, figures.program_earnings and
figures.typical_debt, each with a "display" string that is either the value or the reason it is
missing. Use those display strings as given. Never compute or describe a range, lowest/highest
or spread of net price, program earnings or typical debt across schools. Never describe a
missing figure as $0. Never say why a value is missing except with the reason strings
supplied in figures. figure_completeness gives how many schools have each figure; use it as
given.

COST OF ATTENDANCE FIGURES: each entry in college_details has tuition.sticker_in_state_on_campus
(one student paying in-state tuition and living on campus), tuition.sticker_out_state_off_campus
(out-of-state tuition, living off campus) and tuition.scorecard_avg_coa (College Scorecard's average
cost of attendance, year in scorecard_avg_coa_year). A scenario with published=false has no total
and lists its missing components. Describe these only as given. Never call a scenario total
"Scorecard's price" or "the Scorecard figure", never combine or compare the three figures or state
a difference between them, and never describe a missing figure as $0.

GRADUATION RATE: the only graduation figure is college_details[].campus.graduation_rate. It is
the ${GRAD_RATE_LABEL.toLowerCase()} for ${GRAD_RATE_MEASURES}; graduation_rate_definition
explains it. You do not need to mention it. If you mention graduation rate anywhere, copy
graduation_rate_summary verbatim, character for character, and write no other graduation
figure, cohort size or reason. Never call it a completion rate, never describe a rate that is
not published as 0% or as blank, never rank or compare schools by it, and never say whether a
rate is good, bad, high or low.

IDENTITY: the same college may appear more than once in "schools" when the family compared
it under different programs. Always use each school entry's exact "display_name" string
(not "name") as the "school" value in two_minute_lines and fit_sentences — display_name is
what disambiguates two entries for the same college.

WRITE ONLY THESE (lengths are ceilings):
- two_minute_lines: exactly one per school, in payload order. Strongest cost-or-outcomes
  fact + one counterweight fact + a page reference. Both facts payload values. Never two
  positives or two negatives. Label the program_earnings figure as "Program Earnings from
  LEHD data" (not "program earnings" and not a bare vintage year). Use net_price_bracket,
  called "Net price", as the cost figure (never sticker_price); if it is null, say net price is
  not published. ≤40 words each.
- critical_finding: name any merit-flag school, any reach-flag school, and any school whose
  fit is "Not applicable". Nothing else. ≤110 words.
- net_price_note: state the bracket label if present. ≤90 words.
- fit_sentences: one per school — bands if present, disclosure copy, merit/reach framing, and
  the Admission Fit Estimate disclaimer (see BRANCHES). ≤70 words each.
- earnings_paragraph: program_earnings per school with its method label (e.g. Census-reported)
  (or its figures.program_earnings.display when missing). Do NOT state the earnings vintage year here — the figure and its
  method flag only. No "best". ≤90 words.
- debt_burden_paragraph: state each school's avg_debt (typical debt at completion) and its
  debt_income_ratio (use figures.typical_debt.display for the debt). debt_income_ratio is supplied as data and is already
  calculated: the school's typical debt (avg_debt) divided by the school's
  median earnings ${DEBT_RATIO_BASIS.label} (debt_income_basis_label; College Scorecard,
  students who received federal aid; the earnings figure is debt_income_earnings). It
  describes the whole school, not the specific program. Write debt_income_ratio_display exactly, in the form
  "<debt_income_ratio_display> : 1" (display "0.35" is written "0.35 : 1"), and describe it only
  with that basis. Use the payload ratio as given: never recompute it, never derive it from
  program_earnings, never state another formula, and never quote any other label or format for
  it. When explaining the ratio, use debt_income_ratio_definition. Never describe the ratio as
  program-level, never compare it with the program-level Median Earnings (Yr 10) figure, and never call a
  ratio good, bad, high, low, healthy or risky. When debt_income_ratio_display is null, write that the ratio cannot be calculated due to
  missing values. Never describe a monthly payment or loan schedule. ≤90 words.
- plain_english_question: neutral framing — with cost and outcomes on the table, the
  question is which cost-and-value structure the family can carry. No recommendation. ≤90 words.
- executive_summary and analyst_note: 2–4 neutral sentences each, only facts from the payload.
  Each entry in schools is a compared program, not a distinct institution — when stating the
  count, say "compares N programs", never "N institutions".

DATA PAYLOAD (the only source of truth):
${JSON.stringify(payload, null, 2)}

Return ONLY raw JSON matching the required schema. No markdown, no backticks, no preamble.
`.trim();
}

// ---------------- GEMINI RESPONSE SCHEMA ----------------
const schoolLine = {
  type: "OBJECT",
  properties: { school: { type: "STRING" }, line: { type: "STRING" } },
  required: ["school", "line"],
};
const schoolSentence = {
  type: "OBJECT",
  properties: { school: { type: "STRING" }, sentence: { type: "STRING" } },
  required: ["school", "sentence"],
};

export const GEMINI_RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    two_minute_lines: { type: "ARRAY", items: schoolLine },
    critical_finding: { type: "STRING" },
    executive_summary: { type: "STRING" },
    analyst_note: { type: "STRING" },
    net_price_note: { type: "STRING" },
    fit_sentences: { type: "ARRAY", items: schoolSentence },
    earnings_paragraph: { type: "STRING" },
    debt_burden_paragraph: { type: "STRING" },
    plain_english_question: { type: "STRING" },
  },
  required: [
    "two_minute_lines", "critical_finding", "executive_summary", "analyst_note",
    "net_price_note", "fit_sentences", "earnings_paragraph", "debt_burden_paragraph",
    "plain_english_question",
  ],
};

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
    : "not published";
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
        : "not published";
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
  const { schools, derived_flags, student } = payload;

  const two_minute_lines = schools.map((s) => ({
    school: s.display_name,
    line: `${costClause(s)}; Program Earnings from PSEO data ${money(s.program_earnings)}.`,
  }));

  const findingParts: string[] = [];
  if (derived_flags.merit_flag_schools.length) {
    findingParts.push(`Student's SAT exceeds the 75th percentile at ${derived_flags.merit_flag_schools.join(", ")} — may qualify for merit consideration.`);
  }
  if (derived_flags.reach_flag_schools.length) {
    findingParts.push(`Student's SAT is below the 25th percentile at ${derived_flags.reach_flag_schools.join(", ")}.`);
  }
  const naSchools = schools.filter((s) => s.fit_label === "Not applicable");
  const naSubmitted = naSchools.filter((s) => isSubmittedOnlyCategory(s.sat_data_category)).map((s) => s.display_name);
  const notApplicable = naSchools.filter((s) => !isSubmittedOnlyCategory(s.sat_data_category)).map((s) => s.display_name);
  if (notApplicable.length) {
    findingParts.push(`Fit is not applicable at ${notApplicable.join(", ")}.`);
  }
  if (naSubmitted.length) {
    findingParts.push(`${FIT_NA_SUBMITTED_REASON} (${naSubmitted.join(", ")}).`);
  }
  const critical_finding = findingParts.length
    ? findingParts.join(" ")
    : "No merit, reach, or fit-unavailable flags apply to the selected schools; see the cost and earnings tables for figures.";

  const executive_summary = `This report compares ${schools.length} program${schools.length === 1 ? "" : "s"} for ${student.display_name} on published net price, admissions, program earnings, and typical debt — it does not rank or recommend a school. ${
    student.sat_score == null ? "No SAT score was provided, so academic fit is not shown." : "Academic fit is shown where the disclosure category allows it."
  }`;

  const gradSummary = gradRateSummaryFor(payload);
  const analyst_note_base = `This report evaluates ${schools.length} program${schools.length === 1 ? "" : "s"} for ${student.display_name} using federally sourced figures. Most figures come directly from public federal datasets. Where Census PSEO program earnings data is unavailable, clearly labelled estimates may be generated using real reported earnings and program-level trends, rather than the raw dataset alone. Estimates are never chained from other estimates and are not presented as official Census-published figures. Where a figure is not published and no valid real-data anchor exists, it is shown as "Not Published" rather than substituted with an estimate or typical value. This report does not rank schools or recommend one over another — the following pages lay out cost, admissions, earnings, and debt so your family can weigh the trade-offs directly. Confirm all figures with each institution before making a decision.`;
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
          ? `${FIT_NA_SUBMITTED_REASON}. ${s.disclosure.supporting_copy}`
          : `Academic Fit: Not applicable. ${s.disclosure.supporting_copy}`,
      };
    }
    if (s.sat_25 == null || s.sat_75 == null || studentSat == null) {
      return {
        school: s.display_name,
        sentence: `${s.display_name}: SAT band ${s.sat_25 != null && s.sat_75 != null ? `${s.sat_25}–${s.sat_75}` : "not published"}. ${s.disclosure.supporting_copy}`,
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

  // debt_income_ratio is the payload value (typical debt ÷ school median
  // earnings at DEBT_RATIO_BASIS) — the same value the Section 04 table shows.
  // Never recomputed here.
  const debt_burden_paragraph = schools
    .map((s) => `${s.display_name}: typical debt ${schoolFigures(s).typical_debt.display}, debt-to-income ratio ${formatDebtIncomeRatio(s.debt_income_ratio)}${s.debt_income_ratio != null ? ` (typical debt ÷ school median earnings ${s.debt_income_basis_label ?? DEBT_RATIO_BASIS.label})` : ""}.`)
    .join(" ") + " The ratio describes the whole school, not the program shown, and is not comparable to the program-level Median Earnings (Yr 10).";

  const plain_english_question = `With net price, admissions fit, program earnings, and School level typical debt on the table for ${schools.map((s) => s.display_name).join(", ")}, the question for your family is which cost-and-value structure you can carry — not which school ranks highest.`;

  return {
    two_minute_lines,
    critical_finding,
    executive_summary,
    analyst_note,
    net_price_note,
    fit_sentences,
    earnings_paragraph,
    debt_burden_paragraph,
    plain_english_question,
  };
}

// ---------------- GENERATOR (Gemini) ----------------
export async function generateC1LiteNarrative(payload: C1LitePayload): Promise<C1LiteNarrative> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.warn("⚠️ GEMINI_API_KEY environment variable is not defined. Falling back to structured, payload-only C1-Lite narrative.");
    return buildFallbackNarrative(payload);
  }

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: buildPromptText(payload) }] }],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: GEMINI_RESPONSE_SCHEMA,
          temperature: 0.4,
        },
      }),
    });
    if (!res.ok) throw new Error(`Gemini error ${res.status}: ${await res.text()}`);
    const json = await res.json();
    const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error("Empty Gemini response");
    return JSON.parse(text) as C1LiteNarrative;
  } catch (error) {
    console.error("Error generating C1-Lite narrative via Gemini API:", error);
    return buildFallbackNarrative(payload);
  }
}

// ---------------- ACCEPTANCE GATES ----------------
const BANNED = [
  "premier", "cutting-edge", "state-of-the-art", "in the heart of", "foster", "fostering",
  "world-class", "unparalleled", "prestigious", "elite", "renowned", "dedicated to",
];
const ADVICE = ["we recommend", "you should", "best choice", "top pick", "best school", "optimal choice"];

// Thousands separators are a presentation choice, not a new number, so both
// sides are compared with commas stripped: "$54,000" traces to a payload 54000.
export function gateNumbersTraceable(n: C1LiteNarrative, payload: C1LitePayload): string[] {
  const hay = JSON.stringify(payload);
  const nums = JSON.stringify(n).match(/\d[\d,]*(?:\.\d+)?/g) ?? [];
  return [...new Set(nums)].filter(
    (num) => !hay.includes(num) && !hay.includes(num.replace(/,/g, "")),
  );
}
export function gateBannedVocab(n: C1LiteNarrative): string[] {
  const blob = JSON.stringify(n).toLowerCase();
  return BANNED.filter((w) => blob.includes(w));
}
export function gateNeutrality(n: C1LiteNarrative): string[] {
  const blob = JSON.stringify(n).toLowerCase();
  return ADVICE.filter((w) => blob.includes(w)).map((w) => `Recommendation/advice phrase: "${w}"`);
}
export function gateBranchConsistency(n: C1LiteNarrative, payload: C1LitePayload): string[] {
  const errs: string[] = [];
  const blob = JSON.stringify(n).toLowerCase();
  const meritLang = blob.includes("75th") || blob.includes("may qualify");
  if (payload.derived_flags.merit_flag_schools.length === 0 && meritLang)
    errs.push("Merit language present but merit_flag_schools is empty.");
  return errs;
}
function narrativeText(n: C1LiteNarrative): string {
  const out: string[] = [];
  const walk = (v: unknown) => {
    if (typeof v === "string") out.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(n);
  return out.join("\n");
}

// Graduation rate may be omitted, but any mention must be the shared sentence
// verbatim, and the deprecated "completion rate" framing never appears.
export function gateGraduationRate(n: C1LiteNarrative, payload: C1LitePayload): string[] {
  const errs: string[] = [];
  const text = narrativeText(n);
  if (/completion rate/i.test(text)) errs.push('Graduation rate described as a "completion rate".');
  if (/graduation rate|graduat\w* within 150%/i.test(text)) {
    const summary = gradRateSummaryFor(payload);
    if (!summary || !text.includes(summary)) {
      errs.push("Graduation rate mentioned without copying graduation_rate_summary verbatim.");
    }
  }
  return errs;
}

export function runGates(n: C1LiteNarrative, payload: C1LitePayload): string[] {
  return [
    ...gateGraduationRate(n, payload),
    ...gateNumbersTraceable(n, payload).map((x) => `Orphan number: ${x}`),
    ...gateBannedVocab(n).map((x) => `Banned word: ${x}`),
    ...gateNeutrality(n),
    ...gateBranchConsistency(n, payload),
    ...gateSatNarrative(n, payload),
    ...runSatGates(payload),
  ];
}