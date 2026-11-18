import {
  EarningsFillMethod,
  EarningsResolved,
  RawEarningsFillMethod,
} from "./earnings";

// ---------------------------------------------------------------------------
// Types & Interfaces
// ---------------------------------------------------------------------------

/**
 * Raw flat row returned from PostgreSQL.
 * All LEFT-JOIN fields are nullable — they may be absent for some
 * unitid / cip_code combinations.
 */
export interface OutcomesRow {
  // earnings_against_courses_merged (program-level: unitid + cip_code)
  year_1: number | null;
  year_5: number | null;
  year_10: number | null;
  year_1_method: RawEarningsFillMethod;
  year_5_method: RawEarningsFillMethod;
  year_10_method: RawEarningsFillMethod;
  avg_salary: number | null;
  growth_rate: number | null;

  // completion (school-level: unitid only — no cip_code column in this table)
  emp_factor: number | null;
}

/**
 * Nested client-facing response shape.
 * Mirrors the Outcomes & Careers page sections.
 */
export interface OutcomesResponse {
  earnings: {
    year_1: number | null;
    year_5: number | null;
    year_10: number | null;
    year_1_method: EarningsFillMethod;
    year_5_method: EarningsFillMethod;
    year_10_method: EarningsFillMethod;
    avg_salary: number | null;
    growth_rate: number | null;
  };
  /**
   * Per-metric, cohort-aware resolution (see earnings.service.ts). Additive
   * alongside `earnings` above — null when the program's credential_level
   * couldn't be resolved from `programs`, not an error condition.
   */
  earnings_resolved: EarningsResolved | null;
  completion: {
    emp_factor: number | null;
  };
  /**
   * School-level debt-to-income on the PDF report's basis: avg_debt ÷
   * earnings.<DEBT_RATIO_BASIS.column>. null when either input is missing.
   */
  debt_income_ratio: {
    debt_income_ratio: number | null;
    avg_debt: number | null;
    basis_earnings: number | null;
    basis_label: string;
    basis_api_field: string;
    earnings_fetched_on: string | null;
    /** The report's definition text, or null without a fetch date. */
    definition: string | null;
  };
}
