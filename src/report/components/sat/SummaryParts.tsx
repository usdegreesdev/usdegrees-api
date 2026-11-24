/** The summary chips above the chart and the footnote below it. */
import React from "react";
import type { SatPositioning as SatBlock } from "../../services/satPositioning";
import { satCopy } from "../../copy/satPositioning.copy";
import { theme } from "../theme";
import { keepColors } from "./shared";

export function Chips({ block }: { block: SatBlock }) {
  const chips: Array<{ text: string; color: string }> = [];
  const c = block.counts;
  const chipCopy = block.charted.some((r) => r.submittedOnly)
    ? satCopy.submittedChip
    : satCopy.chip;
  if (c.above > 0) chips.push({ text: chipCopy.above(c.above), color: theme.sat.above });
  if (c.within > 0) chips.push({ text: chipCopy.within(c.within), color: theme.sat.within });
  if (c.below > 0) chips.push({ text: chipCopy.below(c.below), color: theme.sat.below });
  if (c.noData > 0) chips.push({ text: satCopy.chip.noData(c.noData), color: theme.sat.neutral });
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginBottom: "12px" }}>
      {chips.map((ch) => (
        <span
          key={ch.text}
          style={{
            padding: "3px 10px",
            borderRadius: "12px",
            fontSize: "10.5px",
            fontWeight: 700,
            color: ch.color,
            border: `1px solid ${ch.color}`,
            backgroundColor: theme.color.white,
            ...keepColors,
          }}
        >
          {ch.text}
        </span>
      ))}
    </div>
  );
}

export function Note({ showSubmittedNote }: { showSubmittedNote: boolean }) {
  const style: React.CSSProperties = {
    fontSize: "8.5px",
    lineHeight: 1.5,
    color: theme.color.inkMuted,
    margin: "6px 0 0 0",
  };
  return (
    <>
      <p style={style}>
        {showSubmittedNote
          ? satCopy.submittedNote(satCopy.noteYear)
          : satCopy.note(satCopy.noteYear)}
      </p>
    </>
  );
}
