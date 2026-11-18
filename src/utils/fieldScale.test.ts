import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { FIELD_SCALES, toFraction, toPercent } from "./fieldScale";

test("same output from different inputs, no guessing: 1.5 percent and 0.015 fraction are both 1.5%", () => {
  assert.equal(toPercent("completion.grad_rate_150nt_pct", 1.5), 1.5);
  assert.equal(Number(toPercent("students.retention_rate", 0.015)!.toFixed(4)), 1.5);
});

test("a fraction field is always ×100, even at 1.0 or above 1", () => {
  assert.equal(toPercent("admissions.admission_rate", 1), 100);
  assert.equal(toPercent("students.demographics_men", 0.395), 39.5);
});

test("a percent field is never multiplied, even below 2 (5 schools hold repayment_success = 1)", () => {
  assert.equal(toPercent("repayment.repayment_success", 1), 1);
  assert.equal(toPercent("repayment.graduates_3yr", 1), 1);
});

test("negative growth_rate stays negative and unscaled (49 negative programs)", () => {
  assert.equal(toPercent("earnings.growth_rate", -30), -30);
  assert.equal(toPercent("earnings.growth_rate", -0.5), -0.5);
});

test("null is null, a real 0 is 0", () => {
  for (const f of Object.keys(FIELD_SCALES) as (keyof typeof FIELD_SCALES)[]) {
    assert.equal(toPercent(f, null), null);
    assert.equal(toPercent(f, undefined), null);
  }
  assert.equal(toPercent("admissions.admission_rate", 0), 0);
  assert.equal(toPercent("completion.grad_rate_150nt_pct", 0), 0);
});

test("deprecated fields never produce a value", () => {
  assert.equal(toPercent("completion.completion_rate", 64.5), null);
  assert.equal(toPercent("completion.emp_factor", 0.85), null);
  assert.equal(toFraction("students.graduation_rate", 0.5), null);
});

test("toFraction returns the stored fraction unchanged", () => {
  assert.equal(toFraction("admissions.admission_rate", 0.65), 0.65);
  assert.ok(Math.abs(toFraction("completion.grad_rate_150nt_pct", 64.57)! - 0.6457) < 1e-12);
});

// Scan: no magnitude-based scale branch anywhere in the API source.
const MAGNITUDE_BRANCH = /[<>]=?\s*(?:1|2|1\.0|100)\s*\?[^;\n]*[*/]\s*100\b/;

test("no magnitude-based scale branch in any API source file", () => {
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) {
        fs.readFileSync(p, "utf8")
          // comments may describe the removed pattern; keep line numbers
          .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ""))
          .replace(/\/\/.*$/gm, "")
          .split("\n").forEach((line, i) => {
          if (MAGNITUDE_BRANCH.test(line)) offenders.push(`${path.relative(dir, p)}:${i + 1}: ${line.trim()}`);
        });
      }
    }
  };
  walk(path.join(__dirname, ".."));
  assert.deepEqual(offenders, []);
});

test("the scan pattern catches the shapes that were removed", () => {
  for (const s of [
    "return n < 2 ? Math.round(n * 100) : Math.round(n);",
    "rawRate == null ? null : rawRate > 1 ? rawRate / 100 : rawRate;",
    "const pct = n <= 1 ? n * 100 : n;",
  ]) assert.ok(MAGNITUDE_BRANCH.test(s), s);
});
