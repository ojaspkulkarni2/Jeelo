import { data, useFetcher } from "react-router";
import { Link } from "react-router";
import { useState, useEffect } from "react";
import type { Route } from "./+types/arena.$matchId.result";
import { requireUser } from "~/lib/auth.server";
import { createServerClient } from "~/lib/supabase.server";
import { Sidebar } from "~/components/sidebar";

const MODE_LABEL: Record<string, string> = {
  bullet: "Bullet", blitz: "Blitz", rapid: "Rapid",
};
const MODE_SECONDS: Record<string, number> = {
  bullet: 60, blitz: 180, rapid: 600,
};
const MARKS_CORRECT = 4;
const MARKS_WRONG   = 1;

// ── SVG Icons (no emojis) ─────────────────────────────────────

function IconTrophy({ size = 20, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/>
      <path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/>
      <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/>
      <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>
    </svg>
  );
}
function IconHandshake({ size = 20, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m11 17 2 2a1 1 0 1 0 3-3"/><path d="m14 14 2.5 2.5a1 1 0 1 0 3-3l-3.88-3.88a3 3 0 0 0-4.24 0l-.88.88a1 1 0 1 1-3-3l2.81-2.81a5.79 5.79 0 0 1 7.06-.87l.47.28a2 2 0 0 0 1.42.25L21 4"/>
      <path d="m21 3 1 11h-2"/><path d="M3 3 2 14l6.5 6.5a1 1 0 1 0 3-3"/>
      <path d="M3 4h8"/>
    </svg>
  );
}
function IconTrendDown({ size = 20, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="22 17 13.5 8.5 8.5 13.5 2 7"/><polyline points="16 17 22 17 22 11"/>
    </svg>
  );
}
function IconThumbUp({ size = 16, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 10v12"/><path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z"/>
    </svg>
  );
}
function IconChat({ size = 15, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
    </svg>
  );
}
function IconChevronLeft({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="15 18 9 12 15 6"/>
    </svg>
  );
}
function IconChevronRight({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 18 15 12 9 6"/>
    </svg>
  );
}
function IconCheck({ size = 13, color = "#fff" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12"/>
    </svg>
  );
}
function IconX({ size = 13, color = "#fff" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
    </svg>
  );
}
function IconArrowLeft({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>
    </svg>
  );
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

  const { data: rating } = await supabase
    .from("arena_ratings")
    .select("total_marks, total_time_hours, bullet_games, blitz_games, rapid_games")
    .eq("user_id", user.id)
    .maybeSingle();

  const modeGamesKey = `${match.mode}_games` as keyof typeof rating;
  const gamesPlayed = (rating as any)?.[modeGamesKey] ?? 0;
  const careerMph =
    rating && (rating as any).total_time_hours > 0
      ? Math.round((rating as any).total_marks / (rating as any).total_time_hours)
      : null;

  const questionIds = ((match.questions as any[]) ?? []).map((q: any) => q.id);

  // Solids + community feed_answers for option distribution
  const [solidsRes, userSolidsRes, allAnswersRes] = await Promise.all([
    supabase.from("solids").select("question_id").in("question_id", questionIds.length ? questionIds : ["__none__"]),
    supabase.from("solids").select("question_id").eq("user_id", user.id).in("question_id", questionIds.length ? questionIds : ["__none__"]),
    supabase.from("feed_answers").select("question_id, answer, is_correct").in("question_id", questionIds.length ? questionIds : ["__none__"]),
  ]);

  const solidCounts: Record<string, number> = {};
  for (const s of solidsRes.data ?? []) {
    solidCounts[s.question_id] = (solidCounts[s.question_id] ?? 0) + 1;
  }
  const mySolids = new Set((userSolidsRes.data ?? []).map((s: any) => s.question_id));

  // Per-option distribution from community feed answers
  const optionMap: Record<string, Record<string, number>> = {};
  const pctMap: Record<string, { correct: number; total: number }> = {};
  for (const a of allAnswersRes.data ?? []) {
    const qid = a.question_id;
    const cur = pctMap[qid] ?? { correct: 0, total: 0 };
    pctMap[qid] = { correct: cur.correct + (a.is_correct ? 1 : 0), total: cur.total + 1 };
    let raw = a.answer;
    if (typeof raw === "string") { try { raw = JSON.parse(raw); } catch {} }
    const letter = Array.isArray(raw) ? raw[0] : raw;
    if (letter && ["A","B","C","D"].includes(String(letter).toUpperCase())) {
      const l = String(letter).toUpperCase();
      optionMap[qid] = optionMap[qid] ?? { A: 0, B: 0, C: 0, D: 0 };
      optionMap[qid][l] = (optionMap[qid][l] ?? 0) + 1;
    }
  }

  return data({
    user, match, careerMph, gamesPlayed,
    solidCounts, mySolids: [...mySolids],
    optionMap, pctMap,
  });
}

