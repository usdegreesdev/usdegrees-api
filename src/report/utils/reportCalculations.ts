import pool from "../../db/client";
import { calculateAdmissionFit, StudentAcademics } from "./admissionScore";
import { analyzeRoi } from "./roi";
import { analyzeDebt } from "./debt";

export interface ReportCalculatedData {
  student: {
    name: string;
    major: string;
    gpa: string;
    sat: string;
    income: string;
    preferredStates: string[];
    preferredPrograms: string[];
  };
  program: {
    cipCode: string;
    level: string;
    title: string;
  };
  colleges: Array<{
    unitid: number;
    name: string;
    city: string;
    state: string;
    url: string;
    
    // Core comparison metrics
    stickerPrice: number | null;
    netPrice: number | null;
    graduationRate: number | null;
    admissionRate: number | null;
    studentFacultyRatio: number | null;
    retentionRate: number | null;
    studentSize: number | null;

    // Financial & ROI
    roi20Yr: number | null;
    roi20YrFormatted: string;
    totalCost20Yr: number | null;
    totalCost20YrFormatted: string;
    annualReturnRate: string;
    avgSalary: number | null;
    median1YrEarnings: number | null;
    median5YrEarnings: number | null;

    // Debt
    averageDebt: number | null;
    averageDebtFormatted: string;
    medianDebt: number | null;
    medianDebtFormatted: string;
    medianPayment: number | null;
    monthlyPaymentFormatted: string;
    debtIncomeRatio: number | null;
    debtIncomeRatioFormatted: string;

    // Admission Fit
    admissionFit: {
      category: "Target/Match" | "Reach" | "Unavailable";
      score: number;
      explanation: string;
    };
  }>;
  rankings: {
    bestValue: string;
    lowestCost: string;
    highestSalary: string;
    highestGradRate: string;
    biggestRisk: string;
  };
}

