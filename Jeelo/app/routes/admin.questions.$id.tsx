import { redirect, Link } from "react-router";
import type { Route } from "./+types/admin.questions.$id";
import { requireAdmin } from "~/lib/auth.server";
import { createServerClient } from "~/lib/supabase.server";
import { deleteImage } from "~/lib/storage.server";
import { AdminNav } from "~/components/admin-nav";
import type { QuestionType, CorrectAnswer } from "~/lib/database.types";

// ── Loader ────────────────────────────────────────────────────

export async function loader({ params, request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const user = await requireAdmin(request, env);
  const supabase = createServerClient(env);

  const { data: question, error } = await supabase
    .from("questions")
    .select("*, paragraphs(id, title, image_url)")
    .eq("id", params.id!)
    .eq("owner_id", user.id)
    .single();

  if (error || !question) throw redirect("/admin/questions");

  return { user, question };
}

// ── Action (delete) ───────────────────────────────────────────

export async function action({ params, request, context }: Route.ActionArgs) {
  const env = context.cloudflare.env;
  const user = await requireAdmin(request, env);
  const supabase = createServerClient(env);

  const { data: q } = await supabase
    .from("questions")
    .select("image_url")
    .eq("id", params.id!)
    .eq("owner_id", user.id)
    .single();

  await supabase
    .from("questions")
    .delete()
    .eq("id", params.id!)
    .eq("owner_id", user.id);

  if (q?.image_url) await deleteImage(q.image_url, env);

  throw redirect("/admin/questions");
}

// ── Helpers ───────────────────────────────────────────────────

const SUBJECT_BADGE: Record<string, { label: string; color: string; bg: string }> = {
  physics:     { label: "Physics",     color: "#1e40af", bg: "#dbeafe" },
  chemistry:   { label: "Chemistry",   color: "#166534", bg: "#dcfce7" },
  mathematics: { label: "Mathematics", color: "#6b21a8", bg: "#f3e8ff" },
};

const TYPE_LABEL: Record<string, string> = {
  scq:       "Single Correct (SCQ)",
  mcq:       "Multi Correct (MCQ)",
  integer:   "Integer",
  numerical: "Numerical",
  paragraph: "Paragraph-based",
};

function formatAnswer(type: QuestionType, answer: CorrectAnswer): string {
  if (Array.isArray(answer)) return answer.join(", ");
  return String(answer);
}

// ── Component ─────────────────────────────────────────────────

export default function QuestionDetail({ loaderData }: Route.ComponentProps) {
  const { user, question } = loaderData;
  const badge = SUBJECT_BADGE[question.subject] ?? {
    label: question.subject,
    color: "#374151",
    bg: "#f3f4f6",
  };

  // The select query joins paragraphs — cast to access it
  const paragraph = (question as unknown as Record<string, unknown>).paragraphs as
    | { id: string; title: string | null; image_url: string }
    | null;

  return (
    <div style={{ fontFamily: "Arial, sans-serif", minHeight: "100vh", background: "#f9fafb" }}>
      <AdminNav displayName={user.display_name} />

      <div style={{ maxWidth: 820, margin: "0 auto", padding: "28px 24px" }}>
        {/* Breadcrumb */}
        <div style={{ marginBottom: 20 }}>
          <Link
            to="/admin/questions"
            style={{ color: "#6b7280", textDecoration: "none", fontSize: 13 }}
          >
            ← Back to Questions
          </Link>
        </div>

        <div
          style={{
            background: "#fff",
            borderRadius: 8,
            border: "1px solid #e5e7eb",
            overflow: "hidden",
          }}
        >
          {/* Full question image */}
          <div
            style={{
              background: "#f9fafb",
              borderBottom: "1px solid #e5e7eb",
              display: "flex",
              justifyContent: "center",
            }}
          >
            <img
              src={question.image_url}
              alt="Question"
              style={{ maxWidth: "100%", maxHeight: 520, objectFit: "contain", display: "block" }}
            />
          </div>

          <div style={{ padding: 24 }}>
            {/* Badges */}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 20 }}>
              <span
                style={{
                  background: badge.bg,
                  color: badge.color,
                  borderRadius: 4,
                  padding: "3px 8px",
                  fontSize: 12,
                  fontWeight: 500,
                }}
              >
                {badge.label}
              </span>
              <span
                style={{
                  background: "#f3f4f6",
                  color: "#374151",
                  borderRadius: 4,
                  padding: "3px 8px",
                  fontSize: 12,
                  fontWeight: 500,
                }}
              >
                {TYPE_LABEL[question.type] ?? question.type}
              </span>
              <span
                style={{
                  background: "#f3f4f6",
                  color: "#374151",
                  borderRadius: 4,
                  padding: "3px 8px",
                  fontSize: 12,
                }}
              >
                {question.chapter}
              </span>
            </div>

            {/* Metadata grid */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "120px 1fr",
                gap: "8px 16px",
                fontSize: 13,
                alignItems: "start",
                marginBottom: 20,
              }}
            >
              <span style={{ color: "#9ca3af", fontWeight: 500 }}>Correct answer</span>
              <span
                style={{
                  color: "#111827",
                  fontFamily: "monospace",
                  fontWeight: 700,
                  fontSize: 15,
                  letterSpacing: "0.05em",
                }}
              >
                {formatAnswer(question.type, question.correct_answer)}
              </span>

              <span style={{ color: "#9ca3af", fontWeight: 500 }}>Added</span>
              <span style={{ color: "#374151" }}>
                {new Date(question.created_at).toLocaleString("en-IN", {
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            </div>

            {/* Linked paragraph preview */}
            {paragraph && (
              <div
                style={{
                  marginBottom: 20,
                  padding: 14,
                  background: "#f9fafb",
                  borderRadius: 6,
                  border: "1px solid #e5e7eb",
                }}
              >
                <p
                  style={{
                    margin: "0 0 10px",
                    fontSize: 11,
                    fontWeight: 600,
                    color: "#6b7280",
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                  }}
                >
                  Linked Paragraph{paragraph.title ? ` — ${paragraph.title}` : ""}
                </p>
                <img
                  src={paragraph.image_url}
                  alt="Paragraph"
                  style={{ maxWidth: "100%", borderRadius: 4, border: "1px solid #e5e7eb" }}
                />
              </div>
            )}

            {/* Delete */}
            <div
              style={{ paddingTop: 20, borderTop: "1px solid #f3f4f6" }}
            >
              <form
                method="post"
                onSubmit={(e) => {
                  if (!confirm("Delete this question? This can't be undone."))
                    e.preventDefault();
                }}
              >
                <button
                  type="submit"
                  style={{
                    background: "#fef2f2",
                    color: "#dc2626",
                    border: "1px solid #fecaca",
                    borderRadius: 6,
                    padding: "8px 18px",
                    fontSize: 13,
                    cursor: "pointer",
                  }}
                >
                  Delete Question
                </button>
              </form>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
