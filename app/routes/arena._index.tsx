import { data, redirect, Form, Link, useNavigation, useSearchParams, useActionData, useFetcher } from "react-router";
import { useState, useEffect, useRef } from "react";
import type { Route } from "./+types/arena._index";
import { requireUser } from "~/lib/auth.server";
import { createServerClient } from "~/lib/supabase.server";
import { Sidebar } from "~/components/sidebar";
import { IconClock, IconTrophy, IconFlash, IconTarget } from "~/components/icons";

// ── Constants ─────────────────────────────────────────────────

const MODES = [
  {
    id: "bullet",
    label: "Bullet",
    minutes: 1,
    icon: "bullet",
    description: "One minute. No mercy.",
    questions: 15,
    color: "#C0923F",
  },
  {
    id: "blitz",
    label: "Blitz",
    minutes: 3,
    icon: "blitz",
    description: "Three minutes of focused fire.",
    questions: 30,
    color: "#C47B4A",
  },
  {
    id: "rapid",
    label: "Rapid",
    minutes: 10,
    icon: "rapid",
    description: "Ten minutes. Think it through.",
    questions: 60,
    color: "#4E8A4E",
  },
] as const;

type Mode = "bullet" | "blitz" | "rapid";

const MODE_SECONDS: Record<Mode, number> = {
  bullet: 60,
  blitz: 180,
  rapid: 600,
};

// ── Dynamic JEE bot name generator ───────────────────────────

const BOT_PREFIXES = [
  "BLNT", "IIT", "NTA", "AIR1", "Kota", "dropper", "Allen",
  "Resonance", "FIITJEE", "Vibrant", "Narayana", "Aakash",
];
const BOT_MIDDLES = [
  "Or", "Se", "Ka", "Ki", "Mera", "Tera", "Bhai", "Yaar",
];
const BOT_SUFFIXES = [
  "CalcGod", "OrgoLord", "BombayBound", "CrackingIt", "Wallah",
  "Topper", "Dropper", "SleepDeprived", "NeetSwitch", "PhysicsEnjoyer",
  "DefinitelyHuman", "ClearingCutoff", "BoardsWinner", "MockKing",
  "SeeYouInMumbai", "AtomSmasher", "MoleMaster", "CircuitBreaker",
  "HeatDeath", "EntropicSoul", "QuantumTunnel", "ReactionMachine",
];

export function generateBotName(): string {
  const r = (arr: string[]) => arr[Math.floor(Math.random() * arr.length)];
  const style = Math.floor(Math.random() * 3);
  if (style === 0) return `${r(BOT_PREFIXES)}_${r(BOT_SUFFIXES)}`;
  if (style === 1) return r(BOT_SUFFIXES);
  return `${r(BOT_PREFIXES)}${r(BOT_MIDDLES)}`;
}

// ── Bot tiers ─────────────────────────────────────────────────
//
// ELO ↔ JEE Main percentile (by design):
//   100  →  ~0th  pct  (absolute beginner)
//   500  →  95th  pct
//   1000 →  98th  pct
//   1400 →  99th  pct
//   1800 →  99.4th pct
//   2200 →  99.65th pct
//   2800 →  99.9th pct  (rank 1 gods)
//
// accuracy:     probability of getting an attempted question right.
// attemptRatio: fraction of questions attempted given unlimited time.
// secondsPerQ:  realistic think-time — the hard speed cap. Combined
//               with attemptRatio, whichever is lower wins.
//
// The top of the curve is exponential because the score gap between
// 99.4 and 99.65 percentile is as large as the gap from 97 to 99.

