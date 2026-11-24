import React from "react";
import ReactDOMServer from "react-dom/server";
import type { C1LitePayload } from "../services/reportPrompt";
import type { SatPositioning as SatBlock } from "../services/satPositioning";
import { satCopy } from "../copy/satPositioning.copy";
import { theme } from "./theme";
import { pageStyle, PageHeader, PageFooter } from "./PageChrome";
import { paginateSat, satLayoutMode, satPositioningPageCount, type Item } from "./sat/layout";
import { AxisRow } from "./sat/shared";
import { ChartedRow } from "./sat/ChartedRow";
import { FallbackRow } from "./sat/FallbackRow";
import { Chips, Note } from "./sat/SummaryParts";

/**
 * SECTION 04 · TEST SCORE POSITIONING (Design B: gap callouts, sorted).
 *
 * Pure HTML/CSS with percentage positioning: left% = (v − axis.min) /
 * (axis.max − axis.min) × 100. Every number comes from the satPositioning
 * payload block (computed in TypeScript, never by the model). Rows are
 * paginated by weight so any number of colleges renders cleanly.
 *
 * Layout of this section is split across ./sat/:
 *   layout.ts        pagination and layout mode
 *   shared.tsx       axis, badge, icon, school notes
 *   ChartedRow.tsx   a college positioned on the axis
 *   FallbackRow.tsx  a college with no usable SAT range
 *   SummaryParts.tsx chips and footnote
 * This file assembles the pages. Re-exports keep older import paths working.
 */
export { paginateSat, satLayoutMode, satPositioningPageCount };

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
              sectionLabel={`SECTION 04 · ${satCopy.eyebrow}`}
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
