import { redirect, Link, Form } from "react-router";
import { useState, useEffect } from "react";
import type { Route } from "./+types/tests.$id.result";
import { requireUser } from "~/lib/auth.server";
import { createServerClient } from "~/lib/supabase.server";
import type { ScoreBreakdown, Subject, QuestionType } from "~/lib/database.types";
import {
  IconChevronRight, IconCheck, IconX, IconLayers,
  IconClock, IconTarget, IconGraph,
} from "~/components/icons";

// ─────────────────────────────────────────────────────────────
// Rank estimator — Gaussian model fitted from JEE Advanced 2012–2025
// ─────────────────────────────────────────────────────────────
const JEE_ADV_SLOPE      = 22.45;
const JEE_ADV_INTERCEPT  =  1.62;
const JEE_ADV_CANDIDATES = 165000;

function normCDF(z: number): number {
  const sign = z >= 0 ? 1 : -1;
  z = Math.abs(z);
  const t = 1 / (1 + 0.2316419 * z);
  const d = 0.3989422820 * Math.exp(-z * z / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.7814779 + t * (-1.8212560 + t * 1.3302744))));
  return sign === 1 ? 1 - p : p;
}

function computeRank(scorePct: number, diff: number): number {
  const diffMult     = 0.85 + 0.15 * (diff / 10);
  const effectivePct = scorePct * diffMult;
  const z            = (effectivePct - JEE_ADV_INTERCEPT) / JEE_ADV_SLOPE;
  return Math.max(1, Math.round((1 - normCDF(z)) * JEE_ADV_CANDIDATES));
}

// ── Types ──────────────────────────────────────────────────────
type ResultStatus = "correct" | "wrong" | "missed";

type SectionMeta = {
  id: string; name: string; subject: Subject;
  question_type: QuestionType; marks_correct: number; marks_wrong: number;
};

type SubjectStats = {
  subject: Subject; total: number; correct: number;
  wrong: number; missed: number; marks: number; positiveMarks: number;
};

type LeaderboardEntry = {
  student_id: string;
  display_name: string;
  score: number;
  max_marks: number;
  correct: number;
  wrong: number;
  missed: number;
  time_taken_seconds: number;
  submitted_at: string;
  is_me: boolean;
};

