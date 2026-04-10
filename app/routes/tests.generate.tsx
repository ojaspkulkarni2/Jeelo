import { redirect, data, Link, Form } from "react-router";
import { useState } from "react";
import type { Route } from "./+types/tests.generate";
import { requireUser } from "~/lib/auth.server";
import { createServerClient } from "~/lib/supabase.server";
import { Sidebar } from "~/components/sidebar";
import {
  IconFlash, IconChevronRight, IconX, IconCheck,
} from "~/components/icons";
import type { QuestionType, Subject } from "~/lib/database.types";

// ── Types ──────────────────────────────────────────────────────

type ChapterGroup = {
  subject: Subject;
  chapter: string;
  counts: Partial<Record<QuestionType, number>>;
};

type SectionConfig = {
  id: string;
  subject: Subject | "";
  chapter: string;
  question_type: QuestionType | "";
  count: number;
  marks_correct: number;
  marks_wrong: number;
};

// ── Loader ─────────────────────────────────────────────────────

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const user = await requireUser(request, env);
  const supabase = createServerClient(env);

  // Aggregate available questions by subject + chapter + type
  const { data: qs } = await supabase
    .from("questions")
    .select("subject, chapter, type")
    .eq("owner_id", user.id);

  const map = new Map<string, ChapterGroup>();
  for (const q of qs ?? []) {
    const key = `${q.subject}:::${q.chapter}`;
    if (!map.has(key)) {
      map.set(key, { subject: q.subject as Subject, chapter: q.chapter, counts: {} });
    }
    const g = map.get(key)!;
    g.counts[q.type as QuestionType] = (g.counts[q.type as QuestionType] ?? 0) + 1;
  }

  const chapters = Array.from(map.values()).sort((a, b) =>
    a.subject.localeCompare(b.subject) || a.chapter.localeCompare(b.chapter)
  );

  // User settings for defaults
  const { data: settings } = await supabase
    .from("user_settings")
    .select("default_duration_mins, default_marks_correct, default_marks_wrong")
    .eq("user_id", user.id)
    .maybeSingle();

  return {
    user,
    chapters,
    defaultDuration: settings?.default_duration_mins ?? 180,
    defaultMarksCorrect: settings?.default_marks_correct ?? 4,
    defaultMarksWrong: settings?.default_marks_wrong ?? -1,
  };
}

// ── Action ─────────────────────────────────────────────────────

