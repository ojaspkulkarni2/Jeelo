import { data, Link } from "react-router";
import type { Route } from "./+types/arena.pvp.$matchId.result";
import { requireUser } from "~/lib/auth.server";
import { createServerClient } from "~/lib/supabase.server";
import { Sidebar } from "~/components/sidebar";

const MODE_ICON: Record<string, string> = { bullet: "⚡", blitz: "🔥", rapid: "♟️" };

export async function loader({ params, request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const user = await requireUser(request, env);
  const supabase = createServerClient(env);

  const { data: match, error } = await supabase
    .from("matches")
    .select("*")
    .eq("id", params.matchId)
    .single();

  if (error || !match) throw new Response("Match not found", { status: 404 });

  const isPlayerOne = match.player_one_id === user.id;
  if (!isPlayerOne && match.player_two_id !== user.id) {
    throw new Response("Not your match", { status: 403 });
  }

  const opponentId = isPlayerOne ? match.player_two_id : match.player_one_id;
  const { data: opponent } = await supabase
    .from("users")
    .select("display_name, username")
    .eq("id", opponentId)
    .maybeSingle();

  const myScore  = isPlayerOne ? match.player_one_score  : match.player_two_score;
  const oppScore = isPlayerOne ? match.player_two_score  : match.player_one_score;
  const myDelta  = isPlayerOne ? match.player_one_elo_delta : match.player_two_elo_delta;

  const result: "win" | "loss" | "draw" =
    match.status !== "completed" ? "draw" :
    match.result === "draw" ? "draw" :
    (match.result === "player_one_win") === isPlayerOne ? "win" : "loss";

  return data({ user, match, opponent, myScore, oppScore, myDelta, result });
}

export default function PvPResult({ loaderData }: Route.ComponentProps) {
  const { user, match, opponent, myScore, oppScore, myDelta, result } = loaderData as any;

  const resultLabel = result === "win" ? "You won! 🎉" : result === "loss" ? "You lost." : "Draw!";
  const deltaLabel  = myDelta > 0 ? `+${myDelta}` : `${myDelta}`;
  const deltaColor  = myDelta > 0 ? "#2d7a4f" : myDelta < 0 ? "var(--c-error)" : "var(--c-text-3)";

  return (
    <div className="app-layout">
      <Sidebar displayName={user.display_name} username={(user as any).username} />
      <main className="app-main" style={{ maxWidth: 480, margin: "0 auto", padding: "48px 24px", textAlign: "center" }}>

        <div style={{
          fontFamily: "var(--font-display)", fontSize: 32, fontWeight: 700,
          color: "var(--c-text)", marginBottom: 6,
        }}>
          {resultLabel}
        </div>

        <div style={{ fontSize: 13, color: "var(--c-text-3)", marginBottom: 28 }}>
          {MODE_ICON[match.arena_mode ?? "blitz"]} {match.arena_mode} vs {opponent?.display_name ?? "Opponent"}
        </div>

        {/* Score card */}
        <div style={{
          display: "grid", gridTemplateColumns: "1fr auto 1fr", alignItems: "center",
          gap: 12, background: "var(--c-surface)", border: "1px solid var(--c-border)",
          borderRadius: 16, padding: "20px 24px", marginBottom: 20,
        }}>
          <div>
            <div style={{ fontSize: 11, color: "var(--c-text-3)", marginBottom: 4 }}>You</div>
            <div style={{ fontSize: 36, fontWeight: 800, color: "var(--c-brand-500)", fontFamily: "var(--font-numbers)" }}>
              {myScore}
            </div>
          </div>
          <div style={{ fontSize: 16, color: "var(--c-text-3)", fontWeight: 700 }}>vs</div>
          <div>
            <div style={{ fontSize: 11, color: "var(--c-text-3)", marginBottom: 4 }}>
              {opponent?.display_name ?? "Opponent"}
            </div>
            <div style={{ fontSize: 36, fontWeight: 800, color: "var(--c-text-2)", fontFamily: "var(--font-numbers)" }}>
              {oppScore}
            </div>
          </div>
        </div>

        {/* ELO delta */}
        {myDelta != null && (
          <div style={{
            fontSize: 20, fontWeight: 800, color: deltaColor,
            fontFamily: "var(--font-numbers)", marginBottom: 28,
          }}>
            {deltaLabel} ELO
          </div>
        )}

        <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
          <Link to="/arena" className="btn btn-primary">Play again</Link>
          <Link to="/feed"  className="btn btn-ghost">Back to Feed</Link>
        </div>
      </main>
    </div>
  );
}
