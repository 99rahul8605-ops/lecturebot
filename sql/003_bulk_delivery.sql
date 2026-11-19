-- V2 secure bulk delivery requests; execute after migrations 001 and 002.
CREATE TABLE IF NOT EXISTS delivery_jobs (
 id text PRIMARY KEY CHECK(id ~ '^[a-f0-9]{24}$'),
 telegram_id text NOT NULL REFERENCES app_users(telegram_id) ON DELETE CASCADE,
 media_type text NOT NULL CHECK(media_type IN ('lec','note')),
 lecture_ids uuid[] NOT NULL CHECK(cardinality(lecture_ids) BETWEEN 1 AND 25),
 created_at timestamptz NOT NULL DEFAULT now(),
 consumed_at timestamptz,
 expires_at timestamptz NOT NULL DEFAULT (now()+interval '15 minutes')
);
CREATE INDEX IF NOT EXISTS delivery_jobs_user_idx ON delivery_jobs(telegram_id,created_at DESC);
ALTER TABLE delivery_jobs ENABLE ROW LEVEL SECURITY;
