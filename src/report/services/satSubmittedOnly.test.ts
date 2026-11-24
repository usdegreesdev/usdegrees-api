import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildSatPositioning,
  type SatCategoryRow,
  type SatCollegeInput,
} from "./satPositioning";
import { gateSatBlock, gateSatRenderedNumbers } from "./satPositioningGates";
import { renderSatSectionHtml } from "../components/SatPositioning";
import { satCopy } from "../copy/satPositioning.copy";
import {
  FIT_NA_SUBMITTED_REASON,
  isSubmittedOnlyCategory,
} from "../config/satPositioning.config";
import { buildFallbackNarrative } from "./reportPrompt";
import { computeDerivedFlags } from "./reportPayload.service";

const cat = (category: string, over: Partial<SatCategoryRow> = {}): SatCategoryRow => ({
  category,
  badge_label: `${category} badge`,
  badge_color: "gray",
  supporting_copy: `SUPPORTING[${category}]`,
  disclaimer_text: `DISCLAIMER[${category}]`,
  contact_guidance: `CONTACT[${category}]`,
  show_badge_with_range: true,
  ...over,
});
const NO_DATA = cat("G_NO_SCORE_DATA", { show_badge_with_range: false });
const H = cat("H_TEST_CONSIDERED");
const C = cat("C_TEST_OPTIONAL");
const REQUIRED = cat("B_NOT_USED");

let n = 0;
const college = (category: SatCategoryRow | null, min: number, max: number): SatCollegeInput => {
  const o = n++;
  return {
    unitid: 5000 + o,
    displayOrder: o,
    name: `School ${o}`,
    schoolUrl: null,
    schoolMinRange: min,
    schoolMaxRange: max,
    publishPublicly: true,
    category,
  };
};
const stu = (s: number) => ({ sat_score: s, sat_math: null, sat_reading_writing: null });
const text = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");

test("label mapping: below / within / above for submitted-only categories", () => {
  for (const c of [H, C]) {
    const b = buildSatPositioning(
      stu(1300),
      [college(c, 1400, 1500), college(c, 1141, 1388), college(c, 1000, 1200)],
      NO_DATA,
    );
    const t = text(renderSatSectionHtml(b));
    assert.ok(t.includes("Below the range of students who submitted scores"));
    assert.ok(t.includes("Within the range of students who submitted scores"));
    assert.ok(t.includes("Above the range of students who submitted scores"));
    assert.ok(t.includes("Above the 75th percentile of students who submitted scores"));
    assert.ok(t.includes("Most students who submitted scores scored higher"));
    assert.ok(t.includes("% of the way through the middle 50%"));
    assert.ok(!t.includes("enrolled students who reported"));
    assert.ok(!/\bAbove range\b|\bWithin range\b|\bBelow range\b/.test(t.replace(/\d+ (above|within|below) range/g, "")));
  }
});

test("no fit/stretch language and neutral heading; entered order kept", () => {
  const b = buildSatPositioning(
    stu(1300),
    [college(H, 1400, 1500), college(REQUIRED, 1000, 1200), college(H, 1141, 1388)],
    NO_DATA,
  );
  const base = b.charted[0].displayOrder;
  const html = renderSatSectionHtml(b);
  assert.ok(html.includes("Your 1300 SAT against each school&#x27;s reported range") ||
    html.includes("Your 1300 SAT against each school's reported range"));
  assert.ok(!/\bfit\b|stretch/i.test(text(html)));
  assert.deepEqual(b.charted.map((r) => r.displayOrder - base), [0, 1, 2]);
});

test("grove city case: within range, DB copy, no fit language", () => {
  const b = buildSatPositioning(stu(1300), [college(H, 1141, 1388)], NO_DATA);
  const t = text(renderSatSectionHtml(b));
  assert.ok(t.includes("Within the range of students who submitted scores"));
  assert.ok(!/\bfit\b|stretch/i.test(t));
  assert.deepEqual(gateSatBlock(b), []);
});

test("copy comes from the database row, contact guidance last", () => {
  const custom = cat("H_TEST_CONSIDERED", {
    supporting_copy: "zzz-support-from-db",
    disclaimer_text: "zzz-disclaimer-from-db",
    contact_guidance: "zzz-contact-from-db",
  });
  const t = text(renderSatSectionHtml(buildSatPositioning(stu(1300), [college(custom, 1141, 1388)], NO_DATA)));
  const s = t.indexOf("zzz-support-from-db");
  const d = t.indexOf("zzz-disclaimer-from-db");
  const c = t.indexOf("zzz-contact-from-db");
  assert.ok(s >= 0 && d > s && c > d);
  assert.ok(t.indexOf("zzz-contact-from-db") > t.indexOf("Within the range"));
  // never rendered for other categories
  const other = text(renderSatSectionHtml(buildSatPositioning(stu(1300), [college(REQUIRED, 1141, 1388)], NO_DATA)));
  assert.ok(!other.includes("SUPPORTING[") && !other.includes("CONTACT["));
});

