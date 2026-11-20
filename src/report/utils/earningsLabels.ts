/**
 * Earnings value labels, and which of them a given report actually uses.
 * The methodology page lists only the labels that appear in this report, and
 * mentions estimates only when a printed figure is one.
 */
export const EARNINGS_LABEL_TEXT: Record<string, string> = {
  "Census-reported": "Real PSEO value — measured, not estimated.",
  "Estimated (between two real values)": "Estimated between two real points; most reliable estimate.",
  "Estimated (from one nearby real value)": "Estimated from a nearer real-data anchor.",
  "Estimated — low confidence": "Single-anchor or declining-trajectory estimate; use with caution.",
};
export const NOT_PUBLISHED_LABEL_TEXT =
  "No value is shown because the outcome year has not yet occurred or no real value was available.";

type SchoolEarnings = { program_earnings: number | null; earnings_method_flag: string | null; earnings_estimated?: boolean };

export function earningsLabelsUsed(schools: SchoolEarnings[]): {
  labels: string[];
  estimated: boolean;
  anyNotPublished: boolean;
} {
  const labels = new Set<string>();
  let anyNotPublished = false;
  for (const s of schools) {
    if (s.program_earnings == null) anyNotPublished = true;
    else if (s.earnings_method_flag && EARNINGS_LABEL_TEXT[s.earnings_method_flag]) labels.add(s.earnings_method_flag);
  }
  return {
    labels: [...labels],
    estimated: schools.some((s) => s.earnings_estimated === true),
    anyNotPublished,
  };
}
