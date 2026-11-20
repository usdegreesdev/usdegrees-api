/**
 * Shared normalizers for the Academic Preference Alignment Check.
 *
 * The frontend compares ONLY the normalized values produced here:
 *   - degree bucket   (certificate | associate | bachelor | master | doctorate)
 *   - CIP 2-digit family ("01".."61")
 *   - 2-letter state code
 * Every function is total: it never throws and returns null (or []) for
 * anything it cannot identify with confidence.
 */

// ── Degree ────────────────────────────────────────────────────────────────

export type DegreeBucket =
  | "certificate"
  | "associate"
  | "bachelor"
  | "master"
  | "doctorate";

/**
 * IPEDS credential_level code -> bucket. SINGLE source of truth for the
 * buckets (the frontend mirrors it).
 *   1,4,8 -> certificate   2 -> associate   3 -> bachelor
 *   5 -> master            6,7 -> doctorate
 */
const CREDENTIAL_LEVEL_BUCKET: Record<number, DegreeBucket> = {
  1: "certificate",
  2: "associate",
  3: "bachelor",
  4: "certificate",
  5: "master",
  6: "doctorate",
  7: "doctorate",
  8: "certificate",
};

/** Lower-cased, apostrophe-normalized text -> bucket (titles, legacy forms, bucket names). */
const TEXT_BUCKET: Record<string, DegreeBucket> = {
  // the 8 canonical titles (constants/degreeLevels.ts)
  "undergraduate certificate or diploma": "certificate",
  "associate's degree": "associate",
  "bachelor's degree": "bachelor",
  "post-baccalaureate certificate": "certificate",
  "master's degree": "master",
  "doctoral degree": "doctorate",
  "first professional degree": "doctorate",
  "graduate/professional certificate": "certificate",
  // legacy short forms
  "associate's": "associate",
  associates: "associate",
  "bachelor's": "bachelor",
  bachelors: "bachelor",
  "master's": "master",
  masters: "master",
  doctoral: "doctorate",
  // bucket names
  certificate: "certificate",
  associate: "associate",
  bachelor: "bachelor",
  master: "master",
  doctorate: "doctorate",
};

export function normalizeDegreeBucket(input: unknown): DegreeBucket | null {
  if (typeof input === "number") {
    return Number.isInteger(input) ? (CREDENTIAL_LEVEL_BUCKET[input] ?? null) : null;
  }
  if (typeof input !== "string") return null;
  const s = input.trim().toLowerCase().replace(/[‘’ʼ]/g, "'");
  if (!s) return null;
  if (/^\d+$/.test(s)) return CREDENTIAL_LEVEL_BUCKET[Number(s)] ?? null;
  return TEXT_BUCKET[s] ?? null;
}

// ── CIP ───────────────────────────────────────────────────────────────────

/**
 * programs.cip_code is stored undotted, 4 digits ("1002" = CIP 10.02). Also
 * accepts dotted forms ("01.0701", "1.0701") and 6-digit undotted ("010701").
 * Returns the dotted code as `cipCode` (series kept at 2 digits for the stored
 * 4-digit form, 4 digits for longer forms) and the zero-padded 2-digit family.
 */
export function parseCip(
  input: unknown,
): { cipCode: string; family: string } | null {
  if (typeof input !== "string" && typeof input !== "number") return null;
  const s = String(input).trim();
  if (!s) return null;

  if (s.includes(".")) {
    const [head, tail, ...extra] = s.split(".");
    if (extra.length || !/^\d{1,2}$/.test(head) || !/^\d{1,4}$/.test(tail)) {
      return null;
    }
    const family = head.padStart(2, "0");
    return { cipCode: `${family}.${tail}`, family };
  }

  if (!/^\d+$/.test(s)) return null;
  if (s.length === 4) {
    return { cipCode: `${s.slice(0, 2)}.${s.slice(2)}`, family: s.slice(0, 2) };
  }
  if (s.length === 6) {
    return { cipCode: `${s.slice(0, 2)}.${s.slice(2)}`, family: s.slice(0, 2) };
  }
  if (s.length <= 2) {
    const family = s.padStart(2, "0");
    return { cipCode: family, family };
  }
  return null;
}

/** Dotted CIP code ("10.02") for an undotted/dotted input, else null. */
export function normalizeCipCode(input: unknown): string | null {
  return parseCip(input)?.cipCode ?? null;
}

