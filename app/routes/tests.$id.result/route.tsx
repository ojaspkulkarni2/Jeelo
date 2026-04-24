import { redirect, Link, Form } from "react-router";
import { useState, useEffect } from "react";
import type { Route } from "./+types/route";
import { requireUser } from "~/lib/auth.server";
import { createServerClient } from "~/lib/supabase.server";
import type { ScoreBreakdown, Subject, QuestionType, ExamType } from "~/lib/database.types";
import {
  IconChevronRight, IconCheck, IconX, IconLayers,
  IconClock, IconTarget, IconGraph,
} from "~/components/icons";
import type { ResultStatus, SectionMeta, SubjectStats, LeaderboardEntry } from "./types";
import {
  computeRank, computePercentile, percentileBand, rankBand, formatTime, scoreColour,
} from "./rank-estimator";
import { Leaderboard } from "./Leaderboard";

// ── Loader ─────────────────────────────────────────────────────

export async function loader({ params, request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const user = await requireUser(request, env);
  const supabase = createServerClient(env);
  const testId = params.id!;

  const { data: test } = await supabase
    .from("tests").select("id, title, duration_mins, is_published, exam_type")
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
  const missedWrongQuestions: Array<{ qNum: number; subject: Subject; status: ResultStatus }> = [];

  let globalQuestionIndex = 0;
  for (const sec of (rawSections ?? []) as any[]) {
    const tqs = [...((sec.test_questions ?? []) as any[])]
      .sort((a: any, b: any) => a.display_order - b.display_order);
    sectionResults[sec.id] = [];
    for (const tq of tqs) {
      const q = tq.questions;
      if (!q) continue;
      globalQuestionIndex++;
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

      if (result === "wrong" || result === "missed") {
        missedWrongQuestions.push({
          qNum: globalQuestionIndex,
          subject: sec.subject as Subject,
          status: result,
        });
      }
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

  // Leaderboard: all submitted attempts for this test
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

  // Check if a next-layer test already exists for this result
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

  const subjectsPresent = new Set(sectionMeta.map(s => s.subject));

  return {
    user, test, attempt, subjectStats,
    totalCorrect, totalWrong, totalMissed, score,
    leaderboard,
    layerAlreadyExists: !!existingLayer,
    existingLayerId:    existingLayer?.id ?? null,
    nextLayerNum,
    totalQuestions:     questionResults.length,
    missedWrongQuestions,
    subjectsPresent:    Array.from(subjectsPresent) as Subject[],
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

    // Block duplicate layer
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

    // Proportional duration — scaled to missed/total, min 20 mins, rounded to 5
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

// ── Page ────────────────────────────────────────────────────────

export default function TestResultPage({ loaderData }: Route.ComponentProps) {
  const {
    test, subjectStats, totalCorrect, totalWrong, totalMissed, score,
    leaderboard, layerAlreadyExists, existingLayerId, nextLayerNum, totalQuestions,
    missedWrongQuestions, subjectsPresent,
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

  const [forceShowStats, setForceShowStats] = useState(false);

  const totalAttempted  = totalCorrect + totalWrong;
  const overallAccuracy = totalAttempted > 0 ? Math.round((totalCorrect / totalAttempted) * 100) : 0;
  const timeTaken       = (score as any)?.time_taken_seconds ?? 0;
  const pct             = score && score.max_marks > 0 ? Math.round((score.total / score.max_marks) * 100) : 0;

  const examType: ExamType = (test as any).exam_type ?? "advanced";
  const isMain = examType === "main";

  // Validation: needs all 3 subjects + more than 25 questions
  const requiredSubjects: Subject[] = ["physics", "chemistry", "mathematics"];
  const hasAllSubjects  = requiredSubjects.every(s => subjectsPresent.includes(s));
  const hasEnoughQs     = totalQuestions > 25;
  const meetsRequirements = hasAllSubjects && hasEnoughQs;
  const canShowStats    = meetsRequirements || forceShowStats;

  // Missing issues (for warning badge)
  const issues: string[] = [];
  if (!hasAllSubjects) issues.push("missing subjects");
  if (!hasEnoughQs)    issues.push("<25 questions");

  // JEE Advanced — rank
  let rankLow: number | null = null;
  let rankHigh: number | null = null;
  if (!isMain && canShowStats && score && score.max_marks > 0) {
    const scorePct = (score.total / score.max_marks) * 100;
    rankLow  = computeRank(scorePct, 10);
    rankHigh = computeRank(scorePct, 1);
  }
  const rankMid = rankLow !== null && rankHigh !== null ? Math.round((rankLow + rankHigh) / 2) : null;
  const band    = !isMain && rankMid !== null ? rankBand(rankMid) : null;

  // JEE Main — percentile
  let mainPercentile: number | null = null;
  let mainBand: { label: string; colour: string } | null = null;
  if (isMain && canShowStats && score && score.max_marks > 0) {
    mainPercentile = computePercentile((score.total / score.max_marks) * 100);
    mainBand = percentileBand(mainPercentile);
  }

  const myLbPos = leaderboard.findIndex(e => e.is_me);

  const SUBJECT_LABEL: Record<string, string> = {
    physics: "Physics", chemistry: "Chemistry", mathematics: "Mathematics",
  };

  return (
    <div style={{ minHeight: "100vh" }}>
      {showResultSplash && (
        <div className="splash" aria-hidden="true">
          <img src="/jeelo-jumping.png" alt="" className="splash-mascot-celebrate" draggable={false} />
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
            {layerAlreadyExists && (totalWrong + totalMissed) > 0 && (
              <Link to={`/tests/${existingLayerId}`} className="btn btn-ghost btn-sm">
                <IconLayers size={13} /> View Layer {nextLayerNum}
              </Link>
            )}
          </div>
        </div>

        <div className="pg-body">

          {/* ── Hero: Score + Rank (two-panel) ── */}
          <div className="ro-hero-grid">

            {/* ── Score panel (light) ── */}
            <div className="ro-score-panel">
              <span className="ro-score-eyebrow">Score</span>
              <div className="ro-score-number-row">
                <span className="ro-score-number">{score?.total ?? 0}</span>
                <span className="ro-score-denom">/{score?.max_marks ?? 0}</span>
              </div>
              <div className="ro-score-pct-badge" style={{ color: scoreColour(pct) }}>{pct}%</div>

              {subjectStats.length > 0 && (
                <div className="ro-score-subjects">
                  {subjectStats.map((sub) => {
                    const sPct = sub.positiveMarks > 0 ? (sub.marks / sub.positiveMarks) * 100 : 0;
                    const abbr = sub.subject === "physics" ? "Phy"
                               : sub.subject === "chemistry" ? "Chem" : "Math";
                    return (
                      <div key={sub.subject} className="ro-score-subject-chip">
                        <span className="ro-score-subject-abbr">{abbr}</span>
                        <span className="ro-score-subject-marks" style={{ color: scoreColour(sPct) }}>
                          {sub.marks}/{sub.positiveMarks}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}

              {myLbPos >= 0 && leaderboard.length > 1 && (
                <span className="ro-score-lb-pos">#{myLbPos + 1} on leaderboard</span>
              )}
            </div>

            {/* ── Rank panel (dark) ── */}
            <div className="ro-rank-panel">
              <span className="ro-rank-eyebrow">
                {isMain ? "Estimated Percentile" : "Estimated Rank"}
              </span>

              {forceShowStats && issues.length > 0 && (
                <span className="ro-rank-warn">⚠ {issues.join(", ")}</span>
              )}

              {canShowStats ? (
                isMain ? (
                  <>
                    <span className="ro-rank-number">
                      {mainPercentile !== null ? mainPercentile.toFixed(2) : "—"}
                    </span>
                    <span className="ro-rank-band" style={{ color: mainBand?.colour ?? "var(--c-brand-400)" }}>
                      {mainBand?.label}
                    </span>
                    <span className="ro-rank-range">out of 100</span>
                  </>
                ) : (
                  <>
                    <span className="ro-rank-number">#{rankMid!.toLocaleString()}</span>
                    <span className="ro-rank-band" style={{ color: band?.colour ?? "var(--c-brand-400)" }}>
                      {band?.label}
                    </span>
                    <span className="ro-rank-range">
                      #{rankHigh!.toLocaleString()} – #{rankLow!.toLocaleString()}
                    </span>
                  </>
                )
              ) : (
                <>
                  <span className="ro-rank-number ro-rank-number--empty">—</span>
                  <span className="ro-rank-band" style={{ color: "rgba(255,255,255,0.3)", fontSize: 13 }}>
                    {!hasAllSubjects && !hasEnoughQs
                      ? "Needs all 3 subjects & 25+ questions"
                      : !hasAllSubjects
                      ? "Needs Physics, Chemistry & Mathematics"
                      : "Add 25+ questions for estimate"}
                  </span>
                  <button
                    type="button"
                    onClick={() => setForceShowStats(true)}
                    className="ro-rank-show-anyway"
                  >
                    Show anyway
                  </button>
                </>
              )}
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

          {/* ── Missed Questions Summary ── */}
          {(totalWrong + totalMissed) > 0 && (
            <div style={{
              marginTop: 24,
              borderRadius: 14,
              background: "var(--c-surface)",
              border: "1.5px solid var(--c-border-strong)",
              overflow: "hidden",
              boxShadow: "var(--shadow-md)",
            }}>
              <div style={{
                padding: "14px 18px 12px",
                borderBottom: "1px solid var(--c-border)",
                background: "var(--c-subtle)",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between"
              }}>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: "var(--c-text-3)" }}>
                    After submitting your test
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "var(--c-text)", marginTop: 2 }}>
                    {totalWrong + totalMissed} question{(totalWrong + totalMissed) !== 1 ? "s" : ""} missed
                  </div>
                </div>
                <div style={{ display: "flex", gap: 10 }}>
                  {totalWrong > 0 && (
                    <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "var(--c-error)" }}>
                      <IconX size={11} strokeWidth={2.5} /> {totalWrong} wrong
                    </div>
                  )}
                  {totalMissed > 0 && (
                    <div style={{ fontSize: 11, color: "var(--c-text-3)" }}>
                      {totalMissed} skipped
                    </div>
                  )}
                </div>
              </div>

              <div style={{ padding: "10px 18px", display: "flex", gap: 6, flexWrap: "wrap" }}>
                {missedWrongQuestions.map((q) => {
                  const subjectShort = q.subject === "physics" ? "Phys" :
                                     q.subject === "chemistry" ? "Chem" :
                                     q.subject === "mathematics" ? "Math" : q.subject;
                  return (
                    <div key={q.qNum} style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      gap: 3,
                      padding: "6px 8px",
                      borderRadius: 7,
                      background: q.status === "wrong" ? "rgba(192,48,42,0.08)" : "var(--c-subtle)",
                      border: `1px solid ${q.status === "wrong" ? "rgba(192,48,42,0.2)" : "var(--c-border)"}`,
                    }}>
                      <span style={{
                        fontSize: 12,
                        fontWeight: 700,
                        color: q.status === "wrong" ? "var(--c-error)" : "var(--c-text-3)"
                      }}>
                        Q{q.qNum}
                      </span>
                      <span style={{ fontSize: 9, color: "var(--c-text-3)" }}>
                        {subjectShort}
                      </span>
                    </div>
                  );
                })}
              </div>

              <div style={{ padding: "12px 18px 14px", borderTop: "1px solid var(--c-border)" }}>
                {layerAlreadyExists ? (
                  <Link
                    to={`/tests/${existingLayerId}`}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      background: "var(--c-brand-500)",
                      borderRadius: 10,
                      padding: "12px 16px",
                      boxShadow: "0 4px 18px rgba(215,118,86,0.4)",
                      textDecoration: "none",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <div style={{ background: "rgba(255,255,255,0.2)", borderRadius: 7, padding: "6px 7px", display: "flex" }}>
                        <IconLayers size={15} strokeWidth={2} />
                      </div>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: "#fff" }}>
                          Go to Layer {nextLayerNum}
                        </div>
                        <div style={{ fontSize: 10, color: "rgba(255,255,255,0.7)", marginTop: 1 }}>
                          {totalWrong + totalMissed} questions waiting
                        </div>
                      </div>
                    </div>
                    <IconChevronRight size={16} style={{ color: "#fff" }} />
                  </Link>
                ) : (
                  <Form method="post">
                    <input type="hidden" name="intent" value="layer" />
                    <button
                      type="submit"
                      style={{
                        width: "100%",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        background: "var(--c-brand-500)",
                        borderRadius: 10,
                        padding: "12px 16px",
                        boxShadow: "0 4px 18px rgba(215,118,86,0.4)",
                        border: "none",
                        cursor: "pointer",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <div style={{ background: "rgba(255,255,255,0.2)", borderRadius: 7, padding: "6px 7px", display: "flex" }}>
                          <IconLayers size={15} strokeWidth={2} />
                        </div>
                        <div style={{ textAlign: "left" }}>
                          <div style={{ fontSize: 13, fontWeight: 700, color: "#fff" }}>
                            Redo missed ({totalWrong + totalMissed})
                          </div>
                          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.7)", marginTop: 1 }}>
                            Creates Layer {nextLayerNum} instantly
                          </div>
                        </div>
                      </div>
                      <IconChevronRight size={16} style={{ color: "#fff" }} />
                    </button>
                  </Form>
                )}
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
