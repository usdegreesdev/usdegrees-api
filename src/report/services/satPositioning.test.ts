import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildSatPositioning,
  computeAxis,
  normalizeWebsiteUrl,
  resolveStudentScore,
  type SatCategoryRow,
  type SatCollegeInput,
  type SatConfig,
  type SatStudentInput,
} from "./satPositioning";
import {
  gateSatBlock,
  gateSatCollegeSet,
  gateSatQueries,
  gateSatRenderedNumbers,
} from "./satPositioningGates";
import { satQueryViolations } from "./satPositioning.sql";
import { paginateSat, renderSatSectionHtml } from "../components/SatPositioning";

// ---- fixtures (built here; nothing from production constants) ----
const cfg: SatConfig = {
  scale: { min: 400, max: 1600, step: 10 },
  axis: { pad: 50, tickStep: 100 },
  closedCategory: "CAT_CLOSED",
};

const cat = (over: Partial<SatCategoryRow> & { category: string }): SatCategoryRow => ({
  badge_label: `${over.category} badge`,
  badge_color: "gray",
  supporting_copy: `${over.category} copy`,
  disclaimer_text: null,
  contact_guidance: `${over.category} guidance`,
  show_badge_with_range: false,
  ...over,
});

const NO_DATA = cat({ category: "CAT_NODATA", disclaimer_text: "no-data disclaimer" });
const OPEN = cat({ category: "CAT_OPEN" });
const OPTIONAL = cat({ category: "CAT_OPTIONAL", show_badge_with_range: true });
const NOT_USED = cat({ category: "CAT_NOTUSED", show_badge_with_range: true });
const CLOSED = cat({ category: "CAT_CLOSED" });

let order = 0;
const college = (over: Partial<SatCollegeInput> = {}): SatCollegeInput => {
  const o = order++;
  return {
    unitid: 1000 + o,
    displayOrder: o,
    name: `College ${o}`,
    schoolUrl: "college.example.edu",
    schoolMinRange: 1100,
    schoolMaxRange: 1300,
    publishPublicly: true,
    category: null,
    ...over,
  };
};
const student = (sat_score: number | null = 1200): SatStudentInput => ({
  sat_score,
  sat_math: null,
  sat_reading_writing: null,
});
const build = (s: SatStudentInput, cs: SatCollegeInput[]) =>
  buildSatPositioning(s, cs, NO_DATA, cfg);

// ---- status / gaps / boundaries ----
test("below / within / above with gaps and band position", () => {
  const cs = [
    college({ schoolMinRange: 1300, schoolMaxRange: 1500 }), // below by 100
    college({ schoolMinRange: 1100, schoolMaxRange: 1300 }), // within
    college({ schoolMinRange: 900, schoolMaxRange: 1100 }), // above by 100
  ];
  const b = build(student(1200), cs);
  assert.equal(b.state, "ok");
  const byId = new Map(b.charted.map((r) => [r.unitid, r]));
  const [lo, mid, hi] = cs;
  assert.equal(byId.get(lo.unitid)!.status, "below");
  assert.equal(byId.get(lo.unitid)!.gapPoints, 100);
  assert.equal(byId.get(mid.unitid)!.status, "within");
  assert.equal(byId.get(mid.unitid)!.gapPoints, null);
  assert.equal(byId.get(mid.unitid)!.bandPosition, 50);
  assert.equal(byId.get(hi.unitid)!.status, "above");
  assert.equal(byId.get(hi.unitid)!.gapPoints, 100);
  assert.equal(byId.get(hi.unitid)!.bandPosition, null);
  assert.deepEqual(b.counts, { above: 1, within: 1, below: 1, noData: 0 });
});

