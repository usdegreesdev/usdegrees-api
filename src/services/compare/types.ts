/** Shapes returned by the compare endpoints. */
import type { EarningsAvgSalaryResolved } from "../../types/earnings";

export interface SelectedItem {
  unitid: number | null;
  name: string | null;
  location: string | null;
  tuitionInState: number | null; // costs.tuition_in_state (IN-STATE specifically)
  acceptanceRate: number | null; // admissions.admission_rate
  addedAt: string | Date | null; // earliest created_at across history
  schoolUrl: string | null; // schools.school_url, normalized to absolute
  schoolType: string | null; // programs.school_type, e.g. "Public, 4-year"
  accreditor: string | null; // schools.accreditor
  // Academic-alignment fields (nullable). cipCode/degreeLevel describe the
  // SELECTED program only; null when no program is selected.
  cipCode: string | null; // dotted, e.g. "11.07"
  degreeLevel: string | null; // certificate|associate|bachelor|master|doctorate
  stateCode: string | null; // 2-letter, schools.state
  academics: {
    satRangeLow: number | null; // admissions.school_min_range (or summed p25 math+reading)
    satRangeHigh: number | null; // admissions.school_max_range (or summed p75 math+reading)
    graduationRate: number | null; // completion.grad_rate_150nt_pct, already 0–100 (NOT a fraction); null when unpublished or cohort < MIN_GRAD_RATE_COHORT
  };
  cost: {
    tuitionOutState: number | null; // costs.tuition_out_state
    stickerPrice: number | null; // costs.sticker_price_by_api
    avgDebt: number | null; // debt_income_ratio.avg_debt
    debtIncomeRatio: number | null; // debt_income_ratio.debt_income_ratio
  };
  outcomes: {
    programEarnings: number | null; // AVG(earnings_against_courses_merged.year_10) across the school's programs
    // "Median Graduate Salary" in the compare UI. When a `program` filter
    // matched this school, sourced from the SAME getEarningsForProgram()
    // resolution the outcomes tab uses for that (unitid, cip_code,
    // credential_level) — recency-first across every grad_cohort on file,
    // not a separate/legacy computation. Otherwise (no program filter / no
    // match) falls back to the school-wide AVG(avg_salary) across all
    // programs, as a bare number.
    avgSalary: EarningsAvgSalaryResolved | number | null;
    roi20Yr: number | null; // roi.roi_20yr
  };
  students: {
    size: number | null; // students.size — total enrollment
  };
  programs: {
    studentFacultyRatio: string | null; // students.student_faculty_ratio, formatted "5:1"
    repaymentSuccess: number | null; // repayment.repayment_success (integer percent 0–100)
    popularFields: {
      fieldName: string;
      percentage: number;
      programCount: number;
    }[]; // program_distribution, top 5 by share
    degreeLevels: {
      level: string;
      totalPrograms: number;
      topTitles: string[];
    }[]; // programs, grouped by degree_level_category (Undergraduate/Graduate/Professional/Other)
    selectedProgram: {
      title: string;
      cipCode: string | null;
      degreeLevelCategory: string | null;
      credentialLevel: number | null;
      // Same getEarningsForProgram() resolution as outcomes.avgSalary above —
      // guarantees this matches exactly what the outcomes tab shows for the
      // same program (value, cohort, and estimated basis).
      earnings: EarningsAvgSalaryResolved | null;
    } | null; // set only when a `program` filter is passed and the school offers a matching title
  };
}

export interface MatrixEntry {
  unitid: number;
  cipCode: string | null;
  credentialLevel: string | null;
  programName: string | null;
  credentialTitle: string | null;
}

export interface ApiErrorBody {
  error: string;
  details?: string;
  code?: string;
}
