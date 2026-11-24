/**
 * The caller's "selected" comparison set, backed by user_compare_history.
 *
 * Each history row is a SET of unitids (jsonb array) compared at created_at:
 *   - current set = compared_colleges of the caller's LATEST row
 *   - adding / removing appends a NEW row; past rows are never modified
 *   - addedAt(unitid) = MIN(created_at) over the caller's rows containing it
 */
import pool from "../../db/client";
import { commonJoins, progEarnJoin, SHARED_COLUMNS } from "./enrichmentSql";
import { mapRowToSelectedItem } from "./enrichment";
import { toNum } from "./parse";
import type { SelectedItem } from "./types";

/** The caller's current comparison set = unitids in their latest history row. */
export async function getCurrentSet(userId: string): Promise<number[]> {
  const r = await pool.query<{ compared_colleges: unknown }>(
    `SELECT compared_colleges FROM user_compare_history
      WHERE user_id = $1 ORDER BY created_at DESC, id DESC LIMIT 1`,
    [userId],
  );
  if (r.rows.length === 0 || !Array.isArray(r.rows[0].compared_colleges))
    return [];
  return (r.rows[0].compared_colleges as unknown[])
    .map((v) => toNum(v))
    .filter((n): n is number => n !== null && Number.isInteger(n));
}

/**
 * Enriched current set with per-unitid earliest addedAt.
 * When `programTitle` is given, each school is matched against its own
 * `programs.title` (ILIKE, so "Accounting and Computer Science" matches the
 * "Accounting and Computer Science." row) and `selectedProgram` carries that
 * program's own CIP-level earnings instead of the school-wide average.
 */
export async function getSelectedEnriched(
  userId: string,
  programTitle?: string,
): Promise<SelectedItem[]> {
  const programParam = programTitle ? `%${programTitle}%` : null;
  const { rows } = await pool.query(
    `WITH latest AS (
        SELECT compared_colleges
          FROM user_compare_history
         WHERE user_id = $1
         ORDER BY created_at DESC, id DESC
         LIMIT 1
     ),
     sel AS (
        SELECT (jsonb_array_elements_text((SELECT compared_colleges FROM latest)))::bigint AS unitid
     ),
     added AS (
        -- earliest created_at for every unitid that ever appeared in the
        -- caller's history (robust to number/string element storage).
        SELECT (e.val)::bigint AS unitid, MIN(h.created_at) AS added_at
          FROM user_compare_history h
          CROSS JOIN LATERAL jsonb_array_elements_text(h.compared_colleges) AS e(val)
         WHERE h.user_id = $1
         GROUP BY (e.val)::bigint
     )
     SELECT
        sel.unitid,
        added.added_at,
        ${SHARED_COLUMNS}
     FROM sel
     JOIN added ON added.unitid = sel.unitid
     ${commonJoins("sel")}
     LEFT JOIN LATERAL (
        SELECT title, cip_code, credential_level, credential_title, degree_level_category
          FROM programs
         WHERE unitid = sel.unitid
           AND $2::text IS NOT NULL
           AND title ILIKE $2
         ORDER BY title ASC
         LIMIT 1
     ) selProg ON TRUE
     ${progEarnJoin("sel")}
     ORDER BY added.added_at ASC, sel.unitid ASC`,
    [userId, programParam],
  );

  return Promise.all(rows.map(mapRowToSelectedItem));
}