export async function fetchReportData(
  userId: number,
  selectedColleges: number[],
  programId: number
): Promise<ReportCalculatedData> {
  // 1. Fetch Student profile (gpa, sat, etc.). No fabricated defaults — every
  // value shown for the student must come from their real profile row; missing
  // data is reported as "Not Provided", never a placeholder number.
  let studentName = "Prospective Student";
  let gpa: number | null = null;
  let satMath: number | null = null;
  let satReading: number | null = null;
  let preferredStates: string[] = [];
  let preferredPrograms: string[] = [];

  try {
    const userRes = await pool.query(
      `SELECT u.*,
        COALESCE(
          (SELECT array_agg(s.state_code ORDER BY s.state_code) FROM usdusers_preferred_states s WHERE s.user_id = u.id),
          ARRAY[]::text[]
        ) AS preferred_states,
        COALESCE(
          (SELECT array_agg(p.program ORDER BY p.program) FROM usdusers_preferred_programs p WHERE p.user_id = u.id),
          ARRAY[]::text[]
        ) AS preferred_programs
       FROM usdusers u WHERE u.id = $1`,
      [userId]
    );
    if (userRes.rows.length > 0) {
      const u = userRes.rows[0];
      studentName = u.display_name || u.email.split("@")[0] || "Prospective Student";
      gpa = u.gpa ? parseFloat(u.gpa) : null;
      satMath = u.sat_math || null;
      satReading = u.sat_reading_writing || null;
      preferredStates = u.preferred_states || [];
      preferredPrograms = u.preferred_programs || [];
    }
  } catch (err) {
    console.error("Error fetching user profile:", err);
  }

  // 2. Fetch Reference Program details
  let cipCode = "11.0701";
  let programLevel = 5; // Bachelor's default
  let programTitle = "Computer Science";

  try {
    const progRes = await pool.query(
      "SELECT cip_code, credential_level, title FROM programs WHERE id = $1",
      [programId]
    );
    if (progRes.rows.length > 0) {
      cipCode = progRes.rows[0].cip_code;
      programLevel = progRes.rows[0].credential_level;
      programTitle = progRes.rows[0].title;
    }
  } catch (err) {
    console.error("Error fetching program details:", err);
  }

  const collegesCalculated: ReportCalculatedData["colleges"] = [];

  // 3. Query all tables for each selected college
  for (const unitid of selectedColleges) {
    try {
      // School main details
      const schoolRes = await pool.query(
        "SELECT unitid, name, city, state, school_url FROM schools WHERE unitid = $1",
        [unitid]
      );
      if (schoolRes.rows.length === 0) continue;
      const s = schoolRes.rows[0];

      // Admissions
      const admRes = await pool.query(
        "SELECT * FROM admissions WHERE unitid = $1 LIMIT 1",
        [unitid]
      );
      const adm = admRes.rows[0] || {};

      // Costs
      const costRes = await pool.query(
        "SELECT * FROM costs WHERE unitid = $1 LIMIT 1",
        [unitid]
      );
      const cost = costRes.rows[0] || {};

      // Students
      const studRes = await pool.query(
        "SELECT size, student_faculty_ratio, graduation_rate, retention_rate FROM students WHERE unitid = $1 LIMIT 1",
        [unitid]
      );
      const stud = studRes.rows[0] || {};

      // ROI
      const roiRes = await pool.query(
        "SELECT avg_salary, total_cost, roi_20yr FROM roi WHERE unitid = $1 AND credential_level = $2 LIMIT 1",
        [unitid, programLevel]
      );
      const roi = roiRes.rows[0] || {};

      // Earnings
      const earnRes = await pool.query(
        "SELECT median_1yr, median_3yr, median_4yr, median_5yr FROM earnings WHERE unitid = $1 LIMIT 1",
        [unitid]
      );
      const earn = earnRes.rows[0] || {};

      // Debt Income Ratio
      const dirRes = await pool.query(
        "SELECT avg_debt, avg_income, debt_income_ratio, ratio_text FROM debt_income_ratio WHERE unitid = $1 LIMIT 1",
        [unitid]
      );
      const dir = dirRes.rows[0] || {};

      // Matching program at this school for program-level debt
      const progMatchRes = await pool.query(
        "SELECT id FROM programs WHERE unitid = $1 AND cip_code = $2 AND credential_level = $3 LIMIT 1",
        [unitid, cipCode, programLevel]
      );
      let programDebt = {} as any;
      if (progMatchRes.rows.length > 0) {
        const pDebtRes = await pool.query(
          "SELECT median_debt, average_debt, median_payment FROM program_debt WHERE program_id = $1 LIMIT 1",
          [progMatchRes.rows[0].id]
        );
        programDebt = pDebtRes.rows[0] || {};
      }

      // Use the published sticker price from the costs row; do not estimate
      // it from tuition components or substitute a value when it is missing.
      const sticker =
        cost.sticker_price_by_api != null
          ? parseFloat(cost.sticker_price_by_api)
          : null;

      // Net price default to overall net price
      const net = cost.avg_net_price_overall || cost.avg_net_price_public || cost.avg_net_price_private || null;

      // Admissions calculations
      const studentAcademics: StudentAcademics = { gpa, satMath, satReadingWriting: satReading, actScore: null };
      const collegeAdmissions = {
        admissionRate: adm.admission_rate ? parseFloat(adm.admission_rate) : null,
        satAvg: adm.sat_avg_overall ? parseFloat(adm.sat_avg_overall) : null,
        sat25Math: adm.sat_p25_math || null,
        sat75Math: adm.sat_p75_math || null,
        sat25Reading: adm.sat_p25_reading || null,
        sat75Reading: adm.sat_p75_reading || null,
      };
      const fit = calculateAdmissionFit(studentAcademics, collegeAdmissions);

      // ROI calculations
      const roiResult = analyzeRoi({
        unitid,
        totalCost: roi.total_cost ? parseFloat(roi.total_cost) : null,
        avgSalary: roi.avg_salary ? parseFloat(roi.avg_salary) : null,
        roi20Yr: roi.roi_20yr ? parseFloat(roi.roi_20yr) : null,
      });

      // Debt calculations
      const debtResult = analyzeDebt({
        medianDebt: programDebt.median_debt ? parseFloat(programDebt.median_debt) : null,
        averageDebt: programDebt.average_debt ? parseFloat(programDebt.average_debt) : null,
        medianPayment: programDebt.median_payment ? parseFloat(programDebt.median_payment) : null,
        overallAvgDebt: dir.avg_debt ? parseFloat(dir.avg_debt) : null,
        overallAvgIncome: dir.avg_income ? parseFloat(dir.avg_income) : null,
        overallDebtIncomeRatio: dir.debt_income_ratio ? parseFloat(dir.debt_income_ratio) : null,
        ratioText: dir.ratio_text || null,
      });

      collegesCalculated.push({
        unitid,
        name: s.name,
        city: s.city,
        state: s.state,
        url: s.school_url || "N/A",
        
        stickerPrice: sticker,
        netPrice: net,
        graduationRate: stud.graduation_rate ? parseFloat(stud.graduation_rate) : null,
        admissionRate: collegeAdmissions.admissionRate,
        studentFacultyRatio: stud.student_faculty_ratio ? parseFloat(stud.student_faculty_ratio) : null,
        retentionRate: stud.retention_rate ? parseFloat(stud.retention_rate) : null,
        studentSize: stud.size || null,

        roi20Yr: roiResult.roi20Yr,
        roi20YrFormatted: roiResult.roiFormatted,
        totalCost20Yr: roi.total_cost ? parseFloat(roi.total_cost) : null,
        totalCost20YrFormatted: roiResult.totalCostFormatted,
        annualReturnRate: roiResult.annualReturnRate,
        avgSalary: roi.avg_salary ? parseFloat(roi.avg_salary) : null,
        median1YrEarnings: earn.median_1yr || null,
        median5YrEarnings: earn.median_5yr || null,

        averageDebt: programDebt.average_debt ? parseFloat(programDebt.average_debt) : (dir.avg_debt ? parseFloat(dir.avg_debt) : null),
        averageDebtFormatted: debtResult.averageDebtFormatted,
        medianDebt: programDebt.median_debt ? parseFloat(programDebt.median_debt) : (dir.avg_debt ? parseFloat(dir.avg_debt) : null),
        medianDebtFormatted: debtResult.medianDebtFormatted,
        medianPayment: programDebt.median_payment ? parseFloat(programDebt.median_payment) : null,
        monthlyPaymentFormatted: debtResult.monthlyPaymentFormatted,
        debtIncomeRatio: dir.debt_income_ratio ? parseFloat(dir.debt_income_ratio) : null,
        debtIncomeRatioFormatted: debtResult.debtIncomeRatioFormatted,

        admissionFit: fit,
      });
    } catch (err) {
      console.error(`Error querying data for college ${unitid}:`, err);
    }
  }

  // 4. Calculate Rankings
  let bestValue = "N/A";
  let lowestCost = "N/A";
  let highestSalary = "N/A";
  let highestGradRate = "N/A";
  let biggestRisk = "N/A";

  if (collegesCalculated.length > 0) {
    // Best Value (highest 20yr ROI)
    const sortedValue = [...collegesCalculated].sort((a, b) => (b.roi20Yr || 0) - (a.roi20Yr || 0));
    bestValue = sortedValue[0]?.roi20Yr ? sortedValue[0].name : collegesCalculated[0].name;

    // Lowest Cost (lowest netPrice)
    const sortedCost = [...collegesCalculated]
      .filter((c) => c.netPrice !== null)
      .sort((a, b) => (a.netPrice || 0) - (b.netPrice || 0));
    lowestCost = sortedCost[0] ? sortedCost[0].name : collegesCalculated[0].name;

    // Highest Salary (highest avgSalary or 5YrEarnings)
    const sortedSalary = [...collegesCalculated]
      .filter((c) => c.avgSalary !== null || c.median5YrEarnings !== null)
      .sort((a, b) => {
        const aVal = a.avgSalary || a.median5YrEarnings || 0;
        const bVal = b.avgSalary || b.median5YrEarnings || 0;
        return bVal - aVal;
      });
    highestSalary = sortedSalary[0] ? sortedSalary[0].name : collegesCalculated[0].name;

    // Highest Graduation Rate
    const sortedGrad = [...collegesCalculated]
      .filter((c) => c.graduationRate !== null)
      .sort((a, b) => (b.graduationRate || 0) - (a.graduationRate || 0));
    highestGradRate = sortedGrad[0] ? sortedGrad[0].name : collegesCalculated[0].name;

    // Biggest Risk (highest debt-to-income ratio or highest netPrice)
    const sortedRisk = [...collegesCalculated].sort((a, b) => {
      const aVal = a.debtIncomeRatio || (a.netPrice ? a.netPrice / 100000 : 0);
      const bVal = b.debtIncomeRatio || (b.netPrice ? b.netPrice / 100000 : 0);
      return bVal - aVal;
    });
    biggestRisk = sortedRisk[0] ? sortedRisk[0].name : collegesCalculated[0].name;
  }

  const satFormatted =
    satMath && satReading
      ? `${satMath + satReading} (Math: ${satMath}, RW: ${satReading})`
      : satMath
      ? `Math: ${satMath}`
      : satReading
      ? `RW: ${satReading}`
      : "Not Provided";

  return {
    student: {
      name: studentName,
      // Major reflects the user's own preferred programs (child table), not the
      // report's reference program. Multiple preferences are shown comma-joined.
      major:
        preferredPrograms.length > 0
          ? preferredPrograms.join(", ")
          : "Not Provided",
      gpa: gpa ? gpa.toFixed(2) : "Not Provided",
      sat: satFormatted,
      // No income is captured on the user profile, so nothing is fabricated.
      income: "Not Provided",
      preferredStates: preferredStates,
      preferredPrograms: preferredPrograms,
    },
    program: {
      cipCode,
      level: programLevel === 5 ? "Bachelor's Degree" : programLevel === 3 ? "Associate's Degree" : "Master's/Doctoral",
      title: programTitle,
    },
    colleges: collegesCalculated,
    rankings: {
      bestValue,
      lowestCost,
      highestSalary,
      highestGradRate,
      biggestRisk,
    },
  };
}
