/**
 * satPositioning.ts — pure, deterministic SAT positioning (no DB, no AI).
 *
 * Every status, gap, sort and axis number in the report's "Test Score
 * Positioning" section is computed here from DB values. Gemini never
 * produces or rewrites any of it.
 *
 * Range source: admissions.school_min_range / school_max_range ONLY (sum of
 * the p25 / p75 section percentiles). The sat_rw_*, sat_math_*, sat_mid_*,
 * sat_avg_overall columns and the admissions_sat_ui view fabricate ranges
 * and are never read — see satPositioning.service.ts.
 */
import {
  SAT_AXIS,
  SAT_CATEGORY_KEYS,
  SAT_SCALE,
} from "../config/satPositioning.config";

// ---------------- types ----------------
export type SatStatus = "below" | "within" | "above";
export type SatState = "ok" | "no_student_score" | "no_college_data";

export interface SatBadge {
  label: string;
  color: string;
}

/** A row of admission_disclosure_categories (only the columns used here). */
export interface SatCategoryRow {
  category: string;
  badge_label: string;
  badge_color: string;
  supporting_copy: string;
  disclaimer_text: string | null;
  contact_guidance: string | null;
  show_badge_with_range: boolean;
}

export interface SatStudentInput {
  sat_score: number | null;
  sat_math: number | null;
  sat_reading_writing: number | null;
}

export interface SatCollegeInput {
  unitid: number;
  displayOrder: number;
  name: string;
  schoolUrl: string | null;
  schoolMinRange: number | null;
  schoolMaxRange: number | null;
  publishPublicly: boolean | null;
  /** The college's own category row (null when sat_disclosure_category is null/unknown). */
  category: SatCategoryRow | null;
}

export interface SatChartedRow {
  unitid: number;
  name: string;
  displayOrder: number;
  p25: number;
  p75: number;
  status: SatStatus;
  gapPoints: number | null;
  bandPosition: number | null;
  midpointDelta: number;
  badge: SatBadge | null;
}

export interface SatFallbackRow {
  unitid: number;
  name: string;
  displayOrder: number;
  badge: SatBadge;
  supportingCopy: string;
  disclaimerText: string | null;
  contactGuidance: string;
  websiteUrl: string | null;
}

export interface SatAxis {
  min: number;
  max: number;
  ticks: number[];
}

export interface SatPositioning {
  state: SatState;
  studentScore: number | null;
  /** Every unitid in the report (deduped, display order) — gate 3 compares this to usdreport_colleges. */
  collegeIds: number[];
  counts: { above: number; within: number; below: number; noData: number };
  charted: SatChartedRow[];
  fallback: SatFallbackRow[];
  axis: SatAxis | null;
}

export interface SatConfig {
  scale: { min: number; max: number; step: number };
  axis: { pad: number; tickStep: number };
  closedCategory: string;
}

export const DEFAULT_SAT_CONFIG: SatConfig = {
  scale: SAT_SCALE,
  axis: SAT_AXIS,
  closedCategory: SAT_CATEGORY_KEYS.closed,
};

// ---------------- student score ----------------
function isValidSat(v: unknown, cfg: SatConfig): v is number {
  return (
    typeof v === "number" &&
    Number.isInteger(v) &&
    v >= cfg.scale.min &&
    v <= cfg.scale.max &&
    v % cfg.scale.step === 0
  );
}

/**
 * sat_score if set; else sat_math + sat_reading_writing when both are set.
 * Returns null unless the result is a valid SAT composite. ACT is never
 * converted.
 */
export function resolveStudentScore(
  s: SatStudentInput,
  cfg: SatConfig = DEFAULT_SAT_CONFIG,
): number | null {
  const raw =
    s.sat_score != null
      ? Number(s.sat_score)
      : s.sat_math != null && s.sat_reading_writing != null
        ? Number(s.sat_math) + Number(s.sat_reading_writing)
        : null;
  return isValidSat(raw, cfg) ? raw : null;
}

// ---------------- college range ----------------
export function isValidRange(
  min: number | null,
  max: number | null,
  publishPublicly: boolean | null,
  cfg: SatConfig = DEFAULT_SAT_CONFIG,
): boolean {
  if (publishPublicly === false) return false;
  if (min == null || max == null) return false;
  const lo = Number(min);
  const hi = Number(max);
  return (
    Number.isFinite(lo) &&
    Number.isFinite(hi) &&
    lo >= cfg.scale.min &&
    lo < hi &&
    hi <= cfg.scale.max
  );
}

// ---------------- website URL ----------------
/**
 * Trim; add https:// when there is no scheme; keep only valid http(s) URLs
 * with a dotted host. Never invents a URL.
 */
export function normalizeWebsiteUrl(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const t = String(raw).trim();
  if (!t) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(t) ? t : `https://${t}`;
  try {
    const u = new URL(withScheme);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    if (!u.hostname.includes(".")) return null;
    if (u.username || u.password) return null; // e.g. "mailto:a@host" is not a site URL
    return u.href;
  } catch {
    return null;
  }
}

