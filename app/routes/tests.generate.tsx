import { redirect, Link, useFetcher } from "react-router";
import { useState, useMemo } from "react";
import type { Route } from "./+types/tests.generate";
import { requireUser } from "~/lib/auth.server";
import { createServerClient } from "~/lib/supabase.server";
import { Sidebar } from "~/components/sidebar";
import { IconChevronRight, IconFlash, IconCheck, IconLayers } from "~/components/icons";
import type { QuestionType, Subject } from "~/lib/database.types";

// ── Types ──────────────────────────────────────────────────────

type WrongSection = {
  subject: Subject;
  question_type: QuestionType;
  marks_correct: number;
  marks_wrong: number;
  question_ids: string[];
};

type TestSummary = {
  id: string;
  title: string;
  submitted_at: string;
  wrong_count: number;
  missed_count: number;
  wrong_sections: WrongSection[];
};

// ── Shared wrong-question logic ─────────────────────────────────

function computeWrongSections(
  sections: any[],
  answers: Record<string, { status?: string; answer?: unknown }>
): { wrongSections: WrongSection[]; wrongCount: number; missedCount: number } {
  let wrongCount = 0;
  let missedCount = 0;
  const wrongSections: WrongSection[] = [];

  for (const sec of sections) {
    const tqs = [...((sec.test_questions ?? []) as any[])]
      .sort((a: any, b: any) => a.display_order - b.display_order);
    const missedIds: string[] = [];

    for (const tq of tqs) {
      const q = tq.questions;
      if (!q) continue;
      const state = answers[q.id];
      const given = state?.answer;
      const status = state?.status;

      let result: "correct" | "wrong" | "missed";
      if (!state || status === "not_visited" || status === "not_answered" || given === undefined) {
        result = "missed";
      } else {
        const ca = q.correct_answer;
        const qt = q.type as QuestionType;
        if (qt === "scq" || qt === "paragraph") {
          result = Array.isArray(ca) && Array.isArray(given) && ca[0] === (given as string[])[0]
            ? "correct" : "wrong";
        } else if (qt === "mcq") {
          if (!Array.isArray(ca) || !Array.isArray(given) || (given as string[]).length === 0) {
            result = "missed";
          } else {
            const cSet = new Set(ca);
            const gArr = given as string[];
            result = cSet.size === gArr.length && gArr.every((x: string) => cSet.has(x))
              ? "correct" : "wrong";
          }
        } else if (qt === "integer" || qt === "numerical") {
          const gn = parseFloat(String(given));
          const cn = parseFloat(String(ca));
          result = !isNaN(gn) && !isNaN(cn) && Math.abs(gn - cn) < 0.001 ? "correct" : "wrong";
        } else {
          result = "missed";
        }
      }

      if (result === "wrong") wrongCount++;
      else if (result === "missed") missedCount++;
      if (result !== "correct") missedIds.push(q.id);
    }

    if (missedIds.length > 0) {
      wrongSections.push({
        subject: sec.subject,
        question_type: sec.question_type,
        marks_correct: sec.marks_correct,
        marks_wrong: sec.marks_wrong,
        question_ids: missedIds,
      });
    }
  }

  return { wrongSections, wrongCount, missedCount };
}

