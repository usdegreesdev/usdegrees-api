import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  figureCompleteness,
  figureRowText,
  MISSING_REASONS,
  resolveFigure,
  schoolFigures,
  typicalDebtFootnote,
  NO_AID_BOX_TEXT,
} from "./utils/missingValue";
import ExecutiveSummary from "./components/ExecutiveSummary";
import StudentProfile from "./components/StudentProfile";
import CareerOutcomes from "./components/CareerOutcomes";
import Methodology from "./components/Methodology";
import { buildFallbackNarrative, buildPromptText } from "./services/reportPrompt";
import { computeDerivedFlags } from "./services/reportPayload.service";

const strip = (h: string) =>
  h.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");

function school(name: string, o: any): any {
  return {
    name, display_name: name, program_name: null, unitid: "1", disclosure: { supporting_copy: "" },
    net_price_bracket: null, program_earnings: null, avg_debt: null, federal_aid_status: "unknown",
    debt_income_ratio: null, debt_income_ratio_display: null, debt_income_earnings: null,
    debt_income_basis_label: "6 years after first enrolling", sat_25: null, sat_75: null,
    admit_rate: null, fit_label: "Not applicable", sat_data_category: "E_TEST_REQUIRED_NO_RANGE",
    earnings_method_flag: null, ...o,
  };
}
const SCHOOLS = [
  school("Eastern Illinois University", { net_price_bracket: 9813, program_earnings: 87447, earnings_vintage: 2016, earnings_year_1: 52000, earnings_year_1_vintage: 2022, avg_debt: 15722, federal_aid_status: "participates" }),
  school("Grove City College", { federal_aid_status: "no_federal_aid", avg_debt: 0 }),
  school("Illinois Eastern Community Colleges", { net_price_bracket: 5965, avg_debt: 5500, federal_aid_status: "participates" }),
];
const PAYLOAD: any = {
  report_meta: { generated_date: "November 17, 2026" },
  student: { display_name: "S", income_bracket_label: "$48k–$75k", sat_score: null },
  schools: SCHOOLS,
  derived_flags: { above_p75_schools: [], below_p25_schools: [] },
  federal_aid_fetched_on: "2026-11-16", college_details: [],
};
const NARR: any = {
  executive_summary: "x", two_minute_lines: [],
  net_price_note: "n", earnings_paragraph: "e", debt_burden_paragraph: "d",
};
const props = { payload: PAYLOAD, narrative: NARR, reportId: "T", generatedDate: "t", pageNumber: 1, totalPages: 1 };
const render = (C: any, p: any = props) => renderToStaticMarkup(React.createElement(C, p));

test("reason logic: value, zero, null, no_federal_aid, unknown", () => {
  assert.equal(resolveFigure("typical_debt", 15722, "participates").display, "$15,722");
  for (const missing of [0, null, undefined]) {
    assert.equal(resolveFigure("typical_debt", missing as any, "participates").reason, MISSING_REASONS.notPublishedScorecard);
    assert.equal(resolveFigure("typical_debt", missing as any, "no_federal_aid").reason, "takes no federal student aid");
    assert.equal(resolveFigure("net_price", missing as any, "no_federal_aid").reason, "takes no federal student aid");
    assert.equal(resolveFigure("net_price", missing as any, null).reason, "Not published");
    assert.equal(resolveFigure("net_price", missing as any, "unknown" as any).reason, "Not published");
    // program earnings never depend on aid status
    assert.equal(resolveFigure("program_earnings", missing as any, "no_federal_aid").reason, "Not published");
    assert.equal(resolveFigure("program_earnings", missing as any, null).reason, "Not published");
  }
  assert.equal(resolveFigure("typical_debt", 0, "participates").value, null); // 0 is never a value
  assert.equal(resolveFigure("net_price", 9813, "no_federal_aid").value, 9813); // value wins over status
});

test("completeness counts", () => {
  const c = figureCompleteness(SCHOOLS);
  assert.deepEqual([c.total, c.net_price, c.program_earnings, c.typical_debt], [3, 2, 1, 2]);
  assert.ok(c.line.includes("net price 2 of 3, program earnings 1 of 3, school-wide debt 2 of 3"));
});

test("executive summary rows: order preserved, reasons per school, no range", () => {
  const rows = figureRowText(SCHOOLS, "net_price");
  assert.equal(rows, "Eastern Illinois University $9,813 · Grove City College takes no federal student aid · Illinois Eastern Community Colleges $5,965");
  assert.equal(
    figureRowText(SCHOOLS, "program_earnings"),
    "Eastern Illinois University $87,447 (year 10 after graduation; 2016 cohort); same cohort: year 1 $52,000 · Grove City College Not published · Illinois Eastern Community Colleges Not published",
  );
  assert.equal(
    figureRowText(SCHOOLS, "typical_debt"),
    "Eastern Illinois University $15,722 · Grove City College takes no federal student aid · Illinois Eastern Community Colleges $5,500",
  );
  const rev = figureRowText([...SCHOOLS].reverse(), "net_price");
  assert.ok(rev.startsWith("Illinois Eastern") && rev.endsWith("$9,813")); // follows input order, never sorted
});

