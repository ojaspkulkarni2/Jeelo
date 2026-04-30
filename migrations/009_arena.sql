-- ── Migration 008 — Arena (Duels) ──────────────────────────────
-- Run this after migrations 005–007.

-- Per-user ELO ratings and career stats, one row per user
create table if not exists arena_ratings (
  user_id          uuid primary key references users(id) on delete cascade,
  -- ELO per mode (start at 1200, can't go below 100)
  bullet_elo       integer not null default 1200,
  blitz_elo        integer not null default 1200,
  rapid_elo        integer not null default 1200,
  -- Games played per mode
  bullet_games     integer not null default 0,
  blitz_games      integer not null default 0,
  rapid_games      integer not null default 0,
  -- Career marks stats (all modes combined)
  -- total_marks = sum of (correct_answers * 4) across all matches
  -- total_time_hours = sum of match durations
  -- career marks/hour = total_marks / total_time_hours (computed on read)
  total_marks      numeric not null default 0,
  total_time_hours numeric not null default 0,
  updated_at       timestamptz default now()
);

-- One row per duel (always vs bot for now; real matchmaking later)
create table if not exists arena_matches (
  id              uuid primary key default gen_random_uuid(),
  player_id       uuid not null references users(id) on delete cascade,
  mode            text not null check (mode in ('bullet', 'blitz', 'rapid')),
  -- Bot info
  bot_name        text not null,
  bot_elo         integer not null,
  bot_accuracy    numeric not null,  -- 0.0–1.0
  -- Questions: [{id, image_url, correct_answer}]
  -- correct_answer stored as the letter string 'A'|'B'|'C'|'D'
  questions       jsonb not null,
  -- Bot answers pre-seeded at match creation: {question_id: 'A'|'B'|'C'|null}
  -- null means bot didn't attempt that question
  bot_answers     jsonb not null default '{}',
  -- Player answers submitted on finish: {question_id: 'A'|'B'|'C'|'D'}
  player_answers  jsonb,
  -- Scored on submission
  player_correct  integer,
  bot_correct     integer,
  player_elo_before integer,
  player_elo_after  integer,
  -- Timestamps
  started_at      timestamptz not null default now(),
  submitted_at    timestamptz
);

-- Indexes
create index if not exists arena_matches_player_idx on arena_matches(player_id);
create index if not exists arena_matches_started_idx on arena_matches(started_at desc);

-- RLS
alter table arena_ratings enable row level security;
create policy "arena_ratings: owner full access"
  on arena_ratings for all using (user_id = auth.uid());
create policy "arena_ratings: anyone can read"
  on arena_ratings for select using (auth.uid() is not null);

alter table arena_matches enable row level security;
create policy "arena_matches: owner full access"
  on arena_matches for all using (player_id = auth.uid());

-- ── Migration 008b — Arena PvP match columns ──────────────────
-- Required for the matchmaking + PvP flow.
-- Run after 008 (arena_migration.sql).

alter table public.matches
  add column if not exists questions   jsonb,
  add column if not exists arena_mode  text check (arena_mode in ('bullet','blitz','rapid'));
