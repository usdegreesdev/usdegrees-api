# Profile major label → CIP 2-digit family (review table)

Source of labels: frontend `src/data/profileOptions.ts` → `PROGRAM_OPTIONS` (72 labels).
Source of families: CIP 2020 two-digit series. Implemented in
`src/utils/preferenceAlignment.ts` → `PROGRAM_LABEL_CIP_FAMILIES`.

Matching is case-insensitive and trimmed; unknown labels are dropped. Output is
deduped and sorted. A label maps to several families only where the subject
genuinely sits in more than one CIP series.

**Unmapped labels: none.** Every picker label has at least one family.

| Label | Families | Reason |
|---|---|---|
| Accounting | 52 | CIP 52.03 Accounting and Related Services (Business) |
| Aerospace Engineering | 14 | CIP 14.02 |
| Agriculture | 01 | CIP 01 Agricultural Business and Production |
| Anthropology | 45 | CIP 45.02 (Social Sciences) |
| Architecture | 04 | CIP 04.02 Architecture |
| Automotive Technology | 47 | CIP 47.06 Vehicle Maintenance and Repair Technologies |
| Aviation | 49 | CIP 49.01 Air Transportation |
| Biochemistry | 26 | CIP 26.02 Biochemistry, Biophysics and Molecular Biology |
| Biomedical Engineering | 14 | CIP 14.05 Biomedical/Medical Engineering |
| Biology | 26 | CIP 26.01 Biology, General |
| Biotechnology | 26 | CIP 26.12 Biotechnology |
| Business Administration | 52 | CIP 52.02 Business Administration and Management |
| Chemical Engineering | 14 | CIP 14.07 |
| Chemistry | 40 | CIP 40.05 (Physical Sciences) |
| Civil Engineering | 14 | CIP 14.08 |
| Communications | 09 | CIP 09 Communication, Journalism and Related Programs |
| Computer Engineering | 14 | CIP 14.09 Computer Engineering (canonical home is Engineering) |
| Computer Programming | 11 | CIP 11.02 Computer Programming |
| Computer Science | 11 | CIP 11.07 Computer Science |
| Construction Management | 52 | CIP 52.20 Construction Management (Business) |
| Criminal Justice | 43 | CIP 43.01 Criminal Justice and Corrections |
| Culinary | 12 | CIP 12.05 Culinary Arts and Related Services |
| Data Analytics | 11, 30, 52 | Ambiguous: CIP 30.71 Data Analytics (interdisciplinary), 11.08 Computer/Information Systems data programs, 52.13 Management Sciences/business analytics |
| Data Science | 11, 30 | Ambiguous: CIP 30.70 Data Science (interdisciplinary) and 11.08 Computer Science data programs |
| Dentistry | 51 | CIP 51.04 |
| Economics | 45 | CIP 45.06 |
| Education | 13 | CIP 13 Education |
| Electrical Engineering | 14 | CIP 14.10 Electrical, Electronics and Communications Engineering |
| Entrepreneurship | 52 | CIP 52.07 Entrepreneurial and Small Business Operations |
| English | 23 | CIP 23 English Language and Literature |
| Environmental Science | 03 | CIP 03.01 Natural Resources Conservation and Research |
| Film | 50 | CIP 50.06 Film/Video and Photographic Arts |
| Finance | 52 | CIP 52.08 Finance and Financial Management Services |
| Fine Arts | 50 | CIP 50.07 Fine and Studio Arts |
| Graphic Design | 50 | CIP 50.04 Design and Applied Arts |
| Healthcare Administration | 51 | CIP 51.07 Health and Medical Administrative Services |
| History | 54 | CIP 54 History |
| Hospitality | 52 | CIP 52.09 Hospitality Administration/Management |
| Human Resources | 52 | CIP 52.10 Human Resources Management |
| Industrial Engineering | 14 | CIP 14.35 |
| Information Technology | 11 | CIP 11.01 / 11.10 Computer and Information Sciences / IT |
| International Business | 52 | CIP 52.11 International Business/Trade/Commerce |
| International Relations | 45 | CIP 45.09 International Relations and National Security Studies |
| Journalism | 09 | CIP 09.04 Journalism |
| Languages and Linguistics | 16 | CIP 16 Foreign Languages, Literatures and Linguistics |
| Liberal Arts | 24 | CIP 24 Liberal Arts and Sciences, General Studies |
| Management Information Systems | 52 | CIP 52.12 Management Information Systems and Services |
| Marketing | 52 | CIP 52.14 Marketing |
| Mathematics | 27 | CIP 27.01 |
| Mechanical Engineering | 14 | CIP 14.19 |
| Music | 50 | CIP 50.09 Music |
| Neuroscience | 26 | CIP 26.15 Neurobiology and Neurosciences |
| Nursing | 51 | CIP 51.38 Registered Nursing and Nursing Administration |
| Nutrition | 19, 30, 51 | Ambiguous: CIP 19.05 Foods, Nutrition and Related Services, 30.19 Nutrition Sciences, 51.31 Dietetics and Clinical Nutrition |
| Pharmacy | 51 | CIP 51.20 Pharmacy, Pharmaceutical Sciences |
| Philosophy | 38 | CIP 38 Philosophy and Religious Studies |
| Physical Therapy / Rehabilitation | 51 | CIP 51.23 Rehabilitation and Therapeutic Professions |
| Physics | 40 | CIP 40.08 |
| Political Science | 45 | CIP 45.10 Political Science and Government |
| Psychology | 42 | CIP 42 Psychology |
| Public Administration | 44 | CIP 44.04 Public Administration |
| Public Health | 51 | CIP 51.22 Public Health |
| Public Policy | 44 | CIP 44.05 Public Policy Analysis |
| Public Relations | 09 | CIP 09.09 Public Relations, Advertising and Applied Communication |
| Real Estate | 52 | CIP 52.15 Real Estate |
| Social Work | 44 | CIP 44.07 |
| Sociology | 45 | CIP 45.11 |
| Special Education | 13 | CIP 13.10 |
| Statistics | 27 | CIP 27.05 |
| Teacher Education | 13 | CIP 13.12 Teacher Education and Professional Development |
| Theatre | 50 | CIP 50.05 Drama/Theatre Arts and Stagecraft |
| Veterinary | 01, 51 | Ambiguous: CIP 01.80 Veterinary Sciences (Agriculture) and 51.24 Veterinary Medicine (Health) |

Multi-family labels: Data Analytics, Data Science, Nutrition, Veterinary.