// ── Loader ─────────────────────────────────────────────────────
export async function loader({ params, request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const user = await requireUser(request, env);
  const supabase = createServerClient(env);
  const testId = params.id!;

  const { data: test } = await supabase
    .from("tests").select("id, title, duration_mins, is_published")
    .eq("id", testId).single();
  if (!test) throw redirect("/tests");

  const { data: attempt } = await supabase
    .from("attempts")
    .select("id, answers, started_at, submitted_at, score_breakdown")
    .eq("test_id", testId).eq("student_id", user.id).maybeSingle();
  if (!attempt || !attempt.submitted_at) throw redirect(`/tests/${testId}/take`);

  const { data: rawSections } = await supabase
    .from("test_sections")
    .select(`
      id, name, question_type, subject, display_order,
      marks_correct, marks_wrong,
      test_questions(
        display_order, question_id,
        questions(id, image_url, correct_answer, type)
      )
    `)
    .eq("test_id", testId).order("display_order", { ascending: true });

  const sectionMeta: SectionMeta[] = (rawSections ?? []).map((s: any) => ({
    id: s.id, name: s.name, subject: s.subject as Subject,
    question_type: s.question_type as QuestionType,
    marks_correct: s.marks_correct, marks_wrong: s.marks_wrong,
  }));

  const answers = (attempt.answers ?? {}) as Record<string, { status?: string; answer?: unknown }>;
  const questionResults: ResultStatus[] = [];
  const sectionResults: Record<string, ResultStatus[]> = {};

  for (const sec of (rawSections ?? []) as any[]) {
    const tqs = [...((sec.test_questions ?? []) as any[])]
      .sort((a: any, b: any) => a.display_order - b.display_order);
    sectionResults[sec.id] = [];
    for (const tq of tqs) {
      const q = tq.questions;
      if (!q) continue;
      const state = answers[q.id];
      const given = state?.answer;
      const status = state?.status;
      let result: ResultStatus;
      if (!state || status === "not_visited" || status === "not_answered" || given === undefined) {
        result = "missed";
      } else {
        const ca = q.correct_answer;
        const qt = q.type as QuestionType;
        if (qt === "scq" || qt === "paragraph") {
          result = Array.isArray(ca) && Array.isArray(given) && ca.length === 1 &&
            (given as string[]).length === 1 && ca[0] === (given as string[])[0]
            ? "correct" : "wrong";
        } else if (qt === "mcq") {
          if (!Array.isArray(ca) || !Array.isArray(given) || (given as string[]).length === 0) {
            result = "missed";
          } else {
            const cSet = new Set(ca); const gArr = given as string[];
            result = cSet.size === gArr.length && gArr.every(x => cSet.has(x)) ? "correct" : "wrong";
          }
        } else if (qt === "integer" || qt === "numerical") {
          const gn = parseFloat(String(given)); const cn = parseFloat(String(ca));
          result = !isNaN(gn) && !isNaN(cn) && Math.abs(gn - cn) < 0.001 ? "correct" : "wrong";
        } else { result = "missed"; }
      }
      questionResults.push(result);
      sectionResults[sec.id].push(result);
    }
  }

  const score = attempt.score_breakdown as ScoreBreakdown | null;

  const subjectMap: Record<string, SubjectStats> = {};
  for (const sec of sectionMeta) {
    if (!subjectMap[sec.subject]) {
      subjectMap[sec.subject] = { subject: sec.subject, total: 0, correct: 0, wrong: 0, missed: 0, marks: 0, positiveMarks: 0 };
    }
    const secQResults   = sectionResults[sec.id] ?? [];
    const secBreakdown  = score?.sections.find(s => s.section_id === sec.id);
    const secCorrect    = secQResults.filter(r => r === "correct").length;
    const secWrong      = secQResults.filter(r => r === "wrong").length;
    const secMissed     = secQResults.filter(r => r === "missed").length;
    subjectMap[sec.subject].total        += secQResults.length;
    subjectMap[sec.subject].correct      += secCorrect;
    subjectMap[sec.subject].wrong        += secWrong;
    subjectMap[sec.subject].missed       += secMissed;
    subjectMap[sec.subject].marks        += secBreakdown?.marks ?? 0;
    subjectMap[sec.subject].positiveMarks += secCorrect * sec.marks_correct;
  }
  const subjectStats = Object.values(subjectMap);
  const totalCorrect = questionResults.filter(r => r === "correct").length;
  const totalWrong   = questionResults.filter(r => r === "wrong").length;
  const totalMissed  = questionResults.filter(r => r === "missed").length;

  // ── Leaderboard: all submitted attempts for this test ──────
  const { data: allAttempts } = await supabase
    .from("attempts")
    .select("student_id, score_breakdown, submitted_at, users!student_id(display_name)")
    .eq("test_id", testId)
    .not("submitted_at", "is", null);

  const leaderboard: LeaderboardEntry[] = [];
  for (const a of (allAttempts ?? []) as any[]) {
    const sb = a.score_breakdown as ScoreBreakdown | null;
    if (!sb) continue;
    let lCorrect = 0, lWrong = 0, lMissed = 0;
    for (const sec of sb.sections) {
      lCorrect += sec.correct;
      lWrong   += sec.wrong;
      lMissed  += sec.unattempted;
    }
    leaderboard.push({
      student_id:         a.student_id,
      display_name:       (a.users as any)?.display_name ?? "Unknown",
      score:              sb.total,
      max_marks:          sb.max_marks,
      correct:            lCorrect,
      wrong:              lWrong,
      missed:             lMissed,
      time_taken_seconds: sb.time_taken_seconds ?? 0,
      submitted_at:       a.submitted_at,
      is_me:              a.student_id === user.id,
    });
  }
  leaderboard.sort((a, b) => b.score - a.score || a.time_taken_seconds - b.time_taken_seconds);

  // Feature 3: Check if a next-layer test already exists for this result
  const layerMatchTitle = test.title.match(/\[Layer (\d+)\]/);
  const nextLayerNum    = layerMatchTitle ? parseInt(layerMatchTitle[1]) + 1 : 2;
  const baseTitle       = test.title.replace(/\s*\[Layer \d+\]/, "").trim();
  const nextLayerTitle  = `${baseTitle} [Layer ${nextLayerNum}]`;

  const { data: existingLayer } = await supabase
    .from("tests")
    .select("id")
    .eq("owner_id", user.id)
    .eq("title", nextLayerTitle)
    .maybeSingle();

  return {
    user, test, attempt, subjectStats,
    totalCorrect, totalWrong, totalMissed, score,
    leaderboard,
    layerAlreadyExists: !!existingLayer,
    existingLayerId:    existingLayer?.id ?? null,
    nextLayerNum,
    totalQuestions:     questionResults.length,
  };
}

// ── Action ─────────────────────────────────────────────────────
export async function action({ params, request, context }: Route.ActionArgs) {
  const env = context.cloudflare.env;
  const user = await requireUser(request, env);
  const supabase = createServerClient(env);
  const testId = params.id!;
  const formData = await request.formData();

  if (String(formData.get("intent")) === "retake") {
    await supabase.from("attempts").delete().eq("test_id", testId).eq("student_id", user.id);
    throw redirect(`/tests/${testId}/take`);
  }

  if (String(formData.get("intent")) === "layer") {
    const { data: origTest } = await supabase
      .from("tests").select("title, duration_mins").eq("id", testId).single();
    const { data: attempt } = await supabase
      .from("attempts").select("answers")
      .eq("test_id", testId).eq("student_id", user.id).maybeSingle();
    if (!origTest || !attempt) return null;

    // Feature 3: Block duplicate layer
    const layerMatch = origTest.title.match(/\[Layer (\d+)\]/);
    const nextLayer  = layerMatch ? parseInt(layerMatch[1]) + 1 : 2;
    const baseTitle  = origTest.title.replace(/\s*\[Layer \d+\]/, "").trim();
    const newTitle   = `${baseTitle} [Layer ${nextLayer}]`;

    const { data: alreadyExists } = await supabase
      .from("tests").select("id").eq("owner_id", user.id).eq("title", newTitle).maybeSingle();
    if (alreadyExists) throw redirect(`/tests/${alreadyExists.id}`);

    const { data: rawSections } = await supabase
      .from("test_sections")
      .select(`
        id, name, question_type, subject, display_order,
        marks_correct, marks_wrong,
        test_questions(display_order, question_id, questions(id, correct_answer, type))
      `)
      .eq("test_id", testId).order("display_order", { ascending: true });

    const answers = (attempt.answers ?? {}) as Record<string, { status?: string; answer?: unknown }>;
    type SectionGroup = {
      name: string; question_type: string; subject: string;
      marks_correct: number; marks_wrong: number; display_order: number; question_ids: string[];
    };
    const sectionGroups: SectionGroup[] = [];
    let totalQCount  = 0;
    let missedQCount = 0;

    for (const sec of (rawSections ?? []) as any[]) {
      const tqs = [...((sec.test_questions ?? []) as any[])]
        .sort((a: any, b: any) => a.display_order - b.display_order);
      const missedIds: string[] = [];
      for (const tq of tqs) {
        const q = tq.questions; if (!q) continue;
        totalQCount++;
        const state = answers[q.id]; const given = state?.answer; const status = state?.status;
        let result: "correct" | "wrong" | "missed";
        if (!state || status === "not_visited" || status === "not_answered" || given === undefined) {
          result = "missed";
        } else {
          const ca = q.correct_answer; const qt = q.type as QuestionType;
          if (qt === "scq" || qt === "paragraph") {
            result = Array.isArray(ca) && Array.isArray(given) && ca[0] === (given as string[])[0] ? "correct" : "wrong";
          } else if (qt === "mcq") {
            if (!Array.isArray(ca) || !Array.isArray(given) || (given as string[]).length === 0) { result = "missed"; }
            else { const cSet = new Set(ca); const gArr = given as string[]; result = cSet.size === gArr.length && gArr.every((x: string) => cSet.has(x)) ? "correct" : "wrong"; }
          } else if (qt === "integer" || qt === "numerical") {
            const gn = parseFloat(String(given)); const cn = parseFloat(String(ca));
            result = !isNaN(gn) && !isNaN(cn) && Math.abs(gn - cn) < 0.001 ? "correct" : "wrong";
          } else { result = "missed"; }
        }
        if (result !== "correct") { missedIds.push(q.id); missedQCount++; }
      }
      if (missedIds.length > 0) {
        sectionGroups.push({
          name: sec.name, question_type: sec.question_type, subject: sec.subject,
          marks_correct: sec.marks_correct, marks_wrong: sec.marks_wrong,
          display_order: sec.display_order, question_ids: missedIds,
        });
      }
    }

    if (sectionGroups.length === 0) return null;

    // Feature 1: Proportional duration — scaled to missed/total, min 20 mins, rounded to 5
    const rawDuration   = totalQCount > 0
      ? (missedQCount / totalQCount) * origTest.duration_mins
      : origTest.duration_mins;
    const layerDuration = Math.max(20, Math.round(rawDuration / 5) * 5);

    const { data: newTest, error: testErr } = await supabase
      .from("tests")
      .insert({ owner_id: user.id, title: newTitle, duration_mins: layerDuration, is_published: true })
      .select("id").single();
    if (testErr || !newTest) return null;

    for (const sg of sectionGroups) {
      const { data: newSec, error: secErr } = await supabase
        .from("test_sections")
        .insert({
          test_id: newTest.id, name: sg.name,
          question_type: sg.question_type as QuestionType, subject: sg.subject as Subject,
          marks_correct: sg.marks_correct, marks_wrong: sg.marks_wrong, display_order: sg.display_order,
        })
        .select("id").single();
      if (secErr || !newSec) continue;
      await supabase.from("test_questions").insert(
        sg.question_ids.map((qid, idx) => ({ test_section_id: newSec.id, question_id: qid, display_order: idx + 1 }))
      );
    }
    throw redirect(`/tests/${newTest.id}/take`);
  }

  return null;
}

// ── Helpers ────────────────────────────────────────────────────

function formatTime(seconds: number) {
  if (!seconds) return "—";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  return `${m}m ${s}s`;
}

function scoreColour(pct: number) {
  if (pct >= 70) return "var(--c-success)";
  if (pct >= 40) return "var(--c-brand-500)";
  return "var(--c-error)";
}

function rankBand(rank: number): { label: string; colour: string } {
  if (rank <= 500)   return { label: "Top 0.3% — Elite",        colour: "#f59e0b" };
  if (rank <= 2000)  return { label: "Top 1.2% — Outstanding",  colour: "#10b981" };
  if (rank <= 5000)  return { label: "Top 3% — Excellent",      colour: "var(--c-success)" };
  if (rank <= 15000) return { label: "Top 10% — Strong",        colour: "var(--c-brand-500)" };
  if (rank <= 40000) return { label: "Top 25% — Good",          colour: "var(--c-brand-400)" };
  return               { label: "Keep practising",              colour: "var(--c-text-3)" };
}

// ── Leaderboard component ──────────────────────────────────────

function Leaderboard({ entries, testMaxMarks }: { entries: LeaderboardEntry[]; testMaxMarks: number }) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? entries : entries.slice(0, 5);
  if (entries.length === 0) return null;

  return (
    <div className="ro-section" style={{ marginTop: 14 }}>
      <p className="ro-section-label" style={{ marginBottom: 12 }}>
        🏆 Leaderboard — {entries.length} student{entries.length !== 1 ? "s" : ""}
      </p>
      <div className="lb-table">
        <div className="lb-row lb-header">
          <span className="lb-col-rank">#</span>
          <span className="lb-col-name">Student</span>
          <span className="lb-col-score">Score</span>
          <span className="lb-col-stat">✓</span>
          <span className="lb-col-stat">✗</span>
          <span className="lb-col-time">Time</span>
        </div>
        {visible.map((e, i) => {
          const pct = testMaxMarks > 0 ? Math.round((e.score / testMaxMarks) * 100) : 0;
          const col = scoreColour(pct);
          return (
            <div key={e.student_id} className={`lb-row${e.is_me ? " lb-row-me" : ""}${i === 0 ? " lb-row-top" : ""}`}>
              <span className="lb-col-rank lb-rank-num">
                {i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `#${i + 1}`}
              </span>
              <span className="lb-col-name lb-name-cell">
                {e.display_name}
                {e.is_me && <span className="lb-you-badge">you</span>}
              </span>
              <span className="lb-col-score" style={{ color: col, fontWeight: 700 }}>
                {e.score}
                <span className="lb-score-of">/{testMaxMarks}</span>
                <span className="lb-score-pct"> {pct}%</span>
              </span>
              <span className="lb-col-stat" style={{ color: "var(--c-success)" }}>{e.correct}</span>
              <span className="lb-col-stat" style={{ color: "var(--c-error)" }}>{e.wrong}</span>
              <span className="lb-col-time">{formatTime(e.time_taken_seconds)}</span>
            </div>
          );
        })}
      </div>
      {entries.length > 5 && (
        <button onClick={() => setExpanded(v => !v)} className="btn btn-ghost btn-sm" style={{ marginTop: 8, fontSize: 12 }}>
          {expanded ? "Show less ▲" : `Show all ${entries.length} ▼`}
        </button>
      )}
    </div>
  );
}

