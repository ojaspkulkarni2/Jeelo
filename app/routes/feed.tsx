import { data, useFetcher, Link } from "react-router";
import { useState, useEffect, useRef } from "react";
import type { Route } from "./+types/feed";
import { requireUser } from "~/lib/auth.server";
import { createServerClient } from "~/lib/supabase.server";
import { Sidebar } from "~/components/sidebar";
import { IconChevronRight } from "~/components/icons";

// ── Types ──────────────────────────────────────────────────────

type QuestionType = "scq" | "mcq" | "integer" | "numerical" | "paragraph";

interface FeedQuestion {
  id: string;
  image_url: string | null;
  question_type: QuestionType;
  correct_answer: string | null;
  marks_correct: number;
  marks_wrong: number;
  chapter_id: string | null;
  chapter_name: string | null;
  chapter_slug: string | null;
  owner_id: string;
  owner_name: string;
  owner_username: string | null;
  solid_count: number;
  answer_count: number;
  pct_correct: number | null;
  option_counts: Record<string, number> | null;
  already_answered: boolean;
  my_answer: string | null;
  my_correct: boolean | null;
  my_solid: boolean;
}

interface Chapter {
  id: string;
  name: string;
  slug: string;
}

// ── Layer thresholds ──────────────────────────────────────────
const OWN_Q_THRESHOLD    = 5;   // min own questions answered for Layer 2
const CURATED_THRESHOLD  = 8;   // min community questions answered for Layer 3
const ACCURACY_THRESHOLD = 0.6; // min accuracy for both

// Don't re-run the loader when a fetcher (answer/solid/comment) submits —
// the queue is managed client-side and a reload would reset it mid-session.
export function shouldRevalidate() {
  return false;
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const user = await requireUser(request, env);
  const supabase = createServerClient(env);

  // Fetch all question IDs this user has already answered correctly — exclude them from the pool
  const { data: solvedRows } = await supabase
    .from("feed_answers")
    .select("question_id")
    .eq("user_id", user.id)
    .eq("is_correct", true);

  const solvedIds = new Set((solvedRows ?? []).map((r: any) => r.question_id as string));

  // Same question pool as arena: shared SCQ chemistry questions
  const { data: rawQuestions } = await supabase
    .from("questions")
    .select(`
      id, image_url, type, correct_answer,
      owner_id, chapter, subject,
      users!owner_id(display_name, username),
      solids(count),
      feed_answers!question_id(count)
    `)
    .eq("is_shared", true)
    .eq("type", "scq")
    .limit(200);

  const questionIds = (rawQuestions ?? []).map((q: any) => q.id);

  // Fetch which questions this user has already solided
  const { data: mySolidRows } = await supabase
    .from("solids")
    .select("question_id")
    .eq("user_id", user.id)
    .in("question_id", questionIds.length > 0 ? questionIds : ["none"]);

  const mySolidSet = new Set((mySolidRows ?? []).map((r: any) => r.question_id as string));

  const [myAnswersRes, allAnswersRes] = await Promise.all([
    supabase
      .from("feed_answers")
      .select("question_id, answer, is_correct")
      .eq("user_id", user.id)
      .in("question_id", questionIds.length > 0 ? questionIds : ["none"]),
    supabase
      .from("feed_answers")
      .select("question_id, answer, is_correct")
      .in("question_id", questionIds.length > 0 ? questionIds : ["none"]),
  ]);

  const myAnswerMap = new Map(
    (myAnswersRes.data ?? []).map((a: any) => [a.question_id, a])
  );

  // Per-option counts for each question
  const optionMap = new Map<string, Record<string, number>>();
  const pctMap = new Map<string, { correct: number; total: number }>();
  for (const a of allAnswersRes.data ?? []) {
    // pct correct
    const cur = pctMap.get(a.question_id) ?? { correct: 0, total: 0 };
    pctMap.set(a.question_id, { correct: cur.correct + (a.is_correct ? 1 : 0), total: cur.total + 1 });
    // per-option
    let raw = a.answer;
    if (typeof raw === "string") { try { raw = JSON.parse(raw); } catch {} }
    const letter = Array.isArray(raw) ? raw[0] : raw;
    if (letter && ["A","B","C","D"].includes(String(letter).toUpperCase())) {
      const l = String(letter).toUpperCase();
      const opts = optionMap.get(a.question_id) ?? { A:0, B:0, C:0, D:0 };
      opts[l] = (opts[l] ?? 0) + 1;
      optionMap.set(a.question_id, opts);
    }
  }

  // Per-question time averages needed for the sort formula
  const avgTimeMap = new Map<string, number>();
  const timeAccMap = new Map<string, { sum: number; count: number }>();
  for (const a of allAnswersRes.data ?? []) {
    // We don't have time_taken_secs in this query, so we'll compute it below
  }

  // Fetch average time per question for the sort formula
  const { data: timeRows } = await supabase
    .from("feed_answers")
    .select("question_id, time_taken_secs")
    .in("question_id", questionIds.length > 0 ? questionIds : ["none"])
    .not("time_taken_secs", "is", null);

  for (const row of timeRows ?? []) {
    const acc = timeAccMap.get(row.question_id) ?? { sum: 0, count: 0 };
    acc.sum += row.time_taken_secs as number;
    acc.count += 1;
    timeAccMap.set(row.question_id, acc);
  }
  for (const [qid, acc] of timeAccMap) {
    avgTimeMap.set(qid, acc.sum / acc.count);
  }

  // Build mapped questions — hard-exclude any question the user has already answered correctly
  const allMapped: FeedQuestion[] = (rawQuestions ?? [])
    .filter((q: any) => !solvedIds.has(q.id))
    .map((q: any) => {
    const myA = myAnswerMap.get(q.id);
    const pct = pctMap.get(q.id);
    const answerCount = q.feed_answers?.[0]?.count ?? 0;
    return {
      id: q.id,
      image_url: q.image_url,
      question_type: q.type,
      correct_answer: Array.isArray(q.correct_answer) ? q.correct_answer[0] : q.correct_answer,
      marks_correct: 4,
      marks_wrong: 1,
      chapter_id: null,
      chapter_name: q.chapter ?? null,
      chapter_slug: null,
      owner_id: q.owner_id,
      owner_name: q.users?.display_name ?? "Unknown",
      owner_username: q.users?.username ?? null,
      solid_count: q.solids?.[0]?.count ?? 0,
      answer_count: answerCount,
      pct_correct: pct ? Math.round((pct.correct / pct.total) * 100) : null,
      option_counts: optionMap.get(q.id) ?? null,
      already_answered: !!myA,
      my_answer: myA?.answer ?? null,
      my_correct: myA?.is_correct ?? null,
      my_solid: mySolidSet.has(q.id),
    };
  });

  // Filter: never show questions the user has already answered correctly
  const questions: FeedQuestion[] = allMapped
    .filter((q) => !(q.already_answered && q.my_correct === true))
    .sort((a, b) => {
      // Sort unsolved questions by:
      //   score = attempts * 2/10  +  incorrect_attempts / avg_time_spent * 8/10
      // Lower score = fewer attempts / harder / faster to answer → show first
      function score(q: FeedQuestion): number {
        const attempts = q.answer_count;
        const pct = q.pct_correct ?? 50;
        const incorrectAttempts = Math.round(attempts * (1 - pct / 100));
        const avgTime = avgTimeMap.get(q.id) ?? 60; // default 60s if unknown
        const attemptsComponent = attempts * (2 / 10);
        const difficultyComponent = avgTime > 0
          ? (incorrectAttempts / avgTime) * (8 / 10)
          : 0;
        return attemptsComponent + difficultyComponent;
      }
      return score(a) - score(b);
    });

  return data({ user, questions });
}