// ── Loader ─────────────────────────────────────────────────────

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const user = await requireUser(request, env);
  const supabase = createServerClient(env);

  const { data: attempts } = await supabase
    .from("attempts")
    .select("id, test_id, submitted_at, answers")
    .eq("student_id", user.id)
    .not("submitted_at", "is", null);

  if (!attempts || attempts.length === 0) return { user, tests: [] };

  const testIds = [...new Set(attempts.map((a) => a.test_id))];

  const { data: ownedTests } = await supabase
    .from("tests")
    .select("id, title")
    .in("id", testIds)
    .eq("owner_id", user.id);

  if (!ownedTests || ownedTests.length === 0) return { user, tests: [] };

  const ownedTestIds = new Set(ownedTests.map((t) => t.id));

  const { data: rawSections } = await supabase
    .from("test_sections")
    .select(`
      id, test_id, question_type, subject, marks_correct, marks_wrong,
      test_questions(display_order, question_id, questions(id, correct_answer, type))
    `)
    .in("test_id", Array.from(ownedTestIds))
    .order("display_order", { ascending: true });

  const sectionsByTest = new Map<string, any[]>();
  for (const sec of rawSections ?? []) {
    const arr = sectionsByTest.get((sec as any).test_id) ?? [];
    arr.push(sec);
    sectionsByTest.set((sec as any).test_id, arr);
  }

  const testMap = new Map(ownedTests.map((t) => [t.id, t]));
  const tests: TestSummary[] = [];

  for (const attempt of attempts) {
    if (!ownedTestIds.has(attempt.test_id)) continue;
    const test = testMap.get(attempt.test_id);
    if (!test) continue;

    const answers = (attempt.answers ?? {}) as Record<string, { status?: string; answer?: unknown }>;
    const sections = sectionsByTest.get(attempt.test_id) ?? [];
    const { wrongSections, wrongCount, missedCount } = computeWrongSections(sections, answers);

    if (wrongCount + missedCount > 0) {
      tests.push({
        id: test.id,
        title: test.title,
        submitted_at: attempt.submitted_at!,
        wrong_count: wrongCount,
        missed_count: missedCount,
        wrong_sections: wrongSections,
      });
    }
  }

  tests.sort((a, b) => b.submitted_at.localeCompare(a.submitted_at));
  return { user, tests };
}

// ── Action ─────────────────────────────────────────────────────

export async function action({ request, context }: Route.ActionArgs) {
  const env = context.cloudflare.env;
  const user = await requireUser(request, env);
  const supabase = createServerClient(env);
  const fd = await request.formData();

  const title = String(fd.get("title") ?? "").trim();
  const durationMins = parseInt(String(fd.get("duration_mins") ?? ""), 10);
  const selectedIds = JSON.parse(String(fd.get("selected_ids") ?? "[]")) as string[];

  if (!title) return { error: "Title is required" };
  if (isNaN(durationMins) || durationMins <= 0) return { error: "Invalid duration" };
  if (selectedIds.length === 0) return { error: "Select at least one test" };

  // Re-verify ownership server-side
  const { data: ownedTests } = await supabase
    .from("tests")
    .select("id")
    .in("id", selectedIds)
    .eq("owner_id", user.id);

  const safeIds = (ownedTests ?? []).map((t) => t.id);
  if (safeIds.length === 0) return { error: "No valid tests selected" };

  const { data: attempts } = await supabase
    .from("attempts")
    .select("test_id, answers")
    .in("test_id", safeIds)
    .eq("student_id", user.id)
    .not("submitted_at", "is", null);

  const { data: rawSections } = await supabase
    .from("test_sections")
    .select(`
      id, test_id, question_type, subject, marks_correct, marks_wrong,
      test_questions(display_order, question_id, questions(id, correct_answer, type))
    `)
    .in("test_id", safeIds)
    .order("display_order", { ascending: true });

  const sectionsByTest = new Map<string, any[]>();
  for (const sec of rawSections ?? []) {
    const arr = sectionsByTest.get((sec as any).test_id) ?? [];
    arr.push(sec);
    sectionsByTest.set((sec as any).test_id, arr);
  }

  // Deduplicate: group wrong/missed by (subject, question_type, marks_correct, marks_wrong)
  type GroupKey = string;
  type GroupMeta = { subject: Subject; question_type: QuestionType; marks_correct: number; marks_wrong: number };
  const groups = new Map<GroupKey, { meta: GroupMeta; ids: Set<string> }>();

  for (const attempt of attempts ?? []) {
    const answers = (attempt.answers ?? {}) as Record<string, { status?: string; answer?: unknown }>;
    const sections = sectionsByTest.get(attempt.test_id) ?? [];
    const { wrongSections } = computeWrongSections(sections, answers);

    for (const sec of wrongSections) {
      const key: GroupKey = `${sec.subject}::${sec.question_type}::${sec.marks_correct}::${sec.marks_wrong}`;
      if (!groups.has(key)) {
        groups.set(key, {
          meta: { subject: sec.subject, question_type: sec.question_type, marks_correct: sec.marks_correct, marks_wrong: sec.marks_wrong },
          ids: new Set(),
        });
      }
      for (const id of sec.question_ids) groups.get(key)!.ids.add(id);
    }
  }

  if (groups.size === 0) return { error: "No wrong or missed questions found across selected tests" };

  const { data: newTest, error: testErr } = await supabase
    .from("tests")
    .insert({ owner_id: user.id, title, duration_mins: durationMins, is_published: true, visibility: "private" })
    .select("id")
    .single();

  if (testErr || !newTest) return { error: "Failed to create test — please try again" };

  const SUBJECT_ORDER: Subject[] = ["physics", "chemistry", "mathematics"];
  const sortedGroups = Array.from(groups.entries()).sort(([ka], [kb]) => {
    const [subA, typeA] = ka.split("::");
    const [subB, typeB] = kb.split("::");
    const si = SUBJECT_ORDER.indexOf(subA as Subject) - SUBJECT_ORDER.indexOf(subB as Subject);
    return si !== 0 ? si : typeA.localeCompare(typeB);
  });

  for (let i = 0; i < sortedGroups.length; i++) {
    const [, { meta, ids }] = sortedGroups[i];
    const qids = Array.from(ids);

    const { data: newSec, error: secErr } = await supabase
      .from("test_sections")
      .insert({
        test_id: newTest.id,
        name: `${SUBJECT_LABELS[meta.subject]} — ${TYPE_LABELS[meta.question_type]}`,
        question_type: meta.question_type,
        subject: meta.subject,
        marks_correct: meta.marks_correct,
        marks_wrong: meta.marks_wrong,
        marks_partial: null,
        display_order: i + 1,
      })
      .select("id")
      .single();

    if (secErr || !newSec) continue;

    await supabase.from("test_questions").insert(
      qids.map((qid, idx) => ({ test_section_id: newSec.id, question_id: qid, display_order: idx + 1 }))
    );
  }

  throw redirect(`/tests/${newTest.id}/preview`);
}

