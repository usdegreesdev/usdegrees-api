/**
 * athletics.service.ts
 *
 * Builds the combined "Athletics disclosure info" profile for a school from
 * athletic_summary + athletic_sports + athletic_content_blocks +
 * athletic_division_benchmarks. Shared by the single-school and
 * compare-athletics endpoints so both stay in sync.
 */

import pool from "../db/client";
import { parseCurrencyString } from "../utils/currency";
import {
  AthleticDivisionBenchmarkRow,
  AthleticSportsRow,
  AthleticSummaryRow,
  AthleticsProfile,
  AthleticsRosterEntry,
} from "../types/athletics";

function toNum(val: unknown): number | null {
  if (val === null || val === undefined) return null;
  const n = typeof val === "string" ? Number(val) : val;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

/**
 * Builds the roster list + men/women/sport totals from raw athletic_sports
 * rows. One input row per (sport, gender); output collapses to one entry
 * per sport with both genders' roster sizes.
 */
function buildRoster(rows: AthleticSportsRow[]): {
  roster: AthleticsRosterEntry[];
  athletesMen: number | null;
  athletesWomen: number | null;
} {
  const bySport = new Map<string, AthleticsRosterEntry>();
  // A missing roster_size makes every sum it feeds missing — never a 0.
  // (A sport with no row for a gender has no team: that 0 is real.)
  const add = (a: number | null, b: number | null) =>
    a === null || b === null ? null : a + b;
  let athletesMen: number | null = 0;
  let athletesWomen: number | null = 0;

  for (const row of rows) {
    const size = toNum(row.roster_size);
    let entry = bySport.get(row.sport);
    if (!entry) {
      entry = { sport: row.sport, men: 0, women: 0 };
      bySport.set(row.sport, entry);
    }
    if (row.gender === "Men") {
      entry.men = add(entry.men, size);
      athletesMen = add(athletesMen, size);
    } else if (row.gender === "Women") {
      entry.women = add(entry.women, size);
      athletesWomen = add(athletesWomen, size);
    }
  }

  return { roster: [...bySport.values()], athletesMen, athletesWomen };
}

/**
 * Fetches and assembles the full athletics profile for one unitid.
 * Returns null if the school has no athletic_summary row (404 case).
 *
 * @param year Optional exact survey_year to pin to. Defaults to the most
 *             recent survey_year on file for the unitid, future-proofing
 *             for multi-year imports.
 */
export async function getAthleticsProfile(
  unitid: number,
  year?: string,
): Promise<AthleticsProfile | null> {
  const summaryParams: (string | number)[] = [unitid];
  let yearClause = "";
  if (year) {
    summaryParams.push(year);
    yearClause = "AND s.survey_year = $2";
  }

  const summarySql = `
    SELECT
      s.unitid,
      sc.name AS institution_name,
      s.survey_year,
      s.division,
      s.athletic_aid_total,
      s.athletes_total,
      s.avg_aid_per_athlete,
      s.recruiting_expense,
      s.athletic_revenue,
      s.athletic_expense,
      cb.content AS summary_paragraph
    FROM athletic_summary s
    JOIN schools sc ON sc.unitid = s.unitid
    LEFT JOIN athletic_content_blocks cb ON cb.key = s.unitid::text
    WHERE s.unitid = $1
    ${yearClause}
    ORDER BY s.survey_year DESC
    LIMIT 1
  `;

  const summaryResult = await pool.query<AthleticSummaryRow>(
    summarySql,
    summaryParams,
  );

  if (summaryResult.rows.length === 0) return null;
  const row = summaryResult.rows[0];

  const [sportsResult, benchmarkResult] = await Promise.all([
    pool.query<AthleticSportsRow>(
      `SELECT sport, gender, roster_size
       FROM athletic_sports
       WHERE unitid = $1 AND survey_year = $2
       ORDER BY sport ASC`,
      [unitid, row.survey_year],
    ),
    pool.query<AthleticDivisionBenchmarkRow>(
      `SELECT division, survey_year, avg_athletes_total, avg_aid_per_athlete,
              avg_recruiting_expense, avg_revenue, avg_expense
       FROM athletic_division_benchmarks
       WHERE division = $1 AND survey_year = $2
       LIMIT 1`,
      [row.division, row.survey_year],
    ),
  ]);

  const { roster, athletesMen, athletesWomen } = buildRoster(
    sportsResult.rows,
  );

  const athletesTotal = parseCurrencyString(row.athletes_total);
  const athleticAidTotal = parseCurrencyString(row.athletic_aid_total);
  const avgAidPerAthlete = parseCurrencyString(row.avg_aid_per_athlete);
  const recruitingExpense = parseCurrencyString(row.recruiting_expense);
  const athleticRevenue = parseCurrencyString(row.athletic_revenue);
  const athleticExpense = parseCurrencyString(row.athletic_expense);

  const recruitingExpensePerAthlete =
    recruitingExpense !== null && athletesTotal
      ? Math.round(recruitingExpense / athletesTotal)
      : null;

  const surplus =
    athleticRevenue !== null && athleticExpense !== null
      ? athleticRevenue - athleticExpense
      : null;

  const benchmarkRow = benchmarkResult.rows[0] ?? null;

  return {
    unitid: toNum(row.unitid) ?? unitid,
    institutionName: row.institution_name ?? "Unknown",
    surveyYear: row.survey_year,
    division: row.division,
    summary: {
      athletesTotal,
      athletesMen,
      athletesWomen,
      athleticAidTotal,
      avgAidPerAthlete,
      recruitingExpense,
      recruitingExpensePerAthlete,
      athleticRevenue,
      athleticExpense,
      surplus,
    },
    sportsOffered: roster.length,
    roster,
    summaryParagraph: row.summary_paragraph ?? null,
    hasRosterData: roster.length > 0,
    divisionBenchmark: benchmarkRow
      ? {
          division: benchmarkRow.division,
          avgAidPerAthlete: toNum(benchmarkRow.avg_aid_per_athlete),
          avgAthletesTotal: toNum(benchmarkRow.avg_athletes_total),
          avgRecruitingExpense: toNum(benchmarkRow.avg_recruiting_expense),
        }
      : null,
  };
}
