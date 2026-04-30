-- ============================================================
-- Migration 007 — ELO & Matchmaking Foundation
-- Run AFTER 006_social_layer.sql
-- ============================================================
-- Lays the schema for Clash Royale / Chess.com style
-- head-to-head question blitz matchups with ELO rankings.
-- The match UI and real-time logic comes later —
-- this just ensures the data model is right from the start.
-- ============================================================

-- ── ELO ON USERS ─────────────────────────────────────────────
-- Single ELO per user across all matchups.
-- 1200 is the standard starting ELO (Chess.com default).
-- peak_elo tracked separately — it never goes down.

alter table public.users
  add column elo          integer not null default 1200,
  add column peak_elo     integer not null default 1200,
  add column match_count  integer not null default 0,
  add column match_wins   integer not null default 0;

create index users_elo_idx on public.users(elo desc);

-- ── MATCH TYPE ───────────────────────────────────────────────
-- Extensible for future game modes.
-- 'blitz'   = rapid-fire questions, first to N correct wins
-- 'chapter' = chapter-locked blitz (questions from one chapter)
-- 'subject' = subject-locked blitz

create type match_type as enum ('blitz', 'chapter', 'subject');

create type match_status as enum (
  'waiting',    -- created, waiting for opponent to join
  'active',     -- both players in, clock running
  'completed',  -- finished naturally
  'abandoned'   -- one player disconnected / timed out
);

create type match_result as enum (
  'player_one_win',
  'player_two_win',
  'draw'
);

-- ── MATCHES ──────────────────────────────────────────────────
-- One row per match. Both players, questions used, outcome, ELO delta.

create table public.matches (
  id              uuid primary key default gen_random_uuid(),

  -- Players
  player_one_id   uuid not null references public.users(id) on delete cascade,
  player_two_id   uuid references public.users(id) on delete set null,
  -- player_two_id is null while status = 'waiting' (open challenge)

  -- Match config
  type            match_type not null default 'blitz',
  chapter_id      uuid references public.chapters(id) on delete set null,
  -- chapter_id set when type = 'chapter'
  subject_id      uuid references public.subjects(id) on delete set null,
  -- subject_id set when type = 'subject'
  question_count  integer not null default 10,
  time_limit_secs integer not null default 300,
  -- 5 minutes default, configurable per match

  -- State
  status          match_status not null default 'waiting',
  result          match_result,

  -- Scores
  player_one_score integer not null default 0,
  player_two_score integer not null default 0,

  -- ELO deltas (recorded at match end, never changes after)
  player_one_elo_before integer,
  player_two_elo_before integer,
  player_one_elo_delta  integer,
  player_two_elo_delta  integer,

  -- Timing
  created_at      timestamptz not null default now(),
  started_at      timestamptz,
  completed_at    timestamptz,

  -- Invite system: challenge a specific person or open matchmaking
  invited_id      uuid references public.users(id) on delete set null
  -- invited_id = null means open matchmaking queue
  -- invited_id = specific user means direct challenge
);

alter table public.matches enable row level security;

create policy "matches: players and public can read"
  on public.matches for select
  using (auth.uid() is not null);

create policy "matches: player one creates"
  on public.matches for insert
  with check (player_one_id = auth.uid());

create policy "matches: players can update their own match"
  on public.matches for update
  using (
    player_one_id = auth.uid() or
    player_two_id = auth.uid()
  );

create index matches_player_one_idx  on public.matches(player_one_id);
create index matches_player_two_idx  on public.matches(player_two_id);
create index matches_status_idx      on public.matches(status)
  where status in ('waiting', 'active');
create index matches_created_idx     on public.matches(created_at desc);
create index matches_elo_idx         on public.matches(player_one_elo_before, player_two_elo_before);

-- ── MATCH ANSWERS ────────────────────────────────────────────
-- Each player's answer to each question in a match.
-- answered_at used to break ties (faster correct answer wins the question).

create table public.match_answers (
  id          uuid primary key default gen_random_uuid(),
  match_id    uuid not null references public.matches(id) on delete cascade,
  user_id     uuid not null references public.users(id) on delete cascade,
  question_id uuid not null references public.questions(id) on delete cascade,
  answer      jsonb not null,
  is_correct  boolean not null,
  answered_at timestamptz not null default now(),
  unique (match_id, user_id, question_id)
);

alter table public.match_answers enable row level security;

create policy "match_answers: players can read own match answers"
  on public.match_answers for select
  using (
    auth.uid() = user_id or
    exists (
      select 1 from public.matches m
      where m.id = match_answers.match_id
        and (m.player_one_id = auth.uid() or m.player_two_id = auth.uid())
    )
  );

create policy "match_answers: players insert own answers"
  on public.match_answers for insert
  with check (user_id = auth.uid());

create index match_answers_match_idx    on public.match_answers(match_id);
create index match_answers_user_idx     on public.match_answers(match_id, user_id);
create index match_answers_correct_idx  on public.match_answers(match_id, is_correct);

-- ── ELO HISTORY ──────────────────────────────────────────────
-- Full audit trail of every ELO change.
-- Enables rating graphs over time on creator profiles.

create table public.elo_history (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.users(id) on delete cascade,
  match_id    uuid not null references public.matches(id) on delete cascade,
  elo_before  integer not null,
  elo_after   integer not null,
  delta       integer not null,
  recorded_at timestamptz not null default now()
);

alter table public.elo_history enable row level security;

create policy "elo_history: public read"
  on public.elo_history for select
  using (auth.uid() is not null);

create policy "elo_history: system insert only"
  on public.elo_history for insert
  with check (false);
  -- ELO history is only written by server-side logic (service role).
  -- Never directly by clients.

create index elo_history_user_idx  on public.elo_history(user_id, recorded_at desc);
create index elo_history_match_idx on public.elo_history(match_id);

-- ── MATCHMAKING QUEUE ────────────────────────────────────────
-- Open matchmaking: players waiting for an opponent.
-- Matched by closest ELO within expanding search window.
-- Row is deleted once a match is found.

create table public.matchmaking_queue (
  user_id       uuid primary key references public.users(id) on delete cascade,
  elo           integer not null,
  type          match_type not null default 'blitz',
  chapter_id    uuid references public.chapters(id) on delete cascade,
  subject_id    uuid references public.subjects(id) on delete cascade,
  queued_at     timestamptz not null default now()
);

alter table public.matchmaking_queue enable row level security;

create policy "matchmaking_queue: own row full access"
  on public.matchmaking_queue for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Server-side matchmaking reads queue (service role bypasses RLS).

create index matchmaking_queue_elo_idx  on public.matchmaking_queue(elo);
create index matchmaking_queue_type_idx on public.matchmaking_queue(type, queued_at);

-- ── NOTIFICATION TYPES UPDATE ────────────────────────────────
-- Add match-related notification types to the enum.
-- Postgres requires recreating the type if it has dependents,
-- so we use ALTER TYPE ADD VALUE instead.

alter type notification_type add value 'match_challenge_received';
alter type notification_type add value 'match_started';
alter type notification_type add value 'match_completed';
alter type notification_type add value 'elo_milestone';
-- e.g. "You hit 1400 ELO. Jeelo is scared of you."
