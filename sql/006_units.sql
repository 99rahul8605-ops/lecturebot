-- V2 TEST only. Run AFTER 004 and 005. Adds legacy-compatible unit hierarchy.
CREATE TABLE IF NOT EXISTS units(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 chapter_id uuid NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
 title text NOT NULL CHECK(length(title) BETWEEN 1 AND 120),
 sort_order integer NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS units_chapter_order ON units(chapter_id,sort_order,title,id);
ALTER TABLE units ENABLE ROW LEVEL SECURITY;
ALTER TABLE lectures ADD COLUMN IF NOT EXISTS unit_id uuid REFERENCES units(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS lectures_unit_sort ON lectures(chapter_id,unit_id,sort_order,created_at);
ALTER TABLE auto_save_sessions ADD COLUMN IF NOT EXISTS unit_id uuid REFERENCES units(id) ON DELETE SET NULL;