export const BOT_TIERS: Array<{
  elo: number;
  accuracy: number;
  attemptRatio: number;
  secondsPerQ: number;
}> = [
  { elo:  100, accuracy: 0.15, attemptRatio: 0.25, secondsPerQ: 40  },
  { elo:  200, accuracy: 0.20, attemptRatio: 0.33, secondsPerQ: 36  },
  { elo:  300, accuracy: 0.27, attemptRatio: 0.42, secondsPerQ: 30  },
  { elo:  400, accuracy: 0.33, attemptRatio: 0.50, secondsPerQ: 25  },
  { elo:  500, accuracy: 0.38, attemptRatio: 0.56, secondsPerQ: 22  },
  { elo:  700, accuracy: 0.46, attemptRatio: 0.63, secondsPerQ: 20  },
  { elo:  900, accuracy: 0.53, attemptRatio: 0.68, secondsPerQ: 18  },
  { elo: 1000, accuracy: 0.58, attemptRatio: 0.72, secondsPerQ: 16  },
  { elo: 1200, accuracy: 0.65, attemptRatio: 0.77, secondsPerQ: 13  },
  { elo: 1400, accuracy: 0.73, attemptRatio: 0.82, secondsPerQ: 11  },
  { elo: 1600, accuracy: 0.81, attemptRatio: 0.87, secondsPerQ: 9   },
  { elo: 1800, accuracy: 0.87, attemptRatio: 0.91, secondsPerQ: 7   },
  { elo: 2000, accuracy: 0.91, attemptRatio: 0.94, secondsPerQ: 6   },
  { elo: 2200, accuracy: 0.94, attemptRatio: 0.96, secondsPerQ: 5   },
  { elo: 2400, accuracy: 0.965,attemptRatio: 0.98, secondsPerQ: 4   },
  { elo: 2600, accuracy: 0.98, attemptRatio: 0.99, secondsPerQ: 3.7 },
  { elo: 2800, accuracy: 0.99, attemptRatio: 1.00, secondsPerQ: 3.5 },
];

export function getBotForElo(playerElo: number) {
  return BOT_TIERS.reduce((best, bot) =>
    Math.abs(bot.elo - playerElo) < Math.abs(best.elo - playerElo) ? bot : best
  );
}

// ── Bot answer generation ─────────────────────────────────────
//
// Attempt count is the minimum of three caps:
//   1. Speed cap:  floor(modeSeconds / effectiveSecondsPerQ)
//   2. Ratio cap:  attemptRatio × pool size (talent ceiling)
//   3. Pool size:  can't answer more questions than exist
//
// Adaptive nudge (Option B):
//   playerAvgSecondsPerQ is stored on arena_ratings after every match.
//   If the player historically answers faster than the bot's baseline,
//   the bot's effective speed is scaled up proportionally — so a fast
//   player faces a slightly faster bot next time. Clamped to 0.75×–1.4×
//   to avoid extremes. Uses past data only, never mid-match peeking.
//
// Variance (Option A):
//   bullet ±0–2 questions, blitz ±0–1, rapid ±0.
//   Prevents the bot count from feeling perfectly scripted each game.

export function generateBotAnswers(
  questions: Array<{ id: string; correct_answer: string }>,
  bot: typeof BOT_TIERS[number],
  mode: Mode,
  playerAvgSecondsPerQ?: number | null,
): Record<string, string | null> {
  const modeSeconds = MODE_SECONDS[mode];
  const options = ["A", "B", "C", "D"];

  // Adaptive nudge: player faster than bot baseline → bot speeds up.
  // nudgeFactor < 1 means player is faster (spq shrinks → more questions).
  let effectiveSpq = bot.secondsPerQ;
  if (playerAvgSecondsPerQ != null && playerAvgSecondsPerQ > 0) {
    const nudgeFactor = Math.min(1.4, Math.max(0.75, playerAvgSecondsPerQ / bot.secondsPerQ));
    effectiveSpq = bot.secondsPerQ * nudgeFactor;
  }

  const speedCap  = Math.floor(modeSeconds / effectiveSpq);
  const ratioCap  = Math.round(questions.length * bot.attemptRatio);
  const baseCap   = Math.min(speedCap, ratioCap, questions.length);

  // Natural variance per mode
  const maxJitter = mode === "bullet" ? 2 : mode === "blitz" ? 1 : 0;
  const jitter    = Math.floor(Math.random() * (maxJitter + 1));
  const attempted = Math.min(baseCap + jitter, questions.length);

  const answers: Record<string, string | null> = {};
  const shuffledIdxs = Array.from({ length: questions.length }, (_, i) => i)
    .sort(() => Math.random() - 0.5)
    .slice(0, attempted);

  for (const idx of shuffledIdxs) {
    const q = questions[idx];
    const correct = typeof q.correct_answer === "string"
      ? q.correct_answer
      : (q.correct_answer as any)?.[0] ?? "A";
    const isRight = Math.random() < bot.accuracy;
    if (isRight) {
      answers[q.id] = correct;
    } else {
      const wrongs = options.filter(o => o !== correct);
      answers[q.id] = wrongs[Math.floor(Math.random() * wrongs.length)];
    }
  }

  return answers;
}

