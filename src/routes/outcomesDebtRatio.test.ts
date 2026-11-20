/**
 * Item 10: /outcomes serves the PDF report's debt-to-income figure —
 * avg_debt ÷ earnings.<DEBT_RATIO_BASIS.column> via the report's own
 * debtRatioQuery/resolveDebt — never debt_income_ratio.debt_income_ratio,
 * whose avg_income has no identifiable source. Coverage: 4,429 schools on
 * this basis vs 480 on the stored ratio; 153 schools disagreed by ≥ 0.05.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import pool from "../db/client";
import { startApp } from "../testUtils/harness";
import { DEBT_RATIO_BASIS, computeDebtIncomeRatio } from "../report/utils/debtRatio";

const queries: string[] = [];
let debtRow: Record<string, unknown> | undefined;

(pool as any).query = async (sql: string) => {
  queries.push(sql);
  if (/FROM earnings e/.test(sql)) return { rows: debtRow ? [debtRow] : [], rowCount: debtRow ? 1 : 0 };
  if (/FROM earnings_against_courses_merged/.test(sql)) {
    // A stale stored ratio that must NOT be served.
    return { rows: [{ year_1: 40000, debt_income_ratio: 0.4 }], rowCount: 1 };
  }
  return { rows: [], rowCount: 0 };
};

async function get(): Promise<any> {
  process.env.JWT_SECRET ??= "test-secret";
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const router = require("./outcomes").default;
  const { url, server } = await startApp([["/outcomes", router]]);
  try {
    const r = await fetch(`${url}/outcomes/100654/110701`);
    assert.equal(r.status, 200);
    return (await r.json()).debt_income_ratio;
  } finally {
    server.close();
  }
}

test("ratio = avg_debt ÷ school median earnings, same as the report", async () => {
  debtRow = { avg_debt: "12000", basis_earnings: "48000", fetched_on: "2026-11-16" };
  const d = await get();
  assert.equal(d.debt_income_ratio, computeDebtIncomeRatio(12000, 48000)); // 0.25
  assert.equal(d.debt_income_ratio, 0.25);
  assert.equal(d.avg_debt, 12000);
  assert.equal(d.basis_earnings, 48000);
  assert.equal(d.basis_label, DEBT_RATIO_BASIS.label);
  assert.equal(d.basis_api_field, DEBT_RATIO_BASIS.apiField);
  assert.match(d.definition, /median federal debt of completers/);
  assert.notEqual(d.debt_income_ratio, 0.4); // never the stored column
});

test("missing earnings → null ratio, never a constant", async () => {
  debtRow = { avg_debt: "12000", basis_earnings: null, fetched_on: null };
  const d = await get();
  assert.equal(d.debt_income_ratio, null);
  assert.equal(d.basis_earnings, null);
});

test("no debt row → null ratio and inputs", async () => {
  debtRow = undefined;
  const d = await get();
  assert.equal(d.debt_income_ratio, null);
  assert.equal(d.avg_debt, null);
});

test("outcomes.ts never reads the stored debt_income_ratio column", () => {
  const code = fs.readFileSync(path.join(__dirname, "outcomes.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "").replace(/--.*$/gm, "");
  assert.ok(!/\bdi\.debt_income_ratio\b|row\.debt_income_ratio\b/.test(code));
  assert.ok(!/JOIN debt_income_ratio/.test(code));
});
