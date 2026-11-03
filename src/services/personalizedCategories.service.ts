/**
 * personalizedCategories.service.ts
 *
 * Layers the Match Preferences Board (preferred_states, preferred_majors aka
 * usdusers_preferred_programs, preferred_college_type, target_degree_level)
 * on top of the diversified "Popular Categories" ranking from
 * popularCategories.service.ts, with partial-field matching and a 2-tier
 * cold-start fallback cascade back to the Step 1 default.
 */
import crypto from "crypto";
import CREDENTIAL_LEVELS from "../constants/credentials";
import { normalizeDegreeLevel } from "../constants/degreeLevels";
import { getSlotAllocation } from "../constants/homepageCategorySlots";
import {
  CategoryPopularityRow,
  PopularCategory,
  selectPopularCategories,
} from "./popularCategories.service";

export interface UserPreferences {
  targetDegreeLevel: number | null; // credential_level id
  preferredCollegeType: string | null; // e.g. "Public" | "Private"
  preferredStates: string[]; // state codes
  preferredMajors: string[]; // usdusers_preferred_programs.program values
}

export const EMPTY_PREFERENCES: UserPreferences = {
  targetDegreeLevel: null,
  preferredCollegeType: null,
  preferredStates: [],
  preferredMajors: [],
};

const PROGRAM_SEARCH_TERMS: Record<string, string> = {
  "Electrical Engineering": "Electrical, Electronics",
  "Biomedical Engineering": "Biomedical/Medical Engineering",
  "Aerospace Engineering": "Aerospace",
  "Healthcare Administration": "Health and Medical Administrative",
  "Physical Therapy / Rehabilitation": "Rehabilitation and Therapeutic",
  Education: "Education, General",
  English: "English Language",
  Communications: "Communication and Media",
  "Fine Arts": "Fine and Studio Arts",
  "Graphic Design": "Design and Applied Arts",
  Theatre: "Drama",
  "Languages and Linguistics": "Linguistic",
  Entrepreneurship: "Entrepreneurial",
  "Environmental Science": "Natural Resources",
  Aviation: "Air Transportation",
  "Automotive Technology": "Vehicle Maintenance",
};

export function getProgramSearchTerm(label: string): string {
  return PROGRAM_SEARCH_TERMS[label] ?? label;
}

/** Maps usdusers.preferred_degree_level (canonical name) -> credential_level id. */
export function degreeLevelNameToCredentialId(name: unknown): number | null {
  const canonical = normalizeDegreeLevel(name);
  if (!canonical) return null;
  return CREDENTIAL_LEVELS.find((c) => c.name === canonical)?.id ?? null;
}

/** True when at least one of the 4 Match Preferences Board fields is set. */
export function hasAnyPreference(prefs: UserPreferences): boolean {
  return (
    prefs.targetDegreeLevel != null ||
    prefs.preferredCollegeType != null ||
    prefs.preferredStates.length > 0 ||
    prefs.preferredMajors.length > 0
  );
}

/**
 * Builds the filtered category-popularity query. Each of the 4 preference
 * fields is applied independently — no all-or-nothing gate — so any subset
 * (including none) produces a valid query. `applyStates: false` is what the
 * cold-start cascade uses to drop the preferred_states constraint while
 * keeping degree_level/college_type/majors fixed.
 */
export function buildPersonalizedCategoryQuery(
  prefs: UserPreferences,
  opts: { applyStates: boolean },
): { sql: string; params: unknown[] } {
  const conditions: string[] = [
    "p.credential_level IS NOT NULL",
    "p.cip_code IS NOT NULL",
  ];
  const params: unknown[] = [];

  if (prefs.targetDegreeLevel != null) {
    params.push(prefs.targetDegreeLevel);
    conditions.push(`p.credential_level = $${params.length}`);
  }
  if (prefs.preferredCollegeType) {
    // programs.school_type values are "Public" | "Private, nonprofit" |
    // "Private, for-profit" — a prefix match against the "Public"/"Private"
    // preference stored on usdusers covers both Private variants. No id
    // mapping needed here (unlike credential_level): both sides are strings
    // and the preference value is always a prefix of the stored value.
    params.push(`${prefs.preferredCollegeType}%`);
    conditions.push(`p.school_type ILIKE $${params.length}`);
  }
  if (opts.applyStates && prefs.preferredStates.length > 0) {
    params.push(prefs.preferredStates);
    conditions.push(`s.state = ANY($${params.length}::text[])`);
  }
  if (prefs.preferredMajors.length > 0) {
    params.push(
      prefs.preferredMajors.map((major) => `%${getProgramSearchTerm(major)}%`),
    );
    conditions.push(`p.title ILIKE ANY($${params.length}::text[])`);
  }

  const sql = `
    WITH ranked AS (
      SELECT
        p.credential_level,
        p.cip_code,
        MIN(p.title) AS category_name,
        COUNT(DISTINCT p.unitid) AS popularity_score
      FROM programs p
      JOIN schools s ON s.unitid = p.unitid
      WHERE ${conditions.join(" AND ")}
      GROUP BY p.credential_level, p.cip_code
    )
    SELECT
      credential_level,
      cip_code AS category_id,
      category_name,
      popularity_score,
      ROW_NUMBER() OVER (
        PARTITION BY credential_level
        ORDER BY popularity_score DESC, category_name ASC
      ) AS level_rank
    FROM ranked
    ORDER BY credential_level ASC, level_rank ASC
  `;

  return { sql, params };
}

