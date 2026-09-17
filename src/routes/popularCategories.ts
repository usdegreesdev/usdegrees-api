/**
 * popularCategories.ts
 * Express Router: GET /popular-categories
 *
 * Credential-level diversified "Popular Categories" — the anonymous-user
 * default and the fallback layer personalization degrades to. Ranking is
 * ROW_NUMBER() OVER (PARTITION BY credential_level ORDER BY popularity_score
 * DESC), slot counts come from src/constants/homepageCategorySlots.ts, and
 * sparse levels are backfilled from the next-highest-ranked categories
 * across all levels. See src/services/popularCategories.service.ts.
 *
 * Query params:
 *  - target_degree_level: Optional positive integer credential_level. When
 *    present, that level's slot allocation is doubled ("biased" mode).
 *
 * Response is cached per (slot config, target_degree_level) combination —
 * not per user — since the result is identical for every caller sharing
 * that config.
 */
import { Router, Request, Response } from "express";
import jwt from "jsonwebtoken";
import pool from "../db/client";
import { JWT_SECRET } from "../config/jwt";
import { getSlotAllocation, DEFAULT_CATEGORY_SLOTS } from "../constants/homepageCategorySlots";
import {
  CATEGORY_POPULARITY_QUERY,
  CategoryPopularityRow,
  PopularCategory,
  selectPopularCategories,
} from "../services/popularCategories.service";
import {
  UserPreferences,
  buildPersonalizedCategoryQuery,
  buildPreferenceCacheKey,
  degreeLevelNameToCredentialId,
  hasAnyPreference,
  recordFallback,
  resolvePersonalizedCategories,
  CategorySource,
} from "../services/personalizedCategories.service";
import { SimpleCache } from "../utils/simpleCache";
import { errorDetails } from "../utils/errors";

const router = Router();

const CACHE_TTL_MS = 15 * 60 * 1000;
const cache = new SimpleCache<PopularCategory[]>(CACHE_TTL_MS);
const personalizedCache = new SimpleCache<{
  source: CategorySource;
  categories: PopularCategory[];
}>(CACHE_TTL_MS);

interface ApiError {
  error: string;
  details?: string;
}

function cacheKey(targetDegreeLevel: number | null): string {
  return JSON.stringify({ slots: DEFAULT_CATEGORY_SLOTS, targetDegreeLevel });
}

/** The Step 1 default ranked/diversified dataset, optionally biased. */
async function fetchDefaultCategories(
  targetDegreeLevel: number | null,
): Promise<PopularCategory[]> {
  const key = cacheKey(targetDegreeLevel);
  const cached = cache.get(key);
  if (cached) return cached;

  const { rows } = await pool.query<CategoryPopularityRow>(
    CATEGORY_POPULARITY_QUERY,
  );
  const categories = selectPopularCategories(
    rows,
    getSlotAllocation(targetDegreeLevel),
  );
  cache.set(key, categories);
  return categories;
}

const SECRET = JWT_SECRET;

/**
 * Best-effort auth resolution: unlike verifyToken, an absent/invalid token
 * means "treat as unauthenticated" (Match Preferences requirement 1), not a
 * 401 — this endpoint serves both anonymous and signed-in callers.
 */
async function tryResolveUserId(req: Request): Promise<number | null> {
  const authHeader = req.headers["authorization"];
  if (!authHeader || !authHeader.startsWith("Bearer ")) return null;

  try {
    const payload = jwt.verify(authHeader.split(" ")[1], SECRET, {
      algorithms: ["HS256"],
    }) as {
      sub?: string;
    };
    if (!payload.sub) return null;

    const result = await pool.query<{ id: number; is_active: boolean }>(
      "SELECT id, is_active FROM usdusers WHERE firebase_uid = $1",
      [payload.sub],
    );
    if (result.rows.length === 0 || result.rows[0].is_active === false) {
      return null;
    }
    return result.rows[0].id;
  } catch {
    return null;
  }
}

interface PreferenceRow {
  preferred_degree_level: string | null;
  preferred_college_type: string | null;
  preferred_states: string[] | null;
  preferred_majors: string[] | null;
}

