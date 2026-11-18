// ─────────────────────────────────────────────
// Types & Interfaces
// ─────────────────────────────────────────────

/** Raw scalar row: one row from the 3-table JOIN */
export interface AcademicsRawRow {
  // completion.grad_rate_150nt_pct (already a percent) + its cohort
  grad_rate_150nt_pct: number | string | null;
  grad_rate_cohort: number | null;
  student_faculty_ratio: number | null;
  repayment_success: number | null;
}

/** Raw row from program_distribution */
export interface ProgramDistributionRawRow {
  field_name: string | null;
  percentage: number | null;
  program_count: number | null;
}

/** Single field of study in the response */
export interface FieldOfStudy {
  field_name: string;
  percentage: number;
  program_count: number;
}

/** Shaped API response */
export interface ProgramsResponse {
  unitid: number;
  academics: {
    graduation_rate: number | null; // percentage, e.g. 94
    student_faculty_ratio: string | null; // formatted, e.g. "5:1"
    repayment_success: number | null; // percentage, e.g. 81
  };
  popular_fields: FieldOfStudy[];
}

/** Standard API error envelope */
export interface ApiError {
  error: string;
  message: string;
  unitid?: number;
}
/** comprehensive degree level tiles */
export interface ComprehensiveDegreeLevel {
  level: string;
  total_programs: number;
  top_titles: string[];
}

export interface ProgramsResponse {
  unitid: number;

  academics: {
    graduation_rate: number | null;
    student_faculty_ratio: string | null;
    repayment_success: number | null;
  };

  popular_fields: FieldOfStudy[];

  comprehensive_degree_levels: ComprehensiveDegreeLevel[];
}

export interface DegreeLevelRawRow {
  degree_level_category: string;
  total_programs: number;
  top_titles: string[];
}
