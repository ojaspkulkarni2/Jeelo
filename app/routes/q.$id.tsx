import { data, useFetcher, Link } from "react-router";
import { useState } from "react";
import type { Route } from "./+types/q.$id";
import { requireUser } from "~/lib/auth.server";
import { createServerClient } from "~/lib/supabase.server";
import { Sidebar } from "~/components/sidebar";

export async function loader({ params, request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const user = await requireUser(request, env);
  const supabase = createServerClient(env);

  const { data: question } = await supabase
    .from("questions")
    .select("id, image_url, type, correct_answer, owner_id, chapter, subject, is_shared, users!owner_id(display_name, username)")
    .eq("id", params.id)
    .single();

  if (!question) throw new Response("Not found", { status: 404 });

  const [solidCountRes, allAnswersRes, myAnswerRes, commentsRes, myExistingSolidRes] = await Promise.all([
    supabase.from("solids").select("user_id", { count: "exact" }).eq("question_id", params.id),
    supabase.from("feed_answers").select("is_correct").eq("question_id", params.id),
    supabase.from("feed_answers").select("answer, is_correct")
      .eq("user_id", user.id).eq("question_id", params.id).maybeSingle(),
    supabase.from("comments").select("id, body, created_at, author_id, parent_id, users!author_id(display_name, username)")
      .eq("question_id", params.id)
      .order("created_at", { ascending: true }),
    supabase.from("solids").select("user_id")
      .eq("user_id", user.id).eq("question_id", params.id).maybeSingle(),
  ]);

  const total = allAnswersRes.data?.length ?? 0;
  const correct = allAnswersRes.data?.filter((a: any) => a.is_correct).length ?? 0;
  const pctCorrect = total > 0 ? Math.round((correct / total) * 100) : null;

  return data({
    user,
    question,
    solidCount: solidCountRes.count ?? 0,
    hasSolid: !!myExistingSolidRes.data,
    pctCorrect,
    totalAnswers: total,
    myAnswer: myAnswerRes.data,
    comments: commentsRes.data ?? [],
  });
}

export async function action({ params, request, context }: Route.ActionArgs) {
  const env = context.cloudflare.env;
  const user = await requireUser(request, env);
  const supabase = createServerClient(env);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "answer") {
    const answer        = String(formData.get("answer"));
    const correctAnswer = String(formData.get("correct_answer"));
    const ownerId       = String(formData.get("owner_id"));
    // Compare normalised: strip brackets/quotes for array answers like ["A"]
    const normalise = (v: string) => {
      try { const p = JSON.parse(v); return Array.isArray(p) ? p[0] : String(p); } catch { return v; }
    };
    const isCorrect = normalise(answer).toUpperCase().trim() === normalise(correctAnswer).toUpperCase().trim();

    await supabase.from("feed_answers").upsert({
      user_id: user.id, question_id: params.id,
      answer: JSON.stringify(answer), is_correct: isCorrect,
      answered_at: new Date().toISOString(),
    }, { onConflict: "user_id,question_id" });

    return data({ ok: true, isCorrect });
  }

  if (intent === "solid") {
    const hasSolid = formData.get("has_solid") === "true";
    if (hasSolid) {
      await supabase.from("solids").delete().eq("user_id", user.id).eq("question_id", params.id);
    } else {
      await supabase.from("solids").insert({ user_id: user.id, question_id: params.id });
    }
    return data({ ok: true });
  }

  if (intent === "comment") {
    const body     = String(formData.get("body") ?? "").trim();
    const parentId = formData.get("parent_id") as string | null;
    if (!body) return data({ ok: false });
    await supabase.from("comments").insert({
      author_id: user.id, question_id: params.id,
      body, parent_id: parentId || null,
    });
    return data({ ok: true });
  }

  return data({ ok: false });
}

// ── Component ─────────────────────────────────────────────────

