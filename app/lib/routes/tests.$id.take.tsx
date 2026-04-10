import { redirect, useFetcher, useNavigate } from "react-router";
import React, { useState, useEffect, useRef } from "react";
import type { Route } from "./+types/tests.$id.take";
import { requireUser } from "~/lib/auth.server";
import { createServerClient } from "~/lib/supabase.server";
import type { QuestionType, QuestionStatus, AttemptAnswers, ScoreBreakdown } from "~/lib/database.types";

// ── Types ──────────────────────────────────────────────────────

type QuestionRow = {
  id: string;
  image_url: string;
  type: QuestionType;
  subject: string;
  chapter: string;
  correct_answer: unknown;
};

type SectionQuestion = QuestionRow & { display_order: number };

type Section = {
  id: string;
  name: string;
  question_type: QuestionType;
  subject: string;
  marks_correct: number;
  marks_wrong: number;
  marks_partial: number | null;
  display_order: number;
  questions: SectionQuestion[];
};

type Test = {
  id: string;
  title: string;
  duration_mins: number;
  is_published: boolean;
};

type Attempt = {
  id: string;
  answers: AttemptAnswers;
  started_at: string;
  submitted_at: string | null;
  score_breakdown: ScoreBreakdown | null;
};

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

  if (testError || !test) throw redirect("/tests");
  if (!test.is_published) throw redirect(`/tests/${testId}`);

  const { data: rawSections } = await supabase
    .from("test_sections")
    .select(`
      id, name, question_type, subject,
      marks_correct, marks_wrong, marks_partial, display_order,
      test_questions(
        display_order,
        questions(id, image_url, type, subject, chapter, correct_answer)
      )
    `)
    .eq("test_id", testId)
    .order("display_order", { ascending: true });

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
      .map((tq: any) => ({ display_order: tq.display_order, ...(tq.questions as QuestionRow) })),
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

  if (!attempt) throw redirect("/tests");

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
    // Prefer localStorage draft over DB state (in case of accidental page close)
    try {
      const saved = localStorage.getItem(`jeelo_answers_${attempt.id}`);
      if (saved) {
        const parsed = JSON.parse(saved) as AttemptAnswers;
        return parsed;
      }
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

  // Did we restore answers from a localStorage draft?
  const [hasDraft] = useState(() => {
    try { return !!localStorage.getItem(`jeelo_answers_${attempt.id}`); } catch { return false; }
  });

  // Accessibility state
  const [darkMode,         setDarkMode]          = useState(false);
  const [fontSize,         setFontSize]          = useState<13 | 16 | 20>(13);
  const [cursorTrail,      setCursorTrail]       = useState(false);
  const [cursorSize,       setCursorSize]        = useState<12 | 16 | 22>(12);



  // Cursor trail & custom size
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

  // ── localStorage key for this attempt ──────────────────────
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


  // Custom cursor tracking (used for cursor size + cursor trail)
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

  // Fade out trail dots
  useEffect(() => {
    if (!cursorTrail || trailDots.length === 0) return;
    const t = setTimeout(() => setTrailDots(prev => prev.slice(1)), 60);
    return () => clearTimeout(t);
  }, [cursorTrail, trailDots]);

  // ── Auto-save answers to localStorage on every change ──────
  useEffect(() => {
    try { localStorage.setItem(lsKey, JSON.stringify(answers)); } catch { /* ignore */ }
  }, [answers, lsKey]);

  // ── Watch fetcher: navigate manually if the redirect doesn't fire ──
  const submitFetcherWasActiveRef = useRef(false);
  useEffect(() => {
    if (!submitted) return;

    // Track when the fetcher becomes active so we only act on a real idle
    // transition, not the initial idle state when submitted first becomes true.
    if (submitFetcher.state !== "idle") {
      submitFetcherWasActiveRef.current = true;
      return;
    }

    // Fetcher is idle but hasn't gone through a submit cycle yet — skip.
    if (!submitFetcherWasActiveRef.current) return;

    // Fetcher completed. If data is undefined the action likely errored out
    // (no redirect, no response body) — show retry. Otherwise start the
    // fallback navigation timer in case React Router's redirect didn't fire.
    if (submitFetcher.data === undefined) {
      setSubmitError(true);
      return;
    }

    const timer = setTimeout(() => {
      navigate(`/tests/${test.id}/result`, { replace: true });
    }, 1200);
    return () => clearTimeout(timer);
  }, [submitFetcher.state, submitFetcher.data, submitted]); // eslint-disable-line

  // ── Submit via React Router fetcher — handles redirect correctly ──
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
    // Signal that the result page should show the celebratory splash
    try { sessionStorage.setItem("jeelo-show-result-splash", "1"); } catch { /* ignore */ }
    submitFetcher.submit(fd, { method: "post" });
  }

  // Retry submit after a failure
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
    setAnswers(prev => ({
      ...prev,
      [currentQ.id]: { status: effectiveStatus, ...(!isEmpty && draftAnswer !== null ? { answer: draftAnswer } : {}) },
    }));
    if (currentIdx < allQuestions.length - 1) setCurrentIdx(i => i + 1);
  }

  function markForReview() {
    if (!currentQ) return;
    const isEmpty = draftAnswer === null || (Array.isArray(draftAnswer) && draftAnswer.length === 0);
    const hasAnswer = draftAnswer !== null && !isEmpty;
    const status: QuestionStatus = hasAnswer ? "answered_marked" : "marked";
    setAnswers(prev => ({
      ...prev,
      [currentQ.id]: { status, ...(hasAnswer ? { answer: draftAnswer } : {}) },
    }));
    if (currentIdx < allQuestions.length - 1) setCurrentIdx(i => i + 1);
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
              <p style={{ fontSize: 36, margin: "0 0 14px" }}>⏳</p>
              <p style={{ fontSize: 16, fontWeight: 700, color: "#111" }}>Submitting your test…</p>
              <p style={{ fontSize: 13, color: "#666", margin: "4px 0 0" }}>Calculating your score</p>
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
            <TopUtilBtn label="Accessibility"    circleColor="#4caf50" />

            <TopUtilBtn label="Instructions"     circleColor="#2196f3" />
            <TopUtilBtn label="Question Paper"   circleColor="#4caf50" />
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
          <TopUtilBtn label="Accessibility"    circleColor="#4caf50" onClick={() => setShowAccess(v => !v)} />

          <TopUtilBtn label="Instructions"     circleColor="#2196f3" onClick={() => setShowInstrModal(true)} />
          <TopUtilBtn label="Question Paper"   circleColor="#4caf50" onClick={() => setShowQPaper(true)} />
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
            <div style={{ borderBottom: `1px solid ${darkMode ? "#333" : "#eee"}`, padding: "5px 14px", display: "flex", alignItems: "center", flexShrink: 0, fontSize: 13, background: darkMode ? "#1a1a1a" : "#fff", color: darkMode ? "#e0e0e0" : "#333" }}>
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
            </div>{/* end zoom wrapper */}
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
            {/* Dark Mode row */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
              <span style={{ fontSize: 12, color: darkMode ? "#bbb" : "#444" }}>Dark Mode</span>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <span style={{ fontSize: 12 }}>☀</span>
                <div onClick={() => setDarkMode(v => !v)}
                  style={{ width: 38, height: 21, background: darkMode ? "#1a6eb5" : "#ccc", borderRadius: 11, position: "relative", cursor: "pointer", transition: "background 0.2s", flexShrink: 0 }}>
                  <div style={{ width: 17, height: 17, background: "#fff", borderRadius: "50%", position: "absolute", top: 2, left: darkMode ? 19 : 2, transition: "left 0.2s", boxShadow: "0 1px 3px rgba(0,0,0,0.3)" }} />
                </div>
                <span style={{ fontSize: 12 }}>🌙</span>
              </div>
            </div>
            {/* Font Size row */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
              <span style={{ fontSize: 12, color: darkMode ? "#bbb" : "#444" }}>Font Size</span>
              <div style={{ display: "flex", gap: 5 }}>
                {([13, 16, 20] as const).map((sz) => (
                  <button key={sz} type="button" onClick={() => setFontSize(sz)}
                    style={{ width: 32, height: 32, border: fontSize === sz ? "2px solid #1a6eb5" : `1px solid ${darkMode ? "#444" : "#ccc"}`, borderRadius: "50%", background: fontSize === sz ? "#1a6eb5" : darkMode ? "#2a2a2a" : "#f5f5f5", color: fontSize === sz ? "#fff" : darkMode ? "#ccc" : "#333", fontSize: sz - 3, fontWeight: 700, cursor: "pointer" }}>A</button>
                ))}
              </div>
            </div>
            {/* Cursor Trail row */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
              <span style={{ fontSize: 12, color: darkMode ? "#bbb" : "#444" }}>Cursor Trail</span>
              <div onClick={() => setCursorTrail(v => !v)}
                style={{ width: 38, height: 21, background: cursorTrail ? "#1a6eb5" : darkMode ? "#444" : "#ccc", borderRadius: 11, position: "relative", cursor: "pointer", transition: "background 0.2s", flexShrink: 0 }}>
                <div style={{ width: 17, height: 17, background: "#fff", borderRadius: "50%", position: "absolute", top: 2, left: cursorTrail ? 19 : 2, transition: "left 0.2s", boxShadow: "0 1px 3px rgba(0,0,0,0.3)" }} />
              </div>
            </div>
            {/* Cursor Size row */}
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

      {/* Custom cursor dot (when cursor size ≠ default or trail enabled) */}
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

// ── Sub-components ─────────────────────────────────────────────


function UserAvatar({ size }: { size: number }) {
  return (
    <div style={{ width: size, height: size, borderRadius: 4, overflow: "hidden", background: "#d6e8f5", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <svg width={size} height={size} viewBox="0 0 52 52" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect width="52" height="52" fill="#d6e8f5"/>
        <circle cx="26" cy="20" r="10" fill="#7aaecf"/>
        <ellipse cx="26" cy="42" rx="16" ry="10" fill="#7aaecf"/>
      </svg>
    </div>
  );
}

// ── Section instructions (auto-generated from section type + marks) ───────────

function SectionInstructions({ section, qCount }: { section: Section; qCount: number }) {
  const { question_type, marks_correct, marks_wrong, marks_partial } = section;
  const mc = marks_correct ?? 4;
  const mw = marks_wrong ?? -1;
  const mp = marks_partial ?? 2;
  const maxMarks = mc * qCount;

  const UL = ({ children }: { children: React.ReactNode }) => (
    <ul style={{ margin: 0, paddingLeft: 22, lineHeight: 2 }}>{children}</ul>
  );
  const MarkRow = ({ label, val, note }: { label: string; val: string; note?: string }) => (
    <li><em>{label}</em> : {val}{note ? ` (${note})` : ""}</li>
  );

  if (question_type === "scq") {
    return (
      <UL>
        <li>This section contains <strong>{qCount}</strong> question{qCount !== 1 ? "s" : ""}.</li>
        <li>Each question has <strong>4</strong> options A, B, C, D. <strong>ONLY ONE</strong> of these 4 options is the correct answer.</li>
        <li>For each question, choose the option corresponding to the correct answer.</li>
        <li>Answer to each question will be evaluated according to the following marking scheme:
          <UL>
            <MarkRow label="Full Marks" val={`+${mc} If ONLY the correct option is chosen`} />
            <MarkRow label="Zero Marks" val="0 If none of the options is chosen (i.e. the question is unanswered)" />
            <MarkRow label="Negative Marks" val={`${mw} In all other cases.`} />
          </UL>
        </li>
      </UL>
    );
  }

  if (question_type === "paragraph") {
    return (
      <UL>
        <li>This section contains <strong>{qCount}</strong> question{qCount !== 1 ? "s" : ""} based on a passage / paragraph.</li>
        <li>Each question has <strong>4</strong> options A, B, C, D. <strong>ONLY ONE</strong> of these 4 options is the correct answer.</li>
        <li>For each question, choose the option corresponding to the correct answer.</li>
        <li>Answer to each question will be evaluated according to the following marking scheme:
          <UL>
            <MarkRow label="Full Marks" val={`+${mc} If ONLY the correct option is chosen`} />
            <MarkRow label="Zero Marks" val="0 If none of the options is chosen (i.e. the question is unanswered)" />
            <MarkRow label="Negative Marks" val={`${mw} In all other cases.`} />
          </UL>
        </li>
      </UL>
    );
  }

  if (question_type === "mcq") {
    return (
      <UL>
        <li>This section contains <strong>{qCount}</strong> question{qCount !== 1 ? "s" : ""}.</li>
        <li>Each question has <strong>4</strong> options A, B, C, D. <strong>ONE OR MORE</strong> of these 4 options may be correct answer(s).</li>
        <li>For each question, choose all correct option(s) to answer the question.</li>
        <li>Answer to each question will be evaluated according to the following marking scheme:
          <UL>
            <MarkRow label="Full Marks" val={`+${mc}`} note="If only (all) the correct option(s) are chosen" />
            <MarkRow label="Partial Marks" val={`+${mp}`} note="For each correct option marked, provided no incorrect option is marked" />
            <MarkRow label="Zero Marks" val="0" note="If no option is chosen (i.e. the question is unanswered)" />
            <MarkRow label="Negative Marks" val={`${mw}`} note="In all other cases" />
          </UL>
        </li>
      </UL>
    );
  }

  if (question_type === "integer") {
    return (
      <UL>
        <li>This section contains <strong>{qCount}</strong> question{qCount !== 1 ? "s" : ""}.</li>
        <li>The answer to each question is a <strong>Non-Negative Integer</strong>.</li>
        <li>For each question, enter the correct integer answer using the on-screen virtual numeric keypad.</li>
        <li>Answer to each question will be evaluated according to the following marking scheme:
          <UL>
            <MarkRow label="Full Marks" val={`+${mc}`} note="If ONLY the correct integer is entered" />
            <MarkRow label="Zero Marks" val="0" note="In all other cases" />
          </UL>
        </li>
      </UL>
    );
  }

  if (question_type === "numerical") {
    return (
      <UL>
        <li>This section contains <strong>{qCount}</strong> question{qCount !== 1 ? "s" : ""}.</li>
        <li>The answer to each question is a <strong>numerical value</strong> (decimal/real number).</li>
        <li>Enter the answer using the keyboard. Round to two decimal places if required.</li>
        <li>Answer to each question will be evaluated according to the following marking scheme:
          <UL>
            <MarkRow label="Full Marks" val={`+${mc}`} note="If the answer is correct within the specified range" />
            <MarkRow label="Zero Marks" val="0" note="In all other cases" />
          </UL>
        </li>
      </UL>
    );
  }

  return (
    <UL>
      <li>This section contains <strong>{qCount}</strong> question{qCount !== 1 ? "s" : ""}. Total Marks: {maxMarks}.</li>
    </UL>
  );
}

function PaletteIcon({ status, num, active }: { status: QuestionStatus; num: number; active: boolean }) {
  const cfg = PALETTE_CFG[status];
  const shape = cfg.shape;
  const isCircle = shape === "circle";
  const isSquare = shape === "square";
  const clip = SHAPE_CLIP[shape];
  const S = SHAPE_SIZE.palette; // uniform 36×36 for every shape

  return (
    <div style={{ width: S, height: S, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{
        width: S,
        height: S,
        background: cfg.bg,
        borderRadius: isCircle ? "50%" : isSquare ? 4 : 0,
        clipPath: clip,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        position: "relative",
        border: "none",
        boxSizing: "border-box" as const,
      }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: cfg.text, lineHeight: 1 }}>{num}</span>
        {status === "answered_marked" && (
          <div style={{ position: "absolute", bottom: 3, right: 3, width: 11, height: 11,
            background: "linear-gradient(180deg,#6abe38 0%,#2d8a1a 100%)", borderRadius: "50%",
            display: "flex", flexDirection: "column", alignItems: "center",
            justifyContent: "center", gap: "1.5px", padding: "2px",
            boxSizing: "border-box" as const }}>
            {[0,1,2].map(i => <div key={i} style={{ width: "100%", height: "1.5px", background: "#fff", borderRadius: 1 }} />)}
          </div>
        )}
      </div>
    </div>
  );
}

function LegendItem({ count, label, status, darkMode = false }: { count: number; label: string; status: QuestionStatus; darkMode?: boolean }) {
  const cfg = PALETTE_CFG[status];
  const shape = cfg.shape;
  const isCircle = shape === "circle";
  const isSquare = shape === "square";
  const clip = SHAPE_CLIP[shape];
  const S = SHAPE_SIZE.legend; // uniform 22×22 for every shape
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <div style={{
        width: S, height: S,
        background: cfg.bg,
        borderRadius: isCircle ? "50%" : isSquare ? 3 : 0,
        clipPath: clip,
        flexShrink: 0,
        position: "relative",
        display: "flex", alignItems: "center", justifyContent: "center",
        border: "none",
        boxSizing: "border-box" as const,
      }}>
        <span style={{ fontSize: 9, fontWeight: 700, color: cfg.text }}>{count}</span>
        {status === "answered_marked" && (
          <div style={{ position: "absolute", bottom: 1, right: 1, width: 8, height: 8,
            background: "linear-gradient(180deg,#6abe38 0%,#2d8a1a 100%)", borderRadius: "50%",
            display: "flex", flexDirection: "column", alignItems: "center",
            justifyContent: "center", gap: "1px", padding: "1.5px",
            boxSizing: "border-box" as const }}>
            {[0,1,2].map(i => <div key={i} style={{ width: "100%", height: "1px", background: "#fff", borderRadius: 1 }} />)}
          </div>
        )}
      </div>
      <span style={{ fontSize: 10, color: darkMode ? "#aaa" : "#444", lineHeight: 1.3 }}>{label}</span>
    </div>
  );
}

const TOP_UTIL_ICONS: Record<string, React.ReactNode> = {
  "Accessibility": (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="5" r="2"/>
      <path d="M12 22v-7l-2-5H5l2-5h10l2 5h-5l-2 5v7"/>
    </svg>
  ),
  "Instructions": (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/>
      <line x1="12" y1="8" x2="12" y2="12"/>
      <line x1="12" y1="16" x2="12.01" y2="16"/>
    </svg>
  ),
  "Question Paper": (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <polyline points="14 2 14 8 20 8"/>
      <line x1="16" y1="13" x2="8" y2="13"/>
      <line x1="16" y1="17" x2="8" y2="17"/>
      <polyline points="10 9 9 9 8 9"/>
    </svg>
  ),
};

function TopUtilBtn({ label, circleColor, onClick }: { label: string; circleColor: string; onClick?: () => void }) {
  return (
    <button type="button" onClick={onClick}
      style={{ background: "none", border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: 5, color: "#fff", fontSize: 12, padding: 0, whiteSpace: "nowrap" }}>
      <div style={{ width: 22, height: 22, borderRadius: "50%", background: circleColor, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
        {TOP_UTIL_ICONS[label] ?? null}
      </div>
      {label}
    </button>
  );
}

function AnswerInput({ questionType, value, onChange, darkMode = false }: { questionType: QuestionType; value: unknown; onChange: (v: unknown) => void; darkMode?: boolean }) {
  if (questionType === "scq" || questionType === "paragraph") {
    const selected: string = Array.isArray(value) ? (value as string[])[0] ?? "" : "";
    return (
      <div style={{ marginTop: 8 }}>
        {OPTIONS.map(opt => {
          const active = selected === opt;
          return (
            <div key={opt} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0", cursor: "pointer" }} onClick={() => onChange([opt])}>
              <div style={{ width: 18, height: 18, borderRadius: "50%", border: active ? "6px solid #1a6eb5" : `2px solid ${darkMode ? "#666" : "#888"}`, background: darkMode ? "#2a2a2a" : "#fff", boxSizing: "border-box" as const, flexShrink: 0 }} />
              <span style={{ fontSize: 14, color: darkMode ? "#e0e0e0" : "#333" }}>({opt})</span>
            </div>
          );
        })}
      </div>
    );
  }
  if (questionType === "mcq") {
    const selected: string[] = Array.isArray(value) ? (value as string[]) : [];
    return (
      <div style={{ marginTop: 8 }}>
        {OPTIONS.map(opt => {
          const isOn = selected.includes(opt);
          return (
            <div key={opt} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0", cursor: "pointer" }}
              onClick={() => onChange(isOn ? selected.filter(x => x !== opt) : [...selected, opt])}>
              <div style={{ width: 18, height: 18, borderRadius: 3, border: isOn ? "none" : `2px solid ${darkMode ? "#666" : "#888"}`, background: isOn ? "#1a6eb5" : darkMode ? "#2a2a2a" : "#fff", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 11, fontWeight: 700, flexShrink: 0, boxSizing: "border-box" as const }}>
                {isOn ? "✓" : ""}
              </div>
              <span style={{ fontSize: 14, color: darkMode ? "#e0e0e0" : "#333" }}>({opt})</span>
            </div>
          );
        })}
      </div>
    );
  }
  if (questionType === "integer") {
    const numStr = value !== null && value !== undefined ? String(value) : "";
    function appendDigit(d: number) { onChange(parseInt(((numStr + d).replace(/^0+(?=\d)/, "")), 10)); }
    function backspace() { const s = numStr.slice(0, -1); onChange(s === "" ? null : parseInt(s, 10)); }
    return (
      <div style={{ marginTop: 10 }}>
        <p style={{ fontSize: 12, color: darkMode ? "#aaa" : "#555", margin: "0 0 8px" }}>Enter integer answer</p>
        <input readOnly value={numStr} placeholder="—" style={{ width: 88, padding: "6px 10px", border: "2px solid #1a6eb5", borderRadius: 4, fontSize: 22, fontWeight: 700, color: "#1a6eb5", textAlign: "center" as const, background: darkMode ? "#1a2a3a" : "#eef2ff", display: "block", marginBottom: 10 }} />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 40px)", gap: 5 }}>
          {[7,8,9,4,5,6,1,2,3].map(n => (
            <button key={n} type="button" onClick={() => appendDigit(n)} style={{ ...numpadBtn, background: darkMode ? "#2a2a2a" : "#fff", color: darkMode ? "#e0e0e0" : "#333", borderColor: darkMode ? "#444" : "#ccc" }}>{n}</button>
          ))}
          <button type="button" onClick={() => appendDigit(0)} style={{ ...numpadBtn, background: darkMode ? "#2a2a2a" : "#fff", color: darkMode ? "#e0e0e0" : "#333", borderColor: darkMode ? "#444" : "#ccc" }}>0</button>
          <button type="button" onClick={backspace} style={{ ...numpadBtn, background: darkMode ? "#3a1a1a" : "#fee2e2", color: "#dc2626" }}>⌫</button>
        </div>
      </div>
    );
  }
  if (questionType === "numerical") {
    const numStr = value !== null && value !== undefined ? String(value) : "";
    return (
      <div style={{ marginTop: 10 }}>
        <p style={{ fontSize: 12, color: darkMode ? "#aaa" : "#555", margin: "0 0 8px" }}>Enter numerical answer</p>
        <input type="number" step="any" value={numStr}
          onChange={e => onChange(e.target.value === "" ? null : parseFloat(e.target.value))}
          placeholder="e.g. 3.14"
          style={{ padding: "8px 12px", border: "2px solid #1a6eb5", borderRadius: 4, fontSize: 16, fontWeight: 600, color: "#1a6eb5", width: 160, background: darkMode ? "#1a2a3a" : "#eef2ff", textAlign: "center" as const }} />
      </div>
    );
  }
  return null;
}

// ── Constants & styles ─────────────────────────────────────────

const FONT     = "Arial, 'Helvetica Neue', Helvetica, sans-serif";
const JEE_GOLD = "#f5c000";
const JEE_BLUE = "#4169a1";
const OPTIONS  = ["A", "B", "C", "D"] as const;

// shape: "square" | "hex-down" | "hex-up" | "circle"
// hex-up   = angled top corners → wide flat bottom (ANSWERED green)
// hex-down = wide flat top → angled bottom corners (NOT ANSWERED red)
const PALETTE_CFG: Record<QuestionStatus, { bg: string; text: string; border: string; shape: string }> = {
  not_visited:     { bg: "#d8d8d8", text: "#444",  border: "#aaa",    shape: "square"   },
  not_answered:    { bg: "#d94025", text: "#fff",  border: "none",    shape: "hex-down" },
  answered:        { bg: "#79c020", text: "#fff",  border: "none",    shape: "hex-up"   },
  marked:          { bg: "#7e57c0", text: "#fff",  border: "none",    shape: "circle"   },
  answered_marked: { bg: "#7e57c0", text: "#fff",  border: "none",    shape: "circle"   },
};

// All shapes share the same W×H bounding box; clip-path carves the visual silhouette
const SHAPE_SIZE = { palette: 44, legend: 26 };

// Clip-paths per shape type
const SHAPE_CLIP: Record<string, string | undefined> = {
  "square":   undefined,
  "hex-down": "polygon(0% 0%, 100% 0%, 100% 72%, 76% 100%, 24% 100%, 0% 72%)",
  "hex-up":   "polygon(24% 0%, 76% 0%, 100% 28%, 100% 100%, 0% 100%, 0% 28%)",
  "circle":   undefined,
};

const STATUS_MEANINGS: Record<QuestionStatus, string> = {
  not_visited:     "You have not visited this question",
  not_answered:    "You have not answered this question",
  answered:        "You have answered this question",
  marked:          "You have NOT answered the question, but have marked the question for Review, will be considered for evaluation",
  answered_marked: "The question(s) 'Answered and Marked for Review' will be considered for evaluation.",
};

const TYPE_LABELS: Record<QuestionType, string> = {
  scq: "Single Correct", mcq: "Multiple Correct",
  integer: "Integer", numerical: "Numerical", paragraph: "Paragraph",
};

const topBarStyle: React.CSSProperties = {
  background: "#1d1d00", color: "#fff",
  padding: "0 14px", height: 40,
  display: "flex", alignItems: "center", flexShrink: 0, gap: 12,
};
function getTopBarStyle(darkMode: boolean): React.CSSProperties {
  return { ...topBarStyle, background: darkMode ? "#0d0d0d" : "#1d1d00" };
}
const navArrowBtn: React.CSSProperties = {
  background: "#ddd", border: "1px solid #bbb", borderRadius: 3,
  padding: "4px 9px", cursor: "pointer", fontSize: 12, color: "#333",
};
const btnMarkReview: React.CSSProperties = {
  background: JEE_BLUE, color: "#fff", border: "none",
  borderRadius: 4, padding: "8px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer",
};
const btnClear: React.CSSProperties = {
  background: "#fff", color: "#333", border: "1px solid #bbb",
  borderRadius: 4, padding: "7px 14px", fontSize: 13, cursor: "pointer",
};
const btnSaveNext: React.CSSProperties = {
  background: "#1a6eb5", color: "#fff", border: "none",
  borderRadius: 4, padding: "8px 20px", fontSize: 13, fontWeight: 600, cursor: "pointer",
};
const btnSubmit: React.CSSProperties = {
  background: "#1a6eb5", color: "#fff", border: "2px solid #fff",
  borderRadius: 4, padding: "6px 22px", fontSize: 13, fontWeight: 600, cursor: "pointer",
};
const numpadBtn: React.CSSProperties = {
  width: 40, height: 36, border: "1px solid #ccc", borderRadius: 4,
  background: "#fff", cursor: "pointer", fontSize: 14, fontWeight: 600, color: "#333",
};
const MODAL_OVERLAY: React.CSSProperties = {
  position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)",
  display: "flex", alignItems: "center", justifyContent: "center", zIndex: 70,
};
const MODAL_HEADER: React.CSSProperties = {
  background: "#1a6eb5", color: "#fff", padding: "7px 16px",
  display: "flex", justifyContent: "space-between", alignItems: "center",
  fontSize: 14, fontWeight: 700, flexShrink: 0,
};
const MODAL_CLOSE_BTN: React.CSSProperties = {
  background: "rgba(255,255,255,0.2)", border: "none", color: "#fff",
  borderRadius: 3, padding: "3px 10px", cursor: "pointer", fontSize: 13, fontWeight: 600,
};
const MODAL_WARNING: React.CSSProperties = {
  background: "#fff8f8", color: "#dc2626", padding: "9px 16px",
  margin: 0, fontSize: 13, borderBottom: "1px solid #fecaca", flexShrink: 0, lineHeight: 1.5,
};
const thStyle: React.CSSProperties = {
  border: "1px solid #bbb", padding: "7px 12px", fontWeight: 700, textAlign: "left" as const, background: "#e8e8e8", color: "#000",
};
const tdStyle: React.CSSProperties = {
  border: "1px solid #bbb", padding: "9px 12px", verticalAlign: "middle" as const, color: "#000",
};
const confirmTd: React.CSSProperties = {
  border: "1px solid #ccc", padding: "8px 12px", fontSize: 13, color: "#000",
};