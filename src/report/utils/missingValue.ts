/**
 * Missing-value handling for net price, program earnings and typical debt —
 * the single place that decides "value or reason" for each school.
 *
 * RULES
 *   - A value exists only when it is a finite number > 0. Null, undefined, NaN
 *     and 0 are MISSING (a typical debt of 0 means "not published", never zero
 *     debt).
 *   - Missing + federal_aid_status = 'no_federal_aid' + metric is net price or
 *     typical debt  → "takes no federal student aid".
 *   - Missing otherwise (unknown status, 'participates', or a non-aid metric)
 *     → "not published by College Scorecard".
 *   - Program earnings come from Census PSEO and do not depend on aid status,
 *     so their reason is always plain "not published".
 *
 * No ranges, no sorting, no ranking: callers keep the student's school order.
 */

export type FederalAidStatus = "no_federal_aid" | "participates";
export type FigureMetric = "net_price" | "program_earnings" | "typical_debt";

/** All reason strings live here. */
export const MISSING_REASONS = {
  noFederalAid: "takes no federal student aid",
  // One wording, one capitalisation, everywhere a missing figure is printed.
  notPublishedScorecard: "Not published",
  notPublished: "Not published",
} as const;

/** Methodology page "Missing figures" text; fetchedOn is the table's fetched_on (ISO date). */
export function missingFiguresMethodology(fetchedOn?: string | null): string {
  // fetchedOn is already a plain "YYYY-MM-DD" (school_federal_aid_status.fetched_on
  // via to_char); it is printed as stored, never re-parsed through a timezone.
  const snapshot =
    fetchedOn && /^\d{4}-\d{2}-\d{2}/.test(fetchedOn)
      ? `; snapshot fetched on ${fetchedOn.slice(0, 10)}`
      : "";
  return `Net price, school-level earnings and federal-loan debt (school-wide median federal debt of completers) are built from students who received federal aid, so they are not published for schools that take no federal aid (status derived from Scorecard's Title IV eligibility type and Pell and first-year loan rates${snapshot}). Program earnings come from Census PSEO and are missing for a different reason.`;
}

/** Small box shown in a no-federal-aid school's net price / typical debt cell. */
export const NO_AID_BOX_TEXT =
  "Takes no federal student aid. Scorecard does not publish net price or federal-loan debt for it.";

/** Table-cell wording for a missing figure (capitalised). */
export const TABLE_NOT_PUBLISHED = "Not published";

/** Wording for the program-level debt data limit (program_debt has no rows). */
export const SCHOOL_WIDE_DEBT_SCOPE =
  "This report shows school-wide debt. Program-level debt is not included.";

/**
 * Page-6 footnote. `noAidSchools` are the schools with status no_federal_aid;
 * they are named so the reader sees that federal-loan figures do not apply to them.
 */
export function typicalDebtFootnote(noAidSchools: string[] = []): string {
  const named = [...new Set(noAidSchools)];
  const noAid = named.length
    ? ` Federal-loan debt and net price do not apply to ${named.join(", ")}, which takes no federal student aid.`
    : "";
  return `School-wide median federal debt of completers is shown only where College Scorecard publishes it. A school that takes no federal student aid has no federal-loan debt figure; that is not the same as zero debt.${noAid} Net price is shown as 'Not published' where Scorecard has no figure. ${SCHOOL_WIDE_DEBT_SCOPE}`;
}

export interface Figure {
  /** The value when one exists, else null. */
  value: number | null;
  /** The reason string when the value is missing, else null. */
  reason: string | null;
  /** "$9,813" or the reason string, ready to print. */
  display: string;
}

export interface SchoolFigures {
  net_price: Figure;
  program_earnings: Figure;
  typical_debt: Figure;
}

/** Anything unrecognised (null, undefined, other text) is UNKNOWN → null. */
export function normalizeAidStatus(v: unknown): FederalAidStatus | null {
  return v === "no_federal_aid" || v === "participates" ? v : null;
}

function usd(v: number): string {
  return `$${Math.round(v).toLocaleString("en-US")}`;
}

export function resolveFigure(
  metric: FigureMetric,
  raw: number | null | undefined,
  status: FederalAidStatus | null | undefined,
): Figure {
  const n = raw == null ? NaN : Number(raw);
  if (Number.isFinite(n) && n > 0) {
    return { value: n, reason: null, display: usd(n) };
  }
  let reason: string = MISSING_REASONS.notPublishedScorecard;
  if (metric === "program_earnings") reason = MISSING_REASONS.notPublished;
  else if (status === "no_federal_aid") reason = MISSING_REASONS.noFederalAid;
  return { value: null, reason, display: reason };
}

