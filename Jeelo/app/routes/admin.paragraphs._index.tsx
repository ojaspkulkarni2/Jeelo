import { Link } from "react-router";
import type { Route } from "./+types/admin.paragraphs._index";
import { requireAdmin } from "~/lib/auth.server";
import { createServerClient } from "~/lib/supabase.server";
import { deleteImage } from "~/lib/storage.server";
import { AdminNav } from "~/components/admin-nav";

// ── Loader ────────────────────────────────────────────────────

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const user = await requireAdmin(request, env);
  const supabase = createServerClient(env);

  const { data: paragraphs, error } = await supabase
    .from("paragraphs")
    .select("id, image_url, title, created_at")
    .eq("owner_id", user.id)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);

  return { user, paragraphs: paragraphs ?? [] };
}

// ── Action (delete) ───────────────────────────────────────────

export async function action({ request, context }: Route.ActionArgs) {
  const env = context.cloudflare.env;
  const user = await requireAdmin(request, env);
  const formData = await request.formData();
  const id = String(formData.get("id") ?? "");

  const supabase = createServerClient(env);

  const { data: p } = await supabase
    .from("paragraphs")
    .select("image_url")
    .eq("id", id)
    .eq("owner_id", user.id)
    .single();

  await supabase
    .from("paragraphs")
    .delete()
    .eq("id", id)
    .eq("owner_id", user.id);

  if (p?.image_url) await deleteImage(p.image_url, env);

  return null;
}

// ── Component ─────────────────────────────────────────────────

export default function ParagraphBank({ loaderData }: Route.ComponentProps) {
  const { user, paragraphs } = loaderData;

  return (
    <div style={{ fontFamily: "Arial, sans-serif", minHeight: "100vh", background: "#f9fafb" }}>
      <AdminNav displayName={user.display_name} />

      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "28px 24px" }}>
        {/* Header */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            marginBottom: 24,
          }}
        >
          <div>
            <h1 style={{ margin: 0, fontSize: 20, fontWeight: 600, color: "#111827" }}>
              Paragraphs
            </h1>
            <p style={{ margin: "4px 0 0", fontSize: 13, color: "#9ca3af" }}>
              Passage images used in paragraph-based questions — {paragraphs.length} total
            </p>
          </div>
          <Link
            to="/admin/paragraphs/new"
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
            + Add Paragraph
          </Link>
        </div>

        {/* Empty state */}
        {paragraphs.length === 0 && (
          <div
            style={{ textAlign: "center", padding: "64px 0", color: "#9ca3af", fontSize: 14 }}
          >
            No paragraphs yet.{" "}
            <Link to="/admin/paragraphs/new" style={{ color: "#1a3a6b" }}>
              Upload one →
            </Link>
          </div>
        )}

        {/* Grid */}
        {paragraphs.length > 0 && (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
              gap: 16,
            }}
          >
            {paragraphs.map((p) => (
              <div
                key={p.id}
                style={{
                  background: "#fff",
                  borderRadius: 8,
                  border: "1px solid #e5e7eb",
                  overflow: "hidden",
                }}
              >
                {/* Preview */}
                <div
                  style={{
                    height: 160,
                    background: "#f9fafb",
                    borderBottom: "1px solid #e5e7eb",
                    overflow: "hidden",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <img
                    src={p.image_url}
                    alt="Paragraph"
                    style={{ width: "100%", height: "100%", objectFit: "cover" }}
                  />
                </div>

                {/* Footer */}
                <div
                  style={{
                    padding: "12px 14px",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <p
                      style={{
                        margin: "0 0 2px",
                        fontSize: 13,
                        fontWeight: 500,
                        color: "#111827",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {p.title ?? "Untitled paragraph"}
                    </p>
                    <p style={{ margin: 0, fontSize: 11, color: "#9ca3af" }}>
                      {new Date(p.created_at).toLocaleDateString("en-IN", {
                        day: "numeric",
                        month: "short",
                        year: "2-digit",
                      })}
                    </p>
                  </div>

                  <form
                    method="post"
                    onSubmit={(e) => {
                      if (!confirm("Delete this paragraph? Questions using it will lose their link."))
                        e.preventDefault();
                    }}
                    style={{ flexShrink: 0 }}
                  >
                    <input type="hidden" name="id" value={p.id} />
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
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