// ── Page ────────────────────────────────────────────────────────

export default function TestResultPage({ loaderData }: Route.ComponentProps) {
  const {
    test, subjectStats, totalCorrect, totalWrong, totalMissed, score,
    leaderboard, layerAlreadyExists, existingLayerId, nextLayerNum, totalQuestions,
  } = loaderData;

  const [showResultSplash, setShowResultSplash] = useState(() => {
    if (typeof window === "undefined") return false;
    const flag = sessionStorage.getItem("jeelo-show-result-splash");
    if (flag) { sessionStorage.removeItem("jeelo-show-result-splash"); return true; }
    return false;
  });
  useEffect(() => {
    if (!showResultSplash) return;
    const t = setTimeout(() => setShowResultSplash(false), 2400);
    return () => clearTimeout(t);
  }, [showResultSplash]);

  const totalAttempted  = totalCorrect + totalWrong;
  const overallAccuracy = totalAttempted > 0 ? Math.round((totalCorrect / totalAttempted) * 100) : 0;
  const timeTaken       = (score as any)?.time_taken_seconds ?? 0;
  const pct             = score && score.max_marks > 0 ? Math.round((score.total / score.max_marks) * 100) : 0;

  const showRank = totalQuestions > 25;
  let rankLow: number | null = null;
  let rankHigh: number | null = null;
  if (showRank && score && score.max_marks > 0) {
    const scorePct = (score.total / score.max_marks) * 100;
    rankLow  = computeRank(scorePct, 10);
    rankHigh = computeRank(scorePct, 1);
  }
  const rankMid = rankLow !== null && rankHigh !== null ? Math.round((rankLow + rankHigh) / 2) : null;
  const band    = rankMid !== null ? rankBand(rankMid) : null;

  const myLbPos = leaderboard.findIndex(e => e.is_me);

  const SUBJECT_LABEL: Record<string, string> = {
    physics: "Physics", chemistry: "Chemistry", mathematics: "Mathematics",
  };

  return (
    <div style={{ minHeight: "100vh" }}>
      {showResultSplash && (
        <div className="splash" aria-hidden="true">
          <img src="/jeelo-logo.png" alt="Jeelo" className="splash-mascot-logo" draggable={false} />
        </div>
      )}

      <div style={{ maxWidth: 900, margin: "0 auto" }}>

        {/* ── Header ── */}
        <div className="pg-head">
          <div>
            <div className="result-breadcrumb">
              <Link to="/tests" className="result-breadcrumb-link">Tests</Link>
              <IconChevronRight size={13} />
              <span>{test.title}</span>
            </div>
            <h1 className="pg-title">Results</h1>
            <p className="pg-subtitle">{totalAttempted} of {totalQuestions} attempted · {overallAccuracy}% accuracy</p>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "flex-start", paddingTop: 8 }}>
            {test.is_published && (
              <Form method="post">
                <input type="hidden" name="intent" value="retake" />
                <button type="submit" className="btn btn-ghost btn-sm"
                  onClick={(e) => { if (!confirm("Delete your current attempt and retake?")) e.preventDefault(); }}>
                  Retake
                </button>
              </Form>
            )}
            {(totalWrong + totalMissed) > 0 && (
              layerAlreadyExists ? (
                <Link to={`/tests/${existingLayerId}`} className="btn btn-ghost btn-sm">
                  <IconLayers size={13} /> View Layer {nextLayerNum}
                </Link>
              ) : (
                <Form method="post">
                  <input type="hidden" name="intent" value="layer" />
                  <button type="submit" className="btn btn-primary btn-sm">
                    <IconLayers size={13} /> Redo missed ({totalWrong + totalMissed})
                  </button>
                </Form>
              )
            )}
          </div>
        </div>

        <div className="pg-body">

          {/* ── Rank Hero ── */}
          <div className="ro-rank-hero">
            <div className="ro-rank-main">
              <span className="ro-rank-label">Estimated Rank</span>
              {showRank && rankMid !== null ? (
                <>
                  <span className="ro-rank-number" style={{ color: band?.colour ?? "var(--c-text)" }}>
                    #{rankMid.toLocaleString()}
                  </span>
                  <span className="ro-rank-band" style={{ color: band?.colour }}>{band?.label}</span>
                  <span className="ro-rank-pct">Range: #{rankHigh!.toLocaleString()} – #{rankLow!.toLocaleString()}</span>
                </>
              ) : (
                <>
                  <span className="ro-rank-number" style={{ color: "var(--c-text-3)", fontSize: 40 }}>—</span>
                  <span className="ro-rank-band" style={{ color: "var(--c-text-3)" }}>Add 25+ questions for rank estimate</span>
                </>
              )}
              {myLbPos >= 0 && leaderboard.length > 1 && (
                <span style={{ marginTop: 8, fontSize: 12.5, fontWeight: 600, color: "var(--c-brand-500)" }}>
                  #{myLbPos + 1} on this test's leaderboard
                </span>
              )}
            </div>

            <div className="ro-rank-score-block">
              <div style={{ display: "flex", alignItems: "flex-end", gap: 6 }}>
                <span className="ro-rank-score-val" style={{ color: scoreColour(pct) }}>
                  {score?.total ?? 0}
                </span>
                <span className="ro-rank-score-of">/ {score?.max_marks ?? 0}</span>
              </div>
              <span className="ro-rank-score-label">Total Score</span>
              <div style={{
                marginTop: 10, padding: "5px 16px", borderRadius: 100,
                background: `${scoreColour(pct)}22`, color: scoreColour(pct),
                fontWeight: 700, fontSize: 20, textAlign: "center",
              }}>
                {pct}%
              </div>
            </div>
          </div>

          {/* ── Stats Row ── */}
          <div className="ro-stats-row">
            <div className="ro-stat-big correct">
              <span className="ro-stat-big-val">{totalCorrect}</span>
              <span className="ro-stat-big-label"><IconCheck size={13} strokeWidth={2.5} /> Correct</span>
            </div>
            <div className="ro-stat-big wrong">
              <span className="ro-stat-big-val">{totalWrong}</span>
              <span className="ro-stat-big-label"><IconX size={13} strokeWidth={2.5} /> Wrong</span>
            </div>
            <div className="ro-stat-big skipped">
              <span className="ro-stat-big-val">{totalMissed}</span>
              <span className="ro-stat-big-label">Skipped</span>
            </div>
            <div className="ro-stat-big">
              <span className="ro-stat-big-val" style={{ fontSize: timeTaken >= 3600 ? 22 : 36 }}>
                {formatTime(timeTaken)}
              </span>
              <span className="ro-stat-big-label"><IconClock size={13} /> Time taken</span>
            </div>
            <div className="ro-stat-big">
              <span className="ro-stat-big-val">{overallAccuracy}%</span>
              <span className="ro-stat-big-label"><IconTarget size={13} /> Accuracy</span>
            </div>
          </div>

          {/* ── Subject Breakdown ── */}
          {subjectStats.length > 0 && (
            <div className="ro-section">
              <p className="ro-section-label"><IconGraph size={13} /> Subject breakdown</p>
              <div className="ro-subjects">
                {subjectStats.map((sub) => {
                  const attempted = sub.correct + sub.wrong;
                  const acc       = attempted > 0 ? Math.round((sub.correct / attempted) * 100) : 0;
                  const colour    = scoreColour(acc);
                  const cPct      = sub.total > 0 ? (sub.correct / sub.total) * 100 : 0;
                  const wPct      = sub.total > 0 ? (sub.wrong   / sub.total) * 100 : 0;
                  return (
                    <div key={sub.subject} className="ro-subject-row">
                      <div className="ro-subject-header">
                        <span className="ro-subject-name">{SUBJECT_LABEL[sub.subject] ?? sub.subject}</span>
                        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                          <span style={{ fontSize: 12, color: "var(--c-text-3)" }}>
                            <span style={{ color: "var(--c-success)" }}>{sub.correct}</span>
                            {" · "}
                            <span style={{ color: "var(--c-error)" }}>{sub.wrong}</span>
                            {" · "}
                            {sub.missed}
                          </span>
                          <span className="ro-subject-score" style={{ color: colour }}>
                            {sub.marks > 0 ? `+${sub.marks}` : sub.marks} / {sub.positiveMarks}
                          </span>
                        </div>
                      </div>
                      <div className="ro-bar-track" style={{ display: "flex", overflow: "hidden" }}>
                        <div style={{ width: `${cPct}%`, height: "100%", background: "var(--c-success)", transition: "width 1s cubic-bezier(0.16,1,0.3,1)" }} />
                        <div style={{ width: `${wPct}%`, height: "100%", background: "var(--c-error)", transition: "width 1s cubic-bezier(0.16,1,0.3,1)" }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── Leaderboard ── */}
          <Leaderboard entries={leaderboard} testMaxMarks={score?.max_marks ?? 0} />

          {/* ── CTA ── */}
          <div className="ro-cta-row">
            <Link to={`/tests/${test.id}/result/review`} className="btn btn-primary">
              Review answers <IconChevronRight size={14} />
            </Link>
          </div>

          {/* ── Layer CTA ── */}
          {(totalWrong + totalMissed) > 0 && !layerAlreadyExists && (
            <div className="ro-layer-cta">
              <div className="ro-layer-cta-text">
                <span className="ro-layer-cta-eyebrow"><IconLayers size={12} /> Next layer</span>
                <span className="ro-layer-cta-title">{totalWrong + totalMissed} questions to retry</span>
                <span className="ro-layer-cta-body">
                  A new test is created with only the questions you missed or got wrong — timed proportionally.
                </span>
              </div>
              <Form method="post">
                <input type="hidden" name="intent" value="layer" />
                <button type="submit" className="ro-layer-cta-btn">
                  <IconLayers size={16} /> Start Layer {nextLayerNum}
                </button>
              </Form>
            </div>
          )}

          {layerAlreadyExists && (totalWrong + totalMissed) > 0 && (
            <div className="ro-layer-cta" style={{ background: "var(--c-surface-2)", border: "1px solid var(--c-border)" }}>
              <div className="ro-layer-cta-text" style={{ color: "var(--c-text)" }}>
                <span className="ro-layer-cta-eyebrow" style={{ color: "var(--c-text-3)" }}><IconLayers size={12} /> Layer already created</span>
                <span className="ro-layer-cta-title" style={{ fontSize: 22 }}>Layer {nextLayerNum} exists</span>
                <span className="ro-layer-cta-body" style={{ color: "var(--c-text-2)" }}>
                  You already created a layer from this result. Complete it before generating another.
                </span>
              </div>
              <Link to={`/tests/${existingLayerId}`} className="btn btn-ghost" style={{ flexShrink: 0, fontWeight: 600 }}>
                Go to Layer {nextLayerNum} →
              </Link>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
