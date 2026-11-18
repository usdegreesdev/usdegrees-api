/**
 * reportPayload.service.ts  — FULLY WIRED to real schema
 * ------------------------------------------------------------------
 * DB access: `pg` Pool (../../db/client), same as every other route/service
 * in this codebase. There is no Supabase client anywhere in this project.
 *
 * Tables: usdusers, usdreports, schools, admissions,
 *         admission_disclosure_categories, net_price_public_income,
 *         net_price_private_income, earnings_against_courses_merged, costs,
 *         debt_income_ratio, roi, programs
 * Utils:  calculateAdmissionFit (utils/admissionScore), analyzeRoi (utils/roi)
 *
 * Known limitations (intentional, not bugs):
 *  - Vintages: no vintage columns exist, so they are constants below.
 *    Promote to real columns later; the AI only cites what we pass.
 *  - Program earnings: usdusers has no program/CIP. Pass programCip per
 *    school for true program-level earnings; otherwise the builder
 *    aggregates year_10 across the school's programs and labels it so.
 */

import pool from "../../db/client";
import type { C1LitePayload } from "./reportPrompt";
import { calculateAdmissionFit } from "../utils/admissionScore";
import { ScaledField, toFraction, toPercent } from "../../utils/fieldScale";
import { analyzeRoi } from "../utils/roi";
import {
  resolveDebt,
  ratioNumeral,
  debtRatioQuery,
  debtRatioDefinitionText,
  debtRatioRefreshed,
  DEBT_RATIO_BASIS,
} from "../utils/debtRatio";
import CREDENTIAL_LEVELS from "../../constants/credentials";
import { getEarningsForProgram } from "../../services/earnings.service";
import { getAthleticsProfile } from "../../services/athletics.service";
import { loadSatPositioning } from "./satPositioning.service";
import { inStateOnCampus, outOfStateOffCampus } from "../utils/stickerPrice";
import { isSubmittedOnlyCategory } from "../config/satPositioning.config";
import {
  figureCompleteness,
  normalizeAidStatus,
  schoolFigures,
  type FederalAidStatus,
} from "../utils/missingValue";
import {
  GRAD_RATE_COLUMNS,
  GRAD_RATE_METHODOLOGY,
  resolveGradRate,
  graduationRateSummary,
} from "../utils/gradRate";

// ---- vintage constants (no DB columns yet) -----------------------
const NET_PRICE_VINTAGE = "College Scorecard, October 2026 update";
const ADMISSIONS_VINTAGE = "IPEDS";

// ---- income bracket -> net-price column --------------------------
export type IncomeBracket =
  | "0_30000"
  | "30001_48000"
  | "48001_75000"
  | "75001_110000"
  | "110001_plus";

const BRACKET_TO_COLUMN: Record<IncomeBracket, string> = {
  "0_30000": "income_0_30000",
  "30001_48000": "income_30001_48000",
  "48001_75000": "income_48001_75000",
  "75001_110000": "income_75001_110000",
  "110001_plus": "income_110001_plus",
};
const BRACKET_TO_LABEL: Record<IncomeBracket, string> = {
  "0_30000": "$0 – $30,000",
  "30001_48000": "$30,001 – $48,000",
  "48001_75000": "$48,001 – $75,000",
  "75001_110000": "$75,001 – $110,000",
  "110001_plus": "$110,001+",
};

// Disclosure categories that make an academic fit score meaningless. Test-
// optional / scores-considered-if-submitted schools (isSubmittedOnlyCategory)
// are also "Not applicable": their SAT range covers only submitters.
const NO_FIT_CATEGORIES = new Set([
  "A_OPEN_ADMISSION",
  "B_NOT_USED",
  "F_INSTITUTION_CLOSED",
]);

