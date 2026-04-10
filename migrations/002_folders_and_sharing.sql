-- ============================================================
-- Migration 002 — Folders, Sharing & Role Unification
-- Run in Supabase SQL Editor AFTER 001_initial_schema.sql
-- ============================================================

-- ── FOLDERS ──────────────────────────────────────────────────

create table public.folders (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references public.users(id) on delete cascade,
  parent_id   uuid references public.folders(id) on delete cascade,
  name        text not null,
  created_at  timestamptz not null default now(),
  constraint no_self_reference check (id != parent_id)
);

alter table public.folders enable row level security;

create policy "folders: owner full access"
  on public.folders for all
  using (owner_id = auth.uid());

create index folders_owner_idx  on public.folders(owner_id);
create index folders_parent_idx on public.folders(parent_id);

-- ── UPDATE QUESTIONS TABLE ────────────────────────────────────

alter table public.questions
  add column folder_id  uuid     references public.folders(id) on delete set null,
  add column is_shared  boolean  not null default false;

create index questions_folder_idx on public.questions(folder_id);
create index questions_shared_idx on public.questions(is_shared) where is_shared = true;

-- Any authenticated user can read shared questions
create policy "questions: read shared by all"
  on public.questions for select
  using (is_shared = true and auth.uid() is not null);

-- ── ROLE UNIFICATION ─────────────────────────────────────────
-- There is now one user type. Everyone gets 'admin' permissions.
-- The 'student' role value is kept in the enum for backward compat
-- but no longer assigned to new users.

-- Update trigger so all new signups get 'admin'
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.users (id, display_name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)),
    'admin'
  );
  return new;
end;
$$;

-- Upgrade any existing 'student' accounts
update public.users set role = 'admin' where role = 'student';

-- ── UPDATE RLS: unify access policies ────────────────────────

-- Drop old student-specific read policies
drop policy if exists "paragraphs: student read if in accessible test"  on public.paragraphs;
drop policy if exists "questions: student read if in published test"    on public.questions;
drop policy if exists "tests: student read published"                   on public.tests;
drop policy if exists "test_sections: student read published"           on public.test_sections;
drop policy if exists "test_questions: student read published"          on public.test_questions;

-- Any authenticated user can read published tests
create policy "tests: any user read published"
  on public.tests for select
  using (is_published = true and auth.uid() is not null);

create policy "test_sections: any user read if test published"
  on public.test_sections for select
  using (
    auth.uid() is not null and
    exists (
      select 1 from public.tests t
      where t.id = test_sections.test_id and t.is_published = true
    )
  );

create policy "test_questions: any user read if test published"
  on public.test_questions for select
  using (
    auth.uid() is not null and
    exists (
      select 1 from public.test_sections ts
      join public.tests t on t.id = ts.test_id
      where ts.id = test_questions.test_section_id
        and t.is_published = true
    )
  );

create policy "paragraphs: any user read if in published test"
  on public.paragraphs for select
  using (
    auth.uid() is not null and
    exists (
      select 1 from public.questions q
      join public.test_questions tq on tq.question_id = q.id
      join public.test_sections ts on ts.id = tq.test_section_id
      join public.tests t on t.id = ts.test_id
      where q.paragraph_id = paragraphs.id
        and t.is_published = true
    )
  );

-- Attempts: any user owns their own (unchanged, but re-add clearly)
-- (existing policy "attempts: student owns their own" remains valid)
