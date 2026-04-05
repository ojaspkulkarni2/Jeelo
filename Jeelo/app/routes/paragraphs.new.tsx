import { data, redirect, Link } from "react-router";
import { useState, useRef, useEffect } from "react";
import type { Route } from "./+types/paragraphs.new";
import { requireUser } from "~/lib/auth.server";
import { createServerClient } from "~/lib/supabase.server";
import { uploadImage } from "~/lib/storage.server";
import { AppNav } from "~/components/app-nav";

// ── Loader ────────────────────────────────────────────────────

export async function loader({ request, context }: Route.LoaderArgs) {
  const user = await requireUser(request, context.cloudflare.env);
  return { user };
}

// ── Action ────────────────────────────────────────────────────

export async function action({ request, context }: Route.ActionArgs) {
  const env = context.cloudflare.env;
  const user = await requireUser(request, env);
  const formData = await request.formData();

  const imageFile = formData.get("image") as File | null;
  const title = String(formData.get("title") ?? "").trim();

  if (!imageFile || imageFile.size === 0)
    return data({ error: "Paragraph image is required" }, { status: 400 });

  if (!imageFile.type.startsWith("image/"))
    return data({ error: "File must be an image (PNG, JPG, WEBP)" }, { status: 400 });

  if (imageFile.size > 10 * 1024 * 1024)
    return data({ error: "Image must be under 10 MB" }, { status: 400 });

  const uploadResult = await uploadImage(imageFile, user.id, env);
  if ("error" in uploadResult)
    return data({ error: `Upload failed: ${uploadResult.error}` }, { status: 500 });

  const supabase = createServerClient(env);
  const { error: dbError } = await supabase.from("paragraphs").insert({
    owner_id: user.id,
    image_url: uploadResult.publicUrl,
    title: title || null,
  });

  if (dbError)
    return data({ error: dbError.message }, { status: 500 });

  return redirect("/library");
}

// ── Component ─────────────────────────────────────────────────

export default function NewParagraph({ loaderData, actionData }: Route.ComponentProps) {
  const { user } = loaderData;
  const error = actionData && "error" in actionData ? actionData.error : null;

  const [preview, setPreview] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  function handleFile(file: File) {
    if (!file.type.startsWith("image/")) return;
    setPreview(URL.createObjectURL(file));
  }

  return (
    <div style={{ fontFamily: "Arial, sans-serif", minHeight: "100vh", background: "#f9fafb" }}>
      <AppNav displayName={user.display_name} />

      <div style={{ maxWidth: 640, margin: "0 auto", padding: "28px 24px" }}>
        {/* Breadcrumb */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 24 }}>
          <Link
            to="/library"
            style={{ color: "#6b7280", textDecoration: "none", fontSize: 13 }}
          >
            ← Paragraphs
          </Link>
          <span style={{ color: "#d1d5db" }}>›</span>
          <h1 style={{ margin: 0, fontSize: 18, fontWeight: 600, color: "#111827" }}>
            Add Paragraph
          </h1>
        </div>

        <div
          style={{
            background: "#fff",
            borderRadius: 8,
            border: "1px solid #e5e7eb",
            padding: 28,
          }}
        >
          {error && (
            <div
              style={{
                background: "#fde8e4",
                border: "1px solid #e08070",
                borderRadius: 6,
                padding: "10px 14px",
                marginBottom: 20,
                fontSize: 13,
                color: "#a83220",
              }}
            >
              {error}
            </div>
          )}

          <form
            method="post"
            encType="multipart/form-data"
            style={{ display: "flex", flexDirection: "column", gap: 20 }}
          >
            {/* Title */}
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <label style={labelStyle} htmlFor="title">
                Title{" "}
                <span style={{ fontWeight: 400, color: "#9ca3af" }}>(optional)</span>
              </label>
              <input
                id="title"
                name="title"
                type="text"
                style={inputStyle}
                placeholder="e.g. Paragraph 1 — Modern Physics"
              />
            </div>

            {/* Image upload */}
            <div>
              <label style={{ ...labelStyle, display: "block", marginBottom: 8 }}>
                Passage image *
              </label>

              <div
                role="button"
                tabIndex={0}
                style={{
                  border: `2px dashed ${isDragging ? "#1a3a6b" : "#d1d5db"}`,
                  borderRadius: 8,
                  background: isDragging ? "#eef2ff" : "#f9fafb",
                  minHeight: 200,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  cursor: "pointer",
                  overflow: "hidden",
                  transition: "border-color 0.15s, background 0.15s",
                }}
                onClick={() => fileRef.current?.click()}
                onKeyDown={(e) => e.key === "Enter" && fileRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setIsDragging(false);
                  const file = e.dataTransfer.files[0];
                  if (file && fileRef.current) {
                    const dt = new DataTransfer();
                    dt.items.add(file);
                    fileRef.current.files = dt.files;
                    handleFile(file);
                  }
                }}
              >
                {preview ? (
                  <img
                    src={preview}
                    alt="Preview"
                    style={{ width: "100%", objectFit: "contain" }}
                  />
                ) : (
                  <div style={{ textAlign: "center", padding: 32 }}>
                    <div style={{ fontSize: 32, marginBottom: 10 }}>📄</div>
                    <p style={{ margin: "0 0 4px", fontSize: 14, color: "#374151", fontWeight: 500 }}>
                      Click or drag the passage image here
                    </p>
                    <p style={{ margin: 0, fontSize: 12, color: "#9ca3af" }}>PNG, JPG, WEBP</p>
                  </div>
                )}
              </div>

              <input
                ref={fileRef}
                type="file"
                name="image"
                accept="image/*"
                required
                style={{ display: "none" }}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleFile(file);
                }}
              />

              {preview && (
                <button
                  type="button"
                  style={{
                    marginTop: 8,
                    background: "none",
                    border: "none",
                    fontSize: 12,
                    color: "#9ca3af",
                    cursor: "pointer",
                    padding: 0,
                  }}
                  onClick={() => {
                    setPreview(null);
                    if (fileRef.current) fileRef.current.value = "";
                  }}
                >
                  ✕ Remove image
                </button>
              )}
            </div>

            {/* Buttons */}
            <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
              <button
                type="submit"
                style={{
                  background: "#1a3a6b",
                  color: "#fff",
                  border: "none",
                  borderRadius: 6,
                  padding: "10px 24px",
                  fontSize: 14,
                  fontWeight: 500,
                  cursor: "pointer",
                }}
              >
                Save Paragraph
              </button>
              <Link
                to="/library"
                style={{ fontSize: 14, color: "#6b7280", textDecoration: "none" }}
              >
                Cancel
              </Link>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────

const labelStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 500,
  color: "#374151",
};

const inputStyle: React.CSSProperties = {
  padding: "9px 11px",
  border: "1px solid #d1d5db",
  borderRadius: 6,
  fontSize: 14,
  width: "100%",
  boxSizing: "border-box",
  color: "#111827",
  background: "#fff",
};
