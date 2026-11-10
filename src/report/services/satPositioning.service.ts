/**
 * satPositioning.service.ts — DB loading for the SAT positioning section.
 *
 * Only this user's score (usdreports.user_id → usdusers) against only this
 * report's colleges (usdreport_colleges, by display_order). The pure maths
 * lives in satPositioning.ts.
 */
import pool from "../../db/client";
import {
  SAT_COLLEGES_SQL,
  SAT_DEFAULT_CATEGORY_SQL,
  SAT_REPORT_COLLEGES_SQL,
  SAT_STUDENT_SQL,
  assertSatQueryClean,
} from "./satPositioning.sql";
import { SAT_CATEGORY_KEYS } from "../config/satPositioning.config";
import {
  buildSatPositioning,
  type SatCategoryRow,
  type SatCollegeInput,
  type SatPositioning,
  type SatStudentInput,
} from "./satPositioning";

export interface Queryable {
  query: (text: string, values?: unknown[]) => Promise<{ rows: any[] }>;
}

const num = (v: unknown): number | null => (v == null ? null : Number(v));

async function loadStudent(
  db: Queryable,
  reportReferenceId: string,
): Promise<SatStudentInput> {
  assertSatQueryClean(SAT_STUDENT_SQL);
  const { rows } = await db.query(SAT_STUDENT_SQL, [reportReferenceId]);
  if (!rows.length)
    throw new Error(`SAT positioning: no report/user for ${reportReferenceId}`);
  return {
    sat_score: num(rows[0].sat_score),
    sat_math: num(rows[0].sat_math),
    sat_reading_writing: num(rows[0].sat_reading_writing),
  };
}

/** Persisted usdreport_colleges rows (empty while a report is still pending). */
async function loadPersistedUnitids(
  db: Queryable,
  reportReferenceId: string,
): Promise<number[]> {
  const { rows } = await db.query(SAT_REPORT_COLLEGES_SQL, [reportReferenceId]);
  return rows.map((r) => Number(r.unitid));
}

async function loadDefaultCategory(db: Queryable): Promise<SatCategoryRow> {
  const { rows } = await db.query(SAT_DEFAULT_CATEGORY_SQL, [
    SAT_CATEGORY_KEYS.noScoreData,
  ]);
  if (!rows.length || rows[0].contact_guidance == null)
    throw new Error(
      `SAT positioning: ${SAT_CATEGORY_KEYS.noScoreData} category (with contact_guidance) is missing — run src/db/migrations/sat_positioning.sql`,
    );
  return rows[0] as SatCategoryRow;
}

/**
 * Build the satPositioning block for a report.
 *
 * Colleges come from usdreport_colleges for this report. Those rows are only
 * written after the PDF is generated, so while a report is still pending the
 * caller's `pendingUnitids` (the same ordered list that is about to be
 * persisted, display_order = index) is used instead.
 */
export async function loadSatPositioning(
  args: { reportReferenceId: string; pendingUnitids?: number[] },
  db: Queryable = pool,
): Promise<SatPositioning> {
  assertSatQueryClean(SAT_COLLEGES_SQL);
  assertSatQueryClean(SAT_REPORT_COLLEGES_SQL);

  const student = await loadStudent(db, args.reportReferenceId);
  let ordered = await loadPersistedUnitids(db, args.reportReferenceId);
  if (!ordered.length) ordered = args.pendingUnitids ?? [];

  const unique = [...new Set(ordered)];
  if (!unique.length) throw new Error("SAT positioning: report has no colleges");

  const [{ rows }, defaultCategory] = await Promise.all([
    db.query(SAT_COLLEGES_SQL, [unique]),
    loadDefaultCategory(db),
  ]);
  const byUnitid = new Map<number, any>(rows.map((r) => [Number(r.unitid), r]));

  const colleges: SatCollegeInput[] = [];
  ordered.forEach((unitid, displayOrder) => {
    const r = byUnitid.get(unitid);
    if (!r) throw new Error(`SAT positioning: school ${unitid} not found`);
    colleges.push({
      unitid,
      displayOrder,
      name: r.name,
      schoolUrl: r.school_url ?? null,
      schoolMinRange: num(r.school_min_range),
      schoolMaxRange: num(r.school_max_range),
      publishPublicly: r.publish_publicly ?? null,
      category: r.category
        ? {
            category: r.category,
            badge_label: r.badge_label,
            badge_color: r.badge_color,
            supporting_copy: r.supporting_copy,
            disclaimer_text: r.disclaimer_text ?? null,
            contact_guidance: r.contact_guidance ?? null,
            show_badge_with_range: r.show_badge_with_range === true,
          }
        : null,
    });
  });

  return buildSatPositioning(student, colleges, defaultCategory);
}
