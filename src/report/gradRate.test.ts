/**
 * Graduation-rate regression tests. These fail if the report goes back to
 * completion.completion_rate / emp_factor / completed_*yrs, scales the
 * already-percent column, or renders a missing rate as 0% or blank.
 *
 * Fixture rows are real completion rows (2026-11-18 pull), including the
 * deprecated columns, so a regression that reads them changes the output.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import pool from "../db/client";
import {
  MIN_GRAD_RATE_COHORT,
  DEPRECATED_COMPLETION_COLUMNS,
  GRAD_RATE_COLUMNS,
  formatGradRatePct,
  resolveGradRate,
  publishedGradRatePct,
  graduationRateSummary,
} from "./utils/gradRate";
import { fetchCampus } from "./services/reportPayload.service";
import {
  buildFallbackNarrative,
  buildPromptText,
  gateGraduationRate,
  type C1LitePayload,
  type C1LiteNarrative,
} from "./services/reportPrompt";
import CampusStudents from "./components/CampusStudents";
import StudentProfile from "./components/StudentProfile";
import Methodology from "./components/Methodology";
import SourcesMethodology from "./components/SourcesMethodology";

// Real rows. completion_rate / emp_factor / completed_* are the WRONG figures.
const ROWS: Record<number, Record<string, unknown>> = {
  144892: { name: "Eastern Illinois University", grad_rate_150nt_pct: "49.51", grad_rate_cohort: 913, grad_rate_source_field: "completion_rate_4yr_150nt", grad_rate_fetched_on: "2026-11-18", completion_rate: "58.40", emp_factor: "49.64", completed_4yrs: "0.5454", completed_6yrs: "0.5840" },
  145707: { name: "Illinois Eastern Community Colleges", grad_rate_150nt_pct: "64.57", grad_rate_cohort: 717, grad_rate_source_field: "completion_rate_less_than_4yr_150nt", grad_rate_fetched_on: "2026-11-18", completion_rate: "16.74", emp_factor: "14.23", completed_4yrs: "0.3687", completed_6yrs: "0.1674" },
  212805: { name: "Grove City College", grad_rate_150nt_pct: "80.78", grad_rate_cohort: 489, grad_rate_source_field: "completion_rate_4yr_150nt", grad_rate_fetched_on: "2026-11-18", completion_rate: null, emp_factor: null, completed_4yrs: null, completed_6yrs: null },
  // A genuine 0% on a large cohort (university winding down) — must show.
  120184: { name: "Notre Dame de Namur University", grad_rate_150nt_pct: "0.00", grad_rate_cohort: 120, completion_rate: "35.76", emp_factor: "30.40", completed_6yrs: "0.3576" },
  // 0% on 9 students — below threshold, must be suppressed.
  497037: { name: "Abilene Christian University-Undergraduate Online", grad_rate_150nt_pct: "0.00", grad_rate_cohort: 9, completion_rate: "55.70", emp_factor: "47.35", completed_6yrs: "0.5570" },
  // No Scorecard rate, but the deprecated columns are populated — the old bug's fallback.
  999001: { name: "No Rate College", grad_rate_150nt_pct: null, grad_rate_cohort: null, completion_rate: "42.00", emp_factor: "35.70", completed_4yrs: "0.3900", completed_6yrs: "0.4200", completed_8yrs: "0.4500" },
};

const EXPECTED: Array<[number, string, number, string]> = [
  [144892, "Eastern Illinois University", 913, "49.5%"],
  [145707, "Illinois Eastern Community Colleges", 717, "64.6%"],
  [212805, "Grove City College", 489, "80.8%"],
];

// Stub pool.query: the completion query returns the WHOLE fixture row (as if
// it were SELECT *), so only the code's choice of column decides the output.
const queries: string[] = [];
(pool as any).query = async (sql: string, params: unknown[]) => {
  queries.push(sql);
  const unitid = Number(params?.[0]);
  if (/FROM\s+completion/i.test(sql)) return { rows: ROWS[unitid] ? [ROWS[unitid]] : [] };
  return { rows: [] };
};

async function campusFor(unitid: number) {
  return fetchCampus(unitid);
}

async function collegeDetails(unitids: number[]): Promise<C1LitePayload["college_details"]> {
  return Promise.all(
    unitids.map(async (u) => ({
      unitid: String(u),
      name: String(ROWS[u].name),
      city: "", state: "", address: null, zip: null,
      campus: await campusFor(u),
      tuition: {
        sticker_in_state_on_campus: { published: false, total: null, missing: [] },
        sticker_out_state_off_campus: { published: false, total: null, missing: [] },
        scorecard_avg_coa: null, scorecard_avg_coa_year: null, net_price: null,
        tuition_in_state: null, tuition_out_state: null, room_board_on_campus: null,
        room_board_off_campus: null, books_supply: null, other_expense_on_campus: null,
        other_expense_off_campus: null, other_expense_with_family: null,
      } as any,
      athletics: null,
    })),
  );
}

async function payloadFor(unitids: number[]): Promise<C1LitePayload> {
  const college_details = await collegeDetails(unitids);
  return {
    report_meta: { report_reference_id: "T", created_at: "", generated_date: "November 18, 2026", methodology_version: "lite-v1" },
    student: { display_name: "Test", email: null, address: null, gpa: null, sat_score: null, sat_math: null, sat_reading_writing: null, act_score: null, graduation_year: null, high_school_name: null, preferred_degree_level: null, preferred_college_type: null, income_bracket_field: null, income_bracket_label: null },
    schools: unitids.map((u) => ({
      name: String(ROWS[u].name), display_name: String(ROWS[u].name), unitid: String(u), program_name: null,
      sector: "", city: "", state: "", accreditor: null,
      net_price_bracket: null, net_price_vintage: null, admit_rate: null, admit_rate_vintage: null,
      sat_25: null, sat_75: null, sat_vintage: null, fit_score: null, fit_label: "Not applicable",
      sat_data_category: "A_OPEN_ADMISSION",
      disclosure: { badge_label: "", supporting_copy: "", disclaimer_tier: 0, disclaimer_text: null, show_admission_rate_required: false },
      program_earnings: null, earnings_vintage: null, earnings_method_flag: null,
      sticker_price: null, sticker_vintage: null, avg_debt: null, debt_income_ratio: null,
      debt_income_ratio_display: null, debt_vintage: null, debt_income_earnings: null,
      debt_income_basis_label: "", debt_income_earnings_fetched_on: null,
    })),
    derived_flags: { above_p75_schools: [], below_p25_schools: [] },
    debt_income_ratio_definition: "",
    graduation_rate_summary: graduationRateSummary(college_details),
    college_details,
    sat_positioning: {} as any,
  };
}

const text = (el: React.ReactElement) =>
  renderToStaticMarkup(el).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

// Graduation-rate cells only (data-grad-rate marks each one).
function gradCells(html: string): Array<{ kind: string; text: string }> {
  const out: Array<{ kind: string; text: string }> = [];
  const re = /<span data-grad-rate="([a-z-]+)">([\s\S]*?)<\/div><\/span>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) out.push({ kind: m[1], text: m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() });
  return out;
}

const pageProps = { reportId: "T", generatedDate: "November 18, 2026", pageNumber: 1, totalPages: 1 };

// ---------------------------------------------------------------------------

test("expected output for the three sample institutions", async () => {
  for (const [u, , cohort, shown] of EXPECTED) {
    const g = (await campusFor(u)).graduation_rate;
    assert.equal(g.status, "published");
    assert.equal(g.value, Number(ROWS[u].grad_rate_150nt_pct));
    assert.equal(g.cohort, cohort);
    assert.equal(g.value_display, shown);
    assert.equal(g.display, `${shown} (cohort of ${cohort.toLocaleString("en-US")} students)`);
  }
});

test("not multiplied by 100: Illinois Eastern renders 64.6%, not 6457% or 0.6%", async () => {
  const html = renderToStaticMarkup(React.createElement(CampusStudents, { payload: await payloadFor([145707]), ...pageProps }));
  const [cell] = gradCells(html);
  assert.equal(cell.kind, "published");
  assert.equal(cell.text, "64.6% (cohort of 717 students)");
  for (const bad of ["6457", "6,457", "0.6%", "0.65%", "16.7", "16.74", "17%", "65%"]) {
    assert.ok(!cell.text.includes(bad), `rendered ${bad}`);
  }
  assert.equal(formatGradRatePct(64.57), "64.6%");
  assert.equal(formatGradRatePct(8.35), "8.4%"); // float-safe rounding
  assert.equal(publishedGradRatePct({ grad_rate_150nt_pct: "64.57", grad_rate_cohort: 717 }), 64.57);
  assert.equal(publishedGradRatePct({ grad_rate_150nt_pct: "0.50", grad_rate_cohort: 717 }), 0.5); // small rates not scaled up
});

test("displayed rate never traces back to completion_rate, emp_factor or completed_*yrs", async () => {
  // 1. Behaviour: rows carry the deprecated columns; output equals grad_rate_150nt_pct only.
  for (const [u] of EXPECTED) {
    const g = (await campusFor(u)).graduation_rate;
    for (const col of DEPRECATED_COMPLETION_COLUMNS) {
      const v = ROWS[u][col];
      if (v == null) continue;
      const asPct = Number(v) <= 1 ? Number(v) * 100 : Number(v);
      assert.notEqual(g.value_display, formatGradRatePct(asPct), `${u} matches ${col}`);
    }
  }
  // 2. No fallback: rate null, deprecated columns populated → Not published.
  const g = (await campusFor(999001)).graduation_rate;
  assert.equal(g.status, "no_rate");
  assert.equal(g.value, null);
  assert.ok(!g.display.includes("42"));
  assert.ok(!g.display.includes("35.7"));
  // 3. Query: the completion SELECT names only the grad_rate_* columns.
  const completionSql = queries.filter((q) => /FROM\s+completion/i.test(q));
  assert.ok(completionSql.length > 0);
  for (const q of completionSql) {
    for (const col of GRAD_RATE_COLUMNS) assert.ok(q.includes(col), `missing ${col}`);
    for (const col of DEPRECATED_COMPLETION_COLUMNS) assert.ok(!new RegExp(`\\b${col}\\b`).test(q), `reads ${col}`);
    assert.ok(!/SELECT\s+\*/i.test(q));
  }
  // 4. Source scan: no report code (comments stripped) names a deprecated column.
  const root = path.join(__dirname);
  const files: string[] = [];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) && e.name !== "gradRate.ts") files.push(p);
    }
  };
  walk(root);
  for (const f of files) {
    const code = fs.readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    for (const col of DEPRECATED_COMPLETION_COLUMNS) {
      assert.ok(!new RegExp(`\\b${col}\\b`).test(code), `${path.relative(root, f)} references ${col}`);
    }
  }
  // 5. The deprecated values never reach the payload / AI prompt.
  const prompt = buildPromptText(await payloadFor([145707, 144892]));
  for (const bad of ["16.74", "14.23", "58.4", "49.64", "0.1674", "0.3687"]) {
    assert.ok(!prompt.includes(bad), `prompt contains ${bad}`);
  }
  // Column names as JSON keys (the Scorecard source-field value
  // "completion_rate_4yr_150nt" is a different, legitimate name).
  for (const col of DEPRECATED_COMPLETION_COLUMNS) {
    assert.ok(!prompt.includes(`"${col}"`), `prompt carries ${col}`);
  }
});