export async function action({ request, context }: Route.ActionArgs) {
  const env = context.cloudflare.env;
  const user = await requireUser(request, env);
  const supabase = createServerClient(env);
  const formData = await request.formData();

  const title       = String(formData.get("title") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim() || null;
  const durationMins = parseInt(String(formData.get("duration_mins") ?? ""), 10);
  const sectionsRaw  = String(formData.get("sections_json") ?? "[]");

  if (!title) return data({ error: "Title is required" }, { status: 400 });
  if (isNaN(durationMins) || durationMins <= 0)
    return data({ error: "Invalid duration" }, { status: 400 });

  let sectionConfigs: SectionConfig[] = [];
  try { sectionConfigs = JSON.parse(sectionsRaw); } catch {}

  if (sectionConfigs.length === 0)
    return data({ error: "Add at least one section" }, { status: 400 });

  for (const s of sectionConfigs) {
    if (!s.subject || !s.chapter || !s.question_type || s.count < 1)
      return data({ error: "All section fields are required" }, { status: 400 });
  }

  // Create the test
  const { data: test, error: testErr } = await supabase
    .from("tests")
    .insert({
      owner_id: user.id,
      title,
      description,
      duration_mins: durationMins,
      is_published: false,
    })
    .select("id")
    .single();

  if (testErr || !test) return data({ error: "Failed to create test" }, { status: 500 });

  // For each section config, pick random questions and insert
  for (let i = 0; i < sectionConfigs.length; i++) {
    const sc = sectionConfigs[i];

    // Insert section
    const { data: sec, error: secErr } = await supabase
      .from("test_sections")
      .insert({
        test_id: test.id,
        name: `${SUBJECT_META[sc.subject as Subject]?.label} — ${sc.chapter}`,
        question_type: sc.question_type as QuestionType,
        subject: sc.subject as Subject,
        marks_correct: sc.marks_correct,
        marks_wrong: sc.marks_wrong > 0 ? -sc.marks_wrong : sc.marks_wrong,
        marks_partial: null,
        display_order: i + 1,
      })
      .select("id")
      .single();

    if (secErr || !sec) continue;

    // Fetch matching questions (random order via shuffle in JS)
    const { data: qs } = await supabase
      .from("questions")
      .select("id")
      .eq("owner_id", user.id)
      .eq("subject", sc.subject)
      .eq("chapter", sc.chapter)
      .eq("type", sc.question_type);

    const pool = (qs ?? []) as { id: string }[];
    // Shuffle (Fisher-Yates)
    for (let j = pool.length - 1; j > 0; j--) {
      const k = Math.floor(Math.random() * (j + 1));
      [pool[j], pool[k]] = [pool[k], pool[j]];
    }
    const chosen = pool.slice(0, sc.count);

    if (chosen.length > 0) {
      await supabase.from("test_questions").insert(
        chosen.map((q, idx) => ({
          test_section_id: sec.id,
          question_id: q.id,
          display_order: idx + 1,
        }))
      );
    }
  }

  throw redirect(`/tests/${test.id}`);
}

// ── Constants ──────────────────────────────────────────────────

const SUBJECT_META: Record<Subject, { label: string; color: string; bg: string }> = {
  physics:     { label: "Physics",     color: "#1d4ed8", bg: "#dbeafe" },
  chemistry:   { label: "Chemistry",   color: "#15803d", bg: "#dcfce7" },
  mathematics: { label: "Mathematics", color: "#7e22ce", bg: "#f3e8ff" },
};

const TYPE_LABELS: Record<QuestionType, string> = {
  scq:       "Single Correct (SCQ)",
  mcq:       "Multi Correct (MCQ)",
  integer:   "Integer",
  numerical: "Numerical",
  paragraph: "Paragraph",
};

const DEFAULT_MARKS: Record<QuestionType, { correct: number; wrong: number }> = {
  scq:       { correct: 4, wrong: -1 },
  mcq:       { correct: 4, wrong: -2 },
  integer:   { correct: 4, wrong: 0 },
  numerical: { correct: 4, wrong: 0 },
  paragraph: { correct: 3, wrong: -1 },
};

let nextId = 1;
function makeSection(
  defaultCorrect = 4,
  defaultWrong = -1
): SectionConfig {
  return {
    id: String(nextId++),
    subject: "",
    chapter: "",
    question_type: "",
    count: 10,
    marks_correct: defaultCorrect,
    marks_wrong: defaultWrong,
  };
}

// ── Component ──────────────────────────────────────────────────

export default function TestGeneratePage({ loaderData, actionData }: Route.ComponentProps) {
  const { user, chapters, defaultDuration, defaultMarksCorrect, defaultMarksWrong } = loaderData;
  const error = actionData && "error" in actionData ? actionData.error : null;

  const [sections, setSections] = useState<SectionConfig[]>([
    makeSection(defaultMarksCorrect, defaultMarksWrong),
  ]);

  function addSection() {
    setSections((prev) => [...prev, makeSection(defaultMarksCorrect, defaultMarksWrong)]);
  }

  function removeSection(id: string) {
    setSections((prev) => prev.filter((s) => s.id !== id));
  }

  function updateSection(id: string, patch: Partial<SectionConfig>) {
    setSections((prev) =>
      prev.map((s) => {
        if (s.id !== id) return s;
        const updated = { ...s, ...patch };
        // Auto-fill marks when type changes
        if (patch.question_type && patch.question_type !== s.question_type) {
          const def = DEFAULT_MARKS[patch.question_type as QuestionType];
          if (def) {
            updated.marks_correct = def.correct;
            updated.marks_wrong = def.wrong;
          }
        }
        return updated;
      })
    );
  }

  function chaptersFor(subject: Subject | "") {
    if (!subject) return [];
    return chapters.filter((c) => c.subject === subject);
  }

  function typesFor(subject: Subject | "", chapter: string) {
    const g = chapters.find((c) => c.subject === subject && c.chapter === chapter);
    if (!g) return [];
    return (Object.entries(g.counts) as [QuestionType, number][]).filter(([, n]) => n > 0);
  }

  function maxFor(subject: Subject | "", chapter: string, qtype: QuestionType | "") {
    if (!subject || !chapter || !qtype) return 0;
    const g = chapters.find((c) => c.subject === subject && c.chapter === chapter);
    return g?.counts[qtype as QuestionType] ?? 0;
  }

  const totalQ = sections.reduce((s, sec) => s + (sec.count || 0), 0);
  const totalM = sections.reduce(
    (s, sec) => s + sec.marks_correct * (sec.count || 0),
    0
  );

  return (
    <div className="app-layout">
      <Sidebar displayName={user.display_name} />
      <main className="app-main">
        <div style={{ maxWidth: 800, margin: "0 auto", padding: "0 24px 60px" }}>

          {/* ── Header — breadcrumb + title in one stacked div so they
               don't spread sideways across the pg-head flex row ── */}
          <div className="pg-head" style={{ paddingBottom: 0 }}>
            <div>
              <nav className="result-breadcrumb" style={{ marginBottom: 6 }}>
                <Link to="/tests" className="result-breadcrumb-link">My Tests</Link>
                <IconChevronRight size={13} />
                <span>Generate Test</span>
              </nav>
              <h1 className="pg-title" style={{ marginTop: 6 }}>
                <IconFlash size={22} style={{ display: "inline", marginRight: 8, verticalAlign: "middle", color: "var(--c-brand-500)" }} />
                Generate a Test
              </h1>
              <p className="pg-subtitle">
                Pick chapters and question types — we'll randomly select from your question bank.
              </p>
            </div>
          </div>

          {error && (
            <div className="alert-error" style={{ marginBottom: 16 }}>
              {error}
            </div>
          )}

          {chapters.length === 0 ? (
            <div className="lib-empty" style={{ marginTop: 32 }}>
              <div className="lib-empty-icon" style={{ color: "var(--c-brand-400)" }}>
                <IconFlash size={28} />
              </div>
              <p className="lib-empty-title">No questions in your library yet</p>
              <p className="lib-empty-body">
                Upload questions first, then come back to auto-generate a test.
              </p>
              <Link to="/questions/new" className="btn btn-primary">
                Upload questions →
              </Link>
            </div>
          ) : (
            <Form method="post">
              <input
                type="hidden"
                name="sections_json"
                value={JSON.stringify(sections)}
              />

              {/* ── Test basics ── */}
              <div
                style={{
                  background: "var(--c-surface)",
                  border: "1px solid var(--c-border)",
                  borderRadius: "var(--r-lg)",
                  padding: "20px 24px",
                  marginBottom: 14,
                }}
              >
                <p
                  style={{
                    margin: "0 0 14px",
                    fontSize: 13,
                    fontWeight: 600,
                    color: "var(--c-text-2)",
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                  }}
                >
                  Test details
                </p>
                <div className="field" style={{ marginBottom: 12 }}>
                  <label className="label" htmlFor="gen-title">
                    Test title
                  </label>
                  <input
                    id="gen-title"
                    name="title"
                    className="input"
                    placeholder="e.g. JEE Main Mock — Physics + Chemistry"
                    required
                    autoFocus
                  />
                </div>
                <div className="field" style={{ marginBottom: 12 }}>
                  <label className="label" htmlFor="gen-desc">
                    Description{" "}
                    <span style={{ fontWeight: 400, color: "var(--c-text-3)" }}>
                      (optional)
                    </span>
                  </label>
                  <textarea
                    id="gen-desc"
                    name="description"
                    className="input"
                    rows={2}
                    placeholder="Topics covered, difficulty, etc."
                    style={{ resize: "vertical" }}
                  />
                </div>
                <div className="field">
                  <label className="label">Duration</label>
                  <div className="create-test-duration-row">
                    {[60, 90, 120, 180].map((mins) => (
                      <label key={mins} className="create-test-duration-chip">
                        <input
                          type="radio"
                          name="duration_mins"
                          value={mins}
                          defaultChecked={mins === defaultDuration}
                          style={{ display: "none" }}
                        />
                        <span>
                          {mins === 60
                            ? "1h"
                            : mins === 90
                            ? "1h 30m"
                            : mins === 120
                            ? "2h"
                            : "3h"}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>

              {/* ── Sections ── */}
              <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 12 }}>
                {sections.map((sec, idx) => {
                  const availTypes = typesFor(sec.subject, sec.chapter);
                  const maxQ = maxFor(sec.subject, sec.chapter, sec.question_type);
                  const subj = sec.subject ? SUBJECT_META[sec.subject] : null;

                  return (
                    <div
                      key={sec.id}
                      style={{
                        background: "var(--c-surface)",
                        border: "1px solid var(--c-border)",
                        borderRadius: "var(--r-lg)",
                        overflow: "hidden",
                      }}
                    >
                      {/* Section header */}
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 10,
                          padding: "12px 20px",
                          borderBottom: "1px solid var(--c-border)",
                          background: "var(--c-subtle)",
                        }}
                      >
                        <span
                          style={{
                            fontSize: 12,
                            fontWeight: 700,
                            color: "var(--c-text-3)",
                            textTransform: "uppercase",
                            letterSpacing: "0.05em",
                            flex: 1,
                          }}
                        >
                          Section {idx + 1}
                          {subj && (
                            <span
                              style={{
                                marginLeft: 8,
                                fontSize: 10,
                                fontWeight: 700,
                                padding: "1px 6px",
                                borderRadius: 4,
                                background: subj.bg,
                                color: subj.color,
                                textTransform: "none",
                                letterSpacing: 0,
                              }}
                            >
                              {subj.label}
                            </span>
                          )}
                        </span>
                        {sections.length > 1 && (
                          <button
                            type="button"
                            onClick={() => removeSection(sec.id)}
                            style={{
                              background: "none",
                              border: "none",
                              cursor: "pointer",
                              color: "var(--c-text-3)",
                              padding: "2px",
                              display: "flex",
                              alignItems: "center",
                            }}
                            title="Remove section"
                          >
                            <IconX size={14} />
                          </button>
                        )}
                      </div>

                      {/* Section fields */}
                      <div
                        style={{
                          padding: "16px 20px",
                          display: "grid",
                          gridTemplateColumns: "1fr 1fr",
                          gap: 12,
                        }}
                      >
                        {/* Subject */}
                        <div className="field">
                          <label className="label">Subject</label>
                          <select
                            className="input"
                            value={sec.subject}
                            onChange={(e) =>
                              updateSection(sec.id, {
                                subject: e.target.value as Subject,
                                chapter: "",
                                question_type: "",
                              })
                            }
                          >
                            <option value="">Select subject</option>
                            {(["physics", "chemistry", "mathematics"] as Subject[]).map(
                              (s) => (
                                <option key={s} value={s}>
                                  {SUBJECT_META[s].label}
                                </option>
                              )
                            )}
                          </select>
                        </div>

                        {/* Chapter */}
                        <div className="field">
                          <label className="label">Chapter</label>
                          <select
                            className="input"
                            value={sec.chapter}
                            disabled={!sec.subject}
                            onChange={(e) =>
                              updateSection(sec.id, {
                                chapter: e.target.value,
                                question_type: "",
                              })
                            }
                          >
                            <option value="">
                              {sec.subject ? "Select chapter" : "Select subject first"}
                            </option>
                            {chaptersFor(sec.subject).map((c) => (
                              <option key={c.chapter} value={c.chapter}>
                                {c.chapter}
                              </option>
                            ))}
                          </select>
                        </div>

                        {/* Question type */}
                        <div className="field">
                          <label className="label">Question type</label>
                          <select
                            className="input"
                            value={sec.question_type}
                            disabled={!sec.chapter}
                            onChange={(e) =>
                              updateSection(sec.id, {
                                question_type: e.target.value as QuestionType,
                              })
                            }
                          >
                            <option value="">
                              {sec.chapter ? "Select type" : "Select chapter first"}
                            </option>
                            {availTypes.map(([type, count]) => (
                              <option key={type} value={type}>
                                {TYPE_LABELS[type]} ({count} available)
                              </option>
                            ))}
                          </select>
                        </div>

                        {/* Count */}
                        <div className="field">
                          <label className="label">
                            Number of questions
                            {maxQ > 0 && (
                              <span style={{ fontWeight: 400, color: "var(--c-text-3)", marginLeft: 4 }}>
                                (max {maxQ})
                              </span>
                            )}
                          </label>
                          <input
                            type="number"
                            className="input"
                            min={1}
                            max={maxQ || undefined}
                            value={sec.count}
                            onChange={(e) =>
                              updateSection(sec.id, {
                                count: Math.min(parseInt(e.target.value) || 1, maxQ || 9999),
                              })
                            }
                          />
                        </div>

                        {/* Marks correct */}
                        <div className="field">
                          <label className="label">Marks (correct)</label>
                          <input
                            type="number"
                            step="0.5"
                            className="input"
                            value={sec.marks_correct}
                            onChange={(e) =>
                              updateSection(sec.id, { marks_correct: parseFloat(e.target.value) || 4 })
                            }
                          />
                        </div>

                        {/* Marks wrong */}
                        <div className="field">
                          <label className="label">Negative marking</label>
                          <input
                            type="number"
                            step="0.5"
                            className="input"
                            value={sec.marks_wrong}
                            onChange={(e) =>
                              updateSection(sec.id, { marks_wrong: parseFloat(e.target.value) || 0 })
                            }
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Add section */}
              <button
                type="button"
                onClick={addSection}
                className="btn btn-ghost btn-sm"
                style={{ marginBottom: 20, width: "100%" }}
              >
                + Add another section
              </button>

              {/* Summary + submit */}
              <div
                style={{
                  background: "var(--c-surface)",
                  border: "1px solid var(--c-border)",
                  borderRadius: "var(--r-lg)",
                  padding: "16px 24px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  flexWrap: "wrap",
                }}
              >
                <div
                  style={{
                    fontSize: 13,
                    color: "var(--c-text-2)",
                    display: "flex",
                    gap: 16,
                    flexWrap: "wrap",
                  }}
                >
                  <span>
                    <strong style={{ color: "var(--c-text)" }}>{sections.length}</strong>{" "}
                    section{sections.length !== 1 ? "s" : ""}
                  </span>
                  <span>
                    <strong style={{ color: "var(--c-text)" }}>{totalQ}</strong>{" "}
                    questions
                  </span>
                  <span>
                    <strong style={{ color: "var(--c-text)" }}>{totalM}</strong>{" "}
                    total marks
                  </span>
                </div>
                <button type="submit" className="btn btn-primary">
                  <IconFlash size={14} /> Generate Test
                </button>
              </div>
            </Form>
          )}
        </div>
      </main>
    </div>
  );
}
