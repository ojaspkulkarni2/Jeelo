import { data, Link, redirect, useSearchParams, useFetcher } from "react-router";
import { useState } from "react";
import type { Route } from "./+types/discover";
import { requireUser } from "~/lib/auth.server";
import { createServerClient } from "~/lib/supabase.server";
import { Sidebar } from "~/components/sidebar";
import { IconPlay, IconTests, IconLayers } from "~/components/icons";
import { NewTestModal } from "~/routes/tests._index";
import { DotMenu } from "~/components/three-dot-menu";
import type { MenuItem } from "~/components/three-dot-menu";

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const user = await requireUser(request, env);
  const supabase = createServerClient(env);

  const [publicRes, myTestsRes, attemptCountsRes, solidCountsRes, myAttemptsRes] = await Promise.all([
    supabase
      .from("tests")
      .select(`
        id, title, description, duration_mins, created_at, is_layered, owner_id,
        users!owner_id(display_name, username),
        test_sections(id, subject, test_questions(question_id))
      `)
      .eq("is_published", true)
      .or("visibility.eq.public,visibility.is.null")
      .order("created_at", { ascending: false })
      .limit(24),

    supabase
      .from("tests")
      .select(`
        id, title, description, duration_mins, created_at, is_layered, is_published, owner_id,
        users!owner_id(display_name, username),
        test_sections(id, subject, test_questions(question_id))
      `)
      .eq("owner_id", user.id)
      .order("created_at", { ascending: false }),

    supabase.from("attempts").select("test_id").not("submitted_at", "is", null),
    supabase.from("solids").select("test_id").not("test_id", "is", null),
    supabase.from("attempts").select("test_id").eq("student_id", user.id).not("submitted_at", "is", null),
  ]);

  const countMap = new Map<string, number>();
  for (const a of attemptCountsRes.data ?? []) {
    countMap.set(a.test_id, (countMap.get(a.test_id) ?? 0) + 1);
  }

  const solidMap = new Map<string, number>();
  for (const s of solidCountsRes.data ?? []) {
    if (s.test_id) solidMap.set(s.test_id, (solidMap.get(s.test_id) ?? 0) + 1);
  }

  function processTest(t: any) {
    const sections = t.test_sections ?? [];
    const qCount = sections.reduce((s: number, sec: any) => s + (sec.test_questions?.length ?? 0), 0);
    const subjects: string[] = [...new Set(sections.map((s: any) => s.subject as string))];
    return {
      id: t.id,
      title: t.title,
      duration_mins: t.duration_mins,
      is_layered: t.is_layered ?? false,
      is_published: t.is_published ?? false,
      question_count: qCount,
      subjects,
      owner_id: t.owner_id,
      creator_name: t.users?.display_name ?? "Unknown",
      creator_username: t.users?.username ?? null,
      attempt_count: countMap.get(t.id) ?? 0,
      solid_count: solidMap.get(t.id) ?? 0,
      created_at: t.created_at,
    };
  }

  const processedTests = (publicRes.data ?? [])
    .map(processTest)
    .sort((a: any, b: any) => b.attempt_count - a.attempt_count);

  const myTests = (myTestsRes.data ?? []).map(processTest);

  const myAttemptedIds = (myAttemptsRes.data ?? []).map((a: any) => String(a.test_id)).filter(Boolean);

  return data({ user, tests: processedTests, myTests, userId: user.id, myAttemptedIds });
}

const SUBJECTS = ["All", "Physics", "Chemistry", "Mathematics"] as const;
type SubjectTab = typeof SUBJECTS[number];
const TAB_KEY: Record<SubjectTab, string | null> = {
  All: null, Physics: "physics", Chemistry: "chemistry", Mathematics: "mathematics",
};

