import React from "react";
import { theme } from "./theme";
import { GRAD_RATE_NOT_PUBLISHED, type GradRate } from "../utils/gradRate";

/**
 * Value-or-reason cell for the graduation rate: "64.6%" with
 * "(cohort of 717 students)" beside it, or "Not published" with the reason.
 * Never renders 0% or a blank for a missing rate.
 */
export default function GradRateCell({ rate }: { rate: GradRate | null | undefined }) {
  const sub: React.CSSProperties = {
    fontSize: "8.5px",
    fontWeight: 500,
    color: theme.color.inkMuted,
    marginTop: "2px",
  };
  if (!rate || rate.status !== "published" || rate.value_display == null) {
    return (
      <span data-grad-rate="not-published">
        {GRAD_RATE_NOT_PUBLISHED}
        <div style={sub}>
          {rate?.reason ?? "College Scorecard publishes no graduation rate for this institution"}
        </div>
      </span>
    );
  }
  return (
    <span data-grad-rate="published">
      {rate.value_display}
      <div style={sub}>{rate.cohort_display}</div>
    </span>
  );
}