test("every displayed rate is numeric and between 0 and 100", async () => {
  const unitids = Object.keys(ROWS).map(Number);
  const payload = await payloadFor(unitids);
  const html =
    renderToStaticMarkup(React.createElement(CampusStudents, { payload, ...pageProps })) +
    renderToStaticMarkup(React.createElement(StudentProfile, { payload, narrative: buildFallbackNarrative(payload), ...pageProps }));
  const cells = gradCells(html);
  assert.equal(cells.length, unitids.length * 2);
  for (const c of cells.filter((x) => x.kind === "published")) {
    const m = c.text.match(/^(\d{1,3}\.\d)% \(cohort of [\d,]+ students?\)$/);
    assert.ok(m, `bad cell: ${c.text}`);
    const v = Number(m![1]);
    assert.ok(Number.isFinite(v) && v >= 0 && v <= 100);
  }
  // Out-of-range input is never displayed.
  assert.equal(resolveGradRate({ grad_rate_150nt_pct: 6457, grad_rate_cohort: 717 }).status, "no_rate");
  assert.equal(resolveGradRate({ grad_rate_150nt_pct: -1, grad_rate_cohort: 717 }).status, "no_rate");
  assert.equal(resolveGradRate({ grad_rate_150nt_pct: "abc", grad_rate_cohort: 717 }).status, "no_rate");
});