// ── Loader ────────────────────────────────────────────────────

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const user = await requireUser(request, env);
  const supabase = createServerClient(env);

  let rating = null;
  let recent: any[] = [];
  let migrationPending = false;
  try {
    const [ratingRes, recentRes] = await Promise.all([
      supabase.from("arena_ratings").select("*").eq("user_id", user.id).maybeSingle(),
      supabase.from("arena_matches")
        .select("id, mode, bot_name, bot_elo, player_correct, bot_correct, player_elo_before, player_elo_after, started_at, submitted_at")
        .eq("player_id", user.id).not("submitted_at", "is", null)
        .order("started_at", { ascending: false }).limit(8),
    ]);
    if ((ratingRes.error as any)?.code === "42P01" || (recentRes.error as any)?.code === "42P01") {
      migrationPending = true;
    } else {
      rating = ratingRes.data;
      recent = recentRes.data ?? [];
    }
  } catch { migrationPending = true; }

  return data({ user, rating, recent, migrationPending });
}

// ── Action — matchmake or create bot match ────────────────────

export async function action({ request, context }: Route.ActionArgs) {
  const env = context.cloudflare.env;
  const user = await requireUser(request, env);
  const supabase = createServerClient(env);

  const formData = await request.formData();
  const mode = formData.get("mode") as Mode;
  const intent = formData.get("intent") as string | null;

  if (!["bullet", "blitz", "rapid"].includes(mode)) {
    return data({ error: "Invalid mode" }, { status: 400 });
  }

  const questionLimit = 300;

  if (intent === "bot") {
    await supabase.from("matchmaking_queue").delete().eq("user_id", user.id);
    return createBotMatch(supabase, user, mode, questionLimit);
  }

  const { data: rating } = await supabase
    .from("arena_ratings")
    .select("bullet_elo, blitz_elo, rapid_elo")
    .eq("user_id", user.id)
    .maybeSingle();

  const eloKey    = `${mode}_elo` as const;
  const playerElo = (rating as any)?.[eloKey] ?? 1200;

  const { data: candidates } = await (supabase as any)
    .from("matchmaking_queue")
    .select("user_id, elo")
    .eq("mode", mode)
    .neq("user_id", user.id)
    .gte("elo", playerElo - 200)
    .lte("elo", playerElo + 200)
    .order("queued_at", { ascending: true })
    .limit(1);

  if (candidates && candidates.length > 0) {
    const opponent = candidates[0];

    await (supabase as any).from("matchmaking_queue")
      .delete()
      .in("user_id", [user.id, opponent.user_id]);

    const { data: rawQ } = await supabase
      .from("questions")
      .select("id, image_url, correct_answer")
      .eq("subject", "chemistry")
      .eq("type", "scq")
      .eq("is_shared", true)
      .limit(300);

    const questions = (rawQ ?? [])
      .sort(() => Math.random() - 0.5)
      .map((q: any) => ({
        id: q.id,
        image_url: q.image_url,
        correct_answer: Array.isArray(q.correct_answer) ? q.correct_answer[0] : q.correct_answer,
      }));

    if (questions.length < 3) return redirect(`/arena?error=noquestions`);

    const opponentElo = opponent.elo ?? 1200;

    const { data: match, error } = await (supabase as any)
      .from("matches")
      .insert({
        player_one_id: user.id,
        player_two_id: opponent.user_id,
        mode: "arena",
        arena_mode: mode,
        question_count: questions.length,
        time_limit_secs: MODE_SECONDS[mode],
        status: "active",
        questions,
        player_one_elo_before: playerElo,
        player_two_elo_before: opponentElo,
        started_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (error || !match) return data({ error: "Could not create match" }, { status: 500 });

    return redirect(`/arena/pvp/${match.id}`);
  }

  await (supabase as any).from("matchmaking_queue").upsert({
    user_id: user.id,
    mode,
    elo: playerElo,
    queued_at: new Date().toISOString(),
  }, { onConflict: "user_id" });

  return data({ searching: true, mode });
}

// ── Bot match helper ──────────────────────────────────────────

async function createBotMatch(supabase: any, user: any, mode: Mode, questionLimit: number) {
  const { data: rating } = await supabase
    .from("arena_ratings")
    .select("bullet_elo, blitz_elo, rapid_elo, avg_seconds_per_question")
    .eq("user_id", user.id)
    .maybeSingle();

  const eloKey        = `${mode}_elo` as const;
  const playerElo     = (rating as any)?.[eloKey] ?? 1200;
  const playerAvgSpq: number | null = (rating as any)?.avg_seconds_per_question ?? null;

  const bot = getBotForElo(playerElo);

  const { data: rawQ } = await supabase
    .from("questions")
    .select("id, image_url, correct_answer")
    .eq("subject", "chemistry")
    .eq("type", "scq")
    .eq("is_shared", true)
    .limit(300);

  const pool = (rawQ ?? []).sort(() => Math.random() - 0.5);

  if (pool.length < 3) return redirect(`/arena?error=noquestions`);

  const questions = pool.map((q: any) => ({
    id: q.id,
    image_url: q.image_url,
    correct_answer: Array.isArray(q.correct_answer) ? q.correct_answer[0] : q.correct_answer,
  }));

  const botAnswers = generateBotAnswers(questions, bot, mode, playerAvgSpq);

  const botName = generateBotName();
  const { data: match, error } = await supabase
    .from("arena_matches")
    .insert({
      player_id: user.id,
      mode,
      bot_name: botName,
      bot_elo: bot.elo,
      bot_accuracy: bot.accuracy,
      questions,
      bot_answers: botAnswers,
    })
    .select("id")
    .single();

  if (error || !match) return data({ error: "Could not create match" }, { status: 500 });

  return data({ matchReady: true, matchId: match.id, botName, botElo: bot.elo, mode });
}

// ── Component ─────────────────────────────────────────────────

export default function ArenaLobby({ loaderData }: Route.ComponentProps) {
  const { user, rating, recent, migrationPending } = loaderData as any;
  if (migrationPending) return (
    <div className="app-layout">
      <Sidebar displayName={user.display_name} username={(user as any).username} />
      <main className="app-main" style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, padding: 40 }}>
        <h1 style={{ fontFamily: "var(--font-display)", fontSize: 28, fontWeight: 700, color: "var(--c-text)", margin: 0 }}>Arena</h1>
        <p style={{ color: "var(--c-text-2)", fontSize: 14, textAlign: "center", maxWidth: 360 }}>
          The Arena tables aren't set up yet. Run <code style={{ background: "var(--c-surface)", padding: "2px 6px", borderRadius: 4 }}>arena_migration.sql</code> and you're good to go.
        </p>
      </main>
    </div>
  );

  const navigation  = useNavigation();
  const actionData  = useActionData() as any;
  const submitting  = navigation.state === "submitting";
  const [searchParams] = useSearchParams();
  const errorParam     = searchParams.get("error");
  const submittingMode = navigation.formData?.get("mode") as string | null;

  const searching     = actionData?.searching === true;
  const searchingMode = actionData?.mode as Mode | undefined;
  const [countdown, setCountdown] = useState(8);
  const pollFetcher   = useFetcher<any>();
  const botFormRef    = useRef<HTMLFormElement>(null);
  const timerRef      = useRef<ReturnType<typeof setInterval> | null>(null);

  const [vsScreen, setVsScreen] = useState<{
    matchId: string; opponentName: string; opponentElo: number | null; mode: string; isPvp: boolean;
  } | null>(null);

  useEffect(() => {
    if (actionData?.matchReady && actionData?.matchId) {
      setVsScreen({
        matchId: actionData.matchId,
        opponentName: actionData.botName ?? "Opponent",
        opponentElo: actionData.botElo ?? null,
        mode: actionData.mode ?? "blitz",
        isPvp: false,
      });
    }
  }, [actionData]);

  useEffect(() => {
    if (!vsScreen) return;
    const t = setTimeout(() => {
      const url = vsScreen.isPvp
        ? `/arena/pvp/${vsScreen.matchId}`
        : `/arena/${vsScreen.matchId}`;
      window.location.href = url;
    }, 2100);
    return () => clearTimeout(t);
  }, [vsScreen]);

  useEffect(() => {
    if (!searching) { setCountdown(8); return; }

    const pollInterval = setInterval(() => {
      pollFetcher.load("/arena/queue-status");
    }, 1500);

    timerRef.current = setInterval(() => {
      setCountdown(c => {
        if (c <= 1) {
          clearInterval(timerRef.current!);
          clearInterval(pollInterval);
          botFormRef.current?.requestSubmit();
          return 0;
        }
        return c - 1;
      });
    }, 1000);

    return () => { clearInterval(pollInterval); clearInterval(timerRef.current!); };
  }, [searching]); // eslint-disable-line

  useEffect(() => {
    if (pollFetcher.data?.pvpMatchId) {
      setVsScreen({ matchId: pollFetcher.data.pvpMatchId, opponentName: "Opponent", opponentElo: null, mode: searchingMode ?? "blitz", isPvp: true });
    }
  }, [pollFetcher.data]);

  function elo(mode: Mode) {
    const key = `${mode}_elo` as const;
    return rating?.[key] ?? 1200;
  }
  function games(mode: Mode) {
    const key = `${mode}_games` as const;
    return rating?.[key] ?? 0;
  }
  const careerMph =
    rating && rating.total_time_hours > 0
      ? Math.round(rating.total_marks / rating.total_time_hours)
      : null;

  if (vsScreen) {
    const modeColor = MODES.find(m => m.id === vsScreen.mode)?.color ?? "var(--c-brand-500)";
    const playerInitial = (user.display_name?.[0] ?? "?").toUpperCase();
    return (
      <div style={{ position: "fixed", inset: 0, zIndex: 999, background: "var(--c-bg)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 32 }}>
        <style>{`@keyframes countdown-shrink{from{transform:scaleX(1)}to{transform:scaleX(0)}}`}</style>
        <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
          <div style={{ textAlign: "center" }}>
            <div style={{ width: 56, height: 56, borderRadius: 14, background: "var(--c-brand-500)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, fontWeight: 900, color: "#fff", margin: "0 auto 8px" }}>
              {playerInitial}
            </div>
            <div style={{ fontSize: 13, fontWeight: 700, color: "var(--c-text)" }}>{user.display_name ?? "You"}</div>
            <div style={{ fontSize: 11, color: "var(--c-text-3)" }}>{elo(vsScreen.mode as Mode)}</div>
          </div>
          <div style={{ fontSize: 22, fontWeight: 900, color: modeColor, fontFamily: "var(--font-display)", padding: "0 8px" }}>VS</div>
          <div style={{ textAlign: "center" }}>
            <div style={{ width: 56, height: 56, borderRadius: 14, background: "var(--c-surface)", border: "1px solid var(--c-border)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, fontWeight: 900, color: "var(--c-text-3)", margin: "0 auto 8px" }}>
              {vsScreen.opponentName[0].toUpperCase()}
            </div>
            <div style={{ fontSize: 13, fontWeight: 700, color: "var(--c-text)" }}>{vsScreen.opponentName}</div>
            <div style={{ fontSize: 11, color: "var(--c-text-3)" }}>{vsScreen.opponentElo ?? (vsScreen.isPvp ? "Live" : "Bot")}</div>
          </div>
        </div>
        <div style={{ width: 280, height: 2, background: "var(--c-border)", borderRadius: 2, overflow: "hidden" }}>
          <div style={{ height: "100%", background: modeColor, animation: "countdown-shrink 2s linear forwards", transformOrigin: "left center" }} />
        </div>
      </div>
    );
  }

  if (searching) return (
    <div className="app-layout">
      <Sidebar displayName={user.display_name} username={(user as any).username} />
      <main className="app-main" style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 40, position: "relative", overflow: "hidden" }}>
        <style>{`
          @keyframes mascot-searching {
            0%,100% { transform: translateY(0) rotate(-2deg); }
            50%      { transform: translateY(-12px) rotate(2deg); }
          }
          @keyframes ring-pulse {
            0%   { transform: scale(0.85); opacity: 0.8; }
            50%  { transform: scale(1.15); opacity: 0.3; }
            100% { transform: scale(0.85); opacity: 0.8; }
          }
          @keyframes ring-pulse-2 {
            0%   { transform: scale(0.7); opacity: 0.5; }
            50%  { transform: scale(1.3); opacity: 0.1; }
            100% { transform: scale(0.7); opacity: 0.5; }
          }
          @keyframes dot-bounce {
            0%,80%,100% { transform: scale(0); opacity:0; }
            40%          { transform: scale(1); opacity:1; }
          }
          @keyframes fade-up {
            from { opacity:0; transform: translateY(12px); }
            to   { opacity:1; transform: translateY(0); }
          }
          .searching-mode-badge {
            display: inline-flex; align-items: center; gap: 6px;
            padding: 4px 14px; border-radius: 20px;
            font-size: 12px; font-weight: 700; letter-spacing: 0.05em;
            text-transform: uppercase; margin-bottom: 32px;
          }
        `}</style>
        <div className="searching-mode-badge" style={{
          background: `${MODES.find(m => m.id === searchingMode)?.color ?? "var(--c-brand-500)"}22`,
          border: `1px solid ${MODES.find(m => m.id === searchingMode)?.color ?? "var(--c-brand-500)"}55`,
          color: MODES.find(m => m.id === searchingMode)?.color ?? "var(--c-brand-500)",
          animation: "fade-up 0.4s ease both",
        }}>
          {searchingMode?.toUpperCase() ?? "BLITZ"} · {MODES.find(m => m.id === searchingMode)?.minutes ?? 3} min
        </div>
        <div style={{ position: "relative", width: 180, height: 180, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 32 }}>
          <div style={{ position: "absolute", width: 180, height: 180, borderRadius: "50%", border: `2px solid ${MODES.find(m => m.id === searchingMode)?.color ?? "var(--c-brand-500)"}`, animation: "ring-pulse 1.8s ease-in-out infinite" }} />
          <div style={{ position: "absolute", width: 230, height: 230, borderRadius: "50%", border: `1.5px solid ${MODES.find(m => m.id === searchingMode)?.color ?? "var(--c-brand-500)"}`, animation: "ring-pulse-2 1.8s ease-in-out infinite 0.4s" }} />
          <img src="/jeelo-jumping.png" alt="Jeelo searching" style={{ width: 110, height: 110, objectFit: "contain", animation: "mascot-searching 2s ease-in-out infinite", position: "relative", zIndex: 1 }} onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
        </div>
        <div style={{ fontFamily: "var(--font-display)", fontSize: 28, fontWeight: 800, color: "var(--c-text)", marginBottom: 8, animation: "fade-up 0.5s 0.1s ease both", opacity: 0 }}>
          Finding your opponent…
        </div>
        <div style={{ fontSize: 13, color: "var(--c-text-3)", marginBottom: 4, animation: "fade-up 0.5s 0.2s ease both", opacity: 0 }}>
          Scanning the arena for someone near your ELO
        </div>
        <div style={{ display: "flex", gap: 6, margin: "16px 0 32px", animation: "fade-up 0.5s 0.3s ease both", opacity: 0 }}>
          {[0, 1, 2].map(i => (
            <div key={i} style={{ width: 8, height: 8, borderRadius: "50%", background: MODES.find(m => m.id === searchingMode)?.color ?? "var(--c-brand-500)", animation: `dot-bounce 1.4s ${i * 0.16}s ease-in-out infinite` }} />
          ))}
        </div>
        <Form method="post" ref={botFormRef} style={{ display: "none" }}>
          <input type="hidden" name="mode"   value={searchingMode ?? "blitz"} />
          <input type="hidden" name="intent" value="bot" />
        </Form>
      </main>
    </div>
  );

  return (
    <div className="app-layout">
      <Sidebar displayName={user.display_name} username={user.username ?? undefined} />
      <main className="app-main" style={{ overflowY: "auto" }}>
        <div style={{ padding: "28px 36px 0", display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
            <h1 className="pg-title">Arena</h1>
            <span style={{ fontSize: 13, color: "var(--c-text-3)" }}>Chemistry · SCQ</span>
          </div>
          <Link to="/arena/questions" style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "7px 16px", borderRadius: 8, fontSize: 13, fontWeight: 600, background: "var(--c-brand-500)", color: "#fff", border: "none", textDecoration: "none" }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Contribute questions
          </Link>
          {careerMph !== null && (
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--c-text-2)", background: "var(--c-subtle)", borderRadius: "var(--r-md)", padding: "5px 12px" }}>
              <IconTarget size={14} />
              <span>{careerMph.toLocaleString()} marks/hr career</span>
            </div>
          )}
        </div>

        <div style={{ padding: "24px 36px 48px" }}>
          {errorParam === "noquestions" && (
            <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", marginBottom: 24, background: "rgba(208,64,64,0.07)", border: "1px solid rgba(208,64,64,0.2)", borderRadius: "var(--r-md)" }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#b03030", marginBottom: 2 }}>Not enough questions to start a duel.</div>
                <div style={{ fontSize: 12, color: "var(--c-text-3)" }}>Arena needs at least 3 shared Chemistry SCQ questions in the library. Add some questions and try again.</div>
              </div>
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16, marginBottom: 36 }}>
            {MODES.map(m => (
              <Form method="post" key={m.id}>
                <input type="hidden" name="mode" value={m.id} />
                <button
                  type="submit"
                  disabled={submitting}
                  style={{ width: "100%", background: "var(--c-surface)", border: "1.5px solid var(--c-border)", borderRadius: "var(--r-lg)", padding: "24px 22px", cursor: submitting ? "not-allowed" : "pointer", textAlign: "left", transition: "box-shadow var(--t), border-color var(--t), transform 0.12s", opacity: (submitting && submittingMode !== m.id) ? 0.5 : 1 }}
                  onMouseEnter={e => { if (!submitting) { (e.currentTarget as HTMLElement).style.boxShadow = "var(--shadow-md)"; (e.currentTarget as HTMLElement).style.borderColor = "var(--c-border-strong)"; } }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.boxShadow = "none"; (e.currentTarget as HTMLElement).style.borderColor = "var(--c-border)"; }}
                >
                  <div style={{ fontSize: 28, marginBottom: 10 }}>
                    {submitting && submittingMode === m.id
                      ? <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--c-text-3)", animation: "spin 1s linear infinite" }}><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>
                      : m.id === "bullet"
                        ? <svg width="28" height="28" viewBox="0 0 100 100" fill={m.color}><path d="M55 5 C55 5 75 15 75 45 L75 60 L60 75 L60 90 L50 100 L40 90 L40 75 L25 60 L25 45 C25 15 45 5 55 5 Z M55 30 a8 8 0 1 0 0.001 0 Z M20 75 L10 90 L25 85 Z M90 75 L100 90 L75 85 Z"/></svg>
                        : m.id === "blitz"
                          ? <svg width="28" height="28" viewBox="0 0 24 24" fill={m.color}><polygon points="13,2 4,14 12,14 11,22 20,10 12,10"/></svg>
                          : <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={m.color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5"/><path d="M9.5 2.5h5"/><path d="M19 5l1.5-1.5"/></svg>
                    }
                  </div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: "var(--c-text)", marginBottom: 4 }}>
                    {m.label}
                    <span style={{ fontSize: 13, fontWeight: 500, color: "var(--c-text-3)", marginLeft: 8 }}>{m.minutes} min</span>
                  </div>
                  <div style={{ fontSize: 13, color: "var(--c-text-3)", marginBottom: 16 }}>{m.description}</div>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 6, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 26, fontWeight: 800, color: m.color }}>{elo(m.id)}</span>
                    <span style={{ fontSize: 12, color: "var(--c-text-3)" }}>ELO · {games(m.id)} games</span>
                  </div>
                  <div style={{ marginTop: 14, background: m.color, color: "#fff", borderRadius: "var(--r-sm)", padding: "8px 0", fontSize: 13, fontWeight: 700, textAlign: "center", opacity: submitting && submittingMode === m.id ? 0.7 : 1 }}>
                    {submitting && submittingMode === m.id ? "Finding opponent…" : "Find Duel"}
                  </div>
                </button>
              </Form>
            ))}
          </div>

          {recent.length > 0 && (
            <div>
              <h2 style={{ fontSize: 15, fontWeight: 700, color: "var(--c-text)", marginBottom: 12 }}>Recent Duels</h2>
              <div className="list-view">
                {recent.map((m: any) => {
                  const won   = (m.player_correct ?? 0) > (m.bot_correct ?? 0);
                  const draw  = (m.player_correct ?? 0) === (m.bot_correct ?? 0);
                  const eloDelta = m.player_elo_after != null && m.player_elo_before != null ? m.player_elo_after - m.player_elo_before : null;
                  const modeColor = m.mode === "bullet" ? "#C0923F" : m.mode === "blitz" ? "#C47B4A" : "#4E8A4E";
                  const modeIcon = m.mode === "bullet"
                    ? <svg width="14" height="14" viewBox="0 0 100 100" fill={modeColor}><path d="M55 5 C55 5 75 15 75 45 L75 60 L60 75 L60 90 L50 100 L40 90 L40 75 L25 60 L25 45 C25 15 45 5 55 5 Z M55 30 a8 8 0 1 0 0.001 0 Z M20 75 L10 90 L25 85 Z M90 75 L100 90 L75 85 Z"/></svg>
                    : m.mode === "blitz"
                      ? <svg width="14" height="14" viewBox="0 0 24 24" fill={modeColor}><polygon points="13,2 4,14 12,14 11,22 20,10 12,10"/></svg>
                      : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={modeColor} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5"/><path d="M9.5 2.5h5"/><path d="M19 5l1.5-1.5"/></svg>;
                  return (
                    <a key={m.id} href={`/arena/${m.id}/result`} className="list-row" style={{ textDecoration: "none", color: "inherit" }}>
                      <div className="list-row-left">
                        <div className="list-row-icon" style={{ display: "flex", alignItems: "center", color: "var(--c-text-3)" }}>{modeIcon}</div>
                        <div className="list-row-text">
                          <span className="list-row-title">vs {m.bot_name}</span>
                          <span className="list-row-meta">{m.player_correct ?? 0}–{m.bot_correct ?? 0} · {m.mode}</span>
                        </div>
                      </div>
                      <div className="list-row-right">
                        {eloDelta !== null && (
                          <span style={{ fontSize: 13, fontWeight: 700, color: eloDelta >= 0 ? "#3a9e6a" : "#d04040" }}>
                            {eloDelta >= 0 ? "+" : ""}{eloDelta}
                          </span>
                        )}
                        <span className="list-status-badge published" style={{ background: won ? "rgba(58,158,106,0.12)" : draw ? "var(--c-subtle)" : "rgba(208,64,64,0.10)", color: won ? "#2a7a50" : draw ? "var(--c-text-3)" : "#b03030" }}>
                          {won ? "Win" : draw ? "Draw" : "Loss"}
                        </span>
                      </div>
                    </a>
                  );
                })}
              </div>
            </div>
          )}

          {recent.length === 0 && (
            <div style={{ textAlign: "center", padding: "40px 0", color: "var(--c-text-3)" }}>
              <img src="/jeelo-jumping.png" alt="" style={{ width: 80, opacity: 0.7, marginBottom: 12 }} />
              <p style={{ fontSize: 14, margin: 0 }}>No duels yet. Pick a mode and start your first match.</p>
              <p style={{ fontSize: 12, marginTop: 6, color: "var(--c-text-3)" }}>Jeelo is watching. Just saying.</p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
