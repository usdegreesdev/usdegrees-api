import { EarningsFillMethod, RawEarningsFillMethod } from "./earnings";

// ---------------------------------------------------------------------------
// Types & Interfaces
// ---------------------------------------------------------------------------

/**
 * Raw shape returned directly from the PostgreSQL query (single flat row).
 * All LEFT-JOIN fields are typed as nullable since they may not exist for
 * every unitid / cip_code combination.
 */
export interface OverviewRow {
  // schools
  unitid: number;
  program_count: number | null;

  // school_descriptions
  school_descriptions: string | null;

  // admissions
  admission_rate: number | null;
  sat_rw_min: number | null;
  sat_rw_max: number | null;
  sat_math_min: number | null;
  sat_math_max: number | null;
  sat_avg_overall: number | null;
  publish_publicly: boolean | null;
  school_min_range: number | null;
  school_max_range: number | null;
  sat_p25_reading: number | null;
  sat_p75_reading: number | null;
  sat_p25_math: number | null;
  sat_p75_math: number | null;

  // admission_disclosure_categories (nulled when the disclosure is suppressed)
  sat_disclosure_category: string | null;
  badge_label: string | null;
  badge_color: string | null;
  supporting_copy: string | null;
  disclaimer_tier: number | null;
  disclaimer_text: string | null;
  show_admission_rate_required: boolean | null;

  // students
  size: number | null;
  student_faculty_ratio: string | null;
  retention_rate: number | null;
  fafsa_applications: number | null;

  // completion
  completion_rate: number | null;

  // earnings_against_courses_merged (keyed by unitid + cip_code)
  year_1: number | null;
  year_10: number | null;
  growth_rate: number | null;
  year_1_method: RawEarningsFillMethod;
  year_10_method: RawEarningsFillMethod;
  avg_salary: number | null;

  // roi (keyed by unitid + credential_level)
  roi_20yr: number | null;

  // costs (used for ROI supplementary data)
  for_roi_data: Record<string, unknown> | null;

  // programs & program_descriptions
  program_cip_code: string | null;
  program_title: string | null;
  program_credential_title: string | null;
  program_credential_level: number | null;
  program_description: string | null;
}

/**
 * Nested response shape sent back to the client.
 */
export interface OverviewResponse {
  school: {
    unitid: number;
    program_count: number | null;
    school_description: string | null;
  };
  admissions: {
    admission_rate: number | null;
    sat_rw_min: number | null;
    sat_rw_max: number | null;
    sat_math_min: number | null;
    sat_math_max: number | null;
    sat_avg_overall: number | null;
    publish_publicly: boolean | null;
    school_min_range: number | null;
    school_max_range: number | null;
    sat_p25_reading: number | null;
    sat_p75_reading: number | null;
    sat_p25_math: number | null;
    sat_p75_math: number | null;
    satDisclosureCategory: string | null;
    badgeLabel: string | null;
    badgeColor: string | null;
    supportingCopy: string | null;
    disclaimerTier: number | null;
    disclaimerText: string | null;
    showAdmissionRateRequired: boolean;
  };
  students: {
    size: number | null;
    student_faculty_ratio: string | null;
    retention_rate: number | null;
    fafsa_applications: number | null;
  };
  completion: {
    completion_rate: number | null;
  };
  earnings: {
    year_1: number | null;
    year_10: number | null;
    growth_rate: number | null;
    year_1_method: EarningsFillMethod;
    year_10_method: EarningsFillMethod;
    avg_salary: number | null;
  };
  roi: {
    roi_20yr: number | null;
    for_roi_data: Record<string, unknown> | null;
  };
  program: {
    cip_code: string | null;
    title: string | null;
    credential_title: string | null;
    credential_level: number | null;
    program_description: string | null;
  } | null;
}
