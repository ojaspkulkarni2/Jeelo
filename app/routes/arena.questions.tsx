import { data, useFetcher, Link } from "react-router";
import { useRef, useState, useEffect } from "react";
import type { Route } from "./+types/arena.questions";
import { requireUser } from "~/lib/auth.server";
import { createServerClient } from "~/lib/supabase.server";
import { uploadImage } from "~/lib/storage.server";
import { Sidebar } from "~/components/sidebar";

// ── Server ─────────────────────────────────────────────────────

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const user = await requireUser(request, env);
  const supabase = createServerClient(env);
  const { data: questions } = await supabase
    .from("questions")
    .select("id, image_url, correct_answer, created_at")
    .eq("owner_id", user.id)
    .eq("type", "scq")           // ← correct column name (not "question_type")
    .eq("subject", "chemistry")
    .eq("is_shared", true)       // ← only show arena-pool questions
    .order("created_at", { ascending: false });
  return data({ user, questions: questions ?? [] });
}

export async function action({ request, context }: Route.ActionArgs) {
  const env = context.cloudflare.env;
  const user = await requireUser(request, env);
  const supabase = createServerClient(env);
  const fd = await request.formData();
  const intent = fd.get("intent");

  // ── Bulk add ────────────────────────────────────────────────
  if (intent === "bulk_add") {
    const imageFiles = (fd.getAll("images") as File[]).filter((f) => f.size > 0);
    const answerKey = String(fd.get("answer_key") ?? "");
    const answerLines = answerKey.split("\n").map((l) => l.trim()).filter(Boolean);

    if (imageFiles.length === 0) return data({ error: "Upload at least one image" });
    if (answerLines.length !== imageFiles.length) {
      return data({
        error: `${answerLines.length} answer${answerLines.length !== 1 ? "s" : ""} but ${imageFiles.length} image${imageFiles.length !== 1 ? "s" : ""} — counts must match`,
      });
    }

    // Validate answers and store as jsonb arrays: ["A"] not "A"
    const answers: string[][] = [];
    for (let i = 0; i < answerLines.length; i++) {
      const a = answerLines[i].trim().toUpperCase();
      if (!["A", "B", "C", "D"].includes(a)) {
        return data({ error: `Answer ${i + 1}: "${answerLines[i]}" — use A, B, C, or D` });
      }
      answers.push([a]); // jsonb array shape required by DB check constraint
    }

    const MAX = 40;
    if (imageFiles.length > MAX) {
      return data({ error: `Max ${MAX} images per batch — split into multiple uploads if needed` });
    }

    const CHUNK = 5;
    const uploads: ({ publicUrl: string } | { error: string })[] = [];
    for (let i = 0; i < imageFiles.length; i += CHUNK) {
      const chunk = imageFiles.slice(i, i + CHUNK);
      const results = await Promise.all(chunk.map((f) => uploadImage(f, user.id, env)));
      uploads.push(...results);
    }

    const failIdx = uploads.findIndex((u) => "error" in u);
    if (failIdx !== -1) {
      return data({ error: `Upload failed for image ${failIdx + 1}: ${(uploads[failIdx] as { error: string }).error}` });
    }

    await supabase.from("questions").insert(
      (uploads as { publicUrl: string }[]).map((u, i) => ({
        owner_id:       user.id,
        type:           "scq",         // ← correct column name
        subject:        "chemistry",
        chapter:        "Arena",       // ← required NOT NULL; arena questions get a sentinel value
        correct_answer: answers[i],    // ← jsonb array ["A"], satisfies check constraint
        image_url:      u.publicUrl,
        is_shared:      true,          // ← must be true so match queries find them
        folder_id:      null,
      }))
    );

    return data({ ok: true, added: imageFiles.length });
  }

  // ── Delete ──────────────────────────────────────────────────
  if (intent === "delete") {
    const id = String(fd.get("id"));
    await supabase.from("questions").delete().eq("id", id).eq("owner_id", user.id);
    return data({ ok: true });
  }

  return data({ ok: false });
}

// ── Helpers ────────────────────────────────────────────────────

function countAnswerLines(raw: string): number {
  return raw.split("\n").filter((l) => l.trim()).length;
}

// ── Component ──────────────────────────────────────────────────

