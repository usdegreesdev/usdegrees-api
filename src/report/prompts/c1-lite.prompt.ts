/**
 * USDegrees.com — C1-LITE Report-Writer Prompt (v1.0-lite)
 * ---------------------------------------------------------
 * Adapted from the client's "C1 Report Generation MASTER PROMPT v1.0".
 * Scope reduced to data actually present in the DB:
 *   usdusers, usdreports, net_price_public_income, net_price_private_income,
 *   admission_disclosure_categories, program earnings (PSEO), fit/admit/SAT bands, accreditor.
 *
 * NOT in scope (no data): sticker price, four-year cost, funding gaps, PLUS/loan forecast,
 * debt burden, Clery safety, cost trajectory, peer percentiles, grad/retention rates.
 * → 12 pages instead of 15. This is a COST-AND-OUTCOMES edition, not a DEBT report.
 *
 * The model returns ONLY the generated-narrative JSON (see OUTPUT_CONTRACT).
 * Static template text and injected numbers live in the .tsx components.
 *
 * Wire-up in ai.service.ts:
 *   const res = await anthropic.messages.create({
 *     model: "claude-sonnet-5",           // per your cost analysis: Sonnet for premium tier
 *     max_tokens: 4000,
 *     system: SYSTEM_PROMPT,
 *     messages: [{ role: "user", content: buildUserMessage(payload) }],
 *   });
 *   const narrative = parseNarrative(res);  // JSON.parse after stripping any ``` fences
 */

// ----------------------------------------------------------------------------
// PAYLOAD SCHEMA (what the ENGINE builds and passes in — the AI never fetches)
// ----------------------------------------------------------------------------
export interface C1LitePayload {
  report_meta: {
    report_reference_id: string;
    created_at: string;          // from usdreports
    generated_date: string;      // e.g. "July 13, 2026"
    methodology_version: string; // e.g. "lite-v1"
  };
  student: {
    display_name: string;
    gpa: number | null;
    sat_score: number | null;
    sat_math: number | null;
    sat_reading_writing: number | null;
    act_score: number | null;
    graduation_year: number | null;
    high_school_name: string | null;
    preferred_degree_level: string | null;
    preferred_college_type: string | null;
    income_bracket_field: string | null; // which net-price column to read, e.g. "income_75001_110000"
    income_bracket_label: string | null; // e.g. "$75,001 – $110,000"  (null → whole row shown)
  };
  schools: Array<{
    name: string;
    unitid: string;
    sector: string;              // "Public, 4-year" | "Private, 4-year" — picks net-price table
    city: string;
    state: string;
    accreditor: string | null;
    net_price_bracket: number | null;   // pre-selected column value for student's bracket
    net_price_vintage: string | null;   // e.g. "2023–24 Scorecard"
    admit_rate: number | null;
    admit_rate_vintage: string | null;
    sat_25: number | null;
    sat_75: number | null;
    sat_vintage: string | null;
    fit_score: number | null;
    fit_label: string | null;
    sat_data_category: string;   // joins admission_disclosure_categories.category
    disclosure: {                // PRE-JOINED by engine from admission_disclosure_categories
      badge_label: string;
      supporting_copy: string;   // verbatim — the AI never rewrites this
      disclaimer_tier: number;
      disclaimer_text: string | null;
      show_admission_rate_required: boolean;
    };
    program_earnings: number | null;    // PSEO, student's preferred program
    earnings_vintage: string | null;
    earnings_method_flag: string | null; // your imputation flag, used as provenance
    roi_ratio: string | null;            // engine-computed ("1.33") or null
  }>;
  derived_flags: {                       // ENGINE-computed. AI reads, never computes.
    merit_flag_schools: string[];        // student SAT > school sat_75
    reach_flag_schools: string[];        // student SAT < school sat_25
    best_roi_school: string;             // "" if roi not stored
  };
}

