/**
 * Compare endpoints. This file only holds the HTTP routes; the data work is in
 * src/services/compare/:
 *   parse.ts           small value-parsing helpers
 *   types.ts           response shapes (SelectedItem, MatrixEntry, ...)
 *   enrichmentSql.ts   SQL shared by the selected + matrix queries
 *   enrichment.ts      raw row -> SelectedItem
 *   selected.service.ts  the "selected" set (user_compare_history)
 *   matrix.service.ts    the per-program matrix (compare_matrix_entries)
 */
import { Router, Request, Response } from "express";
import pool from "../db/client";
import { verifyToken } from "../middleware/auth";
import { AuthRequest } from "../types/user";
import { getAthleticsProfile } from "../services/athletics.service";
import { AthleticsProfile } from "../types/athletics";
import { sendInternalError } from "../utils/apiError";
import { resolveUserId } from "../services/userLookup";
import { collectUnitids, toNum, toStr } from "../services/compare/parse";
import type { MatrixEntry, SelectedItem, ApiErrorBody } from "../services/compare/types";
import {
  getCurrentSet,
  getSelectedEnriched,
} from "../services/compare/selected.service";
import {
  MAX_COMPARE_MATRIX_ENTRIES,
  fetchMatrixEntries,
  getMatrixEnriched,
  getMatrixEnrichedRows,
} from "../services/compare/matrix.service";

const router = Router();

const MAX_COMPARE_ATHLETICS = 4;

interface CollegeDropdownItem {
  unitid: number;
  school_name: string;
  city: string | null;
  state: string | null;
}

interface ApiError {
  error: string;
  details?: string;
}

/**
 * GET /compare/colleges
 * Returns a lightweight list of colleges for use in compare-page dropdowns.
 *
 * Query params:
 *  - search: Optional. Filter by school name (case-insensitive partial match).
 *            When omitted, returns all colleges.
 *  - limit:  Max results to return (default 50, max 200).
 *
 * Example requests:
 *  GET /compare/colleges                        → All colleges (up to 50)
 *  GET /compare/colleges?search=Harvard         → Colleges matching "Harvard"
 *  GET /compare/colleges?search=mit&limit=10    → Up to 10 colleges matching "mit"
 *
 * Response: Array of { unitid, school_name, city, state }
 */
router.get(
  "/colleges",
  verifyToken,
  async (req: Request, res: Response<CollegeDropdownItem[] | ApiError>) => {
    try {
      const search = toStr(req.query.search);
      const limit = Math.min(200, Math.max(1, toNum(req.query.limit) ?? 50));

      const params: (string | number)[] = [];
      let whereClause = "";

      if (search) {
        params.push(`%${search}%`);
        whereClause = `WHERE LOWER(s.name) LIKE LOWER($1)`;
      }

      const sql = `
        SELECT
          s.unitid,
          s.name AS school_name,
          s.city,
          s.state
        FROM schools s
        ${whereClause}
        ORDER BY s.name ASC
        LIMIT $${params.length + 1}
      `;

      params.push(limit);

      const result = await pool.query<CollegeDropdownItem>(sql, params);

      const colleges: CollegeDropdownItem[] = result.rows.map((row) => ({
        unitid: toNum(row.unitid) ?? 0,
        school_name: toStr(row.school_name) ?? "Unknown",
        city: toStr(row.city),
        state: toStr(row.state),
      }));

      res.json(colleges);
    } catch (error) {
      sendInternalError(req, res, error, "compare");
    }
  },
);

// ===========================================================================
// /compare/selected — the caller's current comparison set, backed by the
// EXISTING user_compare_history table (history of comparison events).
//
// Model: each row = a SET of unitids (jsonb array) compared at created_at.
//   - current set      = compared_colleges of the caller's LATEST row
//   - POST add         = append a new row with union(current, added) if changed
//   - DELETE remove    = append a new row with (current - unitid); past rows kept
//   - addedAt(unitid)  = MIN(created_at) over the caller's rows containing it
// All routes are caller-scoped to their resolved usdusers.id.
// ===========================================================================

