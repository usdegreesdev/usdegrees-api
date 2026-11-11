import type { C1LitePayload } from "../services/reportPrompt";

/**
 * View-model + pre-send checks for the report Cover. Every dynamic field on the
 * cover is derived here from the payload (never typed by hand), and
 * `validateCoverText` is the automatic gate run before a report is rendered.
 */

export const REPORT_REVISION = 1; // matches the "Rev 1" in PageChrome

/** Fixed cover copy. Wording is specified by the brand sheet — do not edit. */
export const COVER_COPY = {
  kicker: "COLLEGE DECISION REPORT",
  tagline: "NO SCHOOL PAYS US. EVER.",
  website: "www.usdegrees.com",
  description:
    "We compare net price, admissions, earnings after graduation, and typical debt for the schools you chose. We do not rank or recommend a school.",
  lenderLine: "No lender or loan company pays us either.",
  schoolsLabel: "SCHOOLS COMPARED",
  schoolsNote: "Shown in the order you entered them. Not a ranking.",
  sourceLine: "Built on public data from the U.S. Department of Education.",
  confidential: "CONFIDENTIAL",
  footerTagline: "We show the numbers. You make the choice.",
  dataCheckedNote: "Prices change yearly. We update when they do.",
} as const;

const NUMBER_WORDS = [
  "Zero",
  "One",
  "Two",
  "Three",
  "Four",
  "Five",
  "Six",
  "Seven",
  "Eight",
  "Nine",
  "Ten",
  "Eleven",
  "Twelve",
];

export function schoolCountWord(n: number): string {
  return NUMBER_WORDS[n] ?? String(n);
}

const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];
const MONTH_RE = new RegExp(`\\b(${MONTHS.join("|")})\\s+(\\d{4})\\b`, "i");

function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

/**
 * Latest dated data publication named anywhere in the report ("College
 * Scorecard, October 2026 update"). Falls back to the report's generation
 * date, since the data is read live when the report is built.
 */
export function latestDataMonth(payload: C1LitePayload): {
  month: number;
  year: number;
} {
  let best: { month: number; year: number } | null = null;
  const consider = (text: unknown) => {
    if (typeof text !== "string") return;
    const m = MONTH_RE.exec(text);
    if (!m) return;
    const cand = {
      month: MONTHS.indexOf(m[1].toLowerCase()),
      year: Number(m[2]),
    };
    if (
      !best ||
      cand.year > best.year ||
      (cand.year === best.year && cand.month > best.month)
    ) {
      best = cand;
    }
  };
  for (const s of payload.schools) {
    [
      s.net_price_vintage,
      s.admit_rate_vintage,
      s.sat_vintage,
      s.sticker_vintage,
      s.debt_vintage,
      s.earnings_vintage,
    ].forEach(consider);
  }
  if (best) return best;
  const d = new Date(payload.report_meta.generated_date);
  const fallback = isNaN(d.getTime()) ? new Date() : d;
  return { month: fallback.getMonth(), year: fallback.getFullYear() };
}

/** "Orlando, FL" from a free-text address ("..., Orlando, FL 32801"), else null. */
export function parseCityState(address: string | null): string | null {
  if (!address) return null;
  const m = /([A-Za-z.' -]+),\s*([A-Z]{2})(?:\s+\d{5}(?:-\d{4})?)?\s*$/.exec(
    address.trim(),
  );
  return m ? `${m[1].trim()}, ${m[2]}` : null;
}

function collegeType(sector: string): "Public" | "Private" | null {
  if (/^public/i.test(sector)) return "Public";
  if (/^private/i.test(sector)) return "Private";
  return null;
}

export interface CoverModel {
  banner: string;
  countWord: string;
  headline: [string, string];
  studentName: string;
  cityState: string | null;
  major: string | null;
  dataChecked: string;
  reportId: string;
  revision: number;
  methodVersion: string;
  schools: Array<{ name: string; location: string }>;
}

export function buildCoverModel(
  payload: C1LitePayload,
  reportId: string,
): CoverModel {
  const { month, year } = latestDataMonth(payload);
  const monthName = titleCase(MONTHS[month]);
  const n = payload.schools.length;
  const countWord = schoolCountWord(n);

  const programs = Array.from(
    new Set(
      payload.schools
        .map((s) => s.program_name)
        .filter((p): p is string => !!p),
    ),
  );

  const v = /(\d+)\s*$/.exec(payload.report_meta.methodology_version ?? "");

  return {
    banner: `INDEPENDENT REPORT`,
    countWord,
    headline: [
      `${countWord} ${n === 1 ? "school" : "schools"}.`,
      "The real numbers.",
    ],
    studentName: payload.student.display_name,
    cityState: parseCityState(payload.student.address),
    major: programs.length === 1 ? programs[0] : null,
    dataChecked: `${monthName} ${year}`,
    reportId,
    revision: REPORT_REVISION,
    methodVersion: v ? `v${v[1]}` : payload.report_meta.methodology_version,
    schools: payload.schools.map((s) => {
      const type = collegeType(s.sector);
      return {
        name: s.name,
        location: [`${s.city}, ${s.state}`, type].filter(Boolean).join(" · "),
      };
    }),
  };
}

/**
 * Automatic pre-send checks. `text` is the cover's rendered visible text.
 * Returns a list of problems; empty means the cover may ship.
 */
export function validateCoverText(model: CoverModel, text: string): string[] {
  const errors: string[] = [];
  const n = model.schools.length;
  if (n < 1) errors.push("cover has no schools");
  if (model.headline[0].split(" ")[0] !== schoolCountWord(n)) {
    errors.push(`headline number word does not match ${n} school cards`);
  }
  if (/[\[\]{}]/.test(text))
    errors.push("cover contains brackets/braces (leftover placeholder)");
  if (/\b(undefined|null|NaN|TBD|TODO|CONFIRM)\b/.test(text)) {
    errors.push(
      "cover contains a placeholder word (undefined/null/NaN/TBD/CONFIRM)",
    );
  }
  if (!model.studentName.trim()) errors.push("student name is empty");
  if (!model.reportId.trim()) errors.push("report id is empty");
  const sites = text.match(/www\.usdegrees\.com/gi) ?? [];
  if (sites.length !== 1)
    errors.push(
      `website appears ${sites.length} times on the cover (must be 1)`,
    );
  for (const s of model.schools) {
    if (!s.name.trim()) errors.push("a school card has no name");
  }
  return errors;
}
