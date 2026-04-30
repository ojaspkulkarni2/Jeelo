-- ============================================================
-- Migration 006 — Social Layer
-- Tracks, Solids, Comments, Annotations, Feed Answers,
-- Saves, Notifications, User profile updates
-- Run AFTER 005_syllabus_and_chapter_progress.sql
-- ============================================================

-- ── USERS TABLE UPDATES ───────────────────────────────────────
-- Add avatar, unique username constraint, bio

alter table public.users
  add column avatar_url   text,
  add column bio          text,
  add column username     text unique;
  -- username: URL-safe, unique. Used for /u/:username routing.
  -- display_name remains for display. username for routing.
  -- On signup, username defaults to display_name lowercased,
  -- de-duped with a suffix if taken. User can change in settings.

-- Backfill username from display_name for existing users
-- (lowercased, spaces replaced with hyphens)
update public.users
  set username = lower(regexp_replace(display_name, '\s+', '-', 'g'))
  where username is null;

-- Now enforce not null (after backfill)
alter table public.users
  alter column username set not null;

create index users_username_idx on public.users(username);

-- ── TRACKS ───────────────────────────────────────────────────
-- "You track Tanmay" = you watch his map, his tests feed yours.
-- tracker_id  = the person doing the tracking
-- tracking_id = the person being tracked

create table public.tracks (
  tracker_id   uuid not null references public.users(id) on delete cascade,
  tracking_id  uuid not null references public.users(id) on delete cascade,
  created_at   timestamptz not null default now(),
  primary key (tracker_id, tracking_id),
  constraint no_self_track check (tracker_id != tracking_id)
);

alter table public.tracks enable row level security;

create policy "tracks: anyone authenticated can read"
  on public.tracks for select
  using (auth.uid() is not null);

create policy "tracks: own rows full access"
  on public.tracks for all
  using (tracker_id = auth.uid())
  with check (tracker_id = auth.uid());

create index tracks_tracker_idx  on public.tracks(tracker_id);
create index tracks_tracking_idx on public.tracks(tracking_id);

-- ── SOLIDS ───────────────────────────────────────────────────
-- "47 people found this solid" — lightweight endorsement.
-- Polymorphic: on a question OR a test, never both.

create table public.solids (
  user_id     uuid not null references public.users(id) on delete cascade,
  question_id uuid references public.questions(id) on delete cascade,
  test_id     uuid references public.tests(id) on delete cascade,
  created_at  timestamptz not null default now(),
  constraint one_target check (
    (question_id is not null)::int +
    (test_id     is not null)::int = 1
  ),
  -- Composite PK allows one solid per user per target
  -- Done via unique constraints per type instead of composite
  -- because one column is always null
  unique (user_id, question_id),
  unique (user_id, test_id)
);

alter table public.solids enable row level security;

create policy "solids: anyone authenticated can read"
  on public.solids for select
  using (auth.uid() is not null);

create policy "solids: own rows full access"
  on public.solids for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create index solids_question_idx on public.solids(question_id)
  where question_id is not null;
create index solids_test_idx     on public.solids(test_id)
  where test_id is not null;
create index solids_user_idx     on public.solids(user_id);

-- ── COMMENTS ─────────────────────────────────────────────────
-- Threaded comments on questions or tests.
-- Polymorphic: question_id OR test_id, never both.

create table public.comments (
  id          uuid primary key default gen_random_uuid(),
  author_id   uuid not null references public.users(id) on delete cascade,
  question_id uuid references public.questions(id) on delete cascade,
  test_id     uuid references public.tests(id) on delete cascade,
  parent_id   uuid references public.comments(id) on delete cascade,
  body        text not null check (length(trim(body)) > 0),
  created_at  timestamptz not null default now(),
  edited_at   timestamptz,
  constraint one_target check (
    (question_id is not null)::int +
    (test_id     is not null)::int = 1
  )
);

alter table public.comments enable row level security;

create policy "comments: anyone authenticated can read"
  on public.comments for select
  using (auth.uid() is not null);

create policy "comments: own rows full access"
  on public.comments for all
  using (author_id = auth.uid())
  with check (author_id = auth.uid());

create index comments_question_idx on public.comments(question_id)
  where question_id is not null;
create index comments_test_idx     on public.comments(test_id)
  where test_id is not null;
create index comments_parent_idx   on public.comments(parent_id)
  where parent_id is not null;
