-- EduBot V2 test-only migration. Run after 001, 002, 003 in the TEST Supabase project.
-- Cover images are small PostgreSQL bytea records, portable with DB backups.
-- Migrate large-scale imagery to external object storage before production.
CREATE TABLE IF NOT EXISTS batch_covers (
  batch_id uuid PRIMARY KEY REFERENCES batches(id) ON DELETE CASCADE,
  content_type text NOT NULL CHECK(content_type IN ('image/jpeg','image/png','image/webp')),
  image_bytes bytea NOT NULL CHECK(octet_length(image_bytes) BETWEEN 16 AND 1572864),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS auto_save_sessions (
  telegram_id text PRIMARY KEY REFERENCES app_users(telegram_id) ON DELETE CASCADE,
  chapter_id uuid NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  is_active boolean NOT NULL DEFAULT false,
  saved_videos integer NOT NULL DEFAULT 0,
  saved_pdfs integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS auto_save_receipts (
  telegram_id text NOT NULL REFERENCES app_users(telegram_id) ON DELETE CASCADE,
  chat_id text NOT NULL,
  message_id bigint NOT NULL,
  media_kind text NOT NULL CHECK(media_kind IN ('video','pdf')),
  lecture_id uuid REFERENCES lectures(id) ON DELETE SET NULL,
  saved_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(telegram_id,chat_id,message_id)
);
CREATE INDEX IF NOT EXISTS auto_save_receipts_saved_at_idx
  ON auto_save_receipts(telegram_id,saved_at DESC);
ALTER TABLE batch_covers ENABLE ROW LEVEL SECURITY;
ALTER TABLE auto_save_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE auto_save_receipts ENABLE ROW LEVEL SECURITY;
-- No anon policies: only authenticated Node server with owner checks can write.
