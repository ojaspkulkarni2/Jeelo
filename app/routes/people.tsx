import { data, Link, Form, useFetcher } from "react-router";
import { useState } from "react";
import type { Route } from "./+types/people";
import { requireUser } from "~/lib/auth.server";
import { createServerClient } from "~/lib/supabase.server";
import { Sidebar } from "~/components/sidebar";

// ── Loader ─────────────────────────────────────────────────────

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const user = await requireUser(request, env);
  const supabase = createServerClient(env);
  const url = new URL(request.url);
  const q   = url.searchParams.get("q")?.trim() ?? "";

  // People I already track
  const { data: tracking } = await supabase
    .from("tracks")
    .select("tracking_id, users!tracking_id(id, display_name, username)")
    .eq("tracker_id", user.id);

  const trackedIds = new Set((tracking ?? []).map((t: any) => t.tracking_id));
  const trackedUsers = (tracking ?? []).map((t: any) => ({
    id: t.tracking_id,
    display_name: t.users?.display_name ?? "?",
    username: t.users?.username ?? null,
  }));

  // Recent activity of tracked users
  let friendActivity: any[] = [];
  if (trackedUsers.length > 0) {
    const trackedIdList = trackedUsers.map((u: any) => u.id);

    const [matchesRes, attemptsRes, activeMatchesRes] = await Promise.all([
      supabase
        .from("arena_matches")
        .select("id, player_id, mode, bot_name, player_correct, bot_correct, started_at, submitted_at")
        .in("player_id", trackedIdList)
        .not("submitted_at", "is", null)
        .order("submitted_at", { ascending: false })
        .limit(30),
      supabase
        .from("attempts")
        .select("id, student_id, test_id, submitted_at, tests!test_id(title)")
        .in("student_id", trackedIdList)
        .not("submitted_at", "is", null)
        .order("submitted_at", { ascending: false })
        .limit(20),
      supabase
        .from("arena_matches")
        .select("id, player_id, mode, started_at")
        .in("player_id", trackedIdList)
        .is("submitted_at", null)
        .gte("started_at", new Date(Date.now() - 30 * 60 * 1000).toISOString()),
    ]);

    const userMap = new Map(trackedUsers.map((u: any) => [u.id, u]));

    const liveActivities = (activeMatchesRes.data ?? []).map((m: any) => ({
      type: "live_match" as const,
      userId: m.player_id,
      user: userMap.get(m.player_id),
      data: m,
      timestamp: m.started_at,
    }));

    const matchActivities = (matchesRes.data ?? []).map((m: any) => ({
      type: "arena_match" as const,
      userId: m.player_id,
      user: userMap.get(m.player_id),
      data: m,
      timestamp: m.submitted_at ?? m.started_at,
    }));

    const attemptActivities = (attemptsRes.data ?? []).map((a: any) => ({
      type: "test_attempt" as const,
      userId: a.student_id,
      user: userMap.get(a.student_id),
      data: a,
      timestamp: a.submitted_at,
    }));

    friendActivity = [...liveActivities, ...matchActivities, ...attemptActivities]
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, 25);
  }

  // Search results
  let searchResults: any[] = [];
  if (q.length >= 2) {
    const { data: results } = await supabase
      .from("users")
      .select("id, display_name, username")
      .or(`display_name.ilike.%${q}%,username.ilike.%${q}%`)
      .neq("id", user.id)
      .limit(20);
    searchResults = (results ?? []).map((r: any) => ({
      ...r,
      isTracked: trackedIds.has(r.id),
    }));
  }

  return data({ user, trackedUsers, searchResults, q, friendActivity });
}

// ── Action ─────────────────────────────────────────────────────

export async function action({ request, context }: Route.ActionArgs) {
  const env = context.cloudflare.env;
  const user = await requireUser(request, env);
  const supabase = createServerClient(env);
  const fd = await request.formData();
  const intent   = fd.get("intent") as string;
  const targetId = fd.get("target_id") as string;

  if (intent === "track") {
    await supabase.from("tracks").upsert(
      { tracker_id: user.id, tracking_id: targetId },
      { onConflict: "tracker_id,tracking_id" }
    );
  } else if (intent === "untrack") {
    await supabase.from("tracks").delete()
      .eq("tracker_id", user.id)
      .eq("tracking_id", targetId);
  }
  return data({ ok: true });
}

// ── Helpers ─────────────────────────────────────────────────────

