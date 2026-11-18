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
function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

/**
 * Month the report's data was last checked: the newest Scorecard fetch date
 * across its schools (report_meta.data_checked_on, read from the *_fetched_on
 * columns). Never a month baked into a string, never the generation date —
 * null when no fetch date is recorded.
 */
export function latestDataMonth(
  payload: C1LitePayload,
): { month: number; year: number } | null {
  const v = payload.report_meta.data_checked_on;
  if (v === null || v === undefined || v === "") return null;
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T00:00:00Z` : v);
  if (Number.isNaN(d.getTime())) return null;
  return { month: d.getUTCMonth(), year: d.getUTCFullYear() };
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
  /** "November 2026", or null when no fetch date is recorded. */
  dataChecked: string | null;
  reportId: string;
  revision: number;
  methodVersion: string;
  schools: Array<{ name: string; location: string }>;
}

export function buildCoverModel(
  payload: C1LitePayload,
  reportId: string,
): CoverModel {
  const checked = latestDataMonth(payload);
  const monthName = checked ? titleCase(MONTHS[checked.month]) : null;
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
    banner:
      checked && monthName
        ? `INDEPENDENT REPORT · DATA CHECKED ${monthName.slice(0, 3).toUpperCase()} ${checked.year}`
        : "INDEPENDENT REPORT",
    countWord,
    headline: [
      `${countWord} ${n === 1 ? "school" : "schools"}.`,
      "The real numbers.",
    ],
    studentName: payload.student.display_name,
    cityState: parseCityState(payload.student.address),
    major: programs.length === 1 ? programs[0] : null,
    dataChecked: checked && monthName ? `${monthName} ${checked.year}` : null,
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
