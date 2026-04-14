-- Upwork Pipeline Database Schema

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Raw jobs from scraper
CREATE TABLE IF NOT EXISTS jobs (
  id                    VARCHAR(30) PRIMARY KEY,
  title                 TEXT NOT NULL,
  description           TEXT,
  url                   TEXT NOT NULL,
  type                  VARCHAR(10),  -- HOURLY | FIXED
  ts_publish            TIMESTAMPTZ,
  ts_create             TIMESTAMPTZ,
  scraped_at            TIMESTAMPTZ DEFAULT NOW(),

  -- Budget
  hourly_min            NUMERIC,
  hourly_max            NUMERIC,
  fixed_budget          NUMERIC,

  -- Client
  client_country        VARCHAR(100),
  client_score          NUMERIC,
  client_total_spend    NUMERIC,
  client_total_jobs     INT,
  client_hire_rate      NUMERIC,
  client_payment_verified BOOLEAN,

  -- Job details
  level                 VARCHAR(30),  -- EntryLevel | Intermediate | ExpertLevel
  category              VARCHAR(100),
  category_group        VARCHAR(100),
  skills                JSONB,
  qualifications        JSONB,

  -- Activity
  total_applicants      INT,
  invited_to_interview  INT,

  -- Raw data
  raw                   JSONB,

  UNIQUE(id)
);

CREATE INDEX IF NOT EXISTS idx_jobs_ts_publish ON jobs(ts_publish DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_scraped_at ON jobs(scraped_at DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_type ON jobs(type);

-- LLM enrichment results
CREATE TABLE IF NOT EXISTS job_enrichments (
  id                    UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  job_id                VARCHAR(30) REFERENCES jobs(id) ON DELETE CASCADE,
  enriched_at           TIMESTAMPTZ DEFAULT NOW(),
  model                 VARCHAR(50),

  -- LLM scores (0-10)
  relevance_score       INT,
  budget_score          INT,
  client_quality_score  INT,
  overall_score         INT,

  -- LLM boolean flags
  is_relevant           BOOLEAN,
  is_good_client        BOOLEAN,
  is_budget_ok          BOOLEAN,
  has_clear_requirements BOOLEAN,
  is_long_term          BOOLEAN,

  -- LLM categorization
  primary_category      VARCHAR(50),
  tags                  TEXT[],
  rejection_reasons     TEXT[],

  -- Full LLM response
  llm_reasoning         TEXT,
  llm_raw               JSONB,

  UNIQUE(job_id)
);

CREATE INDEX IF NOT EXISTS idx_enrichments_job_id ON job_enrichments(job_id);
CREATE INDEX IF NOT EXISTS idx_enrichments_is_relevant ON job_enrichments(is_relevant);
CREATE INDEX IF NOT EXISTS idx_enrichments_overall_score ON job_enrichments(overall_score DESC);

-- Notifications sent
CREATE TABLE IF NOT EXISTS notifications (
  id          UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  job_id      VARCHAR(30) REFERENCES jobs(id),
  sent_at     TIMESTAMPTZ DEFAULT NOW(),
  channel     VARCHAR(50),  -- telegram | email
  status      VARCHAR(20),  -- sent | failed
  message     TEXT
);

-- Scrape runs log
CREATE TABLE IF NOT EXISTS scrape_runs (
  id              UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  started_at      TIMESTAMPTZ DEFAULT NOW(),
  finished_at     TIMESTAMPTZ,
  apify_run_id    VARCHAR(50),
  search_query    TEXT,
  input           JSONB,
  items_fetched   INT,
  items_new       INT,
  status          VARCHAR(20),  -- running | succeeded | failed
  error           TEXT
);

-- View: jobs with enrichment ready for UI
CREATE OR REPLACE VIEW jobs_enriched AS
  SELECT
    j.id,
    j.title,
    j.url,
    j.type,
    j.hourly_min,
    j.hourly_max,
    j.fixed_budget,
    j.client_country,
    j.client_score,
    j.client_total_spend,
    j.client_hire_rate,
    j.client_payment_verified,
    j.level,
    j.category,
    j.skills,
    j.ts_publish,
    j.scraped_at,
    e.is_relevant,
    e.overall_score,
    e.primary_category,
    e.tags,
    e.llm_reasoning,
    e.rejection_reasons
  FROM jobs j
  LEFT JOIN job_enrichments e ON j.id = e.job_id
  ORDER BY e.overall_score DESC NULLS LAST, j.ts_publish DESC;