export interface FigureInput {
  net_price_bracket: number | null;
  program_earnings: number | null;
  avg_debt: number | null;
  federal_aid_status?: string | null;
}

export function schoolFigures(s: FigureInput): SchoolFigures {
  const status = normalizeAidStatus(s.federal_aid_status);
  return {
    net_price: resolveFigure("net_price", s.net_price_bracket, status),
    program_earnings: resolveFigure("program_earnings", s.program_earnings, status),
    typical_debt: resolveFigure("typical_debt", s.avg_debt, status),
  };
}

export interface FigureCompleteness {
  total: number;
  net_price: number;
  program_earnings: number;
  typical_debt: number;
  line: string;
}

export function figureCompleteness(schools: FigureInput[]): FigureCompleteness {
  const total = schools.length;
  const figs = schools.map(schoolFigures);
  const count = (m: FigureMetric) => figs.filter((f) => f[m].value != null).length;
  const np = count("net_price");
  const pe = count("program_earnings");
  const td = count("typical_debt");
  return {
    total,
    net_price: np,
    program_earnings: pe,
    typical_debt: td,
    line: `Figures published: net price ${np} of ${total}, program earnings ${pe} of ${total}, school-wide debt ${td} of ${total}.`,
  };
}

export interface EarningsContextInput {
  earnings_vintage?: number | string | null;
  earnings_year_1?: number | null;
  earnings_year_1_vintage?: number | null;
  earnings_year_5?: number | null;
  earnings_latest_year_1?: number | null;
  earnings_latest_year_1_cohort?: number | null;
}

/** "2010 cohort" / "school-level average" / "cohort year not recorded". */
export function cohortText(vintage: number | string | null | undefined): string {
  if (typeof vintage === "number" && Number.isFinite(vintage)) return `${vintage} cohort`;
  if (typeof vintage === "string" && vintage) return vintage;
  return "cohort year not recorded";
}

export interface TextPart {
  text: string;
  /** True for a published value ($ amount); reasons are never bold. */
  bold?: boolean;
}

/**
 * One executive-summary row, school by school, as text parts so the page can
 * bold the values. Program earnings carry the Yr-10 horizon and cohort year,
 * plus the first-year figure beside it.
 */
export function figureRowParts(
  schools: Array<FigureInput & EarningsContextInput & { display_name: string }>,
  metric: FigureMetric,
): TextPart[][] {
  return schools.map((s) => {
    const f = schoolFigures(s)[metric];
    const parts: TextPart[] = [{ text: `${s.display_name} ` }];
    if (f.value == null) {
      parts.push({ text: f.display });
      return parts;
    }
    parts.push({ text: f.display, bold: true });
    if (metric === "program_earnings") {
      // One cohort row: year 10 (after graduation) with year 1 and year 5 of the SAME cohort.
      parts.push({ text: ` (year 10 after graduation; ${cohortText(s.earnings_vintage)})` });
      const path: Array<[string, Figure]> = [
        ["year 1", resolveFigure("program_earnings", s.earnings_year_1, null)],
        ["year 5", resolveFigure("program_earnings", s.earnings_year_5, null)],
      ];
      const shown = path.filter(([, f]) => f.value != null);
      shown.forEach(([label, f], i) => {
        parts.push({ text: `${i === 0 ? "; same cohort: " : ", "}${label} ` });
        parts.push({ text: f.display, bold: true });
      });
      // Newest year 1 is its own line and is only shown when it is another cohort.
      const ly = resolveFigure("program_earnings", s.earnings_latest_year_1, null);
      if (
        ly.value != null &&
        s.earnings_latest_year_1_cohort != null &&
        s.earnings_latest_year_1_cohort !== s.earnings_year_1_vintage
      ) {
        parts.push({ text: ". Newest year 1 on file (a different, newer cohort; not part of the path above): " });
        parts.push({ text: ly.display, bold: true });
        parts.push({ text: ` (${s.earnings_latest_year_1_cohort} cohort)` });
      }
    }
    return parts;
  });
}

/** Plain-text form of figureRowParts: "A $9,813 · B takes no federal student aid · C $5,965". */
export function figureRowText(
  schools: Array<FigureInput & EarningsContextInput & { display_name: string }>,
  metric: FigureMetric,
): string {
  return figureRowParts(schools, metric)
    .map((parts) => parts.map((p) => p.text).join(""))
    .join(" · ");
}

/** True when the school's status is 'no_federal_aid' (unknown is NOT). */
export function takesNoFederalAid(s: { federal_aid_status?: string | null }): boolean {
  return normalizeAidStatus(s.federal_aid_status) === "no_federal_aid";
}
