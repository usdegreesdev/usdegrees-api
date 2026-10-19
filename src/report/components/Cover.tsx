import React from "react";
import type { C1LitePayload } from "../services/reportPrompt";
import { theme } from "./theme";

export interface CoverProps {
  payload: C1LitePayload;
  reportId: string;
  generatedDate: string;
  logoDataUri: string;
}

export default function Cover({
  payload,
  reportId,
  generatedDate,
  logoDataUri,
}: CoverProps) {
  const { student, schools } = payload;
  return (
    <div
      style={{
        width: "210mm",
        height: "297mm",
        padding: "25mm 20mm 20mm 20mm",
        boxSizing: "border-box",
        backgroundColor: theme.color.coverBg,
        color: theme.color.white,
        fontFamily: theme.font.sans,
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        pageBreakAfter: "always",
        position: "relative",
      }}
    >
      {/* Corner ribbon — hangs from the true top-left of the page, ignoring
          the page padding, so it reads as a tucked-in banner rather than an
          inline logo. */}
      <img
        src={logoDataUri}
        alt="U.S. Degrees"
        style={{
          position: "absolute",
          top: 0,
          left: "30px",
          width: "108px",
          height: "auto",
        }}
      />

      {/* Top Header Section */}
      <div>
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            alignItems: "center",
          }}
        >
          <div
            style={{
              fontSize: "11px",
              fontWeight: 600,
              color: theme.color.inkFaint,
              letterSpacing: "0.1em",
              paddingBottom: "4px",
              borderBottom: `1px solid ${theme.color.hairlineOnNavy}`,
            }}
          >
            CONFIDENTIAL REPORT
          </div>
        </div>
      </div>

      {/* Middle Hero Section */}
      <div
        style={{
          flexGrow: 1,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          paddingBottom: "40px",
        }}
      >
        <div
          style={{
            fontSize: "12px",
            fontWeight: 700,
            color: theme.color.gold,
            letterSpacing: "0.2em",
            textTransform: "uppercase",
            marginBottom: "10px",
          }}
        >
          U.S. Degrees · College Decision Report
        </div>
        <div
          style={{
            fontSize: "11px",
            color: theme.color.inkFaint,
            letterSpacing: "0.04em",
            marginBottom: "18px",
          }}
        >
          Prepared for {student.display_name} · {schools.length} Program
          {schools.length === 1 ? "" : "s"} Compared
        </div>
        <h1
          style={{
            fontFamily: theme.font.family,
            fontSize: "48px",
            fontWeight: 800,
            lineHeight: "1.1",
            letterSpacing: "-0.02em",
            color: theme.color.white,
            margin: "0 0 25px 0",
          }}
        >
          U.S. Degrees Decision Report
        </h1>
        <p
          style={{
            fontSize: "18px",
            color: theme.color.inkFaint,
            fontWeight: 400,
            lineHeight: "1.5",
            margin: "0 0 50px 0",
            maxWidth: "550px",
          }}
        >
          A neutral, data-driven look at cost and outcomes across the schools
          you selected. This report does not rank or recommend a school — it
          lays out what the public data shows so your family can weigh the
          trade-offs.
        </p>

        {/* Selected Colleges Panel */}
        <div
          style={{
            backgroundColor: theme.color.navyDeep,
            borderRadius: "16px",
            padding: "24px",
            border: `1px solid ${theme.color.hairlineOnNavy}`,
          }}
        >
          <div
            style={{
              fontSize: "11px",
              fontWeight: 700,
              color: theme.color.gold,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              marginBottom: "12px",
            }}
          >
            Programs Evaluated
          </div>
          <div
            style={{ display: "flex", flexDirection: "column", gap: "10px" }}
          >
            {schools.map((s, i) => (
              <div
                key={i}
                style={{ display: "flex", alignItems: "center", gap: "12px" }}
              >
                <span
                  style={{
                    color: theme.color.gold,
                    fontSize: "18px",
                    fontWeight: "bold",
                  }}
                >
                  •
                </span>
                <span
                  style={{
                    fontSize: "15px",
                    fontWeight: 600,
                    color: theme.color.white,
                  }}
                >
                  {s.name}
                  {s.program_name ? ` — ${s.program_name}` : ""}
                </span>
                <span style={{ fontSize: "13px", color: theme.color.inkFaint }}>
                  ({s.city}, {s.state})
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Bottom Footer Section */}
      <div>
        <div
          style={{
            width: "100%",
            height: "1px",
            backgroundColor: theme.color.hairlineOnNavy,
            marginBottom: "20px",
          }}
        ></div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr 1fr",
            gap: "20px",
            fontSize: "12px",
            color: theme.color.inkFaint,
          }}
        >
          <div>
            <div
              style={{
                fontWeight: 700,
                color: theme.color.goldSoft,
                marginBottom: "4px",
              }}
            >
              Prepared For
            </div>
            <div>{student.display_name}</div>
            {student.address && <div>{student.address}</div>}
            {student.preferred_degree_level && (
              <div>Preferred level: {student.preferred_degree_level}</div>
            )}
          </div>
          <div>
            <div
              style={{
                fontWeight: 700,
                color: theme.color.goldSoft,
                marginBottom: "4px",
              }}
            >
              Report Reference
            </div>
            <div>ID: {reportId}</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div
              style={{
                fontWeight: 700,
                color: theme.color.goldSoft,
                marginBottom: "4px",
              }}
            >
              Generated Date
            </div>
            <div>{generatedDate}</div>
            <div style={{ color: theme.color.gold, fontWeight: 600 }}>
              Sources Documented · Calculations Re-Checked
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