const REPORT_REASONS = [
  { value: "error_in_question",  label: "Error in question / option(s) / solution" },
  { value: "bad_image",          label: "Missing / wrong / bad quality image(s)" },
  { value: "wrong_answer_key",   label: "Wrong answer key" },
  { value: "repeated_question",  label: "Repeated question" },
  { value: "other",              label: "Other" },
];

function ReportModal({ questionId, onClose, onSubmitted }: { questionId: string; onClose: () => void; onSubmitted: () => void }) {
  const fetcher = useFetcher();
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");

  useEffect(() => {
    if ((fetcher.data as any)?.reported) { onSubmitted(); onClose(); }
  }, [fetcher.data]);

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 200,
      background: "rgba(0,0,0,0.45)", backdropFilter: "blur(2px)",
      display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
    }} onClick={onClose}>
      <div style={{
        background: "var(--c-surface)", border: "1px solid var(--c-border)",
        borderRadius: 16, padding: "24px", width: "100%", maxWidth: 420,
        boxShadow: "var(--shadow-lg)",
      }} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: "var(--c-text)" }}>Report question</div>
          <button type="button" onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--c-text-3)", fontSize: 18, lineHeight: 1, padding: 2 }}>✕</button>
        </div>

        <fetcher.Form method="post" action="/feed-actions">
          <input type="hidden" name="intent" value="report" />
          <input type="hidden" name="question_id" value={questionId} />

          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 14 }}>
            {REPORT_REASONS.map(r => (
              <label key={r.value} style={{
                display: "flex", alignItems: "center", gap: 10,
                padding: "10px 12px", borderRadius: 9, cursor: "pointer",
                border: `1.5px solid ${reason === r.value ? "var(--c-brand-500)" : "var(--c-border)"}`,
                background: reason === r.value ? "var(--c-brand-50)" : "transparent",
                transition: "all 0.12s",
              }}>
                <input type="radio" name="reason" value={r.value}
                  checked={reason === r.value}
                  onChange={() => setReason(r.value)}
                  style={{ accentColor: "var(--c-brand-500)" }} />
                <span style={{ fontSize: 13, color: reason === r.value ? "var(--c-brand-700)" : "var(--c-text-2)", fontWeight: reason === r.value ? 600 : 400 }}>
                  {r.label}
                </span>
              </label>
            ))}
          </div>

          {reason === "other" && (
            <textarea
              name="note" value={note} onChange={e => setNote(e.target.value)}
              placeholder="Describe the issue…"
              rows={3}
              style={{
                width: "100%", padding: "8px 10px", borderRadius: 8, fontSize: 13,
                border: "1px solid var(--c-border)", background: "var(--c-bg)",
                color: "var(--c-text)", resize: "vertical", fontFamily: "inherit",
                marginBottom: 12, boxSizing: "border-box",
              }}
            />
          )}
          {reason !== "other" && <div style={{ marginBottom: 12 }} />}

          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button type="button" onClick={onClose} style={{
              padding: "8px 16px", borderRadius: 8, fontSize: 13, fontWeight: 600,
              background: "transparent", color: "var(--c-text-2)",
              border: "1px solid var(--c-border)", cursor: "pointer",
            }}>Cancel</button>
            <button type="submit" disabled={!reason || fetcher.state !== "idle"} style={{
              padding: "8px 18px", borderRadius: 8, fontSize: 13, fontWeight: 700,
              background: reason ? "var(--c-error)" : "var(--c-border)",
              color: reason ? "#fff" : "var(--c-text-3)",
              border: "none", cursor: reason ? "pointer" : "not-allowed",
              opacity: fetcher.state !== "idle" ? 0.6 : 1,
            }}>Submit report</button>
          </div>
        </fetcher.Form>
      </div>
    </div>
  );
}