// ── Action ────────────────────────────────────────────────────

export async function action({ request, context }: Route.ActionArgs) {
  const env = context.cloudflare.env;
  const user = await requireUser(request, env);
  const supabase = createServerClient(env);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "solid") {
    const questionId = String(formData.get("question_id"));
    const { data: existing } = await supabase.from("solids").select("user_id")
      .eq("user_id", user.id).eq("question_id", questionId).maybeSingle();
    if (existing) {
      await supabase.from("solids").delete().eq("user_id", user.id).eq("question_id", questionId);
      return data({ ok: true, toggled: false });
    } else {
      await supabase.from("solids").insert({ user_id: user.id, question_id: questionId });
      return data({ ok: true, toggled: true });
    }
  }

  if (intent === "get_comments") {
    const questionId = String(formData.get("question_id"));
    const { data: comments } = await supabase
      .from("comments")
      .select("id, body, created_at, author_id, users!author_id(display_name, username)")
      .eq("question_id", questionId).is("parent_id", null)
      .order("created_at", { ascending: true }).limit(30);
    return data({ comments: comments ?? [] });
  }

  if (intent === "post_comment") {
    const questionId = String(formData.get("question_id"));
    const body = String(formData.get("body")).trim();
    if (body.length > 0 && body.length <= 1000) {
      await supabase.from("comments").insert({ author_id: user.id, question_id: questionId, body });
    }
    const { data: comments } = await supabase
      .from("comments")
      .select("id, body, created_at, author_id, users!author_id(display_name, username)")
      .eq("question_id", questionId).is("parent_id", null)
      .order("created_at", { ascending: true }).limit(30);
    return data({ comments: comments ?? [] });
  }

  return data({ ok: false });
}

// ── Comment Section ───────────────────────────────────────────

interface CommentEntry {
  id: string; body: string; created_at: string; author_id: string;
  users: { display_name: string; username: string | null } | null;
}

function CommentSection({ questionId }: { questionId: string }) {
  const fetcher = useFetcher();
  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState("");
  const [comments, setComments] = useState<CommentEntry[]>([]);
  const [loaded, setLoaded] = useState(false);

  function load() {
    if (loaded) return;
    const fd = new FormData();
    fd.set("intent", "get_comments");
    fd.set("question_id", questionId);
    fetcher.submit(fd, { method: "post" });
    setLoaded(true);
  }

  const fData = fetcher.data as any;
  if (fData?.comments && fData.comments !== comments) setComments(fData.comments);

  function postComment() {
    const body = draft.trim();
    if (!body) return;
    setDraft("");
    const fd = new FormData();
    fd.set("intent", "post_comment");
    fd.set("question_id", questionId);
    fd.set("body", body);
    fetcher.submit(fd, { method: "post" });
    setLoaded(true);
  }

  if (!expanded) {
    return (
      <button type="button" onClick={() => { setExpanded(true); load(); }} style={{
        background: "none", border: "1px solid var(--c-border)", cursor: "pointer",
        fontSize: 12, color: "var(--c-text-3)", padding: "6px 14px", borderRadius: 20,
        display: "inline-flex", alignItems: "center", gap: 6,
        transition: "border-color 0.15s",
      }}>
        <IconChat size={13} color="var(--c-text-3)" />
        Discuss
      </button>
    );
  }

  return (
    <div style={{ marginTop: 16, borderTop: "1px solid var(--c-border)", paddingTop: 16 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: "var(--c-text-3)", marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.07em" }}>
        Discussion
      </div>
      {fetcher.state !== "idle" && comments.length === 0 ? (
        <div style={{ fontSize: 13, color: "var(--c-text-3)", marginBottom: 10 }}>Loading…</div>
      ) : comments.length === 0 ? (
        <div style={{ fontSize: 13, color: "var(--c-text-3)", marginBottom: 12 }}>No comments yet. Be the first.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 14 }}>
          {comments.map((c) => (
            <div key={c.id} style={{
              padding: "10px 12px", borderRadius: 10,
              background: "var(--c-subtle)", fontSize: 13, lineHeight: 1.55,
            }}>
              <span style={{ fontWeight: 700, fontSize: 11, color: "var(--c-text-2)", marginRight: 8 }}>
                {c.users?.display_name ?? "User"}
              </span>
              <span style={{ color: "var(--c-text)" }}>{c.body}</span>
            </div>
          ))}
        </div>
      )}
      <div style={{ display: "flex", gap: 8 }}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); postComment(); } }}
          placeholder="Add a comment…"
          style={{
            flex: 1, padding: "8px 12px", borderRadius: 10, fontSize: 13,
            border: "1px solid var(--c-border)", background: "var(--c-bg)",
            color: "var(--c-text)", outline: "none",
          }}
        />
        <button type="button" onClick={postComment} disabled={!draft.trim()} style={{
          padding: "8px 16px", borderRadius: 10, fontSize: 13, fontWeight: 600,
          background: draft.trim() ? "var(--c-brand-500)" : "var(--c-border)",
          color: draft.trim() ? "#fff" : "var(--c-text-3)",
          border: "none", cursor: draft.trim() ? "pointer" : "not-allowed",
          transition: "background 0.15s",
        }}>
          Post
        </button>
      </div>
    </div>
  );
}

