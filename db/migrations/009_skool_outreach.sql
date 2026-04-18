CREATE TABLE IF NOT EXISTS skool_outreach (
  id         UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  post_id    VARCHAR(100) NOT NULL,
  action     VARCHAR(50) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_skool_outreach_post_id ON skool_outreach(post_id);
