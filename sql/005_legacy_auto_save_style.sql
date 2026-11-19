-- Compare against legacy CA Inter auto lecture saving. TEST Supabase only.
ALTER TABLE auto_save_sessions ADD COLUMN IF NOT EXISTS last_receipt_chat_id text;
ALTER TABLE auto_save_sessions ADD COLUMN IF NOT EXISTS last_receipt_message_id bigint;
ALTER TABLE auto_save_sessions ADD COLUMN IF NOT EXISTS last_action_type text CHECK(last_action_type IN ('lecture','notes'));
ALTER TABLE auto_save_sessions ADD COLUMN IF NOT EXISTS last_lecture_id uuid;
ALTER TABLE auto_save_receipts ADD COLUMN IF NOT EXISTS is_undone boolean NOT NULL DEFAULT false;
ALTER TABLE auto_save_receipts ADD COLUMN IF NOT EXISTS file_code text;
CREATE TABLE IF NOT EXISTS saved_telegram_files(
 code text PRIMARY KEY CHECK(code ~ '^[A-Za-z0-9_-]{12,40}$'),
 telegram_id text NOT NULL REFERENCES app_users(telegram_id) ON DELETE CASCADE,
 telegram_file_id text NOT NULL,
 file_type text NOT NULL CHECK(file_type IN ('video','document')),
 file_name text NOT NULL DEFAULT '',
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS saved_telegram_files_owner ON saved_telegram_files(telegram_id,created_at DESC);
ALTER TABLE saved_telegram_files ENABLE ROW LEVEL SECURITY;
CREATE UNIQUE INDEX IF NOT EXISTS auto_save_receipts_file_code_idx ON auto_save_receipts(file_code) WHERE file_code IS NOT NULL;
