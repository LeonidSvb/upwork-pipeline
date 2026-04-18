CREATE TABLE IF NOT EXISTS skool_blacklist (
  id         UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id    VARCHAR(100) UNIQUE NOT NULL,
  name       TEXT,
  reason     TEXT,
  added_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_skool_blacklist_user_id ON skool_blacklist(user_id);
