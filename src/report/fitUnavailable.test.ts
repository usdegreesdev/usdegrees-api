/**
 * Item 11: the payload sends fit_label "Unavailable" for ~700 schools (553
 * with no admit rate or SAT average, plus the 147 that publish an admit rate
 * but no SAT data). The prompt lists it, requires FIT_UNAVAILABLE_SENTENCE
 * verbatim, and a gate rejects any narrative that does not copy it.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { FIT_UNAVAILABLE_SENTENCE } from "./config/satPositioning.config";
import {
  buildFallbackNarrative,
  buildPromptText,
  gateFitUnavailable,
} from "./services/reportPrompt";

const school = (name: string, fit_label: string): any => ({
  display_name: name, name, unitid: "1", fit_label, fit_score: null,
  sat_data_category: "E_TEST_REQUIRED_NO_RANGE", sat_25: null, sat_75: null,
  disclosure: { supporting_copy: "SC" }, program_earnings: null,
  net_price_bracket: null, net_price_vintage: null,
});

const payload: any = {
  schools: [school("No SAT U", "Unavailable"), school("Open U", "Not applicable")],
  derived_flags: { merit_flag_schools: [], reach_flag_schools: [] },
  student: { display_name: "S", sat_score: 1300, income_bracket_label: null },
};

test("the prompt lists Unavailable and requires the sentence verbatim", () => {
  const text = buildPromptText(payload);
  assert.ok(text.includes('"Unavailable"'));
  assert.ok(text.includes(FIT_UNAVAILABLE_SENTENCE));
  assert.match(text, /fit_label is only "Target\/Match", "Reach", "Not applicable", "Unavailable", or "Not shown/);
});

test("the fallback narrative writes the verbatim sentence and passes the gate", () => {
  const n = buildFallbackNarrative(payload);
  const s = n.fit_sentences.find((f) => f.school === "No SAT U")!;
  assert.ok(s.sentence.includes(FIT_UNAVAILABLE_SENTENCE));
  assert.deepEqual(gateFitUnavailable(n, payload), []);
});

test("the gate rejects a paraphrase or an invented category", () => {
  const base = buildFallbackNarrative(payload);
  const paraphrased = {
    ...base,
    fit_sentences: [{ school: "No SAT U", sentence: "We could not compute fit here." }],
  };
  assert.equal(gateFitUnavailable(paraphrased, payload).length, 1);
  const invented = {
    ...base,
    fit_sentences: [{ school: "No SAT U", sentence: `${FIT_UNAVAILABLE_SENTENCE} Likely a Reach.` }],
  };
  assert.match(gateFitUnavailable(invented, payload)[0], /names a fit category/);
});
