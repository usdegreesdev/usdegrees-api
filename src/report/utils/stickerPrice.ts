/**
 * Sticker price scenarios, computed in code from the four cost components.
 * A missing (null/undefined) component is NEVER treated as 0 — a real 0 is a
 * valid value, null is not. Never reads costs.for_roi_data / outstate_offcampus.
 */

export interface StickerComponents {
  tuition_in_state?: number | null;
  tuition_out_state?: number | null;
  roomboard_oncampus?: number | null;
  roomboard_offcampus?: number | null;
  booksupply?: number | null;
  otherexpense_oncampus?: number | null;
  otherexpense_offcampus?: number | null;
}

export type StickerScenario =
  | { published: true; total: number; missing: [] }
  | { published: false; total: null; missing: string[] };

function sumAll(parts: Array<[string, number | null | undefined]>): StickerScenario {
  const missing = parts.filter(([, v]) => v == null || Number.isNaN(Number(v))).map(([n]) => n);
  if (missing.length) return { published: false, total: null, missing };
  const total = Math.round(parts.reduce((a, [, v]) => a + Number(v), 0));
  return { published: true, total, missing: [] };
}

export function inStateOnCampus(c: StickerComponents): StickerScenario {
  return sumAll([
    ["in-state tuition", c.tuition_in_state],
    ["on-campus room and board", c.roomboard_oncampus],
    ["books and supplies", c.booksupply],
    ["on-campus other expenses", c.otherexpense_oncampus],
  ]);
}

export function outOfStateOffCampus(c: StickerComponents): StickerScenario {
  return sumAll([
    ["out-of-state tuition", c.tuition_out_state],
    ["off-campus room and board", c.roomboard_offcampus],
    ["books and supplies", c.booksupply],
    ["off-campus other expenses", c.otherexpense_offcampus],
  ]);
}

export const STICKER_FOOTNOTE =
  "Sticker price is the published price before financial aid. The first two columns show what one student would be charged in a stated situation, built from the components above. 'Not published' means at least one of those components is not published, so no total is shown. College Scorecard's average cost of attendance is a different measure: it averages living costs across students who live on campus, off campus and with family, so it can be lower or higher than either scenario. Net price is the average after grants and scholarships for your income range.";

export const STICKER_METHODOLOGY =
  "Cost of attendance: the two sticker price columns are sums of the components shown, for a student paying in-state tuition and living on campus, or out-of-state tuition and living off campus. Scorecard's average cost of attendance combines tuition and fees, books and supplies, and a weighted average of living expenses across on-campus, off-campus and with-family students. The three figures are not interchangeable.";

/** Prompt-ready text for one scenario / the Scorecard figure. */
export function scenarioDisplay(s: StickerScenario): string {
  return s.published
    ? `$${s.total.toLocaleString("en-US")}`
    : `Not published (missing: ${s.missing.join(", ")})`;
}
