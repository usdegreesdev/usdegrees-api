import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  computeDebtIncomeRatio,
  DEBT_RATIO_BASIS,
  debtRatioDefinitions,
  debtRatioDefinitionText,
  debtRatioDisclaimer,
  debtRatioRefreshed,
  debtRatioQuery,
  formatDebtIncomeRatio,
  MISSING_RATIO_TEXT,
  ratioNumeral,
  resolveDebt,
  schoolEarningsColumnLabel,
} from "./utils/debtRatio";
import CareerOutcomes from "./components/CareerOutcomes";
import Methodology from "./components/Methodology";
import { buildFallbackNarrative, buildPromptText } from "./services/reportPrompt";

// Rows as the debtRatioQuery join returns them (avg_debt numeric -> string).
const EIU = { avg_debt: "15722", basis_earnings: 45299 };
const MID = { avg_debt: "5500", basis_earnings: 40351 };
const NO_LOANS = { avg_debt: "0", basis_earnings: null };

test("ratio is computed from avg_debt and the basis earnings", () => {
  assert.equal(resolveDebt(EIU).ratio, 0.35);
  assert.equal(resolveDebt(EIU).earnings, 45299);
  assert.equal(resolveDebt(EIU).avg_debt, 15722);
  assert.equal(resolveDebt(MID).ratio, 0.14);
});

test("null / zero debt or earnings gives no ratio", () => {
  assert.equal(resolveDebt(NO_LOANS).ratio, null);
  assert.equal(computeDebtIncomeRatio(0, 45000), null); // 0 = no federal loans
  assert.equal(computeDebtIncomeRatio(null, 45000), null);
  assert.equal(computeDebtIncomeRatio(15000, null), null);
  assert.equal(computeDebtIncomeRatio(15000, 0), null);
  assert.equal(computeDebtIncomeRatio(-5, 45000), null);
  assert.equal(computeDebtIncomeRatio(NaN, 45000), null);
  assert.equal(resolveDebt(undefined).ratio, null);
});

test("rounding, rounded-zero rule and X.XX : 1 format", () => {
  assert.equal(computeDebtIncomeRatio(15722, 45299), 0.35);
  assert.equal(computeDebtIncomeRatio(5500, 40351), 0.14);
  assert.equal(computeDebtIncomeRatio(10, 100000), null); // rounds to 0.00
  assert.equal(formatDebtIncomeRatio(0.35), "0.35 : 1");
  assert.equal(formatDebtIncomeRatio(0.3), "0.30 : 1");
  assert.equal(ratioNumeral(0.3), "0.30");
  for (const v of [null, undefined, 0, NaN]) {
    assert.equal(formatDebtIncomeRatio(v as any), MISSING_RATIO_TEXT);
  }
  assert.equal(MISSING_RATIO_TEXT, "cannot be calculated due to missing values");
});

test("query selects only avg_debt and the one configured earnings column", () => {
  const q = debtRatioQuery();
  assert.ok(q.includes(`e.${DEBT_RATIO_BASIS.column}`));
  assert.equal((q.match(/earn_\w+/g) ?? []).length, 1);
  assert.ok(!/avg_income|debt_income_ratio\b(?!\s+d)/.test(q.replace("FROM debt_income_ratio d", "")));
});

function schoolRow(name: string, avgDebt: number | null, earn: number | null): any {
  const ratio = computeDebtIncomeRatio(avgDebt, earn);
  return {
    name, display_name: name, program_name: null, program_earnings: 87447,
    avg_debt: avgDebt, disclosure: { supporting_copy: "" },
    debt_income_ratio: ratio, debt_income_ratio_display: ratioNumeral(ratio),
    debt_income_earnings: earn, debt_income_basis_label: DEBT_RATIO_BASIS.label,
  };
}

const SAMPLE_PAYLOAD: any = {
  report_meta: { generated_date: "November 16, 2026" },
  schools: [{ ...schoolRow("Eastern Illinois University", 15722, 45299), debt_income_earnings_fetched_on: "2026-10-12" }],
};

function renderSection(): string {
  const payload: any = {
    schools: [
      schoolRow("Eastern Illinois University", 15722, 45299),
      schoolRow("Mid College", 5500, 40351),
      schoolRow("No Loans College", 0, null),
    ],
  };
  return renderToStaticMarkup(
    React.createElement(CareerOutcomes, {
      payload, narrative: { earnings_paragraph: "e", debt_burden_paragraph: "d" } as any,
      reportId: "T", generatedDate: "today", pageNumber: 1, totalPages: 1,
    }),
  );
}

function renderMethodology(): string {
  return renderToStaticMarkup(
    React.createElement(Methodology as any, { payload: SAMPLE_PAYLOAD, reportId: "T", generatedDate: "t", pageNumber: 1, totalPages: 1 }),
  );
}

