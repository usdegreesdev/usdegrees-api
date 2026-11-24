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
 * Utils:  calculateAdmissionFit (utils/admissionScore)
 *
 * Known limitations (intentional, not bugs):
 *  - Vintages: no vintage columns exist, so they are constants below.
 *    Promote to real columns later; the AI only cites what we pass.
 *  - Program earnings: usdusers has no program/CIP. Pass programCip per
 *    school for true program-level earnings; otherwise the builder
 *    aggregates year_10 across the school's programs and labels it so.
 *
 * This file orchestrates; the individual DB lookups live in ./payload/:
 *   netPrice.ts    income brackets + net price / sector
 *   admissions.ts  SAT bands, admit rate, disclosure copy
 *   earnings.ts    program earnings (year 1 / 5 / 10)
 *   costs.ts       sticker price, school-wide debt, tuition breakdown
 *   campus.ts      campus & student body
 *   records.ts     student, report row, school, federal-aid status
 *   schoolRow.ts   assembles one payload.schools entry
 */

import pool from "../../db/client";
import type { C1LitePayload } from "./reportPrompt";
import {
  debtRatioDefinitionText,
  debtRatioRefreshed,
} from "../utils/debtRatio";
import { loadDataVintage } from "../utils/dataVintage";
import { getAthleticsProfile } from "../../services/athletics.service";
import { loadSatPositioning } from "./satPositioning.service";
import { isSubmittedOnlyCategory } from "../config/satPositioning.config";
import { figureCompleteness } from "../utils/missingValue";
import { GRAD_RATE_METHODOLOGY, graduationRateSummary } from "../utils/gradRate";
import {
  BRACKET_TO_COLUMN,
  BRACKET_TO_LABEL,
  netPriceVintage,
  type IncomeBracket,
} from "./payload/netPrice";
import { fetchCampus } from "./payload/campus";
import { fetchTuitionDetail } from "./payload/costs";
import { fetchReportMeta, fetchSchool, fetchStudent } from "./payload/records";
import { buildSchoolRow } from "./payload/schoolRow";

// Re-exported so existing importers of this module keep working.
export type { IncomeBracket };
export { fetchCampus };

// ------------------------------------------------------------------
// Derived flags (pure computation)
// ------------------------------------------------------------------
export function computeDerivedFlags(
  studentSat: number | null,
  schools: C1LitePayload["schools"],
): C1LitePayload["derived_flags"] {
  const above: string[] = [];
  const below: string[] = [];
  for (const s of schools) {
    // Ranges for test-optional / considered-if-submitted schools cover only
    // students who submitted scores, so they never raise a score-position flag.
    if (isSubmittedOnlyCategory(s.sat_data_category)) continue;
    if (studentSat != null && s.sat_75 != null && studentSat > s.sat_75)
      above.push(s.display_name);
    if (studentSat != null && s.sat_25 != null && studentSat < s.sat_25)
      below.push(s.display_name);
  }
  return { above_p75_schools: above, below_p25_schools: below };
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
      `SELECT to_char(GREATEST(
         (SELECT max(grad_rate_fetched_on)     FROM completion                 WHERE unitid = ANY($1)),
         (SELECT max(scorecard_api_fetched_on) FROM earnings                   WHERE unitid = ANY($1)),
         (SELECT max(fetched_on)               FROM school_federal_aid_status  WHERE unitid = ANY($1)),
         (SELECT max(fetched_on)               FROM scorecard_admissions_flags WHERE unitid = ANY($1))
       ), 'YYYY-MM-DD') AS data_checked_on`,
      [unitids],
    );
    const v = rows[0]?.data_checked_on;
    if (v == null) return null;
    return String(v).slice(0, 10);
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------
// Orchestrator
// ------------------------------------------------------------------

/**
 * College-level detail (campus/students, tuition & costs, athletics) is NOT
 * program-specific, so it is built once per unique unitid — a college compared
 * under three programs still gets exactly one entry, never three.
 */
async function buildCollegeDetails(
  unitids: number[],
  incomeBracket: IncomeBracket | null,
  schoolCache: Map<number, Awaited<ReturnType<typeof fetchSchool>>>,
): Promise<C1LitePayload["college_details"]> {
  return Promise.all(
    unitids.map(async (unitid) => {
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
}

export async function buildC1LitePayload(args: {
  userId: number;
  reportReferenceId: string;
  schools: Array<{ unitid: number; programCip?: string; programName?: string }>;
  incomeBracket: IncomeBracket | null;
  methodologyVersion?: string;
}): Promise<C1LitePayload> {
  const { userId, reportReferenceId } = args;

  const [student, meta, dataCheckedOn, dataVintage] = await Promise.all([
    fetchStudent(userId),
    fetchReportMeta(reportReferenceId),
    fetchDataCheckedOn(args.schools.map((s) => s.unitid)),
    loadDataVintage(pool),
  ]);
  const NET_PRICE_VINTAGE = netPriceVintage(dataVintage.release_date);
  const debtVintage = dataVintage.years["median_debt_completers"];

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
  const aidFetchedOn: string[] = [];
  // Cache each unitid's core school row so the college-details pass doesn't
  // re-query schools — the same college can appear once per compared program.
  const schoolCache = new Map<number, Awaited<ReturnType<typeof fetchSchool>>>();

  for (const { unitid, programCip, programName } of args.schools) {
    const result = await buildSchoolRow({
      unitid,
      programCip,
      programName,
      incomeBracket,
      studentTotalSat,
      netPriceVintage: NET_PRICE_VINTAGE,
      debtVintage,
    });
    schoolCache.set(unitid, result.core);
    out.push(result.row);
    if (result.aidFetchedOn) aidFetchedOn.push(result.aidFetchedOn);
  }

  const uniqueUnitids = [...new Set(args.schools.map((s) => s.unitid))];
  const college_details = await buildCollegeDetails(
    uniqueUnitids,
    incomeBracket,
    schoolCache,
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
    derived_flags: computeDerivedFlags(studentTotalSat, out),
    data_vintage: dataVintage,
    // Same sentence the fallback narrative uses; the AI must copy it verbatim
    // if it mentions graduation rate at all.
    graduation_rate_definition: GRAD_RATE_METHODOLOGY,
    graduation_rate_summary: graduationRateSummary(college_details),
    college_details,
    sat_positioning,
  };
}
