-- EduBot V2 study & groups features. Execute in the TEST Supabase project after 001_initial.sql.
-- Idempotent, additive migration; it does not modify any production database.
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS show_in_global boolean NOT NULL DEFAULT false;
ALTER TABLE study_groups ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'link' CHECK (visibility IN ('link','public'));
ALTER TABLE study_groups ADD COLUMN IF NOT EXISTS invite_code text UNIQUE;
ALTER TABLE study_groups ADD COLUMN IF NOT EXISTS target_minutes integer NOT NULL DEFAULT 180 CHECK (target_minutes BETWEEN 15 AND 1440);
ALTER TABLE study_groups ADD COLUMN IF NOT EXISTS show_live_timers boolean NOT NULL DEFAULT true;
ALTER TABLE study_groups ADD COLUMN IF NOT EXISTS chat_mode text NOT NULL DEFAULT 'everyone' CHECK (chat_mode IN ('everyone','admins'));
ALTER TABLE study_groups ADD COLUMN IF NOT EXISTS slow_mode_seconds integer NOT NULL DEFAULT 0 CHECK (slow_mode_seconds BETWEEN 0 AND 3600);
ALTER TABLE study_groups ADD COLUMN IF NOT EXISTS pinned_message_id bigint;
UPDATE study_groups SET invite_code=encode(gen_random_bytes(8),'hex') WHERE invite_code IS NULL;
ALTER TABLE study_groups ALTER COLUMN invite_code SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS study_groups_invite_code_idx ON study_groups(invite_code);
ALTER TABLE group_members ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'member' CHECK (role IN ('owner','coadmin','member'));
ALTER TABLE group_members ADD COLUMN IF NOT EXISTS muted_until timestamptz;
UPDATE group_members gm SET role='owner'
 FROM study_groups g WHERE gm.group_id=g.id AND gm.telegram_id=g.owner_id AND gm.role<>'owner';
ALTER TABLE group_messages ADD COLUMN IF NOT EXISTS is_deleted boolean NOT NULL DEFAULT false;
ALTER TABLE study_tasks ADD COLUMN IF NOT EXISTS subject_id uuid REFERENCES subjects(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS study_sessions_global_active ON study_sessions(started_at) WHERE ended_at IS NULL;
CREATE INDEX IF NOT EXISTS study_sessions_stats ON study_sessions(telegram_id,started_at DESC);
CREATE INDEX IF NOT EXISTS group_members_user ON group_members(telegram_id);
-- All new columns inherit the already-enabled RLS of their parent tables.
