import React from "react";
import Cover from "./Cover";
import AnalystNote from "./AnalystNote";
import ExecutiveSummary from "./ExecutiveSummary";
import StudentProfile from "./StudentProfile";
import CareerOutcomes, { careerOutcomesPageCount } from "./CareerOutcomes";
import { RecommendationQuestion } from "./Recommendation";
import CampusStudents from "./CampusStudents";
import Athletics, { athleticsPageCount } from "./Athletics";
import TuitionCosts from "./TuitionCosts";
import SatPositioning, { satPositioningPageCount } from "./SatPositioning";
import SourcesMethodology from "./SourcesMethodology";
import Methodology from "./Methodology";
import type { C1LitePayload, C1LiteNarrative } from "../services/reportPrompt";

export interface ReportDocumentProps {
  payload: C1LitePayload;
  narrative: C1LiteNarrative;
  reportId: string;
  generatedDate: string;
  logoDataUri: string;
}

export default function ReportDocument({
  payload,
  narrative,
  reportId,
  generatedDate,
  logoDataUri,
}: ReportDocumentProps) {
  // Cover is page 1 (no chrome); the remaining pages share the same footer
  // numbering. Total includes every rendered page, Cover included. The SAT
  // section paginates by content (satPages); every later page is offset by it.
  const satPages = satPositioningPageCount(payload.sat_positioning);
  // Sections 04 and 07 can each spill onto a continuation page, so later page
  // numbers are laid out sequentially from the page counts rather than fixed.
  const careerPages = careerOutcomesPageCount(payload.schools.length);
  const athleticsPages = athleticsPageCount(payload.college_details.length);
  const totalPages = 9 + careerPages + satPages + athleticsPages;
  const chrome = { reportId, generatedDate, totalPages };

  // Order: Cover, Analyst note, Sources, Student profile, Executive summary,
  // SAT positioning, Tuition, Career outcomes, Campus, Athletics,
  // Recommendation, Methodology.
  const satFirstPage = 6;
  const tuitionPage = satFirstPage + satPages;
  const careerPage = tuitionPage + 1;
  const campusPage = careerPage + careerPages;
  const athleticsPage = campusPage + 1;
  const recommendationPage = athleticsPage + athleticsPages;
  const methodologyPage = recommendationPage + 1;

  return (
    <div style={{ margin: 0, padding: 0, boxSizing: "border-box" }}>
      <Cover
        payload={payload}
        reportId={reportId}
        generatedDate={generatedDate}
        logoDataUri={logoDataUri}
      />
      <AnalystNote
        payload={payload}
        narrative={narrative}
        pageNumber={2}
        {...chrome}
      />
      <SourcesMethodology payload={payload} pageNumber={3} {...chrome} />
      <StudentProfile
        payload={payload}
        narrative={narrative}
        pageNumber={4}
        {...chrome}
      />
      <ExecutiveSummary
        payload={payload}
        narrative={narrative}
        pageNumber={5}
        {...chrome}
      />
      <SatPositioning
        payload={payload}
        reportId={reportId}
        generatedDate={generatedDate}
        firstPageNumber={satFirstPage}
        totalPages={totalPages}
      />
      <TuitionCosts payload={payload} pageNumber={tuitionPage} {...chrome} />
      <CareerOutcomes
        payload={payload}
        narrative={narrative}
        pageNumber={careerPage}
        {...chrome}
      />
      <CampusStudents payload={payload} pageNumber={campusPage} {...chrome} />
      <Athletics payload={payload} pageNumber={athleticsPage} {...chrome} />
      <RecommendationQuestion
        payload={payload}
        narrative={narrative}
        pageNumber={recommendationPage}
        {...chrome}
      />
      <Methodology payload={payload} pageNumber={methodologyPage} {...chrome} />
    </div>
  );
}