/** Zero-padded 2-digit CIP family ("01", "11") or null. */
export function cipFamily(input: unknown): string | null {
  return parseCip(input)?.family ?? null;
}

// ── State ─────────────────────────────────────────────────────────────────

/** 2-letter state code (upper-cased); null for anything else (e.g. 'state'). */
export function normalizeStateCode(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const s = input.trim();
  return /^[A-Za-z]{2}$/.test(s) ? s.toUpperCase() : null;
}

// ── Profile major labels -> CIP 2-digit families ──────────────────────────

/**
 * Labels offered by the profile's major picker (frontend
 * src/data/profileOptions.ts PROGRAM_OPTIONS) -> CIP 2020 2-digit families.
 * Reasons for every row are in docs/program-label-cip-map.md.
 */
export const PROGRAM_LABEL_CIP_FAMILIES: Record<string, string[]> = {
  "Accounting": ["52"],
  "Aerospace Engineering": ["14"],
  "Agriculture": ["01"],
  "Anthropology": ["45"],
  "Architecture": ["04"],
  "Automotive Technology": ["47"],
  "Aviation": ["49"],
  "Biochemistry": ["26"],
  "Biomedical Engineering": ["14"],
  "Biology": ["26"],
  "Biotechnology": ["26"],
  "Business Administration": ["52"],
  "Chemical Engineering": ["14"],
  "Chemistry": ["40"],
  "Civil Engineering": ["14"],
  "Communications": ["09"],
  "Computer Engineering": ["14"],
  "Computer Programming": ["11"],
  "Computer Science": ["11"],
  "Construction Management": ["52"],
  "Criminal Justice": ["43"],
  "Culinary": ["12"],
  "Data Analytics": ["11", "30", "52"],
  "Data Science": ["11", "30"],
  "Dentistry": ["51"],
  "Economics": ["45"],
  "Education": ["13"],
  "Electrical Engineering": ["14"],
  "Entrepreneurship": ["52"],
  "English": ["23"],
  "Environmental Science": ["03"],
  "Film": ["50"],
  "Finance": ["52"],
  "Fine Arts": ["50"],
  "Graphic Design": ["50"],
  "Healthcare Administration": ["51"],
  "History": ["54"],
  "Hospitality": ["52"],
  "Human Resources": ["52"],
  "Industrial Engineering": ["14"],
  "Information Technology": ["11"],
  "International Business": ["52"],
  "International Relations": ["45"],
  "Journalism": ["09"],
  "Languages and Linguistics": ["16"],
  "Liberal Arts": ["24"],
  "Management Information Systems": ["52"],
  "Marketing": ["52"],
  "Mathematics": ["27"],
  "Mechanical Engineering": ["14"],
  "Music": ["50"],
  "Neuroscience": ["26"],
  "Nursing": ["51"],
  "Nutrition": ["19", "30", "51"],
  "Pharmacy": ["51"],
  "Philosophy": ["38"],
  "Physical Therapy / Rehabilitation": ["51"],
  "Physics": ["40"],
  "Political Science": ["45"],
  "Psychology": ["42"],
  "Public Administration": ["44"],
  "Public Health": ["51"],
  "Public Policy": ["44"],
  "Public Relations": ["09"],
  "Real Estate": ["52"],
  "Social Work": ["44"],
  "Sociology": ["45"],
  "Special Education": ["13"],
  "Statistics": ["27"],
  "Teacher Education": ["13"],
  "Theatre": ["50"],
  "Veterinary": ["01", "51"],
};

const LABEL_LOOKUP: ReadonlyMap<string, string[]> = new Map(
  Object.entries(PROGRAM_LABEL_CIP_FAMILIES).map(([label, fams]) => [
    label.toLowerCase(),
    fams,
  ]),
);

/**
 * Saved major labels -> unique, sorted 2-digit families. Case-insensitive,
 * trimmed; unknown labels are dropped without error. No DB access.
 */
export function programLabelsToCipFamilies(labels: unknown): string[] {
  if (!Array.isArray(labels)) return [];
  const out = new Set<string>();
  for (const label of labels) {
    if (typeof label !== "string") continue;
    for (const fam of LABEL_LOOKUP.get(label.trim().toLowerCase()) ?? []) {
      out.add(fam);
    }
  }
  return [...out].sort();
}
