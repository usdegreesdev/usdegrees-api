import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCoverModel,
  parseCityState,
  schoolCountWord,
  validateCoverText,
} from "./coverData";

function payload(n: number, extra: Record<string, unknown> = {}): any {
  return {
    report_meta: {
      report_reference_id: "C1-R1-A92F4D",
      created_at: "",
      generated_date: "November 10, 2026",
      methodology_version: "lite-v1",
      // Newest *_fetched_on across the schools (grad_rate_fetched_on today).
      data_checked_on: "2026-11-18",
    },
    student: { display_name: "Ana Martinez", address: "12 Oak St, Orlando, FL 32801" },
    schools: Array.from({ length: n }, (_, i) => ({
      name: `School ${i}`,
      sector: i % 2 ? "Private, 4-year" : "Public, 4-year",
      city: "Gainesville",
      state: "FL",
      program_name: "Computer Science",
      net_price_vintage: "College Scorecard, October 2026 update",
      admit_rate_vintage: "IPEDS",
      sat_vintage: null,
      sticker_vintage: null,
      debt_vintage: "College Scorecard",
      earnings_vintage: 2021,
      ...extra,
    })),
  };
}

test("number words and headline follow school count", () => {
  assert.equal(schoolCountWord(4), "Four");
  assert.deepEqual(buildCoverModel(payload(4), "X").headline, ["Four schools.", "The real numbers."]);
  assert.equal(buildCoverModel(payload(1), "X").headline[0], "One school.");
});

test("dynamic fields are derived from the payload", () => {
  const m = buildCoverModel(payload(2), "C1-R1-A92F4D");
  // Derived from report_meta.data_checked_on — not the "October 2026"
  // baked into net_price_vintage, and not the generation date.
  assert.equal(m.banner, "INDEPENDENT REPORT · DATA CHECKED NOV 2026");
  assert.equal(m.dataChecked, "November 2026");
  assert.equal(m.cityState, "Orlando, FL");
  assert.equal(m.major, "Computer Science");
  assert.equal(m.methodVersion, "v1");
  assert.deepEqual(m.schools.map((s) => s.location), ["Gainesville, FL · Public", "Gainesville, FL · Private"]);
});

test("city/state parsing is conservative", () => {
  assert.equal(parseCityState(null), null);
  assert.equal(parseCityState("somewhere"), null);
});

test("validator flags placeholders, bad count word, repeated website", () => {
  const m = buildCoverModel(payload(2), "X");
  const ok = "Two schools. www.usdegrees.com";
  assert.deepEqual(validateCoverText(m, ok), []);
  assert.ok(validateCoverText(m, "[STUDENT NAME] www.usdegrees.com").length);
  assert.ok(validateCoverText(m, "www.usdegrees.com www.usdegrees.com").length);
  assert.ok(validateCoverText({ ...m, headline: ["Four schools.", "x"] }, ok).length);
});

test("no recorded fetch date → no invented month on the cover", () => {
  const p = payload(2);
  p.report_meta.data_checked_on = null;
  const m = buildCoverModel(p, "X");
  assert.equal(m.banner, "INDEPENDENT REPORT");
  assert.equal(m.dataChecked, null);
});

test("a month baked into a vintage string never drives the cover", () => {
  const p = payload(2, { net_price_vintage: "College Scorecard, December 2099 update" });
  p.report_meta.data_checked_on = "2026-11-18";
  assert.equal(buildCoverModel(p, "X").dataChecked, "November 2026");
});