export default function ArenaQuestions({ loaderData }: Route.ComponentProps) {
  const { user, questions } = loaderData;
  const fetcher = useFetcher();

  const [files, setFiles]           = useState<File[]>([]);
  const [previews, setPreviews]     = useState<string[]>([]);
  const [answerKey, setAnswerKey]   = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [clientError, setClientError] = useState<string | null>(null);
  const [formKey, setFormKey]       = useState(0);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const addMoreRef   = useRef<HTMLInputElement>(null);
  const folderRef    = useRef<HTMLInputElement>(null);

  const isSubmitting = fetcher.state !== "idle";
  const serverError  = (fetcher.data as any)?.error ?? null;
  const error        = isSubmitting ? clientError : (clientError ?? serverError);
  const answerCount  = countAnswerLines(answerKey);
  const countOk      = files.length > 0 && answerCount === files.length;
  const countBad     = files.length > 0 && answerCount > 0 && answerCount !== files.length;

  useEffect(() => {
    const urls = files.map((f) => URL.createObjectURL(f));
    setPreviews(urls);
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
  }, [files]);

  useEffect(() => {
    if (fetcher.state === "idle" && (fetcher.data as any)?.ok && (fetcher.data as any)?.added) {
      setFiles([]);
      setAnswerKey("");
      setClientError(null);
      setFormKey((k) => k + 1);
    }
  }, [fetcher.state, fetcher.data]);

  function syncInput(next: File[]) {
    if (!fileInputRef.current) return;
    const dt = new DataTransfer();
    next.forEach((f) => dt.items.add(f));
    fileInputRef.current.files = dt.files;
  }

  function addFiles(incoming: FileList | File[]) {
    const arr = Array.from(incoming);

    const txtFile = arr.find((f) => f.name.toLowerCase().endsWith(".txt"));
    if (txtFile) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const text = (e.target?.result as string) ?? "";
        const lines = text.split(/\r?\n/).map((l) => l.trim());
        while (lines.length && !lines[0]) lines.shift();
        while (lines.length && !lines[lines.length - 1]) lines.pop();
        setAnswerKey(lines.join("\n"));
      };
      reader.readAsText(txtFile);
    }

    const images = arr.filter((f) => f.type.startsWith("image/"));
    if (!images.length) return;
    const next = [...files, ...images];
    setFiles(next);
    syncInput(next);
  }

  function removeFile(idx: number) {
    const next = files.filter((_, i) => i !== idx);
    setFiles(next);
    syncInput(next);
    setAnswerKey((prev) => {
      const lines = prev.split("\n");
      lines.splice(idx, 1);
      return lines.join("\n");
    });
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setClientError(null);

    if (files.length === 0) { setClientError("Upload at least one image"); return; }
    if (files.length > 40)  { setClientError("Max 40 images per batch"); return; }
    if (!countOk) {
      setClientError(
        `${answerCount} answer line${answerCount !== 1 ? "s" : ""} but ${files.length} image${files.length !== 1 ? "s" : ""} — counts must match`
      );
      return;
    }

    const fd = new FormData(e.currentTarget);
    fetcher.submit(fd, { method: "post", encType: "multipart/form-data" });
  }

  const labelStyle: React.CSSProperties = {
    fontSize: 11, fontWeight: 700, color: "var(--c-text-3)",
    textTransform: "uppercase", letterSpacing: "0.05em",
  };

  return (
    <div className="app-layout">
      <Sidebar displayName={user.display_name} username={(user as any).username} />
      <main className="app-main" style={{ padding: "24px 28px", maxWidth: 900, margin: "0 auto" }}>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}>
          <Link to="/arena" style={{ fontSize: 13, color: "var(--c-text-3)", textDecoration: "none" }}>← Arena</Link>
          <h1 style={{ fontSize: 18, fontWeight: 800, margin: 0, color: "var(--c-text)", letterSpacing: "-0.02em" }}>
            Duel Questions
          </h1>
          <span style={{ fontSize: 11, color: "var(--c-text-3)", background: "var(--c-bg)", border: "1px solid var(--c-border)", padding: "2px 7px", borderRadius: 4 }}>
            Chemistry · SCQ · {questions.length} in pool
          </span>
        </div>

        {/* ── Bulk upload card ── */}
        <div style={{ background: "var(--c-surface)", border: "1px solid var(--c-border)", borderRadius: 10, overflow: "hidden", marginBottom: 28 }}>
          <div style={{ padding: "12px 20px", borderBottom: "1px solid var(--c-border)", background: "var(--c-subtle)" }}>
            <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: "var(--c-text-2)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              + Add Questions
            </p>
          </div>

          <fetcher.Form
            key={formKey}
            method="post"
            encType="multipart/form-data"
            onSubmit={handleSubmit}
            style={{ padding: "20px 24px" }}
          >
            <input type="hidden" name="intent" value="bulk_add" />
            <input ref={fileInputRef} type="file" name="images" multiple accept="image/*" style={{ display: "none" }} onChange={() => {}} />
            <input ref={addMoreRef} type="file" multiple accept="image/*" style={{ display: "none" }}
              onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ""; }} />
            <input ref={folderRef} type="file"
              // @ts-ignore
              webkitdirectory="" multiple style={{ display: "none" }}
              onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ""; }} />

            {error && (
              <div className="alert-error" style={{ marginBottom: 16, fontSize: 13 }}>{error}</div>
            )}
            {!error && (fetcher.data as any)?.added && (
              <div style={{ marginBottom: 16, fontSize: 13, color: "var(--c-brand-500)", fontWeight: 600 }}>
                ✓ {(fetcher.data as any).added} question{(fetcher.data as any).added !== 1 ? "s" : ""} added to the pool
              </div>
            )}

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 20 }}>

              {/* Left — image drop zone */}
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <label style={labelStyle}>
                    Question images
                    {files.length > 0
                      ? <span style={{ fontWeight: 400, color: "var(--c-text-3)", marginLeft: 4 }}>({files.length} selected)</span>
                      : <span style={{ fontWeight: 400, color: "var(--c-text-3)", marginLeft: 4 }}>(required)</span>
                    }
                  </label>
                  {files.length > 0 && (
                    <div style={{ display: "flex", gap: 4 }}>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => addMoreRef.current?.click()}>+ More</button>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => folderRef.current?.click()}>Folder</button>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setFiles([]); syncInput([]); }}>Clear</button>
                    </div>
                  )}
                </div>

                {files.length === 0 ? (
                  <div
                    className={`upload-zone${isDragging ? " dragging" : ""}`}
                    style={{ minHeight: 200, flexDirection: "column", cursor: "pointer" }}
                    role="button" tabIndex={0}
                    onClick={() => folderRef.current?.click()}
                    onKeyDown={(e) => e.key === "Enter" && folderRef.current?.click()}
                    onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                    onDragLeave={() => setIsDragging(false)}
                    onDrop={(e) => { e.preventDefault(); setIsDragging(false); if (e.dataTransfer.files) addFiles(e.dataTransfer.files); }}
                  >
                    <div className="upload-zone-inner">
                      <div className="upload-zone-icon">
                        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
                          <circle cx="12" cy="13" r="4"/>
                        </svg>
                      </div>
                      <p className="upload-zone-text">Click or drag a folder here</p>
                      <p className="upload-zone-sub">
                        Images become questions · <code style={{ fontSize: 11 }}>answers.txt</code> auto-fills the key
                      </p>
                      <div style={{ display: "flex", gap: 8, marginTop: 10, justifyContent: "center" }}>
                        <button type="button" className="btn btn-ghost btn-sm"
                          onClick={(e) => { e.stopPropagation(); folderRef.current?.click(); }}>
                          Upload folder
                        </button>
                        <button type="button" className="btn btn-ghost btn-sm"
                          onClick={(e) => { e.stopPropagation(); addMoreRef.current?.click(); }}>
                          Select images
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div
                    className="upload-thumb-grid"
                    onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                    onDragLeave={() => setIsDragging(false)}
                    onDrop={(e) => { e.preventDefault(); setIsDragging(false); if (e.dataTransfer.files) addFiles(e.dataTransfer.files); }}
                  >
                    {previews.map((url, i) => (
                      <div key={i} className="upload-thumb">
                        <img src={url} alt={`Q${i + 1}`} />
                        <button type="button" aria-label="Remove" onClick={() => removeFile(i)}
                          style={{
                            position: "absolute", top: 4, right: 4,
                            background: "rgba(0,0,0,0.55)", border: "none", borderRadius: "50%",
                            width: 20, height: 20, cursor: "pointer", color: "#fff",
                            fontSize: 10, display: "flex", alignItems: "center", justifyContent: "center",
                          }}>✕</button>
                        <div className="upload-thumb-num">Q{i + 1}</div>
                        <div className="upload-thumb-label">
                          {files[i]?.name.length > 14 ? files[i].name.slice(0, 14) + "…" : files[i]?.name}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Right — answer key */}
              <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                  <label style={labelStyle}>Answer key *</label>
                  {files.length > 0 && (
                    <span style={{
                      fontSize: 11, fontWeight: 600,
                      color: countOk ? "var(--c-brand-500)" : countBad ? "#dc2626" : "var(--c-text-3)",
                    }}>
                      {answerCount} / {files.length}{countOk ? " ✓" : ""}
                    </span>
                  )}
                </div>
                <textarea
                  name="answer_key"
                  value={answerKey}
                  onChange={(e) => setAnswerKey(e.target.value)}
                  className={`answer-key-textarea${countBad ? " error" : ""}`}
                  spellCheck={false}
                  placeholder={"a\nb\nc\n…"}
                  style={{ flex: 1, minHeight: 200, resize: "vertical" }}
                />
                <p style={{ margin: "2px 0 0", fontSize: 11, color: "var(--c-text-3)" }}>
                  One line per question — A, B, C, or D
                </p>
                <p style={{ margin: "2px 0 0", fontSize: 11, color: "var(--c-text-3)" }}>
                  Include <code style={{ fontSize: 10 }}>answers.txt</code> in your folder to auto-fill this.
                </p>
              </div>
            </div>

            <button
              type="submit"
              style={{
                padding: "9px 20px", borderRadius: 8, fontSize: 13, fontWeight: 700,
                background: "var(--c-brand-500)", color: "#fff", border: "none",
                cursor: isSubmitting ? "not-allowed" : "pointer",
                opacity: isSubmitting ? 0.6 : 1,
              }}
              disabled={isSubmitting}
            >
              {isSubmitting
                ? "Uploading…"
                : files.length > 0
                ? `Add ${files.length} question${files.length !== 1 ? "s" : ""} to pool`
                : "Add questions"}
            </button>
          </fetcher.Form>
        </div>

        {/* ── Question pool ── */}
        {questions.length > 0 ? (
          <>
            <div style={{ fontSize: 12, color: "var(--c-text-3)", marginBottom: 10, fontWeight: 600 }}>
              {questions.length} question{questions.length !== 1 ? "s" : ""} in pool — showing most recent 12
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 10 }}>
              {(questions as any[]).slice(0, 12).map((q) => (
                <div key={q.id} style={{ background: "var(--c-surface)", border: "1px solid var(--c-border)", borderRadius: 10, overflow: "hidden" }}>
                  {q.image_url && (
                    <img src={q.image_url} alt="" style={{ width: "100%", height: 90, objectFit: "cover", display: "block" }} />
                  )}
                  <div style={{ padding: "6px 10px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: "var(--c-brand-500)" }}>
                      {Array.isArray(q.correct_answer) ? q.correct_answer[0] : q.correct_answer}
                    </span>
                    <fetcher.Form method="post">
                      <input type="hidden" name="intent" value="delete" />
                      <input type="hidden" name="id" value={q.id} />
                      <button type="submit" style={{ background: "none", border: "none", cursor: "pointer", fontSize: 13, color: "var(--c-text-3)", lineHeight: 1 }}>✕</button>
                    </fetcher.Form>
                  </div>
                </div>
              ))}
            </div>
            {questions.length > 12 && (
              <p style={{ fontSize: 12, color: "var(--c-text-3)", marginTop: 8 }}>
                + {questions.length - 12} more in pool (not shown)
              </p>
            )}
          </>
        ) : (
          <div style={{ textAlign: "center", padding: "40px 0", color: "var(--c-text-3)", fontSize: 13 }}>
            No duel questions yet. Add at least 3 to start a match.
          </div>
        )}
      </main>
    </div>
  );
}