// ------------------------------------------------------------------
// Net price + sector (sector derived from which net-price table the
// unitid appears in; public is checked first).
// ------------------------------------------------------------------
async function fetchNetPriceAndSector(
  unitid: number,
  bracket: IncomeBracket | null,
): Promise<{ sector: string; value: number | null }> {
  const col = bracket ? BRACKET_TO_COLUMN[bracket] : null;

  const pub = await pool.query(
    `SELECT ${col ? `"${col}"` : "unitid"} FROM net_price_public_income WHERE unitid = $1 LIMIT 1`,
    [unitid],
  );
  if (pub.rows.length > 0) {
    return {
      sector: "Public, 4-year",
      value: col ? (pub.rows[0][col] ?? null) : null,
    };
  }

  const pri = await pool.query(
    `SELECT ${col ? `"${col}"` : "unitid"} FROM net_price_private_income WHERE unitid = $1 LIMIT 1`,
    [unitid],
  );
  if (pri.rows.length > 0) {
    return {
      sector: "Private, 4-year",
      value: col ? (pri.rows[0][col] ?? null) : null,
    };
  }
  return { sector: "Unknown", value: null };
}

// ------------------------------------------------------------------
// Disclosure (verbatim copy the AI must not rewrite)
// ------------------------------------------------------------------
async function fetchDisclosure(category: string) {
  const { rows } = await pool.query(
    `SELECT badge_label, supporting_copy, disclaimer_tier, disclaimer_text, show_admission_rate_required
       FROM admission_disclosure_categories WHERE category = $1 LIMIT 1`,
    [category],
  );
  if (!rows.length) throw new Error(`no disclosure row for "${category}"`);
  return rows[0];
}

// ------------------------------------------------------------------
// Admissions (SAT bands, admit rate, disclosure category)
// ------------------------------------------------------------------
async function fetchAdmissions(unitid: number) {
  const { rows } = await pool.query(
    `SELECT admission_rate, sat_avg_overall, sat_p25_math, sat_p75_math, sat_p25_reading,
            sat_p75_reading, school_min_range, school_max_range, sat_disclosure_category,
            publish_publicly
       FROM admissions WHERE unitid = $1 LIMIT 1`,
    [unitid],
  );
  return rows[0] ?? null;
}

// ------------------------------------------------------------------
// Resolve a program's programs.credential_level from its CIP code. Shared by
// fetchProgramEarnings and fetchRoi so a program is only ever resolved once
// per school per report (previously each fetched it independently).
// ------------------------------------------------------------------
async function resolveCredentialLevel(
  unitid: number,
  programCip: string,
): Promise<number | null> {
  const { rows } = await pool.query(
    `SELECT credential_level FROM programs WHERE unitid = $1 AND replace(cip_code, '.', '') = replace($2, '.', '') LIMIT 1`,
    [unitid, programCip],
  );
  return rows[0]?.credential_level ?? null;
}

// ------------------------------------------------------------------
// Program earnings (year_10) — program-level if cip+credential_level are
// both known, else aggregate.
//
// Delegates cohort selection to earnings.service.ts's getEarningsForProgram
// (the same recency-first resolver /compare and /search use) instead of a
// separate ORDER BY grad_cohort DESC query: that naive string-sort query
// ignored credential_level entirely and had no special handling for the
// '0000' sentinel grad_cohort ("unknown/aggregate placeholder", not a real
// class year — see earnings.service.ts) or for skipped_future/
// skipped_no_anchor rows, so it could surface either the placeholder cohort
// or an unrelated credential tier's figure as if it were a real citation.
// ------------------------------------------------------------------
// Parent-facing labels for the internal earnings method enum. Raw enum values
// (e.g. "user_reported") must never reach the report.
const EARNINGS_METHOD_LABELS: Record<string, string> = {
  user_reported: "Census-reported",
  interpolated: "Estimated (between two real values)",
  extrapolated: "Estimated (from one nearby real value)",
  low_confidence: "Estimated — low confidence",
  skipped_future: "Not published",
  skipped_no_anchor: "Not published",
};