export async function action({ request, context }: Route.ActionArgs) {
  const env = context.cloudflare.env;
  const user = await requireUser(request, env);
  const supabase = createServerClient(env);
  const formData = await request.formData();
  if (String(formData.get("intent")) === "create_test") {
    const title = String(formData.get("title") ?? "").trim();
    const description = String(formData.get("description") ?? "").trim() || null;
    const durationMins = parseInt(String(formData.get("duration_mins") ?? ""), 10);
    const visibility = String(formData.get("visibility") ?? "public");
    if (!title) return data({ error: "Title is required" }, { status: 400 });
    if (isNaN(durationMins) || durationMins <= 0) return data({ error: "Duration must be a positive number" }, { status: 400 });
    const { data: test, error } = await supabase
      .from("tests")
      .insert({ owner_id: user.id, title, description, duration_mins: durationMins, is_published: false, visibility })
      .select("id").single();
    if (error) return data({ error: error.message }, { status: 500 });
    throw redirect(`/tests/${test.id}`);
  }
  return null;
}

// ── Per-test actions menu (My Tests view) ──────────────────────
function TestCardMenu({ test }: { test: any }) {
  const fetcher = useFetcher();

  function submit(intent: string, extra?: Record<string, string>) {
    const fd = new FormData();
    fd.set("intent", intent);
    if (extra) Object.entries(extra).forEach(([k, v]) => fd.set(k, v));
    fetcher.submit(fd, { method: "post", action: `/tests/${test.id}` });
  }

  function handleDelete() {
    if (!confirm("Delete this test? This cannot be undone.")) return;
    submit("delete_test");
  }

  const menuItems: MenuItem[] = [
    { type: "link",   label: "Edit test", to: `/tests/${test.id}` },
    { type: "sep" },
    { type: "action", label: test.is_published ? "Unpublish" : "Publish",
      onClick: () => submit("toggle_publish", { is_published: String(test.is_published) }) },
    { type: "sep" },
    { type: "action", label: "Make Invite only",
      onClick: () => submit("set_visibility", { visibility: "invite_only" }) },
    { type: "action", label: "Make Private",
      onClick: () => submit("set_visibility", { visibility: "private" }) },
    { type: "sep" },
    { type: "action", label: "Delete test", danger: true, onClick: handleDelete },
  ];

  return <DotMenu items={menuItems} />;
}

