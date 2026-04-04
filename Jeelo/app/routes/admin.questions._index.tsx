import { Link } from "react-router";
import type { Route } from "./+types/admin.questions._index";
import { requireAdmin } from "~/lib/auth.server";
import { createServerClient } from "~/lib/supabase.server";
import { deleteImage } from "~/lib/storage.server";
import { AdminNav } from "~/components/admin-nav";
import type { Subject, QuestionType, CorrectAnswer } from "~/lib/database.types";

// ── Loader ────────────────────────────────────────────────────

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const user = await requireAdmin(request, env);

  const url = new URL(request.url);
  const subject = (url.searchParams.get("subject") || null) as Subject | null;
  const type = (url.searchParams.get("type") || null) as QuestionType | null;

  const supabase = createServerClient(env);
  let query = supabase
    .from("questions")
    .select("id, image_url, type, subject, chapter, correct_answer, created_at")
    .eq("owner_id", user.id)
    .order("created_at", { ascending: false });

  if (subject) query = query.eq("subject", subject);
  if (type) query = query.eq("type", type);

  const { data: questions, error } = await query;
  if (error) throw new Error(error.message);

  return { user, questions: questions ?? [], filter: { subject, type } };
}

// ── Action (delete) ───────────────────────────────────────────

export async function action({ request, context }: Route.ActionArgs) {
  const env = context.cloudflare.env;
  const user = await requireAdmin(request, env);
  const formData = await request.formData();
  const id = String(formData.get("id") ?? "");

  const supabase = createServerClient(env);

  const { data: q } = await supabase
    .from("questions")
    .select("image_url")
    .eq("id", id)
    .eq("owner_id", user.id)
    .single();

  await supabase
    .from("questions")
    .delete()
    .eq("id", id)
    .eq("owner_id", user.id);

  if (q?.image_url) await deleteImage(q.image_url, env);

  return null;
}

// ── Helpers ───────────────────────────────────────────────────

const SUBJECT_BADGE: Record<string, { label: string; color: string; bg: string }> = {
  physics:     { label: "Physics",   color: "#1e40af", bg: "#dbeafe" },
  chemistry:   { label: "Chemistry", color: "#166534", bg: "#dcfce7" },
  mathematics: { label: "Maths",     color: "#6b21a8", bg: "#f3e8ff" },
};

const TYPE_LABEL: Record<string, string> = {
  scq:       "SCQ",
  mcq:       "MCQ",
  integer:   "Integer",
  numerical: "Numerical",
  paragraph: "Paragraph",
};

function formatAnswer(type: QuestionType, answer: CorrectAnswer): string {
  if (Array.isArray(answer)) return answer.join(", ");
  return String(answer);
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "2-digit",
  });
}

// ── Component ─────────────────────────────────────────────────

