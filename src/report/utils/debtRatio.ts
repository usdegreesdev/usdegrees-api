/**
 * Debt-to-income ratio — the single place the basis, the calculation, the
 * format and all of the explanatory wording live.
 *
 * WHAT IT IS
 *   typical debt ÷ the school's median earnings, shown as "X.XX : 1" (debt per
 *   $1 of earnings, two decimals). It describes the WHOLE SCHOOL (all programs
 *   and degree levels), not the program shown, and it is based on past
 *   students who received federal aid. It is not a prediction, and this report
 *   never says a ratio is good or bad.
 *
 * WHERE EACH INPUT COMES FROM
 *   - Typical debt: public.debt_income_ratio.avg_debt for the school's unitid
 *     (the same value printed in the "Typical Debt" column).
 *   - School median earnings: public.earnings.<DEBT_RATIO_BASIS.column> for the
 *     same unitid (College Scorecard, field DEBT_RATIO_BASIS.apiField),
 *     refreshed on public.earnings.scorecard_api_fetched_on.
 *   - The table's precomputed ratio columns are not used, and nothing comes
 *     from the program-level Median Earnings (Yr 10) column.
 *
 * WHEN THERE IS NO RATIO (null → "cannot be calculated due to missing values")
 *   - typical debt is null or 0 (0 can mean no federal loans, not zero debt),
 *   - earnings are null or 0 / not published,
 *   - or the rounded result would print as 0.00.
 *
 * HOW TO SWITCH THE EARNINGS POINT (e.g. to 10 years)
 *   Edit DEBT_RATIO_BASIS only (column, apiField, label, methodologyLabel).
 *   The SQL, table disclaimer, methodology block, payload definition and AI
 *   prompt all read from it at call time. Do not hardcode the timing anywhere
 *   else.
 */
export const DEBT_RATIO_BASIS = {
  /** public.earnings column the ratio's earnings come from. */
  column: "earn_6yr_after_entry_median",
  /** College Scorecard API field that column is loaded from. */
  apiField: "latest.earnings.6_yrs_after_entry.median",
  /** Short tag used in the table column header, e.g. "Yr 6". */
  shortLabel: "Yr 6",
  /** Phrase used in the table note and the AI prompt. */
  label: "6 years after first enrolling",
  /** Phrase used in the methodology page. */
  methodologyLabel: "6 years after students first enrolled",
};

export const MISSING_RATIO_TEXT = "cannot be calculated due to missing values";

/** Column header for the school-level earnings the ratio is divided by. */
export function schoolEarningsColumnLabel(): string {
  return `Median Earnings (${DEBT_RATIO_BASIS.shortLabel})`;
}

/**
 * Small-print disclaimer under the Program Earnings & Typical Debt table.
 * The 0.35 in the first sentence is a fixed illustration, not a school's ratio.
 */
export function debtRatioDisclaimer(): string {
  return [
    `Debt-to-income ratio = typical debt ÷ school-wide median earnings ${DEBT_RATIO_BASIS.label} (College Scorecard, students who received federal aid). A ratio of 0.35 : 1 means typical debt is about 35% of one year of those earnings. Those earnings are shown in the ${schoolEarningsColumnLabel()} column.`,
    `It describes the whole school, all programs and degree levels together, not the program shown. It is not comparable to the program-level Median Earnings (Yr 10) column, which covers a different group and a different year.`,
    `No ratio is shown when typical debt is $0 or not reported, or when earnings are not published. $0 debt can mean the school's students take no federal loans, not that they owe nothing. A missing ratio is not a good or bad sign.`,
    `Based on past graduates. It is not a prediction of your own debt or earnings.`,
  ].join(" ");
}

/**
 * "How to read the debt-to-income figures" — one line per entry. `refreshed`
 * is the date the school earnings were last fetched from College Scorecard
 * (see debtRatioRefreshed).
 */
export function debtRatioDefinitions(refreshed: string): string[] {
  return [
    `Typical debt: the school-wide typical debt shown in the table, from the College Scorecard data we hold. $0 or blank means no figure or no federal loan debt, not proven zero debt.`,
    `School median earnings: median annual earnings of former students who received federal financial aid, measured ${DEBT_RATIO_BASIS.label}, covering the whole school. Source: College Scorecard, field ${DEBT_RATIO_BASIS.apiField}, refreshed ${refreshed}.`,
    `Ratio: typical debt ÷ school median earnings, rounded to 2 decimals, shown as "X.XX : 1" (debt per $1 of earnings).`,
    `Program column, Median Earnings (Yr 10): the program's earnings 10 years after completion for one graduating group, from Census PSEO. Different group, timing and level than the ratio.`,
    `When no ratio is shown: debt $0 or not reported, or school earnings not published.`,
  ];
}