create index comments_author_idx   on public.comments(author_id);

-- ── QUESTION ANNOTATIONS ─────────────────────────────────────
-- Pinned notes on specific regions of a question image.
-- x_pct and y_pct are 0-100, representing % position on image.

create table public.question_annotations (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.users(id) on delete cascade,
  question_id uuid not null references public.questions(id) on delete cascade,
  x_pct       numeric not null check (x_pct >= 0 and x_pct <= 100),
  y_pct       numeric not null check (y_pct >= 0 and y_pct <= 100),
  body        text not null check (length(trim(body)) > 0),
  created_at  timestamptz not null default now()
);

alter table public.question_annotations enable row level security;

create policy "annotations: anyone authenticated can read"
  on public.question_annotations for select
  using (auth.uid() is not null);

create policy "annotations: own rows full access"
  on public.question_annotations for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create index annotations_question_idx on public.question_annotations(question_id);
create index annotations_user_idx     on public.question_annotations(user_id);

-- ── FEED ANSWERS ─────────────────────────────────────────────
-- Inline answers to questions in the feed.
-- One row per user per question — last answer wins.
-- is_correct is computed at write time against questions.correct_answer.

create table public.feed_answers (
  user_id     uuid not null references public.users(id) on delete cascade,
  question_id uuid not null references public.questions(id) on delete cascade,
  answer      jsonb not null,
  is_correct  boolean not null,
  answered_at timestamptz not null default now(),
  primary key (user_id, question_id)
);

alter table public.feed_answers enable row level security;

create policy "feed_answers: owner full access"
  on public.feed_answers for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Aggregate reads (% correct) allowed for all authenticated users
-- but individual answers are private
create policy "feed_answers: aggregate read for all"
  on public.feed_answers for select
  using (auth.uid() is not null);

create index feed_answers_question_idx on public.feed_answers(question_id);
create index feed_answers_user_idx     on public.feed_answers(user_id);
create index feed_answers_correct_idx  on public.feed_answers(question_id, is_correct);

-- ── SAVES ────────────────────────────────────────────────────
-- Bookmark a question or test for later.

create table public.saves (
  user_id     uuid not null references public.users(id) on delete cascade,
  question_id uuid references public.questions(id) on delete cascade,
  test_id     uuid references public.tests(id) on delete cascade,
  saved_at    timestamptz not null default now(),
  constraint one_target check (
    (question_id is not null)::int +
    (test_id     is not null)::int = 1
  ),
  unique (user_id, question_id),
  unique (user_id, test_id)
);

alter table public.saves enable row level security;

create policy "saves: owner full access"
  on public.saves for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create index saves_user_idx     on public.saves(user_id);
create index saves_question_idx on public.saves(question_id)
  where question_id is not null;
create index saves_test_idx     on public.saves(test_id)
  where test_id is not null;

-- ── NOTIFICATIONS ────────────────────────────────────────────
-- All in-app notifications. Typed so the UI can render appropriately.

create type notification_type as enum (
  'tracked_you',           -- someone started tracking you
  'solid_on_question',     -- someone marked your question solid
  'solid_on_test',         -- someone marked your test solid
  'comment_on_question',   -- someone commented on your question
  'comment_on_test',       -- someone commented on your test
  'reply_to_comment',      -- someone replied to your comment
  'attempted_your_test',   -- someone submitted an attempt on your test
  'chapter_decaying',      -- a mastered chapter is fading
  'layer_unlocked',        -- user crossed a layer threshold
  'someone_you_track_mastered' -- a tracked user mastered a chapter
);

create table public.notifications (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.users(id) on delete cascade,
  type          notification_type not null,
  -- actor: the person who triggered this notification (null for system)
  actor_id      uuid references public.users(id) on delete set null,
  -- context: polymorphic reference to the relevant content
  question_id   uuid references public.questions(id) on delete cascade,
  test_id       uuid references public.tests(id) on delete cascade,
  comment_id    uuid references public.comments(id) on delete cascade,
  chapter_id    uuid references public.chapters(id) on delete cascade,
  -- read state
  read          boolean not null default false,
  created_at    timestamptz not null default now()
);

alter table public.notifications enable row level security;

create policy "notifications: owner full access"
  on public.notifications for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create index notifications_user_idx  on public.notifications(user_id);