test("exact boundaries are within (inclusive)", () => {
  const c = college({ schoolMinRange: 1200, schoolMaxRange: 1400 });
  assert.equal(build(student(1200), [c]).charted[0].status, "within");
  assert.equal(build(student(1200), [c]).charted[0].bandPosition, 0);
  const d = college({ schoolMinRange: 1000, schoolMaxRange: 1200 });
  assert.equal(build(student(1200), [d]).charted[0].status, "within");
  assert.equal(build(student(1200), [d]).charted[0].bandPosition, 100);
});

// ---- student score ----
test("student score validation", () => {
  const sc = (s: SatStudentInput) => resolveStudentScore(s, cfg);
  assert.equal(sc(student(null)), null);
  assert.equal(sc(student(390)), null);
  assert.equal(sc(student(1605)), null);
  assert.equal(sc(student(1415)), null);
  assert.equal(sc(student(400)), 400);
  assert.equal(sc(student(1600)), 1600);
  assert.equal(sc({ sat_score: null, sat_math: 700, sat_reading_writing: 650 }), 1350);
  assert.equal(sc({ sat_score: null, sat_math: 700, sat_reading_writing: null }), null);
  assert.equal(sc({ sat_score: 1200, sat_math: 700, sat_reading_writing: 650 }), 1200);
});

test("no valid student score → no ranges at all", () => {
  const b = build(student(1415), [college(), college({ schoolMinRange: null })]);
  assert.equal(b.state, "no_student_score");
  assert.equal(b.charted.length, 0);
  assert.equal(b.fallback.length, 0);
  assert.equal(b.axis, null);
  assert.equal(b.collegeIds.length, 2);
  assert.deepEqual(gateSatBlock(b, cfg), []);
});

// ---- category / fallback resolution ----
test("null category + no range → G_NO_SCORE_DATA fallback", () => {
  const c = college({ schoolMinRange: null, schoolMaxRange: null, category: null });
  const b = build(student(), [c]);
  assert.equal(b.state, "no_college_data");
  assert.equal(b.axis, null);
  const f = b.fallback[0];
  assert.equal(f.badge.label, NO_DATA.badge_label);
  assert.equal(f.supportingCopy, NO_DATA.supporting_copy);
  assert.equal(f.disclaimerText, "no-data disclaimer");
  assert.equal(f.contactGuidance, NO_DATA.contact_guidance);
  assert.equal(f.websiteUrl, "https://college.example.edu/");
});

test("category with show_badge_with_range → charted + badge (optional, not-used)", () => {
  for (const category of [OPTIONAL, NOT_USED]) {
    const b = build(student(), [college({ category })]);
    assert.equal(b.charted.length, 1);
    assert.deepEqual(b.charted[0].badge, {
      label: category.badge_label,
      color: category.badge_color,
    });
  }
});

test("open admission with a range → charted, no badge", () => {
  const b = build(student(), [college({ category: OPEN })]);
  assert.equal(b.charted.length, 1);
  assert.equal(b.charted[0].badge, null);
});

test("closed institution → fallback with its own copy and no link", () => {
  const b = build(student(), [college({ category: CLOSED })]);
  assert.equal(b.charted.length, 0);
  assert.equal(b.fallback[0].badge.label, CLOSED.badge_label);
  assert.equal(b.fallback[0].websiteUrl, null);
});

test("publish_publicly=false → fallback with no link", () => {
  const b = build(student(), [college({ publishPublicly: false, category: OPEN })]);
  assert.equal(b.charted.length, 0);
  assert.equal(b.fallback[0].websiteUrl, null);
});

test("invalid ranges fall back (null end, inverted, out of scale)", () => {
  const bad = [
    college({ schoolMinRange: 1100, schoolMaxRange: null }),
    college({ schoolMinRange: 1300, schoolMaxRange: 1100 }),
    college({ schoolMinRange: 1200, schoolMaxRange: 1200 }),
    college({ schoolMinRange: 300, schoolMaxRange: 1200 }),
    college({ schoolMinRange: 1200, schoolMaxRange: 1700 }),
  ];
  const b = build(student(), bad);
  assert.equal(b.charted.length, 0);
  assert.equal(b.fallback.length, bad.length);
});

