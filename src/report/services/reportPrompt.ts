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
    earnings_method_flag: string | null; roi_ratio: string | null;
    sticker_price: number | null; sticker_vintage: string | null;
    avg_debt: number | null; debt_income_ratio: number | null;
    debt_ratio_text: string | null; debt_vintage: string | null;
  }>;
  derived_flags: {
    merit_flag_schools: string[]; reach_flag_schools: string[];
    best_roi_school: string;
    cost_range_low: string; cost_range_high: string;
    earnings_range_low: string; earnings_range_high: string;
    debt_range_low: string; debt_range_high: string;
  };
  // College-level detail (NOT program-specific) — exactly one entry per
  // unique unitid, even when that college appears multiple times in
  // `schools` under different compared programs. Powers the Campus &
  // Students, Tuition & Costs, and Athletics pages.
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
      graduation_rate: number | null;
      retention_rate: number | null;
      demographics_men_pct: number | null;
      demographics_women_pct: number | null;
      size_category: string | null;
    };
    tuition: {
      // Estimated average price after student aid (costs.sticker_price_by_api).
      sticker_price: number | null;
      // Net price before estimated financial aid calculations (costs.for_roi_data).
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
typical debt at completion (avg_debt) and a debt-to-income ratio (debt_income_ratio) already
calculated for you as avg_debt divided by program_earnings. You have NO
funding gap, NO loan forecast, NO monthly payment / PLUS projection, NO campus-safety,
graduation-rate, or trajectory data — never mention or invent any of those. avg_debt is a
reported typical figure, NOT a projection you compute.

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
- income_bracket_label null → describe net price as the posted figure, not personalized.
- net_price_bracket null but sticker_price present → cite sticker_price instead, labeled as the
  sticker price (never call it "net price"). Only say cost is "not published" when BOTH are null.

IDENTITY: the same college may appear more than once in "schools" when the family compared
it under different programs. Always use each school entry's exact "display_name" string
(not "name") as the "school" value in two_minute_lines and fit_sentences — display_name is
what disambiguates two entries for the same college.

WRITE ONLY THESE (lengths are ceilings):
- two_minute_lines: exactly one per school, in payload order. Strongest cost-or-outcomes
  fact + one counterweight fact + a page reference. Both facts payload values. Never two
  positives or two negatives. Label the program_earnings figure as "Program Earnings from
  LEHD data" (not "program earnings" and not a bare vintage year). Call the cost figure
  "Net price" — never "Sticker price", whichever payload field it came from. ≤40 words each.
- critical_finding: name any merit-flag school, any reach-flag school, the highest
  program_earnings school with the earnings range, the cost range, and any school whose
  fit is "Not applicable". Nothing else. ≤110 words.
- net_price_note: state cost_range_low/high and the bracket label if present. ≤90 words.
- fit_sentences: one per school — bands if present, disclosure copy, merit/reach framing, and
  the Admission Fit Estimate disclaimer (see BRANCHES). ≤70 words each.
- earnings_paragraph: program_earnings per school with its method label (e.g. Census-reported)
  and the earnings range. Do NOT state the earnings vintage year here — the figure and its
  method flag only. No "best". ≤90 words.
- debt_burden_paragraph: state each school's avg_debt (typical debt at completion) and its
  debt_income_ratio, plus the debt range. debt_income_ratio is already calculated for you as
  avg_debt divided by program_earnings — write the payload value exactly, in ratio form
  against an income of 1 (payload 0.52 is written "0.52 : 1"), and describe it as
  "typical debt divided by program earnings". Never recompute it yourself, and never quote
  debt_ratio_text or any federal label. When debt_income_ratio is null, write that the ratio
  cannot be calculated due to missing values. Never describe a monthly payment or loan
  schedule. ≤90 words.
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

// The two-minute read's cost clause: personalized net price when an income
// bracket was posted, else the sticker price actually on file (costs.
// sticker_price_by_api) — "not published" only when BOTH are null. Net price
// requires an income bracket (routes/report.ts doesn't collect one yet — see
// reportPayload.service.ts), so without this fallback every report cited
// "Net price not published" even when a real sticker price existed.
function costClause(s: C1LitePayload["schools"][number]): string {
  if (s.net_price_bracket != null) {
    return `Net price ${money(s.net_price_bracket)}${s.net_price_vintage ? ` (${s.net_price_vintage})` : ""}`;
  }
  if (s.sticker_price != null) {
    // Labelled "Net price" per the report's cost vocabulary — the underlying
    // field name (sticker_price) is the API's, not the reader's.
    return `Net price ${money(s.sticker_price)}${s.sticker_vintage ? ` (${s.sticker_vintage})` : ""}`;
  }
  return "Net price not published";
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
  const notApplicable = schools.filter((s) => s.fit_label === "Not applicable").map((s) => s.display_name);
  if (notApplicable.length) {
    findingParts.push(`Fit is not applicable at ${notApplicable.join(", ")}.`);
  }
  if (derived_flags.earnings_range_low && derived_flags.earnings_range_high) {
    findingParts.push(`Program earnings across the selected schools range from ${money(Number(derived_flags.earnings_range_low))} to ${money(Number(derived_flags.earnings_range_high))}.`);
  }
  if (derived_flags.cost_range_low && derived_flags.cost_range_high) {
    findingParts.push(`Net Price ranges from ${money(Number(derived_flags.cost_range_low))} to ${money(Number(derived_flags.cost_range_high))}.`);
  }
  const critical_finding = findingParts.length
    ? findingParts.join(" ")
    : "No merit, reach, or fit-unavailable flags apply to the selected schools; see the cost and earnings tables for figures.";

  const executive_summary = `This report compares ${schools.length} program${schools.length === 1 ? "" : "s"} for ${student.display_name} on published net price, admissions, program earnings, and typical debt — it does not rank or recommend a school. ${
    student.sat_score == null ? "No SAT score was provided, so academic fit is not shown." : "Academic fit is shown where the disclosure category allows it."
  }`;

  const analyst_note = `This report evaluates ${schools.length} program${schools.length === 1 ? "" : "s"} for ${student.display_name} using federally sourced figures. Most figures come directly from public federal datasets. Where Census PSEO program earnings data is unavailable, clearly labelled estimates may be generated using real reported earnings and program-level trends, rather than the raw dataset alone. Estimates are never chained from other estimates and are not presented as official Census-published figures. Where a figure is not published and no valid real-data anchor exists, it is shown as "Not Published" rather than substituted with an estimate or typical value. This report does not rank schools or recommend one over another — the following pages lay out cost, admissions, earnings, and debt so your family can weigh the trade-offs directly. Confirm all figures with each institution before making a decision.`;

  const net_price_note = student.income_bracket_label
    ? `Net price below reflects the ${student.income_bracket_label} income bracket. ${derived_flags.cost_range_low && derived_flags.cost_range_high ? `Across the selected schools it ranges from ${money(Number(derived_flags.cost_range_low))} to ${money(Number(derived_flags.cost_range_high))}.` : "Figures are not published for one or more schools."}`
    : `No income bracket was provided, so net price below is the posted figure, not personalized. ${derived_flags.cost_range_low && derived_flags.cost_range_high ? `Across the selected schools it ranges from ${money(Number(derived_flags.cost_range_low))} to ${money(Number(derived_flags.cost_range_high))}.` : ""}`;

  const studentSat = student.sat_score;
  const fit_sentences = schools.map((s) => {
    if (s.fit_label === "Not applicable") {
      return {
        school: s.display_name,
        sentence: `Academic Fit: Not applicable. ${s.disclosure.supporting_copy}`,
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
    .map((s) => `${s.display_name}: ${money(s.program_earnings)}${s.earnings_method_flag ? ` (${s.earnings_method_flag})` : ""}.`)
    .join(" ") + (derived_flags.earnings_range_low && derived_flags.earnings_range_high
      ? ` Range across selected schools: ${money(Number(derived_flags.earnings_range_low))} to ${money(Number(derived_flags.earnings_range_high))}.`
      : "");

  // debt_income_ratio is derived in reportPayload.service as typical debt
  // divided by program earnings — the same value the Section 03 table shows —
  // so the paragraph describes the calculation instead of quoting the
  // reported federal label.
  const debt_burden_paragraph = schools
    .map((s) => `${s.display_name}: typical debt ${money(s.avg_debt)}, debt-to-income ratio ${s.debt_income_ratio != null ? `${s.debt_income_ratio} : 1 (typical debt divided by program earnings)` : "cannot be calculated due to missing values"}.`)
    .join(" ") + (derived_flags.debt_range_low && derived_flags.debt_range_high
      ? ` Range across selected schools: ${money(Number(derived_flags.debt_range_low))} to ${money(Number(derived_flags.debt_range_high))}.`
      : "");

  const plain_english_question = `With net price, admissions fit, program earnings, and typical debt on the table for ${schools.map((s) => s.display_name).join(", ")}, the question for your family is which cost-and-value structure you can carry — not which school ranks highest.`;

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
export function runGates(n: C1LiteNarrative, payload: C1LitePayload): string[] {
  return [
    ...gateNumbersTraceable(n, payload).map((x) => `Orphan number: ${x}`),
    ...gateBannedVocab(n).map((x) => `Banned word: ${x}`),
    ...gateNeutrality(n),
    ...gateBranchConsistency(n, payload),
  ];
}