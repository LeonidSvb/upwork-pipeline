-- Migrate job_enrichments to flexible JSONB schema
-- Keep overall_score as separate column for fast filtering

ALTER TABLE job_enrichments
  ADD COLUMN IF NOT EXISTS llm_result JSONB,
  ADD COLUMN IF NOT EXISTS filter_result JSONB;

-- Migrate existing data into llm_result
UPDATE job_enrichments SET llm_result = jsonb_build_object(
  'relevance_score',       relevance_score,
  'budget_score',          budget_score,
  'client_quality_score',  client_quality_score,
  'is_relevant',           is_relevant,
  'is_good_client',        is_good_client,
  'is_budget_ok',          is_budget_ok,
  'has_clear_requirements',has_clear_requirements,
  'is_long_term',          is_long_term,
  'primary_category',      primary_category,
  'tags',                  tags,
  'rejection_reasons',     rejection_reasons
) WHERE llm_result IS NULL;

-- Drop view first (depends on old columns)
DROP VIEW IF EXISTS jobs_enriched;

-- Drop old columns
ALTER TABLE job_enrichments
  DROP COLUMN IF EXISTS relevance_score,
  DROP COLUMN IF EXISTS budget_score,
  DROP COLUMN IF EXISTS client_quality_score,
  DROP COLUMN IF EXISTS is_relevant,
  DROP COLUMN IF EXISTS is_good_client,
  DROP COLUMN IF EXISTS is_budget_ok,
  DROP COLUMN IF EXISTS has_clear_requirements,
  DROP COLUMN IF EXISTS is_long_term,
  DROP COLUMN IF EXISTS primary_category,
  DROP COLUMN IF EXISTS tags,
  DROP COLUMN IF EXISTS rejection_reasons;

CREATE INDEX IF NOT EXISTS idx_enrichments_llm_result ON job_enrichments USING GIN(llm_result);
