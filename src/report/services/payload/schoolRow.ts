/** Builds one entry of payload.schools: a school (optionally a specific program) with all its figures. */
import CREDENTIAL_LEVELS from "../../../constants/credentials";
import { toFraction } from "../../../utils/fieldScale";
import { calculateAdmissionFit } from "../../utils/admissionScore";
import { DEBT_RATIO_BASIS, ratioNumeral } from "../../utils/debtRatio";
import { cleanProgramName } from "../../utils/programName";
import { schoolFigures } from "../../utils/missingValue";
import { isSubmittedOnlyCategory } from "../../config/satPositioning.config";
import type { C1LitePayload } from "../reportPrompt";
import { fetchNetPriceAndSector, type IncomeBracket } from "./netPrice";
import {
  ADMISSIONS_VINTAGE,
  NO_FIT_CATEGORIES,
  fetchAdmissions,
  fetchDisclosure,
} from "./admissions";
import { fetchProgramEarnings, resolveCredentialLevel } from "./earnings";
import { fetchCosts, fetchDebt } from "./costs";
import { fetchFederalAid, fetchSchool } from "./records";

export interface SchoolRowInput {
  unitid: number;
  programCip?: string;
  programName?: string;
  incomeBracket: IncomeBracket | null;
  studentTotalSat: number | null;
  netPriceVintage: string;
  debtVintage: number | string | null | undefined;
}

export interface SchoolRowResult {
  row: C1LitePayload["schools"][number];
  /** The core schools-table row, reused later by the college-details pass. */
  core: Awaited<ReturnType<typeof fetchSchool>>;
  /** school_federal_aid_status.fetched_on, when there is one. */
  aidFetchedOn: string | null;
}

export async function buildSchoolRow(input: SchoolRowInput): Promise<SchoolRowResult> {
  const {
    unitid,
    programCip,
    incomeBracket,
    studentTotalSat,
    netPriceVintage: NET_PRICE_VINTAGE,
    debtVintage,
  } = input;
  const rawProgramName = input.programName;
  const programName = cleanProgramName(rawProgramName) ?? undefined;
  const core = await fetchSchool(unitid);
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

  const [np, adm, earn, costs, debt, aid] = await Promise.all([
    fetchNetPriceAndSector(unitid, incomeBracket),
    fetchAdmissions(unitid),
    fetchProgramEarnings(unitid, programCip, credentialLevel),
    fetchCosts(unitid),
    fetchDebt(unitid),
    fetchFederalAid(unitid),
  ]);

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

  const rowForFigures = {
    net_price_bracket: np.value,
    program_earnings: earn.earnings,
    avg_debt: debt.avg_debt,
    federal_aid_status: aid.status,
  };

  const row: C1LitePayload["schools"][number] = {
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
    // Year 1 / 5 / 10 all from the ONE cohort in earnings_vintage.
    earnings_year_1: earn.year1,
    earnings_year_1_vintage: earn.year1_vintage,
    earnings_year_5: earn.year5,
    // Newest cohort's year 1 — printed only as its own labelled line.
    earnings_latest_year_1: earn.latest_year1,
    earnings_latest_year_1_cohort: earn.latest_year1_vintage,
    earnings_estimated: earn.estimated,
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
    debt_vintage:
      debt.avg_debt != null
        ? debtVintage != null
          ? `College Scorecard, data year ${debtVintage}`
          : "College Scorecard"
        : null,
    federal_aid_status: aid.status ?? "unknown",
    // Per-school value-or-reason strings the narrative must use as given.
    figures: schoolFigures(rowForFigures),
  };

  return { row, core, aidFetchedOn: aid.fetched_on };
}
