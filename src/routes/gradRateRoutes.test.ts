/**
 * Website routes serve the same graduation rate as the report: the published
 * completion.grad_rate_150nt_pct (0–100, unscaled) or null — never the
 * deprecated completion_rate / completed_*yrs columns. Field names and shapes
 * are unchanged for the frontend. emp_factor is intentionally out of scope.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import pool from "../db/client";
import { startApp } from "../testUtils/harness";
import { DEPRECATED_COMPLETION_COLUMNS } from "../report/utils/gradRate";

const ROWS: Record<number, Record<string, unknown>> = {
  145707: { grad_rate_150nt_pct: "64.57", grad_rate_cohort: 717, completion_rate: "16.74", completed_6yrs: "0.1674", student_faculty_ratio: 12, repayment_success: null },
  999002: { grad_rate_150nt_pct: "1.50", grad_rate_cohort: 400, completion_rate: "1.50", student_faculty_ratio: 12, repayment_success: null },
  497037: { grad_rate_150nt_pct: "0.00", grad_rate_cohort: 9, completion_rate: "55.70", student_faculty_ratio: 12, repayment_success: null },
  999001: { grad_rate_150nt_pct: null, grad_rate_cohort: null, completion_rate: "42.00", student_faculty_ratio: 12, repayment_success: null },
};

(pool as any).query = async (sql: string, params: unknown[]) => {
  const u = Number(params?.[0]);
  if (/FROM completion/.test(sql)) return { rows: ROWS[u] ? [ROWS[u]] : [], rowCount: ROWS[u] ? 1 : 0 };
  return { rows: [], rowCount: 0 };
};

test("GET /programs/:unitid academics.graduation_rate", async () => {
  process.env.JWT_SECRET ??= "test-secret"; // read by middleware/auth at import
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const router = require("./programs").default;
  const { url, server } = await startApp([["/programs", router]]);
  try {
    const get = async (u: number) => (await (await fetch(`${url}/programs/${u}`)).json()).academics;
    const ie = await get(145707);
    assert.equal(ie.graduation_rate, 64.57); // not 16.74, not 6457, same key and shape
    assert.ok("student_faculty_ratio" in ie && "repayment_success" in ie);
    assert.equal((await get(999002)).graduation_rate, 1.5); // not scaled to 150 by toRatePct
    assert.equal((await get(497037)).graduation_rate, null); // cohort 9 < 10
    assert.equal((await get(999001)).graduation_rate, null); // no fallback to completion_rate
  } finally {
    server.close();
  }
});

test("route SQL never selects the deprecated completion columns", () => {
  for (const f of ["programs.ts", "overviewDetails.ts", "../services/compare/enrichmentSql.ts"]) {
    const code = fs.readFileSync(path.join(__dirname, f), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "").replace(/--.*$/gm, "");
    assert.ok(code.includes("grad_rate_150nt_pct"), `${f} does not read grad_rate_150nt_pct`);
    for (const col of DEPRECATED_COMPLETION_COLUMNS) {
      if (col === "emp_factor") continue; // out of scope; not read by these files anyway
      // The /overview response key `completion.completion_rate` is kept for the
      // frontend; only a column read (co./comp. prefix or SELECT list) is a bug.
      assert.ok(!new RegExp(`\\b(co|comp)\\.${col}\\b|SELECT\\s+${col}\\b|row\\.${col}\\b`).test(code), `${f} reads ${col}`);
    }
  }
});
