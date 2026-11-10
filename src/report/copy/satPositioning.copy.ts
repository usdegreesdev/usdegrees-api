/**
 * Static UI copy for the SAT score positioning section. Nothing here is
 * college- or student-specific; values are interpolated from the payload.
 */
import { SAT_DATA_YEAR, SAT_SCALE } from "../config/satPositioning.config";

export const satCopy = {
  eyebrow: "TEST SCORE POSITIONING",
  titleNoScore: "Test Score Positioning",
  title: (score: number) =>
    `Your ${score} SAT, from strongest fit to biggest stretch`,

  chip: {
    above: (n: number) => `${n} above range`,
    within: (n: number) => `${n} within range`,
    below: (n: number) => `${n} below range`,
    noData: (n: number) => `${n} no score data`,
  },

  verdict: {
    above: "Above range",
    within: "Within range",
    below: "Below range",
  },
  detail: {
    above: "Higher than about 3 in 4 enrolled students who reported scores",
    within: (pct: number) => `${pct}% of the way through the middle 50%`,
    below: "Most enrolled students who reported scores scored higher",
  },

  mid50: (p25: number, p75: number) => `Mid 50%: ${p25}–${p75}`,
  gapBelow: (gap: number) => `−${gap} pts`,
  gapAbove: (gap: number) => `+${gap} pts`,
  inRange: "in range",
  noScoreData: "No score data",
  visit: (host: string) => `Visit ${host}`,

  noStudentScore:
    `Add your SAT score to your profile to see how it compares with each college's middle 50% range. Your score is not shown here until a valid SAT score (${SAT_SCALE.min}–${SAT_SCALE.max}) is on your profile.`,
  noCollegeData:
    "None of the colleges in this report has published an SAT score range, so your score can't be placed against them. The notes below explain what each college reports.",

  note: (year: number) =>
    `Blue band = middle 50% of first-year students who enrolled and reported SAT scores, shown as the sum of each school's Reading & Writing and Math 25th/75th percentiles (an approximation of the composite range). Dashed line = distance from your score to the nearest edge of that range. Source: IPEDS ${year} via College Scorecard.`,
  noteYear: SAT_DATA_YEAR,
};

/**
 * Every number that appears in the static copy above (digits inside
 * templates, e.g. "3 in 4", "50%", "400–1600"). The rendered-number gate
 * treats these as legitimate in addition to payload values.
 */
export function satCopyNumbers(): Set<string> {
  const samples: string[] = [
    satCopy.detail.above,
    satCopy.detail.below,
    satCopy.detail.within(0),
    satCopy.noStudentScore,
    satCopy.noCollegeData,
    satCopy.note(satCopy.noteYear),
    satCopy.mid50(0, 0),
  ];
  const out = new Set<string>();
  for (const s of samples)
    for (const m of s.match(/\d[\d,]*(?:\.\d+)?/g) ?? []) out.add(m);
  return out;
}