// ── Comment Section ───────────────────────────────────────────

interface CommentEntry {
  id: string;
  body: string;
  created_at: string;
  author_id: string;
  users: { display_name: string; username: string | null } | null;
}

function CommentSection({ questionId, answerCount, myTimeSecs }: {
  questionId: string;
  answerCount: number;
  myTimeSecs: number | null;
}) {
  const fetcher = useFetcher({ key: `comments-${questionId}` });
  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState("");
  const [comments, setComments] = useState<CommentEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [avgTime, setAvgTime] = useState<number | null>(null);
  const [reportCount, setReportCount] = useState(0);
  const [myReport, setMyReport] = useState<string | null>(null);
  const [showReport, setShowReport] = useState(false);

  function load() {
    if (loaded) return;
    const fd = new FormData();
    fd.set("intent", "get_comments");
    fd.set("question_id", questionId);
    fetcher.submit(fd, { method: "post", action: "/feed-actions" });
    setLoaded(true);
  }

  useEffect(() => {
    const d = fetcher.data as any;
    if (!d) return;
    if (d.comments) setComments(d.comments);
    if (d.avgTime !== undefined) setAvgTime(d.avgTime);
    if (d.reportCount !== undefined) setReportCount(d.reportCount);
    if (d.myReport !== undefined) setMyReport(d.myReport);
  }, [fetcher.data]);

  function handleExpand() { setExpanded(true); load(); }

  function postComment() {
    const body = draft.trim();
    if (!body) return;
    setComments(cs => [...cs, { id: String(Date.now()), body, created_at: new Date().toISOString(), author_id: "", users: { display_name: "You", username: null } }]);
    setDraft("");
    const fd = new FormData();
    fd.set("intent", "post_comment");
    fd.set("question_id", questionId);
    fd.set("body", body);
    fetcher.submit(fd, { method: "post", action: "/feed-actions" });
  }

  function fmtTime(secs: number): string {
    if (secs < 60) return `${secs}s`;
    return `${Math.floor(secs / 60)}m ${secs % 60}s`;
  }

  const shouldShowPullFlag = answerCount > 5 && reportCount > 0 && (reportCount / answerCount) >= 0.2;

  if (!expanded) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        {/* Time stats */}
        {(myTimeSecs !== null || avgTime !== null) && (
          <div style={{
            display: "flex", alignItems: "center", gap: 8,
            fontSize: 11, color: "var(--c-text-3)",
            background: "var(--c-subtle)", padding: "4px 10px", borderRadius: 20,
            border: "1px solid var(--c-border)",
          }}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
            </svg>
            {myTimeSecs !== null && <span>You: <strong style={{ color: "var(--c-text-2)" }}>{fmtTime(myTimeSecs)}</strong></span>}
            {myTimeSecs !== null && avgTime !== null && <span style={{ color: "var(--c-border-strong)" }}>·</span>}
            {avgTime !== null && <span>Avg: <strong style={{ color: "var(--c-text-2)" }}>{fmtTime(avgTime)}</strong></span>}
          </div>
        )}

        <button type="button" onClick={handleExpand} style={{
          background: "none", border: "none", cursor: "pointer",
          fontSize: 12, color: "var(--c-text-3)", padding: "2px 0",
          display: "flex", alignItems: "center", gap: 4,
        }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
          </svg>
          Discuss
        </button>

        {/* Report button */}
        {!myReport && (
          <button type="button" onClick={() => setShowReport(true)} style={{
            background: "none", border: "none", cursor: "pointer",
            fontSize: 12, color: "var(--c-text-3)", padding: "2px 0",
            display: "flex", alignItems: "center", gap: 4, marginLeft: "auto",
          }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/>
            </svg>
            Report
          </button>
        )}
        {myReport && (
          <span style={{ fontSize: 11, color: "var(--c-text-3)", marginLeft: "auto", fontStyle: "italic" }}>Reported</span>
        )}

        {shouldShowPullFlag && (
          <span style={{
            fontSize: 10, fontWeight: 700, color: "#b03030",
            background: "rgba(192,48,42,0.08)", border: "1px solid rgba(192,48,42,0.2)",
            padding: "2px 7px", borderRadius: 4,
          }}>
            ⚠ Under review
          </span>
        )}

        {showReport && (
          <ReportModal
            questionId={questionId}
            onClose={() => setShowReport(false)}
            onSubmitted={() => setMyReport("submitted")}
          />
        )}
      </div>
    );
  }

  return (
    <div style={{ marginTop: 4 }}>
      {/* Time stats expanded */}
      {(myTimeSecs !== null || avgTime !== null) && (
        <div style={{
          display: "flex", gap: 12, padding: "8px 12px", marginBottom: 12,
          background: "var(--c-subtle)", borderRadius: 8, border: "1px solid var(--c-border)",
          fontSize: 12,
        }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--c-text-3)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 1 }}>
            <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
          </svg>
          {myTimeSecs !== null && (
            <span style={{ color: "var(--c-text-2)" }}>Your time: <strong style={{ color: "var(--c-text)" }}>{fmtTime(myTimeSecs)}</strong></span>
          )}
          {myTimeSecs !== null && avgTime !== null && <span style={{ color: "var(--c-border-strong)" }}>·</span>}
          {avgTime !== null && (
            <span style={{ color: "var(--c-text-2)" }}>Community avg: <strong style={{ color: "var(--c-text)" }}>{fmtTime(avgTime)}</strong></span>
          )}
        </div>
      )}

      <div style={{ borderTop: "1px solid var(--c-border)", paddingTop: 12 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: "var(--c-text-3)", marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.06em", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          Discussion
          <div style={{ display: "flex", gap: 8 }}>
            {!myReport && (
              <button type="button" onClick={() => setShowReport(true)} style={{
                background: "none", border: "none", cursor: "pointer",
                fontSize: 10, color: "var(--c-text-3)", textTransform: "uppercase",
                letterSpacing: "0.06em", fontWeight: 700, display: "flex", alignItems: "center", gap: 3,
              }}>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/>
                </svg>
                Report
              </button>
            )}
            {myReport && <span style={{ fontSize: 10, color: "var(--c-text-3)", fontStyle: "italic" }}>Reported</span>}
          </div>
        </div>

        {fetcher.state !== "idle" && comments.length === 0 ? (
          <div style={{ fontSize: 12, color: "var(--c-text-3)", marginBottom: 10 }}>Loading…</div>
        ) : comments.length === 0 ? (
          <div style={{ fontSize: 12, color: "var(--c-text-3)", marginBottom: 10 }}>No comments yet. Be the first.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
            {comments.map((c) => (
              <div key={c.id} style={{
                padding: "8px 10px", borderRadius: 8,
                background: "var(--c-subtle)", fontSize: 13, lineHeight: 1.5,
              }}>
                <span style={{ fontWeight: 600, fontSize: 11, color: "var(--c-text-2)", marginRight: 6 }}>
                  {c.users?.display_name ?? "User"}
                </span>
                <span style={{ color: "var(--c-text)" }}>{c.body}</span>
              </div>
            ))}
          </div>
        )}

        <div style={{ display: "flex", gap: 6 }}>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); postComment(); } }}
            placeholder="Add a comment…"
            style={{
              flex: 1, padding: "7px 10px", borderRadius: 8, fontSize: 13,
              border: "1px solid var(--c-border)", background: "var(--c-bg)",
              color: "var(--c-text)", outline: "none",
            }}
          />
          <button type="button" onClick={postComment} disabled={!draft.trim()} style={{
            padding: "7px 14px", borderRadius: 8, fontSize: 13, fontWeight: 600,
            background: draft.trim() ? "var(--c-brand-500)" : "var(--c-border)",
            color: draft.trim() ? "#fff" : "var(--c-text-3)",
            border: "none", cursor: draft.trim() ? "pointer" : "not-allowed",
          }}>
            Post
          </button>
        </div>
      </div>

      {showReport && (
        <ReportModal
          questionId={questionId}
          onClose={() => setShowReport(false)}
          onSubmitted={() => setMyReport("submitted")}
        />
      )}
    </div>
  );
}

