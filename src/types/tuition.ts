export interface ApiError {
  error: string;
  message: string;
  unitid?: number;
}

export interface TuitionRawRow {
  // costs
  tuition_in_state: number | null;
  tuition_out_state: number | null;
  booksupply: number | null;
  sticker_price_by_api: number | null;
  sticker_price_year: string | null;
  roomboard_oncampus: number | null;
  roomboard_offcampus: number | null;
  otherexpense_oncampus: number | null;
  otherexpense_offcampus: number | null;
  otherexpense_withfamily: number | null;
  // aid
  aid_percentage: number | null;
  students_with_any_loan: number | null;
  loan_principal: number | null;
  // net price
  school_type: string | null;
  income_0_30000: number | null;
  income_30001_48000: number | null;
  income_48001_75000: number | null;
  income_75001_110000: number | null;
  income_110001_plus: number | null;
}

/** Shaped API response */
export interface TuitionResponse {
  unitid: number;
  tuition: {
    tuition_in_state: number | null;
    tuition_out_state: number | null;
    booksupply: number | null;
    sticker_price_by_api: number | null;
    sticker_price_year: string | null;
  };
  housing: {
    roomboard_oncampus: number | null;
    roomboard_offcampus: number | null;
  };
  expenses: {
    otherexpense_oncampus: number | null;
    otherexpense_offcampus: number | null;
    otherexpense_withfamily: number | null;
  };
  financial_aid: {
    aid_percentage: number | null;
    students_with_any_loan: number | null;
    loan_principal: number | null;
  };
  school_type: string | null;
  net_price: {
    income_0_30000: number | null;
    income_30001_48000: number | null;
    income_48001_75000: number | null;
    income_75001_110000: number | null;
    income_110001_plus: number | null;
  };
}