function timeAgo(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

const AVATAR_COLORS = [
  "#d77656", "#4E8A4E", "#5B7FA6", "#9B6B9B", "#C47B4A",
  "#6B8F71", "#7A6FA8", "#A85E5E",
];

function avatarColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffffffff;
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}

const MODE_COLORS: Record<string, string> = {
  bullet: "#C0923F", blitz: "#C47B4A", rapid: "#4E8A4E",
};

// ── TrackButton ─────────────────────────────────────────────────

function TrackButton({ userId, isTracked }: { userId: string; isTracked: boolean }) {
  const fetcher = useFetcher();
  const pending = fetcher.state !== "idle";
  const optimistic = pending
    ? fetcher.formData?.get("intent") === "track"
    : isTracked;

  return (
    <fetcher.Form method="post">
      <input type="hidden" name="target_id" value={userId} />
      <input type="hidden" name="intent" value={optimistic ? "untrack" : "track"} />
      <button type="submit" style={{
        padding: "5px 14px", borderRadius: 20, fontSize: 12, fontWeight: 600,
        cursor: "pointer", border: "1px solid var(--c-border)",
        background: optimistic ? "var(--c-brand-500)" : "transparent",
        color: optimistic ? "#fff" : "var(--c-text-2)",
        opacity: pending ? 0.6 : 1,
        transition: "all 0.12s",
      }}>
        {optimistic ? "Following" : "Follow"}
      </button>
    </fetcher.Form>
  );
}

// ── ActivityCard ────────────────────────────────────────────────

function ActivityCard({ item }: { item: any }) {
  const name    = item.user?.display_name ?? "Someone";
  const username = item.user?.username;
  const color   = avatarColor(name);
  const initial = name[0].toUpperCase();
  const isLive  = item.type === "live_match";

  let accent = "var(--c-brand-500)";
  let icon   = "⚔️";
  let content: React.ReactNode = null;
  let duelLink = "";

  if (item.type === "live_match") {
    const mode = item.data.mode ?? "blitz";
    accent = MODE_COLORS[mode] ?? accent;
    icon   = mode === "bullet" ? "🚀" : mode === "blitz" ? "⚡" : "🕐";
    content = (
      <span>
        <strong style={{ color: "var(--c-text)" }}>{name}</strong>
        <span style={{ color: "var(--c-text-2)" }}> is dueling right now in </span>
        <span style={{ color: accent, fontWeight: 700, textTransform: "capitalize" }}>{mode}</span>
        <span style={{ color: "var(--c-text-2)" }}> Arena</span>
      </span>
    );
  } else if (item.type === "arena_match") {
    const m    = item.data;
    const mode = m.mode ?? "blitz";
    accent = MODE_COLORS[mode] ?? accent;
    icon   = mode === "bullet" ? "🚀" : mode === "blitz" ? "⚡" : "🕐";
    const won  = (m.player_correct ?? 0) > (m.bot_correct ?? 0);
    const draw = (m.player_correct ?? 0) === (m.bot_correct ?? 0);
    const resultColor = won ? "#3a9e6a" : draw ? "var(--c-text-3)" : "#d04040";
    content = (
      <span>
        <strong style={{ color: "var(--c-text)" }}>{name}</strong>
        <span style={{ color: "var(--c-text-2)" }}> </span>
        <span style={{ color: resultColor, fontWeight: 700 }}>{won ? "won" : draw ? "drew" : "lost"}</span>
        <span style={{ color: "var(--c-text-2)" }}> a {mode} duel </span>
        <span style={{ color: "var(--c-text-3)" }}>({m.player_correct ?? 0}–{m.bot_correct ?? 0} vs {m.bot_name ?? "bot"})</span>
      </span>
    );
    duelLink = `/arena/${m.id}/result`;
  } else if (item.type === "test_attempt") {
    icon = "📝";
    const testTitle = item.data.tests?.title ?? "a test";
    content = (
      <span>
        <strong style={{ color: "var(--c-text)" }}>{name}</strong>
        <span style={{ color: "var(--c-text-2)" }}> completed </span>
        <span style={{ color: "var(--c-text)", fontStyle: "italic" }}>{testTitle}</span>
      </span>
    );
  }

  return (
    <div style={{
      background: "var(--c-surface)",
      border: `1px solid ${isLive ? accent + "55" : "var(--c-border)"}`,
      borderRadius: 14, padding: "14px 16px",
      display: "flex", gap: 12, alignItems: "flex-start",
      position: "relative", overflow: "hidden",
    }}>
      {isLive && (
        <div style={{
          position: "absolute", top: 0, left: 0, right: 0, height: 2,
          background: `linear-gradient(90deg, ${accent}cc, transparent)`,
        }} />
      )}

      {/* Avatar */}
      <div style={{
        width: 38, height: 38, borderRadius: "50%", flexShrink: 0,
        background: color, display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 15, fontWeight: 700, color: "#fff",
        boxShadow: isLive ? `0 0 0 2.5px ${accent}55` : "none",
      }}>
        {initial}
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ margin: "0 0 5px", fontSize: 13.5, lineHeight: 1.5 }}>{content}</p>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          {isLive ? (
            <span style={{
              display: "inline-flex", alignItems: "center", gap: 4,
              fontSize: 11, fontWeight: 700, color: accent,
              background: accent + "18", border: `1px solid ${accent}35`,
              padding: "2px 8px", borderRadius: 20,
            }}>
              <span style={{
                width: 6, height: 6, borderRadius: "50%", background: accent,
                display: "inline-block", animation: "live-pulse 1.2s ease-in-out infinite",
              }} />
              LIVE
            </span>
          ) : (
            <span style={{ fontSize: 11, color: "var(--c-text-3)" }}>{timeAgo(item.timestamp)}</span>
          )}
          {username && (
            <Link to={`/u/${username}`} style={{ fontSize: 11, color: "var(--c-text-3)", textDecoration: "none" }}>
              @{username}
            </Link>
          )}
        </div>
      </div>

      {/* CTA */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6, flexShrink: 0 }}>
        {isLive && (
          <Link to="/arena" style={{
            display: "inline-flex", alignItems: "center", gap: 5,
            padding: "6px 13px", borderRadius: 8, fontSize: 12, fontWeight: 700,
            background: accent, color: "#fff", textDecoration: "none", whiteSpace: "nowrap",
          }}>
            ⚔️ Duel
          </Link>
        )}
        {duelLink && (
          <Link to={duelLink} style={{
            display: "inline-flex", alignItems: "center",
            padding: "5px 10px", borderRadius: 8, fontSize: 11, fontWeight: 600,
            border: "1px solid var(--c-border)", color: "var(--c-text-2)",
            textDecoration: "none", whiteSpace: "nowrap",
          }}>
            View result
          </Link>
        )}
      </div>
    </div>
  );
}

