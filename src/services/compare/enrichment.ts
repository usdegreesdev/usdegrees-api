/**
 * Turns one raw enrichment row (from the "selected" or "matrix" query) into the
 * SelectedItem the API returns. Both queries select the same columns, so this
 * is the single place the response shape is built.
 */
import { getEarningsForProgram } from "../earnings.service";
import { publishedGradRatePct } from "../../report/utils/gradRate";
import {
  alignmentFields,
  formatRatio,
  normalizeUrl,
  toFloat,
  toLocation,
  toNum,
  toStr,
} from "./parse";
import type { SelectedItem } from "./types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function mapRowToSelectedItem(row: any): Promise<SelectedItem> {
  const sat25 =
    toFloat(row.sat_low) ??
    (row.sat_p25_math != null && row.sat_p25_reading != null
      ? toFloat(row.sat_p25_math)! + toFloat(row.sat_p25_reading)!
      : null);
  const sat75 =
    toFloat(row.sat_high) ??
    (row.sat_p75_math != null && row.sat_p75_reading != null
      ? toFloat(row.sat_p75_math)! + toFloat(row.sat_p75_reading)!
      : null);

  const popularFields: {
    fieldName: string;
    percentage: number;
    programCount: number;
  }[] = Array.isArray(row.top_fields)
    ? row.top_fields
        .filter((f: { field_name?: string }) => f?.field_name)
        .map(
          (f: {
            field_name: string;
            percentage: unknown;
            program_count: unknown;
          }) => ({
            fieldName: f.field_name,
            percentage: toFloat(f.percentage) ?? 0,
            programCount: toNum(f.program_count) ?? 0,
          }),
        )
    : [];

  const degreeLevels: {
    level: string;
    totalPrograms: number;
    topTitles: string[];
  }[] = Array.isArray(row.degree_levels)
    ? row.degree_levels.map(
        (d: {
          level: string;
          total_programs: unknown;
          top_titles: unknown;
        }) => ({
          level: toStr(d.level) ?? "Other",
          totalPrograms: toNum(d.total_programs) ?? 0,
          topTitles: Array.isArray(d.top_titles)
            ? d.top_titles.filter(Boolean)
            : [],
        }),
      )
    : [];

  // Same getEarningsForProgram() resolution the outcomes tab calls for this
  // exact (unitid, cip_code, credential_level) — guarantees compare's
  // avg_salary matches outcomes exactly (value, cohort, estimated basis)
  // instead of a second, parallel computation over the same table.
  const selUnitid = toNum(row.unitid);
  const selCip = toStr(row.sel_program_cip);
  const selCredentialLevel = toNum(row.sel_program_credential_level);
  const selectedProgramEarnings =
    row.sel_program_title != null &&
    selUnitid != null &&
    selCip != null &&
    selCredentialLevel != null
      ? (await getEarningsForProgram(selUnitid, selCip, selCredentialLevel))
          .avg_salary
      : null;

  return {
    unitid: toNum(row.unitid),
    name: row.name ?? null,
    location: toLocation(row.city, row.state),
    tuitionInState: toFloat(row.tuition_in_state),
    acceptanceRate: toFloat(row.admission_rate),
    addedAt: row.added_at ?? null,
    schoolUrl: normalizeUrl(row.school_url),
    schoolType: toStr(row.school_type),
    accreditor: toStr(row.accreditor),
    ...alignmentFields(row),
    academics: {
      satRangeLow: sat25,
      satRangeHigh: sat75,
      graduationRate: publishedGradRatePct(row),
    },
    cost: {
      tuitionOutState: toFloat(row.tuition_out_state),
      stickerPrice: toFloat(row.sticker_price),
      avgDebt: toFloat(row.avg_debt),
      debtIncomeRatio: toFloat(row.debt_income_ratio),
    },
    outcomes: {
      // Prefer the exact selected-program figure over the school-wide
      // average whenever a program filter matched this school.
      programEarnings:
        toFloat(row.sel_program_earnings) ?? toFloat(row.program_earnings),
      // Sourced from getEarningsForProgram() (same as outcomes) when a
      // program filter matched this school; otherwise the school-wide
      // aggregate.
      avgSalary:
        row.sel_program_title != null
          ? selectedProgramEarnings
          : toFloat(row.avg_salary),
      roi20Yr: toFloat(row.roi_20yr),
    },
    students: {
      size: toNum(row.student_size),
    },
    programs: {
      studentFacultyRatio: formatRatio(row.student_faculty_ratio),
      repaymentSuccess: toFloat(row.repayment_success),
      popularFields,
      degreeLevels,
      selectedProgram: row.sel_program_title
        ? {
            title: row.sel_program_title,
            cipCode: toStr(row.sel_program_cip),
            degreeLevelCategory: toStr(row.sel_program_degree_level),
            credentialLevel: toNum(row.sel_program_credential_level),
            earnings: selectedProgramEarnings,
          }
        : null,
    },
  };
}
