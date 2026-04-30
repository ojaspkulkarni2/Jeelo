import { redirect, Link } from "react-router";
import React, { useState, useEffect } from "react";
import type { Route } from "./+types/tests.$id.result.review";
import { requireUser } from "~/lib/auth.server";
import { createServerClient } from "~/lib/supabase.server";
import type { Subject, QuestionType } from "~/lib/database.types";

// ── Types ──────────────────────────────────────────────────────
type ResultStatus = "correct" | "wrong" | "missed";

type ReviewQuestion = {
  id: string; image_url: string; question_number: number;
  section_id: string; section_name: string; section_subject: Subject;
  question_type: QuestionType; correct_answer: unknown;
  user_answer: unknown; result: ResultStatus;
};

type SectionMeta = {
  id: string; name: string; subject: Subject;
  question_type: QuestionType; marks_correct: number; marks_wrong: number;
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
  if (!test) throw redirect("/discover");

  const { data: attempt } = await supabase
    .from("attempts").select("id, answers, submitted_at")
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
  const reviewQuestions: ReviewQuestion[] = [];
  let qNum = 1;

  for (const sec of (rawSections ?? []) as any[]) {
    const tqs = [...((sec.test_questions ?? []) as any[])]
      .sort((a: any, b: any) => a.display_order - b.display_order);
    for (const tq of tqs) {
      const q = tq.questions; if (!q) continue;
      const state = answers[q.id]; const given = state?.answer; const status = state?.status;
      let result: ResultStatus;
      if (!state || status === "not_visited" || status === "not_answered" || given === undefined) {
        result = "missed";
      } else {
        const ca = q.correct_answer; const qt = q.type as QuestionType;
        if (qt === "scq" || qt === "paragraph") {
          result = Array.isArray(ca) && Array.isArray(given) && ca.length === 1 &&
            (given as string[]).length === 1 && ca[0] === (given as string[])[0] ? "correct" : "wrong";
        } else if (qt === "mcq") {
          if (!Array.isArray(ca) || !Array.isArray(given) || (given as string[]).length === 0) { result = "missed"; }
          else { const cSet = new Set(ca); const gArr = given as string[]; result = cSet.size === gArr.length && gArr.every(x => cSet.has(x)) ? "correct" : "wrong"; }
        } else if (qt === "integer" || qt === "numerical") {
          const gn = parseFloat(String(given)); const cn = parseFloat(String(ca));
          result = !isNaN(gn) && !isNaN(cn) && Math.abs(gn - cn) < 0.001 ? "correct" : "wrong";
        } else { result = "missed"; }
      }
      reviewQuestions.push({
        id: q.id, image_url: q.image_url, question_number: qNum++,
        section_id: sec.id, section_name: sec.name, section_subject: sec.subject,
        question_type: q.type, correct_answer: q.correct_answer, user_answer: given ?? null, result,
      });
    }
  }

  const totalCorrect = reviewQuestions.filter(q => q.result === "correct").length;
  const totalWrong   = reviewQuestions.filter(q => q.result === "wrong").length;
  const totalMissed  = reviewQuestions.filter(q => q.result === "missed").length;

  // Aggregate how many people selected each option, per question
  const { data: allAttempts } = await supabase
    .from("attempts")
    .select("answers")
    .eq("test_id", testId)
    .not("submitted_at", "is", null);

  const totalSubmitted = (allAttempts ?? []).length;
  const optionCounts: Record<string, Record<string, number>> = {};
  for (const a of (allAttempts ?? []) as any[]) {
    const ans = (a.answers ?? {}) as Record<string, { answer?: unknown }>;
    for (const [qid, state] of Object.entries(ans)) {
      const given = (state as any)?.answer;
      if (!given) continue;
      if (!optionCounts[qid]) optionCounts[qid] = {};
      const opts = Array.isArray(given) ? given : [String(given)];
      for (const opt of opts) {
        optionCounts[qid][opt] = (optionCounts[qid][opt] ?? 0) + 1;
      }
    }
  }

  return { user, test, reviewQuestions, sectionMeta, totalCorrect, totalWrong, totalMissed, optionCounts, totalSubmitted };
}

