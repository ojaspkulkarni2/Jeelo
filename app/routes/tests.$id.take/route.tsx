import { redirect, useFetcher, useNavigate } from "react-router";
import React, { useState, useEffect, useRef } from "react";
import type { Route } from "./+types/route";
import { requireUser } from "~/lib/auth.server";
import { createServerClient } from "~/lib/supabase.server";
import type { QuestionType, QuestionStatus, AttemptAnswers, ScoreBreakdown } from "~/lib/database.types";
import type { QuestionRow, SectionQuestion, Section, Test, Attempt } from "./types";
import {
  FONT, JEE_GOLD, JEE_BLUE, PALETTE_CFG, STATUS_MEANINGS, TYPE_LABELS,
  getTopBarStyle, btnMarkReview, btnClear, btnSaveNext, btnSubmit,
  MODAL_OVERLAY, MODAL_HEADER, MODAL_CLOSE_BTN, MODAL_WARNING,
  thStyle, tdStyle, confirmTd,
} from "./constants";
import { UserAvatar, SectionInstructions, PaletteIcon, LegendItem, TopUtilBtn, AnswerInput } from "./ui";

// ── Loader ─────────────────────────────────────────────────────

export async function loader({ params, request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const user = await requireUser(request, env);
  const supabase = createServerClient(env);
  const testId = params.id!;

  const { data: test, error: testError } = await supabase
    .from("tests")
    .select("id, title, duration_mins, is_published")
    .eq("id", testId)
    .single();

  if (testError || !test) throw redirect("/discover");
  if (!test.is_published) throw redirect(`/tests/${testId}`);

  const { data: rawSections } = await supabase
    .from("test_sections")
    .select(`
      id, name, question_type, subject,
      marks_correct, marks_wrong, marks_partial, display_order,
      test_questions(
        display_order,
        questions(id, image_url, type, subject, chapter, correct_answer, paragraph_id)
      )
    `)
    .eq("test_id", testId)
    .order("display_order", { ascending: true });

  // Collect paragraph IDs needed across all sections
  const paragraphIds = new Set<string>();
  for (const s of (rawSections ?? []) as any[]) {
    for (const tq of (s.test_questions ?? []) as any[]) {
      if (tq.questions?.paragraph_id) paragraphIds.add(tq.questions.paragraph_id);
    }
  }

  // Batch-fetch paragraph images
  const paragraphImageMap = new Map<string, string>();
  if (paragraphIds.size > 0) {
    const { data: paragraphs } = await supabase
      .from("paragraphs")
      .select("id, image_url")
      .in("id", Array.from(paragraphIds));
    for (const p of (paragraphs ?? []) as any[]) {
      paragraphImageMap.set(p.id, p.image_url);
    }
  }

  const sections: Section[] = (rawSections ?? []).map((s: any) => ({
    id: s.id,
    name: s.name,
    question_type: s.question_type as QuestionType,
    subject: s.subject,
    marks_correct: s.marks_correct,
    marks_wrong: s.marks_wrong,
    marks_partial: s.marks_partial,
    display_order: s.display_order,
    questions: ((s.test_questions ?? []) as any[])
      .sort((a: any, b: any) => a.display_order - b.display_order)
      .map((tq: any) => ({
        display_order: tq.display_order,
        ...(tq.questions as QuestionRow),
        paragraph_id: tq.questions?.paragraph_id ?? null,
        paragraph_image_url: tq.questions?.paragraph_id
          ? (paragraphImageMap.get(tq.questions.paragraph_id) ?? null)
          : null,
      })),
  }));

  let { data: attempt } = await supabase
    .from("attempts")
    .select("id, answers, started_at, submitted_at, score_breakdown")
    .eq("test_id", testId)
    .eq("student_id", user.id)
    .maybeSingle();

  if (attempt?.submitted_at) throw redirect(`/tests/${testId}/result`);

  if (!attempt) {
    const { data: newAttempt } = await supabase
      .from("attempts")
      .insert({ test_id: testId, student_id: user.id, answers: {} })
      .select("id, answers, started_at, submitted_at, score_breakdown")
      .single();
    attempt = newAttempt;
  }

  if (!attempt) throw redirect("/discover");

  return { user, test: test as Test, sections, attempt: attempt as Attempt };
}

// ── Action ─────────────────────────────────────────────────────

export async function action({ params, request, context }: Route.ActionArgs) {
  const env = context.cloudflare.env;
  const user = await requireUser(request, env);
  const supabase = createServerClient(env);
  const testId = params.id!;

  const { data: attempt } = await supabase
    .from("attempts")
    .select("id, answers, submitted_at")
    .eq("test_id", testId)
    .eq("student_id", user.id)
    .single();

  if (!attempt) return null;
  if (attempt.submitted_at) throw redirect(`/tests/${testId}/result`);

  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");

  if (intent === "submit") {
    const answersRaw = String(formData.get("answers") ?? "{}");
    const timeTakenSeconds = parseInt(String(formData.get("time_taken_seconds") ?? "0"), 10);
    let answers: AttemptAnswers = {};
    try { answers = JSON.parse(answersRaw); } catch { /* noop */ }

    const { data: rawSections } = await supabase
      .from("test_sections")
      .select(`id, name, marks_correct, marks_wrong, marks_partial,
        test_questions(question_id, questions(correct_answer, type))`)
      .eq("test_id", testId)
      .order("display_order", { ascending: true });

    let maxMarks = 0, grandTotal = 0;

    const scoredSections = (rawSections ?? []).map((sec: any) => {
      let correct = 0, wrong = 0, unattempted = 0, partial = 0, sectionMarks = 0;
      for (const tq of (sec.test_questions ?? []) as any[]) {
        const qid: string = tq.question_id;
        const correctAnswer = tq.questions?.correct_answer;
        const qtype: QuestionType = tq.questions?.type;
        const state = answers[qid];
        maxMarks += sec.marks_correct;
        if (!state || state.status === "not_visited" || state.status === "not_answered" || state.answer === undefined) {
          unattempted++; continue;
        }
        const given = state.answer;
        if (qtype === "scq" || qtype === "paragraph") {
          const ok = Array.isArray(correctAnswer) && Array.isArray(given) &&
            correctAnswer.length === 1 && (given as string[]).length === 1 &&
            correctAnswer[0] === (given as string[])[0];
          if (ok) { correct++; sectionMarks += sec.marks_correct; }
          else    { wrong++;   sectionMarks += sec.marks_wrong;   }
        } else if (qtype === "mcq") {
          if (!Array.isArray(correctAnswer) || !Array.isArray(given) || (given as string[]).length === 0) { unattempted++; continue; }
          const cSet = new Set<string>(correctAnswer);
          const gArr = given as string[];
          if (cSet.size === gArr.length && gArr.every(x => cSet.has(x))) {
            correct++; sectionMarks += sec.marks_correct;
          } else if (gArr.every(x => cSet.has(x)) && sec.marks_partial != null) {
            partial++; sectionMarks += sec.marks_partial * gArr.length;
          } else {
            wrong++; sectionMarks += sec.marks_wrong;
          }
        } else if (qtype === "integer" || qtype === "numerical") {
          const gn = typeof given === "number" ? given : parseFloat(String(given));
          const cn = typeof correctAnswer === "number" ? correctAnswer : parseFloat(String(correctAnswer));
          if (!isNaN(gn) && !isNaN(cn) && Math.abs(gn - cn) < 0.001) { correct++; sectionMarks += sec.marks_correct; }
          else { wrong++; sectionMarks += sec.marks_wrong; }
        } else { unattempted++; }
      }
      grandTotal += sectionMarks;
      return { section_id: sec.id, section_name: sec.name, marks: sectionMarks, correct, wrong, unattempted, partial };
    });

    await supabase.from("attempts").update({
      answers: answers as any,
      submitted_at: new Date().toISOString(),
      score_breakdown: { total: grandTotal, max_marks: maxMarks, sections: scoredSections, time_taken_seconds: isNaN(timeTakenSeconds) ? 0 : timeTakenSeconds } as any,
    }).eq("id", attempt.id);

    // ── Mark practice_done for each chapter covered by this test ──
    // Also mark curated_done if score >= 60% of max marks
    const pctScore = maxMarks > 0 ? grandTotal / maxMarks : 0;
    const now = new Date().toISOString();

    // Collect chapter IDs from questions in this test
    const { data: chapterRows } = await supabase
      .from("test_questions")
      .select("questions!question_id(chapter_id)")
      .in("section_id", (rawSections ?? []).map((s: any) => s.id));

    const chapterIds = [...new Set(
      (chapterRows ?? [])
        .map((r: any) => r.questions?.chapter_id)
        .filter(Boolean)
    )];

    if (chapterIds.length > 0) {
      for (const chId of chapterIds) {
        const upsertPayload: Record<string, any> = {
          user_id:    user.id,
          chapter_id: chId,
          practice_done:    true,
          practice_done_at: now,
          last_activity:    now,
        };
        if (pctScore >= 0.6) {
          upsertPayload.curated_done    = true;
          upsertPayload.curated_done_at = now;
        }
        await supabase.from("chapter_progress").upsert(upsertPayload, {
          onConflict: "user_id,chapter_id",
        });
      }
    }

    throw redirect(`/tests/${testId}/result`);
  }

  return null;
}

// ── Component ──────────────────────────────────────────────────

export default function TakeTest({ loaderData }: Route.ComponentProps) {
  const { user, test, sections, attempt } = loaderData;
  const submitFetcher = useFetcher();
  const navigate = useNavigate();
  const [submitError, setSubmitError] = useState(false);

  // Lock page scroll — prevents the 2mm body/html scroll
  useEffect(() => {
    const prev = { html: document.documentElement.style.overflow, body: document.body.style.overflow };
    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    document.documentElement.style.margin = "0";
    document.body.style.margin = "0";
    return () => {
      document.documentElement.style.overflow = prev.html;
      document.body.style.overflow = prev.body;
    };
  }, []);

  const elapsedAtMount = useRef(
    attempt.started_at ? Math.floor((Date.now() - new Date(attempt.started_at).getTime()) / 1000) : 0
  );
  const clientStartMs = useRef(Date.now());

  const allQuestions: (SectionQuestion & { sectionId: string; sectionIdx: number })[] = [];
  sections.forEach((sec, si) =>
    sec.questions.forEach(q => allQuestions.push({ ...q, sectionId: sec.id, sectionIdx: si }))
  );

  const totalDurationSeconds = test.duration_mins * 60;
  const initialSeconds = Math.max(0, totalDurationSeconds - elapsedAtMount.current);

  const [hasStarted,       setHasStarted]       = useState(false);
  const [currentIdx,       setCurrentIdx]        = useState(0);
  const [answers,          setAnswers]           = useState<AttemptAnswers>(() => {
    try {
      const saved = localStorage.getItem(`jeelo_answers_${attempt.id}`);
      if (saved) return JSON.parse(saved) as AttemptAnswers;
    } catch { /* ignore */ }
    return attempt.answers ?? {};
  });
  const [timeLeft,         setTimeLeft]          = useState(initialSeconds);
  const [activeSectionIdx, setActiveSectionIdx]  = useState(0);
  const [submitted,        setSubmitted]         = useState(false);
  const [showConfirm,      setShowConfirm]       = useState(false);
  const [draftAnswer,      setDraftAnswer]       = useState<unknown>(null);
  const [showQPaper,       setShowQPaper]        = useState(false);
  const [showInstrModal,   setShowInstrModal]    = useState(false);
  const [showAccess,       setShowAccess]        = useState(false);
  const [zoom,             setZoom]              = useState(1.0);
  const [sectionInfoOpen,  setSectionInfoOpen]   = useState(true);
  const [agreed,           setAgreed]            = useState(false);

  const [hasDraft] = useState(() => {
    try { return !!localStorage.getItem(`jeelo_answers_${attempt.id}`); } catch { return false; }
  });

  const [darkMode,         setDarkMode]          = useState(() => {
    try { return localStorage.getItem("jeelo-theme") === "dark"; } catch { return false; }
  });
  const [fontSize,         setFontSize]          = useState<13 | 16 | 20>(13);
  const [cursorTrail,      setCursorTrail]       = useState(false);
  const [cursorSize,       setCursorSize]        = useState<12 | 16 | 22>(12);

  const [mousePos,     setMousePos]     = useState({ x: -200, y: -200 });
  const [trailDots,    setTrailDots]    = useState<Array<{ x: number; y: number; id: number }>>([]);
  const trailCounter   = useRef(0);
  const cursorTrailRef = useRef(cursorTrail);
  cursorTrailRef.current = cursorTrail;
  const cursorSizeRef  = useRef(cursorSize);
  cursorSizeRef.current = cursorSize;

  const submittedRef  = useRef(false);
  const answersRef    = useRef<AttemptAnswers>(answers);
  answersRef.current  = answers;
  const timeLeftRef   = useRef(initialSeconds);

  const lsKey = `jeelo_answers_${attempt.id}`;

  const currentQ       = allQuestions[currentIdx];
  const currentSection = currentQ ? sections.find(s => s.id === currentQ.sectionId) ?? null : null;

  useEffect(() => {
    const state = currentQ ? answers[currentQ.id] : undefined;
    setDraftAnswer(state?.answer !== undefined ? state.answer : null);
  }, [currentIdx]); // eslint-disable-line

  useEffect(() => {
    if (!currentQ) return;
    setAnswers(prev => {
      if (prev[currentQ.id]) return prev;
      return { ...prev, [currentQ.id]: { status: "not_answered" } };
    });
  }, [currentIdx]); // eslint-disable-line

  useEffect(() => {
    if (currentQ) setActiveSectionIdx(currentQ.sectionIdx);
  }, [currentIdx]); // eslint-disable-line

  useEffect(() => {
    if (submitted || !hasStarted) return;
    const interval = setInterval(() => {
      timeLeftRef.current -= 1;
      setTimeLeft(timeLeftRef.current);
      if (timeLeftRef.current <= 0) { clearInterval(interval); doSubmit(); }
    }, 1000);
    return () => clearInterval(interval);
  }, [submitted, hasStarted]); // eslint-disable-line

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      setMousePos({ x: e.clientX, y: e.clientY });
      if (cursorTrailRef.current) {
        const id = trailCounter.current++;
        setTrailDots(prev => [...prev.slice(-14), { x: e.clientX, y: e.clientY, id }]);
      }
    };
    window.addEventListener("mousemove", onMove);
    return () => window.removeEventListener("mousemove", onMove);
  }, []);

  useEffect(() => {
    if (!cursorTrail || trailDots.length === 0) return;
    const t = setTimeout(() => setTrailDots(prev => prev.slice(1)), 60);
    return () => clearTimeout(t);
  }, [cursorTrail, trailDots]);

  useEffect(() => {
    try { localStorage.setItem(lsKey, JSON.stringify(answers)); } catch { /* ignore */ }
  }, [answers, lsKey]);

  const submitFetcherWasActiveRef = useRef(false);
  useEffect(() => {
    if (!submitted) return;
    if (submitFetcher.state !== "idle") {
      submitFetcherWasActiveRef.current = true;
      return;
    }
    if (!submitFetcherWasActiveRef.current) return;
    if (submitFetcher.data === undefined) {
      setSubmitError(true);
      return;
    }
    const timer = setTimeout(() => {
      navigate(`/tests/${test.id}/result`, { replace: true });
    }, 1200);
    return () => clearTimeout(timer);
  }, [submitFetcher.state, submitFetcher.data, submitted]); // eslint-disable-line

  function doSubmit() {
    if (submittedRef.current) return;
    submittedRef.current = true;
    setSubmitted(true);
    setSubmitError(false);

    const timeTaken = elapsedAtMount.current + Math.floor((Date.now() - clientStartMs.current) / 1000);
    const fd = new FormData();
    fd.append("intent", "submit");
    fd.append("answers", JSON.stringify(answersRef.current));
    fd.append("time_taken_seconds", String(timeTaken));

    try { localStorage.removeItem(lsKey); } catch { /* ignore */ }
    try { sessionStorage.setItem("jeelo-show-result-splash", "1"); } catch { /* ignore */ }
    submitFetcher.submit(fd, { method: "post" });
  }

  function retrySubmit() {
    submittedRef.current = false;
    setSubmitted(false);
    setSubmitError(false);
    setTimeout(doSubmit, 50);
  }

  function saveAndNext(status: QuestionStatus) {
    if (!currentQ) return;
    const isEmpty = draftAnswer === null || (Array.isArray(draftAnswer) && draftAnswer.length === 0);
    const effectiveStatus: QuestionStatus = isEmpty ? "not_answered" : status;
    const updatedAnswers = {
      ...answers,
      [currentQ.id]: { status: effectiveStatus, ...(!isEmpty && draftAnswer !== null ? { answer: draftAnswer } : {}) },
    } as AttemptAnswers;
    setAnswers(() => updatedAnswers);
    if (currentIdx < allQuestions.length - 1) {
      const nextIdx = currentIdx + 1;
      const nextState = updatedAnswers[allQuestions[nextIdx].id];
      setDraftAnswer(nextState?.answer !== undefined ? nextState.answer : null);
      setCurrentIdx(nextIdx);
    }
  }

  function markForReview() {
    if (!currentQ) return;
    const isEmpty = draftAnswer === null || (Array.isArray(draftAnswer) && draftAnswer.length === 0);
    const hasAnswer = draftAnswer !== null && !isEmpty;
    const status: QuestionStatus = hasAnswer ? "answered_marked" : "marked";
    const updatedAnswers = {
      ...answers,
      [currentQ.id]: { status, ...(hasAnswer ? { answer: draftAnswer } : {}) },
    } as AttemptAnswers;
    setAnswers(() => updatedAnswers);
    if (currentIdx < allQuestions.length - 1) {
      const nextIdx = currentIdx + 1;
      const nextState = updatedAnswers[allQuestions[nextIdx].id];
      setDraftAnswer(nextState?.answer !== undefined ? nextState.answer : null);
      setCurrentIdx(nextIdx);
    }
  }

  function clearResponse() {
    setDraftAnswer(null);
    if (!currentQ) return;
    setAnswers(prev => ({ ...prev, [currentQ.id]: { status: "not_answered" } }));
  }

  function goToSection(i: number) {
    setActiveSectionIdx(i);
    setCurrentIdx(sections.slice(0, i).reduce((s, sec) => s + sec.questions.length, 0));
  }

  const mins    = Math.floor(timeLeft / 60);
  const secs    = timeLeft % 60;
  const timeStr = `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;

  const counts: Record<QuestionStatus, number> = { not_visited: 0, not_answered: 0, answered: 0, marked: 0, answered_marked: 0 };
  allQuestions.forEach(q => { counts[answers[q.id]?.status ?? "not_visited"]++; });

  const sectionStart = sections.slice(0, activeSectionIdx).reduce((s, sec) => s + sec.questions.length, 0);
  const sectionQs    = sections[activeSectionIdx]?.questions ?? [];

  // ── Instructions pre-screen ─────────────────────────────────
  if (!hasStarted) {
    return (
      <div style={{ height: "100vh", display: "flex", flexDirection: "column", background: "#fff", fontFamily: FONT, overflow: "hidden" }}>
        <div style={{ background: "#b8d4e8", padding: "8px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "2px solid #8ab0cc", flexShrink: 0 }}>
          <span style={{ fontSize: 16, fontWeight: 700, color: "#000" }}>Instructions</span>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
            <UserAvatar size={64} />
            <span style={{ fontSize: 13, fontWeight: 700, color: "#1a3a6b" }}>{user.display_name}</span>
          </div>
        </div>

        <div style={{ flex: 1, overflowY: "auto" }}>
          <div style={{ maxWidth: 900, margin: "0 auto", padding: "24px 24px 40px" }}>
            <h2 style={{ textAlign: "center", fontSize: 16, fontWeight: 700, margin: "0 0 20px", textDecoration: "underline", color: "#111" }}>
              INSTRUCTIONS TO CANDIDATES
            </h2>
            <h3 style={{ fontSize: 14, fontWeight: 700, margin: "0 0 10px", color: "#111" }}>GENERAL INSTRUCTIONS</h3>
            <ol style={{ fontSize: 13, lineHeight: 2.0, paddingLeft: 26, margin: "0 0 20px", color: "#111" }}>
              <li>Total duration of the paper is <strong>{test.duration_mins} minutes</strong>.</li>
              <li>The on-screen computer clock will be set at the server. The countdown timer in the top right corner of the computer screen will display the remaining time (in minutes) available for you to complete the examination. When the timer reaches zero, the examination will end by itself automatically. You will not be required to end or submit the answers of examination. Please note that only the answers that you have saved will be recorded and submitted.</li>
              <li>The Question Palette displayed on the right side of screen will show the status of each question using one of the following symbols. You can view the summary of your actions on the questions of any section above the question palette.</li>
            </ol>

            <p style={{ fontWeight: 700, fontSize: 13, margin: "0 0 8px", color: "#111" }}>Question Palette Symbols</p>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, marginBottom: 20 }}>
              <thead>
                <tr>
                  <th style={thStyle}>Symbol</th>
                  <th style={thStyle}>Meaning of the symbol</th>
                </tr>
              </thead>
              <tbody>
                {(["not_visited","not_answered","answered","marked","answered_marked"] as QuestionStatus[]).map((st, i) => (
                  <tr key={st}>
                    <td style={{ ...tdStyle, width: 90, textAlign: "center" }}>
                      <PaletteIcon status={st} num={i + 1} active={false} />
                    </td>
                    <td style={tdStyle}>{STATUS_MEANINGS[st]}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <p style={{ fontSize: 13, margin: "0 0 16px", lineHeight: 1.7, color: "#111" }}>
              The <strong>Marked for Review</strong> status for a question simply indicates that you would like to look at question again.
            </p>

            <h3 style={{ fontSize: 14, fontWeight: 700, margin: "0 0 8px", color: "#111" }}>NAVIGATING TO A QUESTION</h3>
            <p style={{ fontSize: 13, margin: "0 0 8px", color: "#111" }}>To navigate between questions, you need to do the following:</p>
            <ul style={{ fontSize: 13, lineHeight: 2.0, paddingLeft: 26, margin: "0 0 20px", color: "#111" }}>
              <li>Click on the question number in the Question Palette at the right of the screen to go to that numbered question directly. Note that using this procedure does NOT save the answer to the current question.</li>
              <li>Click on <strong>Save and Next</strong> to save the answer for the current question and then go to the next question.</li>
              <li>Click on <strong>Mark for Review &amp; Next</strong> to save your answer for the current question, mark it for review, and then go to the next question.</li>
            </ul>

            <h3 style={{ fontSize: 14, fontWeight: 700, margin: "0 0 8px", color: "#111" }}>ANSWERING A QUESTION</h3>
            <p style={{ fontSize: 13, fontWeight: 700, margin: "0 0 6px", color: "#111" }}>Procedure for answering multiple choice (single correct option) type questions:</p>
            <ul style={{ fontSize: 13, lineHeight: 2.0, paddingLeft: 26, margin: "0 0 12px", color: "#111" }}>
              <li>To select the option, using the mouse, click on the corresponding button of the option.</li>
              <li>To deselect the chosen answer, click on the <strong>Clear Response</strong> button</li>
              <li>To change the chosen answer, click on the button of another option</li>
              <li>To save the answer and go to the next question, you MUST click on the <strong>Save &amp; Next</strong> button</li>
              <li>To mark the question for review, click on the <strong>Mark for Review &amp; Next</strong> button.</li>
            </ul>
            <p style={{ fontSize: 13, fontWeight: 700, margin: "0 0 6px", color: "#111" }}>Procedure for answering multiple select (one or more correct options) type questions:</p>
            <ul style={{ fontSize: 13, lineHeight: 2.0, paddingLeft: 26, margin: "0 0 12px", color: "#111" }}>
              <li>To select the option(s), using the mouse, click on the corresponding button(s) of the option(s).</li>
              <li>To deselect the chosen answer(s), click on the button(s) of the chosen option(s) again or click on the <strong>Clear Response</strong> button.</li>
              <li>To save the answer and go to the next question, you MUST click on the <strong>Save &amp; Next</strong> button</li>
            </ul>
            <p style={{ fontSize: 13, fontWeight: 700, margin: "0 0 6px", color: "#111" }}>Procedure for answering numerical value type questions:</p>
            <ul style={{ fontSize: 13, lineHeight: 2.0, paddingLeft: 26, margin: "0 0 20px", color: "#111" }}>
              <li>For each question, enter the correct numerical value of the answer using the computer mouse and the on-screen virtual numeric keypad. Use the mouse to click on numbers (and/or symbols) on the on-screen virtual numeric keypad to enter the numerical value in the space provided for the answer.</li>
              <li>To change the chosen answer, first click on the <strong>Clear Response</strong> button to clear the entered answer and then enter the new answer.</li>
              <li>To save your answer, you MUST click on the <strong>Save &amp; Next</strong> button</li>
            </ul>

            <p style={{ color: "#dc2626", fontSize: 13, margin: "0 0 12px" }}>All the questions will appear in English language.</p>

            <label style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer", marginBottom: 24 }}>
              <input
                type="checkbox"
                checked={agreed}
                onChange={e => setAgreed(e.target.checked)}
                style={{ marginTop: 3, flexShrink: 0, width: 15, height: 15 }}
              />
              <span style={{ fontSize: 12, color: "#111", lineHeight: 1.7 }}>
                I have read and understood the instructions. All computer hardware allotted to me are in proper working condition. I declare that I am not in possession of / not wearing / not carrying any prohibited gadget like mobile phone, bluetooth devices etc. /any prohibited material with me into the Examination Hall.I agree that in case of not adhering to the instructions, I shall be liable to be debarred from this Test and/or to disciplinary action, which may include ban from future Tests / Examinations
              </span>
            </label>

            <div style={{ textAlign: "center" }}>
              <button
                type="button"
                disabled={!agreed}
                onClick={() => setHasStarted(true)}
                style={{
                  background: agreed ? "#1a6eb5" : "#9ca3af",
                  color: "#fff", border: "none", borderRadius: 4,
                  padding: "12px 44px", fontSize: 15, fontWeight: 600,
                  cursor: agreed ? "pointer" : "not-allowed",
                }}
              >
                I am ready to begin
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Submitting screen ───────────────────────────────────────
  if (submitted) {
    return (
      <div style={{ height: "100vh", overflow: "hidden", background: "#f5f5f5", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: FONT }}>
        <div style={{ background: "#fff", borderRadius: 6, padding: "40px 56px", textAlign: "center", boxShadow: "0 2px 12px rgba(0,0,0,0.12)" }}>
          {submitError ? (
            <>
              <p style={{ fontSize: 36, margin: "0 0 14px" }}>⚠️</p>
              <p style={{ fontSize: 16, fontWeight: 700, color: "#111" }}>Submission failed</p>
              <p style={{ fontSize: 13, color: "#666", margin: "4px 0 20px" }}>A network error occurred. Your answers are saved locally.</p>
              <button type="button" onClick={retrySubmit}
                style={{ background: "#1a6eb5", color: "#fff", border: "none", borderRadius: 4, padding: "10px 28px", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
                Try Again
              </button>
            </>
          ) : (
            <>
              <img src="/jeelo-logo.png" alt="" aria-hidden="true"
                style={{ width: 260, height: "auto", marginBottom: 20, display: "block", marginLeft: "auto", marginRight: "auto",
                  animation: "mascot-bounce 0.7s cubic-bezier(0.16,1,0.3,1) both" }}
                draggable={false}
              />
              <p style={{ fontSize: 16, fontWeight: 700, color: "#111", margin: "0 0 4px" }}>Submitting your test…</p>
              <p style={{ fontSize: 13, color: "#666", margin: 0 }}>Calculating your score</p>
            </>
          )}
        </div>
      </div>
    );
  }

  // ── Submit confirmation — full page table ───────────────────
  if (showConfirm) {
    return (
      <div style={{ height: "100vh", display: "flex", flexDirection: "column", background: "#fff", fontFamily: FONT, overflow: "hidden" }}>
        <div style={getTopBarStyle(darkMode)}>
          <span style={{ color: JEE_GOLD, fontWeight: 700, fontSize: 13 }}>{test.title.toUpperCase()}</span>
          <div style={{ display: "flex", gap: 16, marginLeft: "auto" }}>
            <TopUtilBtn label="Accessibility"  circleColor="#4caf50" />
            <TopUtilBtn label="Instructions"   circleColor="#2196f3" />
            <TopUtilBtn label="Question Paper" circleColor="#4caf50" />
          </div>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: "28px 24px" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, marginBottom: 32 }}>
            <thead>
              <tr style={{ background: "#e8e8e8" }}>
                {["SECTION NAME","NO. OF QUESTIONS","ANSWERED","NOT ANSWERED","MARKED FOR REVIEW","ANSWERED AND MARKED FOR REVIEW","NOT VISITED"].map(h => (
                  <th key={h} style={{ border: "1px solid #ccc", padding: "9px 12px", fontWeight: 700, textAlign: "left", fontSize: 12 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sections.map(sec => {
                let ans = 0, notAns = 0, mrk = 0, ansMrk = 0, nv = 0;
                sec.questions.forEach(q => {
                  const st = answers[q.id]?.status ?? "not_visited";
                  if (st === "answered")         ans++;
                  else if (st === "not_answered") notAns++;
                  else if (st === "marked")       mrk++;
                  else if (st === "answered_marked") ansMrk++;
                  else nv++;
                });
                return (
                  <tr key={sec.id}>
                    <td style={confirmTd}>{sec.name}</td>
                    <td style={confirmTd}>{sec.questions.length}</td>
                    <td style={confirmTd}>{ans}</td>
                    <td style={confirmTd}>{notAns}</td>
                    <td style={confirmTd}>{mrk}</td>
                    <td style={confirmTd}>{ansMrk}</td>
                    <td style={confirmTd}>{nv}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <p style={{ textAlign: "center", fontSize: 15, margin: "0 0 28px", color: "#000" }}>
            Are you sure wish to submit this group of questions for marking ?
          </p>

          <div style={{ display: "flex", justifyContent: "center", gap: 16 }}>
            <button type="button" onClick={() => setShowConfirm(false)}
              style={{ background: "#555", color: "#fff", border: "none", borderRadius: 6, padding: "11px 32px", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
              No! Go Back to Paper
            </button>
            <button type="button" onClick={() => { setShowConfirm(false); doSubmit(); }}
              style={{ background: "#dc2626", color: "#fff", border: "none", borderRadius: 6, padding: "11px 32px", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
              Yes! Submit the Test
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Main exam UI ────────────────────────────────────────────
  const useCustomCursor = cursorSize !== 12 || cursorTrail;
  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", fontFamily: FONT, overflow: "hidden", cursor: useCustomCursor ? "none" : undefined, fontSize: fontSize, background: darkMode ? "#121212" : undefined }}>

      {/* ── Top bar ── */}
      <div style={getTopBarStyle(darkMode)}>
        <span style={{ color: JEE_GOLD, fontWeight: 700, fontSize: 13, letterSpacing: "0.02em", flex: 1 }}>
          {test.title.toUpperCase()}
        </span>
        <div style={{ display: "flex", gap: 18, flexShrink: 0 }}>
          <TopUtilBtn label="Accessibility"  circleColor="#4caf50" onClick={() => setShowAccess(v => !v)} />
          <TopUtilBtn label="Instructions"   circleColor="#2196f3" onClick={() => setShowInstrModal(true)} />
          <TopUtilBtn label="Question Paper" circleColor="#4caf50" onClick={() => setShowQPaper(true)} />
        </div>
      </div>

      {/* ── Subject tab ── */}
      <div style={{ background: darkMode ? "#1a1a1a" : "#fff", borderBottom: `2px solid ${darkMode ? "#333" : "#ccc"}`, padding: "5px 10px", display: "flex", alignItems: "center", flexShrink: 0 }}>
        <div style={{ background: JEE_BLUE, color: "#fff", padding: "4px 14px", borderRadius: 4, fontSize: 13, display: "flex", alignItems: "center", gap: 6, maxWidth: 260, overflow: "hidden" }}>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{test.title}</span>
          <div style={{ background: "#fff", color: JEE_BLUE, borderRadius: "50%", width: 16, height: 16, fontSize: 10, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, flexShrink: 0 }}>i</div>
        </div>
      </div>

      {/* ── Main body ── */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden", background: darkMode ? "#121212" : undefined }}>

        {/* Left: question area */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", borderRight: `1px solid ${darkMode ? "#333" : "#ccc"}` }}>

          {/* Sections + timer row */}
          <div style={{ borderBottom: `1px solid ${darkMode ? "#333" : "#ccc"}`, padding: "5px 12px", display: "flex", alignItems: "center", flexShrink: 0, background: darkMode ? "#1a1a1a" : "#fff" }}>
            <span style={{ fontSize: 13, color: darkMode ? "#aaa" : "#444", fontWeight: 500 }}>Sections</span>
            <span style={{ marginLeft: "auto", fontSize: 14, fontWeight: 600, color: darkMode ? "#e0e0e0" : "#333" }}>
              Time Left :&nbsp;<span style={{ color: timeLeft < 300 ? "#dc2626" : darkMode ? "#e0e0e0" : "#000" }}>{timeStr}</span>
            </span>
          </div>

          {/* Section pill nav */}
          <div style={{ borderBottom: `1px solid ${darkMode ? "#333" : "#ccc"}`, padding: "5px 8px", display: "flex", alignItems: "center", gap: 6, flexShrink: 0, background: darkMode ? "#111" : "#fafafa", flexWrap: "wrap" }}>
            {sections.map((sec, i) => (
              <button key={sec.id} type="button" onClick={() => goToSection(i)}
                style={{ background: activeSectionIdx === i ? JEE_BLUE : darkMode ? "#2a2a2a" : "#e0e0e0", color: activeSectionIdx === i ? "#fff" : darkMode ? "#ccc" : "#333", border: "none", borderRadius: 4, padding: "5px 14px", fontSize: 13, fontWeight: 500, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
                {sec.name}
                {activeSectionIdx === i && (
                  <div style={{ background: "#fff", color: JEE_BLUE, borderRadius: "50%", width: 14, height: 14, fontSize: 9, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700 }}>i</div>
                )}
              </button>
            ))}
          </div>

          {/* Question type + marks */}
          {currentSection && (
            <div style={{ borderBottom: `1px solid ${darkMode ? "#333" : "#eee"}`, padding: "4px 14px", display: "flex", justifyContent: "space-between", fontSize: 12, color: darkMode ? "#aaa" : "#333", flexShrink: 0, background: darkMode ? "#111" : "#fafafa" }}>
              <span>Question Type: <strong>{TYPE_LABELS[currentSection.question_type]}</strong></span>
              <span>Marks for correct answer: <strong>{currentSection.marks_correct}</strong> | Negative Marks: <strong style={{ color: "#b00" }}>{currentSection.marks_wrong}</strong></span>
            </div>
          )}

          {/* Question number row */}
          {currentQ && (
            <div style={{ borderBottom: `1px solid ${darkMode ? "#333" : "#eee"}`, padding: "5px 14px", display: "flex", alignItems: "center", flexShrink: 0, fontSize: 16, background: darkMode ? "#1a1a1a" : "#fff", color: darkMode ? "#e0e0e0" : "#333" }}>
              <strong>Question No. {currentIdx + 1}</strong>
            </div>
          )}

          {/* Scrollable question content */}
          <div style={{ flex: 1, overflowY: "auto", overflowX: "auto", background: darkMode ? "#1a1a1a" : "#fff" }} data-scroll-area>
            <div style={{ padding: "10px 14px", ...(zoom !== 1 ? { zoom } : {}), color: darkMode ? "#e0e0e0" : "#333" } as React.CSSProperties}>

              {/* Collapsible section info */}
              {currentSection && (
                <div style={{ border: `1px solid ${darkMode ? "#333" : "#bbb"}`, borderRadius: 3, marginBottom: 14, overflow: "hidden" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "7px 14px", background: darkMode ? "#1a1a1a" : "#fff", borderBottom: sectionInfoOpen ? `1px solid ${darkMode ? "#333" : "#bbb"}` : "none" }}>
                    <strong style={{ fontSize: 13 }}>
                      {currentSection.name} (Maximum Marks: {currentSection.marks_correct * sectionQs.length})
                    </strong>
                    <button type="button" onClick={() => setSectionInfoOpen(v => !v)}
                      style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, color: darkMode ? "#aaa" : "#555", lineHeight: 1, padding: "0 4px" }}>
                      {sectionInfoOpen ? "∧" : "∨"}
                    </button>
                  </div>
                  {sectionInfoOpen && (
                    <div style={{ padding: "10px 18px", fontSize: 13, background: darkMode ? "#1a1a1a" : undefined, color: darkMode ? "#e0e0e0" : "#111" }}>
                      <SectionInstructions section={currentSection} qCount={sectionQs.length} />
                    </div>
                  )}
                </div>
              )}

              {/* Paragraph passage image (shown above question for paragraph-type) */}
              {currentQ?.paragraph_image_url && (
                <div style={{ marginBottom: 16, border: `1px solid ${darkMode ? "#444" : "#ddd"}`, borderRadius: 4, overflow: "hidden", background: darkMode ? "#111" : "#fafafa" }}>
                  <div style={{ padding: "6px 12px", background: darkMode ? "#1e2a3a" : "#e8f0fb", borderBottom: `1px solid ${darkMode ? "#333" : "#c5d5ee"}`, fontSize: 11, fontWeight: 600, color: darkMode ? "#90b4d4" : "#1a5296", letterSpacing: "0.04em", textTransform: "uppercase" }}>
                    Passage
                  </div>
                  <img
                    src={currentQ.paragraph_image_url}
                    alt="Passage"
                    style={{ maxWidth: "100%", width: "100%", height: "auto", display: "block", objectFit: "contain" }}
                  />
                </div>
              )}

              {/* Question image */}
              {currentQ && (
                <div style={{ marginBottom: 12, overflow: "hidden", maxWidth: "100%" }}>
                  <img key={currentQ.id} src={currentQ.image_url} alt={`Question ${currentIdx + 1}`}
                    style={{ maxWidth: "100%", width: "100%", height: "auto", display: "block", objectFit: "contain" }} />
                </div>
              )}

              {/* Answer input */}
              {currentQ && currentSection && (
                <AnswerInput key={currentQ.id} questionType={currentSection.question_type} value={draftAnswer} onChange={setDraftAnswer} darkMode={darkMode} />
              )}

              {allQuestions.length === 0 && (
                <div style={{ textAlign: "center", color: "#999", padding: 60, fontSize: 14 }}>
                  This test has no questions yet.
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right: palette */}
        <div style={{ width: 274, display: "flex", flexDirection: "column", overflow: "hidden", background: darkMode ? "#1a1a1a" : "#f5f5f5", flexShrink: 0 }}>

          {/* User info */}
          <div style={{ padding: "10px 12px", borderBottom: `1px solid ${darkMode ? "#333" : "#ddd"}`, display: "flex", alignItems: "center", gap: 10, background: darkMode ? "#111" : "#fff" }}>
            <UserAvatar size={52} />
            <span style={{ fontSize: 13, fontWeight: 700, color: darkMode ? "#90b4d4" : "#1a3a6b", lineHeight: 1.3 }}>{user.display_name}</span>
          </div>

          {/* Legend */}
          <div style={{ padding: "8px 10px", borderBottom: `1px solid ${darkMode ? "#333" : "#ddd"}`, background: darkMode ? "#111" : "#fff", display: "flex", flexDirection: "column", gap: 5 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "5px 6px" }}>
              <LegendItem count={counts.answered}     label="Answered"          status="answered"      darkMode={darkMode} />
              <LegendItem count={counts.not_answered} label="Not Answered"      status="not_answered"  darkMode={darkMode} />
              <LegendItem count={counts.not_visited}  label="Not Visited"       status="not_visited"   darkMode={darkMode} />
              <LegendItem count={counts.marked}       label="Marked for review" status="marked"        darkMode={darkMode} />
            </div>
            <LegendItem count={counts.answered_marked} label="Answered and Marked for Review (will also be evaluated)" status="answered_marked" darkMode={darkMode} />
          </div>

          {/* Section header in palette */}
          <div style={{ background: JEE_BLUE, color: "#fff", padding: "6px 12px", fontSize: 13, fontWeight: 600, flexShrink: 0 }}>
            {sections[activeSectionIdx]?.name ?? ""}
          </div>
          <div style={{ padding: "3px 12px 4px", fontSize: 11, color: darkMode ? "#888" : "#333", borderBottom: `1px solid ${darkMode ? "#333" : "#ddd"}`, flexShrink: 0, background: darkMode ? "#111" : "#fff" }}>
            Choose a Question
          </div>

          {/* Question number grid */}
          <div style={{ flex: 1, overflowY: "auto", padding: "8px 10px", background: darkMode ? "#1a1a1a" : "#fff" }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 4 }}>
              {sectionQs.map((q, localIdx) => {
                const globalIdx = sectionStart + localIdx;
                const status: QuestionStatus = answers[q.id]?.status ?? "not_visited";
                const isCurrent = globalIdx === currentIdx;
                return (
                  <button key={q.id} type="button" onClick={() => setCurrentIdx(globalIdx)}
                    style={{ background: "none", border: "none", cursor: "pointer", padding: 0,
                      borderRadius: (PALETTE_CFG[status].shape === "circle") ? "50%" : (PALETTE_CFG[status].shape === "square") ? 3 : 2 }}>
                    <PaletteIcon status={status} num={globalIdx + 1} active={isCurrent} />
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* ── Bottom action bar ── */}
      <div style={{ background: darkMode ? "#111" : "#efefef", borderTop: `2px solid ${darkMode ? "#333" : "#ccc"}`, padding: "7px 12px", display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
        <button type="button" onClick={markForReview} style={btnMarkReview}>Mark for Review &amp; Next</button>
        <button type="button" onClick={clearResponse} style={btnClear}>Clear Response</button>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <button type="button" onClick={() => saveAndNext("answered")} style={btnSaveNext}>Save &amp; Next</button>
          <button type="button" onClick={() => setShowConfirm(true)} style={btnSubmit}>Submit</button>
        </div>
      </div>

      {/* Scroll-to-top float button */}
      <button type="button" title="Scroll to top"
        onClick={() => { const el = document.querySelector("[data-scroll-area]") as HTMLElement; if (el) el.scrollTop = 0; }}
        style={{ position: "fixed", bottom: 58, right: 286, zIndex: 40, background: "#1a6eb5", color: "#fff", border: "none", borderRadius: "50%", width: 36, height: 36, fontSize: 16, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 2px 8px rgba(0,0,0,0.3)" }}>
        ↑
      </button>

      {/* ── Question Paper modal ── */}
      {showQPaper && (
        <div style={MODAL_OVERLAY}>
          <div style={{ background: "#fff", width: "62%", maxWidth: 720, maxHeight: "86vh", borderRadius: 3, overflow: "hidden", display: "flex", flexDirection: "column", boxShadow: "0 8px 32px rgba(0,0,0,0.35)" }}>
            <div style={MODAL_HEADER}>
              <span>Question Paper</span>
              <button type="button" onClick={() => setShowQPaper(false)} style={MODAL_CLOSE_BTN}>Close ×</button>
            </div>
            <p style={MODAL_WARNING}>Note that the timer is ticking while you read the questions. Close this page to return to answering the questions.</p>
            <div style={{ overflowY: "auto", padding: "14px 20px" }}>
              {sections.map(sec => (
                <div key={sec.id} style={{ marginBottom: 24 }}>
                  <p style={{ color: JEE_BLUE, fontWeight: 700, fontSize: 14, borderBottom: "1px solid #ddd", paddingBottom: 5, marginBottom: 14 }}>{sec.name}</p>
                  {sec.questions.map((q, i) => (
                    <div key={q.id} style={{ marginBottom: 20 }}>
                      <p style={{ fontSize: 13, fontWeight: 700, margin: "0 0 6px" }}>Q.{i + 1})</p>
                      <div style={{ border: "1px solid #ccc", padding: 10, borderRadius: 2 }}>
                        <img src={q.image_url} alt={`Q${i + 1}`} style={{ maxWidth: "100%", display: "block" }} />
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Instructions modal ── */}
      {showInstrModal && (
        <div style={MODAL_OVERLAY}>
          <div style={{ background: "#fff", width: "60%", maxWidth: 680, maxHeight: "86vh", borderRadius: 3, overflow: "hidden", display: "flex", flexDirection: "column", boxShadow: "0 8px 32px rgba(0,0,0,0.35)" }}>
            <div style={MODAL_HEADER}>
              <span>Instructions</span>
              <button type="button" onClick={() => setShowInstrModal(false)} style={MODAL_CLOSE_BTN}>Close ×</button>
            </div>
            <p style={MODAL_WARNING}>Note that the timer is ticking while you read the instructions. Close this page to return to answering the questions.</p>
            <div style={{ overflowY: "auto", padding: "16px 22px", fontSize: 13, lineHeight: 1.9 }}>
              <h2 style={{ textAlign: "center", fontSize: 15, fontWeight: 700, textDecoration: "underline", margin: "0 0 16px" }}>INSTRUCTIONS TO CANDIDATES</h2>
              <h3 style={{ fontSize: 13, fontWeight: 700, margin: "0 0 8px" }}>GENERAL INSTRUCTIONS</h3>
              <ol style={{ paddingLeft: 24, margin: "0 0 14px" }}>
                <li>Total duration of the paper is <strong>{test.duration_mins} minutes</strong>.</li>
                <li>The on-screen computer clock will be set at the server. The countdown timer in the top right corner of the computer screen will display the remaining time (in minutes) available for you to complete the examination. When the timer reaches zero, the examination will end by itself automatically. You will not be required to end or submit the answers of examination. Please note that only the answers that you have saved will be recorded and submitted.</li>
                <li>The Question Palette displayed on the right side of screen will show the status of each question using one of the following symbols. You can view the summary of your actions on the questions of any section above the question palette.</li>
              </ol>
              <h3 style={{ fontSize: 13, fontWeight: 700, margin: "0 0 8px" }}>NAVIGATING TO A QUESTION</h3>
              <ul style={{ paddingLeft: 24, margin: "0 0 14px" }}>
                <li>Click on the question number in the Question Palette at the right of the screen to go to that numbered question directly.</li>
                <li>Click on <strong>Save and Next</strong> to save the answer for the current question and then go to the next question.</li>
                <li>Click on <strong>Mark for Review &amp; Next</strong> to save your answer for the current question, mark it for review, and then go to the next question.</li>
              </ul>
              <p style={{ color: "#dc2626", margin: "10px 0 0" }}>All the questions will appear in English language.</p>
            </div>
          </div>
        </div>
      )}

      {/* ── Accessibility panel ── */}
      {showAccess && (
        <>
          <div style={{ position: "fixed", inset: 0, zIndex: 55 }} onClick={() => setShowAccess(false)} />
          <div style={{
            position: "fixed", top: 44, left: 8, zIndex: 60,
            background: darkMode ? "#1e1e1e" : "#fff",
            border: `1px solid ${darkMode ? "#444" : "#ccc"}`,
            borderRadius: 6, boxShadow: "0 4px 16px rgba(0,0,0,0.25)",
            padding: "12px 16px", minWidth: 260,
            display: "flex", flexDirection: "column", gap: 14,
          }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
              <span style={{ fontSize: 12, color: darkMode ? "#bbb" : "#444" }}>Dark Mode</span>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "#f0a500" }}><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
                <div onClick={() => setDarkMode(v => {
                const next = !v;
                try { localStorage.setItem("jeelo-theme", next ? "dark" : "light"); document.documentElement.classList.toggle("dark", next); } catch {}
                return next;
              })}
                  style={{ width: 38, height: 21, background: darkMode ? "#1a6eb5" : "#ccc", borderRadius: 11, position: "relative", cursor: "pointer", transition: "background 0.2s", flexShrink: 0 }}>
                  <div style={{ width: 17, height: 17, background: "#fff", borderRadius: "50%", position: "absolute", top: 2, left: darkMode ? 19 : 2, transition: "left 0.2s", boxShadow: "0 1px 3px rgba(0,0,0,0.3)" }} />
                </div>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" stroke="none" style={{ color: "#7b8fd4" }}><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
              <span style={{ fontSize: 12, color: darkMode ? "#bbb" : "#444" }}>Font Size</span>
              <div style={{ display: "flex", gap: 5 }}>
                {([13, 16, 20] as const).map((sz) => (
                  <button key={sz} type="button" onClick={() => setFontSize(sz)}
                    style={{ width: 32, height: 32, border: fontSize === sz ? "2px solid #1a6eb5" : `1px solid ${darkMode ? "#444" : "#ccc"}`, borderRadius: "50%", background: fontSize === sz ? "#1a6eb5" : darkMode ? "#2a2a2a" : "#f5f5f5", color: fontSize === sz ? "#fff" : darkMode ? "#ccc" : "#333", fontSize: sz - 3, fontWeight: 700, cursor: "pointer" }}>A</button>
                ))}
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
              <span style={{ fontSize: 12, color: darkMode ? "#bbb" : "#444" }}>Cursor Trail</span>
              <div onClick={() => setCursorTrail(v => !v)}
                style={{ width: 38, height: 21, background: cursorTrail ? "#1a6eb5" : darkMode ? "#444" : "#ccc", borderRadius: 11, position: "relative", cursor: "pointer", transition: "background 0.2s", flexShrink: 0 }}>
                <div style={{ width: 17, height: 17, background: "#fff", borderRadius: "50%", position: "absolute", top: 2, left: cursorTrail ? 19 : 2, transition: "left 0.2s", boxShadow: "0 1px 3px rgba(0,0,0,0.3)" }} />
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
              <span style={{ fontSize: 12, color: darkMode ? "#bbb" : "#444" }}>Cursor Size</span>
              <div style={{ display: "flex", gap: 5 }}>
                {([12, 16, 22] as const).map((sz) => (
                  <button key={sz} type="button" onClick={() => setCursorSize(sz)}
                    style={{ width: 32, height: 32, border: cursorSize === sz ? "2px solid #1a6eb5" : `1px solid ${darkMode ? "#444" : "#ccc"}`, borderRadius: "50%", background: cursorSize === sz ? "#1a6eb5" : darkMode ? "#2a2a2a" : "#f5f5f5", color: cursorSize === sz ? "#fff" : darkMode ? "#ccc" : "#333", fontSize: sz - 2, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>↖</button>
                ))}
              </div>
            </div>
          </div>
        </>
      )}

      {/* Custom cursor dot */}
      {useCustomCursor && (
        <div style={{
          position: "fixed", left: mousePos.x, top: mousePos.y,
          width: cursorSize, height: cursorSize,
          borderRadius: "50%",
          background: "rgba(26, 110, 181, 0.85)",
          border: "2px solid #fff",
          boxShadow: "0 0 4px rgba(0,0,0,0.4)",
          transform: "translate(-50%, -50%)",
          pointerEvents: "none", zIndex: 9999,
          transition: "width 0.1s, height 0.1s",
        }} />
      )}

      {/* Cursor trail dots */}
      {cursorTrail && trailDots.map((dot, i) => {
        const opacity = (i + 1) / trailDots.length * 0.55;
        const scale = (i + 1) / trailDots.length;
        const sz = Math.max(4, cursorSize * scale * 0.7);
        return (
          <div key={dot.id} style={{
            position: "fixed", left: dot.x, top: dot.y,
            width: sz, height: sz,
            borderRadius: "50%",
            background: `rgba(26, 110, 181, ${opacity})`,
            transform: "translate(-50%, -50%)",
            pointerEvents: "none", zIndex: 9998,
          }} />
        );
      })}

    </div>
  );
}
