CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS jobs (
  id                      VARCHAR(30) PRIMARY KEY,
  title                   TEXT NOT NULL,
  description             TEXT,
  url                     TEXT NOT NULL,
  type                    VARCHAR(10),
  ts_publish              TIMESTAMPTZ,
  ts_create               TIMESTAMPTZ,
  scraped_at              TIMESTAMPTZ DEFAULT NOW(),
  updated_at              TIMESTAMPTZ,
  hourly_min              NUMERIC,
  hourly_max              NUMERIC,
  fixed_budget            NUMERIC,
  client_country          VARCHAR(100),
  client_score            NUMERIC,
  client_total_spend      NUMERIC,
  client_total_jobs       INT,
  client_hire_rate        NUMERIC,
  client_payment_verified BOOLEAN,
  level                   VARCHAR(30),
  category                VARCHAR(100),
  category_group          VARCHAR(100),
  skills                  JSONB,
  qualifications          JSONB,
  total_applicants        INT,
  invited_to_interview    INT,
  raw                     JSONB,
  UNIQUE(id)
);

CREATE INDEX IF NOT EXISTS idx_jobs_ts_publish ON jobs(ts_publish DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_scraped_at ON jobs(scraped_at DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_type ON jobs(type);

CREATE TABLE IF NOT EXISTS job_enrichments (
  id            UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  job_id        VARCHAR(30) REFERENCES jobs(id) ON DELETE CASCADE,
  enriched_at   TIMESTAMPTZ DEFAULT NOW(),
  model         VARCHAR(50),
  overall_score INT,
  llm_result    JSONB,
  filter_result JSONB,
  llm_reasoning TEXT,
  UNIQUE(job_id)
);

CREATE INDEX IF NOT EXISTS idx_enrichments_job_id       ON job_enrichments(job_id);
CREATE INDEX IF NOT EXISTS idx_enrichments_overall_score ON job_enrichments(overall_score DESC);

CREATE TABLE IF NOT EXISTS notifications (
  id      UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  job_id  VARCHAR(30) REFERENCES jobs(id),
  sent_at TIMESTAMPTZ DEFAULT NOW(),
  channel VARCHAR(50),
  status  VARCHAR(20),
  message TEXT
);

CREATE TABLE IF NOT EXISTS scrape_runs (
  id            UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  started_at    TIMESTAMPTZ DEFAULT NOW(),
  finished_at   TIMESTAMPTZ,
  apify_run_id  VARCHAR(50),
  search_query  TEXT,
  input         JSONB,
  items_fetched INT,
  items_new     INT,
  status        VARCHAR(20),
  error         TEXT
);

CREATE TABLE IF NOT EXISTS user_feedback (
  id         UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  job_id     VARCHAR(30) REFERENCES jobs(id),
  action     VARCHAR(20),
  reason     TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS skool_signals (
  id          UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  post_id     VARCHAR(100) UNIQUE NOT NULL,
  post_url    TEXT,
  post_title  TEXT,
  category    VARCHAR(100),
  created_at  TIMESTAMPTZ,
  scraped_at  TIMESTAMPTZ DEFAULT NOW(),
  is_signal   BOOLEAN,
  confidence  VARCHAR(10),
  signal_type VARCHAR(50),
  signal_text TEXT,
  reason      TEXT,
  contact     JSONB,
  notified    BOOLEAN DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_skool_signals_post_id    ON skool_signals(post_id);
CREATE INDEX IF NOT EXISTS idx_skool_signals_notified   ON skool_signals(notified);
CREATE INDEX IF NOT EXISTS idx_skool_signals_confidence ON skool_signals(confidence);
CREATE INDEX IF NOT EXISTS idx_skool_signals_created_at ON skool_signals(created_at DESC);
