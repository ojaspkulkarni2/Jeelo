-- Migration 004: Add exam_type to tests table
-- Supports 'main' (JEE Main) and 'advanced' (JEE Advanced)

ALTER TABLE tests
  ADD COLUMN exam_type text NOT NULL DEFAULT 'advanced'
  CHECK (exam_type IN ('main', 'advanced'));

CREATE INDEX idx_tests_exam_type ON tests (exam_type);
