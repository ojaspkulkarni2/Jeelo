import { data, useFetcher, Link } from "react-router";
import type { Route } from "./+types/u.$username";
import { requireUser } from "~/lib/auth.server";
import { createServerClient } from "~/lib/supabase.server";
import { Sidebar } from "~/components/sidebar";

// ── Loader ────────────────────────────────────────────────────

export async function loader({ params, request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const currentUser = await requireUser(request, env);
  const supabase = createServerClient(env);

  const { data: profile } = await supabase
    .from("users")
    .select("id, display_name, username, bio, avatar_url, created_at")
    .eq("username", params.username)
    .single();

  if (!profile) throw new Response("Not found", { status: 404 });

  const [
    testsRes, followerRes, followingRes, isFollowingRes,
    progressRes, arenaRes, subjectsRes,
  ] = await Promise.all([
    supabase.from("tests")
      .select("id, title, duration_mins, is_layered, test_sections(id, subject, test_questions(question_id))")
      .eq("owner_id", profile.id).eq("is_published", true).eq("visibility", "public")
      .order("created_at", { ascending: false }).limit(12),
    supabase.from("tracks").select("id", { count: "exact", head: true }).eq("tracking_id", profile.id),
    supabase.from("tracks").select("id", { count: "exact", head: true }).eq("tracker_id", profile.id),
    supabase.from("tracks").select("id").eq("tracker_id", currentUser.id).eq("tracking_id", profile.id).maybeSingle(),
    supabase.from("chapter_progress")
      .select("chapter_id, theory_done, own_questions_done, curated_done, practice_done, mastered")
      .eq("user_id", profile.id),
    supabase.from("arena_ratings")
      .select("bullet_elo, blitz_elo, rapid_elo, bullet_games, blitz_games, rapid_games")
      .eq("user_id", profile.id).maybeSingle(),
    supabase.from("subjects")
      .select("id, name, slug, display_order, chapters(id, name, slug, display_order)")
      .order("display_order"),
  ]);

  const subjects = (subjectsRes.data ?? []).map((s: any) => ({
    ...s,
    chapters: [...(s.chapters ?? [])].sort((a: any, b: any) => a.display_order - b.display_order),
  }));

  const tests = (testsRes.data ?? []).map((t: any) => {
    const qCount = (t.test_sections ?? []).reduce((s: number, sec: any) => s + (sec.test_questions?.length ?? 0), 0);
    const subjectList: string[] = [...new Set((t.test_sections ?? []).map((s: any) => s.subject as string))];
    return { id: t.id, title: t.title, duration_mins: t.duration_mins, is_layered: t.is_layered, question_count: qCount, subjects: subjectList };
  });

  const progress = progressRes.data ?? [];
  const masteredCount = progress.filter((p: any) => p.mastered).length;
  const totalChapters = subjects.reduce((s: number, sub: any) => s + sub.chapters.length, 0);
  const arena = arenaRes.data;
  const joinedDate = profile.created_at
    ? new Date(profile.created_at).toLocaleDateString("en-IN", { month: "short", year: "numeric" }) : null;

  return data({
    currentUser, profile, tests, subjects, progress, arena,
    followerCount: followerRes.count ?? 0,
    followingCount: followingRes.count ?? 0,
    isFollowing: !!isFollowingRes.data,
    masteredCount, totalChapters,
    isSelf: currentUser.id === profile.id,
    joinedDate,
  });
}

// ── Action ────────────────────────────────────────────────────

export async function action({ request, context }: Route.ActionArgs) {
  const env = context.cloudflare.env;
  const user = await requireUser(request, env);
  const supabase = createServerClient(env);
  const fd = await request.formData();
  const intent   = fd.get("intent");
  const targetId = String(fd.get("target_id"));
  if (intent === "follow") {
    await supabase.from("tracks").insert({ tracker_id: user.id, tracking_id: targetId });
  } else if (intent === "unfollow") {
    await supabase.from("tracks").delete().eq("tracker_id", user.id).eq("tracking_id", targetId);
  }
  return data({ ok: true });
}

// ── Hex helpers — matches map.tsx palette ─────────────────────

function hexPath(cx: number, cy: number, r: number) {
  const pts = Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 3) * i - Math.PI / 6;
    return `${cx + r * Math.cos(a)},${cy + r * Math.sin(a)}`;
  });
  return `M ${pts[0]} ${pts.slice(1).map(p => `L ${p}`).join(" ")} Z`;
}