test("rendered section: 0.35 / 0.14 / missing, new note, no old wording", () => {
  const html = renderSection();
  assert.ok(html.includes("0.35 : 1"));
  assert.ok(html.includes("0.14 : 1"));
  // school-level earnings column (the ratio's denominator) beside Median Earnings (Yr 10)
  assert.ok(html.includes("Median Earnings (Yr 6)"));
  assert.ok(html.includes("Median Earnings (Yr 10)"));
  assert.ok(html.includes("$45,299") && html.includes("$40,351"));
  assert.ok(html.includes("cannot be calculated due to missing values"));
  for (const bad of ["0.32 : 1", "0.18", "0.00 : 1", "1:3.1", "Cannot be calculated", "school-wide average earnings"]) {
    assert.ok(!html.includes(bad), bad);
  }
  assert.ok(html.includes("Debt-to-income ratio = school-wide median federal debt of completers ÷ school-wide median earnings 6 years after first enrolling (College Scorecard). Debt is for students who completed; Year-6 earnings cover all entrants who received federal aid."));
});

test("methodology text", () => {
  const html = renderMethodology();
  // One combined, short Debt-to-Income bullet; no separate "How to read" block.
  assert.ok(html.includes("The school-wide median federal debt of completers ÷ the school&#x27;s median earnings 6 years after students first enrolled (College Scorecard; debt field aid.median_debt.completers.overall;"));
  assert.ok(html.includes("It describes the whole school, not the program shown"));
  assert.ok(!html.includes("How to read the debt-to-income figures"));
  assert.ok(!html.includes("20-Year ROI"));
  assert.ok(!html.includes("reported as stored"));
  assert.ok(!html.includes("reported as-is"));
});

test("prompt + fallback follow the basis", () => {
  const prompt = buildPromptText({ schools: [] } as any);
  assert.ok(prompt.includes("median earnings 6 years after first enrolling"));
  assert.ok(prompt.includes("never recompute it"));
  assert.ok(prompt.includes("never state another formula"));
  assert.ok(!prompt.includes("school-wide average earnings"));
  const n = buildFallbackNarrative({
    schools: [schoolRow("A", 15722, 45299), schoolRow("B", 0, null)],
    derived_flags: { above_p75_schools: [], below_p25_schools: [] },
    student: {},
  } as any);
  assert.ok(n.debt_burden_paragraph.includes("0.35 : 1"));
  assert.ok(n.debt_burden_paragraph.includes("6 years after first enrolling"));
  assert.ok(n.debt_burden_paragraph.includes("cannot be calculated due to missing values"));
});

test("switching the basis means editing only DEBT_RATIO_BASIS", () => {
  const saved = { ...DEBT_RATIO_BASIS };
  try {
    DEBT_RATIO_BASIS.column = "earn_10yr_after_entry_median";
    DEBT_RATIO_BASIS.label = "10 years after first enrolling";
    DEBT_RATIO_BASIS.shortLabel = "Yr 10";
    DEBT_RATIO_BASIS.methodologyLabel = "10 years after students first enrolled";
    assert.ok(renderSection().includes("Median Earnings (Yr 10)"));
    assert.ok(!renderSection().includes("Median Earnings (Yr 6)"));
    assert.ok(schoolEarningsColumnLabel() === "Median Earnings (Yr 10)");
    assert.ok(debtRatioDisclaimer().includes("Median Earnings (Yr 10) column."));
    assert.ok(debtRatioQuery().includes("e.earn_10yr_after_entry_median"));
    assert.ok(!debtRatioQuery().includes("earn_6yr"));
    assert.ok(debtRatioDisclaimer().includes("10 years after first enrolling"));
    assert.ok(renderSection().includes("10 years after first enrolling"));
    assert.ok(renderMethodology().includes("10 years after students first enrolled"));
    assert.ok(buildPromptText({ schools: [] } as any).includes("10 years after first enrolling"));
    for (const html of [renderSection(), renderMethodology(), buildPromptText({ schools: [] } as any)]) {
      assert.ok(!html.includes("6 years"));
    }
  } finally {
    Object.assign(DEBT_RATIO_BASIS, saved);
  }
});

const STRIP = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, "\"").replace(/&amp;/g, "&").replace(/\s+/g, " ");