async function fetchProgramEarnings(
  unitid: number,
  programCip?: string,
  credentialLevel?: number | null,
) {
  if (programCip && credentialLevel != null) {
    const resolved = await getEarningsForProgram(unitid, programCip, credentialLevel);
    const year10 = resolved.year_10;
    const year1 = resolved.year_1;
    // First-year earnings, shown on page 4 as context beside the Yr-10 figure.
    const year1Value = year1?.value != null ? Math.round(year1.value) : null;
    const year1Vintage =
      year1Value != null && year1 && year1.cohort !== "0000" ? Number(year1.cohort) : null;
    if (!year10 || year10.value == null) {
      return { earnings: null, vintage: null, method_flag: null, year1: year1Value, year1_vintage: year1Vintage };
    }
    return {
      year1: year1Value,
      year1_vintage: year1Vintage,
      earnings: Math.round(year10.value),
      // '0000' means this figure isn't tied to any real graduating cohort —
      // citing it as a year would be worse than citing no year at all.
      vintage: year10.cohort === "0000" ? null : Number(year10.cohort),
      method_flag: EARNINGS_METHOD_LABELS[year10.method] ?? null,
    };
  }
  // Aggregate across the school's programs (no specific program resolved).
  const { rows } = await pool.query(
    `SELECT year_10 FROM earnings_against_courses_merged WHERE unitid = $1 AND year_10 IS NOT NULL`,
    [unitid],
  );
  const vals = rows
    .map((r: { year_10: number | string }) => Number(r.year_10))
    .filter((v: number) => !Number.isNaN(v));
  if (!vals.length) return { earnings: null, vintage: null, method_flag: null, year1: null, year1_vintage: null };
  const avg = Math.round(
    vals.reduce((a: number, b: number) => a + b, 0) / vals.length,
  );
  return {
    year1: null,
    year1_vintage: null,
    earnings: avg,
    vintage: "school-level average",
    method_flag: `School-level average across ${vals.length} programs`,
  };
}

// Sticker price + ROI supplementary blob.
async function fetchCosts(unitid: number) {
  const { rows } = await pool.query(
    `SELECT sticker_price_by_api, for_roi_data FROM costs WHERE unitid = $1 LIMIT 1`,
    [unitid],
  );
  const data = rows[0];
  return {
    sticker:
      data?.sticker_price_by_api != null
        ? Math.round(Number(data.sticker_price_by_api))
        : null,
    forRoi: data?.for_roi_data ?? null, // JSON blob, not itself an ROI figure — see fetchRoi()
  };
}

// Precomputed 20-year ROI, keyed by unitid + credential_level (via `roi`
// table). credentialLevel is resolved by the caller (resolveCredentialLevel)
// from the same programCip fetchProgramEarnings uses; null falls back to the
// best available row for the school, same fallback used in routes/search.ts.
async function fetchRoi(unitid: number, credentialLevel: number | null) {
  const { rows } = await pool.query(
    `SELECT avg_salary, total_cost, roi_20yr FROM roi
      WHERE unitid = $1
      ORDER BY CASE WHEN credential_level = $2 THEN 0 ELSE 1 END
      LIMIT 1`,
    [unitid, credentialLevel],
  );
  const data = rows[0];
  return {
    avgSalary: data?.avg_salary != null ? Number(data.avg_salary) : null,
    totalCost: data?.total_cost != null ? Number(data.total_cost) : null,
    roi20Yr: data?.roi_20yr != null ? Number(data.roi_20yr) : null,
  };
}

// Typical debt at completion + debt-to-income (federal outcome metric).
async function fetchDebt(unitid: number) {
  // One query: avg_debt + the single configured earnings column
  // (DEBT_RATIO_BASIS) — see debtRatioQuery. The ratio is computed in
  // debtRatio.ts only.
  const { rows } = await pool.query(debtRatioQuery(), [unitid]);
  return resolveDebt(rows[0]);
}

// ------------------------------------------------------------------
// Federal aid status (school_federal_aid_status). No row, or a failed lookup,
// is UNKNOWN (null) and is treated like 'participates' downstream: the
// generic "not published" reason, never "takes no federal student aid".
// ------------------------------------------------------------------
async function fetchFederalAid(
  unitid: number,
): Promise<{ status: FederalAidStatus | null; fetched_on: string | null }> {
  try {
    const { rows } = await pool.query(
      `SELECT federal_aid_status, fetched_on FROM school_federal_aid_status WHERE unitid = $1 LIMIT 1`,
      [unitid],
    );
    const r = rows[0];
    if (!r) return { status: null, fetched_on: null };
    const f = r.fetched_on;
    return {
      status: normalizeAidStatus(r.federal_aid_status),
      fetched_on:
        f instanceof Date ? f.toISOString().slice(0, 10) : f != null ? String(f) : null,
    };
  } catch (err) {
    console.warn(`federal aid status lookup failed for ${unitid}; treating as unknown`, err);
    return { status: null, fetched_on: null };
  }
}

