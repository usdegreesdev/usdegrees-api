import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  calculateAdmissionFit,
  CollegeAdmissions,
} from "./utils/admissionScore";

// Fit-eligible schools (1,088): 388 have a full SAT basis and are scored;
// 147 publish an admit rate but no SAT data and used to be scored on an
// invented SAT component of 50 — they are now Unavailable.

const NO_SAT_COLLEGE: CollegeAdmissions = {
  admissionRate: 0.6,
  satAvg: null,
  sat25Math: null,
  sat75Math: null,
  sat25Reading: null,
  sat75Reading: null,
};

test("no student SAT → Unavailable with a null score", () => {
  const fit = calculateAdmissionFit(
    { satTotal: null },
    { ...NO_SAT_COLLEGE, satAvg: 1200 },
  );
  assert.equal(fit.category, "Unavailable");
  assert.equal(fit.score, null);
});

test("college with an admit rate but no SAT data (147 schools) → Unavailable, never a 50-based score", () => {
  const fit = calculateAdmissionFit({ satTotal: 1300 }, NO_SAT_COLLEGE);
  assert.equal(fit.category, "Unavailable");
  assert.equal(fit.score, null);
});

test("partial percentile band → Unavailable, never 500/700 section defaults", () => {
  const fit = calculateAdmissionFit(
    { satTotal: 1200 },
    { ...NO_SAT_COLLEGE, sat25Math: 550, sat75Math: 650 }, // reading missing
  );
  assert.equal(fit.category, "Unavailable");
  assert.equal(fit.score, null);
});

test("no college data at all → Unavailable with a null score, not 50", () => {
  const fit = calculateAdmissionFit(
    { satTotal: 1200 },
    { ...NO_SAT_COLLEGE, admissionRate: null },
  );
  assert.equal(fit.category, "Unavailable");
  assert.equal(fit.score, null);
});

test("missing admit rate → no selectivity penalty, never an assumed 50% rate", () => {
  const fit = calculateAdmissionFit(
    { satTotal: 1300 },
    { ...NO_SAT_COLLEGE, admissionRate: null, satAvg: 1200 },
  );
  // SAT only: 50 + (1300 - 1200) / 4 = 75, no penalty.
  assert.equal(fit.score, 75);
});

test("SAT average path (was 63 with the inferred-GPA blend, now 67 — item 4)", () => {
  // 50 + 100/4 = 75; penalty (1 - 0.6) * 20 = 8 → 67.
  const fit = calculateAdmissionFit(
    { satTotal: 1300 },
    { ...NO_SAT_COLLEGE, satAvg: 1200 },
  );
  assert.equal(fit.category, "Target/Match");
  assert.equal(fit.score, 67);
});

test("full percentile band: real sections summed (unchanged, 59 — no GPA was involved)", () => {
  // p25 = 550 + 540 = 1090, p75 = 650 + 660 = 1310; 1200 is in band:
  // 60 + (110 / 220) * 25 = 72.5; penalty (1 - 0.3) * 20 = 14 → 58.5 → 59.
  const fit = calculateAdmissionFit(
    { satTotal: 1200 },
    {
      admissionRate: 0.3,
      satAvg: null,
      sat25Math: 550,
      sat75Math: 650,
      sat25Reading: 540,
      sat75Reading: 660,
    },
  );
  assert.equal(fit.category, "Target/Match");
  assert.equal(fit.score, 59);
});

test("uses the student's total SAT as given — no section doubling", () => {
  const college = { ...NO_SAT_COLLEGE, admissionRate: null, satAvg: 1000 };
  const fit = calculateAdmissionFit({ satTotal: 1400 }, college);
  // 50 + 400/4 = 150 → clamped to 100 → capped to 99.
  assert.equal(fit.score, 99);
});

test("no GPA band or GPA input survives in the score (item 4)", () => {
  const code = fs.readFileSync(path.join(__dirname, "utils/admissionScore.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.ok(!/gpa/i.test(code), "admissionScore.ts still reads a GPA");
  assert.ok(!/\b3\.(9|75|5|2|0)\b/.test(code), "admissionScore.ts still holds a GPA band");
});
