/** Household-income brackets and the net-price lookup (public / private tables). */
import pool from "../../../db/client";
import { monthYearFromIso } from "../../utils/dataVintage";

// ---- vintage constants (no DB columns yet) -----------------------
// Net price carries the Scorecard release the database holds (scorecard_release),
// never a month typed into the code. No release row → no month is claimed.
export function netPriceVintage(release: string | null): string {
  const m = monthYearFromIso(release);
  return m ? `College Scorecard, ${m} release` : "College Scorecard";
}

// ---- income bracket -> net-price column --------------------------
export type IncomeBracket =
  | "0_30000"
  | "30001_48000"
  | "48001_75000"
  | "75001_110000"
  | "110001_plus";

export const BRACKET_TO_COLUMN: Record<IncomeBracket, string> = {
  "0_30000": "income_0_30000",
  "30001_48000": "income_30001_48000",
  "48001_75000": "income_48001_75000",
  "75001_110000": "income_75001_110000",
  "110001_plus": "income_110001_plus",
};
export const BRACKET_TO_LABEL: Record<IncomeBracket, string> = {
  "0_30000": "$0 – $30,000",
  "30001_48000": "$30,001 – $48,000",
  "48001_75000": "$48,001 – $75,000",
  "75001_110000": "$75,001 – $110,000",
  "110001_plus": "$110,001+",
};

// ------------------------------------------------------------------
// Net price + sector (sector derived from which net-price table the
// unitid appears in; public is checked first).
// ------------------------------------------------------------------
export async function fetchNetPriceAndSector(
  unitid: number,
  bracket: IncomeBracket | null,
): Promise<{ sector: string; value: number | null }> {
  const col = bracket ? BRACKET_TO_COLUMN[bracket] : null;

  const pub = await pool.query(
    `SELECT ${col ? `"${col}"` : "unitid"} FROM net_price_public_income WHERE unitid = $1 LIMIT 1`,
    [unitid],
  );
  if (pub.rows.length > 0) {
    return {
      sector: "Public, 4-year",
      value: col ? (pub.rows[0][col] ?? null) : null,
    };
  }

  const pri = await pool.query(
    `SELECT ${col ? `"${col}"` : "unitid"} FROM net_price_private_income WHERE unitid = $1 LIMIT 1`,
    [unitid],
  );
  if (pri.rows.length > 0) {
    return {
      sector: "Private, 4-year",
      value: col ? (pri.rows[0][col] ?? null) : null,
    };
  }
  return { sector: "Unknown", value: null };
}