/**
 * POST /compare/selected   body { unitid } | { unitids: [...] }
 * Adds college(s) to the caller's comparison set. Idempotent: re-adding a
 * present college changes nothing (no new row → earliest addedAt preserved).
 * Returns the enriched current set.
 */
router.post(
  "/selected",
  verifyToken,
  async (req: AuthRequest, res: Response) => {
    try {
      const incoming = collectUnitids(
        (req.body ?? {}) as Record<string, unknown>,
      );
      if (incoming.length === 0) {
        return res
          .status(400)
          .json({ error: "A valid unitid or unitids[] is required" });
      }

      const userId = await resolveUserId(req.userId as string);
      if (!userId) return res.status(404).json({ error: "User not found" });

      const current = await getCurrentSet(userId);
      const set = new Set(current);
      let changed = false;
      for (const u of incoming) {
        if (!set.has(u)) {
          set.add(u);
          changed = true;
        }
      }

      if (changed) {
        await pool.query(
          `INSERT INTO user_compare_history (user_id, compared_colleges, created_at)
         VALUES ($1, $2::jsonb, NOW())`,
          [userId, JSON.stringify([...set])],
        );
      }

      return res.json(await getSelectedEnriched(userId));
    } catch (error) {
      return sendInternalError(req, res, error, "compare");
    }
  },
);

/**
 * GET /compare/selected?program=<title>
 * Returns the caller's current comparison set, enriched, each with addedAt
 * (earliest created_at for that unitid). Empty -> [].
 *
 * Optional `program` query param matches each school's own programs.title
 * (ILIKE) and, when it hits, fills programs.selectedProgram with that exact
 * program's CIP-level earnings instead of a generic top-3 title sample.
 */
router.get(
  "/selected",
  verifyToken,
  async (req: AuthRequest, res: Response) => {
    try {
      const userId = await resolveUserId(req.userId as string);
      if (!userId) return res.status(404).json({ error: "User not found" });
      const program = toStr(req.query.program) ?? undefined;
      return res.json(await getSelectedEnriched(userId, program));
    } catch (error) {
      return sendInternalError(req, res, error, "compare");
    }
  },
);

/**
 * DELETE /compare/selected/:unitid
 * Removes a college from the caller's CURRENT set by appending a new history
 * row with (current - unitid). Past history rows are never modified.
 */
router.delete(
  "/selected/:unitid",
  verifyToken,
  async (req: AuthRequest, res: Response) => {
    try {
      const unitid = toNum(req.params.unitid);
      if (unitid === null || !Number.isInteger(unitid) || unitid <= 0) {
        return res
          .status(400)
          .json({ error: "A valid integer unitid is required" });
      }

      const userId = await resolveUserId(req.userId as string);
      if (!userId) return res.status(404).json({ error: "User not found" });

      const current = await getCurrentSet(userId);
      if (current.includes(unitid)) {
        const next = current.filter((u) => u !== unitid);
        await pool.query(
          `INSERT INTO user_compare_history (user_id, compared_colleges, created_at)
         VALUES ($1, $2::jsonb, NOW())`,
          [userId, JSON.stringify(next)],
        );
      }

      return res.json({ ok: true });
    } catch (error) {
      return sendInternalError(req, res, error, "compare");
    }
  },
);

// ===========================================================================
// /compare/matrix — the caller's per-program compare-matrix selections,
// backed by the NEW compare_matrix_entries table. Distinct from
// /compare/selected (bare-unitid, user_compare_history-backed): the matrix
// tracks unitid + specific program (cip_code/credential_level), so the same
// college can appear more than once under different programs.
//
// PUT is a full-list replace (delete-then-insert in one transaction) to
// match how the frontend already maintains this list client-side — not an
// incremental add/remove like /compare/selected.
// ===========================================================================

/**
 * GET /compare/matrix
 * Returns the caller's current compare-matrix rows. Empty -> [].
 */