const plain = (html: string) =>
  text(html).replace(/&amp;/g, "&").replace(/&#x27;/g, "'");

test("one merged chart note when a submitted-only school is charted", () => {
  const withH = plain(renderSatSectionHtml(buildSatPositioning(stu(1300), [college(H, 1141, 1388)], NO_DATA)));
  assert.ok(withH.includes(
    "Range = middle 50% of enrolled students who submitted SAT scores (Reading & Writing plus Math 25th/75th percentiles, an approximation of the composite). For schools that consider scores if submitted, it may sit higher than the typical applicant.",
  ));
  // the old note and the separate footnote are gone
  assert.ok(!withH.includes("Blue band"));
  assert.ok(!withH.includes("the range reflects only students who submitted scores and may sit"));
  assert.equal((withH.match(/Source: IPEDS/g) ?? []).length, 1);
  const without = plain(renderSatSectionHtml(buildSatPositioning(stu(1300), [college(REQUIRED, 1141, 1388)], NO_DATA)));
  assert.ok(without.includes("Blue band = middle 50% of first-year students who enrolled and reported SAT scores"));
  assert.ok(!without.includes("consider scores if submitted"));
});

test("summary chips: submitted wording only on pages with a submitted-only school", () => {
  const mixed = plain(renderSatSectionHtml(buildSatPositioning(
    stu(1300),
    [college(H, 1400, 1500), college(H, 1141, 1388), college(C, 1000, 1200)],
    NO_DATA,
  )));
  assert.ok(mixed.includes("1 below the submitted range"));
  assert.ok(mixed.includes("1 within the submitted range"));
  assert.ok(mixed.includes("1 above the submitted range"));
  assert.ok(!/\d (above|within|below) range/.test(mixed));
  const other = plain(renderSatSectionHtml(buildSatPositioning(
    stu(1300), [college(REQUIRED, 1400, 1500), college(REQUIRED, 1000, 1200)], NO_DATA,
  )));
  assert.ok(other.includes("1 below range") && other.includes("1 above range"));
  assert.ok(!other.includes("submitted range"));
});

test("score-position flags exclude H and C schools only", () => {
  const sch = (name: string, category: string, p25: number, p75: number): any => ({
    display_name: name, sat_data_category: category, sat_25: p25, sat_75: p75,
    net_price_bracket: null, program_earnings: null, avg_debt: null,
  });
  const f = computeDerivedFlags(1300, [
    sch("HHigh", "H_TEST_CONSIDERED", 1000, 1200), // would be above p75
    sch("HLow", "H_TEST_CONSIDERED", 1400, 1500),  // would be below p25
    sch("COpt", "C_TEST_OPTIONAL", 1000, 1200),
    sch("COptLow", "C_TEST_OPTIONAL", 1400, 1500),
    sch("Used", "B_NOT_USED", 1000, 1200),         // above p75
    sch("Used2", "B_NOT_USED", 1400, 1500),        // below p25
  ]);
  assert.deepEqual(f.above_p75_schools, ["Used"]);
  assert.deepEqual(f.below_p25_schools, ["Used2"]);
});

test("other categories are unchanged (old labels, fit heading, fit sort)", () => {
  const b = buildSatPositioning(
    stu(1300),
    [college(REQUIRED, 1400, 1500), college(REQUIRED, 1000, 1200)],
    NO_DATA,
  );
  const html = renderSatSectionHtml(b);
  assert.ok(html.includes("from strongest fit to biggest stretch"));
  assert.ok(html.includes("Above range") && html.includes("Below range"));
  assert.deepEqual(b.charted.map((r) => r.displayOrder - b.charted[1].displayOrder), [1, 0]);
  assert.ok(b.charted.every((r) => !r.submittedOnly && r.supportingCopy === null));
});

test("rendered-number gate passes with the new copy", () => {
  const b = buildSatPositioning(stu(1300), [college(H, 1141, 1388), college(C, 1000, 1200)], NO_DATA);
  assert.deepEqual(gateSatRenderedNumbers(renderSatSectionHtml(b), b), []);
});

test("category recognition and page-4 reason", () => {
  assert.ok(isSubmittedOnlyCategory("H_TEST_CONSIDERED"));
  assert.ok(isSubmittedOnlyCategory("C_TEST_OPTIONAL"));
  assert.ok(!isSubmittedOnlyCategory("B_NOT_USED"));
  const mk = (name: string, category: string): any => ({
    display_name: name, name, unitid: "1", fit_label: "Not applicable", fit_score: null,
    sat_data_category: category, sat_25: 1141, sat_75: 1388,
    disclosure: { supporting_copy: "SC", badge_label: "Scores Considered If Submitted" }, program_earnings: null,
    net_price_bracket: null, net_price_vintage: null,
  });
  const payload: any = {
    schools: [mk("Grove", "H_TEST_CONSIDERED"), mk("Open U", "A_OPEN_ADMISSION")],
    derived_flags: { above_p75_schools: [], below_p25_schools: [] },
    student: { display_name: "S", sat_score: 1300, income_bracket_label: null },
  };
  const n2 = buildFallbackNarrative(payload);
  assert.ok(n2.fit_sentences[0].sentence.startsWith(`Scores Considered If Submitted: ${FIT_NA_SUBMITTED_REASON}`));
  assert.ok(n2.fit_sentences[1].sentence.startsWith("Academic Fit: Not applicable."));
});
