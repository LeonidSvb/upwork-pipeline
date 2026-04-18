CREATE TABLE IF NOT EXISTS skool_signals (
  id              UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  post_id         VARCHAR(100) UNIQUE NOT NULL,
  post_url        TEXT,
  post_title      TEXT,
  category        VARCHAR(100),
  created_at      TIMESTAMPTZ,
  scraped_at      TIMESTAMPTZ DEFAULT NOW(),
  is_signal       BOOLEAN,
  confidence      VARCHAR(10),
  signal_type     VARCHAR(50),
  signal_text     TEXT,
  reason          TEXT,
  contact         JSONB,
  notified        BOOLEAN DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_skool_signals_post_id    ON skool_signals(post_id);
CREATE INDEX IF NOT EXISTS idx_skool_signals_notified   ON skool_signals(notified);
CREATE INDEX IF NOT EXISTS idx_skool_signals_confidence ON skool_signals(confidence);
CREATE INDEX IF NOT EXISTS idx_skool_signals_created_at ON skool_signals(created_at DESC);
