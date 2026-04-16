-- Fix notifications: unique per job+channel to prevent duplicates
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'notifications_job_channel_unique'
  ) THEN
    ALTER TABLE notifications ADD CONSTRAINT notifications_job_channel_unique UNIQUE (job_id, channel);
  END IF;
END $$;

-- Feedback from Telegram inline buttons
CREATE TABLE IF NOT EXISTS job_feedback (
  id          UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  job_id      VARCHAR(30) REFERENCES jobs(id) ON DELETE CASCADE,
  feedback    VARCHAR(10) NOT NULL,  -- good | bad | skip
  reason      TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_feedback_job_id ON job_feedback(job_id);
CREATE INDEX IF NOT EXISTS idx_feedback_type ON job_feedback(feedback);