// ── Solid Button ──────────────────────────────────────────────

function SolidButton({ questionId, initialCount, initialSolid }: {
  questionId: string; initialCount: number; initialSolid: boolean;
}) {
  const fetcher = useFetcher();
  const [solidised, setSolidised] = useState(initialSolid);
  const [count, setCount] = useState(initialCount);

  function handleSolid() {
    setSolidised((s) => !s);
    setCount((n) => solidised ? n - 1 : n + 1);
    const fd = new FormData();
    fd.set("intent", "solid");
    fd.set("question_id", questionId);
    fetcher.submit(fd, { method: "post" });
  }

  return (
    <button type="button" onClick={handleSolid} style={{
      padding: "7px 16px", borderRadius: 20, fontSize: 12, fontWeight: 600,
      background: solidised ? "var(--c-brand-50)" : "transparent",
      color: solidised ? "var(--c-brand-600)" : "var(--c-text-2)",
      border: `1px solid ${solidised ? "var(--c-brand-300, #e89e6a)" : "var(--c-border)"}`,
      cursor: "pointer", transition: "all 0.15s",
      display: "inline-flex", alignItems: "center", gap: 6,
    }}>
      <IconThumbUp size={14} color={solidised ? "var(--c-brand-600)" : "var(--c-text-3)"} />
      Solid {count > 0 && <span style={{ opacity: 0.7 }}>· {count}</span>}
    </button>
  );
}

// ── Option Distribution ───────────────────────────────────────