function hexFill(done: number) {
  if (done >= 5) return "var(--c-brand-500)";
  if (done === 4) return "var(--c-brand-400)";
  if (done === 3) return "var(--c-brand-300)";
  if (done === 2) return "var(--c-brand-200)";
  if (done === 1) return "var(--c-brand-100)";
  return "var(--c-surface)";
}
function hexStroke(done: number) {
  if (done >= 4) return "var(--c-brand-600)";
  if (done >= 1) return "var(--c-brand-400)";
  return "var(--c-border)";
}

// ── Component ─────────────────────────────────────────────────

export default function ProfilePage({ loaderData }: Route.ComponentProps) {
  const {
    currentUser, profile, tests, subjects, progress, arena,
    followerCount, followingCount, isFollowing, masteredCount,
    totalChapters, isSelf, joinedDate,
  } = loaderData;
  const fetcher = useFetcher();

  const optimisticFollowing = fetcher.formData
    ? fetcher.formData.get("intent") === "follow"
    : isFollowing;

  const initial = (profile.display_name?.[0] ?? "?").toUpperCase();
  const pMap = new Map((progress as any[]).map((p: any) => [p.chapter_id, p]));

  function stepsDone(p: any) {
    if (!p) return 0;
    return [p.theory_done, p.own_questions_done, p.curated_done, p.practice_done, p.mastered].filter(Boolean).length;
  }

  const mapPct = totalChapters > 0 ? Math.round((masteredCount / totalChapters) * 100) : 0;

  return (
    <div className="app-layout">
      <Sidebar displayName={currentUser.display_name} username={(currentUser as any).username} />
      <main className="app-main">

        {/* ── Header ── */}
        <div className="pg-head" style={{ flexDirection: "column", alignItems: "stretch", gap: 20, paddingBottom: 20 }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 16 }}>
            {/* Avatar */}
            <div style={{
              width: 56, height: 56, borderRadius: 14, flexShrink: 0,
              background: "var(--c-brand-100)", border: "1.5px solid var(--c-border)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 22, fontWeight: 900, color: "var(--c-brand-600)", overflow: "hidden",
            }}>
              {profile.avatar_url
                ? <img src={profile.avatar_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                : initial}
            </div>

            <div style={{ flex: 1 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <h1 className="pg-title" style={{ margin: 0, fontStyle: "normal", fontWeight: 700 }}>{profile.display_name}</h1>
                {!isSelf && (
                  <fetcher.Form method="post">
                    <input type="hidden" name="intent" value={optimisticFollowing ? "unfollow" : "follow"} />
                    <input type="hidden" name="target_id" value={profile.id} />
                    <button type="submit" className={`btn btn-sm ${optimisticFollowing ? "btn-ghost" : "btn-primary"}`}>
                      {optimisticFollowing ? "Following" : "Follow"}
                    </button>
                  </fetcher.Form>
                )}
              </div>
              {profile.username && (
                <p style={{ margin: "3px 0 0", fontSize: 13, color: "var(--c-text-3)" }}>@{profile.username}{joinedDate && ` · joined ${joinedDate}`}</p>
              )}
              {profile.bio && (
                <p style={{ margin: "8px 0 0", fontSize: 13, color: "var(--c-text-2)", lineHeight: 1.5, maxWidth: 560 }}>{profile.bio}</p>
              )}
            </div>
          </div>

          {/* Stats row */}
          <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
            <div>
              <span style={{ fontSize: 17, fontWeight: 700, color: "var(--c-text)" }}>{followerCount}</span>
              <span style={{ fontSize: 13, color: "var(--c-text-3)", marginLeft: 5 }}>followers</span>
            </div>
            <div>
              <span style={{ fontSize: 17, fontWeight: 700, color: "var(--c-text)" }}>{followingCount}</span>
              <span style={{ fontSize: 13, color: "var(--c-text-3)", marginLeft: 5 }}>following</span>
            </div>
            <div>
              <span style={{ fontSize: 17, fontWeight: 700, color: "var(--c-text)" }}>{masteredCount}</span>
              <span style={{ fontSize: 13, color: "var(--c-text-3)", marginLeft: 5 }}>mastered · {mapPct}%</span>
            </div>
            {arena && (
              <>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <svg width="13" height="13" viewBox="0 0 100 100" fill="#C0923F"><path d="M55 5C55 5 75 15 75 45L75 60L60 75L60 90L50 100L40 90L40 75L25 60L25 45C25 15 45 5 55 5Z"/></svg>
                  <span style={{ fontSize: 17, fontWeight: 700, color: "var(--c-text)" }}>{arena.bullet_elo}</span>
                  <span style={{ fontSize: 13, color: "var(--c-text-3)" }}>bullet</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="#C47B4A"><polygon points="13,2 4,14 12,14 11,22 20,10 12,10"/></svg>
                  <span style={{ fontSize: 17, fontWeight: 700, color: "var(--c-text)" }}>{arena.blitz_elo}</span>
                  <span style={{ fontSize: 13, color: "var(--c-text-3)" }}>blitz</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#4E8A4E" strokeWidth="2.2" strokeLinecap="round"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5"/><path d="M9.5 2.5h5"/></svg>
                  <span style={{ fontSize: 17, fontWeight: 700, color: "var(--c-text)" }}>{arena.rapid_elo}</span>
                  <span style={{ fontSize: 13, color: "var(--c-text-3)" }}>rapid</span>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Syllabus map */}
        <div className="pg-body">
            <div>
              {progress.length === 0 ? (
                <p style={{ color: "var(--c-text-3)", fontSize: 14 }}>
                  {isSelf ? "Start studying to fill your map." : "No progress tracked yet."}
                </p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
                  {(subjects as any[]).map((sub: any) => {
                    const masteredInSub = sub.chapters.filter((c: any) => pMap.get(c.id)?.mastered).length;
                    return (
                      <div key={sub.id}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                          <span style={{ fontSize: 11, fontWeight: 700, color: "var(--c-text-3)", textTransform: "uppercase", letterSpacing: "0.07em" }}>
                            {sub.name}
                          </span>
                          <span style={{ fontSize: 11, color: "var(--c-text-3)" }}>{masteredInSub}/{sub.chapters.length}</span>
                          <div style={{ flex: 1, height: 2, background: "var(--c-border)", borderRadius: 1, overflow: "hidden" }}>
                            <div style={{ height: "100%", background: "var(--c-brand-500)", width: sub.chapters.length > 0 ? `${(masteredInSub / sub.chapters.length) * 100}%` : "0%" }} />
                          </div>
                        </div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
                          {sub.chapters.map((ch: any) => {
                            const p = pMap.get(ch.id);
                            const done = stepsDone(p);
                            const mastered = p?.mastered ?? false;
                            return (
                              <svg key={ch.id} width="20" height="22" viewBox="-1.1 -1.1 2.2 2.2" title={ch.name} style={{ cursor: "default" }}>
                                <path d={hexPath(0, 0, 1)} fill={hexFill(done)} stroke={hexStroke(done)} strokeWidth={mastered ? 0.15 : 0.1} />
                              </svg>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
        </div>
      </main>
    </div>
  );
}