// ---------------------------------------------------------------------------
// Types & Interfaces — Athletics disclosure info (EADA-sourced)
// ---------------------------------------------------------------------------

export interface ApiError {
  error: string;
  details?: string;
}

/** Raw row shape from the athletic_summary + schools + content-block join. */
export interface AthleticSummaryRow {
  unitid: string | number;
  institution_name: string | null;
  survey_year: string;
  division: string;
  athletic_aid_total: string | null;
  athletes_total: string | null;
  avg_aid_per_athlete: string | null;
  recruiting_expense: string | null;
  athletic_revenue: string | null;
  athletic_expense: string | null;
  summary_paragraph: string | null;
}

/** Raw row shape from athletic_sports for a single unitid + survey_year. */
export interface AthleticSportsRow {
  sport: string;
  gender: "Men" | "Women" | string;
  roster_size: number | string | null;
}

/** Raw row shape from athletic_division_benchmarks. */
export interface AthleticDivisionBenchmarkRow {
  division: string;
  survey_year: string;
  avg_athletes_total: number | string | null;
  avg_aid_per_athlete: number | string | null;
  avg_recruiting_expense: number | string | null;
  avg_revenue: number | string | null;
  avg_expense: number | string | null;
}

export interface AthleticsRosterEntry {
  sport: string;
  /** 0 when the sport has no team of this gender; null when a team's
   *  roster_size is not reported. */
  men: number | null;
  women: number | null;
}

export interface AthleticsSummary {
  athletesTotal: number | null;
  /** null when any contributing roster_size is not reported — never a
   *  partial sum that counts a missing roster as 0. */
  athletesMen: number | null;
  athletesWomen: number | null;
  athleticAidTotal: number | null;
  avgAidPerAthlete: number | null;
  recruitingExpense: number | null;
  recruitingExpensePerAthlete: number | null;
  athleticRevenue: number | null;
  athleticExpense: number | null;
  surplus: number | null;
}

export interface AthleticsDivisionBenchmark {
  division: string;
  avgAidPerAthlete: number | null;
  avgAthletesTotal: number | null;
  avgRecruitingExpense: number | null;
}

export interface AthleticsProfile {
  unitid: number;
  institutionName: string;
  surveyYear: string;
  division: string;
  summary: AthleticsSummary;
  sportsOffered: number;
  roster: AthleticsRosterEntry[];
  summaryParagraph: string | null;
  hasRosterData: boolean;
  divisionBenchmark: AthleticsDivisionBenchmark | null;
}
