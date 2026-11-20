/**
 * Debt-to-income ratio — the single place the basis, the calculation, the
 * format and all of the explanatory wording live.
 *
 * WHAT IT IS
 *   school-wide median federal debt of completers ÷ the school's median
 *   earnings, shown as "X.XX : 1" (debt per $1 of earnings, two decimals). It
 *   describes the WHOLE SCHOOL (all programs and degree levels), not the
 *   program shown. Debt covers students who completed; the earnings cover all
 *   entrants who received federal aid. It is not a prediction, and this report
 *   never says a ratio is good or bad.
 *
 * WHERE EACH INPUT COMES FROM
 *   - Debt: public.earnings.median_debt_completers (College Scorecard field
 *     aid.median_debt.completers.overall, data year 2024 per
 *     scorecard_data_vintage). debt_income_ratio.avg_debt (undocumented April
 *     load, no source field) and the stored debt_income_ratio are NOT read.
 *   - School median earnings: public.earnings.<DEBT_RATIO_BASIS.column> for the
 *     same unitid (College Scorecard, field DEBT_RATIO_BASIS.apiField),
 *     refreshed on public.earnings.scorecard_api_fetched_on.
 *   - Nothing comes from the program-level Median Earnings (Yr 10) column.
 *
 * WHEN THERE IS NO RATIO (null → "cannot be calculated due to missing values")
 *   - median debt of completers is null or 0 (0 can mean no federal loans, not zero debt),
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

/** What the debt figure is, printed wherever it appears. */
export const DEBT_LABEL = "median federal debt of completers";
export const DEBT_LABEL_SCHOOL_WIDE = "School-wide median federal debt of completers";
/** Debt and Year-6 earnings cover different groups; always said next to the ratio. */
export const DEBT_VS_EARNINGS_NOTE =
  "Debt is for students who completed; Year-6 earnings cover all entrants who received federal aid.";

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
    `Debt-to-income ratio = school-wide ${DEBT_LABEL} ÷ school-wide median earnings ${DEBT_RATIO_BASIS.label} (College Scorecard). ${DEBT_VS_EARNINGS_NOTE} A ratio of 0.35 : 1 means debt is about 35% of one year of those earnings. Those earnings are shown in the ${schoolEarningsColumnLabel()} column.`,
    `It describes the whole school, all programs and degree levels together, not the program shown. It is not comparable to the program-level Median Earnings (Yr 10) column, which covers a different group and a different year.`,
    `No ratio is shown when debt is $0 or not reported, or when earnings are not published. $0 debt can mean the school's students take no federal loans, not that they owe nothing. A missing ratio is not a good or bad sign.`,
    `Based on past students. It is not a prediction of your own debt or earnings.`,
  ].join(" ");
}

/**
 * The debt-to-income definition, as short sentences. Rendered as ONE combined
 * methodology bullet and joined into the payload's
 * debt_income_ratio_definition, so the page and the AI read the same text.
 * `refreshed` is the date the school figures were last fetched from College
 * Scorecard (see debtRatioRefreshed).
 */
export function debtRatioDefinitions(refreshed: string): string[] {
  return [
    `The school-wide ${DEBT_LABEL} ÷ the school's median earnings ${DEBT_RATIO_BASIS.methodologyLabel} (College Scorecard; debt field aid.median_debt.completers.overall; earnings field ${DEBT_RATIO_BASIS.apiField}; data fetched ${refreshed}), rounded to 2 decimals and shown as "X.XX : 1" (debt per $1 of earnings). ${DEBT_VS_EARNINGS_NOTE}`,
    `It describes the whole school, not the program shown, and is not comparable to the program-level Median Earnings (Yr 10) from Census PSEO.`,
    `No ratio is shown when debt is $0 or not reported, or earnings are not published; $0 can mean no federal loans, not zero debt.`,
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
export function debtRatioMethodology(refreshed: string): string {
  return debtRatioDefinitionText(refreshed);
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
  // `avg_debt` is the row contract name the callers read; its value is the
  // Scorecard median debt of completers, not debt_income_ratio.avg_debt.
  return `SELECT e.median_debt_completers AS avg_debt, e.${col} AS basis_earnings,
                 to_char(e.scorecard_api_fetched_on, 'YYYY-MM-DD') AS fetched_on
            FROM earnings e
           WHERE e.unitid = $1 LIMIT 1`;
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