// ── Question Card ─────────────────────────────────────────────
// Shown one at a time. After answering, "Next" instantly swaps it.

interface QuestionCardProps {
  question: FeedQuestion;
  index: number;
  total: number;
  sessionCorrect: number;
  onNext: (wasCorrect: boolean, wasSolid: boolean) => void;
}

function QuestionCard({ question, index, total, sessionCorrect, onNext }: QuestionCardProps) {
  const fetcher         = useFetcher({ key: `answer-${question.id}` });
  const reactionFetcher = useFetcher({ key: `react-${question.id}` });
  const commentFetcher  = useFetcher({ key: `comment-${question.id}` });
  const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null);
  // Always start in the unanswered state — questions answered wrong are re-shown
  // for retry, so we never want to open straight into the solution view.
  const [submitted, setSubmitted]   = useState(false);
  const [isCorrect, setIsCorrect]   = useState<boolean | null>(null);
  const [pctCorrect, setPctCorrect] = useState<number | null>(question.pct_correct);
  const [solidised, setSolidised]   = useState(question.my_solid);
  const [solidCount, setSolidCount] = useState(question.solid_count);
  const [visible, setVisible]       = useState(true);

  // Time tracking
  const startTimeRef = useState<number>(() => Date.now())[0];
  const [myTimeSecs, setMyTimeSecs] = useState<number | null>(null);

  const isScq     = question.question_type === "scq";
  const isInteger = question.question_type === "integer" || question.question_type === "numerical";

  function handleSubmit(answer: string) {
    const elapsed = Math.round((Date.now() - startTimeRef) / 1000);
    setMyTimeSecs(elapsed);
    const correct = answer.trim().toLowerCase() === (question.correct_answer ?? "").trim().toLowerCase();
    setSelectedAnswer(answer);
    setIsCorrect(correct);
    setSubmitted(true);

    const fd = new FormData();
    fd.set("intent",           "answer");
    fd.set("question_id",      question.id);
    fd.set("answer",           answer);
    fd.set("correct_answer",   question.correct_answer ?? "");
    fd.set("owner_id",         question.owner_id);
    fd.set("time_taken_secs",  String(elapsed));
    fetcher.submit(fd, { method: "post", action: "/feed-actions" });
  }

  function handleSolid() {
    const fd = new FormData();
    fd.set("intent",      "solid");
    fd.set("question_id", question.id);
    fetcher.submit(fd, { method: "post", action: "/feed-actions" });
    setSolidised((s) => !s);
    setSolidCount((n) => solidised ? n - 1 : n + 1);
  }

  // Sync server pct after submit
  if (fetcher.data && pctCorrect === null) {
    const d = fetcher.data as any;
    if (d?.pctCorrect !== undefined) setPctCorrect(d.pctCorrect);
  }

  function handleNext() {
    setVisible(false);
    setTimeout(() => onNext(isCorrect ?? false, solidised), 160);
  }

  return (
    <div style={{
      opacity: visible ? 1 : 0,
      transform: visible ? "translateY(0) scale(1)" : "translateY(12px) scale(0.98)",
      transition: "opacity 0.16s ease, transform 0.16s ease",
    }}>
      <div style={{
        background: "var(--c-surface)",
        borderRadius: 20,
        border: "1px solid var(--c-border)",
        overflow: "hidden",
        boxShadow: "0 4px 24px rgba(0,0,0,0.07)",
      }}>
        {/* Card header */}
        <div style={{
          padding: "12px 18px",
          borderBottom: "1px solid var(--c-border)",
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {question.chapter_name && (
              <Link to={`/chapter/${question.chapter_slug}`} style={{
                fontSize: 11, fontWeight: 700, color: "var(--c-brand-600)",
                background: "var(--c-brand-50)", padding: "2px 8px", borderRadius: 20,
                textDecoration: "none",
              }}>
                {question.chapter_name}
              </Link>
            )}
            <span style={{ fontSize: 11, color: "var(--c-text-3)" }}>
              by{" "}
              {question.owner_username
                ? <Link to={`/u/${question.owner_username}`} style={{ color: "var(--c-text-2)", textDecoration: "none", fontWeight: 500 }}>
                    {question.owner_name}
                  </Link>
                : question.owner_name}
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{
              fontSize: 10, fontWeight: 700, textTransform: "uppercase",
              letterSpacing: "0.06em", color: "var(--c-text-3)",
              border: "1px solid var(--c-border)", padding: "1px 6px", borderRadius: 4,
            }}>
              {question.question_type}
            </span>
            <Link to={`/q/${question.id}`} style={{
              fontSize: 11, color: "var(--c-text-3)", textDecoration: "none",
              display: "flex", alignItems: "center", gap: 2,
            }}>
              Full <IconChevronRight size={11} />
            </Link>
          </div>
        </div>

        {/* Question image */}
        {question.image_url && (
          <div style={{ background: "var(--c-bg)", padding: "20px 20px 0" }}>
            <img src={question.image_url} alt="Question" style={{
              width: "100%", maxHeight: 320,
              objectFit: "contain", borderRadius: 10, display: "block",
            }} />
          </div>
        )}

        {/* Answer area */}
        <div style={{ padding: 20 }}>
          {!submitted ? (
            <>
              {isScq && (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
                  {["A", "B", "C", "D"].map((opt) => (
                    <button key={opt} type="button" onClick={() => setSelectedAnswer(opt)} style={{
                      padding: "12px 14px", borderRadius: 10,
                      border: `1.5px solid ${selectedAnswer === opt ? "var(--c-brand-500)" : "var(--c-border)"}`,
                      background: selectedAnswer === opt ? "var(--c-brand-50)" : "transparent",
                      color: selectedAnswer === opt ? "var(--c-brand-600)" : "var(--c-text-2)",
                      fontSize: 14, fontWeight: 600, cursor: "pointer",
                      transition: "border-color 0.1s, background 0.1s",
                    }}>
                      {opt}
                    </button>
                  ))}
                </div>
              )}
              {isInteger && (
                <input type="number" placeholder="Enter your answer" className="input"
                  style={{ marginBottom: 12, fontSize: 15 }}
                  onChange={(e) => setSelectedAnswer(e.target.value)}
                  value={selectedAnswer ?? ""} />
              )}
              <button type="button" disabled={!selectedAnswer}
                onClick={() => selectedAnswer && handleSubmit(selectedAnswer)}
                style={{
                  width: "100%", padding: "12px", borderRadius: 10,
                  background: selectedAnswer ? "var(--c-brand-500)" : "var(--c-border)",
                  color: selectedAnswer ? "#fff" : "var(--c-text-3)",
                  fontSize: 14, fontWeight: 700, border: "none",
                  cursor: selectedAnswer ? "pointer" : "not-allowed",
                  transition: "background 0.15s",
                }}>
                Submit
              </button>
            </>
          ) : (
            <>
              {/* Result */}
              <div style={{
                padding: "14px 16px", borderRadius: 12, marginBottom: 14,
                background: isCorrect ? "rgba(76,187,122,0.08)" : "rgba(192,48,42,0.06)",
                border: `1px solid ${isCorrect ? "rgba(76,187,122,0.25)" : "rgba(192,48,42,0.2)"}`,
                display: "flex", alignItems: "center", gap: 12,
              }}>
                {isCorrect
                  ? <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#2d7a4f" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                  : <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--c-error)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                }
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: isCorrect ? "#2d7a4f" : "var(--c-error)" }}>
                    {isCorrect ? "Correct!" : `Incorrect — answer is ${question.correct_answer}`}
                  </div>
                  {pctCorrect !== null && (
                    <div style={{ fontSize: 12, color: "var(--c-text-3)", marginTop: 2 }}>
                      {isCorrect
                        ? `${pctCorrect}% of students got this right`
                        : `Only ${pctCorrect}% got this right — you're in good company`}
                    </div>
                  )}
                </div>
              </div>

              {/* Per-option breakdown bars */}
              {question.option_counts && (() => {
                const counts = question.option_counts as Record<string,number>;
                const total = Object.values(counts).reduce((s,n) => s+n, 0) || 1;
                const correct = Array.isArray(question.correct_answer) ? question.correct_answer[0] : question.correct_answer;
                return (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 14 }}>
                    {(["A","B","C","D"] as const).map(letter => {
                      const count = counts[letter] ?? 0;
                      const pct = Math.round((count / total) * 100);
                      const isCorrectOpt = String(correct).toUpperCase() === letter;
                      const myPick = String(selectedAnswer ?? question.my_answer ?? "").toUpperCase() === letter;
                      return (
                        <div key={letter} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{
                            width: 22, height: 22, borderRadius: "50%", flexShrink: 0,
                            display: "flex", alignItems: "center", justifyContent: "center",
                            fontSize: 11, fontWeight: 700,
                            background: isCorrectOpt ? "var(--c-success)" : myPick ? "var(--c-error)" : "var(--c-surface-2)",
                            color: (isCorrectOpt || myPick) ? "#fff" : "var(--c-text-3)",
                          }}>{letter}</span>
                          <div style={{ flex: 1, height: 6, background: "var(--c-border)", borderRadius: 3, overflow: "hidden" }}>
                            <div style={{
                              height: "100%", borderRadius: 3,
                              background: isCorrectOpt ? "var(--c-success)" : myPick ? "var(--c-error)" : "var(--c-border-strong)",
                              width: `${pct}%`, transition: "width 0.4s ease",
                            }} />
                          </div>
                          <span style={{ fontSize: 11, color: "var(--c-text-3)", width: 32, textAlign: "right" }}>{pct}%</span>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}

              {/* Solid + Next row */}
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
                <button type="button" onClick={handleSolid} style={{
                  padding: "8px 16px", borderRadius: 20, fontSize: 12, fontWeight: 600,
                  background: solidised ? "var(--c-brand-50)" : "transparent",
                  color: solidised ? "var(--c-brand-600)" : "var(--c-text-2)",
                  border: `1px solid ${solidised ? "var(--c-brand-200)" : "var(--c-border)"}`,
                  cursor: "pointer", flexShrink: 0,
                  transition: "all 0.15s",
                  display: "flex", alignItems: "center", gap: 6,
                }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill={solidised ? "var(--c-brand-600)" : "none"} stroke={solidised ? "var(--c-brand-600)" : "var(--c-text-3)"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M7 10v12"/><path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z"/>
                  </svg>
                  Solid · {solidCount}
                </button>

                <div style={{ flex: 1 }} />

                {/* Next button — only way to advance */}
                <button type="button" onClick={handleNext} style={{
                  padding: "10px 24px", borderRadius: 10,
                  background: "var(--c-brand-500)", color: "#fff",
                  fontSize: 14, fontWeight: 700, border: "none", cursor: "pointer",
                  display: "flex", alignItems: "center", gap: 6,
                }}>
                  Next <IconChevronRight size={14} />
                </button>
              </div>

              {/* ── Comment + Report section ─────────────────── */}
              <CommentSection
                questionId={question.id}
                answerCount={question.answer_count}
                myTimeSecs={myTimeSecs}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Subject groupings ─────────────────────────────────────────
const SUBJECT_LABELS: Record<string, string> = {
  physics: "Physics", chemistry: "Chemistry", mathematics: "Mathematics",
};

// Slugs known to belong to each subject (derived from migration seed order)
// We detect subject from chapter position in the DB-ordered list.
// Chapters 1-20 → physics, 21-48 → chemistry, 49-66 → mathematics
// Instead we just group by matching slug prefix keywords — clean enough.
function guessSubject(slug: string): string {
  const physicsKeywords = ["kinematics","laws-of-motion","work-energy","rotational","gravitation","properties-of-matter","thermodynamics","kinetic-theory","simple-harmonic","waves","electrostatics","current-electricity","magnetic","electromagnetic-induction","alternating-current","electromagnetic-waves","ray-optics","wave-optics","modern-physics","semiconductors"];
  const chemKeywords = ["mole-concept","atomic-structure","chemical-bonding","states-of-matter","thermodynamics-chem","equilibrium","redox","electrochemistry","chemical-kinetics","surface-chemistry","periodic-table","hydrogen-s-block","p-block","d-f-block","coordination","metallurgy","qualitative","organic-chemistry","hydrocarbons","haloalkanes","alcohols","aldehydes","carboxylic","amines","biomolecules","polymers","chemistry-everyday","environmental-chemistry"];
  if (physicsKeywords.some(k => slug.startsWith(k))) return "physics";
  if (chemKeywords.some(k => slug.startsWith(k))) return "chemistry";
  return "mathematics";
}

// ── Feed Page ─────────────────────────────────────────────────

export default function FeedPage({ loaderData }: Route.ComponentProps) {
  const { user, questions } = loaderData;

  // Server already filters out correctly-answered questions; this is just a safety net
  const unsolved = questions.filter((q: FeedQuestion) => !(q.already_answered && q.my_correct === true));
  const [queue, setQueue] = useState<FeedQuestion[]>([...unsolved]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [sessionCorrect, setSessionCorrect] = useState(0);
  const [sessionTotal, setSessionTotal]     = useState(0);
  const [done, setDone] = useState(false);
  // Track question IDs correctly answered during this session so "Go again"
  // doesn't re-show them (the loader never re-runs while on the page).
  const [sessionSolvedIds, setSessionSolvedIds] = useState<Set<string>>(new Set());

  const current = queue[currentIndex] ?? null;

  function handleNext(wasCorrect: boolean, _wasSolid: boolean) {
    setSessionTotal((n) => n + 1);
    if (wasCorrect) {
      setSessionCorrect((n) => n + 1);
      // Record this question as solved so "Go again" won't re-show it
      if (current) setSessionSolvedIds((prev) => new Set([...prev, current.id]));
    }

    const next = currentIndex + 1;
    if (next >= queue.length) {
      setDone(true);
    } else {
      setCurrentIndex(next);
    }
  }

  // Reset only when the *set* of question IDs changes (i.e. chapter filter changed),
  // NOT on every loader re-fetch that follows an answer submission (same 120 IDs, updated metadata).
  // We track the pool key in a ref so that re-fetches with identical IDs are ignored,
  // preventing the queue from resetting mid-session and showing a stale question's answer key.
  const questionPoolKeyRef = useRef<string>("");
  useEffect(() => {
    if (questions.length === 0) return;
    const newKey = questions.map((q: FeedQuestion) => q.id).sort().join(",");
    if (newKey === questionPoolKeyRef.current) return; // same pool — don't reset
    questionPoolKeyRef.current = newKey;
    const unsolved = questions.filter((q: FeedQuestion) => !(q.already_answered && q.my_correct === true));
    setQueue([...unsolved]);
    setCurrentIndex(0);
    setSessionCorrect(0);
    setSessionTotal(0);
    setDone(false);
  }, [questions]);

  const accuracy = sessionTotal > 0 ? Math.round((sessionCorrect / sessionTotal) * 100) : null;

  return (
    <div className="app-layout">
      <Sidebar displayName={user.display_name} username={(user as any).username} />

      <main className="app-main" style={{ padding: "28px 12px" }}>
        <div style={{ maxWidth: 740, margin: "0 auto" }}>

        {/* Header row */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
          <div>
            <h1 style={{ fontFamily: "var(--font-display)", fontSize: 26, fontWeight: 700, color: "var(--c-text)", margin: 0 }}>
              Feed
            </h1>
            <p style={{ margin: "3px 0 0", fontSize: 12, color: "var(--c-text-3)" }}>
              One question at a time. Jeelo tracks your accuracy silently.
            </p>
          </div>

          <div />
          {/* Session score pill */}
          {sessionTotal > 0 && (
            <div style={{
              padding: "6px 14px", borderRadius: 20,
              background: accuracy !== null && accuracy >= 60
                ? "rgba(76,187,122,0.1)" : "rgba(192,48,42,0.07)",
              border: `1px solid ${accuracy !== null && accuracy >= 60
                ? "rgba(76,187,122,0.3)" : "rgba(192,48,42,0.2)"}`,
              fontSize: 13, fontWeight: 700,
              color: accuracy !== null && accuracy >= 60 ? "#2d7a4f" : "var(--c-error)",
            }}>
              {sessionCorrect}/{sessionTotal} · {accuracy}%
            </div>
          )}
        </div>

        {/* Progress bar across queue */}
        {queue.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ height: 3, background: "var(--c-border)", borderRadius: 2, overflow: "hidden" }}>
              <div style={{
                height: "100%",
                width: `${(currentIndex / queue.length) * 100}%`,
                background: "var(--c-brand-500)",
                borderRadius: 2,
                transition: "width 0.3s ease",
              }} />
            </div>
          </div>
        )}

        {/* Main content */}
        {queue.length === 0 ? (
          <div style={{ textAlign: "center", padding: "60px 20px" }}>
            <img src="/jeelo-jumping.png" alt="Jeelo"
              style={{ width: 100, height: 100, objectFit: "contain", marginBottom: 16 }}
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
            <p style={{ fontSize: 15, fontWeight: 600, color: "var(--c-text)", marginBottom: 6 }}>
              No questions here yet.
            </p>
            <p style={{ fontSize: 13, color: "var(--c-text-3)" }}>
              Try a different chapter, or come back later.
            </p>
          </div>
        ) : done ? (
          /* Done state */
          <div style={{
            textAlign: "center", padding: "48px 24px",
            background: "var(--c-surface)", borderRadius: 20,
            border: "1px solid var(--c-border)",
          }}>
            <img src="/jeelo-jumping.png" alt="Jeelo"
              style={{ width: 100, height: 100, objectFit: "contain", marginBottom: 16 }}
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
            <h2 style={{ fontSize: 20, fontWeight: 800, color: "var(--c-text)", margin: "0 0 8px" }}>
              Session complete.
            </h2>
            <p style={{ fontSize: 14, color: "var(--c-text-3)", margin: "0 0 6px" }}>
              {sessionCorrect}/{sessionTotal} correct · {accuracy}%
            </p>
            <p style={{ fontSize: 13, color: "var(--c-text-3)", margin: "0 0 24px" }}>
              {accuracy !== null && accuracy >= 80
                ? "Jeelo is quietly impressed."
                : accuracy !== null && accuracy >= 60
                ? "Solid. The chapter is getting there."
                : "Rough one. The map will remember."}
            </p>
            <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
              <button type="button" onClick={() => {
                const unsolved = questions.filter((q) => 
                  !(q.already_answered && q.my_correct === true) && !sessionSolvedIds.has(q.id)
                );
                setQueue([...unsolved]);
                setCurrentIndex(0);
                setSessionCorrect(0);
                setSessionTotal(0);
                setDone(false);
              }} style={{
                padding: "10px 22px", borderRadius: 10,
                background: "var(--c-brand-500)", color: "#fff",
                fontSize: 13, fontWeight: 700, border: "none", cursor: "pointer",
              }}>
                Go again
              </button>
              <Link to="/map" style={{
                padding: "10px 22px", borderRadius: 10,
                background: "transparent", color: "var(--c-text-2)",
                fontSize: 13, fontWeight: 600, textDecoration: "none",
                border: "1px solid var(--c-border)",
              }}>
                Back to map
              </Link>
            </div>
          </div>
        ) : current ? (
          <QuestionCard
            key={current.id}
            question={current}
            index={currentIndex}
            total={queue.length}
            sessionCorrect={sessionCorrect}
            onNext={handleNext}
          />
        ) : null}
        </div>
      </main>
    </div>
  );
}
