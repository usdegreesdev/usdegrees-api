/** Pagination: how many colleges fit on a page, and which layout mode a block needs. */
import type {
  SatChartedRow,
  SatFallbackRow,
  SatPositioning as SatBlock,
} from "../../services/satPositioning";
import { SAT_LAYOUT } from "../../config/satPositioning.config";

export type Item =
  | { kind: "charted"; row: SatChartedRow }
  | { kind: "fallback"; row: SatFallbackRow }
  | { kind: "note" };

/**
 * Layout mode. `compact`: 4+ colleges where some carry copy (scores-considered
 * or no-range) get tighter rows/copy. `hideChips`: with 5+ such colleges and a
 * scores-considered school, the summary chips are dropped so it all fits.
 */
export function satLayoutMode(block: SatBlock): { compact: boolean; hideChips: boolean; noted: boolean } {
  const n = block.charted.length + block.fallback.length;
  const hasSub = block.charted.some((r) => r.submittedOnly);
  const noted = hasSub || block.fallback.length > 0;
  return { compact: noted && n >= 4, hideChips: hasSub && n >= 5, noted };
}

const textWeight = (texts: Array<string | null>, link: boolean, compact: boolean) => {
  const L = compact ? SAT_LAYOUT.compact : SAT_LAYOUT;
  // Compact copy flows supporting + disclaimer as one paragraph.
  const parts = compact
    ? [[texts[0], texts[1]].filter(Boolean).join(" "), texts[2]]
    : texts;
  const lines = parts
    .filter((t): t is string => !!t)
    .reduce((n, t) => n + Math.max(1, Math.ceil(t.length / L.notesLineChars)), 0);
  return lines * L.notesLineWeight + L.notesPadWeight + (link ? L.notesLinkWeight : 0);
};

const weightOf = (it: Item, compact: boolean) => {
  const L = compact ? SAT_LAYOUT.compact : SAT_LAYOUT;
  if (it.kind === "charted")
    return it.row.submittedOnly
      ? L.chartedRowWeight +
          textWeight([it.row.supportingCopy, it.row.disclaimerText, it.row.contactGuidance], false, compact)
      : SAT_LAYOUT.chartedRowWeight;
  if (it.kind === "fallback")
    return (
      L.fallbackHeaderWeight +
      textWeight(
        [it.row.supportingCopy, it.row.disclaimerText, it.row.contactGuidance],
        !!it.row.websiteUrl,
        compact,
      )
    );
  return SAT_LAYOUT.noteWeight;
};

/** Split the section's rows across as many A4 pages as they need. */
export function paginateSat(block: SatBlock): Item[][] {
  if (block.state === "no_student_score") return [[]];
  const { compact, hideChips, noted } = satLayoutMode(block);
  const items: Item[] = [
    ...block.charted.map((row) => ({ kind: "charted" as const, row })),
    ...block.fallback.map((row) => ({ kind: "fallback" as const, row })),
  ];
  if (block.charted.length > 0) items.push({ kind: "note" });
  const hasSubmitted = block.charted.some((r) => r.submittedOnly);

  const pages: Item[][] = [[]];
  let used = 0;
  // Rows carrying copy are weighed in measured px, so they use the calibrated
  // capacities; plain chart-only sections keep the original ones.
  let cap: number = noted
    ? hideChips
      ? SAT_LAYOUT.compact.firstPageCapacityNoChips
      : SAT_LAYOUT.compact.firstPageCapacity
    : SAT_LAYOUT.firstPageCapacity;
  for (const it of items) {
    const w =
      weightOf(it, compact) +
      (it.kind === "note" && hasSubmitted ? SAT_LAYOUT.submittedNoteExtraWeight : 0);
    if (used + w > cap && pages[pages.length - 1].length > 0) {
      pages.push([]);
      used = 0;
      cap = noted ? SAT_LAYOUT.compact.nextPageCapacity : SAT_LAYOUT.nextPageCapacity;
    }
    pages[pages.length - 1].push(it);
    used += w;
  }
  return pages;
}

export function satPositioningPageCount(block: SatBlock): number {
  return paginateSat(block).length;
}