/** Display host for a normalized URL ("www." stripped). */
export function websiteHost(url: string): string {
  return new URL(url).hostname.replace(/^www\./i, "");
}

// ---------------- axis ----------------
export function computeAxis(
  studentScore: number,
  ranges: Array<{ p25: number; p75: number }>,
  cfg: SatConfig = DEFAULT_SAT_CONFIG,
): SatAxis {
  const { pad, tickStep } = cfg.axis;
  const lo = Math.min(studentScore, ...ranges.map((r) => r.p25));
  const hi = Math.max(studentScore, ...ranges.map((r) => r.p75));
  let min = Math.floor((lo - pad) / tickStep) * tickStep;
  let max = Math.ceil((hi + pad) / tickStep) * tickStep;
  min = Math.max(cfg.scale.min, min);
  max = Math.min(cfg.scale.max, max);
  const ticks: number[] = [];
  // First tick on the grid at/after min, so clamped edges still get ticks on
  // tickStep multiples; the axis ends themselves are always labelled.
  for (let t = Math.ceil(min / tickStep) * tickStep; t <= max; t += tickStep)
    ticks.push(t);
  if (ticks[0] !== min) ticks.unshift(min);
  if (ticks[ticks.length - 1] !== max) ticks.push(max);
  return { min, max, ticks };
}

// ---------------- builder ----------------
const toBadge = (c: SatCategoryRow): SatBadge => ({
  label: c.badge_label,
  color: c.badge_color,
});

export function buildSatPositioning(
  student: SatStudentInput,
  colleges: SatCollegeInput[],
  /** Row used when a college has no/unknown category (G_NO_SCORE_DATA). */
  defaultCategory: SatCategoryRow,
  cfg: SatConfig = DEFAULT_SAT_CONFIG,
): SatPositioning {
  // One entry per college (the same college can be compared under several
  // programs; SAT is school-level), in display order.
  const sorted = [...colleges].sort((a, b) => a.displayOrder - b.displayOrder);
  const seen = new Set<number>();
  const unique: SatCollegeInput[] = [];
  for (const c of sorted) {
    if (seen.has(c.unitid)) continue;
    seen.add(c.unitid);
    unique.push(c);
  }
  const collegeIds = unique.map((c) => c.unitid);
  const studentScore = resolveStudentScore(student, cfg);

  if (studentScore == null) {
    return {
      state: "no_student_score",
      studentScore: null,
      collegeIds,
      counts: { above: 0, within: 0, below: 0, noData: 0 },
      charted: [],
      fallback: [],
      axis: null,
    };
  }

  const charted: SatChartedRow[] = [];
  const fallback: SatFallbackRow[] = [];

  for (const c of unique) {
    const closed = c.category?.category === cfg.closedCategory;
    const suppressed = c.publishPublicly === false;
    const rangeOk =
      !closed &&
      isValidRange(c.schoolMinRange, c.schoolMaxRange, c.publishPublicly, cfg);

    if (rangeOk) {
      const p25 = Number(c.schoolMinRange);
      const p75 = Number(c.schoolMaxRange);
      const status: SatStatus =
        studentScore < p25 ? "below" : studentScore > p75 ? "above" : "within";
      charted.push({
        unitid: c.unitid,
        name: c.name,
        displayOrder: c.displayOrder,
        p25,
        p75,
        status,
        gapPoints:
          status === "below"
            ? p25 - studentScore
            : status === "above"
              ? studentScore - p75
              : null,
        bandPosition:
          status === "within"
            ? Math.round(((studentScore - p25) / (p75 - p25)) * 100)
            : null,
        midpointDelta: studentScore - (p25 + p75) / 2,
        badge:
          c.category && c.category.show_badge_with_range
            ? toBadge(c.category)
            : null,
      });
      continue;
    }

    const cat = c.category ?? defaultCategory;
    fallback.push({
      unitid: c.unitid,
      name: c.name,
      displayOrder: c.displayOrder,
      badge: toBadge(cat),
      supportingCopy: cat.supporting_copy,
      disclaimerText: cat.disclaimer_text ?? null,
      contactGuidance: cat.contact_guidance ?? defaultCategory.contact_guidance ?? "",
      websiteUrl: closed || suppressed ? null : normalizeWebsiteUrl(c.schoolUrl),
    });
  }

  // Strongest fit (score well above the band) → biggest stretch; ties keep
  // display order.
  charted.sort(
    (a, b) => b.midpointDelta - a.midpointDelta || a.displayOrder - b.displayOrder,
  );

  const counts = {
    above: charted.filter((r) => r.status === "above").length,
    within: charted.filter((r) => r.status === "within").length,
    below: charted.filter((r) => r.status === "below").length,
    noData: fallback.length,
  };

  return {
    state: charted.length > 0 ? "ok" : "no_college_data",
    studentScore,
    collegeIds,
    counts,
    charted,
    fallback,
    axis: charted.length > 0 ? computeAxis(studentScore, charted, cfg) : null,
  };
}
