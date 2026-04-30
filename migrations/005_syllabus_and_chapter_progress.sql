-- ============================================================
-- Migration 005 — Syllabus Structure & Chapter Progress
-- Run AFTER 004_add_exam_type_to_tests.sql
-- ============================================================

-- ── SUBJECTS ─────────────────────────────────────────────────

create table public.subjects (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  slug          text not null unique,
  display_order integer not null
);

alter table public.subjects enable row level security;

create policy "subjects: public read"
  on public.subjects for select using (true);

-- ── CHAPTERS ─────────────────────────────────────────────────

create table public.chapters (
  id            uuid primary key default gen_random_uuid(),
  subject_id    uuid not null references public.subjects(id) on delete cascade,
  name          text not null,
  slug          text not null unique,
  display_order integer not null
);

alter table public.chapters enable row level security;

create policy "chapters: public read"
  on public.chapters for select using (true);

create index chapters_subject_idx on public.chapters(subject_id);

-- ── CHAPTER PROGRESS ─────────────────────────────────────────
-- One row per user per chapter. Tracks all five layer states.

create table public.chapter_progress (
  user_id               uuid not null references public.users(id) on delete cascade,
  chapter_id            uuid not null references public.chapters(id) on delete cascade,

  -- Layer 1: Theory (self-reported)
  theory_done           boolean not null default false,
  theory_done_at        timestamptz,

  -- Layer 2: Own questions (auto — accuracy threshold on own library questions)
  own_questions_done    boolean not null default false,
  own_questions_done_at timestamptz,

  -- Layer 3: Curated questions (auto — accuracy threshold on community questions)
  curated_done          boolean not null default false,
  curated_done_at       timestamptz,

  -- Layer 4: Practice test (auto — any attempt submission for this chapter)
  practice_done         boolean not null default false,
  practice_done_at      timestamptz,

  -- Layer 5: Layered test (auto — layered test cleared for this chapter)
  mastered              boolean not null default false,
  mastered_at           timestamptz,

  -- For decay calculation
  last_activity         timestamptz not null default now(),

  primary key (user_id, chapter_id)
);

alter table public.chapter_progress enable row level security;

create policy "chapter_progress: owner full access"
  on public.chapter_progress for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Anyone tracking a user can read their chapter progress
-- (layer states only — no scores exposed here)
create policy "chapter_progress: trackers can read"
  on public.chapter_progress for select
  using (
    auth.uid() is not null and
    exists (
      select 1 from public.tracks t
      where t.tracker_id = auth.uid()
        and t.tracking_id = chapter_progress.user_id
    )
  );

create index chapter_progress_user_idx    on public.chapter_progress(user_id);
create index chapter_progress_chapter_idx on public.chapter_progress(chapter_id);
create index chapter_progress_mastered_idx on public.chapter_progress(mastered)
  where mastered = true;

-- ── QUESTIONS TABLE UPDATES ───────────────────────────────────
-- Replace free-text chapter with FK to chapters table.
-- Add source field for past paper attribution.
-- Remove is_public — visibility derived from test instead.

alter table public.questions
  add column chapter_id  uuid references public.chapters(id) on delete set null,
  add column source       text;
  -- source examples:
  -- null              = original question by the creator
  -- 'JEE Advanced 2019 Paper 2 Q7'
  -- 'JEE Main Jan 2023 S1 Q14'
  -- Community tags a source; original creator gets no rep for sourced questions

-- NOTE: After running this migration, backfill chapter_id from the
-- existing free-text chapter column using a one-time UPDATE.
-- Once backfilled and verified, drop the old column:
--   alter table public.questions drop column chapter;
-- This is intentionally left as a manual step to protect existing data.

create index questions_chapter_idx on public.questions(chapter_id);

-- ── TESTS TABLE UPDATES ───────────────────────────────────────

alter table public.tests
  add column is_layered  boolean not null default false,
  add column chapter_id  uuid references public.chapters(id) on delete set null;
  -- chapter_id on tests: set when the test is specifically for one chapter
  -- (used for Layer 4/5 crediting on chapter_progress)

create index tests_chapter_idx on public.tests(chapter_id);

-- ── ATTEMPTS TABLE UPDATES ────────────────────────────────────

alter table public.attempts
  add column chapter_id uuid references public.chapters(id) on delete set null;
  -- Denormalised from tests.chapter_id at attempt creation time
  -- for efficient layer crediting queries

-- ── SEED: SUBJECTS ───────────────────────────────────────────

insert into public.subjects (name, slug, display_order) values
  ('Physics',     'physics',     1),
  ('Chemistry',   'chemistry',   2),
  ('Mathematics', 'mathematics', 3);

-- ── SEED: CHAPTERS ───────────────────────────────────────────
-- Full JEE Advanced syllabus. Slugs are kebab-case, globally unique.