const RANGE_WORDS = /ranges? from|range across|cost_range|earnings_range|debt_range|lowest to highest|COST & OUTCOMES RANGE/i;

test("pages 4, 5, 6 render with reasons and no range text", () => {
  const p4 = strip(render(ExecutiveSummary));
  const p5 = strip(render(StudentProfile));
  const p6 = strip(render(CareerOutcomes));
  console.log("\n--- PAGE 4 ---\n" + p4 + "\n--- PAGE 5 ---\n" + p5 + "\n--- PAGE 6 ---\n" + p6);
  assert.ok(p4.includes("Net price Eastern Illinois University $9,813 · Grove City College takes no federal student aid · Illinois Eastern Community Colleges $5,965"));
  assert.ok(p4.includes("Figures published: net price 2 of 3, program earnings 1 of 3, school-wide debt 2 of 3."));
  for (const t of [p4, p5, p6]) {
    assert.ok(!RANGE_WORDS.test(t));
    assert.ok(!t.includes("$0 *") && !t.includes("may indicate"));
  }
  assert.ok(p5.includes(NO_AID_BOX_TEXT));
  assert.ok(p6.includes(NO_AID_BOX_TEXT));
  assert.equal(p6.split(NO_AID_BOX_TEXT).length - 1, 1); // one box, Grove City only
  assert.ok(p6.includes("Not published")); // Illinois Eastern program earnings
  assert.ok(p6.includes(typicalDebtFootnote(["Grove City College"])));
  assert.ok(p6.includes("do not apply to Grove City College"));
});

test("footnote text exact", () => {
  assert.equal(
    typicalDebtFootnote(["Grove City College"]),
    "School-wide median federal debt of completers is shown only where College Scorecard publishes it. A school that takes no federal student aid has no federal-loan debt figure; that is not the same as zero debt. Federal-loan debt and net price do not apply to Grove City College, which takes no federal student aid. Net price is shown as 'Not published' where Scorecard has no figure. This report shows school-wide debt. Program-level debt is not included.",
  );
});

test("methodology has Missing figures block", () => {
  const m = strip(render(Methodology));
  assert.ok(m.includes("Missing figures"));
  assert.ok(m.includes("Title IV eligibility type"));
  assert.ok(m.includes("snapshot fetched on 2026-11-16"));
  assert.ok(m.includes("Census PSEO"));
});

test("prompt and fallback contain no range wording", () => {
  const pay = { ...PAYLOAD, schools: SCHOOLS.map((s) => ({ ...s, figures: schoolFigures(s) })), figure_completeness: figureCompleteness(SCHOOLS) };
  const prompt = buildPromptText(pay);
  assert.ok(!/cost_range|earnings_range|debt_range|ranges from|Range across/i.test(prompt));
  assert.ok(prompt.includes("never describe a missing figure as $0".replace("never", "Never")) || prompt.includes("Never describe a\nmissing figure as $0") || /Never describe a\s+missing figure as \$0/.test(prompt));
  const n = buildFallbackNarrative(PAYLOAD);
  const all = JSON.stringify(n);
  assert.ok(!/ranges? from|Range across|ranges from/i.test(all));
  assert.ok(n.debt_burden_paragraph.includes("Grove City College: school-wide median federal debt of completers takes no federal student aid"));
  assert.ok(n.earnings_paragraph.includes("Grove City College: Not published"));
  assert.ok(!all.includes("$0"));
});

test("derived flags no longer carry ranges", () => {
  const f: any = computeDerivedFlags(null, SCHOOLS);
  assert.deepEqual(Object.keys(f).sort(), ["above_p75_schools", "below_p25_schools"]);
});

test("page 4: no Decision Context, first year in the earnings box, values bold, no bottom disclaimer", () => {
  const html = render(ExecutiveSummary);
  const p4 = strip(html);
  assert.ok(!p4.includes("Decision Context"));
  assert.ok(!p4.includes("For context"));
  assert.ok(/\$87,447\s*\(year 10 after graduation; 2016 cohort\)\s*; same cohort: year 1\s*\$52,000/.test(p4));
  for (const v of ["$9,813", "$5,965", "$87,447", "$52,000", "$15,722", "$5,500"]) {
    assert.ok(html.includes(`<strong>${v}</strong>`), v);
  }
  assert.ok(!html.includes("<strong>takes no federal"));
  const t = figureRowText([{ ...SCHOOLS[0], earnings_vintage: null, earnings_year_1: null }], "program_earnings");
  assert.equal(t, "Eastern Illinois University $87,447 (year 10 after graduation; cohort year not recorded)");
});