test("non-multiple-of-10 ranges are kept as-is", () => {
  const b = build(student(1000), [college({ schoolMinRange: 998, schoolMaxRange: 1213 })]);
  assert.equal(b.charted[0].p25, 998);
  assert.equal(b.charted[0].p75, 1213);
});

// ---- URL normalization ----
test("URL normalization", () => {
  assert.equal(normalizeWebsiteUrl("  www.example.edu  "), "https://www.example.edu/");
  assert.equal(normalizeWebsiteUrl("http://example.edu/admissions"), "http://example.edu/admissions");
  assert.equal(normalizeWebsiteUrl("https://example.edu"), "https://example.edu/");
  assert.equal(normalizeWebsiteUrl(""), null);
  assert.equal(normalizeWebsiteUrl("   "), null);
  assert.equal(normalizeWebsiteUrl(null), null);
  assert.equal(normalizeWebsiteUrl("not a url"), null);
  assert.equal(normalizeWebsiteUrl("localhost"), null);
  assert.equal(normalizeWebsiteUrl("ftp://example.edu"), null);
  assert.equal(normalizeWebsiteUrl("mailto:a@example.edu"), null);
});

// ---- axis ----
test("axis pads, snaps to the tick step and clamps to the scale", () => {
  assert.deepEqual(computeAxis(1200, [{ p25: 1100, p75: 1300 }], cfg), {
    min: 1000,
    max: 1400,
    ticks: [1000, 1100, 1200, 1300, 1400],
  });
  // pad/snap → 1000..1400 would be 975→900 low side: lo=1020 → floor(970/100)*100 = 900
  assert.equal(computeAxis(1020, [{ p25: 1100, p75: 1300 }], cfg).min, 900);
  // clamped at both ends of the SAT scale, ends still labelled
  const lo = computeAxis(420, [{ p25: 450, p75: 600 }], cfg);
  assert.equal(lo.min, 400);
  assert.equal(lo.ticks[0], 400);
  const hi = computeAxis(1590, [{ p25: 1500, p75: 1580 }], cfg);
  assert.equal(hi.max, 1600);
  assert.equal(hi.ticks[hi.ticks.length - 1], 1600);
  // axis always contains every value
  const wide = computeAxis(800, [{ p25: 1100, p75: 1500 }], cfg);
  assert.ok(wide.min <= 800 && wide.max >= 1500);
});

// ---- sorting ----
test("sorted by midpointDelta desc, ties by display order", () => {
  const a = college({ schoolMinRange: 1100, schoolMaxRange: 1300 }); // delta 0
  const b = college({ schoolMinRange: 900, schoolMaxRange: 1100 }); //  delta +200
  const c = college({ schoolMinRange: 1100, schoolMaxRange: 1300 }); // delta 0 (tie with a)
  const d = college({ schoolMinRange: 1300, schoolMaxRange: 1500 }); // delta -200
  const out = build(student(1200), [d, c, a, b]).charted.map((r) => r.unitid);
  assert.deepEqual(out, [b.unitid, a.unitid, c.unitid, d.unitid]); // a before c: lower display order
});

test("fallback rows keep display order; duplicates collapse to one college", () => {
  const f1 = college({ schoolMinRange: null, schoolMaxRange: null });
  const f2 = college({ schoolMinRange: null, schoolMaxRange: null });
  const dup = { ...f1, displayOrder: 99 };
  const b = build(student(), [f2, dup, f1]);
  assert.deepEqual(b.fallback.map((r) => r.unitid), [f1.unitid, f2.unitid]);
  assert.deepEqual(b.collegeIds, [f1.unitid, f2.unitid]);
});

