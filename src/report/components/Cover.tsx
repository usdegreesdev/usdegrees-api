import React from "react";
import type { C1LitePayload } from "../services/reportPrompt";
import { buildCoverModel, COVER_COPY } from "./coverData";

export interface CoverProps {
  payload: C1LitePayload;
  reportId: string;
  generatedDate: string;
  /** Logo WITHOUT its own tagline (public/images/coverlogo.png). */
  logoDataUri: string;
}

// Cover-only palette (brand sheet). Deliberately neutral: no good/bad colors.
const C = {
  navy: "#16213A",
  gold: "#D4AF5A",
  lightOnNavy: "#DCE1EA",
  greyOnWhite: "#4A5468",
  cardBorder: "#CBD2DE",
  red: "#D7262B",
  white: "#FFFFFF",
};
const SERIF = "'Fraunces', Georgia, serif";
const SANS = "'DM Sans', system-ui, sans-serif";

const label: React.CSSProperties = {
  fontSize: "11px",
  fontWeight: 600,
  letterSpacing: "0.22em",
  textTransform: "uppercase",
};

export default function Cover({ payload, reportId, logoDataUri }: CoverProps) {
  const m = buildCoverModel(payload, reportId);

  const detail = (
    title: string,
    main: string,
    sub: string | null,
    mono = false,
  ) => (
    <div>
      <div
        style={{
          ...label,
          fontSize: "10.5px",
          color: C.gold,
          marginBottom: "8px",
        }}
      >
        {title}
      </div>
      <div
        style={{
          fontSize: "16px",
          fontWeight: 600,
          color: C.white,
          letterSpacing: mono ? "0.02em" : 0,
        }}
      >
        {main}
      </div>
      {sub && (
        <div
          style={{
            fontSize: "13.5px",
            lineHeight: 1.4,
            color: C.lightOnNavy,
            marginTop: "4px",
          }}
        >
          {sub}
        </div>
      )}
    </div>
  );

  return (
    <div
      style={{
        width: "210mm",
        height: "297mm",
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
        fontFamily: SANS,
        pageBreakAfter: "always",
        overflow: "hidden",
        backgroundColor: C.white,
      }}
    >
      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        {/* ---------------- LEFT: navy panel (496 : 320) ---------------- */}
        <div
          style={{
            flex: "496 1 0",
            minWidth: 0,
            backgroundColor: C.navy,
            color: C.white,
            padding: "56px 28px 44px 48px",
            display: "flex",
            flexDirection: "column",
            boxSizing: "border-box",
          }}
        >
          <div
            style={{
              alignSelf: "flex-start",
              border: `1px solid ${C.gold}`,
              color: C.gold,
              fontSize: "10.5px",
              fontWeight: 500,
              letterSpacing: "0.16em",
              padding: "9px 14px",
            }}
          >
            {m.banner}
          </div>

          <div style={{ ...label, color: C.gold, marginTop: "96px" }}>
            {COVER_COPY.kicker}
          </div>

          <h1
            style={{
              fontFamily: SERIF,
              fontSize: "52px",
              lineHeight: 1.1,
              letterSpacing: "-0.02em",
              whiteSpace: "nowrap",
              color: C.white,
              margin: "24px 0 0 0",
            }}
          >
            <span style={{ fontWeight: 600, display: "block" }}>
              {m.headline[0]}
            </span>
            <span
              style={{ fontWeight: 400, fontStyle: "italic", display: "block" }}
            >
              {m.headline[1]}
            </span>
          </h1>

          <p
            style={{
              fontSize: "17px",
              lineHeight: 1.6,
              fontWeight: 400,
              color: C.lightOnNavy,
              margin: "32px 0 0 0",
              maxWidth: "400px",
            }}
          >
            {COVER_COPY.description}
          </p>
          <p
            style={{
              fontSize: "17px",
              fontWeight: 600,
              color: C.white,
              margin: "20px 0 0 0",
            }}
          >
            {COVER_COPY.lenderLine}
          </p>

          <div style={{ flexGrow: 1 }} />

          <div
            style={{
              height: "1px",
              backgroundColor: C.gold,
              marginBottom: "28px",
            }}
          />
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              columnGap: "32px",
              rowGap: "28px",
            }}
          >
            {detail("PREPARED FOR", m.studentName, m.cityState)}
            {detail(
              "DATA LAST CHECKED",
              m.dataChecked,
              COVER_COPY.dataCheckedNote,
            )}
            {detail(
              "REPORT ID",
              m.reportId,
              `Revision ${m.revision} · Method ${m.methodVersion}`,
              true,
            )}
          </div>
        </div>

        {/* ---------------- RIGHT: white panel ---------------- */}
        <div
          style={{
            flex: "320 1 0",
            minWidth: 0,
            padding: "64px 40px 40px 40px",
            display: "flex",
            flexDirection: "column",
            boxSizing: "border-box",
            backgroundColor: C.white,
          }}
        >
          <img
            src={logoDataUri}
            alt="U.S. Degrees"
            style={{ width: "100%", height: "auto", display: "block" }}
          />
          <div
            style={{
              ...label,
              fontSize: "11px",
              letterSpacing: "0.2em",
              color: C.navy,
              marginTop: "20px",
            }}
          >
            {COVER_COPY.tagline}
          </div>
          <div
            style={{
              fontSize: "15px",
              fontWeight: 600,
              color: C.red,
              marginTop: "18px",
            }}
          >
            {COVER_COPY.website}
          </div>

          <div
            style={{
              ...label,
              fontSize: "10.5px",
              color: C.navy,
              marginTop: "72px",
            }}
          >
            {COVER_COPY.schoolsLabel}
          </div>
          <div
            style={{
              fontSize: "12.5px",
              lineHeight: 1.45,
              color: C.greyOnWhite,
              marginTop: "8px",
            }}
          >
            {COVER_COPY.schoolsNote}
          </div>

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "12px",
              marginTop: "16px",
            }}
          >
            {m.schools.map((s, i) => (
              <div
                key={i}
                style={{
                  border: `1px solid ${C.cardBorder}`,
                  borderRadius: "8px",
                  padding: "14px 16px",
                  breakInside: "avoid",
                }}
              >
                <div
                  style={{
                    fontSize: "15px",
                    fontWeight: 600,
                    color: C.navy,
                    lineHeight: 1.3,
                  }}
                >
                  {s.name}
                </div>
                <div
                  style={{
                    fontSize: "12.5px",
                    color: C.greyOnWhite,
                    marginTop: "3px",
                  }}
                >
                  {s.location}
                </div>
              </div>
            ))}
          </div>

          <div style={{ flexGrow: 1 }} />
          <div
            style={{
              fontSize: "11.5px",
              lineHeight: 1.5,
              color: C.greyOnWhite,
            }}
          >
            {COVER_COPY.sourceLine}
          </div>
        </div>
      </div>

      {/* ---------------- Footer band (48px) ---------------- */}
      <div
        style={{
          height: "48px",
          flex: "0 0 48px",
          backgroundColor: C.gold,
          color: C.navy,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 32px",
        }}
      >
        <span
          style={{
            ...label,
            fontSize: "10.5px",
            fontWeight: 600,
            letterSpacing: "0.2em",
          }}
        >
          {COVER_COPY.confidential}
        </span>
        <span
          style={{
            fontFamily: SERIF,
            fontStyle: "italic",
            fontWeight: 400,
            fontSize: "15px",
          }}
        >
          {COVER_COPY.footerTagline}
        </span>
      </div>
    </div>
  );
}
