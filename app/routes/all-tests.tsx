import { Link, useSearchParams } from "react-router";
import type { Route } from "./+types/all-tests";
import { requireUser } from "~/lib/auth.server";
import { createServerClient } from "~/lib/supabase.server";
import { Sidebar } from "~/components/sidebar";
import { IconPlay, IconDiscover, IconFlash } from "~/components/icons";

type PublicTest = {
  id: string; title: string; description: string | null;
  duration_mins: number; created_at: string; creator: string;
  section_count: number; question_count: number;
  subjects: string[];
  attempted: boolean; submitted: boolean;
  score_total: number | null; score_max: number | null;
  attempt_count: number;
};

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const user = await requireUser(request, env);
  const supabase = createServerClient(env);

  const { data: raw } = await supabase
    .from("tests")
    .select(`id, title, description, duration_mins, created_at,
      users!owner_id(display_name),
      test_sections(id, subject, test_questions(question_id))`)
    .eq("is_published", true)
    .eq("visibility", "public")
    .order("created_at", { ascending: false });

  // Attempt counts for trending (all attempts, not just mine)
  const { data: allAttempts } = await supabase
    .from("attempts")
    .select("test_id, submitted_at");

  const attemptCountMap = new Map<string, number>();
  for (const a of allAttempts ?? []) {
    if (a.submitted_at) {
      attemptCountMap.set(a.test_id, (attemptCountMap.get(a.test_id) ?? 0) + 1);
    }
  }

  // My attempts
  const { data: myAttempts } = await supabase
    .from("attempts")
    .select("test_id, submitted_at, score_breakdown")
    .eq("student_id", user.id);

  const myMap = new Map<string, { submitted: boolean; scoreTotal: number | null; scoreMax: number | null }>();
  for (const a of myAttempts ?? []) {
    const sb = a.score_breakdown as any;
    myMap.set(a.test_id, {
      submitted: !!a.submitted_at,
      scoreTotal: sb?.total ?? null,
      scoreMax:   sb?.max_marks ?? null,
    });
  }

  const tests: PublicTest[] = (raw ?? []).map((t: any) => {
    const sections: any[] = t.test_sections ?? [];
    const questionCount = sections.reduce((sum: number, s: any) => sum + ((s.test_questions as any[])?.length ?? 0), 0);
    const subjectSet = new Set<string>(sections.map((s: any) => s.subject).filter(Boolean));
    const att = myMap.get(t.id);
    return {
      id: t.id, title: t.title, description: t.description ?? null,
      duration_mins: t.duration_mins, created_at: t.created_at,
      creator: (t.users as any)?.display_name ?? "Unknown",
      section_count: sections.length, question_count: questionCount,
      subjects: Array.from(subjectSet),
      attempted:   !!att,
      submitted:   att?.submitted ?? false,
      score_total: att?.scoreTotal ?? null,
      score_max:   att?.scoreMax   ?? null,
      attempt_count: attemptCountMap.get(t.id) ?? 0,
    };
  });

  // Sort by attempt_count desc (trending), then by created_at desc as tiebreaker
  tests.sort((a, b) => b.attempt_count - a.attempt_count || new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  return { user, tests };
}

const SUBJECT_TABS = [
  { label: "All",         value: null },
  { label: "Physics",     value: "physics" },
  { label: "Chemistry",   value: "chemistry" },
  { label: "Mathematics", value: "mathematics" },
];

function ScoreBadge({ total, max }: { total: number; max: number }) {
  const pct = max > 0 ? Math.round((total / max) * 100) : 0;
  const color = pct >= 70 ? "var(--c-success)" : pct >= 40 ? "var(--c-brand-500)" : "var(--c-error)";
  return (
    <span style={{ fontSize: 11, fontWeight: 700, color, background: "var(--c-surface-2)", padding: "2px 8px", borderRadius: 20 }}>
      {total}/{max} · {pct}%
    </span>
  );
}

