/** Small building blocks shared by the SAT section's rows: axis, badges, status icon, school notes. */
import React from "react";
import type { SatAxis, SatBadge, SatStatus } from "../../services/satPositioning";
import { websiteHost } from "../../services/satPositioning";
import { satCopy } from "../../copy/satPositioning.copy";
import { theme } from "../theme";

export const COLS = "220px 1fr 180px";
export const TRACK_INSET = 20; // px, keeps the score pill inside the column at the axis ends
export const keepColors: React.CSSProperties = {
  WebkitPrintColorAdjust: "exact",
  printColorAdjust: "exact",
};

export const statusColor: Record<SatStatus, string> = {
  above: theme.sat.above,
  within: theme.sat.within,
  below: theme.sat.below,
};

export function StatusIcon({ status }: { status: SatStatus }) {
  const common = {
    width: 14,
    height: 14,
    viewBox: "0 0 16 16",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  if (status === "above")
    return (
      <svg {...common}>
        <path d="M8 13V3M3.5 7.5 8 3l4.5 4.5" />
      </svg>
    );
  if (status === "below")
    return (
      <svg {...common}>
        <path d="M8 3v10M3.5 8.5 8 13l4.5-4.5" />
      </svg>
    );
  return (
    <svg {...common}>
      <path d="m3 8.5 3.2 3.2L13 4.8" />
    </svg>
  );
}

export function BadgeTag({ badge }: { badge: SatBadge }) {
  const p = theme.badge[badge.color] ?? theme.badge.neutral;
  return (
    <span
      style={{
        display: "inline-block",
        padding: "1px 7px",
        borderRadius: "9px",
        fontSize: "8.5px",
        fontWeight: 700,
        color: p.fg,
        backgroundColor: p.bg,
        border: `1px solid ${p.border}`,
        ...keepColors,
      }}
    >
      {badge.label}
    </span>
  );
}

export const pctOf = (axis: SatAxis, v: number) =>
  ((v - axis.min) / (axis.max - axis.min)) * 100;

export function Inset({
  children,
  height,
}: {
  children: React.ReactNode;
  height: number;
}) {
  return (
    <div style={{ padding: `0 ${TRACK_INSET}px` }}>
      <div style={{ position: "relative", height: `${height}px` }}>
        {children}
      </div>
    </div>
  );
}

export function AxisRow({ axis }: { axis: SatAxis }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: COLS,
        gap: "12px",
        marginBottom: "2px",
      }}
    >
      <div />
      <Inset height={16}>
        {axis.ticks.map((t) => (
          <span
            key={t}
            style={{
              position: "absolute",
              top: 0,
              left: `${pctOf(axis, t)}%`,
              transform: "translateX(-50%)",
              fontFamily: theme.font.mono,
              fontSize: "9px",
              color: theme.color.inkFaint,
            }}
          >
            {t}
          </span>
        ))}
      </Inset>
      <div />
    </div>
  );
}

/**
 * Category copy under a school's row (submitted-only and no-range schools):
 * supporting copy, disclaimer, then contact guidance last, on a tinted
 * background so it is easy to pick out.
 */
export function SchoolNotes({
  supportingCopy,
  disclaimerText,
  contactGuidance,
  websiteUrl,
  compact = false,
}: {
  supportingCopy: string | null;
  disclaimerText: string | null;
  contactGuidance: string | null;
  websiteUrl?: string | null;
  compact?: boolean;
}) {
  const p: React.CSSProperties = {
    fontSize: compact ? "9px" : "10px",
    lineHeight: compact ? 1.3 : 1.4,
    color: theme.color.ink,
    margin: compact ? "0 0 2px 0" : "0 0 3px 0",
  };
  return (
    <div
      style={{
        backgroundColor: theme.color.panelBg,
        borderRadius: "6px",
        padding: compact ? "4px 9px" : "6px 10px",
        ...keepColors,
      }}
    >
      {compact ? (
        (supportingCopy || disclaimerText) && (
          <p style={p}>
            {supportingCopy}
            {disclaimerText && (
              <span style={{ color: theme.color.inkMuted }}> {disclaimerText}</span>
            )}
          </p>
        )
      ) : (
        <>
          {supportingCopy && <p style={p}>{supportingCopy}</p>}
          {disclaimerText && (
            <p style={{ ...p, color: theme.color.inkMuted }}>{disclaimerText}</p>
          )}
        </>
      )}
      {contactGuidance && (
        <p style={{ ...p, fontWeight: 700, color: theme.color.navy, margin: 0 }}>
          {contactGuidance}
        </p>
      )}
      {websiteUrl && (
        <p style={{ ...p, fontWeight: 700, margin: "2px 0 0 0" }}>
          <a
            href={websiteUrl}
            style={{ color: theme.color.navy, textDecoration: "underline" }}
          >
            {satCopy.visit(websiteHost(websiteUrl))}
          </a>
        </p>
      )}
    </div>
  );
}