// ── Constants ──────────────────────────────────────────────────

const SUBJECT_LABELS: Record<Subject, string> = {
  physics: "Physics", chemistry: "Chemistry", mathematics: "Mathematics",
};

const TYPE_LABELS: Record<QuestionType, string> = {
  scq: "SCQ", mcq: "MCQ", integer: "Integer", numerical: "Numerical", paragraph: "Paragraph",
};

const SUBJECT_COLORS: Record<Subject, { color: string; bg: string }> = {
  physics:     { color: "#1d4ed8", bg: "#dbeafe" },
  chemistry:   { color: "#15803d", bg: "#dcfce7" },
  mathematics: { color: "#7e22ce", bg: "#f3e8ff" },
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

// ── StepDots ───────────────────────────────────────────────────

function StepDots({ stage }: { stage: 1 | 2 | 3 }) {
  const labels = ["Pick tests", "Name it", "Generate"];
  return (
    <div style={{ display: "flex", alignItems: "center", marginBottom: 32 }}>
      {labels.map((label, i) => {
        const n = i + 1;
        const done = stage > n;
        const active = stage === n;
        return (
          <div key={n} style={{ display: "flex", alignItems: "center", flex: n < 3 ? 1 : undefined }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 5 }}>
              <div style={{
                width: 28, height: 28, borderRadius: "50%",
                background: (done || active) ? "var(--c-brand-500)" : "var(--c-surface-2)",
                border: (done || active) ? "none" : "1.5px solid var(--c-border-strong)",
                display: "flex", alignItems: "center", justifyContent: "center",
                color: (done || active) ? "#fff" : "var(--c-text-3)",
                fontSize: 11, fontWeight: 700, transition: "all 0.2s",
              }}>
                {done ? <IconCheck size={12} strokeWidth={2.5} /> : n}
              </div>
              <span style={{ fontSize: 11, fontWeight: active ? 600 : 400, color: active ? "var(--c-text)" : "var(--c-text-3)", whiteSpace: "nowrap" }}>
                {label}
              </span>
            </div>
            {n < 3 && (
              <div style={{ flex: 1, height: 1.5, marginBottom: 20, marginLeft: 8, marginRight: 8, background: done ? "var(--c-brand-400)" : "var(--c-border)", transition: "background 0.2s" }} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Stage 1 — Pick Tests ───────────────────────────────────────

function Stage1({ tests, selected, onToggle, onContinue }: {
  tests: TestSummary[]; selected: Set<string>;
  onToggle: (id: string) => void; onContinue: () => void;
}) {
  const totalMistakes = tests.filter((t) => selected.has(t.id)).reduce((s, t) => s + t.wrong_count + t.missed_count, 0);

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ margin: "0 0 4px", fontSize: 18, fontWeight: 700 }}>Which tests to pull from?</h2>
        <p style={{ margin: 0, fontSize: 13, color: "var(--c-text-3)" }}>
          All wrong and missed answers from your picks go into one revision test.
        </p>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 20 }}>
        {tests.map((t) => {
          const active = selected.has(t.id);
          const subjects = [...new Set(t.wrong_sections.map((s) => s.subject))];
          return (
            <div
              key={t.id}
              onClick={() => onToggle(t.id)}
              style={{
                display: "flex", alignItems: "center", gap: 14, padding: "14px 16px",
                background: active ? "rgba(215,118,86,0.05)" : "var(--c-surface)",
                border: `1.5px solid ${active ? "var(--c-brand-400)" : "var(--c-border)"}`,
                borderRadius: 10, cursor: "pointer", transition: "border-color 0.15s, background 0.15s",
              }}
            >
              <div style={{
                width: 20, height: 20, borderRadius: 5, flexShrink: 0,
                background: active ? "var(--c-brand-500)" : "transparent",
                border: `2px solid ${active ? "var(--c-brand-500)" : "var(--c-border-strong)"}`,
                display: "flex", alignItems: "center", justifyContent: "center",
                transition: "all 0.15s",
              }}>
                {active && <IconCheck size={11} strokeWidth={3} color="#fff" />}
              </div>

              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: "var(--c-text)", marginBottom: 3 }}>
                  {t.title.replace(/\s*\[Layer \d+\]/, "")}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 12, color: "var(--c-text-3)" }}>{formatDate(t.submitted_at)}</span>
                  {subjects.map((s) => (
                    <span key={s} style={{ fontSize: 10, fontWeight: 600, padding: "1px 6px", borderRadius: 4, background: SUBJECT_COLORS[s].bg, color: SUBJECT_COLORS[s].color }}>
                      {SUBJECT_LABELS[s]}
                    </span>
                  ))}
                </div>
              </div>

              <div style={{ textAlign: "right", flexShrink: 0 }}>
                <div style={{ fontSize: 18, fontWeight: 700, color: active ? "var(--c-brand-500)" : "var(--c-text-2)" }}>
                  {t.wrong_count + t.missed_count}
                </div>
                <div style={{ fontSize: 10, color: "var(--c-text-3)" }}>mistakes</div>
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 18px", background: "var(--c-surface)", border: "1px solid var(--c-border)", borderRadius: 10 }}>
        <span style={{ fontSize: 13, color: "var(--c-text-2)" }}>
          {selected.size === 0 ? "No tests selected" : (
            <><strong style={{ color: "var(--c-text)" }}>{selected.size}</strong> test{selected.size !== 1 ? "s" : ""} · <strong style={{ color: "var(--c-text)" }}>{totalMistakes}</strong> mistakes</>
          )}
        </span>
        <button className="btn btn-primary btn-sm" disabled={selected.size === 0} onClick={onContinue}>
          Continue →
        </button>
      </div>
    </div>
  );
}

// ── Stage 2 — Name it ──────────────────────────────────────────

function Stage2({ tests, selected, title, setTitle, duration, setDuration, onBack, onContinue }: {
  tests: TestSummary[]; selected: Set<string>;
  title: string; setTitle: (v: string) => void;
  duration: number; setDuration: (v: number) => void;
  onBack: () => void; onContinue: () => void;
}) {
  const totalMistakes = tests.filter((t) => selected.has(t.id)).reduce((s, t) => s + t.wrong_count + t.missed_count, 0);
  const DURATIONS = [30, 45, 60, 90, 120] as const;

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ margin: "0 0 4px", fontSize: 18, fontWeight: 700 }}>Name your Grand Layer</h2>
        <p style={{ margin: 0, fontSize: 13, color: "var(--c-text-3)" }}>
          {totalMistakes} question{totalMistakes !== 1 ? "s" : ""} across {selected.size} test{selected.size !== 1 ? "s" : ""}.
        </p>
      </div>

      <div style={{ background: "var(--c-surface)", border: "1px solid var(--c-border)", borderRadius: 10, padding: "20px 24px", marginBottom: 16, display: "flex", flexDirection: "column", gap: 18 }}>
        <div className="field" style={{ margin: 0 }}>
          <label className="label" htmlFor="grand-title">Title</label>
          <input id="grand-title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Grand Layer — Mock 1 & 2" autoFocus />
        </div>

        <div className="field" style={{ margin: 0 }}>
          <label className="label">Duration</label>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {DURATIONS.map((m) => {
              const h = Math.floor(m / 60), rem = m % 60;
              const label = m < 60 ? `${m}m` : rem ? `${h}h ${rem}m` : `${h}h`;
              return (
                <button key={m} type="button" onClick={() => setDuration(m)} style={{
                  padding: "7px 16px", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer",
                  border: duration === m ? "2px solid var(--c-brand-500)" : "1.5px solid var(--c-border)",
                  background: duration === m ? "rgba(215,118,86,0.07)" : "var(--c-surface-2)",
                  color: duration === m ? "var(--c-brand-500)" : "var(--c-text-2)",
                  transition: "all 0.15s",
                }}>{label}</button>
              );
            })}
          </div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
        <button className="btn btn-ghost btn-sm" onClick={onBack}>← Back</button>
        <button className="btn btn-primary btn-sm" disabled={!title.trim()} onClick={onContinue}>Review →</button>
      </div>
    </div>
  );
}

