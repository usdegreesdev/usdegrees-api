/** One college row with a score position on the SAT axis (gap callout, verdict, optional notes). */
import React from "react";
import type { SatAxis, SatChartedRow } from "../../services/satPositioning";
import { satCopy } from "../../copy/satPositioning.copy";
import { theme } from "../theme";
import {
  COLS,
  keepColors,
  statusColor,
  pctOf,
  Inset,
  BadgeTag,
  StatusIcon,
  SchoolNotes,
} from "./shared";

const ROW_HEIGHT = 84;
const COMPACT_ROW_HEIGHT = 76;

export function ChartedRow({
  row,
  axis,
  score,
  compact = false,
}: {
  row: SatChartedRow;
  axis: SatAxis;
  score: number;
  compact?: boolean;
}) {
  const ROW_H = compact && row.submittedOnly ? COMPACT_ROW_HEIGHT : ROW_HEIGHT;
  const color = statusColor[row.status];
  const scoreX = pctOf(axis, score);
  const bandL = pctOf(axis, row.p25);
  const bandR = pctOf(axis, row.p75);
  const edgeX = row.status === "below" ? bandL : bandR;
  const connL = Math.min(scoreX, edgeX);
  const connW = Math.abs(scoreX - edgeX);
  const sub = row.submittedOnly;

  return (
    <div style={{ breakInside: "avoid", marginBottom: sub ? (compact ? "5px" : "8px") : undefined }}>
    <div
      style={{
        display: "grid",
        gridTemplateColumns: COLS,
        gap: "12px",
        alignItems: "center",
        height: `${ROW_H}px`,
        marginBottom: compact && sub ? "3px" : "8px",
        borderTop: `1px solid ${theme.color.hairline}`,
        breakInside: "avoid",
      }}
    >
      <div>
        <div
          style={{
            fontSize: "11.5px",
            fontWeight: 700,
            color: theme.color.navy,
            lineHeight: 1.25,
          }}
        >
          {row.name}
        </div>
        <div
          style={{
            fontFamily: theme.font.mono,
            fontSize: "9.5px",
            color: theme.color.inkMuted,
            margin: "3px 0",
          }}
        >
          {satCopy.mid50(row.p25, row.p75)}
        </div>
        {row.badge && <BadgeTag badge={row.badge} />}
      </div>

      <Inset height={ROW_H - 8}>
        {axis.ticks.map((t) => (
          <div
            key={t}
            style={{
              position: "absolute",
              top: 0,
              bottom: 0,
              left: `${pctOf(axis, t)}%`,
              width: "1px",
              backgroundColor: theme.sat.grid,
              ...keepColors,
            }}
          />
        ))}
        <div
          style={{
            position: "absolute",
            top: "38px",
            left: 0,
            right: 0,
            height: "14px",
            borderRadius: "7px",
            backgroundColor: theme.sat.track,
            ...keepColors,
          }}
        />
        <div
          style={{
            position: "absolute",
            top: "38px",
            left: `${bandL}%`,
            width: `${bandR - bandL}%`,
            height: "14px",
            boxSizing: "border-box",
            borderRadius: "3px",
            backgroundColor: theme.sat.band,
            border: `1px solid ${theme.sat.bandBorder}`,
            ...keepColors,
          }}
        />
        {row.status !== "within" && (
          <>
            <div
              style={{
                position: "absolute",
                top: "44px",
                left: `${connL}%`,
                width: `${connW}%`,
                borderTop: `2px dashed ${color}`,
              }}
            />
            <div
              style={{
                position: "absolute",
                top: "60px",
                left: `${connL}%`,
                width: `${connW}%`,
                display: "flex",
                justifyContent: "center",
                whiteSpace: "nowrap",
                fontFamily: theme.font.mono,
                fontSize: "9.5px",
                fontWeight: 700,
                color,
              }}
            >
              {row.status === "below"
                ? satCopy.gapBelow(row.gapPoints ?? 0)
                : satCopy.gapAbove(row.gapPoints ?? 0)}
            </div>
          </>
        )}
        <div
          style={{
            position: "absolute",
            top: "24px",
            left: `${scoreX}%`,
            width: "2px",
            height: "34px",
            marginLeft: "-1px",
            backgroundColor: theme.sat.stem,
            ...keepColors,
          }}
        />
        <div
          style={{
            position: "absolute",
            top: "4px",
            left: `${scoreX}%`,
            transform: "translateX(-50%)",
            padding: "0 7px",
            height: "20px",
            lineHeight: "20px",
            borderRadius: "10px",
            backgroundColor: theme.sat.marker,
            color: theme.sat.markerText,
            fontFamily: theme.font.mono,
            fontSize: "10.5px",
            fontWeight: 700,
            ...keepColors,
          }}
        >
          {score}
        </div>
        {row.status === "within" && (
          <div
            style={{
              position: "absolute",
              top: "60px",
              left: `${scoreX}%`,
              transform: "translateX(-50%)",
              whiteSpace: "nowrap",
              fontFamily: theme.font.mono,
              fontSize: "9.5px",
              fontWeight: 700,
              color,
            }}
          >
            {satCopy.inRange}
          </div>
        )}
      </Inset>

      <div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "5px",
            color,
            fontSize: "12px",
            fontWeight: 700,
          }}
        >
          <StatusIcon status={row.status} />
          <span>
            {(sub ? satCopy.submittedVerdict : satCopy.verdict)[row.status]}
          </span>
        </div>
        <div
          style={{
            fontSize: "10px",
            lineHeight: 1.35,
            color: theme.color.inkMuted,
            marginTop: "3px",
          }}
        >
          {(() => {
            const d = sub ? satCopy.submittedDetail : satCopy.detail;
            return row.status === "above"
              ? d.above
              : row.status === "below"
                ? d.below
                : d.within(row.bandPosition ?? 0);
          })()}
        </div>
      </div>
    </div>
    {sub && (
      <SchoolNotes
        supportingCopy={row.supportingCopy}
        disclaimerText={row.disclaimerText}
        contactGuidance={row.contactGuidance}
        compact={compact}
      />
    )}
    </div>
  );
}
