import { data, redirect, useSubmit } from "react-router";
import { useState, useEffect, useRef, useCallback } from "react";
import type { Route } from "./+types/arena.$matchId";
import { requireUser } from "~/lib/auth.server";
import { createServerClient } from "~/lib/supabase.server";

// ── Types ──────────────────────────────────────────────────────

interface ArenaQuestion {
  id: string;
  image_url: string;
  correct_answer: string;
}

interface ArenaMatch {
  id: string;
  mode: "bullet" | "blitz" | "rapid";
  bot_name: string;
  bot_elo: number;
  bot_accuracy: number;
  questions: ArenaQuestion[];
  bot_answers: Record<string, string | null>;
  started_at: string;
  submitted_at: string | null;
}

const MODE_SECONDS: Record<string, number> = {
  bullet: 60,
  blitz: 180,
  rapid: 600,
};
const MODE_LABEL: Record<string, string> = {
  bullet: "Bullet", blitz: "Blitz", rapid: "Rapid",
};
const MARKS_CORRECT = 4;
const MARKS_WRONG   = 1; // JEE: -1 for wrong

// ── Adaptive K-factor ─────────────────────────────────────────
// High K in early games so the system finds your level fast.
function getKFactor(gamesPlayed: number): number {
  if (gamesPlayed <  5) return 160;  // placement: massive swings
  if (gamesPlayed < 10) return 100;  // still calibrating
  if (gamesPlayed < 20) return 56;   // settling
  if (gamesPlayed < 50) return 32;   // narrowing
  return 20;                         // stable
}

// Whether this rating is still provisional (shown as "?" in UI)
export function isProvisional(gamesPlayed: number): boolean {
  return gamesPlayed < 10;
}

// ── Loader ────────────────────────────────────────────────────