// ----------------------------------------------------------------------------
// SYSTEM PROMPT
// ----------------------------------------------------------------------------
export const SYSTEM_PROMPT = `
You are the report writer for USDegrees.com, a strictly neutral college decision
platform. You write in plain English for families, at roughly a 9th-grade reading
level. You never rank schools, never recommend a school, never praise or criticize
an institution. You price schools and describe outcomes; families decide.

This is the C1-LITE edition: a COST-AND-OUTCOMES report, not a debt report. You have
net price, admission, and earnings data. You have NO gap, loan, debt, safety, grad-rate,
or trajectory data. Never mention, imply, or invent any of those.

RULE ZERO: You never invent a number. Every figure comes from the DATA PAYLOAD.

ABSOLUTE RULES — violating any is a failed generation:
R1. Every number in your output must appear character-for-character in the payload.
    You never compute, estimate, extrapolate, round, subtract, or infer a numeric value.
    Comparative statements ("~$2,600 more than X") are FORBIDDEN unless the difference
    itself is a payload field. Do not subtract two numbers yourself.
R2. If a field is null/missing, describe it as not published — never substitute a
    typical, average, or remembered value.
R3. Never use training-data knowledge about any school. Its price, size, reputation,
    or selectivity as you remember it is IRRELEVANT and FORBIDDEN. Only the payload exists.
R4. You write ONLY the generated-narrative slots defined in OUTPUT FORMAT. All static
    template text and all number placement happens elsewhere; do not reproduce it.
R5. Every figure you cite in narrative must name its vintage tag from the payload
    (e.g., "2023–24 Scorecard").
R6. Neutral voice: no superlatives, no advice verbs ("you should choose"), no ranking
    ("best school", "top pick"). Describe paths and trade-offs; never select one.
R7. Banned vocabulary anywhere: premier, cutting-edge, state-of-the-art, in the heart of,
    foster/fostering, world-class, unparalleled, prestigious, elite, renowned, dedicated to.
R8. Output ONLY the JSON object in OUTPUT FORMAT. No preamble, no markdown, no code fences.

TRACEABILITY TEST — apply to every sentence you write: could a fact-checker trace each
claim to a specific payload field? If not, do not write the sentence.

BRANCHING RULES (the engine sets flags; you apply the writing):
B-FIT (SAT disclosure). For each school, honor sat_data_category via its disclosure block:
  - If show_admission_rate_required is false OR admit_rate is null → do not state an admit rate.
  - Copy disclosure.supporting_copy verbatim into the school's fit sentence context; never
    rewrite it. Append disclaimer_text (if present) unchanged.
  - If the category is open-admission or test-not-used, the fit line states tests are not
    used/filed and fit is "Not applicable" — do NOT report a fit score even if one exists.
B-MERIT. If a school is in merit_flag_schools → note the student's SAT exceeds the school's
  75th percentile. Use "may qualify" language only; never promise merit aid.
B-REACH. If a school is in reach_flag_schools → use supportive framing: admission would rest
  on non-test strengths, first year may be more demanding, early support helps. Never discourage.
B-NOSAT. If student.sat_score is null → omit all fit scores; state once that no student SAT
  was provided so fit estimates are omitted. Show bands only where present.
B-INCOME. If income_bracket_label is null → the net-price note describes the figure as the
  posted net price without a personalized bracket. If present → name the bracket label.
B-ACCRED. Accreditor is a factual legitimacy signal only. State it plainly; never grade it.

GENERATED-NARRATIVE RULES:
1. two_minute_lines — exactly one per school, in payload order. Format: strongest
   cost-or-outcomes fact + one counterweight fact + a page reference. Both facts must be
   payload values. Never two positives or two negatives. ≤ 40 words each.
2. critical_finding — name: any merit-flag school (SAT over 75th pct); any reach-flag
   school; and any school whose fit is "Not applicable" due to
   its disclosure category. Nothing else. ≤ 110 words.
3. net_price_note — one paragraph stating, if present, the
   student's bracket label. Describe, don't advise. ≤ 90 words.
4. fit_sentences — one per school: bands (if present), disclosure copy, and merit/reach
   framing per the branches above. ≤ 45 words each.
5. earnings_paragraph — describe program_earnings per school with vintage + method flag,
   If best_roi_school is non-empty, state its roi_ratio factually.
   No school ranked as "best." ≤ 90 words.
6. plain_english_question — one framing paragraph: with cost and outcomes on the table,
   the question is which cost-and-value structure the family can carry. ≤ 90 words.
7. executive_summary & analyst_note — 2–4 neutral sentences each, summarizing only facts
   already present in the payload. No new numbers beyond payload fields. Each entry in
   schools is a compared program, not a distinct institution — when stating the count,
   say "compares N programs", never "N institutions".

OUTPUT FORMAT — return EXACTLY this JSON shape and nothing else:
{
  "two_minute_lines": [ { "school": "<name>", "line": "<text>" } ],
  "critical_finding": "<text>",
  "executive_summary": "<text>",
  "analyst_note": "<text>",
  "net_price_note": "<text>",
  "fit_sentences": [ { "school": "<name>", "sentence": "<text>" } ],
  "earnings_paragraph": "<text>",
  "plain_english_question": "<text>"
}
`.trim();

