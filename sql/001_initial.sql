-- Apply to a NEW Supabase test project, never the existing production database.
CREATE TABLE IF NOT EXISTS app_users (
 telegram_id text PRIMARY KEY CHECK(telegram_id ~ '^[0-9]+$'),
 first_name text NOT NULL DEFAULT '', last_name text NOT NULL DEFAULT '',username text NOT NULL DEFAULT '',
 created_at timestamptz NOT NULL DEFAULT now(),last_seen timestamptz NOT NULL DEFAULT now(),
 reminder_opt_out boolean NOT NULL DEFAULT false
);
CREATE TABLE IF NOT EXISTS batches (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), title text NOT NULL, description text NOT NULL DEFAULT '',cover_url text,
 is_published boolean NOT NULL DEFAULT false,is_premium boolean NOT NULL DEFAULT false,sort_order integer NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS subjects (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),batch_id uuid NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
 title text NOT NULL,icon text NOT NULL DEFAULT '📚',sort_order integer NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS chapters (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),subject_id uuid NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
 title text NOT NULL,sort_order integer NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS lectures (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),chapter_id uuid NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
 title text NOT NULL,telegram_video_id text,telegram_notes_id text,is_premium boolean NOT NULL DEFAULT false,
 sort_order integer NOT NULL DEFAULT 0,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS batch_access (
 telegram_id text NOT NULL REFERENCES app_users(telegram_id) ON DELETE CASCADE,
 batch_id uuid NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
 expires_at timestamptz,PRIMARY KEY(telegram_id,batch_id)
);
CREATE TABLE IF NOT EXISTS lecture_progress (
 telegram_id text NOT NULL REFERENCES app_users(telegram_id) ON DELETE CASCADE,
 lecture_id uuid NOT NULL REFERENCES lectures(id) ON DELETE CASCADE,
 completed_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(telegram_id,lecture_id)
);
CREATE TABLE IF NOT EXISTS study_sessions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),telegram_id text NOT NULL REFERENCES app_users(telegram_id) ON DELETE CASCADE,
 subject_id uuid REFERENCES subjects(id) ON DELETE SET NULL,started_at timestamptz NOT NULL DEFAULT now(),
 ended_at timestamptz, CHECK(ended_at IS NULL OR ended_at >= started_at)
);
CREATE UNIQUE INDEX IF NOT EXISTS one_running_session_per_user ON study_sessions(telegram_id) WHERE ended_at IS NULL;
CREATE TABLE IF NOT EXISTS study_goals (
 telegram_id text NOT NULL REFERENCES app_users(telegram_id) ON DELETE CASCADE,goal_day date NOT NULL,
 target_minutes integer NOT NULL DEFAULT 120 CHECK(target_minutes BETWEEN 1 AND 1440),PRIMARY KEY(telegram_id,goal_day)
);
CREATE TABLE IF NOT EXISTS study_tasks (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),telegram_id text NOT NULL REFERENCES app_users(telegram_id) ON DELETE CASCADE,
 title text NOT NULL CHECK(length(title) <= 240),due_day date,is_done boolean NOT NULL DEFAULT false,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS study_groups (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),name text NOT NULL CHECK(length(name) BETWEEN 3 AND 70),
 owner_id text NOT NULL REFERENCES app_users(telegram_id),created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS group_members (
 group_id uuid NOT NULL REFERENCES study_groups(id) ON DELETE CASCADE,
 telegram_id text NOT NULL REFERENCES app_users(telegram_id) ON DELETE CASCADE,
 joined_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(group_id,telegram_id)
);
CREATE TABLE IF NOT EXISTS group_messages (
 id bigserial PRIMARY KEY,group_id uuid NOT NULL REFERENCES study_groups(id) ON DELETE CASCADE,
 sender_id text NOT NULL REFERENCES app_users(telegram_id),body text NOT NULL CHECK(length(body) BETWEEN 1 AND 2000),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS group_messages_recent ON group_messages(group_id,id DESC);
CREATE TABLE IF NOT EXISTS referrals (
 inviter_id text NOT NULL REFERENCES app_users(telegram_id),invitee_id text PRIMARY KEY REFERENCES app_users(telegram_id),
 created_at timestamptz NOT NULL DEFAULT now(),CHECK(inviter_id <> invitee_id)
);
CREATE TABLE IF NOT EXISTS point_ledger (
 id bigserial PRIMARY KEY,telegram_id text NOT NULL REFERENCES app_users(telegram_id),
 points integer NOT NULL,reason text NOT NULL,source_key text UNIQUE,created_at timestamptz NOT NULL DEFAULT now()
);
-- Prevent direct anonymous access to study data if Supabase REST is enabled.
ALTER TABLE app_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE subjects ENABLE ROW LEVEL SECURITY;
ALTER TABLE chapters ENABLE ROW LEVEL SECURITY;
ALTER TABLE lectures ENABLE ROW LEVEL SECURITY;
ALTER TABLE batch_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE lecture_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE study_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE study_goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE study_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE study_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE referrals ENABLE ROW LEVEL SECURITY;
ALTER TABLE point_ledger ENABLE ROW LEVEL SECURITY;
-- Backend uses direct PostgreSQL connection with validated Telegram initData.
-- Do NOT publish the DATABASE_URL or service role key in frontend JavaScript.