export default function DiscoverPage({ loaderData }: Route.ComponentProps) {
  const { user, tests, myTests, userId, myAttemptedIds } = loaderData as any;
  const attemptedSet = new Set<string>((myAttemptedIds ?? []).map(String));
  const [searchParams, setSearchParams] = useSearchParams();
  const isMine = searchParams.get("mine") === "1";
  const [showCreate, setShowCreate] = useState(false);

  const [subjectTab, setSubjectTab] = useState<SubjectTab>("All");
  const [takenFilter, setTakenFilter] = useState<"all" | "taken" | "not-taken">("all");

  function setMine(v: boolean) {
    const p = new URLSearchParams(searchParams);
    if (v) p.set("mine", "1"); else p.delete("mine");
    setSearchParams(p, { replace: true });
  }

  const sourceList: any[] = isMine ? (myTests ?? []) : (tests ?? []);

  const filtered = sourceList.filter((t: any) => {
    if (!isMine) {
      const subjectKey = TAB_KEY[subjectTab];
      if (subjectKey && !t.subjects.some((s: string) => s?.toLowerCase().includes(subjectKey.toLowerCase()))) return false;
      if (takenFilter === "taken"     && !attemptedSet.has(String(t.id))) return false;
      if (takenFilter === "not-taken" &&  attemptedSet.has(String(t.id))) return false;
    }
    return true;
  });

  return (
    <div className="app-layout">
      <Sidebar displayName={user.display_name} username={(user as any).username} />

      <main className="app-main" style={{ padding: "28px 32px" }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 20, gap: 16 }}>
          <div>
            <h1 style={{ fontFamily: "var(--font-display)", fontSize: 26, fontWeight: 700, color: "var(--c-text)", margin: "0 0 4px" }}>
              {isMine ? "My Tests" : "Discover"}
            </h1>
            <p style={{ margin: 0, fontSize: 13, color: "var(--c-text-3)" }}>
              {isMine ? "Tests you've created — published or not." : "The community's best tests — sorted by attempts."}
            </p>
          </div>
          <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
            <Link to="/tests/generate" style={{
              display: "inline-flex", alignItems: "center", gap: 7,
              padding: "8px 16px", borderRadius: 10, textDecoration: "none",
              background: "var(--c-surface)", border: "1px solid var(--c-border)",
              color: "var(--c-text)", fontSize: 13, fontWeight: 600,
            }}>
              <IconLayers size={14} />
              Grand Layer
            </Link>
            <button type="button" className="btn btn-primary" onClick={() => setShowCreate(true)} style={{ textDecoration: "none" }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              New test
            </button>
          </div>
        </div>

        {/* Mode toggle: Community / My Tests */}
        <div style={{ display: "flex", gap: 4, marginBottom: 16, borderBottom: "1px solid var(--c-border)" }}>
          <button type="button" onClick={() => setMine(false)} style={{
            padding: "6px 14px", borderRadius: "8px 8px 0 0",
            fontSize: 12, fontWeight: 600, cursor: "pointer",
            background: !isMine ? "var(--c-brand-500)" : "transparent",
            color: !isMine ? "#fff" : "var(--c-text-2)",
            border: !isMine ? "1px solid var(--c-brand-500)" : "1px solid transparent",
            borderBottom: "none", marginBottom: -1,
          }}>Community</button>
          <button type="button" onClick={() => setMine(true)} style={{
            padding: "6px 14px", borderRadius: "8px 8px 0 0",
            fontSize: 12, fontWeight: 600, cursor: "pointer",
            background: isMine ? "var(--c-brand-500)" : "transparent",
            color: isMine ? "#fff" : "var(--c-text-2)",
            border: isMine ? "1px solid var(--c-brand-500)" : "1px solid transparent",
            borderBottom: "none", marginBottom: -1,
          }}>My Tests</button>

          {/* Community filters */}
          {!isMine && (
            <>
              {SUBJECTS.map(s => (
                <button key={s} type="button" onClick={() => setSubjectTab(s)} style={{
                  padding: "6px 14px", borderRadius: "8px 8px 0 0",
                  fontSize: 12, fontWeight: 600, cursor: "pointer",
                  background: subjectTab === s ? "var(--c-subtle)" : "transparent",
                  color: subjectTab === s ? "var(--c-text)" : "var(--c-text-3)",
                  border: "1px solid transparent",
                  borderBottom: "none", marginBottom: -1,
                }}>{s}</button>
              ))}
              <div style={{ marginLeft: "auto", display: "flex", gap: 4, alignSelf: "center", paddingBottom: 4 }}>
                {(["all","taken","not-taken"] as const).map(v => (
                  <button key={v} type="button" onClick={() => setTakenFilter(v)} style={{
                    padding: "4px 10px", borderRadius: 20, fontSize: 11, fontWeight: 600, cursor: "pointer",
                    background: takenFilter === v ? "var(--c-text)" : "transparent",
                    color: takenFilter === v ? "var(--c-bg)" : "var(--c-text-3)",
                    border: "1px solid var(--c-border)",
                  }}>
                    {v === "all" ? "All" : v === "taken" ? "Done by me" : "Not yet"}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {filtered.length === 0 ? (
          <div style={{ textAlign: "center", padding: "80px 20px" }}>
            <img src="/jeelo-reading.png" alt="Jeelo"
              style={{ width: 100, height: 100, objectFit: "contain", marginBottom: 16 }}
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
            <p style={{ fontSize: 15, fontWeight: 600, color: "var(--c-text)", marginBottom: 6 }}>
              {isMine ? "No tests yet." : "No tests here yet."}
            </p>
            <p style={{ fontSize: 13, color: "var(--c-text-3)", marginBottom: 20 }}>
              {isMine ? "Create your first test — it only takes a minute." : "Be the first to publish one. Jeelo is waiting."}
            </p>
            <Link to="/tests/generate" className="btn btn-primary" style={{ textDecoration: "none", marginRight: 8 }}>
              Grand Layer
            </Link>
            <button type="button" className="btn btn-primary" onClick={() => setShowCreate(true)}>
              + New test
            </button>
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 16 }}>
            {filtered.map((t: any) => (
              <div key={t.id} style={{
                background: "var(--c-surface)",
                border: "1px solid var(--c-border)",
                borderRadius: 14, overflow: "hidden",
                display: "flex", flexDirection: "column",
              }}>
                {/* Card header */}
                <div style={{ padding: "16px 16px 12px" }}>
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 8 }}>
                    <div style={{ flex: 1 }}>
                      <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: "var(--c-text)", lineHeight: 1.3 }}>
                        {t.title}
                      </h3>
                      {!isMine && (
                        <p style={{ margin: "3px 0 0", fontSize: 12, color: "var(--c-text-3)" }}>
                          by{" "}
                          {t.creator_username
                            ? <Link to={`/u/${t.creator_username}`} style={{ color: "var(--c-text-2)", textDecoration: "none", fontWeight: 500 }}>
                                {t.creator_name}
                              </Link>
                            : t.creator_name}
                        </p>
                      )}
                    </div>
                    <div style={{ display: "flex", gap: 4, flexShrink: 0, alignItems: "center" }}>
                      {isMine && !t.is_published && (
                        <span style={{
                          fontSize: 9, fontWeight: 700, textTransform: "uppercase",
                          letterSpacing: "0.08em", color: "var(--c-text-3)",
                          background: "var(--c-subtle)", border: "1px solid var(--c-border)",
                          padding: "2px 6px", borderRadius: 4,
                        }}>Draft</span>
                      )}
                      {t.is_layered && (
                        <span style={{
                          fontSize: 9, fontWeight: 700, textTransform: "uppercase",
                          letterSpacing: "0.08em", color: "var(--c-brand-600)",
                          background: "var(--c-brand-50)", border: "1px solid var(--c-brand-100)",
                          padding: "2px 6px", borderRadius: 4,
                        }}>Layered</span>
                      )}
                    </div>
                  </div>

                  <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 11, color: "var(--c-text-3)" }}>
                      {t.question_count}Q · {t.duration_mins}m
                    </span>
                    {t.subjects.map((s: string) => (
                      <span key={s} style={{
                        fontSize: 10, fontWeight: 600, textTransform: "capitalize",
                        color: "var(--c-text-3)", background: "var(--c-bg)",
                        border: "1px solid var(--c-border)", padding: "1px 6px", borderRadius: 4,
                      }}>{s}</span>
                    ))}
                  </div>
                </div>

                {/* Stats bar */}
                <div style={{
                  padding: "8px 16px", marginTop: "auto",
                  borderTop: "1px solid var(--c-border)",
                  background: "var(--c-bg)",
                  display: "flex", alignItems: "center", gap: 14,
                }}>
                  <span style={{ fontSize: 11, color: "var(--c-text-3)" }}>
                    {t.attempt_count} attempt{t.attempt_count !== 1 ? "s" : ""}
                  </span>
                  <span style={{ fontSize: 11, color: "var(--c-text-3)" }}>
                    {t.solid_count} solid{t.solid_count !== 1 ? "s" : ""}
                  </span>
                  <div style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center" }}>
                    {isMine && <TestCardMenu test={t} />}
                    <Link to={`/tests/${t.id}/preview`} style={{
                      display: "inline-flex", alignItems: "center", gap: 5,
                      padding: "5px 12px", borderRadius: 7,
                      background: "var(--c-brand-500)", color: "#fff",
                      fontSize: 11, fontWeight: 700, textDecoration: "none",
                    }}>
                      <IconPlay size={10} /> Take
                    </Link>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
      {showCreate && <NewTestModal onClose={() => setShowCreate(false)} />}
    </div>
  );
}