// ── SearchUserCard ──────────────────────────────────────────────

function SearchUserCard({ u }: { u: any }) {
  const color = avatarColor(u.display_name ?? "?");
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 12,
      padding: "10px 14px", borderRadius: 12,
      background: "var(--c-surface)", border: "1px solid var(--c-border)",
    }}>
      <div style={{
        width: 36, height: 36, borderRadius: "50%", flexShrink: 0,
        background: color, display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 14, fontWeight: 700, color: "#fff",
      }}>
        {(u.display_name ?? "?")[0].toUpperCase()}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <Link to={u.username ? `/u/${u.username}` : `/u/${u.id}`} style={{
          fontSize: 13, fontWeight: 600, color: "var(--c-text)", textDecoration: "none", display: "block",
        }}>
          {u.display_name}
        </Link>
        {u.username && <div style={{ fontSize: 11, color: "var(--c-text-3)" }}>@{u.username}</div>}
      </div>
      <TrackButton userId={u.id} isTracked={u.isTracked} />
    </div>
  );
}

// ── FriendChip ──────────────────────────────────────────────────

function FriendChip({ u }: { u: any }) {
  const color = avatarColor(u.display_name ?? "?");
  return (
    <Link
      to={u.username ? `/u/${u.username}` : `/u/${u.id}`}
      style={{
        display: "flex", alignItems: "center", gap: 9,
        padding: "7px 12px", borderRadius: 10,
        textDecoration: "none", color: "inherit", transition: "background 0.12s",
      }}
      onMouseEnter={e => (e.currentTarget.style.background = "var(--c-hover)")}
      onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
    >
      <div style={{
        width: 30, height: 30, borderRadius: "50%", flexShrink: 0,
        background: color, display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 12, fontWeight: 700, color: "#fff",
      }}>
        {(u.display_name ?? "?")[0].toUpperCase()}
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: "var(--c-text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {u.display_name}
        </div>
        {u.username && <div style={{ fontSize: 10, color: "var(--c-text-3)" }}>@{u.username}</div>}
      </div>
    </Link>
  );
}

