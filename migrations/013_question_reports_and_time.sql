-- ── Question reports ──────────────────────────────────────────
create table if not exists public.question_reports (
  id           uuid primary key default gen_random_uuid(),
  question_id  uuid not null references public.questions(id) on delete cascade,
  reporter_id  uuid not null references public.users(id) on delete cascade,
  reason       text not null check (reason in (
    'error_in_question',
    'bad_image',
    'wrong_answer_key',
    'repeated_question',
    'other'
  )),
  note         text,
  created_at   timestamptz not null default now(),
  unique (question_id, reporter_id)
);

alter table public.question_reports enable row level security;

create policy "question_reports: owner full access"
  on public.question_reports for all
  using (reporter_id = auth.uid());

create policy "question_reports: authenticated can insert"
  on public.question_reports for insert
  with check (reporter_id = auth.uid());

create policy "question_reports: anyone can read"
  on public.question_reports for select
  using (auth.uid() is not null);

create index question_reports_question_idx on public.question_reports(question_id);

-- ── Time tracking on feed_answers ────────────────────────────
alter table public.feed_answers
  add column if not exists time_taken_secs integer;