/** Order-independent, config-keyed cache key for a preference combination. */
export function buildPreferenceCacheKey(prefs: UserPreferences): string {
  const canonical = JSON.stringify({
    targetDegreeLevel: prefs.targetDegreeLevel ?? null,
    preferredCollegeType: prefs.preferredCollegeType ?? null,
    preferredStates: [...prefs.preferredStates].sort(),
    preferredMajors: [...prefs.preferredMajors].sort(),
  });
  return crypto.createHash("sha256").update(canonical).digest("hex");
}

/** Below (or at) this many matched categories, the cascade drops down a tier. */
export const COLD_START_THRESHOLD = 10;

export type CategorySource =
  | "personalized"
  | "personalized_state_relaxed"
  | "default_biased"
  | "default";

export type FallbackTier = "state_relaxed" | "default_biased";

export interface CascadeResult {
  source: CategorySource;
  categories: PopularCategory[];
}

export interface CascadeDeps {
  /** Runs the personalized query; applyStates=false drops the states constraint. */
  fetchFiltered: (
    prefs: UserPreferences,
    applyStates: boolean,
  ) => Promise<CategoryPopularityRow[]>;
  /** Runs the unfiltered Step 1 ranked dataset (all credential levels). */
  fetchDefault: () => Promise<CategoryPopularityRow[]>;
  /** Called once per cold-start tier triggered — hook for fallback-frequency metrics. */
  onFallback?: (tier: FallbackTier, prefs: UserPreferences) => void;
}

/**
 * The 3-tier fallback cascade (Match Preferences requirements 4-5):
 *   1. Filtered-by-all-populated-fields query.
 *   2. If <= COLD_START_THRESHOLD results AND a state preference was applied,
 *      drop preferred_states only and re-run (degree_level/college_type/majors fixed).
 *   3. If still <= COLD_START_THRESHOLD, fall back to the Step 1 default
 *      dataset, biased toward target_degree_level via getSlotAllocation.
 */
export async function resolvePersonalizedCategories(
  prefs: UserPreferences,
  deps: CascadeDeps,
): Promise<CascadeResult> {
  const slotConfig = getSlotAllocation(prefs.targetDegreeLevel);

  const primaryRows = await deps.fetchFiltered(prefs, true);
  if (primaryRows.length > COLD_START_THRESHOLD) {
    return {
      source: "personalized",
      categories: selectPopularCategories(primaryRows, slotConfig),
    };
  }

  if (prefs.preferredStates.length > 0) {
    deps.onFallback?.("state_relaxed", prefs);
    const relaxedRows = await deps.fetchFiltered(prefs, false);
    if (relaxedRows.length > COLD_START_THRESHOLD) {
      return {
        source: "personalized_state_relaxed",
        categories: selectPopularCategories(relaxedRows, slotConfig),
      };
    }
  }

  deps.onFallback?.("default_biased", prefs);
  const defaultRows = await deps.fetchDefault();
  return {
    source: "default_biased",
    categories: selectPopularCategories(defaultRows, slotConfig),
  };
}

/** In-memory fallback-frequency counters (per-process metric, not persisted). */
export const fallbackCounters: Record<FallbackTier, number> = {
  state_relaxed: 0,
  default_biased: 0,
};

/** Default onFallback hook: bumps the counter and logs the trigger. */
export function recordFallback(tier: FallbackTier, prefs: UserPreferences): void {
  fallbackCounters[tier] += 1;
  console.info("[popular-categories] cold-start fallback triggered", {
    tier,
    targetDegreeLevel: prefs.targetDegreeLevel,
    preferredCollegeType: prefs.preferredCollegeType,
    preferredStatesCount: prefs.preferredStates.length,
    preferredMajorsCount: prefs.preferredMajors.length,
  });
}

/** Test-only helper: resets the in-memory fallback counters. */
export function resetFallbackCounters(): void {
  fallbackCounters.state_relaxed = 0;
  fallbackCounters.default_biased = 0;
}
