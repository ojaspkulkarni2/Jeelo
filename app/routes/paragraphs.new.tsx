import { data, redirect, Link } from "react-router";
import { useState, useRef, useEffect } from "react";
import type { Route } from "./+types/paragraphs.new";
import { requireUser } from "~/lib/auth.server";
import { createServerClient } from "~/lib/supabase.server";
import { uploadImage } from "~/lib/storage.server";
import { Sidebar } from "~/components/sidebar";
import { IconChevronRight } from "~/components/icons";

export async function loader({ request, context }: Route.LoaderArgs) {
  const user = await requireUser(request, context.cloudflare.env);
  return { user };
}

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

  if (dbError) return data({ error: dbError.message }, { status: 500 });
  return redirect("/library");
}

export default function NewParagraph({ loaderData, actionData }: Route.ComponentProps) {
  const { user } = loaderData;
  const error = actionData && "error" in actionData ? actionData.error : null;
  const [preview, setPreview] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { return () => { if (preview) URL.revokeObjectURL(preview); }; }, [preview]);

  function handleFile(file: File) {
    if (!file.type.startsWith("image/")) return;
    setPreview(URL.createObjectURL(file));
  }

  return (
    <div className="app-layout">
      <Sidebar displayName={user.display_name} />
      <main className="app-main">
        <div className="pg-head">
          <div>
            <nav className="result-breadcrumb" style={{ marginBottom: 6 }}>
              <Link to="/library" className="result-breadcrumb-link">Library</Link>
              <IconChevronRight size={13} />
              <span>Add Paragraph</span>
            </nav>
            <h1 className="pg-title">Add Paragraph</h1>
            <p className="pg-subtitle">Upload a passage image to use in paragraph-based questions.</p>
          </div>
        </div>

        <div className="pg-body" style={{ maxWidth: 560 }}>
          {error && <div className="alert-error" style={{ marginBottom: 20 }}>{error}</div>}
          <form method="post" encType="multipart/form-data" style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <div className="field">
              <label className="label" htmlFor="para-title">
                Title <span style={{ fontWeight: 400, color: "var(--c-text-3)" }}>(optional)</span>
              </label>
              <input id="para-title" name="title" type="text" className="input"
                placeholder="e.g. Paragraph 1 — Modern Physics" />
            </div>

            <div className="field">
              <label className="label">Passage image *</label>
              <div
                className={`upload-zone${isDragging ? " dragging" : ""}`}
                onClick={() => fileRef.current?.click()}
                onKeyDown={(e) => e.key === "Enter" && fileRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={(e) => {
                  e.preventDefault(); setIsDragging(false);
                  const file = e.dataTransfer.files[0];
                  if (!file || !file.type.startsWith("image/")) return;
                  if (fileRef.current) {
                    const dt = new DataTransfer(); dt.items.add(file);
                    fileRef.current.files = dt.files; handleFile(file);
                  }
                }}
                tabIndex={0} role="button"
              >
                {preview ? (
                  <img src={preview} alt="Preview" style={{ width: "100%", objectFit: "contain" }} />
                ) : (
                  <div className="upload-zone-inner">
                    <div className="upload-zone-icon">📄</div>
                    <p className="upload-zone-text">Click or drag the passage image here</p>
                    <p className="upload-zone-sub">PNG, JPG, WEBP · max 10 MB</p>
                  </div>
                )}
              </div>
              <input ref={fileRef} type="file" name="image" accept="image/*" required style={{ display: "none" }}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
              {preview && (
                <button type="button" className="btn btn-ghost btn-sm"
                  style={{ marginTop: 6, alignSelf: "flex-start" }}
                  onClick={() => { setPreview(null); if (fileRef.current) fileRef.current.value = ""; }}>
                  Remove image
                </button>
              )}
            </div>

            <div style={{ display: "flex", gap: 10 }}>
              <button type="submit" className="btn btn-primary">Save Paragraph</button>
              <Link to="/library" className="btn btn-ghost">Cancel</Link>
            </div>
          </form>
        </div>
      </main>
    </div>
  );
}