async function fetchStudent(userId: number) {
  const { rows } = await pool.query(
    `SELECT display_name, email, address, gpa, sat_score, sat_math, sat_reading_writing, act_score,
            graduation_year, high_school_name, preferred_degree_level, preferred_college_type,
            household_income_range
       FROM usdusers WHERE id = $1 LIMIT 1`,
    [userId],
  );
  if (!rows.length) throw new Error(`user fetch (${userId}): no row`);
  return rows[0];
}

async function fetchReportMeta(reportReferenceId: string) {
  const { rows } = await pool.query(
    `SELECT report_reference_id, created_at FROM usdreports WHERE report_reference_id = $1 LIMIT 1`,
    [reportReferenceId],
  );
  if (!rows.length)
    throw new Error(`report fetch (${reportReferenceId}): no row`);
  return rows[0];
}

async function fetchSchool(unitid: number) {
  const { rows } = await pool.query(
    `SELECT name, city, state, accreditor, address, zip, is_active FROM schools WHERE unitid = $1 LIMIT 1`,
    [unitid],
  );
  if (!rows.length) throw new Error(`school fetch (${unitid}): no row`);
  return rows[0];
}

// ------------------------------------------------------------------
// Campus & student body (students table) — school-level, not program-level.
// ------------------------------------------------------------------
export async function fetchCampus(unitid: number) {
  // Graduation rate: completion.grad_rate_150nt_pct + grad_rate_cohort only
  // (see utils/gradRate.ts). completion_rate / emp_factor / completed_*yrs
  // are deprecated and are deliberately not selected, so they can't leak
  // into the payload or the AI prompt.
  const [studentsResult, completionResult] = await Promise.all([
    pool.query(
      `SELECT undergrad_12_month, grad_12_month, student_faculty_ratio,
              retention_rate, demographics_men, demographics_women, size_category
         FROM students WHERE unitid = $1 LIMIT 1`,
      [unitid],
    ),
    pool.query(
      `SELECT ${GRAD_RATE_COLUMNS.join(", ")} FROM completion WHERE unitid = $1 LIMIT 1`,
      [unitid],
    ),
  ]);
  const data = studentsResult.rows[0];
  const completion = completionResult.rows[0];
  const num = (v: unknown) => (v != null ? Number(v) : null);
  // Scales come from utils/fieldScale (retention_rate/demographics_* are
  // 0–1 fractions; grad_rate_150nt_pct is already 0–100).
  const wholePct = (f: ScaledField, v: unknown) => {
    const p = toPercent(f, v);
    return p === null ? null : Math.round(p);
  };
  // Demographics keep one decimal place (e.g. 39.5%) instead of rounding to
  // a whole number, per the Student Body Composition section's display.
  const oneDecimalPct = (f: ScaledField, v: unknown) => {
    const p = toPercent(f, v);
    return p === null ? null : Math.round(p * 10) / 10;
  };
  return {
    enrollment_undergrad: num(data?.undergrad_12_month),
    enrollment_grad: num(data?.grad_12_month),
    student_faculty_ratio: num(data?.student_faculty_ratio),
    graduation_rate: resolveGradRate(completion),
    retention_rate: wholePct("students.retention_rate", data?.retention_rate),
    demographics_men_pct: oneDecimalPct("students.demographics_men", data?.demographics_men),
    demographics_women_pct: oneDecimalPct("students.demographics_women", data?.demographics_women),
    size_category: data?.size_category ?? null,
  };
}

