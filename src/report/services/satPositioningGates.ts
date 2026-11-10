/**
 * Acceptance gates for the SAT positioning section. Each returns an array of
 * error strings (empty = pass), like the other gates in reportPrompt.ts.
 */
import { satCopyNumbers } from "../copy/satPositioning.copy";
import {
  DEFAULT_SAT_CONFIG,
  isValidRange,
  type SatConfig,
  type SatPositioning,
} from "./satPositioning";
import {
  SAT_COLLEGES_SQL,
  SAT_DEFAULT_CATEGORY_SQL,
  SAT_REPORT_COLLEGES_SQL,
  SAT_STUDENT_SQL,
  satQueryViolations,
} from "./satPositioning.sql";
import type { C1LiteNarrative, C1LitePayload } from "./reportPrompt";

// Thousands-grouped (1,200) or plain numbers; commas are presentation only.
const NUM_RE = /\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?/g;
const nums = (t: string) => (t.match(NUM_RE) ?? []).map((n) => n.replace(/,/g, ""));
// JSON is comma-separated, so digits there are never thousands-grouped.
const jsonNums = (t: string) => t.match(/\d+(?:\.\d+)?/g) ?? [];

/** Gate 1 + 2 + 4 + 5: every deterministic invariant of the block itself. */
export function gateSatBlock(
  block: SatPositioning,
  cfg: SatConfig = DEFAULT_SAT_CONFIG,
): string[] {
  const errs: string[] = [];
  const score = block.studentScore;

  // Gate 5
  if (block.state === "no_student_score") {
    if (block.charted.length || block.fallback.length || block.axis)
      errs.push("SAT: state=no_student_score but ranges/rows are present.");
    return errs;
  }
  if (score == null) {
    errs.push(`SAT: state=${block.state} without a student score.`);
    return errs;
  }

  for (const r of block.charted) {
    // Gate 2 (value validity; the query layer is covered by gateSatQueries)
    if (!isValidRange(r.p25, r.p75, true, cfg))
      errs.push(`SAT: invalid range for ${r.unitid}: ${r.p25}–${r.p75}.`);
    // Gate 1: status/gap recompute identically
    const status = score < r.p25 ? "below" : score > r.p75 ? "above" : "within";
    const gap =
      status === "below" ? r.p25 - score : status === "above" ? score - r.p75 : null;
    if (status !== r.status || gap !== r.gapPoints)
      errs.push(
        `SAT: ${r.unitid} status/gap mismatch (payload ${r.status}/${r.gapPoints}, recomputed ${status}/${gap}).`,
      );
  }

  // Gate 4
  for (const f of block.fallback) {
    if (!f.supportingCopy?.trim())
      errs.push(`SAT: fallback ${f.unitid} has empty supportingCopy.`);
    if (!f.contactGuidance?.trim())
      errs.push(`SAT: fallback ${f.unitid} has empty contactGuidance.`);
    if (f.websiteUrl != null) {
      let ok = false;
      try {
        const u = new URL(f.websiteUrl);
        ok = u.protocol === "http:" || u.protocol === "https:";
      } catch {
        ok = false;
      }
      if (!ok) errs.push(`SAT: fallback ${f.unitid} has invalid websiteUrl.`);
    }
  }

  const c = block.counts;
  if (
    c.above + c.within + c.below !== block.charted.length ||
    c.noData !== block.fallback.length
  )
    errs.push("SAT: counts do not match rows.");
  return errs;
}

/** Gate 3: satPositioning covers exactly the report's colleges. */
export function gateSatCollegeSet(
  block: SatPositioning,
  reportUnitids: number[],
): string[] {
  const expected = new Set(reportUnitids);
  const errs: string[] = [];
  const ids = new Set(block.collegeIds);
  if (block.state !== "no_student_score") {
    const rows = [...block.charted, ...block.fallback].map((r) => r.unitid);
    if (new Set(rows).size !== rows.length)
      errs.push("SAT: a college appears in more than one row.");
    for (const id of rows) if (!ids.has(id)) errs.push(`SAT: row ${id} is not in collegeIds.`);
    for (const id of ids) if (!rows.includes(id)) errs.push(`SAT: college ${id} has no row.`);
  }
  for (const id of ids)
    if (!expected.has(id)) errs.push(`SAT: extra college ${id} not in the report.`);
  for (const id of expected)
    if (!ids.has(id)) errs.push(`SAT: report college ${id} missing from SAT block.`);
  return errs;
}

/** Gate 2 (query layer): none of the feature's SQL reads a synthetic source. */
export function gateSatQueries(): string[] {
  return [
    SAT_COLLEGES_SQL,
    SAT_STUDENT_SQL,
    SAT_REPORT_COLLEGES_SQL,
    SAT_DEFAULT_CATEGORY_SQL,
  ].flatMap(satQueryViolations);
}

/** Gate 6: the rendered section contains no number that isn't in the payload block or static copy. */
export function gateSatRenderedNumbers(
  sectionHtml: string,
  block: SatPositioning,
): string[] {
  const text = sectionHtml
    .replace(/<[^>]*>/g, " ")
    .replace(/&#?\w+;/g, " ");
  const allowed = new Set<string>([
    ...jsonNums(JSON.stringify(block)),
    ...[...satCopyNumbers()].flatMap((n) => nums(n)),
  ]);
  const found = new Set(nums(text));
  return [...found]
    .filter((n) => !allowed.has(n))
    .map((n) => `SAT: rendered number not in payload: ${n}`);
}

/**
 * Narrative consistency: if a fit sentence says the student "falls
 * below/above/within" a range, it must agree with the computed status (and a
 * college with no charted range must not claim a relation at all).
 */
export function gateSatNarrative(
  n: C1LiteNarrative,
  payload: C1LitePayload,
): string[] {
  const block = payload.sat_positioning;
  const errs: string[] = [];
  for (const f of n.fit_sentences ?? []) {
    const m = /falls (below|above|within)/i.exec(f.sentence);
    if (!m) continue;
    const school = payload.schools.find((s) => s.display_name === f.school);
    if (!school) continue;
    const row = block.charted.find((r) => String(r.unitid) === school.unitid);
    const said = m[1].toLowerCase();
    if (!row) errs.push(`SAT narrative: "${f.school}" claims "falls ${said}" but has no charted range.`);
    else if (row.status !== said)
      errs.push(`SAT narrative: "${f.school}" says ${said}, computed ${row.status}.`);
  }
  return errs;
}

/** Everything that can be checked without rendering. */
export function runSatGates(payload: C1LitePayload): string[] {
  const reportUnitids = payload.schools.map((s) => Number(s.unitid));
  return [
    ...gateSatBlock(payload.sat_positioning),
    ...gateSatCollegeSet(payload.sat_positioning, reportUnitids),
    ...gateSatQueries(),
  ];
}
