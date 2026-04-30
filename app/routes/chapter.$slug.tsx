import { data, useFetcher, Link } from "react-router";
import type { Route } from "./+types/chapter.$slug";
import { requireUser } from "~/lib/auth.server";
import { createServerClient } from "~/lib/supabase.server";
import { Sidebar } from "~/components/sidebar";
import { IconPlay, IconChevronRight } from "~/components/icons";

const LAYERS = [
  { key: "theory_done",        label: "Theory",            color: "#7c9ef0" },
  { key: "own_questions_done", label: "Your Questions",    color: "#e0a84a" },
  { key: "curated_done",       label: "Curated Questions", color: "#d97e60" },
  { key: "practice_done",      label: "Practice Test",     color: "#b87ab8" },
  { key: "mastered",           label: "Layered Test",      color: "#4cbb7a" },
] as const;

export async function loader({ params, request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const user = await requireUser(request, env);
  const supabase = createServerClient(env);

  const { data: chapter } = await supabase
    .from("chapters")
    .select("id, name, slug, subjects(name, slug)")
    .eq("slug", params.slug)
    .single();

  if (!chapter) throw new Response("Not found", { status: 404 });

  const [progressRes, questionsRes, feedAnswersRes] = await Promise.all([
    supabase.from("chapter_progress")
      .select("*")
      .eq("user_id", user.id)
      .eq("chapter_id", chapter.id)
      .maybeSingle(),
    supabase.from("questions")
      .select("id, image_url, question_type, correct_answer, owner_id, users!owner_id(display_name, username), solids(count), feed_answers!question_id(count)")
      .eq("chapter_id", chapter.id)
      .limit(40),
    supabase.from("feed_answers")
      .select("question_id, is_correct")
      .eq("user_id", user.id),
  ]);

  const myAnswerMap = new Map(
    (feedAnswersRes.data ?? []).map((a: any) => [a.question_id, a.is_correct])
  );

  const questions = (questionsRes.data ?? []).map((q: any) => ({
    id: q.id,
    image_url: q.image_url,
    question_type: q.question_type,
    correct_answer: q.correct_answer,
    owner_name: q.users?.display_name ?? "Unknown",
    owner_username: q.users?.username ?? null,
    solid_count: q.solids?.[0]?.count ?? 0,
    answer_count: q.feed_answers?.[0]?.count ?? 0,
    my_correct: myAnswerMap.has(q.id) ? myAnswerMap.get(q.id) : null,
  }));

  const answered  = questions.filter((q) => q.my_correct !== null).length;
  const correct   = questions.filter((q) => q.my_correct === true).length;
  const accuracy  = answered > 0 ? Math.round((correct / answered) * 100) : null;

  return data({ user, chapter, progress: progressRes.data, questions, answered, correct, accuracy });
}

export async function action({ request, context }: Route.ActionArgs) {
  const env = context.cloudflare.env;
  const user = await requireUser(request, env);
  const supabase = createServerClient(env);
  const formData = await request.formData();

  if (formData.get("intent") === "toggle_theory") {
    const chapterId = String(formData.get("chapter_id"));
    const current   = formData.get("current") === "true";
    await supabase.from("chapter_progress").upsert({
      user_id: user.id, chapter_id: chapterId,
      theory_done: !current,
      theory_done_at: !current ? new Date().toISOString() : null,
      last_activity: new Date().toISOString(),
    }, { onConflict: "user_id,chapter_id" });
    return data({ ok: true });
  }

  return data({ ok: false });
}

export default function ChapterPage({ loaderData }: Route.ComponentProps) {
  const { user, chapter, progress, questions, answered, correct, accuracy } = loaderData;
  const fetcher = useFetcher();
  const ch = chapter as any;

  const layersDone = LAYERS.filter((l) => (progress as any)?.[l.key]).length;
  const isGap = progress?.theory_done && !progress?.own_questions_done && !progress?.curated_done;

  return (
    <div className="app-layout">
      <Sidebar displayName={user.display_name} username={(user as any).username} />

      <main className="app-main" style={{ padding: "28px 32px", maxWidth: 800, margin: "0 auto" }}>

        {/* Header */}
        <div style={{ marginBottom: 28, paddingBottom: 24, borderBottom: "1px solid var(--c-border)" }}>
          <div style={{ fontSize: 11, color: "var(--c-text-3)", marginBottom: 6 }}>
            <Link to="/map" style={{ color: "inherit", textDecoration: "none" }}>Map</Link>
            {" → "}
            {ch.subjects?.name}
          </div>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: "var(--c-text)", margin: "0 0 12px", letterSpacing: "-0.03em" }}>
            {ch.name}
          </h1>

          {/* Progress bar */}
          <div style={{ height: 5, background: "var(--c-border)", borderRadius: 3, overflow: "hidden", marginBottom: 8, maxWidth: 320 }}>
            <div style={{
              height: "100%", width: `${(layersDone / 5) * 100}%`,
              background: layersDone === 5 ? "#4cbb7a" : "var(--c-brand-500)",
              borderRadius: 3, transition: "width 0.4s ease",
            }} />
          </div>
          <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ fontSize: 12, color: "var(--c-text-3)" }}>{layersDone}/5 layers</span>
            {accuracy !== null && (
              <span style={{ fontSize: 12, color: "var(--c-text-3)" }}>
                {correct}/{answered} correct ({accuracy}%)
              </span>
            )}
            {isGap && (
              <span style={{
                fontSize: 11, fontWeight: 600,
                color: "rgba(180,120,20,1)", background: "rgba(224,168,74,0.12)",
                border: "1px solid rgba(224,168,74,0.3)",
                padding: "2px 8px", borderRadius: 20,
              }}>
                ⚠ Gap map
              </span>
            )}
          </div>
        </div>

        {/* Layer checklist */}
        <div style={{ marginBottom: 28 }}>
          <h2 style={{ fontSize: 14, fontWeight: 700, color: "var(--c-text)", margin: "0 0 12px" }}>Layers</h2>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {LAYERS.map((layer, i) => {
              const isDone = (progress as any)?.[layer.key] ?? false;
              const isNext = !isDone && LAYERS.slice(0, i).every((l) => (progress as any)?.[l.key]);
              return (
                <div key={layer.key} style={{
                  display: "flex", alignItems: "center", gap: 8,
                  padding: "8px 12px", borderRadius: 8,
                  background: isDone ? "rgba(76,187,122,0.06)" : isNext ? "var(--c-brand-50)" : "var(--c-bg)",
                  border: `1px solid ${isDone ? "rgba(76,187,122,0.2)" : isNext ? "var(--c-brand-100)" : "var(--c-border)"}`,
                  opacity: (!isDone && !isNext) ? 0.55 : 1,
                }}>
                  <div style={{
                    width: 20, height: 20, borderRadius: "50%",
                    background: isDone ? layer.color : "transparent",
                    border: isDone ? "none" : `1.5px ${isNext ? "solid" : "dashed"} ${layer.color}`,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 10, fontWeight: 700, color: isDone ? "#fff" : layer.color, flexShrink: 0,
                  }}>
                    {isDone ? "✓" : i + 1}
                  </div>
                  <span style={{ fontSize: 12, fontWeight: 600, color: "var(--c-text-2)", whiteSpace: "nowrap" }}>
                    {layer.label}
                  </span>
                  {layer.key === "theory_done" && (
                    <fetcher.Form method="post" style={{ margin: 0 }}>
                      <input type="hidden" name="intent" value="toggle_theory" />
                      <input type="hidden" name="chapter_id" value={ch.id} />
                      <input type="hidden" name="current" value={isDone ? "true" : "false"} />
                      <button type="submit" style={{
                        padding: "2px 8px", borderRadius: 4, fontSize: 10, fontWeight: 600,
                        background: isDone ? "transparent" : "var(--c-brand-500)",
                        color: isDone ? "var(--c-text-3)" : "#fff",
                        border: isDone ? "1px solid var(--c-border)" : "none",
                        cursor: "pointer", marginLeft: 4,
                      }}>
                        {isDone ? "Undo" : "Done"}
                      </button>
                    </fetcher.Form>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* CTA */}
        <div style={{ display: "flex", gap: 10, marginBottom: 32, flexWrap: "wrap" }}>
          <Link to={`/feed?chapter=${ch.slug}`} style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            padding: "9px 18px", borderRadius: 8,
            background: "var(--c-brand-500)", color: "#fff",
            fontSize: 13, fontWeight: 600, textDecoration: "none",
          }}>
            <IconPlay size={12} /> Go to Feed
          </Link>
          <Link to="/tests/generate" style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            padding: "9px 18px", borderRadius: 8,
            background: "transparent", color: "var(--c-text-2)",
            fontSize: 13, fontWeight: 600, textDecoration: "none",
            border: "1px solid var(--c-border)",
          }}>
            Take a Test
          </Link>
        </div>

        {/* Questions in chapter */}
        <div>
          <h2 style={{ fontSize: 14, fontWeight: 700, color: "var(--c-text)", margin: "0 0 14px" }}>
            Questions · {questions.length}
          </h2>
          {questions.length === 0 ? (
            <div style={{ textAlign: "center", padding: "40px 0" }}>
              <img src="/jeelo-pointing.png" alt="Jeelo"
                style={{ width: 80, height: 80, objectFit: "contain", marginBottom: 12 }}
                onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
              <p style={{ fontSize: 13, color: "var(--c-text-3)" }}>
                No questions tagged to this chapter yet.
              </p>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {questions.map((q: any) => (
                <Link key={q.id} to={`/q/${q.id}`} style={{
                  display: "flex", alignItems: "center", gap: 12,
                  padding: "12px 14px", borderRadius: 10,
                  background: "var(--c-surface)", border: "1px solid var(--c-border)",
                  textDecoration: "none",
                }}>
                  {/* Status dot */}
                  <div style={{
                    width: 8, height: 8, borderRadius: "50%", flexShrink: 0,
                    background: q.my_correct === true ? "#4cbb7a"
                      : q.my_correct === false ? "#d04040"
                      : "var(--c-border-strong)",
                  }} />
                  {/* Thumbnail */}
                  {q.image_url && (
                    <img src={q.image_url} alt=""
                      style={{ width: 48, height: 36, objectFit: "cover", borderRadius: 5, flexShrink: 0, border: "1px solid var(--c-border)" }} />
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, color: "var(--c-text-2)", fontWeight: 500, display: "flex", gap: 8 }}>
                      <span style={{
                        fontSize: 10, fontWeight: 700, textTransform: "uppercase",
                        color: "var(--c-text-3)", border: "1px solid var(--c-border)",
                        padding: "0px 5px", borderRadius: 3,
                      }}>{q.question_type}</span>
                      {q.owner_username
                        ? <span style={{ color: "var(--c-text-3)" }}>by {q.owner_name}</span>
                        : <span style={{ color: "var(--c-text-3)" }}>by {q.owner_name}</span>}
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
                    <span style={{ fontSize: 11, color: "var(--c-text-3)" }}>
                      {q.answer_count} attempts · {q.solid_count} solid
                    </span>
                    <IconChevronRight size={13} />
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
