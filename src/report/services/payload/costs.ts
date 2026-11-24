/** Money figures: sticker price, school-wide debt, and the full tuition & costs breakdown. */
import pool from "../../../db/client";
import { resolveDebt, debtRatioQuery } from "../../utils/debtRatio";
import { inStateOnCampus, outOfStateOffCampus } from "../../utils/stickerPrice";
import { fetchNetPriceAndSector, type IncomeBracket } from "./netPrice";

// Sticker price (costs.sticker_price_by_api).
export async function fetchCosts(unitid: number) {
  const { rows } = await pool.query(
    `SELECT sticker_price_by_api FROM costs WHERE unitid = $1 LIMIT 1`,
    [unitid],
  );
  const data = rows[0];
  return {
    sticker:
      data?.sticker_price_by_api != null
        ? Math.round(Number(data.sticker_price_by_api))
        : null,
  };
}

// School-wide median federal debt of completers + debt-to-income.
export async function fetchDebt(unitid: number) {
  // One query: earnings.median_debt_completers + the single configured
  // earnings column (DEBT_RATIO_BASIS) — see debtRatioQuery. The ratio is
  // computed in debtRatio.ts only.
  const { rows } = await pool.query(debtRatioQuery(), [unitid]);
  return resolveDebt(rows[0]);
}

// ------------------------------------------------------------------
// Full tuition & costs breakdown (costs table) — school-level, not
// program-level. sticker_price here is the same figure already threaded
// per-program into schools[].sticker_price; repeated here for the dedicated
// Tuition & Costs page so it doesn't depend on which program entry rendered.
// ------------------------------------------------------------------
export async function fetchTuitionDetail(
  unitid: number,
  bracket: IncomeBracket | null,
) {
  // net_price comes from net_price_public_income / net_price_private_income
  // at the student's household-income bracket (null when no bracket is set
  // or the school has no row), never from the costs table.
  const [{ rows }, np] = await Promise.all([
    pool.query(
    `SELECT sticker_price_by_api, sticker_price_year, tuition_in_state, tuition_out_state,
            roomboard_oncampus, roomboard_offcampus, booksupply, otherexpense_oncampus,
            otherexpense_offcampus, otherexpense_withfamily
       FROM costs WHERE unitid = $1 LIMIT 1`,
    [unitid],
    ),
    fetchNetPriceAndSector(unitid, bracket),
  ]);
  const data = rows[0];
  const num = (v: unknown) => (v != null ? Math.round(Number(v)) : null);
  // Scenario totals are computed from the components (null is never 0).
  const raw = (v: unknown) => (v != null ? Number(v) : null);
  const comps = {
    tuition_in_state: raw(data?.tuition_in_state),
    tuition_out_state: raw(data?.tuition_out_state),
    roomboard_oncampus: raw(data?.roomboard_oncampus),
    roomboard_offcampus: raw(data?.roomboard_offcampus),
    booksupply: raw(data?.booksupply),
    otherexpense_oncampus: raw(data?.otherexpense_oncampus),
    otherexpense_offcampus: raw(data?.otherexpense_offcampus),
  };
  return {
    sticker_in_state_on_campus: inStateOnCampus(comps),
    sticker_out_state_off_campus: outOfStateOffCampus(comps),
    scorecard_avg_coa: num(data?.sticker_price_by_api),
    scorecard_avg_coa_year:
      data?.sticker_price_year != null ? String(data.sticker_price_year) : null,
    net_price: num(np.value),
    tuition_in_state: num(data?.tuition_in_state),
    tuition_out_state: num(data?.tuition_out_state),
    room_board_on_campus: num(data?.roomboard_oncampus),
    room_board_off_campus: num(data?.roomboard_offcampus),
    books_supply: num(data?.booksupply),
    other_expense_on_campus: num(data?.otherexpense_oncampus),
    other_expense_off_campus: num(data?.otherexpense_offcampus),
    other_expense_with_family: num(data?.otherexpense_withfamily),
  };
}