test("a null rate renders Not published, never 0% and never blank", async () => {
  const payload = await payloadFor([999001]);
  for (const el of [
    React.createElement(CampusStudents, { payload, ...pageProps }),
    React.createElement(StudentProfile, { payload, narrative: buildFallbackNarrative(payload), ...pageProps }),
  ]) {
    const [cell] = gradCells(renderToStaticMarkup(el));
    assert.equal(cell.kind, "not-published");
    assert.ok(cell.text.startsWith("Not published"));
    assert.ok(cell.text.includes("College Scorecard publishes no graduation rate"));
    assert.ok(!/\d+(\.\d+)?%/.test(cell.text), "shows a percent");
  }
  // Missing completion row altogether behaves the same.
  assert.equal(resolveGradRate(undefined).display, "Not published — College Scorecard publishes no graduation rate for this institution");
});

test("a cohort below MIN_GRAD_RATE_COHORT is suppressed and names the cohort", async () => {
  assert.equal(MIN_GRAD_RATE_COHORT, 10);
  const g = (await campusFor(497037)).graduation_rate;
  assert.equal(g.status, "small_cohort");
  assert.equal(g.value, null);
  assert.equal(g.display, "Not published — a cohort of 9 students is too small to report");
  const [cell] = gradCells(renderToStaticMarkup(React.createElement(CampusStudents, { payload: await payloadFor([497037]), ...pageProps })));
  assert.equal(cell.kind, "not-published");
  assert.ok(!cell.text.includes("0.0%"));
  // Boundary: exactly the threshold publishes; one below does not; 1 student is singular.
  assert.equal(resolveGradRate({ grad_rate_150nt_pct: 50, grad_rate_cohort: MIN_GRAD_RATE_COHORT }).status, "published");
  assert.equal(resolveGradRate({ grad_rate_150nt_pct: 50, grad_rate_cohort: MIN_GRAD_RATE_COHORT - 1 }).status, "small_cohort");
  assert.equal(resolveGradRate({ grad_rate_150nt_pct: 0, grad_rate_cohort: 1 }).display, "Not published — a cohort of 1 student is too small to report");
  // Rate present but cohort unknown is not publishable either.
  assert.equal(resolveGradRate({ grad_rate_150nt_pct: 50, grad_rate_cohort: null }).status, "small_cohort");
});

