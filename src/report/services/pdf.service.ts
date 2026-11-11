import React from "react";
import ReactDOMServer from "react-dom/server";
import chromium from "@sparticuz/chromium";
import puppeteerCore, { Browser } from "puppeteer-core";
import * as path from "path";
import * as fs from "fs";
import ReportDocument from "../components/ReportDocument";
import Cover from "../components/Cover";
import { buildCoverModel, validateCoverText } from "../components/coverData";
import { renderSatSectionHtml } from "../components/SatPositioning";
import { gateSatRenderedNumbers } from "./satPositioningGates";
import type { C1LitePayload, C1LiteNarrative } from "./reportPrompt";

/**
 * The cover logo is embedded as a base64 data URI rather than referenced by
 * path/URL: Puppeteer's page.setContent() has no base URL to resolve a
 * relative <img src> against, and there's no guarantee a web server is
 * running to serve it from over HTTP in every environment this renders in.
 * Read once and cached — the file never changes at runtime.
 */
let cachedLogoDataUri: string | null = null;
function getLogoDataUri(): string {
  if (cachedLogoDataUri) return cachedLogoDataUri;
  const logoPath = path.join(
    __dirname,
    "..",
    "..",
    "..",
    "public",
    "images",
    "coverlogo.png",
  );
  const base64 = fs.readFileSync(logoPath).toString("base64");
  cachedLogoDataUri = `data:image/png;base64,${base64}`;
  return cachedLogoDataUri;
}

/**
 * Cover fonts (SIL OFL, from @fontsource): Fraunces 600 + 400 italic for the
 * headline/footer line, DM Sans 400/500/600 for everything else. Inlined as
 * base64 so Chromium embeds them in the PDF with no network access.
 */
const COVER_FONTS: Array<{
  pkg: string;
  file: string;
  family: string;
  weight: number;
  style: string;
}> = [
  {
    pkg: "fraunces",
    file: "fraunces-latin-600-normal.woff2",
    family: "Fraunces",
    weight: 600,
    style: "normal",
  },
  {
    pkg: "fraunces",
    file: "fraunces-latin-400-italic.woff2",
    family: "Fraunces",
    weight: 400,
    style: "italic",
  },
  {
    pkg: "dm-sans",
    file: "dm-sans-latin-400-normal.woff2",
    family: "DM Sans",
    weight: 400,
    style: "normal",
  },
  {
    pkg: "dm-sans",
    file: "dm-sans-latin-500-normal.woff2",
    family: "DM Sans",
    weight: 500,
    style: "normal",
  },
  {
    pkg: "dm-sans",
    file: "dm-sans-latin-600-normal.woff2",
    family: "DM Sans",
    weight: 600,
    style: "normal",
  },
];
let cachedFontCss: string | null = null;
function getCoverFontCss(): string {
  if (cachedFontCss) return cachedFontCss;
  cachedFontCss = COVER_FONTS.map((f) => {
    const file = path.join(
      __dirname,
      "..",
      "..",
      "..",
      "node_modules",
      "@fontsource",
      f.pkg,
      "files",
      f.file,
    );
    const b64 = fs.readFileSync(file).toString("base64");
    return `@font-face { font-family: '${f.family}'; font-weight: ${f.weight}; font-style: ${f.style}; font-display: block; src: url(data:font/woff2;base64,${b64}) format('woff2'); }`;
  }).join("\n");
  return cachedFontCss;
}

/**
 * Render environments (Render, most PaaS/serverless platforms) have no
 * reliable place to cache a full downloaded Chrome binary between build and
 * runtime — that mismatch is what produces "Could not find Chrome" in
 * production. @sparticuz/chromium ships a prebuilt Chromium binary inside
 * the npm package itself, so there's no download step and no cache-path
 * dependency at all.
 *
 * Locally, `puppeteer` (full package, devDependency only) is used instead so
 * development doesn't require installing serverless-Chromium — `npm install`
 * skips devDependencies when NODE_ENV=production, which Render sets, so the
 * heavy `puppeteer` package (and its own Chrome download) is never pulled in
 * on the server at all.
 */