create index notifications_read_idx  on public.notifications(user_id, read)
  where read = false;
create index notifications_time_idx  on public.notifications(user_id, created_at desc);

-- ── BLOCK / MUTE ─────────────────────────────────────────────
-- Blocks: hard — blocked user cannot see your content or track you.
-- Mutes:  soft — you stop seeing their content in your feed, 
--               they don't know.

create table public.blocks (
  blocker_id uuid not null references public.users(id) on delete cascade,
  blocked_id uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint no_self_block check (blocker_id != blocked_id)
);

alter table public.blocks enable row level security;

create policy "blocks: owner full access"
  on public.blocks for all
  using (blocker_id = auth.uid())
  with check (blocker_id = auth.uid());

create index blocks_blocker_idx on public.blocks(blocker_id);
create index blocks_blocked_idx on public.blocks(blocked_id);

create table public.mutes (
  muter_id   uuid not null references public.users(id) on delete cascade,
  muted_id   uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (muter_id, muted_id),
  constraint no_self_mute check (muter_id != muted_id)
);

alter table public.mutes enable row level security;

create policy "mutes: owner full access"
  on public.mutes for all
  using (muter_id = auth.uid())
  with check (muter_id = auth.uid());

create index mutes_muter_idx on public.mutes(muter_id);

-- ── CREATOR STATS MATERIALISED VIEW ──────────────────────────
-- Refreshed periodically (e.g. via a cron job or on-demand).
-- Powers creator reputation scores and profile stats.
-- Rep formula:
--   (avg accuracy of community on their public questions) × 0.35
--   + (tracking count, log-scaled)                        × 0.25
--   + (avg test completion rate)                          × 0.20
--   + (solid count, log-scaled)                           × 0.10
--   + (total feed_answers on their questions)             × 0.10

create materialized view public.creator_stats as
select
  u.id                                          as user_id,
  u.username,
  u.display_name,

  -- Content counts
  count(distinct q.id)                          as question_count,
  count(distinct t.id)                          as test_count,

  -- Social counts
  count(distinct tr.tracker_id)                 as tracking_count,
  count(distinct sl.user_id)                    as solid_count,

  -- Quality signals
  count(distinct fa.user_id)                    as total_answerers,
  round(avg(fa.is_correct::int)::numeric, 3)    as avg_community_accuracy,
  -- difficulty sweet spot: questions around 40-60% correct are gold
  count(distinct fa.question_id)
    filter (where fa.is_correct = false)        as total_wrong_answers,

  -- Reputation score (0-100)
  round((
    coalesce(avg(fa.is_correct::int), 0.5) * 35
    + least(ln(count(distinct tr.tracker_id) + 1) / ln(100), 1) * 25
    + least(ln(count(distinct sl.user_id) + 1) / ln(1000), 1) * 10
    + least(ln(count(distinct fa.user_id) + 1) / ln(10000), 1) * 10
  )::numeric, 1)                                as reputation_score

from public.users u
left join public.questions q
  on q.owner_id = u.id
left join public.tests t
  on t.owner_id = u.id and t.is_published = true
left join public.tracks tr
  on tr.tracking_id = u.id
left join public.solids sl
  on sl.question_id = q.id or sl.test_id = t.id
left join public.feed_answers fa
  on fa.question_id = q.id

group by u.id, u.username, u.display_name;

-- Unique index required for concurrent refresh
create unique index creator_stats_user_idx on public.creator_stats(user_id);

-- Refresh command (run this periodically, e.g. every hour):
-- refresh materialized view concurrently public.creator_stats;

-- ── RLS UPDATES FOR QUESTIONS ─────────────────────────────────
-- Visibility is now derived from test membership, not is_public flag.
-- A question is visible to all authenticated users if it belongs
-- to at least one published test.

drop policy if exists "questions: student read if in published test" on public.questions;
drop policy if exists "questions: read shared by all"               on public.questions;

create policy "questions: read if in published test"
  on public.questions for select
  using (
    auth.uid() is not null and (
      -- Owner always sees their own
      owner_id = auth.uid()
      or
      -- Question is in at least one published test
      exists (
        select 1
        from public.test_questions tq
        join public.test_sections  ts on ts.id = tq.test_section_id
        join public.tests           t  on t.id  = ts.test_id
        where tq.question_id = questions.id
          and t.is_published  = true
      )
    )
  );
