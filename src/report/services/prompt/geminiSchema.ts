/** Response schema that forces the model to return JSON matching C1LiteNarrative. */
// ---------------- GEMINI RESPONSE SCHEMA ----------------
const schoolLine = {
  type: "OBJECT",
  properties: { school: { type: "STRING" }, line: { type: "STRING" } },
  required: ["school", "line"],
};
const schoolSentence = {
  type: "OBJECT",
  properties: { school: { type: "STRING" }, sentence: { type: "STRING" } },
  required: ["school", "sentence"],
};

export const GEMINI_RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    two_minute_lines: { type: "ARRAY", items: schoolLine },
    executive_summary: { type: "STRING" },
    analyst_note: { type: "STRING" },
    net_price_note: { type: "STRING" },
    fit_sentences: { type: "ARRAY", items: schoolSentence },
    earnings_paragraph: { type: "STRING" },
    debt_burden_paragraph: { type: "STRING" },
    plain_english_question: { type: "STRING" },
  },
  required: [
    "two_minute_lines", "executive_summary", "analyst_note",
    "net_price_note", "fit_sentences", "earnings_paragraph", "debt_burden_paragraph",
    "plain_english_question",
  ],
};