test("disclaimer and definitions render, carry the basis, hardcode no timing", () => {
  const section = STRIP(renderSection());
  const disclaimer = debtRatioDisclaimer();
  assert.ok(section.includes(disclaimer));
  assert.ok(disclaimer.includes(DEBT_RATIO_BASIS.label));
  assert.ok(disclaimer.includes("A ratio of 0.35 : 1 means debt is about 35% of one year of those earnings."));
  assert.ok(disclaimer.includes("not comparable to the program-level Median Earnings (Yr 10) column"));
  assert.ok(disclaimer.includes("$0 debt can mean the school's students take no federal loans"));
  assert.ok(disclaimer.includes("not a prediction of your own debt or earnings"));

  const meth = STRIP(renderMethodology());
  assert.ok(meth.includes("Debt-to-Income Ratio:"));
  const lines = debtRatioDefinitions(debtRatioRefreshed(SAMPLE_PAYLOAD.schools, "November 16, 2026"));
  assert.equal(lines.length, 3);
  for (const l of lines) assert.ok(meth.includes(l), l);
  const defs = lines.join(" ");
  assert.ok(defs.includes(DEBT_RATIO_BASIS.methodologyLabel));
  assert.ok(defs.includes(DEBT_RATIO_BASIS.apiField));
  assert.ok(defs.includes("data fetched October 2026"));

  // No "6 years" outside DEBT_RATIO_BASIS: the source files must not contain it.
  const fs = require("node:fs");
  const path = require("node:path");
  const dir = path.join(__dirname);
  const files = [
    "components/CareerOutcomes.tsx", "components/Methodology.tsx",
    "services/reportPrompt.ts", "services/reportPayload.service.ts",
  ].map((f) => fs.readFileSync(path.join(dir, f), "utf8"));
  const util = fs.readFileSync(path.join(dir, "utils/debtRatio.ts"), "utf8")
    .replace(/export const DEBT_RATIO_BASIS = \{[\s\S]*?\n\};/, "");
  for (const src of [...files, util]) assert.ok(!/6[ -]years|6_yrs|earn_6yr/.test(src));
});

test("refresh date falls back to the report's own date", () => {
  assert.equal(debtRatioRefreshed([], "November 16, 2026"), "November 2026");
  assert.equal(debtRatioRefreshed([{ debt_income_earnings_fetched_on: null }], "March 3, 2026"), "March 2026");
});

test("definition text matches between methodology block and payload string", () => {
  const refreshed = debtRatioRefreshed(SAMPLE_PAYLOAD.schools, "November 16, 2026");
  const text = debtRatioDefinitionText(refreshed);
  assert.equal(text, debtRatioDefinitions(refreshed).join(" "));
  assert.ok(!text.includes("\n"));
  const meth = STRIP(renderMethodology());
  for (const l of debtRatioDefinitions(refreshed)) assert.ok(meth.includes(l));
  // prompt tells the model to use it
  const prompt = buildPromptText({ schools: [] } as any);
  assert.ok(prompt.includes("debt_income_ratio_definition"));
  assert.ok(/never compare it with the program-level Median Earnings \(Yr 10\)/i.test(prompt));
  assert.ok(/never call a\s+ratio good, bad/.test(prompt));
});

test("neutral wording: no good / bad / recommend / better in the new text", () => {
  const all = [
    debtRatioDisclaimer(),
    debtRatioDefinitionText("October 2026"),
  ].join(" ");
  // "good or bad sign" is the one allowed phrase (it denies the judgement).
  const cleaned = all.replace("A missing ratio is not a good or bad sign.", "");
  for (const w of ["good", "bad", "recommend", "better", "worse", "healthy", "risky"]) {
    assert.ok(!new RegExp(`\b${w}\b`, "i").test(cleaned), w);
  }
});

test("switching to the 10-year basis changes note, definitions, field and payload definition", () => {
  const saved = { ...DEBT_RATIO_BASIS };
  try {
    DEBT_RATIO_BASIS.column = "earn_10yr_after_entry_median";
    DEBT_RATIO_BASIS.apiField = "latest.earnings.10_yrs_after_entry.median";
    DEBT_RATIO_BASIS.label = "10 years after first enrolling";
    DEBT_RATIO_BASIS.shortLabel = "Yr 10";
    DEBT_RATIO_BASIS.methodologyLabel = "10 years after students first enrolled";
    const refreshed = debtRatioRefreshed(SAMPLE_PAYLOAD.schools, "November 16, 2026");
    const note = debtRatioDisclaimer();
    const defs = debtRatioDefinitionText(refreshed);
    assert.ok(note.includes("10 years after first enrolling") && !note.includes("6 years"));
    assert.ok(defs.includes("median earnings 10 years after students first enrolled"));
    assert.ok(defs.includes("latest.earnings.10_yrs_after_entry.median"));
    assert.ok(!defs.includes("6_yrs") && !defs.includes("6 years"));
    assert.ok(debtRatioQuery().includes("e.earn_10yr_after_entry_median"));
    assert.ok(STRIP(renderMethodology()).includes("latest.earnings.10_yrs_after_entry.median"));
  } finally {
    Object.assign(DEBT_RATIO_BASIS, saved);
  }
});
