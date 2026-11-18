/**
 * Determines the admission fit category ("Target/Match", "Reach") and fit score (0-100)
 * based on the student's academic profile and the college's admission statistics.
 *
 * This is an Admission Fit Estimate, not a probability of admission — there is
 * intentionally no "Safety" tier, since that word implies a likelihood of
 * acceptance this score does not measure.
 *
 * Every input is a real value or null; nothing is defaulted. A fit needs a
 * real SAT comparison — the student's total SAT against the college's
 * published SAT average or full percentile band. Without one the result is
 * "Unavailable" with a null score, never a 50 or a score built on assumed
 * percentiles.
 *
 * GPA is not part of the score. The database holds no college GPA data, and
 * the former "expected GPA" bands (3.9 / 3.75 / 3.5 / 3.2 / 3.0) were
 * inferred from the admission rate, not published — comparing a student's
 * GPA against them was comparing against an invented figure.
 */
export interface StudentAcademics {
  /** The student's total SAT (400–1600). Never inferred from one section. */
  satTotal: number | null;
}

export interface CollegeAdmissions {
  /** 0–1 fraction. */
  admissionRate: number | null;
  satAvg: number | null;
  sat25Math: number | null;
  sat75Math: number | null;
  sat25Reading: number | null;
  sat75Reading: number | null;
}

export interface FitResult {
  category: "Target/Match" | "Reach" | "Unavailable";
  /** 5–99, or null when Unavailable. */
  score: number | null;
  explanation: string;
}

const UNAVAILABLE_COLLEGE: FitResult = {
  category: "Unavailable",
  score: null,
  explanation: "The college does not publish the SAT data needed to calculate academic fit.",
};

const UNAVAILABLE_STUDENT: FitResult = {
  category: "Unavailable",
  score: null,
  explanation: "No SAT score was provided, so academic fit cannot be calculated.",
};

/** The college's total SAT 25th/75th percentiles, only when all four sections are published. */
function collegeSatBand(college: CollegeAdmissions): { p25: number; p75: number } | null {
  const { sat25Math, sat75Math, sat25Reading, sat75Reading } = college;
  if (sat25Math == null || sat75Math == null || sat25Reading == null || sat75Reading == null) {
    return null;
  }
  return { p25: sat25Math + sat25Reading, p75: sat75Math + sat75Reading };
}

function satFitScore(studentSat: number, college: CollegeAdmissions): number | null {
  if (college.satAvg != null) {
    // Map difference of -200 to +200 onto a score of 0 to 100
    return Math.max(0, Math.min(100, 50 + (studentSat - college.satAvg) / 4));
  }
  const band = collegeSatBand(college);
  if (band == null) return null;
  const { p25, p75 } = band;
  if (studentSat >= p75) return 85 + ((studentSat - p75) / (1600 - p75)) * 15;
  if (studentSat < p25) return Math.max(10, (studentSat / p25) * 60);
  return 60 + ((studentSat - p25) / (p75 - p25)) * 25;
}

export function calculateAdmissionFit(
  student: StudentAcademics,
  college: CollegeAdmissions
): FitResult {
  if (student.satTotal == null) return UNAVAILABLE_STUDENT;

  const satScore = satFitScore(student.satTotal, college);
  if (satScore == null) return UNAVAILABLE_COLLEGE;

  let score = satScore;

  // Factor in college selectivity (harder to get in = reach even with good scores)
  if (college.admissionRate != null) {
    score -= Math.max(0, (1 - college.admissionRate) * 20);
    // Cap at 90 for highly selective schools (acceptance rate < 10%)
    if (college.admissionRate < 0.1 && score > 90) score = 90;
  }

  score = Math.max(5, Math.min(99, Math.round(score)));

  if (score >= 45) {
    return {
      category: "Target/Match",
      score,
      explanation: "Your scores align with or exceed the middle 50% range of admitted students. This is an Admission Fit Estimate, not a probability of admission.",
    };
  }
  return {
    category: "Reach",
    score,
    explanation:
      college.admissionRate != null && college.admissionRate < 0.12
        ? "This is an ultra-selective institution with high competition. Admission remains a reach for all applicants."
        : "Your academic credentials sit below the historical averages of admitted students, making admission competitive.",
  };
}