function OptionBars({
  correct, playerAns, botAns, optionCounts,
}: {
  correct: string;
  playerAns: string | undefined;
  botAns: string | null | undefined;
  optionCounts: Record<string, number> | undefined;
}) {
  const counts = optionCounts ?? { A: 0, B: 0, C: 0, D: 0 };
  const total = Object.values(counts).reduce((s, n) => s + n, 0) || 1;
  const correctLetter = (Array.isArray(correct) ? correct[0] : correct ?? "").toUpperCase();
  const playerLetter  = (playerAns ?? "").toUpperCase();
  const botLetter     = (Array.isArray(botAns) ? (botAns as any)[0] : botAns ?? "").toUpperCase();

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 20 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: "var(--c-text-3)", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 4 }}>
        Community answers
      </div>
      {(["A", "B", "C", "D"] as const).map(letter => {
        const count = counts[letter] ?? 0;
        const pct = Math.round((count / total) * 100);
        const isCorrect = letter === correctLetter;
        const isMyPick  = letter === playerLetter;
        const isBotPick = letter === botLetter;
        const barColor  = isCorrect ? "#3a9e6a" : isMyPick ? "#d04040" : "var(--c-border-strong)";

        return (
          <div key={letter} style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {/* Letter circle */}
            <div style={{
              width: 26, height: 26, borderRadius: "50%", flexShrink: 0,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 11, fontWeight: 700,
              background: isCorrect ? "#3a9e6a" : isMyPick ? "#d04040" : "var(--c-subtle)",
              color: (isCorrect || isMyPick) ? "#fff" : "var(--c-text-3)",
              boxShadow: (isCorrect || isMyPick) ? "0 0 0 3px " + (isCorrect ? "rgba(58,158,106,0.2)" : "rgba(208,64,64,0.2)") : "none",
            }}>
              {isCorrect ? <IconCheck size={12} color="#fff" /> : isMyPick ? <IconX size={12} color="#fff" /> : letter}
            </div>

            {/* Bar */}
            <div style={{ flex: 1, height: 7, background: "var(--c-border)", borderRadius: 4, overflow: "hidden" }}>
              <div style={{
                height: "100%", borderRadius: 4,
                background: barColor,
                width: `${pct}%`,
                transition: "width 0.5s cubic-bezier(0.4,0,0.2,1)",
              }} />
            </div>

            {/* Pct + indicators */}
            <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 60, justifyContent: "flex-end" }}>
              <span style={{ fontSize: 12, color: "var(--c-text-3)", fontVariantNumeric: "tabular-nums" }}>
                {pct}%
              </span>
              {isBotPick && (
                <span style={{ fontSize: 9, fontWeight: 700, color: "var(--c-text-3)", background: "var(--c-subtle)", borderRadius: 3, padding: "1px 4px", border: "1px solid var(--c-border)" }}>
                  BOT
                </span>
              )}
            </div>
          </div>
        );
      })}
      {total <= 1 && (
        <p style={{ fontSize: 12, color: "var(--c-text-3)", fontStyle: "italic", margin: "4px 0 0" }}>
          No community data yet for this question.
        </p>
      )}
    </div>
  );
}

// ── Overview Screen ───────────────────────────────────────────