// ── Page ────────────────────────────────────────────────────────
export default function TestResultReview({ loaderData }: Route.ComponentProps) {
  const { user, test, reviewQuestions, sectionMeta, totalCorrect, totalWrong, totalMissed, optionCounts, totalSubmitted } = loaderData;

  useEffect(() => {
    const prev = {
      htmlOverflow: document.documentElement.style.overflow,
      bodyOverflow: document.body.style.overflow,
      htmlMargin:   document.documentElement.style.margin,
      bodyMargin:   document.body.style.margin,
    };
    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    document.documentElement.style.margin = "0";
    document.body.style.margin = "0";
    return () => {
      document.documentElement.style.overflow = prev.htmlOverflow;
      document.body.style.overflow            = prev.bodyOverflow;
      document.documentElement.style.margin   = prev.htmlMargin;
      document.body.style.margin              = prev.bodyMargin;
    };
  }, []);

  const [currentIdx,       setCurrentIdx]       = useState(0);
  const [activeSectionIdx, setActiveSectionIdx] = useState(0);
  const [sectionInfoOpen,  setSectionInfoOpen]  = useState(false);

  const currentQ = reviewQuestions[currentIdx];

  useEffect(() => {
    if (!currentQ) return;
    const sIdx = sectionMeta.findIndex((s: any) => s.id === currentQ.section_id);
    if (sIdx >= 0) setActiveSectionIdx(sIdx);
  }, [currentIdx]); // eslint-disable-line

  function goToSection(i: number) {
    setActiveSectionIdx(i);
    const firstInSection = reviewQuestions.findIndex((q: any) => q.section_id === sectionMeta[i]?.id);
    if (firstInSection >= 0) setCurrentIdx(firstInSection);
  }

  const sectionQs = reviewQuestions.filter((q: any) => q.section_id === sectionMeta[activeSectionIdx]?.id);

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", fontFamily: FONT, overflow: "hidden" }}>

      {/* Top bar */}
      <div style={TOP_BAR}>
        <span style={{ color: JEE_GOLD, fontWeight: 700, fontSize: 13, letterSpacing: "0.02em", flex: 1 }}>
          {test.title.toUpperCase()} — REVIEW
        </span>
        <Link to={`/tests/${test.id}/result`} style={{ textDecoration: "none", color: "inherit" }}>
          <TopUtilBtn label="Back to Results" circleColor="#2196f3" />
        </Link>
      </div>

      {/* Summary pills bar */}
      <div style={{ background: "#fff", borderBottom: "2px solid #ccc", display: "flex", alignItems: "center", padding: "6px 12px", gap: 8, flexShrink: 0 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: "#374151", marginRight: 4 }}>Review Questions</span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
          {[
            { count: totalCorrect, label: "Correct",       color: "#15803d", bg: "#dcfce7" },
            { count: totalWrong,   label: "Incorrect",     color: "#dc2626", bg: "#fee2e2" },
            { count: totalMissed,  label: "Not Attempted", color: "#6b7280", bg: "#f3f4f6" },
          ].map(item => (
            <div key={item.label} style={{ background: item.bg, color: item.color, fontSize: 11, fontWeight: 600, borderRadius: 20, padding: "3px 10px", display: "flex", gap: 4 }}>
              <span style={{ fontWeight: 800 }}>{item.count}</span>
              <span style={{ fontWeight: 400 }}>{item.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Subject tab strip */}
      <div style={{ background: "#fff", borderBottom: "2px solid #ccc", padding: "5px 10px", display: "flex", alignItems: "center", flexShrink: 0 }}>
        <div style={{ background: JEE_BLUE, color: "#fff", padding: "4px 14px", borderRadius: 4, fontSize: 13, display: "flex", alignItems: "center", gap: 6, maxWidth: 280, overflow: "hidden" }}>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{test.title}</span>
          <div style={{ background: "#fff", color: JEE_BLUE, borderRadius: "50%", width: 16, height: 16, fontSize: 10, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, flexShrink: 0 }}>i</div>
        </div>
      </div>

      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>

        {/* Left: question review area */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", borderRight: "1px solid #ccc" }}>

          {/* Section pill nav */}
          <div style={{ borderBottom: "1px solid #ccc", padding: "5px 8px", display: "flex", alignItems: "center", gap: 6, flexShrink: 0, background: "#fafafa", flexWrap: "wrap" }}>
            <span style={{ fontSize: 13, color: "#444", fontWeight: 500, marginRight: 4 }}>Sections</span>
            {sectionMeta.map((sec: any, i: number) => (
              <button key={sec.id} type="button" onClick={() => goToSection(i)}
                style={{ background: activeSectionIdx === i ? JEE_BLUE : "#e0e0e0", color: activeSectionIdx === i ? "#fff" : "#333", border: "none", borderRadius: 4, padding: "5px 14px", fontSize: 13, fontWeight: 500, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
                {sec.name}
                {activeSectionIdx === i && (
                  <div style={{ background: "#fff", color: JEE_BLUE, borderRadius: "50%", width: 14, height: 14, fontSize: 9, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700 }}>i</div>
                )}
              </button>
            ))}
          </div>

          {/* Question number + result badge */}
          {currentQ && (() => {
            const cfg = RESULT_CFG[currentQ.result];
            return (
              <div style={{ borderBottom: "1px solid #eee", padding: "5px 14px", display: "flex", alignItems: "center", gap: 10, flexShrink: 0, fontSize: 13, background: "#fff" }}>
                <strong>Question No. {currentIdx + 1}</strong>
                <span style={{ background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.border}`, fontSize: 11, fontWeight: 700, borderRadius: 4, padding: "2px 9px" }}>
                  {cfg.icon} {cfg.label}
                </span>
              </div>
            );
          })()}

          {/* Scrollable content — question image only, answer panel moved to sidebar */}
          <div style={{ flex: 1, overflowY: "auto", overflowX: "auto", background: "#fff" }} data-scroll-area>
            <div style={{ padding: "10px 14px" }}>

              {/* Section info collapsible */}
              {currentQ && (
                <div style={{ border: "1px solid #bbb", borderRadius: 3, marginBottom: 14, overflow: "hidden" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "7px 14px", background: "#fff", borderBottom: sectionInfoOpen ? "1px solid #bbb" : "none" }}>
                    <strong style={{ fontSize: 13 }}>{currentQ.section_name}</strong>
                    <button type="button" onClick={() => setSectionInfoOpen(v => !v)}
                      style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, color: "#555", lineHeight: 1, padding: "0 4px" }}>
                      {sectionInfoOpen ? "∧" : "∨"}
                    </button>
                  </div>
                  {sectionInfoOpen && (
                    <div style={{ padding: "8px 14px", fontSize: 12, color: "#555", background: "#fafafa" }}>
                      Question Type: <strong>{TYPE_LABELS[currentQ.question_type] ?? currentQ.question_type}</strong>
                      {" · "}Subject: <strong style={{ color: SUBJECT_CFG[currentQ.section_subject]?.color }}>{SUBJECT_CFG[currentQ.section_subject]?.label ?? currentQ.section_subject}</strong>
                    </div>
                  )}
                </div>
              )}

              {/* Question image — full width, no competing panels */}
              {currentQ && currentQ.image_url && (
                <div style={{ overflow: "hidden", maxWidth: "100%" }}>
                  <img key={currentQ.id} src={currentQ.image_url} alt={`Question ${currentIdx + 1}`}
                    style={{ maxWidth: "100%", width: "100%", height: "auto", display: "block", objectFit: "contain" }} />
                </div>
              )}
              {currentQ && !currentQ.image_url && (
                <div style={{ padding: "20px", background: "#f9fafb", border: "1px dashed #d1d5db", borderRadius: 6, textAlign: "center", color: "#9ca3af", fontSize: 13 }}>
                  No image available for this question.
                </div>
              )}

              {reviewQuestions.length === 0 && (
                <div style={{ textAlign: "center", color: "#999", padding: 60, fontSize: 14 }}>No questions found.</div>
              )}
            </div>
          </div>
        </div>

        {/* Right: answer panel + result palette */}
        <div style={{ width: 260, display: "flex", flexDirection: "column", overflow: "hidden", background: "#f5f5f5", flexShrink: 0 }}>
          <div style={{ padding: "10px 12px", borderBottom: "1px solid #ddd", display: "flex", alignItems: "center", gap: 10, background: "#fff" }}>
            <UserAvatar size={40} />
            <span style={{ fontSize: 13, fontWeight: 700, color: "#1a3a6b", lineHeight: 1.3 }}>{user.display_name}</span>
          </div>

          {/* ── Answer comparison panel — lives in sidebar ── */}
          {currentQ && (() => {
            const cfg = RESULT_CFG[currentQ.result];
            return (
              <div style={{ borderBottom: "2px solid #ddd", background: "#fff", flexShrink: 0 }}>
                <div style={{ background: cfg.bg, borderBottom: `1px solid ${cfg.border}`, padding: "7px 12px", display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: cfg.color }}>{cfg.icon} {cfg.label}</span>
                </div>
                <div style={{ padding: "10px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
                  <div style={{ background: cfg.bg, border: `1px solid ${cfg.border}`, borderRadius: 5, padding: "8px 10px" }}>
                    <p style={{ margin: "0 0 3px", fontSize: 10, fontWeight: 600, color: "#6b7280", textTransform: "uppercase" as const, letterSpacing: "0.04em" }}>Your Answer</p>
                    <p style={{ margin: 0, fontSize: 15, fontWeight: 700, color: cfg.color, wordBreak: "break-word" as const }}>
                      {currentQ.result === "missed" ? <em style={{ fontWeight: 400, fontSize: 13 }}>Not attempted</em> : formatAnswer(currentQ.user_answer)}
                    </p>
                  </div>
                  <div style={{ background: "rgba(74,222,128,0.08)", border: "1px solid rgba(74,222,128,0.25)", borderRadius: 5, padding: "8px 10px" }}>
                    <p style={{ margin: "0 0 3px", fontSize: 10, fontWeight: 600, color: "#6b7280", textTransform: "uppercase" as const, letterSpacing: "0.04em" }}>Correct Answer</p>
                    <p style={{ margin: 0, fontSize: 15, fontWeight: 700, color: "#15803d", wordBreak: "break-word" as const }}>{formatAnswer(currentQ.correct_answer)}</p>
                  </div>

                  {/* Option distribution — SCQ/paragraph only */}
                  {(currentQ.question_type === "scq" || currentQ.question_type === "paragraph") && totalSubmitted > 0 && (() => {
                    const counts = optionCounts[currentQ.id] ?? {};
                    const correctOpt = Array.isArray(currentQ.correct_answer)
                      ? currentQ.correct_answer[0]
                      : String(currentQ.correct_answer ?? "");
                    return (
                      <div style={{ marginTop: 4, display: "flex", flexDirection: "column", gap: 4 }}>
                        {["A", "B", "C", "D"].map(letter => {
                          const n = counts[letter] ?? 0;
                          const pct = Math.round((n / totalSubmitted) * 100);
                          const isCorrect = letter === correctOpt;
                          const isYours = Array.isArray(currentQ.user_answer)
                            ? (currentQ.user_answer as string[]).includes(letter)
                            : false;
                          return (
                            <div key={letter} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                              <span style={{
                                width: 20, height: 20, borderRadius: "50%", flexShrink: 0,
                                border: isCorrect ? "2px solid #15803d" : "1.5px solid #d1d5db",
                                display: "flex", alignItems: "center", justifyContent: "center",
                                fontSize: 10, fontWeight: 700,
                                color: isCorrect ? "#15803d" : "#6b7280",
                                background: isCorrect ? "rgba(74,222,128,0.1)" : "transparent",
                              }}>
                                {letter}
                              </span>
                              <div style={{ flex: 1, height: 14, background: "#f3f4f6", borderRadius: 3, overflow: "hidden", position: "relative" }}>
                                <div style={{
                                  width: `${pct}%`, height: "100%", borderRadius: 3,
                                  background: isCorrect ? "rgba(74,222,128,0.5)" : isYours ? "rgba(239,68,68,0.35)" : "rgba(156,163,175,0.4)",
                                  transition: "width 0.5s ease",
                                }} />
                              </div>
                              <span style={{ fontSize: 10, color: "#6b7280", minWidth: 28, textAlign: "right" as const }}>{pct}%</span>
                            </div>
                          );
                        })}
                        <p style={{ margin: "2px 0 0", fontSize: 9, color: "#9ca3af" }}>{totalSubmitted} attempt{totalSubmitted !== 1 ? "s" : ""}</p>
                      </div>
                    );
                  })()}
                </div>
              </div>
            );
          })()}

          <div style={{ padding: "8px 10px", borderBottom: "1px solid #ddd", background: "#fff", flexShrink: 0 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "5px 6px" }}>
              <ResultLegendItem count={totalCorrect} label="Correct"       status="correct" />
              <ResultLegendItem count={totalWrong}   label="Incorrect"     status="wrong"   />
              <ResultLegendItem count={totalMissed}  label="Not Attempted" status="missed"  />
            </div>
          </div>

          <div style={{ background: JEE_BLUE, color: "#fff", padding: "6px 12px", fontSize: 13, fontWeight: 600, flexShrink: 0 }}>
            {sectionMeta[activeSectionIdx]?.name ?? ""}
          </div>
          <div style={{ padding: "3px 12px 4px", fontSize: 11, color: "#555", borderBottom: "1px solid #ddd", flexShrink: 0, background: "#fff" }}>
            Click a question to review it
          </div>

          <div style={{ flex: 1, overflowY: "auto", padding: "8px 10px", background: "#fff" }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 4 }}>
              {sectionQs.map((q: any) => {
                const globalIdx = reviewQuestions.findIndex((rq: any) => rq.id === q.id);
                return (
                  <button key={q.id} type="button" onClick={() => setCurrentIdx(globalIdx)}
                    style={{ background: "none", border: "none", cursor: "pointer", padding: 0 }}>
                    <ResultPaletteIcon result={q.result} num={q.question_number} active={globalIdx === currentIdx} />
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Bottom navigation */}
      <div style={{ background: "#efefef", borderTop: "2px solid #ccc", padding: "7px 12px", display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
        <button type="button"
          disabled={currentIdx === 0 || reviewQuestions.length === 0}
          onClick={() => setCurrentIdx(i => Math.max(0, i - 1))}
          style={{ ...btnNav, opacity: currentIdx === 0 ? 0.4 : 1, cursor: currentIdx === 0 ? "not-allowed" : "pointer" }}>
          ← Previous
        </button>
        <button type="button"
          disabled={reviewQuestions.length === 0 || currentIdx === reviewQuestions.length - 1}
          onClick={() => setCurrentIdx(i => Math.min(reviewQuestions.length - 1, i + 1))}
          style={{ ...btnNav, opacity: currentIdx === reviewQuestions.length - 1 ? 0.4 : 1, cursor: currentIdx === reviewQuestions.length - 1 ? "not-allowed" : "pointer" }}>
          Next →
        </button>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ fontSize: 12, color: "#555" }}>{currentIdx + 1} / {reviewQuestions.length}</span>
          <Link to={`/tests/${test.id}/result`}
            style={{ background: JEE_BLUE, color: "#fff", border: "none", borderRadius: 4, padding: "8px 18px", fontSize: 13, fontWeight: 600, textDecoration: "none" }}>
            ← Overview
          </Link>
        </div>
      </div>

      {/* Scroll-to-top */}
      <button type="button" title="Scroll to top"
        onClick={() => { const el = document.querySelector("[data-scroll-area]") as HTMLElement; if (el) el.scrollTop = 0; }}
        style={{ position: "fixed", bottom: 58, right: 272, zIndex: 40, background: "#1a6eb5", color: "#fff", border: "none", borderRadius: "50%", width: 36, height: 36, fontSize: 16, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 2px 8px rgba(0,0,0,0.3)" }}>
        ↑
      </button>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────

function UserAvatar({ size }: { size: number }) {
  return (
    <div style={{ width: size, height: size, borderRadius: 4, overflow: "hidden", background: "#d6e8f5", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <svg width={size} height={size} viewBox="0 0 52 52" fill="none">
        <rect width="52" height="52" fill="#d6e8f5"/>
        <circle cx="26" cy="20" r="10" fill="#7aaecf"/>
        <ellipse cx="26" cy="42" rx="16" ry="10" fill="#7aaecf"/>
      </svg>
    </div>
  );
}

const RESULT_PALETTE_CFG: Record<ResultStatus, { bg: string; text: string; shape: string }> = {
  correct: { bg: "linear-gradient(180deg,#6abe38 0%,#2d8a1a 100%)", text: "#fff", shape: "hex-up"   },
  wrong:   { bg: "linear-gradient(180deg,#e55c30 0%,#c03020 100%)", text: "#fff", shape: "hex-down" },
  missed:  { bg: "linear-gradient(180deg,#f8f8f8 0%,#d8d8d8 100%)", text: "#444", shape: "square"   },
};

const SHAPE_CLIP: Record<string, string | undefined> = {
  "square":   undefined,
  "hex-down": "polygon(0% 0%, 100% 0%, 100% 72%, 76% 100%, 24% 100%, 0% 72%)",
  "hex-up":   "polygon(24% 0%, 76% 0%, 100% 28%, 100% 100%, 0% 100%, 0% 28%)",
};

function ResultPaletteIcon({ result, num, active }: { result: ResultStatus; num: number; active: boolean }) {
  const cfg = RESULT_PALETTE_CFG[result];
  const S = 36;
  return (
    <div style={{ width: S, height: S, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ width: S, height: S, background: cfg.bg, borderRadius: cfg.shape === "square" ? 4 : 0, clipPath: SHAPE_CLIP[cfg.shape], display: "flex", alignItems: "center", justifyContent: "center", outline: active ? "3px solid #1a3a6b" : "none", outlineOffset: 1, boxSizing: "border-box" as const }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: cfg.text, lineHeight: 1 }}>{num}</span>
      </div>
    </div>
  );
}

function ResultLegendItem({ count, label, status }: { count: number; label: string; status: ResultStatus }) {
  const cfg = RESULT_PALETTE_CFG[status];
  const S = 22;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <div style={{ width: S, height: S, background: cfg.bg, borderRadius: cfg.shape === "square" ? 3 : 0, clipPath: SHAPE_CLIP[cfg.shape], flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", boxSizing: "border-box" as const }}>
        <span style={{ fontSize: 9, fontWeight: 700, color: cfg.text }}>{count}</span>
      </div>
      <span style={{ fontSize: 10, color: "#444", lineHeight: 1.3 }}>{label}</span>
    </div>
  );
}

function TopUtilBtn({ label, circleColor }: { label: string; circleColor: string }) {
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 5, color: "#fff", fontSize: 12, whiteSpace: "nowrap" }}>
      <span style={{ width: 22, height: 22, borderRadius: "50%", background: circleColor, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M19 12H5"/><path d="M12 5l-7 7 7 7"/>
        </svg>
      </span>
      {label}
    </span>
  );
}

// ── Constants ──────────────────────────────────────────────────

const FONT     = "Arial, 'Helvetica Neue', Helvetica, sans-serif";
const JEE_GOLD = "#f5c000";
const JEE_BLUE = "#4169a1";

function formatAnswer(val: unknown): string {
  if (val === null || val === undefined) return "—";
  if (Array.isArray(val)) return (val as string[]).join(", ");
  return String(val);
}

const SUBJECT_CFG: Record<Subject, { label: string; color: string }> = {
  physics:     { label: "Physics",     color: "#1d4ed8" },
  chemistry:   { label: "Chemistry",   color: "#15803d" },
  mathematics: { label: "Mathematics", color: "#7c3aed" },
};

const TYPE_LABELS: Partial<Record<QuestionType, string>> = {
  scq: "Single Correct", mcq: "Multiple Correct",
  integer: "Integer", numerical: "Numerical", paragraph: "Paragraph",
};

const RESULT_CFG: Record<ResultStatus, { border: string; bg: string; color: string; icon: string; label: string }> = {
  correct: { border: "#bbf7d0", bg: "#f0fdf4", color: "#15803d", icon: "✓", label: "Correct"       },
  wrong:   { border: "#fecaca", bg: "#fef2f2", color: "#dc2626", icon: "✗", label: "Incorrect"     },
  missed:  { border: "#e5e7eb", bg: "#f9fafb", color: "#9ca3af", icon: "—", label: "Not Attempted"  },
};

const TOP_BAR: React.CSSProperties = {
  background: "#1d1d00", color: "#fff",
  padding: "0 14px", height: 40,
  display: "flex", alignItems: "center", flexShrink: 0, gap: 12,
};

const btnNav: React.CSSProperties = {
  background: JEE_BLUE, color: "#fff", border: "none",
  borderRadius: 4, padding: "8px 18px", fontSize: 13, fontWeight: 600,
};