router.get(
  "/matrix",
  verifyToken,
  async (req: AuthRequest, res: Response<MatrixEntry[] | ApiErrorBody>) => {
    try {
      const userId = await resolveUserId(req.userId as string);
      if (!userId) return res.status(404).json({ error: "User not found" });

      return res.json(await fetchMatrixEntries(userId));
    } catch (error) {
      return sendInternalError(req, res, error, "compare");
    }
  },
);

/**
 * PUT /compare/matrix   body { entries: [{ unitid, cipCode?, credentialLevel?,
 *                                           programName?, credentialTitle? }] }
 * Replaces ALL of the caller's compare-matrix rows with the given list
 * (delete-then-insert in one transaction). An empty entries[] clears the
 * matrix. Every entry must have a valid positive-integer unitid.
 */
router.put(
  "/matrix",
  verifyToken,
  async (req: AuthRequest, res: Response<MatrixEntry[] | ApiErrorBody>) => {
    try {
      const userId = await resolveUserId(req.userId as string);
      if (!userId) return res.status(404).json({ error: "User not found" });

      const entries = (req.body as { entries?: unknown[] } | undefined)
        ?.entries;
      if (!Array.isArray(entries)) {
        return res.status(400).json({ error: "entries[] is required" });
      }

      const normalized: MatrixEntry[] = [];
      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i] as Record<string, unknown> | null;
        const unitid = toNum(entry?.unitid);
        if (unitid === null || !Number.isInteger(unitid) || unitid <= 0) {
          return res.status(400).json({
            error: `Invalid entry at index ${i}: missing unitid`,
          });
        }
        normalized.push({
          unitid,
          cipCode: toStr(entry?.cipCode),
          credentialLevel: toStr(entry?.credentialLevel),
          programName: toStr(entry?.programName),
          credentialTitle: toStr(entry?.credentialTitle),
        });
      }

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          "DELETE FROM compare_matrix_entries WHERE user_id = $1",
          [userId],
        );

        if (normalized.length > 0) {
          const values: Array<string | number | null> = [];
          const placeholders = normalized
            .map((e, idx) => {
              const base = idx * 6;
              values.push(
                userId,
                e.unitid,
                e.cipCode,
                e.credentialLevel,
                e.programName,
                e.credentialTitle,
              );
              return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6})`;
            })
            .join(", ");

          await client.query(
            `INSERT INTO compare_matrix_entries (user_id, unitid, cip_code, credential_level, program_name, credential_title)
             VALUES ${placeholders}`,
            values,
          );
        }

        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }

      return res.json(normalized);
    } catch (error) {
      return sendInternalError(req, res, error, "compare");
    }
  },
);

/**
 * POST /compare/matrix/entry
 * body { unitid, cipCode?, credentialLevel?, programName?, credentialTitle? }
 * Upserts a single compare-matrix entry (dedupe key: unitid + cipCode +
 * credentialLevel, null-safe). Atomic relative to other mutations on the
 * same user's matrix — unlike PUT /matrix, safe for multiple independent UI
 * surfaces to call concurrently without clobbering each other's rows.
 * Enforces the MAX_COMPARE_MATRIX_ENTRIES cap on NEW entries only (updating
 * an existing entry never counts against the cap).
 * Response: the caller's full updated matrix.
 */
router.post(
  "/matrix/entry",
  verifyToken,
  async (req: AuthRequest, res: Response<MatrixEntry[] | ApiErrorBody>) => {
    try {
      const userId = await resolveUserId(req.userId as string);
      if (!userId) return res.status(404).json({ error: "User not found" });

      const body = (req.body ?? {}) as Record<string, unknown>;
      const unitid = toNum(body.unitid);
      if (unitid === null || !Number.isInteger(unitid) || unitid <= 0) {
        return res.status(400).json({ error: "A valid unitid is required" });
      }
      const cipCode = toStr(body.cipCode);
      const credentialLevel = toStr(body.credentialLevel);
      const programName = toStr(body.programName);
      const credentialTitle = toStr(body.credentialTitle);

      const client = await pool.connect();
      let limitReached = false;
      try {
        await client.query("BEGIN");
        // Serializes concurrent POSTs for the same user within this
        // transaction so the cap check below can't race two inserts past
        // MAX_COMPARE_MATRIX_ENTRIES (COUNT(*) can't itself take FOR UPDATE).
        await client.query("SELECT pg_advisory_xact_lock($1::bigint)", [
          userId,
        ]);

        const existing = await client.query<{ id: string }>(
          `SELECT id FROM compare_matrix_entries
            WHERE user_id = $1 AND unitid = $2
              AND cip_code IS NOT DISTINCT FROM $3
              AND credential_level IS NOT DISTINCT FROM $4
            FOR UPDATE`,
          [userId, unitid, cipCode, credentialLevel],
        );

        if (existing.rows.length > 0) {
          await client.query(
            `UPDATE compare_matrix_entries
                SET program_name = $2, credential_title = $3
              WHERE id = $1`,
            [existing.rows[0].id, programName, credentialTitle],
          );
        } else {
          const { rows: countRows } = await client.query<{ count: number }>(
            "SELECT COUNT(*)::int AS count FROM compare_matrix_entries WHERE user_id = $1",
            [userId],
          );
          if ((countRows[0]?.count ?? 0) >= MAX_COMPARE_MATRIX_ENTRIES) {
            limitReached = true;
          } else {
            await client.query(
              `INSERT INTO compare_matrix_entries
                 (user_id, unitid, cip_code, credential_level, program_name, credential_title)
               VALUES ($1, $2, $3, $4, $5, $6)`,
              [
                userId,
                unitid,
                cipCode,
                credentialLevel,
                programName,
                credentialTitle,
              ],
            );
          }
        }

        await client.query(limitReached ? "ROLLBACK" : "COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }

      if (limitReached) {
        return res.status(409).json({
          error: "Compare limit reached",
          code: "COMPARE_LIMIT_REACHED",
          details: `A maximum of ${MAX_COMPARE_MATRIX_ENTRIES} entries can be compared at once`,
        });
      }

      return res.json(await fetchMatrixEntries(userId));
    } catch (error) {
      return sendInternalError(req, res, error, "compare");
    }
  },
);

/**
 * DELETE /compare/matrix/entry/:unitid
 * Removes EVERY compare-matrix entry for that college (used by surfaces
 * that don't track a specific program). Response: the full updated matrix.
 *
 * Optional ?details=true: instead of the bare matrix, responds with the
 * same remaining rows enriched exactly like GET /compare/matrix/details,
 * each nested under a `details` key (row order matches compare_matrix_entries
 * id ASC, same as /matrix/details).
 */
router.delete(
  "/matrix/entry/:unitid",
  verifyToken,
  async (
    req: AuthRequest,
    res: Response<
      MatrixEntry[] | (MatrixEntry & { details: SelectedItem })[] | ApiErrorBody
    >,
  ) => {
    try {
      const unitid = toNum(req.params.unitid);
      if (unitid === null || !Number.isInteger(unitid) || unitid <= 0) {
        return res
          .status(400)
          .json({ error: "A valid integer unitid is required" });
      }

      const userId = await resolveUserId(req.userId as string);
      if (!userId) return res.status(404).json({ error: "User not found" });

      await pool.query(
        "DELETE FROM compare_matrix_entries WHERE user_id = $1 AND unitid = $2",
        [userId, unitid],
      );

      if (toStr(req.query.details) === "true") {
        return res.json(await getMatrixEnrichedRows(userId));
      }
      return res.json(await fetchMatrixEntries(userId));
    } catch (error) {
      return sendInternalError(req, res, error, "compare");
    }
  },
);

/**
 * DELETE /compare/matrix/entry/:unitid/:cipCode/:credentialLevel
 * Removes one specific program entry (used by the compare page's own
 * per-program remove). Response: the full updated matrix.
 *
 * Optional ?details=true: same enrichment as above.
 */
router.delete(
  "/matrix/entry/:unitid/:cipCode/:credentialLevel",
  verifyToken,
  async (
    req: AuthRequest,
    res: Response<
      MatrixEntry[] | (MatrixEntry & { details: SelectedItem })[] | ApiErrorBody
    >,
  ) => {
    try {
      const unitid = toNum(req.params.unitid);
      if (unitid === null || !Number.isInteger(unitid) || unitid <= 0) {
        return res
          .status(400)
          .json({ error: "A valid integer unitid is required" });
      }
      const cipCode = toStr(req.params.cipCode);
      const credentialLevel = toStr(req.params.credentialLevel);

      const userId = await resolveUserId(req.userId as string);
      if (!userId) return res.status(404).json({ error: "User not found" });

      await pool.query(
        `DELETE FROM compare_matrix_entries
          WHERE user_id = $1 AND unitid = $2
            AND cip_code IS NOT DISTINCT FROM $3
            AND credential_level IS NOT DISTINCT FROM $4`,
        [userId, unitid, cipCode, credentialLevel],
      );

      if (toStr(req.query.details) === "true") {
        return res.json(await getMatrixEnrichedRows(userId));
      }
      return res.json(await fetchMatrixEntries(userId));
    } catch (error) {
      return sendInternalError(req, res, error, "compare");
    }
  },
);

/**
 * GET /compare/matrix/details
 * Enriched details for the caller's compare-matrix rows, in the same shape
 * as GET /compare/selected (tuition, acceptance rate, SAT range, cost,
 * outcomes, programs.selectedProgram). Unlike /compare/selected, every row's
 * selectedProgram is resolved from that row's OWN cipCode/credentialLevel in
 * this single call — no per-program ?program= round trip needed.
 */
router.get(
  "/matrix/details",
  verifyToken,
  async (req: AuthRequest, res: Response) => {
    try {
      const userId = await resolveUserId(req.userId as string);
      if (!userId) return res.status(404).json({ error: "User not found" });

      return res.json(await getMatrixEnriched(userId));
    } catch (error) {
      return sendInternalError(req, res, error, "compare");
    }
  },
);

/**
 * GET /compare/athletics?unitids=100654,100663,100706
 * Bulk variant of GET /colleges/:unitid/athletics for the college comparison
 * feature. Returns one profile per unitid, in the order requested. Unitids
 * with no athletic_summary row are silently omitted (not an error) so a
 * comparison set can mix schools with and without athletics data.
 *
 * Query params:
 *  - unitids: Required. Comma-separated list of unitids, max 4 (matches
 *             the existing comparison UI constraint).
 */
router.get(
  "/athletics",
  async (req: Request, res: Response<AthleticsProfile[] | ApiErrorBody>) => {
    try {
      const raw = toStr(req.query.unitids);
      if (!raw) {
        return res
          .status(400)
          .json({ error: "unitids query parameter is required" });
      }

      const unitids: number[] = [];
      const seen = new Set<number>();
      for (const part of raw.split(",")) {
        const n = toNum(part.trim());
        if (n === null || !Number.isInteger(n) || n <= 0 || seen.has(n))
          continue;
        seen.add(n);
        unitids.push(n);
      }

      if (unitids.length === 0) {
        return res
          .status(400)
          .json({ error: "unitids must contain at least one valid unitid" });
      }
      if (unitids.length > MAX_COMPARE_ATHLETICS) {
        return res.status(400).json({
          error: `A maximum of ${MAX_COMPARE_ATHLETICS} unitids can be compared at once`,
        });
      }

      const profiles = await Promise.all(
        unitids.map((id) => getAthleticsProfile(id)),
      );

      res.json(profiles.filter((p): p is AthleticsProfile => p !== null));
    } catch (error) {
      sendInternalError(req, res, error, "compare");
    }
  },
);

export default router;
