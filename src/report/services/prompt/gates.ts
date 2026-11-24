/**
 * Acceptance gates: checks run on the finished narrative (and payload) before
 * a report ships. Each gate returns a list of error strings; empty = pass.
 */
import { gateSatNarrative, runSatGates } from "../satPositioningGates";
import { FIT_UNAVAILABLE_SENTENCE } from "../../config/satPositioning.config";
import { gradRateSummaryFor } from "./fallbackNarrative";
import type { C1LitePayload, C1LiteNarrative } from "./types";

// ---------------- ACCEPTANCE GATES ----------------
const BANNED = [
  "premier", "cutting-edge", "state-of-the-art", "in the heart of", "foster", "fostering",
  "world-class", "unparalleled", "prestigious", "elite", "renowned", "dedicated to",
];
const ADVICE = ["we recommend", "you should", "best choice", "top pick", "best school", "optimal choice"];

// Thousands separators are a presentation choice, not a new number, so both
// sides are compared with commas stripped: "$54,000" traces to a payload 54000.
export function gateNumbersTraceable(n: C1LiteNarrative, payload: C1LitePayload): string[] {
  const hay = JSON.stringify(payload);
  const nums = JSON.stringify(n).match(/\d[\d,]*(?:\.\d+)?/g) ?? [];
  return [...new Set(nums)].filter(
    (num) => !hay.includes(num) && !hay.includes(num.replace(/,/g, "")),
  );
}
// Phrases that must never reach the report. Checked as whole words/phrases,
// case-insensitively, against the narrative's text (not its JSON keys) and —
// via findBannedPhrases in pdf.service — against the rendered pages.
export const BANNED_PHRASES: ReadonlyArray<{ phrase: string; re: RegExp }> = [
  { phrase: "merit", re: /\bmerit\b/i },
  { phrase: "ROI", re: /\bROI\b/i },
  { phrase: "20-year", re: /\b20[- ]year\b/i },
  { phrase: "CRITICAL", re: /\bcritical\b/i },
  { phrase: "may qualify", re: /\bmay qualify\b/i },
  { phrase: "3 in 4", re: /\b3 in 4\b/i },
  { phrase: "lifetime", re: /\blifetime\b/i },
];
export function findBannedPhrases(text: string): string[] {
  return BANNED_PHRASES.filter((b) => b.re.test(text)).map((b) => b.phrase);
}
export function gateBannedPhrases(n: C1LiteNarrative): string[] {
  return findBannedPhrases(narrativeText(n));
}
export function gateBannedVocab(n: C1LiteNarrative): string[] {
  const blob = JSON.stringify(n).toLowerCase();
  return BANNED.filter((w) => blob.includes(w));
}
export function gateNeutrality(n: C1LiteNarrative): string[] {
  const blob = JSON.stringify(n).toLowerCase();
  return ADVICE.filter((w) => blob.includes(w)).map((w) => `Recommendation/advice phrase: "${w}"`);
}
export function gateBranchConsistency(n: C1LiteNarrative, payload: C1LitePayload): string[] {
  const errs: string[] = [];
  const blob = JSON.stringify(n).toLowerCase();
  const mentions75 = blob.includes("75th");
  if (payload.derived_flags.above_p75_schools.length === 0 && mentions75)
    errs.push("75th-percentile language present but above_p75_schools is empty.");
  return errs;
}
function narrativeText(n: C1LiteNarrative): string {
  const out: string[] = [];
  const walk = (v: unknown) => {
    if (typeof v === "string") out.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(n);
  return out.join("\n");
}

// Graduation rate may be omitted, but any mention must be the shared sentence
// verbatim, and the deprecated "completion rate" framing never appears.
export function gateGraduationRate(n: C1LiteNarrative, payload: C1LitePayload): string[] {
  const errs: string[] = [];
  const text = narrativeText(n);
  if (/completion rate/i.test(text)) errs.push('Graduation rate described as a "completion rate".');
  if (/graduation rate|graduat\w* within 150%/i.test(text)) {
    const summary = gradRateSummaryFor(payload);
    if (!summary || !text.includes(summary)) {
      errs.push("Graduation rate mentioned without copying graduation_rate_summary verbatim.");
    }
  }
  return errs;
}

/**
 * Every school whose fit_label is "Unavailable" must have a fit sentence that
 * copies FIT_UNAVAILABLE_SENTENCE verbatim and names no fit category — the
 * same verbatim rule as the graduation-rate summary.
 */
export function gateFitUnavailable(n: C1LiteNarrative, payload: C1LitePayload): string[] {
  const errs: string[] = [];
  for (const s of payload.schools) {
    if (s.fit_label !== "Unavailable") continue;
    const entry = (n.fit_sentences ?? []).find((f) => f.school === s.display_name);
    if (!entry || !entry.sentence.includes(FIT_UNAVAILABLE_SENTENCE)) {
      errs.push(`Fit for ${s.display_name} is Unavailable but the sentence is not copied verbatim.`);
    } else if (/Target\/Match|\bReach\b/.test(entry.sentence)) {
      errs.push(`Fit for ${s.display_name} is Unavailable but names a fit category.`);
    }
  }
  return errs;
}

/**
 * A school whose SAT/admission category is D_REVIEW_PENDING ("Verifying Testing
 * Requirements") carries an unverified open-admission tag; no report may show it.
 */
export function gateUnverifiedAdmissionTag(payload: C1LitePayload): string[] {
  return payload.schools
    .filter((s) => s.sat_data_category === "D_REVIEW_PENDING")
    .map((s) => `${s.display_name} carries an unverified open-admission tag (D_REVIEW_PENDING).`);
}

export function runGates(n: C1LiteNarrative, payload: C1LitePayload): string[] {
  return [
    ...gateGraduationRate(n, payload),
    ...gateFitUnavailable(n, payload),
    ...gateUnverifiedAdmissionTag(payload),
    ...gateNumbersTraceable(n, payload).map((x) => `Orphan number: ${x}`),
    ...gateBannedVocab(n).map((x) => `Banned word: ${x}`),
    ...gateBannedPhrases(n).map((x) => `Banned phrase: ${x}`),
    ...gateNeutrality(n),
    ...gateBranchConsistency(n, payload),
    ...gateSatNarrative(n, payload),
    ...runSatGates(payload),
  ];
}