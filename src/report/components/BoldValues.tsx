import React from "react";

// Dollar amounts ($1,234 / $1.2 million), percentages (12.5%), ratios (0.4x)
// and plain figures (1,234 / 3.5). Four-digit years and year ranges
// (2023, 2022-23) are left plain — they label data, they are not values.
const VALUE_RE =
  /(\$\d[\d,]*(?:\.\d+)?(?:\s?(?:million|billion|thousand|[kKmMbB])\b)?|\b\d[\d,]*(?:\.\d+)?\s?%|\b(?:19|20)\d\d(?:[-–]\d{2,4})?\b|\b\d[\d,]*(?:\.\d+)?x\b|\b\d[\d,]*(?:\.\d+)?\b)/g;
const YEAR_RE = /^(?:19|20)\d\d(?:[-–]\d{2,4})?$/;

/**
 * Renders prose with every numeric value in bold. Text only — numbers inside
 * labels like "Year 5" or "Unit ID" are bolded too, which is acceptable for
 * the narrative paragraphs this is used on.
 */
export function BoldValues({ text }: { text: string | null | undefined }) {
  if (!text) return null;
  const parts = text.split(VALUE_RE);
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 && !YEAR_RE.test(part) ? (
          <strong key={i}>{part}</strong>
        ) : (
          <React.Fragment key={i}>{part}</React.Fragment>
        ),
      )}
    </>
  );
}