// ------------------------------------------------------------------
// Full tuition & costs breakdown (costs table) — school-level, not
// program-level. sticker_price here is the same figure already threaded
// per-program into schools[].sticker_price; repeated here for the dedicated
// Tuition & Costs page so it doesn't depend on which program entry rendered.
// ------------------------------------------------------------------
async function fetchTuitionDetail(
  unitid: number,
  bracket: IncomeBracket | null,
) {
  // net_price comes from net_price_public_income / net_price_private_income
  // at the student's household-income bracket (null when no bracket is set
  // or the school has no row), never from the costs table.
  const [{ rows }, np] = await Promise.all([
    pool.query(
    `SELECT sticker_price_by_api, sticker_price_year, tuition_in_state, tuition_out_state,
            roomboard_oncampus, roomboard_offcampus, booksupply, otherexpense_oncampus,
            otherexpense_offcampus, otherexpense_withfamily
       FROM costs WHERE unitid = $1 LIMIT 1`,
    [unitid],
    ),
    fetchNetPriceAndSector(unitid, bracket),
  ]);
  const data = rows[0];
  const num = (v: unknown) => (v != null ? Math.round(Number(v)) : null);
  // Scenario totals are computed from the components (null is never 0).
  const raw = (v: unknown) => (v != null ? Number(v) : null);
  const comps = {
    tuition_in_state: raw(data?.tuition_in_state),
    tuition_out_state: raw(data?.tuition_out_state),
    roomboard_oncampus: raw(data?.roomboard_oncampus),
    roomboard_offcampus: raw(data?.roomboard_offcampus),
    booksupply: raw(data?.booksupply),
    otherexpense_oncampus: raw(data?.otherexpense_oncampus),
    otherexpense_offcampus: raw(data?.otherexpense_offcampus),
  };
  return {
    sticker_in_state_on_campus: inStateOnCampus(comps),
    sticker_out_state_off_campus: outOfStateOffCampus(comps),
    scorecard_avg_coa: num(data?.sticker_price_by_api),
    scorecard_avg_coa_year:
      data?.sticker_price_year != null ? String(data.sticker_price_year) : null,
    net_price: num(np.value),
    tuition_in_state: num(data?.tuition_in_state),
    tuition_out_state: num(data?.tuition_out_state),
    room_board_on_campus: num(data?.roomboard_oncampus),
    room_board_off_campus: num(data?.roomboard_offcampus),
    books_supply: num(data?.booksupply),
    other_expense_on_campus: num(data?.otherexpense_oncampus),
    other_expense_off_campus: num(data?.otherexpense_offcampus),
    other_expense_with_family: num(data?.otherexpense_withfamily),
  };
}

// ------------------------------------------------------------------
// Derived flags (pure computation)
// ------------------------------------------------------------------
export function computeDerivedFlags(
  studentSat: number | null,
  schools: C1LitePayload["schools"],
  roi20YrByName: Record<string, number>,
): C1LitePayload["derived_flags"] {
  const merit: string[] = [];
  const reach: string[] = [];
  for (const s of schools) {
    // Ranges for test-optional / considered-if-submitted schools cover only
    // students who submitted scores, so they never raise merit/reach flags.
    if (isSubmittedOnlyCategory(s.sat_data_category)) continue;
    if (studentSat != null && s.sat_75 != null && studentSat > s.sat_75)
      merit.push(s.display_name);
    if (studentSat != null && s.sat_25 != null && studentSat < s.sat_25)
      reach.push(s.display_name);
  }
  // Factual highest-value ROI figure — NOT a recommendation. Ties resolve to
  // payload order (first school with the max value).
  let bestRoiSchool = "";
  let bestRoi = -Infinity;
  for (const s of schools) {
    const v = roi20YrByName[s.display_name];
    if (v != null && v > bestRoi) {
      bestRoi = v;
      bestRoiSchool = s.display_name;
    }
  }

  return {
    merit_flag_schools: merit,
    reach_flag_schools: reach,
    best_roi_school: bestRoiSchool,
  };
}

// ------------------------------------------------------------------
// Orchestrator
// ------------------------------------------------------------------
/**
 * Newest Scorecard fetch date across the given schools, from every
 * *_fetched_on column — never a baked-in month. null when none is recorded.
 */
