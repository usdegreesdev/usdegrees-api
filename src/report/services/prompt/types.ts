/** Data shapes of the C1-Lite report: the payload we build and the narrative the model returns. */
import type { AthleticsProfile } from "../../../types/athletics";
import type { SatPositioning } from "../satPositioning";
import type { DataVintage } from "../../utils/dataVintage";
import type { StickerScenario } from "../../utils/stickerPrice";
import type { FigureCompleteness, SchoolFigures } from "../../utils/missingValue";
import type { GradRate } from "../../utils/gradRate";

// ---------------- PAYLOAD (built by reportPayload.service) ----------------
export interface C1LitePayload {
  report_meta: {
    report_reference_id: string;
    created_at: string;
    generated_date: string;
    methodology_version: string;
    /**
     * Newest College Scorecard fetch date (YYYY-MM-DD) across the report's
     * schools — completion.grad_rate_fetched_on, earnings.scorecard_api_fetched_on,
     * school_federal_aid_status.fetched_on, scorecard_admissions_flags.fetched_on.
     * null when none is recorded. Drives the cover's "data checked" month.
     */
    data_checked_on?: string | null;
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
    earnings_method_flag: string | null;
    // Year 5 of the same cohort row as program_earnings (year 10).
    earnings_year_5?: number | null;
    // Newest cohort's year 1 — its own labelled line, never mixed into the row above.
    earnings_latest_year_1?: number | null; earnings_latest_year_1_cohort?: number | null;
    // True only when a printed earnings value is a modelled estimate.
    earnings_estimated?: boolean;
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
    above_p75_schools: string[]; below_p25_schools: string[];
  };
  // College-level detail (NOT program-specific) — exactly one entry per
  // unique unitid, even when that college appears multiple times in
  // `schools` under different compared programs. Powers the Campus &
  // Students, Tuition & Costs, and Athletics pages.
  // Plain-text definition of the debt-to-income figures (same text as the
  // methodology page block; see debtRatioDefinitions).
  debt_income_ratio_definition: string;
  // Scorecard data years per metric + the release the DB holds (scorecard_data_vintage / scorecard_release).
  data_vintage?: DataVintage;
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
      // Faculty gender split (students.faculty_men / faculty_women), 0–100.
      faculty_men_pct?: number | null;
      faculty_women_pct?: number | null;
      no_graduate_programs: boolean; // grad_12_month null AND max programs.credential_level <= 4
      size: number | null; // students.size — the number the size label is based on
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
  executive_summary: string;
  analyst_note: string;
  net_price_note: string;
  fit_sentences: Array<{ school: string; sentence: string }>;
  earnings_paragraph: string;
  debt_burden_paragraph: string; // school-wide median federal debt of completers + debt-to-income only; NO loan forecast
  plain_english_question: string; // neutral decision framing — NOT a recommendation
}
