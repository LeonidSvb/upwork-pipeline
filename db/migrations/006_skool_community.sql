ALTER TABLE skool_signals
  ADD COLUMN IF NOT EXISTS community VARCHAR(100);

CREATE INDEX IF NOT EXISTS idx_skool_signals_community ON skool_signals(community);

UPDATE skool_signals SET community = 'academy' WHERE community IS NULL;
