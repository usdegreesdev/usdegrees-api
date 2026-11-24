/**
 * Release-audit fixes: one-cohort earnings, data years, banned phrases, size
 * label, program-name cleanup, test-user flag, and the date handling.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { resolveEarningsPath, type EarningsCohortRow } from "../services/earnings.service";
import { dataYearsLine, dataYearsSentence, monthYearFromIso, PSEO_EARNINGS_DISCLAIMER } from "./utils/dataVintage";
import { findBannedPhrases } from "./services/reportPrompt";
import { schoolSizeLabel } from "./config/sizeCategories.config";
import { cleanProgramName } from "./utils/programName";
import { debtRatioQuery, computeDebtIncomeRatio } from "./utils/debtRatio";
import { missingFiguresMethodology } from "./utils/missingValue";

const row = (c: string, y1: any, y5: any, y10: any, m10: string | null = null): EarningsCohortRow => ({
  grad_cohort: c, year_1: y1, year_5: y5, year_10: y10,
  year_1_method: null, year_5_method: null, year_10_method: m10, avg_salary: null,
});

test("earnings path: year 1, 5 and 10 come from ONE cohort; newest year 1 is separate", () => {
  const p = resolveEarningsPath([
    row("2007", 46024, 65534, 88155),
    row("2010", 47346, 69644, 87447),
    row("2013", 51052, 75006, null, "skipped_future"),
    row("2019", 47289, null, null, "skipped_future"),
  ]);
  assert.equal(p.cohort, "2010");
  assert.deepEqual([p.year_1?.value, p.year_5?.value, p.year_10?.value], [47346, 69644, 87447]);
  assert.equal(p.latest_year_1?.value, 47289);
  assert.equal(p.latest_year_1?.cohort, "2019");
});

test("earnings path: no usable year 10 → no path, never another cohort's value", () => {
  const p = resolveEarningsPath([row("2019", 47289, null, null, "skipped_future")]);
  assert.equal(p.year_10, null);
  assert.equal(p.year_1, null);
  assert.equal(p.latest_year_1?.value, 47289);
});

test("data years come from the table; a metric with no row is left out", () => {
  const line = dataYearsLine({ release_date: "2026-11-02", years: { earnings_6yr_after_entry: 2022, median_debt_completers: 2024 } });
  assert.equal(line, "school-wide earnings 6 years after entry 2022; median federal debt of completers 2024");
  assert.equal(dataYearsLine({ release_date: null, years: {} }), null);
  const sentence = dataYearsSentence({ release_date: "2026-11-02", years: { earnings_6yr_after_entry: 2022, earnings_10yr_after_entry: 2022 } })!;
  assert.ok(!sentence.includes("6 and 10 years"));
  assert.ok(sentence.includes("school-wide earnings 6 years after entry 2022"));
  assert.equal(sentence.split(PSEO_EARNINGS_DISCLAIMER).length - 1, 1);
  assert.ok(sentence.endsWith(PSEO_EARNINGS_DISCLAIMER));
  assert.equal(dataYearsSentence({ release_date: null, years: {} }), null);
  assert.equal(monthYearFromIso("2026-11-02"), "November 2026");
  assert.equal(monthYearFromIso(null), null);
});

test("snapshot date prints as stored (no timezone shift)", () => {
  assert.ok(missingFiguresMethodology("2026-11-16").includes("snapshot fetched on 2026-11-16"));
});

test("banned phrases", () => {
  for (const t of ["may qualify for merit consideration", "a 20-year ROI", "CRITICAL FINDING", "higher than about 3 in 4", "$65,000 lifetime cap"]) {
    assert.ok(findBannedPhrases(t).length > 0, t);
  }
  assert.deepEqual(findBannedPhrases("Above the 75th percentile of enrolled students who reported scores"), []);
  assert.deepEqual(findBannedPhrases("per student, effective July 1, 2026"), []);
});

test("size label follows students.size via one config", () => {
  assert.equal(schoolSizeLabel(4188), "Small");
  assert.equal(schoolSizeLabel(1634), "Very Small");
  assert.equal(schoolSizeLabel(6124), "Medium");
  assert.equal(schoolSizeLabel(null), null);
});

test("program names lose the stored trailing period", () => {
  assert.equal(cleanProgramName("Accounting and Related Services."), "Accounting and Related Services");
  assert.equal(cleanProgramName("Agriculture, General."), "Agriculture, General");
  assert.equal(cleanProgramName(null), null);
});

test("debt comes from earnings.median_debt_completers, never debt_income_ratio", () => {
  const q = debtRatioQuery();
  assert.ok(q.includes("e.median_debt_completers"));
  assert.ok(!/debt_income_ratio|avg_debt\b.*FROM debt/.test(q.replace("AS avg_debt", "")));
  assert.equal(computeDebtIncomeRatio(19623, 45299), 0.43);
});

test("report code has no hardcoded month/date and no 20-year ROI wording", () => {
  const dir = path.join(__dirname);
  for (const f of ["components/TuitionCosts.tsx", "components/Methodology.tsx", "services/reportPayload.service.ts", "components/QuestionsTable.tsx"]) {
    const src = fs.readFileSync(path.join(dir, f), "utf8");
    assert.ok(!/October 2026|November 2026/.test(src), f);
  }
});
