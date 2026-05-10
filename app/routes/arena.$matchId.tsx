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
const MARKS_WRONG   = 1;

// ── Adaptive K-factor ─────────────────────────────────────────

function getKFactor(gamesPlayed: number): number {
  if (gamesPlayed <  5) return 160;
  if (gamesPlayed < 10) return 100;
  if (gamesPlayed < 20) return 56;
  if (gamesPlayed < 50) return 32;
  return 20;
}

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
  const answersJson        = formData.get("answers") as string;
  const elapsedSecondsStr  = formData.get("elapsed_seconds") as string | null;
  const playerAnswers: Record<string, string> = JSON.parse(answersJson || "{}");

  const { data: match } = await supabase
    .from("arena_matches")
    .select("*")
    .eq("id", params.matchId)
    .eq("player_id", user.id)
    .single();

  if (!match) throw new Response("Not found", { status: 404 });
  if (match.submitted_at) return redirect(`/arena/${params.matchId}/result`);

  const questions: ArenaQuestion[] = match.questions as any;
  const botAnswers: Record<string, string | null> = match.bot_answers as any;

  let playerCorrect = 0;
  for (const q of questions) {
    if (playerAnswers[q.id] === q.correct_answer) playerCorrect++;
  }
  const playerAttempted   = Object.values(playerAnswers).filter(a => a != null && a !== "").length;
  const playerWrong       = playerAttempted - playerCorrect;
  const playerActualMarks = playerCorrect * MARKS_CORRECT - playerWrong * MARKS_WRONG;

  let botCorrect = 0;
  for (const q of questions) {
    if (botAnswers[q.id] && botAnswers[q.id] === q.correct_answer) botCorrect++;
  }

  const { data: rating } = await supabase
    .from("arena_ratings")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();

  const modeEloKey   = `${match.mode}_elo`   as keyof typeof rating;
  const modeGamesKey = `${match.mode}_games` as keyof typeof rating;
  const playerElo    = (rating as any)?.[modeEloKey]   ?? 1200;
  const gamesPlayed  = (rating as any)?.[modeGamesKey] ?? 0;

  const K        = getKFactor(gamesPlayed);
  const expected = 1 / (1 + Math.pow(10, (match.bot_elo - playerElo) / 400));
  const actual   = playerCorrect > botCorrect ? 1 : playerCorrect < botCorrect ? 0 : 0.5;
  const eloChange = Math.round(K * (actual - expected));
  const newElo   = Math.max(100, playerElo + eloChange);

  const durationHours = MODE_SECONDS[match.mode] / 3600;

  // ── avg_seconds_per_question — drives adaptive bot nudge ─────
  const elapsedSeconds = elapsedSecondsStr != null
    ? Math.min(parseInt(elapsedSecondsStr, 10) || MODE_SECONDS[match.mode], MODE_SECONDS[match.mode])
    : MODE_SECONDS[match.mode];

  const prevAvgSpq: number | null = (rating as any)?.avg_seconds_per_question ?? null;
  let newAvgSpq: number | null = prevAvgSpq;

  if (playerAttempted > 0) {
    const matchSpq = elapsedSeconds / playerAttempted;
    newAvgSpq = prevAvgSpq != null
      ? prevAvgSpq * 0.8 + matchSpq * 0.2
      : matchSpq;
    newAvgSpq = Math.min(60, Math.max(2, newAvgSpq));
  }

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

  const prevMarks = (rating as any)?.total_marks ?? 0;
  const prevTime  = (rating as any)?.total_time_hours ?? 0;

  await supabase
    .from("arena_ratings")
    .upsert(
      {
        user_id: user.id,
        [`${match.mode}_elo`]:   newElo,
        [`${match.mode}_games`]: gamesPlayed + 1,
        total_marks:             prevMarks + playerActualMarks,
        total_time_hours:        prevTime + durationHours,
        ...(newAvgSpq != null ? { avg_seconds_per_question: newAvgSpq } : {}),
        updated_at: new Date().toISOString(),
      } as any,
      { onConflict: "user_id", ignoreDuplicates: false }
    );

  return redirect(`/arena/${params.matchId}/result`);
}

