import test from "node:test";
import assert from "node:assert/strict";
import {
  SELECTIVE_ADMIT_RATE_MAX,
  applySelectiveRule,
  shouldShowSelectiveSentence,
} from "./utils/selectiveSentence";

const B_TEXT =
  "This is a selective school — not all applicants are admitted. Test scores simply aren't part of how decisions are made here.";

test("shouldShowSelectiveSentence: percent thresholds", () => {
  assert.equal(SELECTIVE_ADMIT_RATE_MAX, 80);
  assert.equal(shouldShowSelectiveSentence(100), false);
  assert.equal(shouldShowSelectiveSentence(80), false);
  assert.equal(shouldShowSelectiveSentence(79.9), true);
  assert.equal(shouldShowSelectiveSentence(73), true);
  assert.equal(shouldShowSelectiveSentence(null), false);
  assert.equal(shouldShowSelectiveSentence(undefined), false);
});

test("a fraction is not a percentage: 0.73 must be converted before use", () => {
  // Callers pass percent (page 5 prints 73), so 0.73 is read as 0.73% — the
  // service converts the stored fraction with toFraction * 100 first.
  assert.equal(shouldShowSelectiveSentence(0.73 * 100), true);
  assert.equal(shouldShowSelectiveSentence(1.0 * 100), false);
});

test("applySelectiveRule drops only the sentence, cleanly", () => {
  assert.equal(
    applySelectiveRule(B_TEXT, 100),
    "Test scores simply aren't part of how decisions are made here.",
  );
  assert.equal(applySelectiveRule(B_TEXT, null), "Test scores simply aren't part of how decisions are made here.");
  assert.equal(applySelectiveRule(B_TEXT, 73), B_TEXT);
});

test("applySelectiveRule leaves other texts untouched", () => {
  const other = "Based on IPEDS reporting; this institution does not conduct selective admissions.";
  assert.equal(applySelectiveRule(other, 100), other);
  assert.equal(applySelectiveRule(null, 100), null);
  assert.equal(applySelectiveRule("This is a selective school — not all applicants are admitted.", 100), null);
});