export async function fetchDataCheckedOn(unitids: number[]): Promise<string | null> {
  if (unitids.length === 0) return null;
  try {
    const { rows } = await pool.query(
      `SELECT GREATEST(
         (SELECT max(grad_rate_fetched_on)     FROM completion                 WHERE unitid = ANY($1)),
         (SELECT max(scorecard_api_fetched_on) FROM earnings                   WHERE unitid = ANY($1)),
         (SELECT max(fetched_on)               FROM school_federal_aid_status  WHERE unitid = ANY($1)),
         (SELECT max(fetched_on)               FROM scorecard_admissions_flags WHERE unitid = ANY($1))
       ) AS data_checked_on`,
      [unitids],
    );
    const v = rows[0]?.data_checked_on;
    if (v == null) return null;
    return v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);
  } catch {
    return null;
  }
}

export async function buildC1LitePayload(args: {
  userId: number;
  reportReferenceId: string;
  schools: Array<{ unitid: number; programCip?: string; programName?: string }>;
  incomeBracket: IncomeBracket | null;
  methodologyVersion?: string;
}): Promise<C1LitePayload> {
  const { userId, reportReferenceId } = args;

  const [student, meta, dataCheckedOn] = await Promise.all([
    fetchStudent(userId),
    fetchReportMeta(reportReferenceId),
    fetchDataCheckedOn(args.schools.map((s) => s.unitid)),
  ]);

  // An explicit bracket wins; otherwise use the income range the student
  // entered on their profile (usdusers.household_income_range).
  const incomeBracket: IncomeBracket | null =
    args.incomeBracket ??
    (student.household_income_range &&
    student.household_income_range in BRACKET_TO_COLUMN
      ? (student.household_income_range as IncomeBracket)
      : null);

  const studentTotalSat =
    student.sat_score ??
    (student.sat_math != null && student.sat_reading_writing != null
      ? student.sat_math + student.sat_reading_writing
      : null);

  const out: C1LitePayload["schools"] = [];
  const roi20YrByName: Record<string, number> = {};
  const aidFetchedOn: string[] = [];
  // Cache each unitid's core school row so the college_details pass below
  // (deduped one-per-college) doesn't re-query schools for unitids already
  // fetched here — the same college can appear multiple times in
  // args.schools, once per compared program.
  const schoolCache = new Map<number, Awaited<ReturnType<typeof fetchSchool>>>();

  for (const { unitid, programCip, programName } of args.schools) {
    const core = await fetchSchool(unitid);
    schoolCache.set(unitid, core);
    const credentialLevel = programCip
      ? await resolveCredentialLevel(unitid, programCip)
      : null;
    const credentialLevelName =
      credentialLevel != null
        ? CREDENTIAL_LEVELS.find((l) => l.id === credentialLevel)?.name ?? null
        : null;
    const displayName = programName
      ? `${core.name} — ${programName}${credentialLevelName ? ` (${credentialLevelName})` : ""}`
      : core.name;

    const [np, adm, earn, costs, debt, roi, aid] = await Promise.all([
      fetchNetPriceAndSector(unitid, incomeBracket),
      fetchAdmissions(unitid),
      fetchProgramEarnings(unitid, programCip, credentialLevel),
      fetchCosts(unitid),
      fetchDebt(unitid),
      fetchRoi(unitid, credentialLevel),
      fetchFederalAid(unitid),
    ]);
    if (aid.fetched_on) aidFetchedOn.push(aid.fetched_on);

    const category = adm?.sat_disclosure_category ?? "E_TEST_REQUIRED_NO_RANGE";
    const disc = await fetchDisclosure(category);

    // Total SAT bands: prefer school range, fall back to summed p25/p75.
    const sat25 =
      adm?.school_min_range ??
      (adm?.sat_p25_math != null && adm?.sat_p25_reading != null
        ? Number(adm.sat_p25_math) + Number(adm.sat_p25_reading)
        : null);
    const sat75 =
      adm?.school_max_range ??
      (adm?.sat_p75_math != null && adm?.sat_p75_reading != null
        ? Number(adm.sat_p75_math) + Number(adm.sat_p75_reading)
        : null);

    // admission_rate is a 0–1 fraction (utils/fieldScale) — never guessed.
    const rateFraction = toFraction("admissions.admission_rate", adm?.admission_rate);
    // disc.show_admission_rate_required gates the AI narrative's prose only
    // (the model reads it directly off `disclosure` — see reportPrompt.ts
    // BRANCHES). It must NOT null out the raw figure here too: that's a
    // narrative-category classification (mostly false, e.g.
    // E_TEST_REQUIRED_NO_RANGE), not a per-school "don't publish" signal —
    // gating on it here hid the admit rate in the data tables/matrix almost
    // universally, unlike /compare which shows the raw rate unconditionally.
    // publish_publicly is the genuine per-school suppression flag (also
    // honored by routes/overviewDetails.ts) and stays authoritative.
    const admitRatePct =
      adm?.publish_publicly !== false && rateFraction != null
        ? Math.round(rateFraction * 100)
        : null;

    // Fit — skip for open-admission / test-not-used / closed.
    let fitScore: number | null = null;
    let fitLabel: string | null = "Not applicable";
    if (!NO_FIT_CATEGORIES.has(category) && !isSubmittedOnlyCategory(category)) {
      const fit = calculateAdmissionFit(
        // The same total SAT that gates the fit below — the student's saved
        // total, or both sections summed. Never one section doubled.
        { satTotal: studentTotalSat },
        {
          admissionRate: rateFraction,
          satAvg:
            adm?.sat_avg_overall != null ? Number(adm.sat_avg_overall) : null,
          sat25Math:
            adm?.sat_p25_math != null ? Number(adm.sat_p25_math) : null,
          sat75Math:
            adm?.sat_p75_math != null ? Number(adm.sat_p75_math) : null,
          sat25Reading:
            adm?.sat_p25_reading != null ? Number(adm.sat_p25_reading) : null,
          sat75Reading:
            adm?.sat_p75_reading != null ? Number(adm.sat_p75_reading) : null,
        },
      );
      fitScore = fit.score;
      fitLabel = fit.category;
      // No student test score → any Target/Match / Reach label would be
      // fabricated from the school's admit rate alone. Show a neutral label.
      if (studentTotalSat == null) {
        fitScore = null;
        fitLabel = "Not shown – no SAT score provided";
      }
    }

    // ROI — roi_20yr is a real precomputed figure (roi table), NOT derived
    // from costs.for_roi_data (that column is an unrelated JSON blob). We
    // run it through the existing analyzeRoi() util rather than formatting
    // it ourselves, and never invent a figure when roi_20yr is null.
    const roiResult = analyzeRoi({
      unitid,
      totalCost: roi.totalCost,
      avgSalary: roi.avgSalary,
      roi20Yr: roi.roi20Yr,
    });

    if (roi.roi20Yr != null) roi20YrByName[displayName] = roi.roi20Yr;

    const rowForFigures = {
      net_price_bracket: np.value,
      program_earnings: earn.earnings,
      avg_debt: debt.avg_debt,
      federal_aid_status: aid.status,
    };

    out.push({
      name: core.name,
      program_name: programName ?? null,
      display_name: displayName,
      unitid: String(unitid),
      sector: np.sector,
      city: core.city,
      state: core.state,
      accreditor: core.accreditor,
      net_price_bracket: np.value,
      net_price_vintage: np.value != null ? NET_PRICE_VINTAGE : null,
      admit_rate: admitRatePct,
      admit_rate_vintage: admitRatePct != null ? ADMISSIONS_VINTAGE : null,
      sat_25: sat25,
      sat_75: sat75,
      sat_vintage: sat25 != null || sat75 != null ? ADMISSIONS_VINTAGE : null,
      fit_score: fitScore,
      fit_label: fitLabel,
      sat_data_category: category,
      disclosure: disc,
      program_earnings: earn.earnings,
      earnings_vintage: earn.vintage,
      earnings_method_flag: earn.method_flag,
      earnings_year_1: earn.year1,
      earnings_year_1_vintage: earn.year1_vintage,
      roi_ratio: roi.roi20Yr != null ? roiResult.roiFormatted : null,
      sticker_price: costs.sticker,
      sticker_vintage: costs.sticker != null ? NET_PRICE_VINTAGE : null,
      avg_debt: debt.avg_debt,
      // typical debt ÷ school-level earnings at DEBT_RATIO_BASIS, computed by
      // computeDebtIncomeRatio; null renders as "cannot be calculated due to
      // missing values".
      debt_income_ratio: debt.ratio,
      debt_income_earnings: debt.earnings,
      debt_income_basis_label: DEBT_RATIO_BASIS.label,
      debt_income_earnings_fetched_on: debt.fetched_on,
      // Two-decimal numeral ("0.30") so narrative text traces character-for-
      // character even when the number serialises without the trailing zero.
      debt_income_ratio_display: ratioNumeral(debt.ratio),
      debt_vintage: debt.avg_debt != null ? "College Scorecard" : null,
      federal_aid_status: aid.status ?? "unknown",
      // Per-school value-or-reason strings the narrative must use as given.
      figures: schoolFigures(rowForFigures),
    });
  }

  // College-level detail (campus/students, tuition & costs, athletics) is
  // NOT program-specific, so it's built once per unique unitid — a college
  // compared under three programs still gets exactly one entry here, never
  // three — instead of alongside each per-program row in `schools`.
  const uniqueUnitids = [...new Set(args.schools.map((s) => s.unitid))];
  const college_details: C1LitePayload["college_details"] = await Promise.all(
    uniqueUnitids.map(async (unitid) => {
      const core = schoolCache.get(unitid) ?? (await fetchSchool(unitid));
      const [campus, tuition, athletics] = await Promise.all([
        fetchCampus(unitid),
        fetchTuitionDetail(unitid, incomeBracket),
        getAthleticsProfile(unitid),
      ]);
      return {
        unitid: String(unitid),
        name: core.name,
        city: core.city,
        state: core.state,
        address: core.address ?? null,
        zip: core.zip ?? null,
        campus,
        tuition,
        athletics,
      };
    }),
  );

  // SAT positioning: deterministic, this user's score vs this report's
  // colleges. usdreport_colleges isn't written until after the PDF is
  // generated, so the ordered input list stands in while the report is pending.
  const sat_positioning = await loadSatPositioning({
    reportReferenceId,
    pendingUnitids: args.schools.map((s) => s.unitid),
  });

  const generatedDate = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return {
    report_meta: {
      report_reference_id: meta.report_reference_id,
      created_at: meta.created_at,
      generated_date: generatedDate,
      methodology_version: args.methodologyVersion ?? "lite-v1",
      data_checked_on: dataCheckedOn,
    },
    student: {
      display_name: student.display_name,
      email: student.email ?? null,
      address: student.address ?? null,
      gpa: student.gpa,
      sat_score: student.sat_score,
      sat_math: student.sat_math,
      sat_reading_writing: student.sat_reading_writing,
      act_score: student.act_score,
      graduation_year: student.graduation_year,
      high_school_name: student.high_school_name,
      preferred_degree_level: student.preferred_degree_level,
      preferred_college_type: student.preferred_college_type,
      income_bracket_field: incomeBracket
        ? BRACKET_TO_COLUMN[incomeBracket]
        : null,
      income_bracket_label: incomeBracket
        ? BRACKET_TO_LABEL[incomeBracket]
        : null,
    },
    schools: out,
    figure_completeness: figureCompleteness(out),
    federal_aid_fetched_on: aidFetchedOn.length ? [...aidFetchedOn].sort().pop()! : null,
    // Plain-text definition of the debt-to-income figures (same text as the
    // methodology page block) so a reader of the payload can interpret them.
    debt_income_ratio_definition: debtRatioDefinitionText(
      debtRatioRefreshed(out, generatedDate),
    ),
    derived_flags: computeDerivedFlags(studentTotalSat, out, roi20YrByName),
    // Same sentence the fallback narrative uses; the AI must copy it verbatim
    // if it mentions graduation rate at all.
    graduation_rate_definition: GRAD_RATE_METHODOLOGY,
    graduation_rate_summary: graduationRateSummary(college_details),
    college_details,
    sat_positioning,
  };
}
