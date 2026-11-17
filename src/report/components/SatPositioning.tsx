import React from "react";
import ReactDOMServer from "react-dom/server";
import type { C1LitePayload } from "../services/reportPrompt";
import type {
  SatAxis,
  SatBadge,
  SatChartedRow,
  SatFallbackRow,
  SatPositioning as SatBlock,
  SatStatus,
} from "../services/satPositioning";
import { websiteHost } from "../services/satPositioning";
import { SAT_LAYOUT } from "../config/satPositioning.config";
import { satCopy } from "../copy/satPositioning.copy";
import { theme } from "./theme";
import { pageStyle, PageHeader, PageFooter } from "./PageChrome";

/**
 * SECTION 05A · TEST SCORE POSITIONING (Design B: gap callouts, sorted).
 *
 * Pure HTML/CSS with percentage positioning: left% = (v − axis.min) /
 * (axis.max − axis.min) × 100. Every number comes from the satPositioning
 * payload block (computed in TypeScript, never by the model). Rows are
 * paginated by weight so any number of colleges renders cleanly.
 */

const COLS = "220px 1fr 180px";
const TRACK_INSET = 20; // px, keeps the score pill inside the column at the axis ends
const ROW_HEIGHT = 84;
const COMPACT_ROW_HEIGHT = 76;

const keepColors: React.CSSProperties = {
  WebkitPrintColorAdjust: "exact",
  printColorAdjust: "exact",
};

type Item =
  | { kind: "charted"; row: SatChartedRow }
  | { kind: "fallback"; row: SatFallbackRow }
  | { kind: "note" };

/**
 * Layout mode. `compact`: 4+ colleges where some carry copy (scores-considered
 * or no-range) get tighter rows/copy. `hideChips`: with 5+ such colleges and a
 * scores-considered school, the summary chips are dropped so it all fits.
 */
export function satLayoutMode(block: SatBlock): { compact: boolean; hideChips: boolean; noted: boolean } {
  const n = block.charted.length + block.fallback.length;
  const hasSub = block.charted.some((r) => r.submittedOnly);
  const noted = hasSub || block.fallback.length > 0;
  return { compact: noted && n >= 4, hideChips: hasSub && n >= 5, noted };
}

const textWeight = (texts: Array<string | null>, link: boolean, compact: boolean) => {
  const L = compact ? SAT_LAYOUT.compact : SAT_LAYOUT;
  // Compact copy flows supporting + disclaimer as one paragraph.
  const parts = compact
    ? [[texts[0], texts[1]].filter(Boolean).join(" "), texts[2]]
    : texts;
  const lines = parts
    .filter((t): t is string => !!t)
    .reduce((n, t) => n + Math.max(1, Math.ceil(t.length / L.notesLineChars)), 0);
  return lines * L.notesLineWeight + L.notesPadWeight + (link ? L.notesLinkWeight : 0);
};

const weightOf = (it: Item, compact: boolean) => {
  const L = compact ? SAT_LAYOUT.compact : SAT_LAYOUT;
  if (it.kind === "charted")
    return it.row.submittedOnly
      ? L.chartedRowWeight +
          textWeight([it.row.supportingCopy, it.row.disclaimerText, it.row.contactGuidance], false, compact)
      : SAT_LAYOUT.chartedRowWeight;
  if (it.kind === "fallback")
    return (
      L.fallbackHeaderWeight +
      textWeight(
        [it.row.supportingCopy, it.row.disclaimerText, it.row.contactGuidance],
        !!it.row.websiteUrl,
        compact,
      )
    );
  return SAT_LAYOUT.noteWeight;
};

/** Split the section's rows across as many A4 pages as they need. */
export function paginateSat(block: SatBlock): Item[][] {
  if (block.state === "no_student_score") return [[]];
  const { compact, hideChips, noted } = satLayoutMode(block);
  const items: Item[] = [
    ...block.charted.map((row) => ({ kind: "charted" as const, row })),
    ...block.fallback.map((row) => ({ kind: "fallback" as const, row })),
  ];
  if (block.charted.length > 0) items.push({ kind: "note" });
  const hasSubmitted = block.charted.some((r) => r.submittedOnly);

  const pages: Item[][] = [[]];
  let used = 0;
  // Rows carrying copy are weighed in measured px, so they use the calibrated
  // capacities; plain chart-only sections keep the original ones.
  let cap: number = noted
    ? hideChips
      ? SAT_LAYOUT.compact.firstPageCapacityNoChips
      : SAT_LAYOUT.compact.firstPageCapacity
    : SAT_LAYOUT.firstPageCapacity;
  for (const it of items) {
    const w =
      weightOf(it, compact) +
      (it.kind === "note" && hasSubmitted ? SAT_LAYOUT.submittedNoteExtraWeight : 0);
    if (used + w > cap && pages[pages.length - 1].length > 0) {
      pages.push([]);
      used = 0;
      cap = noted ? SAT_LAYOUT.compact.nextPageCapacity : SAT_LAYOUT.nextPageCapacity;
    }
    pages[pages.length - 1].push(it);
    used += w;
  }
  return pages;
}

