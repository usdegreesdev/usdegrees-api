-- SAT score positioning (report Design B): disclosure-category copy that the
-- report shows for colleges whose SAT range can't be charted.
--
-- Idempotent. Run with:
--   psql "$DATABASE_URL" -f src/db/migrations/sat_positioning.sql
--
-- All fallback copy lives here (not in code); the report reads these columns
-- and never branches on category text. Branching on show_badge_with_range is
-- the intended switch.

BEGIN;

ALTER TABLE public.admission_disclosure_categories
  ADD COLUMN IF NOT EXISTS contact_guidance text,
  ADD COLUMN IF NOT EXISTS show_badge_with_range boolean NOT NULL DEFAULT false;

-- New category for colleges with no category and no usable range
INSERT INTO public.admission_disclosure_categories
  (category, badge_label, badge_color, supporting_copy, disclaimer_tier, disclaimer_text,
   show_admission_rate_required, contact_guidance, show_badge_with_range)
SELECT 'G_NO_SCORE_DATA', 'SAT Range Not Reported', 'gray',
       'This college has not reported an SAT score range for its students, so your score can''t be placed against it here.',
       2,
       'Testing policies and score expectations change often. Confirm current requirements directly with the college before you apply.',
       false,
       'Contact the college''s admissions office or visit its official website for its current SAT expectations.',
       false
WHERE NOT EXISTS (
  SELECT 1 FROM public.admission_disclosure_categories WHERE category = 'G_NO_SCORE_DATA'
);

UPDATE public.admission_disclosure_categories SET contact_guidance = CASE category
  WHEN 'A_OPEN_ADMISSION'         THEN 'Confirm the current testing policy with the college''s admissions office or official website before applying.'
  WHEN 'B_NOT_USED'               THEN 'Contact the admissions office or visit the college''s official website to learn how applications are evaluated.'
  WHEN 'C_TEST_OPTIONAL'          THEN 'Contact the admissions office or visit the college''s official website to ask whether submitting your score is recommended.'
  WHEN 'D_REVIEW_PENDING'         THEN 'Contact the admissions office or visit the college''s official website for its current testing requirements.'
  WHEN 'E_TEST_REQUIRED_NO_RANGE' THEN 'Contact the admissions office or visit the college''s official website for the score range it expects.'
  ELSE contact_guidance END
WHERE contact_guidance IS NULL;

-- Categories whose badge changes how a published range should be read
UPDATE public.admission_disclosure_categories
SET show_badge_with_range = (category IN ('B_NOT_USED','C_TEST_OPTIONAL'));

COMMIT;