function DiscoverCard({ test: t, rank }: { test: PublicTest; rank: number }) {
  const hrs = Math.floor(t.duration_mins / 60);
  const mins = t.duration_mins % 60;
  const durationStr = hrs > 0 ? `${hrs}h${mins > 0 ? ` ${mins}m` : ""}`.trim() : `${mins}m`;
  const isTrending = rank <= 3 && t.attempt_count > 0;

  return (
    <div className="list-row" style={{ flexDirection: "column", alignItems: "stretch", padding: 0, gap: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 16px" }}>
        <div className="list-row-left" style={{ flex: 1, minWidth: 0 }}>
          <div className="list-row-icon">
            <IconPlay size={13} />
          </div>
          <div className="list-row-text">
            <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
              {isTrending && (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 10, fontWeight: 700, color: "#b45309", background: "#fef3c7", padding: "1px 6px", borderRadius: 10 }}>
                  <IconFlash size={9} /> Trending
                </span>
              )}
              <span className="list-row-title">{t.title}</span>
            </div>
            {t.description && (
              <span style={{ fontSize: 12, color: "var(--c-text-3)", display: "block", marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 480 }}>
                {t.description}
              </span>
            )}
            <span className="list-row-meta">
              {durationStr} · {t.question_count}Q · by {t.creator}
              {t.attempt_count > 0 && ` · ${t.attempt_count} attempt${t.attempt_count !== 1 ? "s" : ""}`}
            </span>
          </div>
        </div>
        <div className="list-row-right">
          {t.submitted && t.score_total !== null && t.score_max !== null && (
            <ScoreBadge total={t.score_total} max={t.score_max} />
          )}
          {t.submitted ? (
            <span className="list-status-badge published">Done</span>
          ) : t.attempted ? (
            <span className="list-status-badge draft">In progress</span>
          ) : null}
          {/* Show "View Result" for completed tests, never "Take test" again */}
          {t.submitted ? (
            <Link to={`/tests/${t.id}/result`} className="btn btn-ghost btn-sm">View Result</Link>
          ) : (
            <Link to={`/tests/${t.id}/preview`} className="btn btn-primary btn-sm">
              <IconPlay size={12} />
              {t.attempted ? "Resume" : "Take test"}
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

export default function DiscoverPage({ loaderData }: Route.ComponentProps) {
  const { user, tests } = loaderData as any;
  const [searchParams, setSearchParams] = useSearchParams();
  const activeSubject = searchParams.get("subject") ?? null;

  const filtered = activeSubject
    ? tests.filter((t: PublicTest) => t.subjects.includes(activeSubject))
    : tests;

  const unattempted = filtered.filter((t: PublicTest) => !t.submitted);
  const attempted   = filtered.filter((t: PublicTest) => t.submitted);

  function setSubject(val: string | null) {
    if (val) setSearchParams({ subject: val });
    else setSearchParams({});
  }

  return (
    <div className="app-layout">
      <Sidebar displayName={user.display_name} />
      <main className="app-main">
        <div className="pg-head">
          <div>
            <h1 className="pg-title">Discover</h1>
            <p className="pg-subtitle">
              {tests.length === 0
                ? "Published tests from the community"
                : `${tests.length} published test${tests.length !== 1 ? "s" : ""} · sorted by trending`}
            </p>
          </div>
        </div>

        {/* Subject filter tabs — .subject-tabs-row matches pg-head/pg-body padding */}
        <div className="subject-tabs-row" style={{ marginTop: 24 }}>
          {SUBJECT_TABS.map(tab => (
            <button
              key={tab.label}
              type="button"
              onClick={() => setSubject(tab.value)}
              style={{
                padding: "6px 16px",
                borderRadius: 20,
                border: `1.5px solid ${activeSubject === tab.value ? "var(--c-brand-500)" : "var(--c-border)"}`,
                background: activeSubject === tab.value ? "var(--c-brand-500)" : "var(--c-surface)",
                color: activeSubject === tab.value ? "#fff" : "var(--c-text-2)",
                fontSize: 13,
                fontWeight: activeSubject === tab.value ? 600 : 400,
                cursor: "pointer",
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="pg-body">
          {tests.length === 0 ? (
            <div className="lib-empty">
              <div className="lib-empty-icon" style={{ color: "var(--c-brand-400)" }}>
                <IconDiscover size={32} />
              </div>
              <p className="lib-empty-title">Nothing here yet</p>
              <p className="lib-empty-body">Publish a test from your Tests page to share it with everyone.</p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="lib-empty" style={{ padding: "40px 0" }}>
              <p className="lib-empty-title">No tests for this subject</p>
              <p className="lib-empty-body">Try a different tab or check back later.</p>
            </div>
          ) : (
            <>
              {unattempted.length > 0 && (
                <section style={{ marginBottom: attempted.length > 0 ? 28 : 0 }}>
                  {attempted.length > 0 && (
                    <h2 className="tests-section-title" style={{ marginBottom: 10, marginTop: 0 }}>Unattempted</h2>
                  )}
                  <div className="list-view">
                    {unattempted.map((t: PublicTest, i: number) => <DiscoverCard key={t.id} test={t} rank={i + 1} />)}
                  </div>
                </section>
              )}
              {attempted.length > 0 && (
                <section>
                  <h2 className="tests-section-title" style={{ marginBottom: 10 }}>Attempted</h2>
                  <div className="list-view">
                    {attempted.map((t: PublicTest, i: number) => <DiscoverCard key={t.id} test={t} rank={unattempted.length + i + 1} />)}
                  </div>
                </section>
              )}
            </>
          )}
        </div>
      </main>
    </div>
  );
}