test("a genuine 0% on a large cohort is shown with its cohort", async () => {
  const g = (await campusFor(120184)).graduation_rate;
  assert.equal(g.display, "0.0% (cohort of 120 students)");
});

test("labels, methodology and sources describe what the figure measures", async () => {
  const payload = await payloadFor([145707]);
  const campus = text(React.createElement(CampusStudents, { payload, ...pageProps }));
  assert.ok(campus.includes("within 150% of normal time"));
  assert.ok(campus.includes("first-time, full-time students who finished at that same institution"));
  assert.ok(!campus.includes("outcome rates as reported to IPEDS"));
  const meth = text(React.createElement(Methodology, { payload, ...pageProps } as any));
  for (const s of ["150% of normal time", "first-time, full-time", "excludes part-time and transfer-in students", "counts students who transfer out as non-completers"]) {
    assert.ok(meth.includes(s), `methodology missing: ${s}`);
  }
  const src = text(React.createElement(SourcesMethodology, { payload, ...pageProps }));
  assert.ok(src.includes("Graduation rate is the graduation rate within 150% of normal time"));
  assert.ok(!src.includes("Completion Rates"));
});

test("AI prompt and fallback narrative use the same graduation-rate wording", async () => {
  const payload = await payloadFor([144892, 145707, 212805]);
  const summary = payload.graduation_rate_summary!;
  assert.equal(
    summary,
    "Graduation rate within 150% of normal time, first-time, full-time students who finished at that same institution: " +
      "Eastern Illinois University 49.5% (cohort of 913 students); " +
      "Illinois Eastern Community Colleges 64.6% (cohort of 717 students); " +
      "Grove City College 80.8% (cohort of 489 students).",
  );
  const prompt = buildPromptText(payload);
  assert.ok(prompt.includes("copy\ngraduation_rate_summary verbatim") || prompt.includes("graduation_rate_summary verbatim"));
  assert.ok(prompt.includes(JSON.stringify(summary)));
  assert.ok(!/NO campus-safety,\s*graduation-rate/.test(prompt), "prompt still denies having a graduation rate");

  const n = buildFallbackNarrative(payload);
  assert.ok(n.analyst_note.includes(summary));
  assert.deepEqual(gateGraduationRate(n, payload), []);

  // Gate: a paraphrased or wrong figure fails; silence passes; "completion rate" fails.
  const base = n as C1LiteNarrative;
  assert.deepEqual(gateGraduationRate({ ...base, analyst_note: "No figures." }, payload), []);
  assert.equal(gateGraduationRate({ ...base, analyst_note: "Illinois Eastern's graduation rate is 16.74%." }, payload).length, 1);
  assert.equal(gateGraduationRate({ ...base, analyst_note: `${summary} Its completion rate is lower.` }, payload).length, 1);
});
