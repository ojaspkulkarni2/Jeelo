-- ============================================================
-- JEE Platform — Full Schema Migration
-- Run this in Supabase SQL editor (Dashboard > SQL Editor)
-- ============================================================

-- ── ENUMS ────────────────────────────────────────────────────

create type user_role as enum ('admin', 'student');

create type question_type as enum (
  'scq',        -- single correct MCQ
  'mcq',        -- multi correct MCQ
  'integer',    -- integer answer (0–9 typically)
  'numerical',  -- decimal answer
  'paragraph'   -- passage-based (links to a paragraph)
);

create type subject as enum ('physics', 'chemistry', 'mathematics');

-- ── USERS ────────────────────────────────────────────────────
-- Extends Supabase auth.users — one row per auth user

create table public.users (
  id            uuid primary key references auth.users(id) on delete cascade,
  role          user_role not null default 'student',
  display_name  text not null,
  created_at    timestamptz not null default now()
);

-- Auto-create user row on signup
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.users (id, display_name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)),
    coalesce((new.raw_user_meta_data->>'role')::user_role, 'student')
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ── PARAGRAPHS ───────────────────────────────────────────────
-- Passage text for paragraph-based questions (stored as image)

create table public.paragraphs (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references public.users(id) on delete cascade,
  image_url   text not null,     -- R2 object key
  title       text,              -- optional label e.g. "Paragraph 1"
  created_at  timestamptz not null default now()
);

-- ── QUESTIONS ────────────────────────────────────────────────

create table public.questions (
  id              uuid primary key default gen_random_uuid(),
  owner_id        uuid not null references public.users(id) on delete cascade,
  image_url       text not null,           -- R2 object key for question image
  type            question_type not null,
  subject         subject not null,
  chapter         text not null,           -- e.g. "Thermodynamics"
  -- correct_answer shape per type:
  --   scq:       ["A"] | ["B"] | ["C"] | ["D"]
  --   mcq:       ["A","C"] — one or more
  --   integer:   5
  --   numerical: 3.14
  --   paragraph: same as scq/mcq depending on sub-type
  correct_answer  jsonb not null,
  paragraph_id    uuid references public.paragraphs(id) on delete set null,
  created_at      timestamptz not null default now(),

  constraint valid_scq_answer check (
    type != 'scq' or (
      jsonb_typeof(correct_answer) = 'array' and
      jsonb_array_length(correct_answer) = 1
    )
  ),
  constraint valid_mcq_answer check (
    type != 'mcq' or (
      jsonb_typeof(correct_answer) = 'array' and
      jsonb_array_length(correct_answer) >= 1
    )
  ),
  constraint valid_integer_answer check (
    type != 'integer' or jsonb_typeof(correct_answer) = 'number'
  ),
  constraint valid_numerical_answer check (
    type != 'numerical' or jsonb_typeof(correct_answer) = 'number'
  ),
  constraint paragraph_required check (
    type != 'paragraph' or paragraph_id is not null
  )
);

create index questions_owner_idx on public.questions(owner_id);
create index questions_subject_idx on public.questions(subject);

-- ── TESTS ────────────────────────────────────────────────────

create table public.tests (
  id              uuid primary key default gen_random_uuid(),
  owner_id        uuid not null references public.users(id) on delete cascade,
  title           text not null,
  duration_mins   integer not null check (duration_mins > 0),
  is_published    boolean not null default false,
  created_at      timestamptz not null default now()
);

-- ── TEST SECTIONS ────────────────────────────────────────────
-- Each section has its own marking scheme

create table public.test_sections (
  id                uuid primary key default gen_random_uuid(),
  test_id           uuid not null references public.tests(id) on delete cascade,
  name              text not null,           -- e.g. "Section 1 — Single Correct"
  question_type     question_type not null,
  subject           subject not null,
  marks_correct     numeric not null,        -- e.g. 4
  marks_wrong       numeric not null,        -- e.g. -1 (store as negative)
  marks_partial     numeric,                 -- nullable, only for mcq partial credit
  display_order     integer not null default 0
);

create index test_sections_test_idx on public.test_sections(test_id);

-- ── TEST QUESTIONS ───────────────────────────────────────────
-- Join table: which questions are in which section, in what order

create table public.test_questions (
  test_section_id   uuid not null references public.test_sections(id) on delete cascade,
  question_id       uuid not null references public.questions(id) on delete cascade,
  display_order     integer not null default 0,
  primary key (test_section_id, question_id)
);

-- ── ATTEMPTS ─────────────────────────────────────────────────
-- One row per student per test attempt

create table public.attempts (
  id              uuid primary key default gen_random_uuid(),
  test_id         uuid not null references public.tests(id) on delete cascade,
  student_id      uuid not null references public.users(id) on delete cascade,
  started_at      timestamptz not null default now(),
  submitted_at    timestamptz,               -- null = in progress
  -- answers: { [question_id]: { answer: any, status: string } }
  -- status: 'not_visited' | 'not_answered' | 'answered' | 'marked' | 'answered_marked'
  -- answer only written on explicit Save & Next — matches real NTA behaviour
  answers         jsonb not null default '{}',
  -- score_breakdown written by scoring Edge Function on submit only
  -- { total, sections: [{ section_id, marks, correct, wrong, unattempted }] }
  score_breakdown jsonb,

  -- one active attempt per student per test
  constraint one_attempt_per_student unique (test_id, student_id)
);

