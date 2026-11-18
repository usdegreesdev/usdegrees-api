export interface StudentRawRow {
  size_category: string | null;
  size: number | null;
  grad_students: number | null;
  demographics_men: number | null;
  demographics_women: number | null;
  student_faculty_ratio: string | null;
  faculty_men: number | null;
  faculty_women: number | null;
  // repayment (all_borrowers_3yr is never read: not real data)
  graduates_3yr: number | null;
  non_completers_3yr: number | null;
  yr1_overall: number | null;
  yr3_overall: number | null;
  yr3_completers: number | null;
  yr3_noncompleters: number | null;
}

/** Demographics sub-object */
export interface Demographics {
  men: number | null;
  women: number | null;
}

/** Shaped API response */
export interface CampusStudentsResponse {
  unitid: number;
  campus: {
    size_category: string | null;
    size: number | null;
    student_faculty_ratio: string | null;
  };
  students: {
    grad_students: number | null;
    demographics: Demographics;
    faculty: {
      men: number | null;
      women: number | null;
    };
  };
  repayment: {
    graduates_3yr: number | null;
    non_completers_3yr: number | null;
    yr1_overall: number | null;
    yr3_overall: number | null;
    yr3_completers: number | null;
    yr3_noncompleters: number | null;
  };
}

/** Standard API error envelope */
export interface ApiError {
  error: string;
  message: string;
  unitid?: number;
}