function OverviewScreen({ match, careerMph, gamesPlayed, playerCorrect, botCorrect,
  playerAttempted, playerWrong, questions, actualMph, rawMph, eloDelta,
  onReview }: {
  match: any; careerMph: number | null; gamesPlayed: number;
  playerCorrect: number; botCorrect: number; playerAttempted: number;
  playerWrong: number; questions: any[]; actualMph: number; rawMph: number;
  eloDelta: number; onReview: () => void;
}) {
  const won  = playerCorrect > botCorrect;
  const draw = playerCorrect === botCorrect;
  const provisional = gamesPlayed < 10;
  const skipped = questions.length - playerAttempted;

  const resultColor = won ? "#2d7a4f" : draw ? "var(--c-text-2)" : "#c03030";
  const resultBg    = won ? "rgba(58,158,106,0.08)" : draw ? "var(--c-subtle)" : "rgba(208,64,64,0.06)";
  const resultBorder= won ? "rgba(58,158,106,0.25)" : draw ? "var(--c-border)" : "rgba(208,64,64,0.2)";

  const wrongCount = playerAttempted - playerCorrect;

  return (
    <div style={{ maxWidth: 520, margin: "0 auto", padding: "56px 24px 48px" }}>

      {/* Result icon + label */}
      <div style={{
        display: "inline-flex", alignItems: "center", gap: 10,
        padding: "10px 18px", borderRadius: 12, marginBottom: 36,
        background: resultBg, border: `1px solid ${resultBorder}`,
      }}>
        {won ? <IconTrophy size={19} color="#2d7a4f" />
              : draw ? <IconHandshake size={19} color="var(--c-text-2)" />
              : <IconTrendDown size={19} color="#c03030" />}
        <span style={{ fontSize: 14, fontWeight: 700, color: resultColor }}>
          {won ? "Win" : draw ? "Draw" : "Loss"} — {match.bot_name} ({match.bot_elo})
          {provisional && <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 500, opacity: 0.7 }}>provisional</span>}
        </span>
      </div>

      {/* Headline metric */}
      <div style={{ marginBottom: 6 }}>
        <span style={{
          fontFamily: "var(--font-display)", fontSize: 72, fontWeight: 900,
          color: "var(--c-text)", letterSpacing: "-0.04em", lineHeight: 1,
        }}>
          {actualMph.toLocaleString()}
        </span>
        <span style={{ fontSize: 18, color: "var(--c-text-3)", fontWeight: 400, marginLeft: 12 }}>
          marks / hr
        </span>
      </div>
      <div style={{ fontSize: 13, color: "var(--c-text-3)", marginBottom: 40 }}>
        ELO {eloDelta >= 0 ? "+" : ""}{eloDelta} → {match.player_elo_after ?? "—"}
        {careerMph && <span style={{ marginLeft: 14, color: "var(--c-text-3)" }}>Career avg {careerMph.toLocaleString()}</span>}
      </div>

      {/* Score grid */}
      <div style={{
        display: "grid", gridTemplateColumns: "repeat(3, 1fr)",
        gap: 1, background: "var(--c-border)", borderRadius: 14, overflow: "hidden",
        marginBottom: 32,
      }}>
        {[
          { label: "Correct",  value: playerCorrect, color: "#2d7a4f" },
          { label: "Wrong",    value: wrongCount,    color: wrongCount > 0 ? "#c03030" : "var(--c-text-3)" },
          { label: "Skipped",  value: skipped,       color: "var(--c-text-3)" },
        ].map(({ label, value, color }) => (
          <div key={label} style={{
            background: "var(--c-surface)", padding: "20px 16px", textAlign: "center",
          }}>
            <div style={{ fontSize: 32, fontWeight: 800, color, letterSpacing: "-0.02em", lineHeight: 1 }}>
              {value}
            </div>
            <div style={{ fontSize: 11, color: "var(--c-text-3)", marginTop: 4, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>
              {label}
            </div>
          </div>
        ))}
      </div>

      {/* Score score comparison */}
      <div style={{
        padding: "16px 20px", borderRadius: 12, background: "var(--c-subtle)",
        border: "1px solid var(--c-border)", marginBottom: 36,
        display: "flex", alignItems: "center", justifyContent: "space-between",
      }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 22, fontWeight: 800, color: won ? "#2d7a4f" : "var(--c-text)" }}>{playerCorrect}</div>
          <div style={{ fontSize: 11, color: "var(--c-text-3)", marginTop: 2, textTransform: "uppercase", letterSpacing: "0.05em" }}>You</div>
        </div>
        <div style={{ fontSize: 13, color: "var(--c-text-3)", fontWeight: 600 }}>vs</div>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 22, fontWeight: 800, color: !won && !draw ? "#c03030" : "var(--c-text)" }}>{botCorrect}</div>
          <div style={{ fontSize: 11, color: "var(--c-text-3)", marginTop: 2, textTransform: "uppercase", letterSpacing: "0.05em" }}>{match.bot_name}</div>
        </div>
      </div>

      {/* Quip */}
      <p style={{ fontSize: 13, color: "var(--c-text-3)", fontStyle: "italic", marginBottom: 36, lineHeight: 1.6 }}>
        {won && eloDelta > 20
          ? `You beat ${match.bot_name} convincingly. ${match.bot_name} has feelings about this.`
          : won
            ? `${match.bot_name} would like a rematch.`
            : draw
              ? `A draw. Against a bot. Jeelo notes this quietly.`
              : playerCorrect === 0
                ? `Zero correct. ${match.bot_name} is rated ${match.bot_elo}.`
                : rawMph > actualMph * 1.4
                  ? `Raw pace was strong but penalties hurt. Precision over speed.`
                  : `${match.bot_name} edges it. Review the mistakes below.`}
      </p>

      {/* Actions */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        {wrongCount + skipped > 0 && (
          <button type="button" onClick={onReview} style={{
            padding: "12px 24px", borderRadius: 10, fontSize: 14, fontWeight: 700,
            background: "var(--c-brand-500)", color: "#fff", border: "none", cursor: "pointer",
          }}>
            Review questions →
          </button>
        )}
        <Link to="/arena" style={{
          padding: "12px 24px", borderRadius: 10, fontSize: 14, fontWeight: 600,
          background: "transparent", color: "var(--c-text-2)", textDecoration: "none",
          border: "1px solid var(--c-border)", display: "inline-flex", alignItems: "center",
        }}>
          Play again
        </Link>
        <Link to="/map" style={{
          padding: "12px 24px", borderRadius: 10, fontSize: 14, fontWeight: 600,
          background: "transparent", color: "var(--c-text-2)", textDecoration: "none",
          border: "1px solid var(--c-border)", display: "inline-flex", alignItems: "center",
        }}>
          Map
        </Link>
      </div>
    </div>
  );
}