async function launchBrowser(): Promise<Browser> {
  if (process.env.NODE_ENV === "production") {
    return puppeteerCore.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(),
      headless: true,
    });
  }

  const puppeteer = require("puppeteer") as typeof import("puppeteer");
  return puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  }) as unknown as Browser;
}

export interface GeneratePdfOptions {
  payload: C1LitePayload;
  narrative: C1LiteNarrative;
  reportId: string;
  generatedDate: string;
}

/** Private storage directory for generated report PDFs (not statically served). */
export function getReportsDir(): string {
  return path.join(__dirname, "..", "..", "..", "storage", "reports");
}

/** Resolve the absolute path on disk for a report PDF given its stored file name. */
export function getReportPdfPath(fileName: string): string {
  return path.join(getReportsDir(), fileName);
}

/**
 * Renders the report to a PDF and returns it as an in-memory Buffer — the PDF
 * is no longer written to disk. usdreports.pdf_data (bytea) is the sole
 * source of truth for report downloads; pdf_storage_path only still matters
 * for pre-migration legacy rows.
 */
export async function generateReportPdf(
  options: GeneratePdfOptions,
): Promise<Buffer> {
  const { payload, narrative, reportId, generatedDate } = options;

  // 1. Render the React component tree to static HTML markup
  const element = React.createElement(ReportDocument, {
    payload,
    narrative,
    reportId,
    generatedDate,
    logoDataUri: getLogoDataUri(),
  });
  const bodyHtml = ReactDOMServer.renderToStaticMarkup(element);

  // Cover gate: headline word == card count, no placeholders, website once.
  const coverText = ReactDOMServer.renderToStaticMarkup(
    React.createElement(Cover, {
      payload,
      reportId,
      generatedDate,
      logoDataUri: "",
    }),
  )
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&");
  const coverErrors = validateCoverText(
    buildCoverModel(payload, reportId),
    coverText,
  );
  if (coverErrors.length) {
    throw new Error(`Cover render gate failed: ${coverErrors.join("; ")}`);
  }

  // Gate 6: the SAT section must not print a number that isn't in the payload.
  const satErrors = gateSatRenderedNumbers(
    renderSatSectionHtml(payload.sat_positioning),
    payload.sat_positioning,
  );
  if (satErrors.length) {
    throw new Error(
      `SAT positioning render gate failed: ${satErrors.join("; ")}`,
    );
  }

  // 2. Wrap it in a clean HTML document shell with proper print-specific resets
  const fullHtml = `
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Decision Report - ${reportId}</title>
    <style>
      ${getCoverFontCss()}
      @page {
        size: A4;
        margin: 0;
      }
      * {
        box-sizing: border-box;
      }
      body {
        margin: 0;
        padding: 0;
        background-color: #FFFFFF;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
      /* Clean scrollbar for preview */
      ::-webkit-scrollbar {
        width: 6px;
      }
      ::-webkit-scrollbar-thumb {
        background: #CBD5E1;
        border-radius: 4px;
      }
    </style>
  </head>
  <body>
    ${bodyHtml}
  </body>
</html>
  `;

  return printHtmlToPdf(fullHtml, reportId);
}

/** Prints a complete HTML document to an in-memory A4 PDF (backgrounds on). */
export async function printHtmlToPdf(
  fullHtml: string,
  reportId: string,
): Promise<Buffer> {
  // 3. Puppeteer generation — rendered straight into memory (no `path`
  // option), so nothing touches disk.
  console.log(`Starting Puppeteer PDF rendering for report ID ${reportId}...`);
  const browser = await launchBrowser();

  try {
    const page = await browser.newPage();

    // Set viewport to match standard A4 screen resolution at 96 DPI
    await page.setViewport({
      width: 794,
      height: 1123,
      deviceScaleFactor: 2, // Retinal high resolution scaling
    });

    // Load content and wait for network/styles to settle
    await page.setContent(fullHtml, { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);

    // Print A4 PDF into a buffer
    const pdfUint8Array = await page.pdf({
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true,
    });
    const pdfBuffer = Buffer.from(pdfUint8Array);

    console.log(
      `PDF successfully generated in memory for report ID ${reportId} (${pdfBuffer.length} bytes)`,
    );
    return pdfBuffer;
  } finally {
    await browser.close();
  }
}