export async function loader({ params, request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const user = await requireUser(request, env);
  const supabase = createServerClient(env);

  const { data: match, error } = await supabase
    .from("arena_matches")
    .select("*")
    .eq("id", params.matchId)
    .eq("player_id", user.id)
    .single();

  if (error || !match) throw new Response("Match not found", { status: 404 });

  // Already submitted — go to result
  if (match.submitted_at) {
    return redirect(`/arena/${params.matchId}/result`);
  }

  return data({ user, match: match as ArenaMatch });
}

// ── Action — submit answers ────────────────────────────────────

export async function action({ params, request, context }: Route.ActionArgs) {
  const env = context.cloudflare.env;
  const user = await requireUser(request, env);
  const supabase = createServerClient(env);

  const formData = await request.formData();
  const answersJson = formData.get("answers") as string;
  const playerAnswers: Record<string, string> = JSON.parse(answersJson || "{}");

  // Fetch match (verify ownership)
  const { data: match } = await supabase
    .from("arena_matches")
    .select("*")
    .eq("id", params.matchId)
    .eq("player_id", user.id)
    .single();

  if (!match) throw new Response("Not found", { status: 404 });

  // Already submitted (race condition guard)
  if (match.submitted_at) {
    return redirect(`/arena/${params.matchId}/result`);
  }

  const questions: ArenaQuestion[] = match.questions as any;
  const botAnswers: Record<string, string | null> = match.bot_answers as any;

  // Score player (correct answers)
  let playerCorrect = 0;
  for (const q of questions) {
    if (playerAnswers[q.id] === q.correct_answer) playerCorrect++;
  }
  const playerAttempted = Object.values(playerAnswers).filter(a => a != null && a !== "").length;
  const playerWrong = playerAttempted - playerCorrect;
  // JEE-style: +4 correct, -1 wrong
  const playerActualMarks = playerCorrect * MARKS_CORRECT - playerWrong * MARKS_WRONG;
  const playerRawMarks    = playerAttempted * MARKS_CORRECT; // optimistic (no deductions)

  // Score bot
  let botCorrect = 0;
  for (const q of questions) {
    if (botAnswers[q.id] && botAnswers[q.id] === q.correct_answer) botCorrect++;
  }

  // ELO calculation (margin-based)
  const { data: rating } = await supabase
    .from("arena_ratings")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();

  const modeEloKey = `${match.mode}_elo` as keyof typeof rating;
  const modeGamesKey = `${match.mode}_games` as keyof typeof rating;
  const playerElo = (rating as any)?.[modeEloKey] ?? 1200;
  const gamesPlayed = (rating as any)?.[modeGamesKey] ?? 0;

  const K = getKFactor(gamesPlayed);

  const expected = 1 / (1 + Math.pow(10, (match.bot_elo - playerElo) / 400));
  // Binary win/loss (not margin-based) so swings are always decisive
  const actual = playerCorrect > botCorrect ? 1 : playerCorrect < botCorrect ? 0 : 0.5;
  const eloChange = Math.round(K * (actual - expected));
  const newElo = Math.max(100, playerElo + eloChange);

  const durationHours = MODE_SECONDS[match.mode] / 3600;

  // Update match record
  await supabase
    .from("arena_matches")
    .update({
      player_answers: playerAnswers,
      player_correct: playerCorrect,
      bot_correct: botCorrect,
      player_elo_before: playerElo,
      player_elo_after: newElo,
      submitted_at: new Date().toISOString(),
    })
    .eq("id", params.matchId);

  // Upsert arena_ratings — career marks uses actual JEE score
  const prevMarks = (rating as any)?.total_marks ?? 0;
  const prevTime = (rating as any)?.total_time_hours ?? 0;

  await supabase
    .from("arena_ratings")
    .upsert(
      {
        user_id: user.id,
        [`${match.mode}_elo`]: newElo,
        [`${match.mode}_games`]: gamesPlayed + 1,
        total_marks: prevMarks + playerActualMarks, // actual JEE marks for career rate
        total_time_hours: prevTime + durationHours,
        updated_at: new Date().toISOString(),
      } as any,
      { onConflict: "user_id", ignoreDuplicates: false }
    );

  return redirect(`/arena/${params.matchId}/result`);
}

// ── Client — Match UI ─────────────────────────────────────────

export default function ArenaMatch({ loaderData }: Route.ComponentProps) {
  const { user, match } = loaderData;
  const submit = useSubmit();

  const totalSeconds = MODE_SECONDS[match.mode];
  const elapsedSoFar = Math.floor(
    (Date.now() - new Date(match.started_at).getTime()) / 1000
  );
  const initialRemaining = Math.max(0, totalSeconds - elapsedSoFar);

  const [timeLeft, setTimeLeft] = useState(initialRemaining);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState(false);
  const [botAnswered, setBotAnswered] = useState(0);

  // Bot simulation — pre-compute how many questions bot answers at each second
  const botTotalAttempts = Object.values(match.bot_answers).filter(v => v !== null).length;
  const botRate = totalSeconds > 0 ? botTotalAttempts / totalSeconds : 0;

  const answersRef = useRef(answers);
  answersRef.current = answers;

  // ── Persist answers to localStorage every tick so reload doesn't lose them ──
  const LS_KEY = `arena_answers_${match.id}`;
  useEffect(() => {
    if (Object.keys(answers).length > 0) {
      try { localStorage.setItem(LS_KEY, JSON.stringify(answers)); } catch {}
    }
  }, [answers, LS_KEY]);

  // Restore from localStorage on mount (covers page refresh mid-match)
  useEffect(() => {
    try {
      const saved = localStorage.getItem(LS_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        setAnswers(prev => Object.keys(prev).length === 0 ? parsed : prev);
      }
    } catch {}
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Warn before navigating away
  useEffect(() => {
    function onBeforeUnload(e: BeforeUnloadEvent) {
      if (submitted) return;
      e.preventDefault();
      e.returnValue = "Leave this page? Your match progress will be lost.";
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [submitted]);

  const doSubmit = useCallback(() => {
    if (submitted) return;
    setSubmitted(true);
    try { localStorage.removeItem(`arena_answers_${match.id}`); } catch {}
    const form = new FormData();
    form.append("answers", JSON.stringify(answersRef.current));
    submit(form, { method: "post" });
  }, [submitted, submit, match.id]);

  // Countdown timer
  useEffect(() => {
    if (timeLeft <= 0) {
      doSubmit();
      return;
    }
    const t = setInterval(() => {
      setTimeLeft(prev => {
        const next = prev - 1;
        // Bot progress update
        setBotAnswered(Math.min(botTotalAttempts, Math.round((totalSeconds - next) * botRate)));
        if (next <= 0) {
          clearInterval(t);
          doSubmit();
        }
        return next;
      });
    }, 1000);
    return () => clearInterval(t);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const currentQ = match.questions[currentIdx];
  const totalQ = match.questions.length;
  const answeredCount = Object.keys(answers).length;

  // Live marks/hour — based on questions attempted, regardless of correct/wrong
  // (we don't know correct during match — this is pace metric)
  const elapsedSeconds = totalSeconds - timeLeft;
  const elapsedHours = elapsedSeconds / 3600;
  const liveMph = elapsedHours > 0.0005
    ? Math.round((answeredCount * MARKS_CORRECT) / elapsedHours)
    : 0;

  // Timer colour
  const pct = timeLeft / totalSeconds;
  const timerColor = pct > 0.5 ? "#3a9e6a" : pct > 0.25 ? "#d4a017" : "#d04040";

  function formatTime(s: number) {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, "0")}`;
  }

  function handleAnswer(letter: string) {
    if (submitted) return;
    setAnswers(prev => ({ ...prev, [currentQ.id]: letter }));
    // Always advance — loop back to start when at end so there's no ceiling
    setCurrentIdx(prev => (prev + 1) % totalQ);
  }

  return (
    <div style={{
      minHeight: "100vh",
      background: "var(--c-bg)",
      display: "flex",
      flexDirection: "column",
    }}>
      {/* ── Top bar ── */}
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "12px 20px",
        borderBottom: "1px solid var(--c-border)",
        background: "var(--c-surface)",
        gap: 16,
        flexWrap: "wrap",
      }}>
        {/* Mode badge */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontWeight: 700, fontSize: 15, color: "var(--c-text)" }}>
            {MODE_LABEL[match.mode] ?? match.mode} · vs {match.bot_name}
          </span>
        </div>

        {/* Timer */}
        <div style={{
          fontSize: 28,
          fontWeight: 800,
          fontVariantNumeric: "tabular-nums",
          color: timerColor,
          letterSpacing: -0.5,
          minWidth: 72,
          textAlign: "center",
        }}>
          {formatTime(timeLeft)}
        </div>

        {/* Raw marks/hour — pace metric only, result hidden until end */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
          <span style={{ fontSize: 11, color: "var(--c-text-3)", marginBottom: 1 }}>
            raw marks/hr
          </span>
          <span style={{
            fontSize: 20, fontWeight: 800, color: "var(--c-brand-500)",
            fontVariantNumeric: "tabular-nums",
          }}>
            {liveMph.toLocaleString()}
          </span>
        </div>
      </div>

      {/* ── Progress bars ── */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: 0,
        borderBottom: "1px solid var(--c-border)",
        background: "var(--c-surface)",
      }}>
        {/* Player */}
        <div style={{ padding: "10px 16px", borderRight: "1px solid var(--c-border)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: "var(--c-text)" }}>
              {user.display_name}
            </span>
            <span style={{ fontSize: 12, color: "var(--c-text-3)" }}>
              {answeredCount}/{totalQ}
            </span>
          </div>
          <div style={{ height: 5, background: "var(--c-subtle)", borderRadius: 3, overflow: "hidden" }}>
            <div style={{
              height: "100%",
              width: `${(answeredCount / totalQ) * 100}%`,
              background: "var(--c-brand-500)",
              borderRadius: 3,
              transition: "width 0.3s",
            }} />
          </div>
        </div>

        {/* Bot */}
        <div style={{ padding: "10px 16px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: "var(--c-text-2)" }}>
              {match.bot_name} <span style={{ fontWeight: 400, color: "var(--c-text-3)" }}>({match.bot_elo})</span>
            </span>
            <span style={{ fontSize: 12, color: "var(--c-text-3)" }}>
              {botAnswered}/{totalQ}
            </span>
          </div>
          <div style={{ height: 5, background: "var(--c-subtle)", borderRadius: 3, overflow: "hidden" }}>
            <div style={{
              height: "100%",
              width: `${(botAnswered / totalQ) * 100}%`,
              background: "#7a6e62",
              borderRadius: 3,
              transition: "width 1s linear",
            }} />
          </div>
        </div>
      </div>

      {/* ── Question area ── */}
      <div style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "24px 16px",
        maxWidth: 720,
        width: "100%",
        margin: "0 auto",
      }}>
        {/* Question counter + nav dots */}
        <div style={{
          display: "flex",
          gap: 4,
          marginBottom: 20,
          flexWrap: "wrap",
          justifyContent: "center",
        }}>
          {match.questions.map((q, i) => {
            const isAnswered = !!answers[q.id];
            const isCurrent = i === currentIdx;
            return (
              <button
                key={q.id}
                onClick={() => setCurrentIdx(i)}
                style={{
                  width: 24, height: 24,
                  borderRadius: "var(--r-xs)",
                  border: isCurrent
                    ? "2px solid var(--c-brand-500)"
                    : "1.5px solid var(--c-border)",
                  background: isAnswered
                    ? "var(--c-brand-100)"
                    : isCurrent
                      ? "var(--c-brand-50)"
                      : "transparent",
                  fontSize: 10,
                  fontWeight: 600,
                  color: isAnswered ? "var(--c-brand-600)" : "var(--c-text-3)",
                  cursor: "pointer",
                  transition: "all var(--t)",
                }}
              >
                {i + 1}
              </button>
            );
          })}
        </div>

        {/* Question image */}
        {currentQ && (
          <>
            <div style={{
              width: "100%",
              background: "var(--c-surface)",
              border: "1px solid var(--c-border)",
              borderRadius: "var(--r-lg)",
              overflow: "hidden",
              marginBottom: 20,
            }}>
              <img
                key={currentQ.id}
                src={currentQ.image_url}
                alt={`Question ${currentIdx + 1}`}
                style={{ width: "100%", display: "block" }}
              />
            </div>

            {/* Answer buttons */}
            <div style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 10,
              width: "100%",
            }}>
              {(["A", "B", "C", "D"] as const).map(letter => {
                const selected = answers[currentQ.id] === letter;
                return (
                  <button
                    key={letter}
                    onClick={() => handleAnswer(letter)}
                    disabled={submitted}
                    style={{
                      padding: "14px 20px",
                      borderRadius: "var(--r-md)",
                      border: selected
                        ? "2px solid var(--c-brand-500)"
                        : "1.5px solid var(--c-border)",
                      background: selected ? "var(--c-brand-100)" : "var(--c-surface)",
                      color: selected ? "var(--c-brand-600)" : "var(--c-text)",
                      fontSize: 16,
                      fontWeight: 700,
                      cursor: submitted ? "not-allowed" : "pointer",
                      transition: "all var(--t)",
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                    }}
                    onMouseEnter={e => {
                      if (!submitted && !selected) {
                        (e.currentTarget as HTMLElement).style.background = "var(--c-hover)";
                        (e.currentTarget as HTMLElement).style.borderColor = "var(--c-border-strong)";
                      }
                    }}
                    onMouseLeave={e => {
                      if (!submitted && !selected) {
                        (e.currentTarget as HTMLElement).style.background = "var(--c-surface)";
                        (e.currentTarget as HTMLElement).style.borderColor = "var(--c-border)";
                      }
                    }}
                  >
                    <span style={{
                      width: 28, height: 28,
                      borderRadius: "var(--r-xs)",
                      background: selected ? "var(--c-brand-200)" : "var(--c-subtle)",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 13, flexShrink: 0,
                    }}>
                      {letter}
                    </span>
                    Option {letter}
                  </button>
                );
              })}
            </div>

            {/* Forfeit (explicit, destructive — no accidental early submit) */}
            {!submitted && (
              <button
                onClick={() => {
                  if (window.confirm("Forfeit this match? Your current answers will be scored.")) {
                    doSubmit();
                  }
                }}
                style={{
                  marginTop: 24,
                  padding: "8px 20px",
                  background: "transparent",
                  color: "var(--c-text-3)",
                  border: "1px solid var(--c-border)",
                  borderRadius: "var(--r-md)",
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Forfeit match
              </button>
            )}

            {submitted && (
              <div style={{
                marginTop: 20,
                padding: "12px 24px",
                background: "var(--c-subtle)",
                borderRadius: "var(--r-md)",
                fontSize: 13,
                color: "var(--c-text-3)",
                textAlign: "center",
              }}>
                Scoring your answers…
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