// ── Page ────────────────────────────────────────────────────────

export default function PeoplePage({ loaderData }: Route.ComponentProps) {
  const { user, trackedUsers, searchResults, q, friendActivity } = loaderData as any;
  const [query, setQuery] = useState(q ?? "");
  const [showSearch, setShowSearch] = useState(false);

  const liveCount = (friendActivity as any[]).filter((a: any) => a.type === "live_match").length;
  const liveItems = (friendActivity as any[]).filter((a: any) => a.type === "live_match");
  const recentItems = (friendActivity as any[]).filter((a: any) => a.type !== "live_match");

  return (
    <div className="app-layout">
      <Sidebar displayName={user.display_name} username={(user as any).username} />

      <style>{`
        @keyframes live-pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50%       { opacity: 0.4; transform: scale(0.7); }
        }
        @keyframes fade-in-up {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      <main className="app-main" style={{ display: "flex", minHeight: "100vh" }}>

        {/* ── Feed column ───────────────────────────── */}
        <div style={{ flex: 1, minWidth: 0, padding: "28px 32px", borderRight: "1px solid var(--c-border)" }}>

          {/* Header */}
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 24, gap: 12 }}>
            <div>
              <h1 style={{
                fontFamily: "var(--font-display)", fontSize: 28, fontWeight: 700,
                color: "var(--c-text)", margin: "0 0 3px",
              }}>
                Friends
              </h1>
              <p style={{ fontSize: 13, color: "var(--c-text-3)", margin: 0 }}>
                {trackedUsers.length === 0
                  ? "Follow people to see their activity here"
                  : liveCount > 0
                    ? `${liveCount} friend${liveCount !== 1 ? "s" : ""} in the arena right now 🔥`
                    : `Following ${trackedUsers.length} person${trackedUsers.length !== 1 ? "s" : ""}`}
              </p>
            </div>

            <button
              type="button"
              onClick={() => setShowSearch(s => !s)}
              style={{
                display: "inline-flex", alignItems: "center", gap: 7,
                padding: "8px 16px", borderRadius: 9, fontSize: 13, fontWeight: 600,
                background: showSearch ? "var(--c-subtle)" : "var(--c-brand-500)",
                color: showSearch ? "var(--c-text-2)" : "#fff",
                border: "none", cursor: "pointer", flexShrink: 0, transition: "all 0.15s",
              }}
            >
              {showSearch
                ? "✕ Close"
                : (<><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Find people</>)
              }
            </button>
          </div>

          {/* Search panel */}
          {showSearch && (
            <div style={{
              background: "var(--c-surface)", border: "1px solid var(--c-border)",
              borderRadius: 14, padding: "16px", marginBottom: 24,
              animation: "fade-in-up 0.18s ease",
            }}>
              <Form method="get" style={{ display: "flex", gap: 8, marginBottom: q.length >= 2 ? 14 : 0 }}>
                <input
                  name="q"
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder="Search by name or @username…"
                  autoFocus
                  style={{
                    flex: 1, padding: "8px 12px", borderRadius: 9, fontSize: 13,
                    border: "1px solid var(--c-border)", background: "var(--c-bg)",
                    color: "var(--c-text)", outline: "none",
                  }}
                />
                <button type="submit" style={{
                  padding: "8px 16px", borderRadius: 9, fontSize: 13, fontWeight: 600,
                  background: "var(--c-brand-500)", color: "#fff", border: "none", cursor: "pointer",
                }}>Search</button>
              </Form>

              {q.length >= 2 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {searchResults.length === 0
                    ? <p style={{ fontSize: 13, color: "var(--c-text-3)", margin: 0, padding: "4px 0" }}>No one found for "{q}".</p>
                    : searchResults.map((u: any) => <SearchUserCard key={u.id} u={u} />)
                  }
                </div>
              )}
            </div>
          )}

          {/* Activity stream */}
          {trackedUsers.length === 0 ? (
            <div style={{
              textAlign: "center", padding: "64px 32px",
              background: "var(--c-surface)", borderRadius: 16, border: "1px solid var(--c-border)",
            }}>
              <div style={{ fontSize: 48, marginBottom: 12 }}>👥</div>
              <h2 style={{ fontSize: 18, fontWeight: 700, color: "var(--c-text)", margin: "0 0 8px" }}>
                No friends yet
              </h2>
              <p style={{ fontSize: 13, color: "var(--c-text-3)", maxWidth: 300, margin: "0 auto 20px" }}>
                Follow people to see their arena duels, test results, and activity — live as it happens.
              </p>
              <button type="button" onClick={() => setShowSearch(true)} style={{
                padding: "9px 20px", borderRadius: 9, fontSize: 13, fontWeight: 700,
                background: "var(--c-brand-500)", color: "#fff", border: "none", cursor: "pointer",
              }}>
                Find people to follow
              </button>
            </div>
          ) : friendActivity.length === 0 ? (
            <div style={{
              textAlign: "center", padding: "48px 32px",
              background: "var(--c-surface)", borderRadius: 16, border: "1px solid var(--c-border)",
            }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>😴</div>
              <p style={{ fontSize: 14, fontWeight: 600, color: "var(--c-text)", margin: "0 0 4px" }}>Everyone's offline</p>
              <p style={{ fontSize: 13, color: "var(--c-text-3)", margin: 0 }}>No recent activity from people you follow.</p>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {/* Live now */}
              {liveItems.length > 0 && (
                <>
                  <div style={{
                    fontSize: 11, fontWeight: 700, textTransform: "uppercase",
                    letterSpacing: "0.08em", color: "var(--c-brand-500)",
                    display: "flex", alignItems: "center", gap: 6, marginBottom: 2,
                  }}>
                    <span style={{
                      width: 7, height: 7, borderRadius: "50%", background: "var(--c-brand-500)",
                      display: "inline-block", animation: "live-pulse 1.2s ease-in-out infinite",
                    }} />
                    Live now
                  </div>
                  {liveItems.map((item: any, i: number) => (
                    <div key={i} style={{ animation: `fade-in-up 0.2s ease ${i * 0.05}s both` }}>
                      <ActivityCard item={item} />
                    </div>
                  ))}
                </>
              )}

              {/* Recent */}
              {recentItems.length > 0 && (
                <>
                  <div style={{
                    fontSize: 11, fontWeight: 700, textTransform: "uppercase",
                    letterSpacing: "0.08em", color: "var(--c-text-3)",
                    marginTop: liveItems.length > 0 ? 10 : 0, marginBottom: 2,
                  }}>
                    Recent
                  </div>
                  {recentItems.map((item: any, i: number) => (
                    <div key={i} style={{ animation: `fade-in-up 0.2s ease ${i * 0.04}s both` }}>
                      <ActivityCard item={item} />
                    </div>
                  ))}
                </>
              )}
            </div>
          )}
        </div>

        {/* ── Right rail: following list ─────────────── */}
        <div style={{
          width: 230, flexShrink: 0, padding: "28px 12px",
          display: "flex", flexDirection: "column", gap: 2,
        }}>
          <div style={{
            fontSize: 11, fontWeight: 700, textTransform: "uppercase",
            letterSpacing: "0.08em", color: "var(--c-text-3)",
            padding: "0 12px", marginBottom: 6,
          }}>
            Following ({trackedUsers.length})
          </div>

          {trackedUsers.length === 0
            ? <p style={{ fontSize: 12, color: "var(--c-text-3)", padding: "4px 12px", margin: 0 }}>No one yet</p>
            : (trackedUsers as any[]).map((u: any) => <FriendChip key={u.id} u={u} />)
          }

          <div style={{ marginTop: 14, padding: "0 12px" }}>
            <button
              type="button"
              onClick={() => { setShowSearch(true); window.scrollTo({ top: 0, behavior: "smooth" }); }}
              style={{
                width: "100%", padding: "7px 12px", borderRadius: 9, fontSize: 12, fontWeight: 600,
                background: "transparent", color: "var(--c-text-3)",
                border: "1px dashed var(--c-border)", cursor: "pointer", transition: "all 0.12s",
              }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLElement).style.borderColor = "var(--c-brand-500)";
                (e.currentTarget as HTMLElement).style.color = "var(--c-brand-500)";
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLElement).style.borderColor = "var(--c-border)";
                (e.currentTarget as HTMLElement).style.color = "var(--c-text-3)";
              }}
            >
              + Find people
            </button>
          </div>
        </div>

      </main>
    </div>
  );
}