// ── Review Screen ─────────────────────────────────────────────

type QResult = {
  id: string; image_url: string; correct: string;
  playerAns: string | undefined; botAns: string | null | undefined;
  playerRight: boolean; botRight: boolean;
};

function ReviewScreen({
  qResults, solidCounts, mySolids, optionMap, onBack,
}: {
  qResults: QResult[];
  solidCounts: Record<string, number>;
  mySolids: Set<string>;
  optionMap: Record<string, Record<string, number>>;
  onBack: () => void;
}) {
  const [filter, setFilter] = useState<"all" | "wrong" | "skipped">("wrong");
  const [idx, setIdx] = useState(0);

  const filtered = qResults.filter(q => {
    if (filter === "wrong")   return q.playerAns && !q.playerRight;
    if (filter === "skipped") return !q.playerAns;
    return true;
  });

  // Reset idx when filter changes
  useEffect(() => { setIdx(0); }, [filter]);

  const q = filtered[idx] ?? null;

  const wrongCount   = qResults.filter(q => q.playerAns && !q.playerRight).length;
  const skippedCount = qResults.filter(q => !q.playerAns).length;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>

      {/* ── Top bar ── */}
      <div style={{
        padding: "14px 24px", borderBottom: "1px solid var(--c-border)",
        display: "flex", alignItems: "center", gap: 16, flexShrink: 0,
        background: "var(--c-surface)",
      }}>
        <button type="button" onClick={onBack} style={{
          background: "none", border: "none", cursor: "pointer",
          color: "var(--c-text-3)", display: "flex", alignItems: "center", gap: 4,
          fontSize: 13, fontWeight: 600, padding: "4px 8px", borderRadius: 6,
        }}>
          <IconArrowLeft size={15} /> Overview
        </button>

        <div style={{ flex: 1 }} />

        {/* Filter pills */}
        <div style={{ display: "flex", gap: 4 }}>
          {([
            { key: "wrong",   label: `Wrong (${wrongCount})` },
            { key: "skipped", label: `Skipped (${skippedCount})` },
            { key: "all",     label: `All (${qResults.length})` },
          ] as const).map(({ key, label }) => (
            <button key={key} type="button" onClick={() => setFilter(key)} style={{
              padding: "5px 12px", borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: "pointer",
              background: filter === key ? "var(--c-brand-500)" : "transparent",
              color: filter === key ? "#fff" : "var(--c-text-3)",
              border: `1px solid ${filter === key ? "var(--c-brand-500)" : "var(--c-border)"}`,
              transition: "all 0.15s",
            }}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Question area ── */}
      {filtered.length === 0 ? (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 40 }}>
          <p style={{ fontSize: 15, color: "var(--c-text-3)", textAlign: "center" }}>
            No questions in this category.
          </p>
        </div>
      ) : (
        <div style={{ flex: 1, overflowY: "auto" }}>
          <div style={{ maxWidth: 680, margin: "0 auto", padding: "32px 24px 48px" }}>

            {/* Nav row */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
              <button
                type="button" onClick={() => setIdx(i => Math.max(0, i - 1))}
                disabled={idx === 0}
                style={{
                  width: 36, height: 36, borderRadius: 8, border: "1px solid var(--c-border)",
                  background: idx === 0 ? "transparent" : "var(--c-surface)",
                  color: idx === 0 ? "var(--c-border)" : "var(--c-text-2)",
                  display: "flex", alignItems: "center", justifyContent: "center", cursor: idx === 0 ? "not-allowed" : "pointer",
                }}
              >
                <IconChevronLeft size={18} />
              </button>

              {/* Dot nav */}
              <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
                {filtered.map((_, i) => (
                  <button
                    key={i} type="button" onClick={() => setIdx(i)}
                    style={{
                      width: i === idx ? 20 : 7, height: 7, borderRadius: 4, border: "none", cursor: "pointer", padding: 0,
                      background: i === idx ? "var(--c-brand-500)" : "var(--c-border)",
                      transition: "width 0.2s, background 0.2s",
                    }}
                  />
                ))}
              </div>

              <button
                type="button" onClick={() => setIdx(i => Math.min(filtered.length - 1, i + 1))}
                disabled={idx === filtered.length - 1}
                style={{
                  width: 36, height: 36, borderRadius: 8, border: "1px solid var(--c-border)",
                  background: idx === filtered.length - 1 ? "transparent" : "var(--c-surface)",
                  color: idx === filtered.length - 1 ? "var(--c-border)" : "var(--c-text-2)",
                  display: "flex", alignItems: "center", justifyContent: "center", cursor: idx === filtered.length - 1 ? "not-allowed" : "pointer",
                }}
              >
                <IconChevronRight size={18} />
              </button>
            </div>

            {/* Counter label */}
            <div style={{ fontSize: 12, color: "var(--c-text-3)", marginBottom: 16, textAlign: "center", fontWeight: 600 }}>
              Question {idx + 1} of {filtered.length}
            </div>

            {q && (
              <div style={{
                background: "var(--c-surface)", borderRadius: 20,
                border: "1px solid var(--c-border)", overflow: "hidden",
              }}>
                {/* Question image */}
                {q.image_url && (
                  <div style={{ background: "#000" }}>
                    <img
                      key={q.id}
                      src={q.image_url}
                      alt={`Question ${idx + 1}`}
                      style={{ width: "100%", display: "block", objectFit: "contain", maxHeight: 380 }}
                    />
                  </div>
                )}

                <div style={{ padding: "24px 24px 28px" }}>

                  {/* Outcome banner */}
                  {(() => {
                    const isSkipped = !q.playerAns;
                    const isCorrect = q.playerRight;
                    const bg     = isSkipped ? "var(--c-subtle)"             : isCorrect ? "rgba(58,158,106,0.07)"    : "rgba(208,64,64,0.06)";
                    const border  = isSkipped ? "var(--c-border)"             : isCorrect ? "rgba(58,158,106,0.25)"    : "rgba(208,64,64,0.2)";
                    const color   = isSkipped ? "var(--c-text-3)"             : isCorrect ? "#2d7a4f"                  : "#c03030";
                    const label   = isSkipped ? "Not attempted"               : isCorrect ? "Correct"                  : "Incorrect";
                    const icon    = isSkipped ? "—"                           : isCorrect ? <IconCheck size={14} color={color} /> : <IconX size={14} color={color} />;
                    return (
                      <div style={{
                        display: "flex", alignItems: "center", gap: 10, padding: "12px 16px",
                        borderRadius: 10, background: bg, border: `1px solid ${border}`, marginBottom: 4,
                      }}>
                        <span style={{ fontSize: 14 }}>{icon}</span>
                        <div style={{ flex: 1 }}>
                          <span style={{ fontSize: 14, fontWeight: 700, color }}>{label}</span>
                          {q.playerAns && (
                            <span style={{ fontSize: 13, color: "var(--c-text-3)", marginLeft: 10 }}>
                              Your answer: <strong style={{ color: isCorrect ? "#2d7a4f" : "#c03030" }}>{q.playerAns}</strong>
                            </span>
                          )}
                          {!isCorrect && !isSkipped && (
                            <span style={{ fontSize: 13, color: "#2d7a4f", marginLeft: 10 }}>
                              Correct: <strong>{Array.isArray(q.correct) ? (q.correct as any)[0] : q.correct}</strong>
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: 11, color: "var(--c-text-3)", flexShrink: 0 }}>
                          Bot: {q.botRight
                            ? <span style={{ color: "#2d7a4f", fontWeight: 700 }}>✓</span>
                            : q.botAns
                              ? <span style={{ color: "#c03030", fontWeight: 700 }}>✗</span>
                              : "—"}
                        </div>
                      </div>
                    );
                  })()}

                  {/* Option distribution */}
                  <OptionBars
                    correct={q.correct}
                    playerAns={q.playerAns}
                    botAns={q.botAns}
                    optionCounts={optionMap[q.id]}
                  />

                  {/* Social row */}
                  <div style={{ marginTop: 24, paddingTop: 20, borderTop: "1px solid var(--c-border)", display: "flex", alignItems: "center", gap: 10 }}>
                    <SolidButton
                      questionId={q.id}
                      initialCount={solidCounts[q.id] ?? 0}
                      initialSolid={mySolids.has(q.id)}
                    />
                    <div style={{ flex: 1 }} />
                  </div>

                  <CommentSection questionId={q.id} />
                </div>
              </div>
            )}

            {/* Bottom nav */}
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 20 }}>
              <button type="button" onClick={() => setIdx(i => Math.max(0, i - 1))} disabled={idx === 0}
                style={{
                  padding: "10px 20px", borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: idx === 0 ? "not-allowed" : "pointer",
                  border: "1px solid var(--c-border)", background: "transparent", color: idx === 0 ? "var(--c-border)" : "var(--c-text-2)",
                  display: "flex", alignItems: "center", gap: 6,
                }}>
                <IconChevronLeft size={15} /> Previous
              </button>
              <button type="button" onClick={() => setIdx(i => Math.min(filtered.length - 1, i + 1))} disabled={idx === filtered.length - 1}
                style={{
                  padding: "10px 20px", borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: idx === filtered.length - 1 ? "not-allowed" : "pointer",
                  border: "1px solid var(--c-brand-300, #e89e6a)", background: idx === filtered.length - 1 ? "transparent" : "var(--c-brand-50)",
                  color: idx === filtered.length - 1 ? "var(--c-border)" : "var(--c-brand-600)",
                  display: "flex", alignItems: "center", gap: 6,
                }}>
                Next <IconChevronRight size={15} />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Root Component ─────────────────────────────────────────────

export default function ArenaResult({ loaderData }: Route.ComponentProps) {
  const { user, match, careerMph, gamesPlayed, solidCounts, mySolids, optionMap, pctMap } = loaderData as any;
  const [view, setView] = useState<"overview" | "review">("overview");

  const mySolidsSet = new Set<string>(mySolids);

  if (!match.submitted_at) {
    return (
      <div className="app-layout">
        <Sidebar displayName={user.display_name} username={user.username ?? undefined} />
        <main className="app-main" style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ textAlign: "center" }}>
            <p style={{ fontSize: 15, color: "var(--c-text-2)", marginBottom: 16 }}>Match not yet finished.</p>
            <Link to={`/arena/${match.id}`} style={{ color: "var(--c-brand-600)", textDecoration: "none", fontWeight: 600 }}>
              Return to match →
            </Link>
          </div>
        </main>
      </div>
    );
  }

  const questions: QResult[] = [];
  const rawQs: Array<{ id: string; image_url: string; correct_answer: string }> = match.questions as any;
  const playerAnswers: Record<string, string> = (match.player_answers ?? {}) as any;
  const botAnswers: Record<string, string | null> = (match.bot_answers ?? {}) as any;

  for (const q of rawQs) {
    questions.push({
      id: q.id, image_url: q.image_url, correct: q.correct_answer,
      playerAns: playerAnswers[q.id],
      botAns: botAnswers[q.id],
      playerRight: playerAnswers[q.id] === q.correct_answer,
      botRight: botAnswers[q.id] === q.correct_answer,
    });
  }

  const eloDelta = match.player_elo_after != null && match.player_elo_before != null
    ? match.player_elo_after - match.player_elo_before : 0;
  const playerCorrect  = match.player_correct ?? 0;
  const botCorrect     = match.bot_correct ?? 0;
  const playerAttempted = Object.values(playerAnswers).filter(a => a != null && a !== "").length;
  const playerWrong    = playerAttempted - playerCorrect;
  const durationHours  = MODE_SECONDS[match.mode] / 3600;
  const actualMarks    = playerCorrect * MARKS_CORRECT - playerWrong * MARKS_WRONG;
  const rawMph         = Math.round((playerAttempted * MARKS_CORRECT) / durationHours);
  const actualMph      = Math.round(actualMarks / durationHours);

  return (
    <div className="app-layout">
      <Sidebar displayName={user.display_name} username={user.username ?? undefined} />
      <main className="app-main" style={{ padding: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {view === "overview" ? (
          <div style={{ flex: 1, overflowY: "auto" }}>
            <OverviewScreen
              match={match} careerMph={careerMph} gamesPlayed={gamesPlayed}
              playerCorrect={playerCorrect} botCorrect={botCorrect}
              playerAttempted={playerAttempted} playerWrong={playerWrong}
              questions={questions} actualMph={actualMph} rawMph={rawMph} eloDelta={eloDelta}
              onReview={() => setView("review")}
            />
          </div>
        ) : (
          <ReviewScreen
            qResults={questions} solidCounts={solidCounts}
            mySolids={mySolidsSet} optionMap={optionMap}
            onBack={() => setView("overview")}
          />
        )}
      </main>
    </div>
  );
}
