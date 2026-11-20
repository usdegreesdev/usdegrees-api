import test from "node:test";
import assert from "node:assert/strict";
import {
  PROGRAM_LABEL_CIP_FAMILIES,
  cipFamily,
  normalizeCipCode,
  normalizeDegreeBucket,
  normalizeStateCode,
  programLabelsToCipFamilies,
} from "./preferenceAlignment";

// The 72 labels of the profile major picker (frontend PROGRAM_OPTIONS).
const PICKER_LABELS = [
  "Accounting", "Aerospace Engineering", "Agriculture", "Anthropology",
  "Architecture", "Automotive Technology", "Aviation", "Biochemistry",
  "Biomedical Engineering", "Biology", "Biotechnology", "Business Administration",
  "Chemical Engineering", "Chemistry", "Civil Engineering", "Communications",
  "Computer Engineering", "Computer Programming", "Computer Science",
  "Construction Management", "Criminal Justice", "Culinary", "Data Analytics",
  "Data Science", "Dentistry", "Economics", "Education", "Electrical Engineering",
  "Entrepreneurship", "English", "Environmental Science", "Film", "Finance",
  "Fine Arts", "Graphic Design", "Healthcare Administration", "History",
  "Hospitality", "Human Resources", "Industrial Engineering",
  "Information Technology", "International Business", "International Relations",
  "Journalism", "Languages and Linguistics", "Liberal Arts",
  "Management Information Systems", "Marketing", "Mathematics",
  "Mechanical Engineering", "Music", "Neuroscience", "Nursing", "Nutrition",
  "Pharmacy", "Philosophy", "Physical Therapy / Rehabilitation", "Physics",
  "Political Science", "Psychology", "Public Administration", "Public Health",
  "Public Policy", "Public Relations", "Real Estate", "Social Work", "Sociology",
  "Special Education", "Statistics", "Teacher Education", "Theatre", "Veterinary",
];

test("degree buckets from credential_level codes", () => {
  const expected = ["certificate", "associate", "bachelor", "certificate", "master", "doctorate", "doctorate", "certificate"];
  expected.forEach((bucket, i) => {
    assert.equal(normalizeDegreeBucket(i + 1), bucket);
    assert.equal(normalizeDegreeBucket(String(i + 1)), bucket);
  });
  assert.equal(normalizeDegreeBucket(0), null);
  assert.equal(normalizeDegreeBucket(9), null);
  assert.equal(normalizeDegreeBucket(3.5), null);
});

test("degree buckets from the 8 canonical titles", () => {
  assert.equal(normalizeDegreeBucket("Undergraduate Certificate or Diploma"), "certificate");
  assert.equal(normalizeDegreeBucket("Associate's Degree"), "associate");
  assert.equal(normalizeDegreeBucket("Bachelor's Degree"), "bachelor");
  assert.equal(normalizeDegreeBucket("Post-baccalaureate Certificate"), "certificate");
  assert.equal(normalizeDegreeBucket("Master's Degree"), "master");
  assert.equal(normalizeDegreeBucket("Doctoral Degree"), "doctorate");
  assert.equal(normalizeDegreeBucket("First Professional Degree"), "doctorate");
  assert.equal(normalizeDegreeBucket("Graduate/Professional Certificate"), "certificate");
});

test("degree: legacy short forms, bucket names, curly apostrophes, junk", () => {
  assert.equal(normalizeDegreeBucket("Masters"), "master");
  assert.equal(normalizeDegreeBucket("bachelor’s"), "bachelor");
  assert.equal(normalizeDegreeBucket("Master’s Degree"), "master");
  assert.equal(normalizeDegreeBucket("  DOCTORATE "), "doctorate");
  assert.equal(normalizeDegreeBucket("Certificate"), "certificate");
  assert.equal(normalizeDegreeBucket(""), null);
  assert.equal(normalizeDegreeBucket("nonsense"), null);
  assert.equal(normalizeDegreeBucket(null), null);
  assert.equal(normalizeDegreeBucket({}), null);
});

test("cip: undotted 4-digit as stored in programs.cip_code", () => {
  assert.equal(normalizeCipCode("1002"), "10.02");
  assert.equal(cipFamily("1002"), "10");
  assert.equal(cipFamily("0101"), "01");
  assert.equal(normalizeCipCode("0101"), "01.01");
  assert.equal(cipFamily("1107"), "11");
  assert.equal(cipFamily("6127"), "61");
});

test("cip: dotted and other forms", () => {
  assert.equal(cipFamily("01.0701"), "01");
  assert.equal(normalizeCipCode("01.0701"), "01.0701");
  assert.equal(cipFamily("1.0701"), "01");
  assert.equal(normalizeCipCode("1.0701"), "01.0701");
  assert.equal(cipFamily("110701"), "11");
  assert.equal(cipFamily("11"), "11");
  assert.equal(cipFamily("1"), "01");
});

test("cip: junk never throws and returns null", () => {
  for (const v of ["", "  ", "abc", "1.2.3", "123", null, undefined, {}, [], "default"]) {
    assert.equal(cipFamily(v), null);
    assert.equal(normalizeCipCode(v), null);
  }
});

test("state codes", () => {
  assert.equal(normalizeStateCode("tx"), "TX");
  assert.equal(normalizeStateCode(" AL "), "AL");
  assert.equal(normalizeStateCode("state"), null); // real junk row in schools
  assert.equal(normalizeStateCode("Texas"), null);
  assert.equal(normalizeStateCode(""), null);
  assert.equal(normalizeStateCode(null), null);
  assert.equal(normalizeStateCode(12), null);
});

test("picker has 72 labels and the table covers exactly them", () => {
  assert.equal(PICKER_LABELS.length, 72);
  assert.deepEqual(Object.keys(PROGRAM_LABEL_CIP_FAMILIES).sort(), [...PICKER_LABELS].sort());
});

test("every picker label resolves to at least one valid 2-digit family", () => {
  for (const label of PICKER_LABELS) {
    const fams = programLabelsToCipFamilies([label]);
    assert.ok(fams.length >= 1, `${label} unmapped`);
    for (const f of fams) assert.match(f, /^\d{2}$/, `${label}: ${f}`);
  }
});

test("labels -> families: case-insensitive, trimmed, deduped, sorted, unknown dropped", () => {
  assert.deepEqual(programLabelsToCipFamilies(["computer science"]), ["11"]);
  assert.deepEqual(programLabelsToCipFamilies(["  COMPUTER SCIENCE  "]), ["11"]);
  assert.deepEqual(
    programLabelsToCipFamilies(["Data Science", "Computer Science", "Agriculture"]),
    ["01", "11", "30"],
  );
  assert.deepEqual(programLabelsToCipFamilies(["Not A Real Major"]), []);
  assert.deepEqual(programLabelsToCipFamilies(["Not A Real Major", "Nursing"]), ["51"]);
  assert.deepEqual(programLabelsToCipFamilies([]), []);
  assert.deepEqual(programLabelsToCipFamilies(null), []);
  assert.deepEqual(programLabelsToCipFamilies([1, null, "Nursing"]), ["51"]);
});
