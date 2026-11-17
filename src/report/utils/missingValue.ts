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
  notPublishedScorecard: "not published by College Scorecard",
  notPublished: "not published",
} as const;

/** Methodology page "Missing figures" text; fetchedOn is the table's fetched_on (ISO date). */
export function missingFiguresMethodology(fetchedOn?: string | null): string {
  const d = fetchedOn ? new Date(fetchedOn) : null;
  const snapshot =
    d && !Number.isNaN(d.getTime())
      ? `; snapshot fetched on ${d.toISOString().slice(0, 10)}`
      : "";
  return `Net price, school-level earnings and federal-loan debt are built from students who received federal aid, so they are not published for schools that take no federal aid (status derived from Scorecard's Title IV eligibility type and Pell and first-year loan rates${snapshot}). Program earnings come from Census PSEO and are missing for a different reason.`;
}

/** Small box shown in a no-federal-aid school's net price / typical debt cell. */
export const NO_AID_BOX_TEXT =
  "Takes no federal student aid. Scorecard does not publish net price or federal-loan debt for it.";

/** Table-cell wording for a missing figure (capitalised). */
export const TABLE_NOT_PUBLISHED = "Not published";

export const TYPICAL_DEBT_FOOTNOTE =
  "Typical debt is shown only where College Scorecard publishes it. A school that takes no federal student aid has no federal-loan debt figure; that is not the same as zero debt. Net price is shown as 'Not published' where Scorecard has no figure.";

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
    line: `Figures published: net price ${np} of ${total}, program earnings ${pe} of ${total}, typical debt ${td} of ${total}.`,
  };
}

export interface EarningsContextInput {
  earnings_vintage?: number | string | null;
  earnings_year_1?: number | null;
  earnings_year_1_vintage?: number | null;
}

/** "10 years after graduation; 2016 cohort" — which point in time, and whose cohort. */
function earningsBasis(horizon: string, vintage: number | string | null | undefined): string {
  if (typeof vintage === "number" && Number.isFinite(vintage)) {
    return `${horizon}; ${vintage} cohort`;
  }
  if (typeof vintage === "string" && vintage) return `${horizon}; ${vintage}`;
  return horizon;
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
      parts.push({ text: ` (${earningsBasis("10 years after graduation", s.earnings_vintage)}); first year ` });
      const y1 = resolveFigure("program_earnings", s.earnings_year_1, null);
      if (y1.value != null) {
        parts.push({ text: y1.display, bold: true });
        if (s.earnings_year_1_vintage) parts.push({ text: ` (${s.earnings_year_1_vintage} cohort)` });
      } else {
        parts.push({ text: y1.display });
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