-- PHYSICS (20 chapters)
insert into public.chapters (subject_id, name, slug, display_order)
select s.id, c.name, c.slug, c.ord
from public.subjects s
cross join (values
  ('Kinematics',                          'kinematics',                    1),
  ('Laws of Motion',                      'laws-of-motion',                2),
  ('Work, Energy and Power',              'work-energy-power',             3),
  ('Rotational Motion',                   'rotational-motion',             4),
  ('Gravitation',                         'gravitation',                   5),
  ('Properties of Matter',               'properties-of-matter',          6),
  ('Thermodynamics',                      'thermodynamics',                7),
  ('Kinetic Theory of Gases',             'kinetic-theory-of-gases',       8),
  ('Simple Harmonic Motion',              'simple-harmonic-motion',        9),
  ('Waves',                               'waves',                        10),
  ('Electrostatics',                      'electrostatics',               11),
  ('Current Electricity',                 'current-electricity',          12),
  ('Magnetic Effects of Current',         'magnetic-effects-of-current',  13),
  ('Electromagnetic Induction',           'electromagnetic-induction',    14),
  ('Alternating Current',                 'alternating-current',          15),
  ('Electromagnetic Waves',               'electromagnetic-waves',        16),
  ('Ray Optics',                          'ray-optics',                   17),
  ('Wave Optics',                         'wave-optics',                  18),
  ('Modern Physics',                      'modern-physics',               19),
  ('Semiconductors',                      'semiconductors',               20)
) as c(name, slug, ord)
where s.slug = 'physics';

-- CHEMISTRY (28 chapters)
insert into public.chapters (subject_id, name, slug, display_order)
select s.id, c.name, c.slug, c.ord
from public.subjects s
cross join (values
  ('Mole Concept',                        'mole-concept',                  1),
  ('Atomic Structure',                    'atomic-structure',              2),
  ('Chemical Bonding',                    'chemical-bonding',              3),
  ('States of Matter',                    'states-of-matter',              4),
  ('Thermodynamics (Chem)',               'thermodynamics-chem',           5),
  ('Equilibrium',                         'equilibrium',                   6),
  ('Redox Reactions',                     'redox-reactions',               7),
  ('Electrochemistry',                    'electrochemistry',              8),
  ('Chemical Kinetics',                   'chemical-kinetics',             9),
  ('Surface Chemistry',                   'surface-chemistry',            10),
  ('Periodic Table',                      'periodic-table',               11),
  ('Hydrogen and s-Block',               'hydrogen-s-block',              12),
  ('p-Block Elements',                    'p-block-elements',             13),
  ('d and f-Block Elements',              'd-f-block-elements',           14),
  ('Coordination Compounds',              'coordination-compounds',       15),
  ('Metallurgy',                          'metallurgy',                   16),
  ('Qualitative Analysis',               'qualitative-analysis',          17),
  ('General Organic Chemistry',           'general-organic-chemistry',    18),
  ('Hydrocarbons',                        'hydrocarbons',                 19),
  ('Haloalkanes and Haloarenes',          'haloalkanes-haloarenes',       20),
  ('Alcohols, Phenols and Ethers',        'alcohols-phenols-ethers',      21),
  ('Aldehydes and Ketones',              'aldehydes-ketones',             22),
  ('Carboxylic Acids',                    'carboxylic-acids',             23),
  ('Amines',                              'amines',                       24),
  ('Biomolecules',                        'biomolecules',                 25),
  ('Polymers',                            'polymers',                     26),
  ('Chemistry in Everyday Life',          'chemistry-everyday-life',      27),
  ('Environmental Chemistry',             'environmental-chemistry',      28)
) as c(name, slug, ord)
where s.slug = 'chemistry';

-- MATHEMATICS (18 chapters)
insert into public.chapters (subject_id, name, slug, display_order)
select s.id, c.name, c.slug, c.ord
from public.subjects s
cross join (values
  ('Sets, Relations and Functions',       'sets-relations-functions',      1),
  ('Complex Numbers',                     'complex-numbers',               2),
  ('Matrices and Determinants',           'matrices-determinants',         3),
  ('Quadratic Equations',                 'quadratic-equations',           4),
  ('Sequences and Series',               'sequences-series',               5),
  ('Permutations and Combinations',       'permutations-combinations',     6),
  ('Binomial Theorem',                    'binomial-theorem',              7),
  ('Trigonometry',                        'trigonometry',                  8),
  ('Inverse Trigonometry',               'inverse-trigonometry',           9),
  ('Straight Lines and Circles',          'straight-lines-circles',       10),
  ('Conic Sections',                      'conic-sections',               11),
  ('3D Geometry',                         '3d-geometry',                  12),
  ('Vectors',                             'vectors',                      13),
  ('Limits, Continuity and Differentiability', 'limits-continuity-differentiability', 14),
  ('Application of Derivatives',          'application-of-derivatives',   15),
  ('Integrals',                           'integrals',                    16),
  ('Differential Equations',              'differential-equations',       17),
  ('Probability',                         'probability',                  18)
) as c(name, slug, ord)
where s.slug = 'mathematics';
