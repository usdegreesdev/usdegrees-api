/**
 * Data-year wording, read from the database — never typed into a string.
 *
 *   scorecard_data_vintage  → the Scorecard data year of each metric
 *   scorecard_release       → the Scorecard release the database holds
 *
 * A metric with no row (or no data_year) is left out of the printed line
 * rather than guessed.
 */

export interface DataVintage {
  /** scorecard_release.release_date as "YYYY-MM-DD", or null. */
  release_date: string | null;
  /** scorecard_data_vintage.metric → data_year. */
  years: Record<string, number>;
}

export interface Queryable {
  query: (text: string, values?: unknown[]) => Promise<{ rows: any[] }>;
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June", "July",
  "August", "September", "October", "November", "December",
];

/** "2026-11-02" → "November 2026" (string maths only, so no timezone shift). */
export function monthYearFromIso(iso: string | null | undefined): string | null {
  const m = /^(\d{4})-(\d{2})-\d{2}/.exec(iso ?? "");
  if (!m) return null;
  const month = Number(m[2]);
  return month >= 1 && month <= 12 ? `${MONTHS[month - 1]} ${m[1]}` : null;
}

export async function loadDataVintage(db: Queryable): Promise<DataVintage> {
  const out: DataVintage = { release_date: null, years: {} };
  try {
    const rel = await db.query(
      `SELECT to_char(release_date, 'YYYY-MM-DD') AS release_date
         FROM scorecard_release ORDER BY release_date DESC LIMIT 1`,
    );
    out.release_date = rel.rows[0]?.release_date ?? null;
    const v = await db.query(
      `SELECT metric, data_year FROM scorecard_data_vintage WHERE data_year IS NOT NULL`,
    );
    for (const r of v.rows) out.years[String(r.metric)] = Number(r.data_year);
  } catch (err) {
    console.warn("data vintage lookup failed; no data years will be printed", err);
  }
  return out;
}

/** Metrics printed in the report, in order, with the label shown beside the year. */
const PRINTED: Array<{ label: string; metrics: string[] }> = [
  // Only the 6-years-after-entry figure is displayed (in the debt-to-income ratio); the 10-year one is not.
  { label: "school-wide earnings 6 years after entry", metrics: ["earnings_6yr_after_entry"] },
  { label: "median federal debt of completers", metrics: ["median_debt_completers"] },
  { label: "graduation rate", metrics: ["graduation_rate_4yr_150nt", "graduation_rate_lt4yr_150nt"] },
  { label: "cost of attendance and tuition", metrics: ["cost_of_attendance", "tuition_in_state"] },
  { label: "admission rate", metrics: ["admission_rate"] },
  { label: "SAT ranges", metrics: ["sat_average"] },
  { label: "enrollment", metrics: ["student_size"] },
];

/** "school-wide earnings 6 years after entry 2022; median federal debt of completers 2024; …" */
export function dataYearsLine(v: DataVintage | null | undefined): string | null {
  if (!v) return null;
  const parts: string[] = [];
  for (const p of PRINTED) {
    const ys = [...new Set(p.metrics.map((m) => v.years[m]).filter((y) => Number.isFinite(y)))];
    if (ys.length) parts.push(`${p.label} ${ys.join("/")}`);
  }
  return parts.length ? parts.join("; ") : null;
}

/** Printed once after the data-years sentence so program and school-wide earnings are not conflated. */
export const PSEO_EARNINGS_DISCLAIMER =
  "Program earnings are from Census PSEO, measured after graduation for the cohort shown in the table (not the Scorecard data year above), and are not comparable to the school-wide figure.";

/** Plain sentence for the methodology page and the earnings/debt page. */
export function dataYearsSentence(v: DataVintage | null | undefined): string | null {
  const line = dataYearsLine(v);
  if (!line) return null;
  const rel = monthYearFromIso(v?.release_date);
  return `Data years (College Scorecard): ${line}.${rel ? ` The database holds the Scorecard release of ${rel}; that is when the files were published, not the year the figures describe.` : ""} ${PSEO_EARNINGS_DISCLAIMER}`;
}