export function satPositioningPageCount(block: SatBlock): number {
  return paginateSat(block).length;
}

const statusColor: Record<SatStatus, string> = {
  above: theme.sat.above,
  within: theme.sat.within,
  below: theme.sat.below,
};

function StatusIcon({ status }: { status: SatStatus }) {
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

function BadgeTag({ badge }: { badge: SatBadge }) {
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

const pctOf = (axis: SatAxis, v: number) =>
  ((v - axis.min) / (axis.max - axis.min)) * 100;

function Inset({
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

function AxisRow({ axis }: { axis: SatAxis }) {
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
function SchoolNotes({
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

function ChartedRow({
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

function FallbackRow({ row, compact = false }: { row: SatFallbackRow; compact?: boolean }) {
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

function Chips({ block }: { block: SatBlock }) {
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

function Note({ showSubmittedNote }: { showSubmittedNote: boolean }) {
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

/** Chrome-less content for one page of the section. */
export function SatPageContent({
  block,
  items,
  pageIndex,
}: {
  block: SatBlock;
  items: Item[];
  pageIndex: number;
}) {
  if (block.state === "no_student_score") {
    return (
      <div
        style={{
          border: `1px dashed ${theme.color.inkFaint}`,
          borderRadius: "10px",
          padding: "16px",
          fontSize: "12px",
          lineHeight: 1.6,
          color: theme.color.ink,
        }}
      >
        {satCopy.noStudentScore}
      </div>
    );
  }
  const score = block.studentScore as number;
  const { compact, hideChips } = satLayoutMode(block);
  const hasCharted = items.some((i) => i.kind === "charted");
  let axisShown = false;

  return (
    <div>
      {pageIndex === 0 && !hideChips && <Chips block={block} />}
      {pageIndex === 0 && block.state === "no_college_data" && (
        <p style={{ fontSize: "11.5px", lineHeight: 1.6, color: theme.color.ink, margin: "0 0 12px 0" }}>
          {satCopy.noCollegeData}
        </p>
      )}
      {items.map((it, i) => {
        if (it.kind === "charted" && block.axis) {
          const showAxis = hasCharted && !axisShown;
          axisShown = true;
          return (
            <React.Fragment key={`c${it.row.unitid}`}>
              {showAxis && <AxisRow axis={block.axis} />}
              <ChartedRow row={it.row} axis={block.axis} score={score} compact={compact} />
            </React.Fragment>
          );
        }
        if (it.kind === "fallback")
          return <FallbackRow key={`f${it.row.unitid}`} row={it.row} compact={compact} />;
        if (it.kind === "note")
          return (
            <Note
              key={`n${i}`}
              showSubmittedNote={block.charted.some((r) => r.submittedOnly)}
            />
          );
        return null;
      })}
    </div>
  );
}

export interface SatPositioningProps {
  payload: C1LitePayload;
  reportId: string;
  generatedDate: string;
  /** Page number of the section's first page. */
  firstPageNumber: number;
  totalPages: number;
}

const titleOf = (block: SatBlock) =>
  block.state === "no_student_score" || block.studentScore == null
    ? satCopy.titleNoScore
    : block.charted.some((r) => r.submittedOnly)
      ? satCopy.titleNeutral(block.studentScore)
      : satCopy.title(block.studentScore);

export default function SatPositioning({
  payload,
  reportId,
  generatedDate,
  firstPageNumber,
  totalPages,
}: SatPositioningProps) {
  const block = payload.sat_positioning;
  const pages = paginateSat(block);
  return (
    <>
      {pages.map((items, i) => (
        <div key={i} style={pageStyle}>
          <div>
            <PageHeader
              sectionLabel={`SECTION 05A · ${satCopy.eyebrow}`}
              title={titleOf(block)}
            />
            <SatPageContent block={block} items={items} pageIndex={i} />
          </div>
          <PageFooter
            reportId={reportId}
            generatedDate={generatedDate}
            pageNumber={firstPageNumber + i}
            totalPages={totalPages}
          />
        </div>
      ))}
    </>
  );
}

/**
 * The section's visible text content (title + every page body, no page
 * chrome) as static HTML — what acceptance gate 6 scans for stray numbers.
 */
export function renderSatSectionHtml(block: SatBlock): string {
  const pages = paginateSat(block);
  const body = ReactDOMServer.renderToStaticMarkup(
    <div>
      {pages.map((items, i) => (
        <SatPageContent key={i} block={block} items={items} pageIndex={i} />
      ))}
    </div>,
  );
  return `<h2>${titleOf(block)}</h2>${body}`;
}
