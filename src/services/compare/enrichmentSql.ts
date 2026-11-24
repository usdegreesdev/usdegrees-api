/**
 * SQL fragments shared by the two enrichment queries (the "selected" set and
 * the "matrix" entries). Both queries are driven by a CTE that exposes a
 * `unitid`; the joins below hang every school-level figure off that alias.
 * Only the "which program is selected" lateral differs, so it stays in each
 * query's own file.
 */

/** Columns after the query-specific leading ones (unitid, added_at, ...). */
export const SHARED_COLUMNS = `
        s.name                 AS name,
        s.city                 AS city,
        s.state                AS state,
        s.school_url           AS school_url,
        s.accreditor           AS accreditor,
        p.school_type          AS school_type,
        ad.admission_rate      AS admission_rate,
        ad.school_min_range    AS sat_low,
        ad.school_max_range    AS sat_high,
        ad.sat_p25_math        AS sat_p25_math,
        ad.sat_p75_math        AS sat_p75_math,
        ad.sat_p25_reading     AS sat_p25_reading,
        ad.sat_p75_reading     AS sat_p75_reading,
        comp.grad_rate_150nt_pct AS grad_rate_150nt_pct,
        comp.grad_rate_cohort  AS grad_rate_cohort,
        c.tuition_in_state     AS tuition_in_state,
        c.tuition_out_state    AS tuition_out_state,
        c.sticker_price_by_api AS sticker_price,
        debt.avg_debt          AS avg_debt,
        debt.debt_income_ratio AS debt_income_ratio,
        earnSalary.avg_salary  AS avg_salary,
        roi.roi_20yr           AS roi_20yr,
        earn.avg_year10        AS program_earnings,
        stu.student_faculty_ratio AS student_faculty_ratio,
        stu.size                AS student_size,
        rep.repayment_success  AS repayment_success,
        fields.top_fields      AS top_fields,
        degLevels.degree_levels AS degree_levels,
        selProg.title           AS sel_program_title,
        selProg.cip_code        AS sel_program_cip,
        selProg.credential_level AS sel_program_credential_level,
        selProg.degree_level_category AS sel_program_degree_level,
        selProg.credential_title AS sel_program_credential_title,
        progEarn.year_10        AS sel_program_earnings,
        progEarn.year_10_method AS sel_program_earnings_method
`;

/** Joins from the schools table through the per-school aggregates, keyed on `<alias>.unitid`. */
export function commonJoins(alias: string): string {
  return `
     LEFT JOIN schools s ON s.unitid = ${alias}.unitid
     LEFT JOIN LATERAL (
        SELECT school_type FROM programs WHERE unitid = ${alias}.unitid LIMIT 1
     ) p ON TRUE
     LEFT JOIN LATERAL (
        SELECT admission_rate, school_min_range, school_max_range,
               sat_p25_math, sat_p75_math, sat_p25_reading, sat_p75_reading
          FROM admissions WHERE unitid = ${alias}.unitid LIMIT 1
     ) ad ON TRUE
     LEFT JOIN LATERAL (
        SELECT grad_rate_150nt_pct, grad_rate_cohort FROM completion WHERE unitid = ${alias}.unitid LIMIT 1
     ) comp ON TRUE
     LEFT JOIN LATERAL (
        SELECT tuition_in_state, tuition_out_state, sticker_price_by_api
          FROM costs WHERE unitid = ${alias}.unitid LIMIT 1
     ) c ON TRUE
     LEFT JOIN LATERAL (
        SELECT avg_debt, debt_income_ratio
          FROM debt_income_ratio WHERE unitid = ${alias}.unitid LIMIT 1
     ) debt ON TRUE
     LEFT JOIN LATERAL (
        SELECT roi_20yr FROM roi
         WHERE unitid = ${alias}.unitid
         ORDER BY roi_20yr DESC NULLS LAST LIMIT 1
     ) roi ON TRUE
     LEFT JOIN LATERAL (
        -- earnings_against_courses_merged is the source of truth; rollback
        -- to earnings_against_courses (raw, no fill-method tracking) if needed.
        SELECT AVG(year_10) AS avg_year10 FROM earnings_against_courses_merged
         WHERE unitid = ${alias}.unitid AND year_10 IS NOT NULL
     ) earn ON TRUE
     LEFT JOIN LATERAL (
        -- Median Graduate Salary — school-wide average of
        -- earnings_against_courses_merged.avg_salary across the school's
        -- programs (same aggregation shape as the earn CTE above for year_10).
        SELECT AVG(avg_salary) AS avg_salary FROM earnings_against_courses_merged
         WHERE unitid = ${alias}.unitid AND avg_salary IS NOT NULL
     ) earnSalary ON TRUE
     LEFT JOIN LATERAL (
        SELECT student_faculty_ratio, size FROM students WHERE unitid = ${alias}.unitid LIMIT 1
     ) stu ON TRUE
     LEFT JOIN LATERAL (
        SELECT repayment_success FROM repayment WHERE unitid = ${alias}.unitid LIMIT 1
     ) rep ON TRUE
     LEFT JOIN LATERAL (
        SELECT jsonb_agg(t.* ORDER BY t.percentage DESC) AS top_fields
          FROM (
             SELECT field_name, percentage, program_count FROM program_distribution
              WHERE unitid = ${alias}.unitid
              ORDER BY percentage DESC LIMIT 5
          ) t
     ) fields ON TRUE
     LEFT JOIN LATERAL (
        SELECT jsonb_agg(
                 jsonb_build_object(
                   'level', dl.degree_level_category,
                   'total_programs', dl.total_programs,
                   'top_titles', dl.top_titles
                 )
                 ORDER BY CASE dl.degree_level_category
                            WHEN 'Undergraduate' THEN 1
                            WHEN 'Graduate' THEN 2
                            WHEN 'Professional' THEN 3
                            ELSE 4
                          END
               ) AS degree_levels
          FROM (
             SELECT
                p.degree_level_category,
                COUNT(*) AS total_programs,
                ARRAY(
                   SELECT DISTINCT p2.title FROM programs p2
                    WHERE p2.unitid = ${alias}.unitid
                      AND p2.degree_level_category = p.degree_level_category
                    ORDER BY p2.title ASC LIMIT 3
                ) AS top_titles
             FROM programs p
             WHERE p.unitid = ${alias}.unitid
             GROUP BY p.degree_level_category
          ) dl
     ) degLevels ON TRUE
  `;
}

/** Earnings of the selected program (needs the `selProg` lateral to exist). */
export function progEarnJoin(alias: string): string {
  return `
     LEFT JOIN LATERAL (
        -- earnings_against_courses_merged is the source of truth; rollback
        -- to earnings_against_courses (raw, no fill-method tracking) if needed.
        SELECT year_10, year_10_method FROM earnings_against_courses_merged
         WHERE unitid = ${alias}.unitid
           AND selProg.cip_code IS NOT NULL
           AND replace(cip_code, '.', '') = replace(selProg.cip_code, '.', '')
           AND year_10 IS NOT NULL
         ORDER BY grad_cohort DESC
         LIMIT 1
     ) progEarn ON TRUE
  `;
}