// ── Bot progress curve ────────────────────────────────────────
//
// High-ELO bots front-load answers (instant recall).
// Low-ELO bots spread linearly (slow thinkers).

function getBotProgressAt(
  elapsed: number,
  total: number,
  botElo: number,
  botTotalAttempts: number,
): number {
  const eloFraction      = Math.min(1, Math.max(0, (botElo - 100) / 2700));
  const frontLoad        = 1.0 + eloFraction * 2.0;
  const timeFraction     = Math.min(1, elapsed / total);
  const progressFraction = Math.pow(timeFraction, 1 / frontLoad);
  return Math.min(botTotalAttempts, Math.round(progressFraction * botTotalAttempts));
}

// ── Client — Match UI ─────────────────────────────────────────

export default function ArenaMatch({ loaderData }: Route.ComponentProps) {
  const { user, match } = loaderData;
  const submit = useSubmit();

  const totalSeconds     = MODE_SECONDS[match.mode];
  const elapsedSoFar     = Math.floor((Date.now() - new Date(match.started_at).getTime()) / 1000);
  const initialRemaining = Math.max(0, totalSeconds - elapsedSoFar);

  const [timeLeft,    setTimeLeft]    = useState(initialRemaining);
  const [currentIdx,  setCurrentIdx]  = useState(0);
  const [answers,     setAnswers]     = useState<Record<string, string>>({});
  const [submitted,   setSubmitted]   = useState(false);
  const [botAnswered, setBotAnswered] = useState(0);
  // imagesReady: how many images have been preloaded (shown in loading state)
  const [imagesReady, setImagesReady] = useState(0);

  const botTotalAttempts = Object.values(match.bot_answers).filter(v => v !== null).length;
  const answersRef       = useRef(answers);
  answersRef.current     = answers;
  const matchStartRef    = useRef(Date.now());

  // ── Preload ALL question images immediately on mount ──────────
  //
  // We fire off new Image() for every question in one shot. The browser
  // will start fetching all of them in parallel (respecting its own
  // concurrency limit, typically 6–8 per origin). By the time the user
  // reaches question 3 or 4 the rest are already in cache — zero wait.
  //
  // We track how many have loaded so we can show a brief "Loading…" bar
  // before the first question, rather than a blank image flash.
  useEffect(() => {
    let mounted = true;
    const imgs: HTMLImageElement[] = [];
    for (const q of match.questions) {
      const img = new Image();
      img.onload  = () => { if (mounted) setImagesReady(n => n + 1); };
      img.onerror = () => { if (mounted) setImagesReady(n => n + 1); }; // count errors too — don't block forever
      img.src = q.image_url;
      imgs.push(img);
    }
    return () => {
      mounted = false;
      // Let the browser keep the cache but stop JS callbacks
      for (const img of imgs) { img.onload = null; img.onerror = null; }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Persist answers to localStorage ──────────────────────────
  const LS_KEY = `arena_answers_${match.id}`;
  useEffect(() => {
    if (Object.keys(answers).length > 0) {
      try { localStorage.setItem(LS_KEY, JSON.stringify(answers)); } catch {}
    }
  }, [answers, LS_KEY]);

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

  // ── Warn before navigating away ───────────────────────────────
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
    const elapsedSeconds = Math.round((Date.now() - matchStartRef.current) / 1000);
    const form = new FormData();
    form.append("answers",         JSON.stringify(answersRef.current));
    form.append("elapsed_seconds", String(elapsedSeconds));
    submit(form, { method: "post" });
  }, [submitted, submit, match.id]);

  // ── Countdown + bot progress ──────────────────────────────────
  useEffect(() => {
    if (timeLeft <= 0) { doSubmit(); return; }
    const t = setInterval(() => {
      setTimeLeft(prev => {
        const next = prev - 1;
        const elapsed = totalSeconds - next;
        setBotAnswered(getBotProgressAt(elapsed, totalSeconds, match.bot_elo, botTotalAttempts));
        if (next <= 0) { clearInterval(t); doSubmit(); }
        return next;
      });
    }, 1000);
    return () => clearInterval(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const currentQ      = match.questions[currentIdx];
  const totalQ        = match.questions.length;
  const answeredCount = Object.keys(answers).length;

  const elapsedSeconds = totalSeconds - timeLeft;
  const elapsedHours   = elapsedSeconds / 3600;
  const liveMph        = elapsedHours > 0.0005
    ? Math.round((answeredCount * MARKS_CORRECT) / elapsedHours)
    : 0;

  const pct        = timeLeft / totalSeconds;
  const timerColor = pct > 0.5 ? "#3a9e6a" : pct > 0.25 ? "#d4a017" : "#d04040";

  function formatTime(s: number) {
    const m   = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, "0")}`;
  }

  function handleAnswer(letter: string) {
    if (submitted) return;
    setAnswers(prev => ({ ...prev, [currentQ.id]: letter }));
    setCurrentIdx(prev => (prev + 1) % totalQ);
  }

  function handleSkip() {
    if (submitted) return;
    setCurrentIdx(prev => (prev + 1) % totalQ);
  }

  // First-question loading guard — only shown until the first image is cached.
  // After that we never block again (subsequent images load in background).
  const firstImageReady = imagesReady > 0;
  const loadingPct      = Math.round((imagesReady / totalQ) * 100);

  return (
    <div style={{ minHeight: "100vh", background: "var(--c-bg)", display: "flex", flexDirection: "column" }}>

      {/* ── Top bar ── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 20px", borderBottom: "1px solid var(--c-border)", background: "var(--c-surface)", gap: 16, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontWeight: 700, fontSize: 15, color: "var(--c-text)" }}>
            {MODE_LABEL[match.mode] ?? match.mode} · vs {match.bot_name}
          </span>
        </div>

        <div style={{ fontSize: 28, fontWeight: 800, fontVariantNumeric: "tabular-nums", color: timerColor, letterSpacing: -0.5, minWidth: 72, textAlign: "center" }}>
          {formatTime(timeLeft)}
        </div>

        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
          <span style={{ fontSize: 11, color: "var(--c-text-3)", marginBottom: 1 }}>raw marks/hr</span>
          <span style={{ fontSize: 20, fontWeight: 800, color: "var(--c-brand-500)", fontVariantNumeric: "tabular-nums" }}>
            {liveMph.toLocaleString()}
          </span>
        </div>
      </div>

      {/* ── Progress bars ── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", borderBottom: "1px solid var(--c-border)", background: "var(--c-surface)" }}>
        <div style={{ padding: "10px 16px", borderRight: "1px solid var(--c-border)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: "var(--c-text)" }}>{user.display_name}</span>
            <span style={{ fontSize: 12, color: "var(--c-text-3)" }}>{answeredCount}/{totalQ}</span>
          </div>
          <div style={{ height: 5, background: "var(--c-subtle)", borderRadius: 3, overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${(answeredCount / totalQ) * 100}%`, background: "var(--c-brand-500)", borderRadius: 3, transition: "width 0.3s" }} />
          </div>
        </div>
        <div style={{ padding: "10px 16px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: "var(--c-text-2)" }}>
              {match.bot_name} <span style={{ fontWeight: 400, color: "var(--c-text-3)" }}>({match.bot_elo})</span>
            </span>
            <span style={{ fontSize: 12, color: "var(--c-text-3)" }}>{botAnswered}/{totalQ}</span>
          </div>
          <div style={{ height: 5, background: "var(--c-subtle)", borderRadius: 3, overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${(botAnswered / totalQ) * 100}%`, background: "#7a6e62", borderRadius: 3, transition: "width 1s linear" }} />
          </div>
        </div>
      </div>

      {/* ── Question area ── */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", padding: "20px 16px", maxWidth: 720, width: "100%", margin: "0 auto" }}>

        {!firstImageReady ? (
          // ── Pre-load splash — shown only until first image is cached ──
          <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16, color: "var(--c-text-3)" }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>Loading questions… {loadingPct}%</div>
            <div style={{ width: 200, height: 4, background: "var(--c-subtle)", borderRadius: 2, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${loadingPct}%`, background: "var(--c-brand-500)", borderRadius: 2, transition: "width 0.2s" }} />
            </div>
            <div style={{ fontSize: 11, color: "var(--c-text-3)" }}>Caching all {totalQ} images so the match runs instantly</div>
          </div>
        ) : currentQ ? (
          <>
            {/* ── Question counter + Skip ── */}
            <div style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <span style={{ fontSize: 12, color: "var(--c-text-3)", fontWeight: 600 }}>
                Q{currentIdx + 1} <span style={{ fontWeight: 400 }}>of {totalQ}</span>
              </span>
              <button
                onClick={handleSkip}
                disabled={submitted}
                style={{
                  padding: "5px 14px",
                  borderRadius: "var(--r-sm)",
                  border: "1.5px solid var(--c-border)",
                  background: "transparent",
                  color: "var(--c-text-3)",
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: submitted ? "not-allowed" : "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                  transition: "all var(--t)",
                }}
                onMouseEnter={e => {
                  if (!submitted) {
                    (e.currentTarget as HTMLElement).style.borderColor = "var(--c-border-strong)";
                    (e.currentTarget as HTMLElement).style.color = "var(--c-text-2)";
                  }
                }}
                onMouseLeave={e => {
                  if (!submitted) {
                    (e.currentTarget as HTMLElement).style.borderColor = "var(--c-border)";
                    (e.currentTarget as HTMLElement).style.color = "var(--c-text-3)";
                  }
                }}
              >
                Skip
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="9 18 15 12 9 6"/>
                </svg>
              </button>
            </div>

            {/* ── Question image — no loading spinner, already in cache ── */}
            <div style={{ width: "100%", background: "var(--c-surface)", border: "1px solid var(--c-border)", borderRadius: "var(--r-lg)", overflow: "hidden", marginBottom: 16 }}>
              <img
                key={currentQ.id}
                src={currentQ.image_url}
                alt={`Question ${currentIdx + 1}`}
                style={{ width: "100%", display: "block" }}
              />
            </div>

            {/* ── Answer buttons ── */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, width: "100%" }}>
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
                      border: selected ? "2px solid var(--c-brand-500)" : "1.5px solid var(--c-border)",
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
                    <span style={{ width: 28, height: 28, borderRadius: "var(--r-xs)", background: selected ? "var(--c-brand-200)" : "var(--c-subtle)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, flexShrink: 0 }}>
                      {letter}
                    </span>
                    Option {letter}
                  </button>
                );
              })}
            </div>

            {!submitted && (
              <button
                onClick={() => {
                  if (window.confirm("Forfeit this match? Your current answers will be scored.")) {
                    doSubmit();
                  }
                }}
                style={{ marginTop: 20, padding: "8px 20px", background: "transparent", color: "var(--c-text-3)", border: "1px solid var(--c-border)", borderRadius: "var(--r-md)", fontSize: 12, fontWeight: 600, cursor: "pointer" }}
              >
                Forfeit match
              </button>
            )}

            {submitted && (
              <div style={{ marginTop: 20, padding: "12px 24px", background: "var(--c-subtle)", borderRadius: "var(--r-md)", fontSize: 13, color: "var(--c-text-3)", textAlign: "center" }}>
                Scoring your answers…
              </div>
            )}
          </>
        ) : null}
      </div>
    </div>
  );
}
