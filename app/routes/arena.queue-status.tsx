import { data } from "react-router";
import type { Route } from "./+types/arena.queue-status";
import { requireUser } from "~/lib/auth.server";
import { createServerClient } from "~/lib/supabase.server";

// Polled every 1.5 s by the searching UI.
// Returns { pvpMatchId } if paired, { inQueue } if still waiting.

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const user = await requireUser(request, env);
  const supabase = createServerClient(env);

  // Has a PvP match been created for this user?
  const { data: match } = await (supabase as any)
    .from("matches")
    .select("id")
    .or(`player_one_id.eq.${user.id},player_two_id.eq.${user.id}`)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (match) {
    return data({ pvpMatchId: match.id });
  }

  const { data: queued } = await (supabase as any)
    .from("matchmaking_queue")
    .select("queued_at")
    .eq("user_id", user.id)
    .maybeSingle();

  return data({ inQueue: !!queued });
}
