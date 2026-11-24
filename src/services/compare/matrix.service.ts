/**
 * The caller's per-program compare matrix, backed by compare_matrix_entries.
 * Unlike the "selected" set (bare unitids), a matrix entry also names a
 * specific program (cip_code + credential_level), so the same college can
 * appear more than once under different programs.
 */
import pool from "../../db/client";
import { commonJoins, progEarnJoin, SHARED_COLUMNS } from "./enrichmentSql";
import { mapRowToSelectedItem } from "./enrichment";
import { toNum } from "./parse";
import type { MatrixEntry, SelectedItem } from "./types";

/** Hard cap on matrix entries per user. */
export const MAX_COMPARE_MATRIX_ENTRIES = 5;

/** Fetch the caller's current compare-matrix rows, camelCased. Empty -> []. */
export async function fetchMatrixEntries(userId: string): Promise<MatrixEntry[]> {
  const { rows } = await pool.query<{
    unitid: string;
    cip_code: string | null;
    credential_level: string | null;
    program_name: string | null;
    credential_title: string | null;
  }>(
    `SELECT unitid, cip_code, credential_level, program_name, credential_title
       FROM compare_matrix_entries
      WHERE user_id = $1
      ORDER BY id ASC`,
    [userId],
  );

  return rows.map((r) => ({
    unitid: toNum(r.unitid) ?? 0,
    cipCode: r.cip_code,
    credentialLevel: r.credential_level,
    programName: r.program_name,
    credentialTitle: r.credential_title,
  }));
}

/**
 * Enriched compare-matrix rows, in the SAME shape as getSelectedEnriched's
 * SelectedItem — one entry per compare_matrix_entries row (so the same
 * college can appear more than once under different programs). Unlike
 * getSelectedEnriched (which matches `programs.title` via ILIKE against a
 * single ?program= query param), each row here resolves its own
 * selectedProgram from its OWN cip_code/credential_level, so every row's
 * program is resolved in one call — no per-program round trip needed.
 */
export async function getMatrixEnrichedRows(
  userId: string,
): Promise<(MatrixEntry & { details: SelectedItem })[]> {
  const { rows } = await pool.query(
    `WITH entries AS (
        SELECT id, unitid, cip_code, credential_level, program_name, credential_title, created_at
          FROM compare_matrix_entries
         WHERE user_id = $1
         ORDER BY id ASC
     )
     SELECT
        entries.unitid          AS unitid,
        entries.cip_code        AS entry_cip_code,
        entries.credential_level AS entry_credential_level,
        entries.program_name    AS entry_program_name,
        entries.credential_title AS entry_credential_title,
        entries.created_at      AS added_at,
        ${SHARED_COLUMNS}
     FROM entries
     ${commonJoins("entries")}
     LEFT JOIN LATERAL (
        -- Match THIS row's own cip_code/credential_level (not a title ILIKE
        -- against a single query param) so every row resolves independently
        -- in this one query.
        SELECT title, cip_code, credential_level, credential_title, degree_level_category
          FROM programs
         WHERE unitid = entries.unitid
           AND entries.cip_code IS NOT NULL
           AND entries.credential_level IS NOT NULL
           AND replace(cip_code, '.', '') = replace(entries.cip_code, '.', '')
           AND credential_level::text = entries.credential_level
         ORDER BY title ASC
         LIMIT 1
     ) selProg ON TRUE
     ${progEarnJoin("entries")}
     ORDER BY entries.id ASC`,
    [userId],
  );

  return Promise.all(
    rows.map(async (row) => ({
      unitid: toNum(row.unitid) ?? 0,
      cipCode: row.entry_cip_code,
      credentialLevel: row.entry_credential_level,
      programName: row.entry_program_name,
      credentialTitle: row.entry_credential_title,
      details: await mapRowToSelectedItem(row),
    })),
  );
}

/** Enriched compare-matrix rows in the SelectedItem shape (used by GET /matrix/details). */
export async function getMatrixEnriched(userId: string): Promise<SelectedItem[]> {
  const rows = await getMatrixEnrichedRows(userId);
  return rows.map((r) => r.details);
}
