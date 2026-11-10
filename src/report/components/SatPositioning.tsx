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

const keepColors: React.CSSProperties = {
  WebkitPrintColorAdjust: "exact",
  printColorAdjust: "exact",
};

type Item =
  | { kind: "charted"; row: SatChartedRow }
  | { kind: "fallback"; row: SatFallbackRow }
  | { kind: "note" };

const weightOf = (it: Item) =>
  it.kind === "charted"
    ? SAT_LAYOUT.chartedRowWeight
    : it.kind === "fallback"
      ? SAT_LAYOUT.fallbackRowWeight
      : SAT_LAYOUT.noteWeight;

/** Split the section's rows across as many A4 pages as they need. */
export function paginateSat(block: SatBlock): Item[][] {
  if (block.state === "no_student_score") return [[]];
  const items: Item[] = [
    ...block.charted.map((row) => ({ kind: "charted" as const, row })),
    ...block.fallback.map((row) => ({ kind: "fallback" as const, row })),
  ];
  if (block.charted.length > 0) items.push({ kind: "note" });

  const pages: Item[][] = [[]];
  let used = 0;
  let cap: number = SAT_LAYOUT.firstPageCapacity;
  for (const it of items) {
    const w = weightOf(it);
    if (used + w > cap && pages[pages.length - 1].length > 0) {
      pages.push([]);
      used = 0;
      cap = SAT_LAYOUT.nextPageCapacity;
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

function ChartedRow({
  row,
  axis,
  score,
}: {
  row: SatChartedRow;
  axis: SatAxis;
  score: number;
}) {
  const color = statusColor[row.status];
  const scoreX = pctOf(axis, score);
  const bandL = pctOf(axis, row.p25);
  const bandR = pctOf(axis, row.p75);
  const edgeX = row.status === "below" ? bandL : bandR;
  const connL = Math.min(scoreX, edgeX);
  const connW = Math.abs(scoreX - edgeX);

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: COLS,
        gap: "12px",
        alignItems: "center",
        height: `${ROW_HEIGHT}px`,
        marginBottom: "8px",
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

      <Inset height={ROW_HEIGHT - 8}>
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
          <span>{satCopy.verdict[row.status]}</span>
        </div>
        <div
          style={{
            fontSize: "10px",
            lineHeight: 1.35,
            color: theme.color.inkMuted,
            marginTop: "3px",
          }}
        >
          {row.status === "above"
            ? satCopy.detail.above
            : row.status === "below"
              ? satCopy.detail.below
              : satCopy.detail.within(row.bandPosition ?? 0)}
        </div>
      </div>
    </div>
  );
}

function FallbackRow({ row }: { row: SatFallbackRow }) {
  const small: React.CSSProperties = {
    fontSize: "10px",
    lineHeight: 1.4,
    color: theme.color.ink,
    margin: "5px 0 0 0",
  };
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: COLS,
        gap: "12px",
        alignItems: "start",
        paddingTop: "8px",
        marginBottom: "8px",
        borderTop: `1px solid ${theme.color.hairline}`,
        breakInside: "avoid",
      }}
    >
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
          border: `1px dashed ${theme.color.inkFaint}`,
          borderRadius: "8px",
          padding: "9px 11px",
        }}
      >
        <BadgeTag badge={row.badge} />
        <p style={small}>{row.supportingCopy}</p>
        {row.disclaimerText && (
          <p style={{ ...small, color: theme.color.inkMuted }}>
            {row.disclaimerText}
          </p>
        )}
        <p style={small}>{row.contactGuidance}</p>
        {row.websiteUrl && (
          <p style={{ ...small, fontWeight: 700 }}>
            <a
              href={row.websiteUrl}
              style={{ color: theme.color.navy, textDecoration: "underline" }}
            >
              {satCopy.visit(websiteHost(row.websiteUrl))}
            </a>
          </p>
        )}
      </div>
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
  );
}

function Chips({ block }: { block: SatBlock }) {
  const chips: Array<{ text: string; color: string }> = [];
  const c = block.counts;
  if (c.above > 0) chips.push({ text: satCopy.chip.above(c.above), color: theme.sat.above });
  if (c.within > 0) chips.push({ text: satCopy.chip.within(c.within), color: theme.sat.within });
  if (c.below > 0) chips.push({ text: satCopy.chip.below(c.below), color: theme.sat.below });
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

function Note() {
  return (
    <p
      style={{
        fontSize: "8.5px",
        lineHeight: 1.5,
        color: theme.color.inkMuted,
        margin: "6px 0 0 0",
      }}
    >
      {satCopy.note(satCopy.noteYear)}
    </p>
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
  const hasCharted = items.some((i) => i.kind === "charted");
  let axisShown = false;

  return (
    <div>
      {pageIndex === 0 && <Chips block={block} />}
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
              <ChartedRow row={it.row} axis={block.axis} score={score} />
            </React.Fragment>
          );
        }
        if (it.kind === "fallback")
          return <FallbackRow key={`f${it.row.unitid}`} row={it.row} />;
        if (it.kind === "note") return <Note key={`n${i}`} />;
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
