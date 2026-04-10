-- ============================================================
-- Migration 003 — Test Descriptions, Visibility & User Settings
-- Run in Supabase SQL Editor AFTER 002_folders_and_sharing.sql
-- ============================================================

-- ── ADD description TO tests ──────────────────────────────────

ALTER TABLE public.tests
  ADD COLUMN IF NOT EXISTS description TEXT;

-- ── ADD visibility TO tests ───────────────────────────────────
-- 'public'      = listed on Discover, anyone can take it
-- 'invite_only' = not listed on Discover, but accessible via direct link
-- 'private'     = only the owner can see it (never shown on Discover)

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'test_visibility') THEN
    CREATE TYPE public.test_visibility AS ENUM ('public', 'invite_only', 'private');
  END IF;
END $$;

ALTER TABLE public.tests
  ADD COLUMN IF NOT EXISTS visibility public.test_visibility NOT NULL DEFAULT 'public';

-- Backfill: published tests → public, unpublished → private
UPDATE public.tests SET visibility = 'public'  WHERE is_published = true  AND visibility = 'public';
UPDATE public.tests SET visibility = 'private' WHERE is_published = false AND visibility = 'public';

-- ── UPDATE DISCOVER POLICY ────────────────────────────────────
-- Discover only shows 'public' tests that are published.
-- 'invite_only' tests are accessible by direct URL but not listed.

DROP POLICY IF EXISTS "tests: any user read published" ON public.tests;

CREATE POLICY "tests: any user read published"
  ON public.tests FOR SELECT
  USING (
    is_published = true
    AND visibility IN ('public', 'invite_only')
    AND auth.uid() IS NOT NULL
  );

-- ── USER SETTINGS TABLE ───────────────────────────────────────
-- Stores per-user defaults for the test creation form.

CREATE TABLE IF NOT EXISTS public.user_settings (
  user_id               UUID PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  display_name          TEXT,
  default_duration_mins INTEGER NOT NULL DEFAULT 180,
  default_marks_correct NUMERIC NOT NULL DEFAULT 4,
  default_marks_wrong   NUMERIC NOT NULL DEFAULT -1
);

ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_settings: owner full access"
  ON public.user_settings FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
