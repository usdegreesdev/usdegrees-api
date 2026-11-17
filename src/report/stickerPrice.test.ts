import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  inStateOnCampus,
  outOfStateOffCampus,
  STICKER_FOOTNOTE,
  STICKER_METHODOLOGY,
} from "./utils/stickerPrice";
import TuitionCosts from "./components/TuitionCosts";
import Methodology from "./components/Methodology";
import { buildPromptText, costOfAttendanceNote } from "./services/reportPrompt";

const full = {
  tuition_in_state: 100, tuition_out_state: 200,
  roomboard_oncampus: 10, roomboard_offcampus: 20,
  booksupply: 1, otherexpense_oncampus: 2, otherexpense_offcampus: 3,
};

test("all components present", () => {
  assert.deepEqual(inStateOnCampus(full), { published: true, total: 113, missing: [] });
  assert.deepEqual(outOfStateOffCampus(full), { published: true, total: 224, missing: [] });
});

test("each component null in turn", () => {
  const inKeys: Array<[keyof typeof full, string]> = [
    ["tuition_in_state", "in-state tuition"],
    ["roomboard_oncampus", "on-campus room and board"],
    ["booksupply", "books and supplies"],
    ["otherexpense_oncampus", "on-campus other expenses"],
  ];
  for (const [k, name] of inKeys) {
    const r = inStateOnCampus({ ...full, [k]: null });
    assert.equal(r.published, false);
    assert.equal(r.total, null);
    assert.deepEqual(r.missing, [name]);
    assert.equal(inStateOnCampus({ ...full, [k]: undefined }).published, false);
  }
  const outKeys: Array<[keyof typeof full, string]> = [
    ["tuition_out_state", "out-of-state tuition"],
    ["roomboard_offcampus", "off-campus room and board"],
    ["booksupply", "books and supplies"],
    ["otherexpense_offcampus", "off-campus other expenses"],
  ];
  for (const [k, name] of outKeys) {
    const r = outOfStateOffCampus({ ...full, [k]: null });
    assert.equal(r.published, false);
    assert.deepEqual(r.missing, [name]);
  }
});

test("a real 0 is allowed", () => {
  const r = inStateOnCampus({ ...full, booksupply: 0 });
  assert.deepEqual(r, { published: true, total: 112, missing: [] });
});

const schools: Record<string, any> = {
  "144892": { name: "Eastern Illinois University", c: { tuition_in_state: 14654, tuition_out_state: 17261, roomboard_oncampus: 13020, roomboard_offcampus: 13020, booksupply: 150, otherexpense_oncampus: 2084, otherexpense_offcampus: 2084 }, sc: 26962, yr: "2024-25" },
  "145707": { name: "Illinois Eastern Community Colleges", c: { tuition_in_state: 5260, tuition_out_state: 12460, roomboard_oncampus: null, roomboard_offcampus: 7338, booksupply: 1460, otherexpense_oncampus: null, otherexpense_offcampus: 9852 }, sc: 17733, yr: "2024-25" },
  "212805": { name: "Grove City College", c: { tuition_in_state: 22570, tuition_out_state: 22570, roomboard_oncampus: 12720, roomboard_offcampus: 12720, booksupply: 700, otherexpense_oncampus: 1200, otherexpense_offcampus: 1200 }, sc: null, yr: null },
};
function payload(): any {
  return {
    student: { income_bracket_label: null },
    schools: [],
    college_details: Object.entries(schools).map(([unitid, s]) => ({
      unitid, name: s.name,
      tuition: {
        sticker_in_state_on_campus: inStateOnCampus(s.c),
        sticker_out_state_off_campus: outOfStateOffCampus(s.c),
        scorecard_avg_coa: s.sc, scorecard_avg_coa_year: s.yr, net_price: null,
        tuition_in_state: s.c.tuition_in_state, tuition_out_state: s.c.tuition_out_state,
        room_board_on_campus: s.c.roomboard_oncampus, room_board_off_campus: s.c.roomboard_offcampus,
        books_supply: s.c.booksupply, other_expense_on_campus: s.c.otherexpense_oncampus,
        other_expense_off_campus: s.c.otherexpense_offcampus, other_expense_with_family: null,
      },
    })),
  };
}

test("expected schools", () => {
  const d = payload().college_details;
  assert.equal(d[0].tuition.sticker_in_state_on_campus.total, 29908);
  assert.equal(d[0].tuition.sticker_out_state_off_campus.total, 32515);
  assert.equal(d[1].tuition.sticker_in_state_on_campus.total, null);
  assert.deepEqual(d[1].tuition.sticker_in_state_on_campus.missing, ["on-campus room and board", "on-campus other expenses"]);
  assert.equal(d[1].tuition.sticker_out_state_off_campus.total, 31110);
  assert.equal(d[2].tuition.sticker_in_state_on_campus.total, 37190);
  assert.equal(d[2].tuition.sticker_out_state_off_campus.total, 37190);
});

test("rendered cost page", () => {
  const html = renderToStaticMarkup(
    React.createElement(TuitionCosts, { payload: payload(), reportId: "r", generatedDate: "d", pageNumber: 1, totalPages: 1 }),
  );
  const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  console.log(text);
  for (const s of ["$29,908", "$32,515", "$26,962", "2024-25", "$31,110", "$17,733", "$37,190",
    "Sticker price: in-state, living on campus", "Sticker price: out-of-state, living off campus",
    "Scorecard average cost of attendance",
    "missing: on-campus room and board, on-campus other expenses"]) {
    assert.ok(text.includes(s), s);
  }
  assert.ok(!text.includes("$6,720"));
  assert.ok(!text.includes("$0"));
  assert.ok(text.includes(STICKER_FOOTNOTE.replace(/'/g, "&#x27;")) || text.includes(STICKER_FOOTNOTE));
});

test("methodology block", () => {
  const html = renderToStaticMarkup(
    React.createElement(Methodology, { payload: payload(), reportId: "r", generatedDate: "d", pageNumber: 1, totalPages: 1 }),
  );
  const text = html.replace(/<[^>]+>/g, "").replace(/&#x27;/g, "'").replace(/\s+/g, " ");
  assert.ok(text.includes(STICKER_METHODOLOGY.split(":")[0]));
  assert.ok(text.includes("The three figures are not interchangeable."));
});

test("prompt and fallback wording", () => {
  const p = payload();
  const prompt = buildPromptText(p);
  assert.ok(prompt.includes('never call a scenario total'.replace("never", "Never")) || prompt.includes("Never call a scenario total"));
  assert.ok(prompt.includes("never combine or compare the three figures"));
  assert.ok(prompt.includes("never describe a missing figure as $0"));
  const note = costOfAttendanceNote(p);
  assert.ok(note.includes("in-state tuition living on campus not published (missing: on-campus room and board, on-campus other expenses)"));
  assert.ok(note.includes("College Scorecard average cost of attendance $17,733 (2024-25)"));
  assert.ok(note.includes("Grove City College: sticker price for in-state tuition living on campus $37,190"));
  assert.ok(!note.includes("$0") && !note.includes("$6,720"));
});