async function fetchUserPreferences(userId: number): Promise<UserPreferences> {
  const { rows } = await pool.query<PreferenceRow>(
    `SELECT
        u.preferred_degree_level,
        u.preferred_college_type,
        COALESCE(
          (SELECT array_agg(s.state_code) FROM usdusers_preferred_states s WHERE s.user_id = u.id),
          ARRAY[]::text[]
        ) AS preferred_states,
        COALESCE(
          (SELECT array_agg(p.program) FROM usdusers_preferred_programs p WHERE p.user_id = u.id),
          ARRAY[]::text[]
        ) AS preferred_majors
      FROM usdusers u
      WHERE u.id = $1`,
    [userId],
  );
  if (rows.length === 0) {
    return {
      targetDegreeLevel: null,
      preferredCollegeType: null,
      preferredStates: [],
      preferredMajors: [],
    };
  }
  const row = rows[0];
  return {
    targetDegreeLevel: degreeLevelNameToCredentialId(row.preferred_degree_level),
    preferredCollegeType: row.preferred_college_type ?? null,
    preferredStates: row.preferred_states ?? [],
    preferredMajors: row.preferred_majors ?? [],
  };
}

/**
 * GET /popular-categories?target_degree_level=3
 */
router.get(
  "/",
  async (
    req: Request,
    res: Response<{ categories: PopularCategory[] } | ApiError>,
  ) => {
    try {
      let targetDegreeLevel: number | null = null;
      if (req.query.target_degree_level !== undefined) {
        const n = Number(req.query.target_degree_level);
        if (!Number.isInteger(n) || n <= 0) {
          return res.status(400).json({
            error: "target_degree_level must be a positive integer",
          });
        }
        targetDegreeLevel = n;
      }

      const key = cacheKey(targetDegreeLevel);
      const cached = cache.get(key);
      if (cached) {
        return res.json({ categories: cached });
      }

      const { rows } = await pool.query<CategoryPopularityRow>(
        CATEGORY_POPULARITY_QUERY,
      );
      const slotConfig = getSlotAllocation(targetDegreeLevel);
      const categories = selectPopularCategories(rows, slotConfig);

      cache.set(key, categories);
      return res.json({ categories });
    } catch (error) {
      console.error("Error fetching popular categories:", error);
      return res.status(500).json({
        error: "Failed to fetch popular categories",
        details: errorDetails(error),
      });
    }
  },
);

interface PersonalizedResponse {
  source: CategorySource;
  showCompletePrompt: boolean;
  categories: PopularCategory[];
}

/**
 * GET /popular-categories/personalized
 *
 * Layers the Match Preferences Board on top of the Step 1 default:
 *  - No/invalid Authorization header  -> Step 1 default, unbiased ("default").
 *  - Authenticated, all 4 fields empty -> Step 1 default + showCompletePrompt.
 *  - Authenticated, any field(s) set   -> filtered query (each field applied
 *    independently), then the 2-tier cold-start cascade in
 *    personalizedCategories.service.ts (state-relaxed -> default_biased).
 *
 * Cached per (target_degree_level, preferred_college_type, sorted states,
 * sorted majors) combination, not per user.
 */
router.get(
  "/personalized",
  async (req: Request, res: Response<PersonalizedResponse | ApiError>) => {
    try {
      const userId = await tryResolveUserId(req);

      if (userId === null) {
        const categories = await fetchDefaultCategories(null);
        return res.json({
          source: "default",
          showCompletePrompt: false,
          categories,
        });
      }

      const prefs = await fetchUserPreferences(userId);

      if (!hasAnyPreference(prefs)) {
        const categories = await fetchDefaultCategories(null);
        return res.json({
          source: "default",
          showCompletePrompt: true,
          categories,
        });
      }

      const key = buildPreferenceCacheKey(prefs);
      const cached = personalizedCache.get(key);
      if (cached) {
        return res.json({ ...cached, showCompletePrompt: false });
      }

      const result = await resolvePersonalizedCategories(prefs, {
        fetchFiltered: async (p, applyStates) => {
          const { sql, params } = buildPersonalizedCategoryQuery(p, {
            applyStates,
          });
          const { rows } = await pool.query<CategoryPopularityRow>(
            sql,
            params,
          );
          return rows;
        },
        fetchDefault: async () => {
          const { rows } = await pool.query<CategoryPopularityRow>(
            CATEGORY_POPULARITY_QUERY,
          );
          return rows;
        },
        onFallback: recordFallback,
      });

      personalizedCache.set(key, result);
      return res.json({ ...result, showCompletePrompt: false });
    } catch (error) {
      console.error("Error fetching personalized popular categories:", error);
      return res.status(500).json({
        error: "Failed to fetch personalized popular categories",
        details: errorDetails(error),
      });
    }
  },
);

export default router;
