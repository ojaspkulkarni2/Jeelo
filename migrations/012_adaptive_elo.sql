-- ── Migration 012 — Adaptive ELO & JEE-accurate marks ──────────
-- Adds attempted/actual marks columns to arena_matches so the
-- result screen can always derive raw vs actual without re-scoring.

alter table arena_matches
  add column if not exists player_attempted  integer,    -- questions answered (not just correct)
  add column if not exists player_raw_marks  integer,    -- player_attempted * 4  (optimistic)
  add column if not exists player_actual_marks integer;  -- correct*4 - wrong*1   (real JEE score)

-- Back-fill from existing rows where player_answers is stored:
-- player_attempted = count of non-null values in player_answers jsonb
-- (best-effort; can't know wrong vs skipped without correct_answer)
update arena_matches
   set player_attempted   = (select count(*) from jsonb_each_text(player_answers) where value is not null),
       player_raw_marks   = player_correct * 4 + (
                              (select count(*) from jsonb_each_text(player_answers) where value is not null)
                              - player_correct) * 4,   -- all attempted as if correct (raw)
       player_actual_marks = player_correct * 4 - (
                              (select count(*) from jsonb_each_text(player_answers) where value is not null)
                              - player_correct) * 1    -- JEE: +4 correct, -1 wrong
 where player_answers is not null
   and player_correct is not null;