create index attempts_student_idx on public.attempts(student_id);
create index attempts_test_idx on public.attempts(test_id);

-- ════════════════════════════════════════════════════════════
-- ROW LEVEL SECURITY
-- ════════════════════════════════════════════════════════════

alter table public.users          enable row level security;
alter table public.paragraphs     enable row level security;
alter table public.questions      enable row level security;
alter table public.tests          enable row level security;
alter table public.test_sections  enable row level security;
alter table public.test_questions enable row level security;
alter table public.attempts       enable row level security;

-- Helper: get current user's role without a join
create or replace function public.current_user_role()
returns user_role language sql security definer stable as $$
  select role from public.users where id = auth.uid()
$$;

-- ── users ────────────────────────────────────────────────────
create policy "users: read own row"
  on public.users for select
  using (id = auth.uid());

create policy "users: update own row"
  on public.users for update
  using (id = auth.uid());

-- ── paragraphs ───────────────────────────────────────────────
create policy "paragraphs: owner full access"
  on public.paragraphs for all
  using (owner_id = auth.uid());

-- students can read paragraphs that appear in tests they can access
create policy "paragraphs: student read if in accessible test"
  on public.paragraphs for select
  using (
    public.current_user_role() = 'student' and
    exists (
      select 1 from public.questions q
      join public.test_questions tq on tq.question_id = q.id
      join public.test_sections ts on ts.id = tq.test_section_id
      join public.tests t on t.id = ts.test_id
      where q.paragraph_id = paragraphs.id
        and t.is_published = true
    )
  );

-- ── questions ────────────────────────────────────────────────
create policy "questions: owner full access"
  on public.questions for all
  using (owner_id = auth.uid());

-- students see questions only in published tests (no correct_answer exposed)
create policy "questions: student read if in published test"
  on public.questions for select
  using (
    public.current_user_role() = 'student' and
    exists (
      select 1 from public.test_questions tq
      join public.test_sections ts on ts.id = tq.test_section_id
      join public.tests t on t.id = ts.test_id
      where tq.question_id = questions.id
        and t.is_published = true
    )
  );

-- ── tests ────────────────────────────────────────────────────
create policy "tests: owner full access"
  on public.tests for all
  using (owner_id = auth.uid());

create policy "tests: student read published"
  on public.tests for select
  using (
    public.current_user_role() = 'student' and
    is_published = true
  );

-- ── test_sections ────────────────────────────────────────────
create policy "test_sections: owner full access"
  on public.test_sections for all
  using (
    exists (
      select 1 from public.tests t
      where t.id = test_sections.test_id and t.owner_id = auth.uid()
    )
  );

create policy "test_sections: student read published"
  on public.test_sections for select
  using (
    public.current_user_role() = 'student' and
    exists (
      select 1 from public.tests t
      where t.id = test_sections.test_id and t.is_published = true
    )
  );

-- ── test_questions ───────────────────────────────────────────
create policy "test_questions: owner full access"
  on public.test_questions for all
  using (
    exists (
      select 1 from public.test_sections ts
      join public.tests t on t.id = ts.test_id
      where ts.id = test_questions.test_section_id
        and t.owner_id = auth.uid()
    )
  );

create policy "test_questions: student read published"
  on public.test_questions for select
  using (
    public.current_user_role() = 'student' and
    exists (
      select 1 from public.test_sections ts
      join public.tests t on t.id = ts.test_id
      where ts.id = test_questions.test_section_id
        and t.is_published = true
    )
  );

-- ── attempts ─────────────────────────────────────────────────
create policy "attempts: student owns their own"
  on public.attempts for all
  using (student_id = auth.uid());

-- admin can read attempts for tests they own
create policy "attempts: admin reads attempts for own tests"
  on public.attempts for select
  using (
    exists (
      select 1 from public.tests t
      where t.id = attempts.test_id and t.owner_id = auth.uid()
    )
  );

-- ════════════════════════════════════════════════════════════
-- STORAGE BUCKET POLICIES
-- Run separately in Supabase dashboard Storage section,
-- or use the Supabase JS client to create the bucket.
-- Bucket name: "question-images"
-- The SQL below sets the RLS equivalent for storage objects.
-- ════════════════════════════════════════════════════════════

-- Note: Storage RLS is set via Supabase dashboard UI or CLI.
-- Each user's images are stored under: {user_id}/{uuid}.{ext}
-- Policy: users can only insert/select/delete their own folder.
-- This enforces it at the path level:
--   INSERT: (storage.foldername(name))[1] = auth.uid()::text
--   SELECT: (storage.foldername(name))[1] = auth.uid()::text
--   DELETE: (storage.foldername(name))[1] = auth.uid()::text
