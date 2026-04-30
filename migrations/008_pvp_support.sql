-- ── 008b_pvp_support.sql ─────────────────────────────────────
-- Run this AFTER arena_migration.sql (008).
-- Adds the columns and RPC needed for the real PvP arena flow.

-- 1. Add arena-specific columns to the matches table
alter table public.matches
  add column if not exists arena_mode          text check (arena_mode in ('bullet','blitz','rapid')),
  add column if not exists questions           jsonb,
  add column if not exists player_one_elo_before integer,
  add column if not exists player_two_elo_before integer,
  add column if not exists player_one_elo_delta  integer,
  add column if not exists player_two_elo_delta  integer,
  add column if not exists time_limit_secs     integer;

-- 2. ELO column on users (if not already added by 007)
alter table public.users
  add column if not exists elo integer not null default 1200;

-- 3. match_answers table (player answers for PvP matches)
create table if not exists public.match_answers (
  id          uuid primary key default gen_random_uuid(),
  match_id    uuid not null references public.matches(id) on delete cascade,
  user_id     uuid not null references public.users(id)  on delete cascade,
  question_id uuid not null,
  answer      text[],
  is_correct  boolean not null default false,
  answered_at timestamptz not null default now(),
  unique (match_id, user_id, question_id)
);

alter table public.match_answers enable row level security;

create policy "match_answers: players can read own match"
  on public.match_answers for select
  using (
    auth.uid() = user_id or
    exists (
      select 1 from public.matches m
      where m.id = match_id
        and (m.player_one_id = auth.uid() or m.player_two_id = auth.uid())
    )
  );

create policy "match_answers: players can insert own answers"
  on public.match_answers for insert
  with check (auth.uid() = user_id);

-- 4. RPC to atomically increment a user's ELO
create or replace function public.increment_user_elo(uid uuid, delta integer)
returns void
language sql
security definer
as $$
  update public.users
     set elo = elo + delta
   where id = uid;
$$;