// ----------------------------------------------------------------------------
// USER MESSAGE BUILDER
// ----------------------------------------------------------------------------
export function buildUserMessage(payload: C1LitePayload): string {
  return [
    "DATA PAYLOAD (the only source of truth — every number you cite must appear here):",
    "```json",
    JSON.stringify(payload, null, 2),
    "```",
    "Generate the narrative JSON now. Output the JSON object only.",
  ].join("\n");
}

// ----------------------------------------------------------------------------
// RESPONSE PARSER (strips accidental fences, then JSON.parse)
// ----------------------------------------------------------------------------
export interface C1LiteNarrative {
  two_minute_lines: Array<{ school: string; line: string }>;
  critical_finding: string;
  executive_summary: string;
  analyst_note: string;
  net_price_note: string;
  fit_sentences: Array<{ school: string; sentence: string }>;
  earnings_paragraph: string;
  plain_english_question: string;
}

export function parseNarrative(apiResponse: {
  content: Array<{ type: string; text?: string }>;
}): C1LiteNarrative {
  const text = apiResponse.content
    .map((b) => (b.type === "text" ? b.text ?? "" : ""))
    .join("\n")
    .replace(/```json|```/g, "")
    .trim();
  return JSON.parse(text) as C1LiteNarrative;
}

// ----------------------------------------------------------------------------
// POST-GENERATION GATES (run before any report ships — the C1-Lite acceptance gates)
// ----------------------------------------------------------------------------
const BANNED = [
  "premier","cutting-edge","state-of-the-art","in the heart of","foster","fostering",
  "world-class","unparalleled","prestigious","elite","renowned","dedicated to",
];

/** G1/G2: every number in the narrative must exist character-for-character in the payload. */
export function gateNumbersTraceable(n: C1LiteNarrative, payload: C1LitePayload): string[] {
  const haystack = JSON.stringify(payload);
  const blob = JSON.stringify(n);
  const nums = blob.match(/\d[\d,]*(?:\.\d+)?/g) ?? [];
  return [...new Set(nums)].filter((num) => !haystack.includes(num));
}

/** G3: banned-vocabulary scan. Returns any hits. */
export function gateBannedVocab(n: C1LiteNarrative): string[] {
  const blob = JSON.stringify(n).toLowerCase();
  return BANNED.filter((w) => blob.includes(w));
}

/** G7: flag-vs-language — merit/reach language appears iff the flag is non-empty. */
export function gateBranchConsistency(n: C1LiteNarrative, payload: C1LitePayload): string[] {
  const errs: string[] = [];
  const blob = JSON.stringify(n).toLowerCase();
  const hasMeritLang = blob.includes("75th") || blob.includes("may qualify");
  if (payload.derived_flags.merit_flag_schools.length === 0 && hasMeritLang)
    errs.push("Merit language present but merit_flag_schools is empty.");
  return errs;
}

/** Run all gates; empty array = ship-ready. */
export function runGates(n: C1LiteNarrative, payload: C1LitePayload): string[] {
  return [
    ...gateNumbersTraceable(n, payload).map((x) => `Orphan number: ${x}`),
    ...gateBannedVocab(n).map((x) => `Banned word: ${x}`),
    ...gateBranchConsistency(n, payload),
  ];
}
