/** A college with no usable SAT range: name, badge and the category copy. */
import React from "react";
import type { SatFallbackRow } from "../../services/satPositioning";
import { satCopy } from "../../copy/satPositioning.copy";
import { theme } from "../theme";
import { COLS, BadgeTag, SchoolNotes } from "./shared";

export function FallbackRow({ row, compact = false }: { row: SatFallbackRow; compact?: boolean }) {
  return (
    <div
      style={{
        paddingTop: compact ? "5px" : "8px",
        marginBottom: compact ? "4px" : "8px",
        borderTop: `1px solid ${theme.color.hairline}`,
        breakInside: "avoid",
      }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: COLS,
          gap: "12px",
          alignItems: "center",
          marginBottom: compact ? "3px" : "6px",
        }}
      >
        <div>
          <div
            style={{
              fontSize: "11.5px",
              fontWeight: 700,
              color: theme.color.navy,
              lineHeight: 1.25,
              marginBottom: "3px",
            }}
          >
            {row.name}
          </div>
          <BadgeTag badge={row.badge} />
        </div>
        <div />
        <div
          style={{
            fontSize: "11px",
            fontWeight: 700,
            color: theme.sat.neutral,
          }}
        >
          {satCopy.noScoreData}
        </div>
      </div>
      <SchoolNotes
        supportingCopy={row.supportingCopy}
        disclaimerText={row.disclaimerText}
        contactGuidance={row.contactGuidance}
        websiteUrl={row.websiteUrl}
        compact={compact}
      />
    </div>
  );
}