// ── Stage 3 — Review & Generate ────────────────────────────────

function Stage3({ tests, selected, title, duration, onBack }: {
  tests: TestSummary[]; selected: Set<string>;
  title: string; duration: number; onBack: () => void;
}) {
  const fetcher = useFetcher();
  const isSubmitting = fetcher.state !== "idle";
  const serverError = (fetcher.data as any)?.error ?? null;

  const breakdown = useMemo(() => {
    const groups = new Map<string, { subject: Subject; question_type: QuestionType; marks_correct: number; marks_wrong: number; ids: Set<string> }>();
    for (const test of tests) {
      if (!selected.has(test.id)) continue;
      for (const sec of test.wrong_sections) {
        const key = `${sec.subject}::${sec.question_type}::${sec.marks_correct}::${sec.marks_wrong}`;
        if (!groups.has(key)) groups.set(key, { subject: sec.subject, question_type: sec.question_type, marks_correct: sec.marks_correct, marks_wrong: sec.marks_wrong, ids: new Set() });
        for (const id of sec.question_ids) groups.get(key)!.ids.add(id);
      }
    }
    const ORDER: Subject[] = ["physics", "chemistry", "mathematics"];
    return Array.from(groups.values()).sort((a, b) => {
      const si = ORDER.indexOf(a.subject) - ORDER.indexOf(b.subject);
      return si !== 0 ? si : a.question_type.localeCompare(b.question_type);
    });
  }, [tests, selected]);

  const totalQ = breakdown.reduce((s, g) => s + g.ids.size, 0);

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ margin: "0 0 4px", fontSize: 18, fontWeight: 700 }}>Your Grand Layer</h2>
        <p style={{ margin: 0, fontSize: 13, color: "var(--c-text-3)" }}>
          {totalQ} unique question{totalQ !== 1 ? "s" : ""} · "{title}"
        </p>
      </div>

      <div style={{ background: "var(--c-surface)", border: "1px solid var(--c-border)", borderRadius: 10, overflow: "hidden", marginBottom: 16 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 100px 70px", padding: "8px 16px", fontSize: 11, fontWeight: 700, color: "var(--c-text-3)", textTransform: "uppercase", letterSpacing: "0.05em", borderBottom: "1px solid var(--c-border)", background: "var(--c-subtle)" }}>
          <span>Subject</span><span>Type</span><span style={{ textAlign: "right" }}>Qs</span>
        </div>

        {breakdown.map((g, i) => {
          const col = SUBJECT_COLORS[g.subject];
          return (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 100px 70px", padding: "11px 16px", alignItems: "center", borderTop: i > 0 ? "1px solid var(--c-border-subtle)" : undefined }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 4, background: col.bg, color: col.color }}>{SUBJECT_LABELS[g.subject]}</span>
                <span style={{ fontSize: 12, color: "var(--c-text-3)" }}>{g.marks_correct > 0 ? `+${g.marks_correct}` : g.marks_correct}/{g.marks_wrong}</span>
              </div>
              <span style={{ fontSize: 13, color: "var(--c-text-2)" }}>{TYPE_LABELS[g.question_type]}</span>
              <span style={{ fontSize: 14, fontWeight: 700, color: "var(--c-text)", textAlign: "right" }}>{g.ids.size}</span>
            </div>
          );
        })}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 100px 70px", padding: "11px 16px", borderTop: "1px solid var(--c-border)", background: "var(--c-subtle)" }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: "var(--c-text)", gridColumn: "1 / 3" }}>Total</span>
          <span style={{ fontSize: 14, fontWeight: 700, color: "var(--c-brand-500)", textAlign: "right" }}>{totalQ}</span>
        </div>
      </div>

      {serverError && <div className="alert-error" style={{ marginBottom: 16, fontSize: 13 }}>{serverError}</div>}

      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", alignItems: "center" }}>
        <button className="btn btn-ghost btn-sm" onClick={onBack} disabled={isSubmitting}>← Back</button>
        <fetcher.Form method="post">
          <input type="hidden" name="title" value={title} />
          <input type="hidden" name="duration_mins" value={duration} />
          <input type="hidden" name="selected_ids" value={JSON.stringify(Array.from(selected))} />
          <button type="submit" className="btn btn-primary" disabled={isSubmitting} style={{ opacity: isSubmitting ? 0.6 : 1 }}>
            <IconFlash size={14} />
            {isSubmitting ? "Generating…" : "Generate Grand Layer →"}
          </button>
        </fetcher.Form>
      </div>
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────

export default function TestGeneratePage({ loaderData }: Route.ComponentProps) {
  const { user, tests } = loaderData;

  const [stage, setStage] = useState<1 | 2 | 3>(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [title, setTitle] = useState("Grand Layer");
  const [duration, setDuration] = useState(60);

  function toggleTest(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  return (
    <div className="app-layout">
      <Sidebar displayName={user.display_name} />
      <main className="app-main">
        <div style={{ maxWidth: 600, margin: "0 auto", padding: "0 24px 60px" }}>

          <div className="pg-head" style={{ paddingBottom: 0 }}>
            <div>
              <nav className="result-breadcrumb" style={{ marginBottom: 6 }}>
                <Link to="/discover?mine=1" className="result-breadcrumb-link">My Tests</Link>
                <IconChevronRight size={13} />
                <span>Grand Layer</span>
              </nav>
              <h1 className="pg-title" style={{ marginTop: 4, marginBottom: 4, display: "flex", alignItems: "center", gap: 8 }}>
                <IconLayers size={20} style={{ color: "var(--c-brand-500)", display: "inline" }} />
                Grand Layer
              </h1>
              <p className="pg-subtitle" style={{ marginBottom: 28 }}>
                Pull wrong and missed answers from multiple tests into one focused revision session.
              </p>
            </div>
          </div>

          {tests.length === 0 ? (
            <div className="lib-empty" style={{ marginTop: 16 }}>
              <p className="lib-empty-title">No completed tests yet</p>
              <p className="lib-empty-body">Take at least one test — then come back to build a Grand Layer from your mistakes.</p>
              <Link to="/discover?mine=1" className="btn btn-primary">Go to My Tests →</Link>
            </div>
          ) : (
            <>
              <StepDots stage={stage} />
              {stage === 1 && <Stage1 tests={tests} selected={selected} onToggle={toggleTest} onContinue={() => setStage(2)} />}
              {stage === 2 && <Stage2 tests={tests} selected={selected} title={title} setTitle={setTitle} duration={duration} setDuration={setDuration} onBack={() => setStage(1)} onContinue={() => setStage(3)} />}
              {stage === 3 && <Stage3 tests={tests} selected={selected} title={title} duration={duration} onBack={() => setStage(2)} />}
            </>
          )}
        </div>
      </main>
    </div>
  );
}