export default function QuestionBank({ loaderData }: Route.ComponentProps) {
  const { user, questions, filter } = loaderData;
  const hasFilter = filter.subject || filter.type;

  return (
    <div style={{ fontFamily: "Arial, sans-serif", minHeight: "100vh", background: "#f9fafb" }}>
      <AdminNav displayName={user.display_name} />

      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "28px 24px" }}>

        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 20, fontWeight: 600, color: "#111827" }}>
              Question Bank
            </h1>
            <p style={{ margin: "4px 0 0", fontSize: 13, color: "#9ca3af" }}>
              {questions.length} question{questions.length !== 1 ? "s" : ""}
              {hasFilter ? " (filtered)" : ""}
            </p>
          </div>
          <Link
            to="/admin/questions/new"
            style={{
              background: "#1a3a6b",
              color: "#fff",
              textDecoration: "none",
              borderRadius: 6,
              padding: "9px 16px",
              fontSize: 13,
              fontWeight: 500,
              flexShrink: 0,
            }}
          >
            + Add Question
          </Link>
        </div>

        {/* Filters */}
        <form method="get" style={{ display: "flex", gap: 10, marginBottom: 20, flexWrap: "wrap", alignItems: "center" }}>
          <select
            name="subject"
            defaultValue={filter.subject ?? ""}
            onChange={(e) => (e.currentTarget.form as HTMLFormElement).submit()}
            style={selectStyle}
          >
            <option value="">All subjects</option>
            <option value="physics">Physics</option>
            <option value="chemistry">Chemistry</option>
            <option value="mathematics">Mathematics</option>
          </select>

          <select
            name="type"
            defaultValue={filter.type ?? ""}
            onChange={(e) => (e.currentTarget.form as HTMLFormElement).submit()}
            style={selectStyle}
          >
            <option value="">All types</option>
            <option value="scq">Single Correct (SCQ)</option>
            <option value="mcq">Multi Correct (MCQ)</option>
            <option value="integer">Integer</option>
            <option value="numerical">Numerical</option>
            <option value="paragraph">Paragraph</option>
          </select>

          {hasFilter && (
            <a
              href="/admin/questions"
              style={{ fontSize: 13, color: "#6b7280", textDecoration: "none", padding: "7px 10px" }}
            >
              ✕ Clear filters
            </a>
          )}
        </form>

        {/* Empty state */}
        {questions.length === 0 && (
          <div style={{ textAlign: "center", padding: "64px 0", color: "#9ca3af", fontSize: 14 }}>
            {hasFilter ? (
              <>No questions match this filter. <a href="/admin/questions" style={{ color: "#1a3a6b" }}>Clear →</a></>
            ) : (
              <>No questions yet. <Link to="/admin/questions/new" style={{ color: "#1a3a6b" }}>Add your first one →</Link></>
            )}
          </div>
        )}

        {/* Table */}
        {questions.length > 0 && (
          <div
            style={{
              background: "#fff",
              borderRadius: 8,
              border: "1px solid #e5e7eb",
              overflow: "hidden",
            }}
          >
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ background: "#f9fafb", borderBottom: "1px solid #e5e7eb" }}>
                  <th style={thStyle}>Image</th>
                  <th style={thStyle}>Subject</th>
                  <th style={thStyle}>Type</th>
                  <th style={thStyle}>Chapter</th>
                  <th style={thStyle}>Answer</th>
                  <th style={thStyle}>Added</th>
                  <th style={thStyle}></th>
                </tr>
              </thead>
              <tbody>
                {questions.map((q) => {
                  const badge = SUBJECT_BADGE[q.subject] ?? {
                    label: q.subject,
                    color: "#374151",
                    bg: "#f3f4f6",
                  };
                  return (
                    <tr
                      key={q.id}
                      style={{ borderBottom: "1px solid #f3f4f6" }}
                    >
                      {/* Thumbnail */}
                      <td style={tdStyle}>
                        <Link to={`/admin/questions/${q.id}`}>
                          <img
                            src={q.image_url}
                            alt="Question"
                            style={{
                              width: 80,
                              height: 56,
                              objectFit: "cover",
                              borderRadius: 4,
                              border: "1px solid #e5e7eb",
                              display: "block",
                            }}
                          />
                        </Link>
                      </td>

                      {/* Subject */}
                      <td style={tdStyle}>
                        <span
                          style={{
                            background: badge.bg,
                            color: badge.color,
                            borderRadius: 4,
                            padding: "2px 7px",
                            fontSize: 11,
                            fontWeight: 500,
                            whiteSpace: "nowrap",
                          }}
                        >
                          {badge.label}
                        </span>
                      </td>

                      {/* Type */}
                      <td style={{ ...tdStyle, color: "#374151" }}>
                        {TYPE_LABEL[q.type] ?? q.type}
                      </td>

                      {/* Chapter */}
                      <td style={{ ...tdStyle, color: "#374151" }}>{q.chapter}</td>

                      {/* Answer */}
                      <td
                        style={{
                          ...tdStyle,
                          color: "#111827",
                          fontFamily: "monospace",
                          fontWeight: 600,
                          fontSize: 12,
                        }}
                      >
                        {formatAnswer(q.type, q.correct_answer)}
                      </td>

                      {/* Date */}
                      <td style={{ ...tdStyle, color: "#9ca3af", whiteSpace: "nowrap" }}>
                        {fmtDate(q.created_at)}
                      </td>

                      {/* Delete */}
                      <td style={tdStyle}>
                        <form
                          method="post"
                          onSubmit={(e) => {
                            if (!confirm("Delete this question? This can't be undone."))
                              e.preventDefault();
                          }}
                        >
                          <input type="hidden" name="id" value={q.id} />
                          <button
                            type="submit"
                            style={{
                              background: "none",
                              border: "none",
                              color: "#ef4444",
                              cursor: "pointer",
                              fontSize: 12,
                              padding: "4px 8px",
                              borderRadius: 4,
                            }}
                          >
                            Delete
                          </button>
                        </form>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────

const selectStyle: React.CSSProperties = {
  padding: "7px 10px",
  border: "1px solid #d1d5db",
  borderRadius: 6,
  fontSize: 13,
  color: "#374151",
  background: "#fff",
  cursor: "pointer",
};

const thStyle: React.CSSProperties = {
  padding: "10px 14px",
  textAlign: "left",
  fontSize: 11,
  fontWeight: 600,
  color: "#6b7280",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  whiteSpace: "nowrap",
};

const tdStyle: React.CSSProperties = {
  padding: "12px 14px",
  verticalAlign: "middle",
};