export default function QuestionPage({ loaderData }: Route.ComponentProps) {
  const { user, question, solidCount, hasSolid, pctCorrect, totalAnswers, myAnswer, comments } = loaderData;
  const q = question as any;
  const fetcher = useFetcher();

  const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null);
  const [localSolid, setLocalSolid]         = useState(hasSolid);
  const [localSolidCount, setLocalSolidCount] = useState(solidCount);
  const [commentBody, setCommentBody]       = useState("");
  const [replyingTo, setReplyingTo]         = useState<string | null>(null);

  const answered   = myAnswer !== null;
  const isCorrect  = myAnswer?.is_correct ?? null;
  const isScq      = q.type === "scq";
  const isInteger  = q.type === "integer" || q.type === "numerical";

  function handleAnswer(answer: string) {
    const fd = new FormData();
    fd.set("intent",         "answer");
    fd.set("answer",         answer);
    fd.set("correct_answer", Array.isArray(q.correct_answer) ? q.correct_answer[0] : String(q.correct_answer));
    fd.set("owner_id",       q.owner_id);
    fetcher.submit(fd, { method: "post" });
    setSelectedAnswer(answer);
  }

  function handleSolid() {
    const fd = new FormData();
    fd.set("intent",    "solid");
    fd.set("has_solid", localSolid ? "true" : "false");
    fetcher.submit(fd, { method: "post" });
    setLocalSolid((s) => !s);
    setLocalSolidCount((n) => localSolid ? n - 1 : n + 1);
  }

  function handleComment(e: React.FormEvent) {
    e.preventDefault();
    if (!commentBody.trim()) return;
    const fd = new FormData();
    fd.set("intent",    "comment");
    fd.set("body",      commentBody);
    if (replyingTo) fd.set("parent_id", replyingTo);
    fetcher.submit(fd, { method: "post" });
    setCommentBody("");
    setReplyingTo(null);
  }

  // Derive answered state from optimistic fetcher
  const optimisticAnswered  = answered || (fetcher.formData?.get("intent") === "answer");
  const optimisticCorrect   = optimisticAnswered
    ? (fetcher.data as any)?.isCorrect ?? isCorrect
    : null;
  const displayAnswer       = selectedAnswer ?? (myAnswer?.answer ? JSON.parse(myAnswer.answer) : null);

  const topLevelComments = (comments as any[]).filter((c) => !c.parent_id);
  const replies = (id: string) => (comments as any[]).filter((c) => c.parent_id === id);

  return (
    <div className="app-layout">
      <Sidebar displayName={user.display_name} username={(user as any).username} />

      <main className="app-main" style={{ padding: "28px 32px", maxWidth: 720, margin: "0 auto" }}>

        {/* Breadcrumb */}
        <div style={{ fontSize: 12, color: "var(--c-text-3)", marginBottom: 16, display: "flex", gap: 6, alignItems: "center" }}>
          <Link to="/feed" style={{ color: "inherit", textDecoration: "none" }}>Feed</Link>
          {q.chapter && (
            <>
              <span>→</span>
              <span style={{ color: "var(--c-brand-600)", fontWeight: 600 }}>{q.chapter}</span>
            </>
          )}
        </div>

        {/* Question image */}
        {q.image_url && (
          <img src={q.image_url} alt="Question" style={{
            width: "100%", borderRadius: 12,
            border: "1px solid var(--c-border)",
            marginBottom: 20, display: "block",
          }} />
        )}

        {/* Stats bar */}
        <div style={{
          display: "flex", gap: 24, padding: "14px 18px", marginBottom: 20,
          background: "var(--c-surface)", border: "1px solid var(--c-border)", borderRadius: 12,
        }}>
          <div>
            <div style={{ fontSize: 20, fontWeight: 800, color: "var(--c-text)" }}>
              {pctCorrect !== null ? `${pctCorrect}%` : "—"}
            </div>
            <div style={{ fontSize: 11, color: "var(--c-text-3)" }}>got it right</div>
          </div>
          <div>
            <div style={{ fontSize: 20, fontWeight: 800, color: "var(--c-text)" }}>{totalAnswers}</div>
            <div style={{ fontSize: 11, color: "var(--c-text-3)" }}>attempts</div>
          </div>
          <div>
            <div style={{ fontSize: 20, fontWeight: 800, color: "var(--c-text)" }}>{localSolidCount}</div>
            <div style={{ fontSize: 11, color: "var(--c-text-3)" }}>solids</div>
          </div>
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 11, color: "var(--c-text-3)" }}>
              by{" "}
              {q.users?.username
                ? <Link to={`/u/${q.users.username}`} style={{ color: "var(--c-text-2)", fontWeight: 600, textDecoration: "none" }}>
                    {q.users.display_name}
                  </Link>
                : q.users?.display_name ?? "Unknown"}
            </span>
          </div>
        </div>

        {/* Answer panel */}
        <div style={{
          background: "var(--c-surface)", border: "1px solid var(--c-border)",
          borderRadius: 12, padding: 18, marginBottom: 20,
        }}>
          <h3 style={{ fontSize: 13, fontWeight: 700, color: "var(--c-text)", margin: "0 0 14px" }}>
            {optimisticAnswered ? "Your answer" : "Answer this question"}
          </h3>

          {!optimisticAnswered ? (
            <>
              {isScq && (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
                  {["A", "B", "C", "D"].map((opt) => (
                    <button key={opt} type="button" onClick={() => setSelectedAnswer(opt)} style={{
                      padding: "10px", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer",
                      border: `1.5px solid ${selectedAnswer === opt ? "var(--c-brand-500)" : "var(--c-border)"}`,
                      background: selectedAnswer === opt ? "var(--c-brand-50)" : "transparent",
                      color: selectedAnswer === opt ? "var(--c-brand-600)" : "var(--c-text-2)",
                    }}>{opt}</button>
                  ))}
                </div>
              )}
              {isInteger && (
                <input type="number" placeholder="Enter your answer" className="input"
                  style={{ marginBottom: 12 }}
                  onChange={(e) => setSelectedAnswer(e.target.value)}
                  value={selectedAnswer ?? ""} />
              )}
              <button type="button" disabled={!selectedAnswer}
                onClick={() => selectedAnswer && handleAnswer(selectedAnswer)}
                style={{
                  width: "100%", padding: "10px", borderRadius: 8,
                  background: selectedAnswer ? "var(--c-brand-500)" : "var(--c-border)",
                  color: selectedAnswer ? "#fff" : "var(--c-text-3)",
                  fontSize: 13, fontWeight: 700, border: "none",
                  cursor: selectedAnswer ? "pointer" : "not-allowed",
                }}>
                Submit
              </button>
            </>
          ) : (
            <div style={{
              padding: "12px 14px", borderRadius: 10,
              background: optimisticCorrect ? "rgba(76,187,122,0.08)" : "rgba(192,48,42,0.06)",
              border: `1px solid ${optimisticCorrect ? "rgba(76,187,122,0.25)" : "rgba(192,48,42,0.2)"}`,
              display: "flex", alignItems: "center", gap: 10,
            }}>
              <span style={{ fontSize: 20 }}>{optimisticCorrect ? "✓" : "✗"}</span>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: optimisticCorrect ? "#2d7a4f" : "var(--c-error)" }}>
                  {optimisticCorrect ? "Correct!" : `Incorrect — answer is ${Array.isArray(q.correct_answer) ? q.correct_answer[0] : q.correct_answer}`}
                </div>
                {pctCorrect !== null && (
                  <div style={{ fontSize: 11, color: "var(--c-text-3)", marginTop: 2 }}>
                    {pctCorrect}% of students got this right
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Solid button */}
        <button type="button" onClick={handleSolid} style={{
          padding: "7px 16px", borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: "pointer",
          background: localSolid ? "var(--c-brand-50)" : "transparent",
          color: localSolid ? "var(--c-brand-600)" : "var(--c-text-2)",
          border: `1px solid ${localSolid ? "var(--c-brand-200)" : "var(--c-border)"}`,
          marginBottom: 28, display: "inline-flex", alignItems: "center", gap: 6, transition: "all 0.15s",
        }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
            stroke={localSolid ? "var(--c-brand-600)" : "var(--c-text-3)"}
            strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M7 10v12"/><path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z"/>
          </svg>
          Solid{localSolidCount > 0 ? ` · ${localSolidCount}` : ""}
        </button>

        {/* Comments */}
        <div>
          <h3 style={{ fontSize: 14, fontWeight: 700, color: "var(--c-text)", margin: "0 0 16px" }}>
            Discussion · {comments.length}
          </h3>

          {topLevelComments.map((c: any) => (
            <div key={c.id} style={{ marginBottom: 16 }}>
              <div style={{
                padding: "12px 14px", borderRadius: 10,
                background: "var(--c-surface)", border: "1px solid var(--c-border)",
              }}>
                <div style={{ fontSize: 11, color: "var(--c-text-3)", marginBottom: 6 }}>
                  <strong style={{ color: "var(--c-text-2)" }}>{c.users?.display_name ?? "Unknown"}</strong>
                  {" · "}{new Date(c.created_at).toLocaleDateString()}
                </div>
                <p style={{ margin: 0, fontSize: 13, color: "var(--c-text)", lineHeight: 1.55 }}>{c.body}</p>
                <button type="button" onClick={() => setReplyingTo(c.id)} style={{
                  marginTop: 8, background: "none", border: "none", cursor: "pointer",
                  fontSize: 11, color: "var(--c-text-3)", padding: 0,
                }}>Reply</button>
              </div>
              {/* Replies */}
              {replies(c.id).map((r: any) => (
                <div key={r.id} style={{
                  marginTop: 6, marginLeft: 20,
                  padding: "10px 14px", borderRadius: 10,
                  background: "var(--c-bg)", border: "1px solid var(--c-border)",
                }}>
                  <div style={{ fontSize: 11, color: "var(--c-text-3)", marginBottom: 4 }}>
                    <strong style={{ color: "var(--c-text-2)" }}>{r.users?.display_name ?? "Unknown"}</strong>
                    {" · "}{new Date(r.created_at).toLocaleDateString()}
                  </div>
                  <p style={{ margin: 0, fontSize: 13, color: "var(--c-text)", lineHeight: 1.55 }}>{r.body}</p>
                </div>
              ))}
              {replyingTo === c.id && (
                <form onSubmit={handleComment} style={{ marginTop: 8, marginLeft: 20, display: "flex", gap: 8 }}>
                  <input className="input" placeholder="Write a reply…" value={commentBody}
                    onChange={(e) => setCommentBody(e.target.value)}
                    style={{ flex: 1, fontSize: 13 }} />
                  <button type="submit" className="btn btn-primary btn-sm">Reply</button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setReplyingTo(null)}>Cancel</button>
                </form>
              )}
            </div>
          ))}

          {/* New comment */}
          {replyingTo === null && (
            <form onSubmit={handleComment} style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <input className="input" placeholder="Add a comment…" value={commentBody}
                onChange={(e) => setCommentBody(e.target.value)}
                style={{ flex: 1, fontSize: 13 }} />
              <button type="submit" className="btn btn-primary btn-sm" disabled={!commentBody.trim()}>
                Post
              </button>
            </form>
          )}
        </div>
      </main>
    </div>
  );
}