/** The same definitions as one plain-text paragraph (payload / AI context). */
export function debtRatioDefinitionText(refreshed: string): string {
  return debtRatioDefinitions(refreshed).join(" ");
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June", "July",
  "August", "September", "October", "November", "December",
];

function monthYear(d: Date): string {
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** "October 2026" from a Date / ISO string, or null when unusable. */
export function formatFetchedOn(v: unknown): string | null {
  if (v == null || v === "") return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : monthYear(d);
}

/**
 * Refresh date shown in the definitions: the latest per-school
 * scorecard_api_fetched_on in the payload; if none is present, the report's
 * own "data last checked" month (from its generated date).
 */
export function debtRatioRefreshed(
  schools: Array<{ debt_income_earnings_fetched_on?: string | null }>,
  generatedDate: string,
): string {
  const times = schools
    .map((s) => (s.debt_income_earnings_fetched_on ? new Date(s.debt_income_earnings_fetched_on).getTime() : NaN))
    .filter((t) => !Number.isNaN(t));
  if (times.length) return monthYear(new Date(Math.max(...times)));
  return formatFetchedOn(generatedDate) ?? monthYear(new Date());
}

/** Methodology-page text (after the bold "Debt-to-Income Ratio:" label). */
export function debtRatioMethodology(): string {
  return `the school's typical debt divided by the school's median earnings ${DEBT_RATIO_BASIS.methodologyLabel}, as published in College Scorecard data (students who received federal aid). It is calculated by this report from those two published figures and describes the whole school, not the specific program. Schools with no federal loan debt or no published earnings show no ratio.`;
}

/**
 * The ONLY place the ratio is calculated. Null when debt or earnings is
 * missing, zero or negative (a debt of 0 means no federal loans, not zero
 * debt), or when the rounded result would print as 0.00.
 */
export function computeDebtIncomeRatio(
  avgDebt: number | null | undefined,
  earnings: number | null | undefined,
): number | null {
  if (avgDebt == null || earnings == null) return null;
  if (!Number.isFinite(avgDebt) || !Number.isFinite(earnings)) return null;
  if (avgDebt <= 0 || earnings <= 0) return null;
  const ratio = Math.round((avgDebt / earnings) * 100) / 100;
  return ratio > 0 ? ratio : null;
}

/** "0.35 : 1", or the missing-values text for a null / non-positive ratio. */
export function formatDebtIncomeRatio(ratio: number | null | undefined): string {
  return ratio != null && Number.isFinite(ratio) && ratio > 0
    ? `${ratio.toFixed(2)} : 1`
    : MISSING_RATIO_TEXT;
}

/** The two-decimal numeral ("0.35") for narrative tracing, or null. */
export function ratioNumeral(ratio: number | null | undefined): string | null {
  return ratio != null && Number.isFinite(ratio) && ratio > 0
    ? ratio.toFixed(2)
    : null;
}

/** SQL for the one configured earnings column (name is validated, never user input). */
export function debtRatioQuery(): string {
  const col = DEBT_RATIO_BASIS.column;
  if (!/^earn_[a-z0-9_]+$/.test(col)) {
    throw new Error(`Invalid debt-ratio earnings column: ${col}`);
  }
  return `SELECT d.avg_debt, e.${col} AS basis_earnings,
                 e.scorecard_api_fetched_on AS fetched_on
            FROM debt_income_ratio d
            LEFT JOIN earnings e ON e.unitid = d.unitid
           WHERE d.unitid = $1 LIMIT 1`;
}

/** Row from debtRatioQuery → typical debt, basis earnings and the ratio. */
export function resolveDebt(
  row: { avg_debt?: unknown; basis_earnings?: unknown; fetched_on?: unknown } | undefined,
): {
  avg_debt: number | null;
  earnings: number | null;
  ratio: number | null;
  fetched_on: string | null;
} {
  const num = (v: unknown): number | null =>
    v != null && Number.isFinite(Number(v)) ? Number(v) : null;
  const debt = num(row?.avg_debt);
  const earnings = num(row?.basis_earnings);
  return {
    avg_debt: debt != null ? Math.round(debt) : null,
    earnings,
    ratio: computeDebtIncomeRatio(debt, earnings),
    fetched_on:
      row?.fetched_on instanceof Date
        ? row.fetched_on.toISOString().slice(0, 10)
        : row?.fetched_on != null
          ? String(row.fetched_on)
          : null,
  };
}