// ---- report shapes ----
test("all-fallback and single-college reports", () => {
  const all = build(student(), [
    college({ schoolMinRange: null, schoolMaxRange: null }),
    college({ category: CLOSED }),
  ]);
  assert.equal(all.state, "no_college_data");
  assert.equal(all.counts.noData, 2);
  const single = build(student(), [college()]);
  assert.equal(single.state, "ok");
  assert.equal(single.charted.length, 1);
});

// ---- gates ----
test("gates pass on a mixed block and catch tampering", () => {
  const cs = [
    college({ schoolMinRange: 1300, schoolMaxRange: 1500, category: OPTIONAL }),
    college({ schoolMinRange: null, schoolMaxRange: null }),
  ];
  const b = build(student(1200), cs);
  assert.deepEqual(gateSatBlock(b, cfg), []);
  assert.deepEqual(gateSatCollegeSet(b, cs.map((c) => c.unitid)), []);
  assert.deepEqual(gateSatQueries(), []);

  const tampered = structuredClone(b);
  tampered.charted[0].status = "within";
  assert.ok(gateSatBlock(tampered, cfg).length > 0);
  assert.ok(gateSatCollegeSet(b, [cs[0].unitid]).length > 0); // extra college
  assert.ok(gateSatCollegeSet(b, [...cs.map((c) => c.unitid), 7]).length > 0); // missing
  const noContact = structuredClone(b);
  noContact.fallback[0].contactGuidance = "";
  assert.ok(gateSatBlock(noContact, cfg).length > 0);
  const badUrl = structuredClone(b);
  badUrl.fallback[0].websiteUrl = "javascript:alert(1)";
  assert.ok(gateSatBlock(badUrl, cfg).length > 0);
});

test("query layer rejects synthetic SAT sources", () => {
  for (const bad of [
    "SELECT sat_rw_min FROM admissions",
    "SELECT sat_math_max FROM admissions",
    "SELECT sat_mid_reading FROM admissions",
    "SELECT sat_avg_overall FROM admissions",
    "SELECT * FROM admissions_sat_ui",
    "SELECT sat_p25_math FROM admissions",
    "SELECT * FROM temp_sat",
  ])
    assert.ok(satQueryViolations(bad).length > 0, bad);
  assert.deepEqual(satQueryViolations("SELECT school_min_range, school_max_range FROM admissions"), []);
});

test("rendered section: numbers trace to the payload; pagination holds any N", () => {
  const cs = [
    college({ schoolMinRange: 1300, schoolMaxRange: 1500, category: OPTIONAL }),
    college({ schoolMinRange: 1100, schoolMaxRange: 1300 }),
    college({ schoolMinRange: 900, schoolMaxRange: 1100 }),
    college({ schoolMinRange: null, schoolMaxRange: null, category: null }),
  ];
  const b = build(student(1200), cs);
  const html = renderSatSectionHtml(b);
  assert.deepEqual(gateSatRenderedNumbers(html, b), []);
  assert.match(html, /Your 1200 SAT/);
  assert.match(html, /href="https:\/\/college\.example\.edu\/"/);
  assert.match(html, /−100 pts/);
  assert.match(html, /\+100 pts/);

  // A number that isn't in the payload is caught.
  assert.ok(gateSatRenderedNumbers(html + "<p>9999</p>", b).length > 0);

  // Many colleges paginate; every row appears exactly once.
  const many = Array.from({ length: 25 }, () => college());
  const mb = build(student(1200), many);
  const pages = paginateSat(mb);
  assert.ok(pages.length > 1);
  const rowCount = pages.flat().filter((i) => i.kind !== "note").length;
  assert.equal(rowCount, 25);
  assert.deepEqual(gateSatRenderedNumbers(renderSatSectionHtml(mb), mb), []);

  // No student score: only the prompt, no ranges rendered.
  const ns = build(student(null), cs);
  const nsHtml = renderSatSectionHtml(ns);
  assert.doesNotMatch(nsHtml, /Mid 50%/);
  assert.equal(paginateSat(ns).length, 1);
});
