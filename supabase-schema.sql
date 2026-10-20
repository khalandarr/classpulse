-- ============================================================
-- ClassPulse — Supabase Schema
-- Run this in your Supabase SQL Editor before launching the app
-- ============================================================

-- Enable Row Level Security on all tables

-- ─── Students ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS students (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  roll_number   TEXT NOT NULL,
  email         TEXT,
  phone         TEXT,
  course        TEXT NOT NULL,
  semester      INTEGER NOT NULL CHECK (semester BETWEEN 1 AND 8),
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now(),
  UNIQUE(teacher_id, roll_number)
);

ALTER TABLE students ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Teachers see own students"
  ON students FOR ALL
  USING (auth.uid() = teacher_id)
  WITH CHECK (auth.uid() = teacher_id);

-- ─── Attendance ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS attendance (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id    UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  teacher_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date          DATE NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('present','absent','late')),
  created_at    TIMESTAMPTZ DEFAULT now(),
  UNIQUE(student_id, date)
);

ALTER TABLE attendance ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Teachers manage own attendance"
  ON attendance FOR ALL
  USING (auth.uid() = teacher_id)
  WITH CHECK (auth.uid() = teacher_id);

-- ─── Assessments ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS assessments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  max_marks     INTEGER NOT NULL CHECK (max_marks > 0),
  date          DATE NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT now(),
  UNIQUE(teacher_id, name)
);

ALTER TABLE assessments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Teachers manage own assessments"
  ON assessments FOR ALL
  USING (auth.uid() = teacher_id)
  WITH CHECK (auth.uid() = teacher_id);

-- ─── Marks ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS marks (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id      UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  assessment_id   UUID NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
  teacher_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  score           NUMERIC(6,2) NOT NULL CHECK (score >= 0),
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE(student_id, assessment_id)
);

ALTER TABLE marks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Teachers manage own marks"
  ON marks FOR ALL
  USING (auth.uid() = teacher_id)
  WITH CHECK (auth.uid() = teacher_id);

-- ─── Follow-ups ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS followups (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id    UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  teacher_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  alert_type    TEXT NOT NULL,
  note          TEXT,
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','in_progress','resolved')),
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE followups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Teachers manage own followups"
  ON followups FOR ALL
  USING (auth.uid() = teacher_id)
  WITH CHECK (auth.uid() = teacher_id);

-- ─── Updated_at trigger function ────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_students_updated
  BEFORE UPDATE ON students
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_marks_updated
  BEFORE UPDATE ON marks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_followups_updated
  BEFORE UPDATE ON followups
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
