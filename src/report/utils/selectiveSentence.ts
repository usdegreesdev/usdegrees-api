/**
 * The "This is a selective school — not all applicants are admitted" sentence
 * lives in admission_disclosure_categories.disclaimer_text (B_NOT_USED). It is
 * a rendering rule only: the stored text, categories and admit rates are not
 * changed; the sentence is dropped per college when it would contradict the
 * college's own admit rate.
 */

/** Admit rate (in percent, 0–100) below which a school is called selective. */
export const SELECTIVE_ADMIT_RATE_MAX = 80;

/**
 * `admitRate` is the same value page 5 prints: a rounded 0–100 percentage
 * (the database stores a 0–1 fraction; convert with toFraction * 100 first).
 * Missing means omit.
 */
export function shouldShowSelectiveSentence(
  admitRate: number | null | undefined,
): boolean {
  return (
    admitRate != null &&
    Number.isFinite(admitRate) &&
    admitRate < SELECTIVE_ADMIT_RATE_MAX
  );
}

const SELECTIVE_SENTENCE_RE =
  /This is a selective school\s*[—–-]\s*not all applicants are admitted\.?/;

/**
 * Removes the selective-school sentence (and the whitespace around it) from a
 * disclosure text unless the admit rate supports it. The remaining sentences
 * are left untouched; an emptied text becomes null.
 */
export function applySelectiveRule(
  text: string | null,
  admitRate: number | null | undefined,
): string | null {
  if (!text || shouldShowSelectiveSentence(admitRate)) return text;
  if (!SELECTIVE_SENTENCE_RE.test(text)) return text;
  const cleaned = text
    .replace(SELECTIVE_SENTENCE_RE, " ")
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s.,;:—–-]+/, "")
    .trim();
  return cleaned.length > 0 ? cleaned : null;
}
