/**
 * Integration: for a real report in the DB that has both charted and fallback
 * colleges (picked at runtime — no hard-coded id), build the SAT block, run
 * the acceptance gates, and print the section to a real PDF.
 *
 * The migration (src/db/migrations/sat_positioning.sql) is applied inside a
 * transaction that is ALWAYS rolled back, so this test never changes the
 * database and works whether or not the migration has been run yet.
 */
import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as path from "path";
import React from "react";
import ReactDOMServer from "react-dom/server";
import pool from "../db/client";
import { loadSatPositioning } from "./services/satPositioning.service";
import {
  gateSatBlock,
  gateSatCollegeSet,
  gateSatQueries,
  gateSatRenderedNumbers,
} from "./services/satPositioningGates";
import SatPositioning, {
  renderSatSectionHtml,
  satPositioningPageCount,
} from "./components/SatPositioning";
import { printHtmlToPdf } from "./services/pdf.service";
import type { C1LitePayload } from "./services/reportPrompt";

const hasDb = Boolean(process.env.DATABASE_URL || process.env.DB_PASSWORD);

test(
  "real report → SAT block passes gates → PDF",
  { skip: !hasDb && "no database configured", timeout: 120_000 },
  async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      // Apply the migration's statements without its own BEGIN/COMMIT, so the
      // outer ROLLBACK below discards everything.
      const migration = fs
        .readFileSync(
          path.join(__dirname, "..", "db", "migrations", "sat_positioning.sql"),
          "utf8",
        )
        .replace(/^\s*(BEGIN|COMMIT);\s*$/gim, "");
      await client.query(migration);

      const { rows: reports } = await client.query(
        `SELECT r.report_reference_id, array_agg(rc.unitid ORDER BY rc.display_order, rc.id) AS unitids
           FROM usdreports r
           JOIN usdreport_colleges rc ON rc.report_id = r.id
          GROUP BY r.id, r.report_reference_id
          ORDER BY r.id DESC`,
      );

      let picked: {
        ref: string;
        unitids: number[];
        block: Awaited<ReturnType<typeof loadSatPositioning>>;
      } | null = null;
      for (const r of reports) {
        const block = await loadSatPositioning(
          { reportReferenceId: r.report_reference_id },
          client,
        );
        if (block.state === "ok" && block.charted.length > 0 && block.fallback.length > 0) {
          picked = { ref: r.report_reference_id, unitids: r.unitids.map(Number), block };
          break;
        }
      }
      if (!picked) {
        // Nothing in this database exercises both paths — nothing to assert.
        console.warn("[integration] no report with both charted and fallback colleges; skipping");
        return;
      }
      const { block, unitids } = picked;

      // Gates 1–5
      assert.deepEqual(gateSatBlock(block), []);
      assert.deepEqual(gateSatCollegeSet(block, unitids), []);
      assert.deepEqual(gateSatQueries(), []);
      // Charted rows are sorted strongest fit → biggest stretch
      const deltas = block.charted.map((r) => r.midpointDelta);
      assert.deepEqual([...deltas].sort((a, b) => b - a), deltas);

      // Gate 6 on the rendered section
      assert.deepEqual(
        gateSatRenderedNumbers(renderSatSectionHtml(block), block),
        [],
      );

      // Real PDF of the section
      const payload = { sat_positioning: block } as unknown as C1LitePayload;
      const bodyHtml = ReactDOMServer.renderToStaticMarkup(
        React.createElement(SatPositioning, {
          payload,
          reportId: picked.ref,
          generatedDate: "",
          firstPageNumber: 1,
          totalPages: satPositioningPageCount(block),
        }),
      );
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
        @page { size: A4; margin: 0 } * { box-sizing: border-box } body { margin: 0 }
        </style></head><body>${bodyHtml}</body></html>`;
      const pdf = await printHtmlToPdf(html, picked.ref);
      assert.equal(pdf.subarray(0, 4).toString("latin1"), "%PDF");
      const pageCount = (pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length;
      assert.equal(pageCount, satPositioningPageCount(block));
      if (block.fallback.some((f) => f.websiteUrl)) {
        assert.match(pdf.toString("latin1"), /\/URI/, "website link must stay clickable in the PDF");
      }
    } finally {
      await client.query("ROLLBACK").catch(() => undefined);
      client.release();
      await pool.end();
    }
  },
);
