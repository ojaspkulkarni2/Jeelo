import { redirect } from "react-router";
import type { Route } from "./+types/profile";
import { requireUser } from "~/lib/auth.server";
import { createServerClient } from "~/lib/supabase.server";

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const user = await requireUser(request, env);
  const supabase = createServerClient(env);

  // Fetch username; if null, backfill from display_name or id
  const { data: profile } = await supabase
    .from("users")
    .select("username, display_name")
    .eq("id", user.id)
    .single();

  let username = profile?.username;

  if (!username) {
    // Generate a username and save it
    const base = (profile?.display_name ?? "user")
      .toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "").slice(0, 20);
    const candidate = base || `user-${user.id.slice(0, 8)}`;
    // Check uniqueness
    const { data: existing } = await supabase
      .from("users").select("id").eq("username", candidate).maybeSingle();
    username = existing ? `${candidate}-${user.id.slice(0, 6)}` : candidate;
    await supabase.from("users").update({ username }).eq("id", user.id);
  }

  throw redirect(`/u/${username}`);
}

export default function Profile() { return null; }
