import { data, redirect, useFetcher, useSubmit } from "react-router";
import { useState, useEffect, useRef, useCallback } from "react";
import type { Route } from "./+types/arena.pvp.$matchId";
import { requireUser } from "~/lib/auth.server";
import { createServerClient } from "~/lib/supabase.server";
import { Sidebar } from "~/components/sidebar";

// ── ELO helpers ───────────────────────────────────────────────

function calcElo(playerElo: number, opponentElo: number, score: number, K = 16) {
  const expected = 1 / (1 + Math.pow(10, (opponentElo - playerElo) / 400));
  return Math.round(K * (score - expected));
}

// ── Loader ────────────────────────────────────────────────────

export async function loader({ params, request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const user = await requireUser(request, env);
  const supabase = createServerClient(env);
  const url = new URL(request.url);
  const isPoll = url.searchParams.get("poll") === "1";

  const { data: match, error } = await supabase
    .from("matches")
    .select(`
      id, arena_mode, question_count, time_limit_secs, status,
      player_one_id, player_two_id, questions,
      player_one_score, player_two_score,
      player_one_elo_before, player_two_elo_before,
      started_at, completed_at
    `)
    .eq("id", params.matchId)
    .single();

  if (error || !match) throw new Response("Match not found", { status: 404 });

  const isPlayerOne = match.player_one_id === user.id;
  const opponentId = isPlayerOne ? match.player_two_id : match.player_one_id;

  if (!isPlayerOne && match.player_two_id !== user.id) {
    throw new Response("Not your match", { status: 403 });
  }

  // If match is complete, go to result
  if (match.status === "completed") {
    return redirect(`/arena/pvp/${params.matchId}/result`);
  }

  // Opponent's answer count (for live scoreboard)
  const { data: opponentAnswers } = await supabase
    .from("match_answers")
    .select("is_correct")
    .eq("match_id", params.matchId)
    .eq("user_id", opponentId ?? "none");

  const opponentCorrect = (opponentAnswers ?? []).filter((a: any) => a.is_correct).length;
  const opponentTotal   = (opponentAnswers ?? []).length;

  // My answer count (to resume if page reloads)
  const { data: myAnswers } = await supabase
    .from("match_answers")
    .select("question_id, is_correct")
    .eq("match_id", params.matchId)
    .eq("user_id", user.id);

  const myAnsweredIds = new Set((myAnswers ?? []).map((a: any) => a.question_id));
  const myCorrect     = (myAnswers ?? []).filter((a: any) => a.is_correct).length;

  if (isPoll) {
    return data({ opponentCorrect, opponentTotal, myCorrect, myAnsweredIds: [...myAnsweredIds] });
  }

  // Fetch opponent display_name
  const { data: opponent } = await supabase
    .from("users")
    .select("display_name, username, elo")
    .eq("id", opponentId ?? "none")
    .maybeSingle();

  return data({
    user,
    match,
    isPlayerOne,
    opponent: opponent ?? { display_name: "Opponent", username: null, elo: 1200 },
    opponentCorrect,
    opponentTotal,
    myCorrect,
    myAnsweredIds: [...myAnsweredIds],
  });
}

// ── Action — submit answers ────────────────────────────────────

export async function action({ params, request, context }: Route.ActionArgs) {
  const env = context.cloudflare.env;
  const user = await requireUser(request, env);
  const supabase = createServerClient(env);

  const formData = await request.formData();
  const answersJson = formData.get("answers") as string;
  const playerAnswers: Record<string, string> = JSON.parse(answersJson || "{}");

  const { data: match } = await supabase
    .from("matches")
    .select("*")
    .eq("id", params.matchId)
    .single();

  if (!match) throw new Response("Not found", { status: 404 });

  const isPlayerOne = match.player_one_id === user.id;
  if (!isPlayerOne && match.player_two_id !== user.id) {
    throw new Response("Not your match", { status: 403 });
  }

  if (match.status === "completed") {
    return redirect(`/arena/pvp/${params.matchId}/result`);
  }

  const questions: Array<{ id: string; correct_answer: string }> = (match as any).questions ?? [];

  // Score answers + upsert into match_answers
  let myCorrect = 0;
  const answerRows = questions.map((q) => {
    const given = playerAnswers[q.id] ?? null;
    const correct = given !== null && given === q.correct_answer;
    if (correct) myCorrect++;
    return {
      match_id: params.matchId,
      user_id: user.id,
      question_id: q.id,
      answer: given ? [given] : [],
      is_correct: correct,
    };
  });

  await supabase.from("match_answers").upsert(answerRows, { onConflict: "match_id,user_id,question_id" });

  // Update my score on the match
  const scoreField = isPlayerOne ? "player_one_score" : "player_two_score";
  await supabase.from("matches").update({ [scoreField]: myCorrect }).eq("id", params.matchId);

  // Check if opponent has also finished (has match_answers for all questions)
  const opponentId = isPlayerOne ? match.player_two_id : match.player_one_id;
  const { data: opponentAnswers } = await supabase
    .from("match_answers")
    .select("is_correct")
    .eq("match_id", params.matchId)
    .eq("user_id", opponentId);

  const opponentDone = (opponentAnswers ?? []).length >= questions.length;

  if (opponentDone) {
    // Both finished — compute result + ELO
    const opponentCorrect = (opponentAnswers ?? []).filter((a: any) => a.is_correct).length;
    const p1Correct = isPlayerOne ? myCorrect : opponentCorrect;
    const p2Correct = isPlayerOne ? opponentCorrect : myCorrect;

    const result =
      p1Correct > p2Correct ? "player_one_win" :
      p2Correct > p1Correct ? "player_two_win" : "draw";

    const p1Elo = match.player_one_elo_before ?? 1200;
    const p2Elo = match.player_two_elo_before ?? 1200;
    const p1Score = result === "player_one_win" ? 1 : result === "draw" ? 0.5 : 0;
    const p2Score = 1 - p1Score;

    const p1Delta = calcElo(p1Elo, p2Elo, p1Score);
    const p2Delta = calcElo(p2Elo, p1Elo, p2Score);

    await supabase.from("matches").update({
      status: "completed",
      result,
      player_one_score: p1Correct,
      player_two_score: p2Correct,
      player_one_elo_delta: p1Delta,
      player_two_elo_delta: p2Delta,
      completed_at: new Date().toISOString(),
    }).eq("id", params.matchId);

    // Update each player's ELO on users table
    await Promise.all([
      supabase.rpc("increment_user_elo", { uid: match.player_one_id, delta: p1Delta }),
      supabase.rpc("increment_user_elo", { uid: match.player_two_id, delta: p2Delta }),
    ]);
  }

  return redirect(`/arena/pvp/${params.matchId}/result`);
}

// ── Component ─────────────────────────────────────────────────

const MODE_SECONDS: Record<string, number> = { bullet: 60, blitz: 180, rapid: 600 };
const MODE_ICON: Record<string, string>    = { bullet: "⚡", blitz: "🔥", rapid: "♟️" };
const CHOICES = ["A", "B", "C", "D"];

export default function PvPMatch({ loaderData }: Route.ComponentProps) {
  const { user, match, isPlayerOne, opponent, myAnsweredIds } = loaderData as any;

  const questions: Array<{ id: string; image_url: string; correct_answer: string }> =
    (match as any).questions ?? [];

  const totalSecs   = MODE_SECONDS[match.arena_mode ?? "blitz"] ?? 180;
  const startedAt   = new Date(match.started_at).getTime();
  const elapsed     = Math.floor((Date.now() - startedAt) / 1000);
  const initRemain  = Math.max(0, totalSecs - elapsed);

  const [remaining, setRemaining] = useState(initRemain);
  const [current, setCurrent]     = useState(() =>
    questions.findIndex(q => !(myAnsweredIds as string[]).includes(q.id))
  );
  const [selected, setSelected]   = useState<string | null>(null);
  const [answers, setAnswers]      = useState<Record<string, string>>({});
  const [myScore, setMyScore]      = useState((loaderData as any).myCorrect ?? 0);

  // Opponent live polling
  const [oppCorrect, setOppCorrect] = useState((loaderData as any).opponentCorrect ?? 0);
  const [oppTotal,   setOppTotal]   = useState((loaderData as any).opponentTotal   ?? 0);
  const pollFetcher = useFetcher<any>();
  const submit = useSubmit();
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollRef  = useRef<ReturnType<typeof setInterval> | null>(null);
  const submitted = useRef(false);

  // Countdown timer
  useEffect(() => {
    if (remaining <= 0) return;
    timerRef.current = setInterval(() => {
      setRemaining(r => {
        if (r <= 1) {
          clearInterval(timerRef.current!);
          if (!submitted.current) autoSubmit();
          return 0;
        }
        return r - 1;
      });
    }, 1000);
    return () => clearInterval(timerRef.current!);
  }, []); // eslint-disable-line

  // Poll opponent progress
  useEffect(() => {
    pollRef.current = setInterval(() => {
      if (submitted.current) return;
      pollFetcher.load(`/arena/pvp/${match.id}?poll=1`);
    }, 2000);
    return () => clearInterval(pollRef.current!);
  }, []); // eslint-disable-line

  useEffect(() => {
    if (pollFetcher.data) {
      setOppCorrect(pollFetcher.data.opponentCorrect ?? 0);
      setOppTotal(pollFetcher.data.opponentTotal ?? 0);
    }
  }, [pollFetcher.data]);

  const myTotal = current < 0 ? questions.length : current;

  const autoSubmit = useCallback(() => {
    if (submitted.current) return;
    submitted.current = true;
    const fd = new FormData();
    fd.set("answers", JSON.stringify(answers));
    submit(fd, { method: "post" });
  }, [answers, submit]);

  function confirmAnswer() {
    if (!selected || current >= questions.length) return;
    const q = questions[current];
    const correct = selected === q.correct_answer;
    const newAnswers = { ...answers, [q.id]: selected };
    setAnswers(newAnswers);
    if (correct) setMyScore(s => s + 1);
    setSelected(null);

    const nextIdx = current + 1;
    if (nextIdx >= questions.length) {
      // Done — submit
      submitted.current = true;
      const fd = new FormData();
      fd.set("answers", JSON.stringify(newAnswers));
      submit(fd, { method: "post" });
    } else {
      setCurrent(nextIdx);
    }
  }

  const mins = Math.floor(remaining / 60);
  const secs = remaining % 60;
  const timeStr = `${mins}:${secs.toString().padStart(2, "0")}`;
  const isUrgent = remaining <= 10;
  const progress = questions.length > 0 ? (current / questions.length) * 100 : 0;
  const q = questions[current] ?? null;

  return (
    <div className="app-layout">
      <Sidebar displayName={user.display_name} username={(user as any).username} />

      <main className="app-main" style={{ maxWidth: 640, margin: "0 auto", padding: "24px 20px" }}>

        {/* Scoreboard */}
        <div style={{
          display: "grid", gridTemplateColumns: "1fr auto 1fr", alignItems: "center",
          gap: 12, marginBottom: 20,
          background: "var(--c-surface)", border: "1px solid var(--c-border)",
          borderRadius: 14, padding: "14px 20px",
        }}>
          {/* Me */}
          <div style={{ textAlign: "left" }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "var(--c-text)", marginBottom: 2 }}>
              {user.display_name} <span style={{ fontSize: 10, color: "var(--c-text-3)", fontWeight: 400 }}>(you)</span>
            </div>
            <div style={{ fontSize: 22, fontWeight: 800, color: "var(--c-brand-500)", fontFamily: "var(--font-numbers)" }}>
              {myScore}
            </div>
            <div style={{ fontSize: 10, color: "var(--c-text-3)" }}>{myTotal} answered</div>
          </div>

          {/* Timer */}
          <div style={{ textAlign: "center" }}>
            <div style={{
              fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em",
              color: "var(--c-text-3)", marginBottom: 2,
            }}>
              {MODE_ICON[match.arena_mode ?? "blitz"]} {match.arena_mode}
            </div>
            <div style={{
              fontSize: 20, fontWeight: 800, fontFamily: "var(--font-numbers)",
              color: isUrgent ? "var(--c-error)" : "var(--c-text)",
              transition: "color 0.3s",
            }}>
              {timeStr}
            </div>
          </div>

          {/* Opponent */}
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "var(--c-text)", marginBottom: 2 }}>
              {opponent.display_name}
            </div>
            <div style={{ fontSize: 22, fontWeight: 800, color: "var(--c-text-2)", fontFamily: "var(--font-numbers)" }}>
              {oppCorrect}
            </div>
            <div style={{ fontSize: 10, color: "var(--c-text-3)" }}>{oppTotal} answered</div>
          </div>
        </div>

        {/* Progress bar */}
        <div style={{ height: 3, background: "var(--c-border)", borderRadius: 2, overflow: "hidden", marginBottom: 20 }}>
          <div style={{
            height: "100%", width: `${progress}%`,
            background: "var(--c-brand-500)", borderRadius: 2, transition: "width 0.3s",
          }} />
        </div>

        {/* Question */}
        {q ? (
          <div style={{
            background: "var(--c-surface)", border: "1px solid var(--c-border)",
            borderRadius: 14, overflow: "hidden",
          }}>
            {/* Question image */}
            {q.image_url && (
              <div style={{ background: "var(--c-bg)", padding: 16, borderBottom: "1px solid var(--c-border)" }}>
                <img src={q.image_url} alt="Question"
                  style={{ maxWidth: "100%", maxHeight: 360, objectFit: "contain", display: "block", margin: "0 auto" }} />
              </div>
            )}

            {/* Choices */}
            <div style={{ padding: 16, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              {CHOICES.map(choice => (
                <button key={choice} type="button" onClick={() => setSelected(choice)} style={{
                  padding: "10px 14px", borderRadius: 10, fontSize: 13, fontWeight: 600,
                  textAlign: "left", cursor: "pointer", transition: "all 0.12s",
                  background: selected === choice ? "var(--c-brand-500)" : "var(--c-bg)",
                  color: selected === choice ? "#fff" : "var(--c-text)",
                  border: `1.5px solid ${selected === choice ? "var(--c-brand-500)" : "var(--c-border)"}`,
                }}>
                  <span style={{ fontFamily: "var(--font-numbers)", marginRight: 8 }}>{choice}</span>
                </button>
              ))}
            </div>

            {/* Confirm */}
            <div style={{ padding: "0 16px 16px" }}>
              <button type="button" onClick={confirmAnswer} disabled={!selected} style={{
                width: "100%", padding: "10px 0", borderRadius: 10, fontSize: 14, fontWeight: 700,
                background: selected ? "var(--c-brand-500)" : "var(--c-border)",
                color: selected ? "#fff" : "var(--c-text-3)",
                border: "none", cursor: selected ? "pointer" : "default",
                transition: "background 0.15s",
              }}>
                Confirm →
              </button>
            </div>
          </div>
        ) : (
          <div style={{ textAlign: "center", padding: "40px 20px", color: "var(--c-text-2)", fontSize: 15 }}>
            Waiting for your opponent to finish…
          </div>
        )}

        {/* Question counter */}
        <div style={{ textAlign: "right", marginTop: 10, fontSize: 11, color: "var(--c-text-3)" }}>
          {Math.min(current + 1, questions.length)} / {questions.length}
        </div>
      </main>
    </div>
  );
}
