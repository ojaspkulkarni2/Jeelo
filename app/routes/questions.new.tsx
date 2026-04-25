import { data, redirect, Link, Form } from "react-router";
import { useState, useRef, useEffect } from "react";
import type { Route } from "./+types/questions.new";
import { requireUser } from "~/lib/auth.server";
import { createServerClient } from "~/lib/supabase.server";
import { uploadImage } from "~/lib/storage.server";
import { Sidebar } from "~/components/sidebar";
import { IconChevronRight } from "~/components/icons";
import type { QuestionType, Subject } from "~/lib/database.types";

// ── Loader ────────────────────────────────────────────────────

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const user = await requireUser(request, env);
  const supabase = createServerClient(env);

  // Always fetch paragraphs regardless of folder validity
  const { data: paragraphs } = await supabase
    .from("paragraphs")
    .select("id, title, created_at")
    .eq("owner_id", user.id)
    .order("created_at", { ascending: false });

  // Read folder_id from ?folder_id= so upload lands in the right folder
  const url = new URL(request.url);
  const rawFolderId = url.searchParams.get("folder_id");

  if (!rawFolderId) {
    return { user, paragraphs: paragraphs ?? [], folderId: null, folderName: null };
  }

  // Verify the folder belongs to this user — silently ignore if not
  const { data: folder } = await supabase
    .from("folders")
    .select("id, name")
    .eq("id", rawFolderId)
    .eq("owner_id", user.id)
    .single();

  return {
    user,
    paragraphs: paragraphs ?? [],
    folderId: folder?.id ?? null,
    folderName: folder?.name ?? null,
  };
}

// ── Answer parsing ────────────────────────────────────────────

function parseAnswerLine(
  raw: string,
  type: QuestionType
): { answer: unknown } | { error: string } {
  const line = raw.trim().toLowerCase();

  if (type === "scq" || type === "paragraph") {
    if (!["a", "b", "c", "d"].includes(line))
      return { error: `"${raw}" — use a, b, c, or d` };
    return { answer: [line.toUpperCase()] };
  }

  if (type === "mcq") {
    const opts = line.split(/[\s,]+/).filter(Boolean);
    if (opts.length === 0) return { error: "Empty line" };
    const invalid = opts.find((o) => !["a", "b", "c", "d"].includes(o));
    if (invalid) return { error: `"${invalid}" is not a valid option` };
    // Deduplicate and sort (a < b < c < d) so storage is canonical.
    // Without this, "a a b" stores ["A","A","B"] and "c a" stores ["C","A"],
    // both of which break any equality-based scoring check.
    const unique = [...new Set(opts)].sort();
    return { answer: unique.map((o) => o.toUpperCase()) };
  }

  if (type === "integer") {
    const n = parseInt(line, 10);
    if (isNaN(n)) return { error: `"${raw}" is not a valid integer` };
    return { answer: n };
  }

  if (type === "numerical") {
    const n = parseFloat(line);
    if (isNaN(n)) return { error: `"${raw}" is not a valid number` };
    return { answer: n };
  }

  return { error: "Unknown type" };
}

// ── Action ────────────────────────────────────────────────────

export async function action({ request, context }: Route.ActionArgs) {
  const env = context.cloudflare.env;
  const user = await requireUser(request, env);
  const formData = await request.formData();

  const imageFiles = (formData.getAll("images") as File[]).filter(
    (f) => f.size > 0
  );
  const subject = String(formData.get("subject") ?? "") as Subject;
  const chapter = String(formData.get("chapter") ?? "").trim(); // optional
  const type = String(formData.get("type") ?? "") as QuestionType;
  const paragraphId = formData.get("paragraph_id")
    ? String(formData.get("paragraph_id"))
    : null;
  const folderId = formData.get("folder_id")
    ? String(formData.get("folder_id"))
    : null;
  const answerKey = String(formData.get("answer_key") ?? "");

  // ── Validate files ──
  if (imageFiles.length === 0)
    return data({ error: "Upload at least one question image" }, { status: 400 });

  for (let i = 0; i < imageFiles.length; i++) {
    const f = imageFiles[i];
    if (!f.type.startsWith("image/"))
      return data(
        { error: `Image ${i + 1} ("${f.name}") is not an image file` },
        { status: 400 }
      );
    if (f.size > 10 * 1024 * 1024)
      return data(
        { error: `Image ${i + 1} ("${f.name}") exceeds 10 MB` },
        { status: 400 }
      );
  }

  // ── Validate metadata ──
  if (!["physics", "chemistry", "mathematics"].includes(subject))
    return data({ error: "Select a subject" }, { status: 400 });
  if (!["scq", "mcq", "integer", "numerical", "paragraph"].includes(type))
    return data({ error: "Select a question type" }, { status: 400 });
  if (type === "paragraph" && !paragraphId)
    return data({ error: "Select a paragraph" }, { status: 400 });

  // ── Parse answer key ──
  const answerLines = answerKey
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  if (answerLines.length !== imageFiles.length)
    return data(
      {
        error: `${answerLines.length} answer${answerLines.length !== 1 ? "s" : ""} entered but ${imageFiles.length} image${imageFiles.length !== 1 ? "s" : ""} uploaded — counts must match`,
      },
      { status: 400 }
    );

  const correctAnswers: unknown[] = [];
  for (let i = 0; i < answerLines.length; i++) {
    const result = parseAnswerLine(answerLines[i], type);
    if ("error" in result)
      return data(
        { error: `Answer ${i + 1}: ${result.error}` },
        { status: 400 }
      );
    correctAnswers.push(result.answer);
  }

  // ── Upload all images in serial batches of 20 ──
  // Cloudflare Workers cap at 50 subrequests per invocation. requireUser
  // already consumes ~3, leaving ~47. Uploading everything in parallel
  // with Promise.all blows past this the moment someone uploads 48+ images.
  // Chunking at 20 keeps us safely under the limit while still being fast.
  const CHUNK = 20;
  const uploads: ({ publicUrl: string } | { error: string })[] = [];
  for (let i = 0; i < imageFiles.length; i += CHUNK) {
    const chunk = imageFiles.slice(i, i + CHUNK);
    const results = await Promise.all(chunk.map((f) => uploadImage(f, user.id, env)));
    uploads.push(...results);
  }

  const failIdx = uploads.findIndex((u) => "error" in u);
  if (failIdx !== -1)
    return data(
      {
        error: `Upload failed for image ${failIdx + 1}: ${
          (uploads[failIdx] as { error: string }).error
        }`,
      },
      { status: 500 }
    );

  // ── Bulk insert ──
  const supabase = createServerClient(env);
  const { error: dbError } = await supabase.from("questions").insert(
    (uploads as { publicUrl: string }[]).map((u, i) => ({
      owner_id: user.id,
      image_url: u.publicUrl,
      type,
      subject,
      chapter,
      correct_answer: correctAnswers[i],
      paragraph_id: paragraphId,
      folder_id: folderId,
      is_shared: false,
    }))
  );

  if (dbError)
    return data({ error: dbError.message }, { status: 500 });

  // Redirect back to the folder they came from, or library root
  const destination = folderId ? `/library/folders/${folderId}` : "/library";
  return redirect(destination);
}

// ── Helpers ───────────────────────────────────────────────────

function answerKeyHint(type: QuestionType | ""): string {
  if (!type) return "Select a question type above first";
  if (type === "scq" || type === "paragraph")
    return "One line per question — a, b, c, or d";
  if (type === "mcq")
    return "One line per question — a  or  a,b  or  a b c";
  if (type === "integer") return "One integer per line — e.g.  3  or  -7";
  if (type === "numerical")
    return "One number per line — e.g.  3.14  or  -2.5";
  return "";
}

// ── Component ─────────────────────────────────────────────────

export default function NewQuestion({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const { user, paragraphs, folderId, folderName } = loaderData;
  const error = actionData && "error" in actionData ? actionData.error : null;

  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [type, setType] = useState<QuestionType | "">("");
  const [answerKey, setAnswerKey] = useState("");
  const [isDragging, setIsDragging] = useState(false);

  // The real file input that gets submitted with the form
  const fileInputRef = useRef<HTMLInputElement>(null);
  // A second invisible input used to open the "add more" picker
  const addMoreRef = useRef<HTMLInputElement>(null);
  // A third invisible input for folder upload
  const folderInputRef = useRef<HTMLInputElement>(null);

  // Sync previews whenever files change; revoke stale object URLs on cleanup
  useEffect(() => {
    const urls = files.map((f) => URL.createObjectURL(f));
    setPreviews(urls);
    return () => urls.forEach((url) => URL.revokeObjectURL(url));
  }, [files]);

  // Keep the submitted file input in sync with our files array
  function syncFileInput(next: File[]) {
    if (!fileInputRef.current) return;
    const dt = new DataTransfer();
    next.forEach((f) => dt.items.add(f));
    fileInputRef.current.files = dt.files;
  }

  function addFiles(incoming: FileList | File[]) {
    const valid = Array.from(incoming).filter((f) =>
      f.type.startsWith("image/")
    );
    if (valid.length === 0) return;
    const next = [...files, ...valid];
    setFiles(next);
    syncFileInput(next);
  }

  function removeFile(idx: number) {
    const next = files.filter((_, i) => i !== idx);
    setFiles(next);
    syncFileInput(next);
    // Keep answer key lines in sync so image count and answer count never diverge
    setAnswerKey(prev => {
      const lines = prev.split("\n");
      lines.splice(idx, 1);
      return lines.join("\n");
    });
  }

  const answerCount = answerKey
    .split("\n")
    .filter((l) => l.trim()).length;
  const countOk = files.length > 0 && answerCount === files.length;
  const countBad =
    files.length > 0 && answerCount > 0 && answerCount !== files.length;

  return (
    <div className="app-layout">
      <Sidebar displayName={user.display_name} />
      <main className="app-main">
        <div className="pg-head">
          <div>
            <nav className="result-breadcrumb" style={{ marginBottom: 6 }}>
              <Link to="/library" className="result-breadcrumb-link">Library</Link>
              {folderId && folderName && (
                <>
                  <IconChevronRight size={13} />
                  <Link to={`/library/folders/${folderId}`} className="result-breadcrumb-link">{folderName}</Link>
                </>
              )}
              <IconChevronRight size={13} />
              <span>Add Questions</span>
            </nav>
            <h1 className="pg-title">Add Questions</h1>
            <p className="pg-subtitle">Upload images and enter the answer key — one line per question.</p>
          </div>
        </div>

        <div className="pg-body">
          <Form method="post" encType="multipart/form-data">
            {folderId && <input type="hidden" name="folder_id" value={folderId} />}
            {error && <div className="alert-error" style={{ marginBottom: 20 }}>{error}</div>}

            <div className="editor-two-col">

              {/* ── LEFT: Image area ── */}
              <div className="editor-col">
                <div className="field">
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <label className="label">
                      Question images{files.length > 0 ? <span style={{ fontWeight: 400, color: "var(--c-text-3)" }}> ({files.length} selected)</span> : " *"}
                    </label>
                    {files.length > 0 && (
                      <div style={{ display: "flex", gap: 6 }}>
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => addMoreRef.current?.click()}>+ Add more</button>
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => folderInputRef.current?.click()}>
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" style={{ marginRight: 4, verticalAlign: "middle" }}><path d="M10 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2z"/></svg>
                          Folder
                        </button>
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setFiles([]); syncFileInput([]); }}>Clear all</button>
                      </div>
                    )}
                  </div>

                  {/* Hidden form input */}
                  <input ref={fileInputRef} type="file" name="images" multiple accept="image/*" style={{ display: "none" }} onChange={() => {}} />
                  {/* Add-more picker */}
                  <input ref={addMoreRef} type="file" multiple accept="image/*" style={{ display: "none" }}
                    onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ""; }} />
                  {/* Folder picker */}
                  <input ref={folderInputRef} type="file"
                    // @ts-ignore
                    webkitdirectory="" multiple accept="image/*" style={{ display: "none" }}
                    onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ""; }} />

                  {/* Empty drop zone */}
                  {files.length === 0 && (
                    <div
                      className={`upload-zone${isDragging ? " dragging" : ""}`}
                      style={{ minHeight: 260, flexDirection: "column" }}
                      role="button" tabIndex={0}
                      onClick={() => addMoreRef.current?.click()}
                      onKeyDown={(e) => e.key === "Enter" && addMoreRef.current?.click()}
                      onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                      onDragLeave={() => setIsDragging(false)}
                      onDrop={(e) => { e.preventDefault(); setIsDragging(false); if (e.dataTransfer.files) addFiles(e.dataTransfer.files); }}
                    >
                      <div className="upload-zone-inner">
                        <div className="upload-zone-icon">
                          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
                            <circle cx="12" cy="13" r="4"/>
                          </svg>
                        </div>
                        <p className="upload-zone-text">Click or drag images here</p>
                        <p className="upload-zone-sub">Select as many as you want — order matters</p>
                        <button type="button" className="btn btn-ghost btn-sm" style={{ marginTop: 12, whiteSpace: "nowrap" }}
                          onClick={(e) => { e.stopPropagation(); folderInputRef.current?.click(); }}>
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" style={{ marginRight: 4, verticalAlign: "middle" }}><path d="M10 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2z"/></svg>
                          Or upload an entire folder
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Thumbnail grid */}
                  {files.length > 0 && (
                    <div className="upload-thumb-grid"
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
                          <div className="upload-thumb-label">{files[i]?.name.length > 14 ? files[i].name.slice(0, 14) + "…" : files[i]?.name}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* ── RIGHT: Metadata + Answer key ── */}
              <div className="editor-col">
                <div className="field">
                  <label className="label" htmlFor="nq-subject">Subject *</label>
                  <select id="nq-subject" name="subject" required className="input">
                    <option value="">Select subject</option>
                    <option value="physics">Physics</option>
                    <option value="chemistry">Chemistry</option>
                    <option value="mathematics">Mathematics</option>
                  </select>
                </div>

                <div className="field">
                  <label className="label" htmlFor="nq-chapter">
                    Chapter <span style={{ fontWeight: 400, color: "var(--c-text-3)" }}>(optional)</span>
                  </label>
                  <input id="nq-chapter" name="chapter" type="text" className="input" placeholder="e.g. Thermodynamics" />
                </div>

                <div className="field">
                  <label className="label" htmlFor="nq-type">Question type *</label>
                  <select id="nq-type" name="type" required className="input" value={type}
                    onChange={(e) => setType(e.target.value as QuestionType)}>
                    <option value="">Select type</option>
                    <option value="scq">Single Correct (SCQ)</option>
                    <option value="mcq">Multiple Correct (MCQ)</option>
                    <option value="integer">Integer</option>
                    <option value="numerical">Numerical</option>
                    <option value="paragraph">Paragraph-based</option>
                  </select>
                </div>

                {type === "paragraph" && (
                  <div className="field">
                    <label className="label" htmlFor="nq-para">Paragraph *</label>
                    {paragraphs.length === 0 ? (
                      <p style={{ fontSize: 13, color: "var(--c-text-3)", margin: 0 }}>
                        No paragraphs yet.{" "}
                        <Link to="/paragraphs/new" style={{ color: "var(--c-brand-500)" }}>Upload one first →</Link>
                      </p>
                    ) : (
                      <select id="nq-para" name="paragraph_id" required className="input">
                        <option value="">Select paragraph</option>
                        {paragraphs.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.title ?? `Paragraph — ${new Date(p.created_at).toLocaleDateString("en-IN")}`}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                )}

                <div className="field">
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                    <label className="label" htmlFor="nq-answer">Answer key *</label>
                    {files.length > 0 && (
                      <span className={`answer-count${countOk ? " ok" : countBad ? " bad" : " neutral"}`}>
                        {answerCount} / {files.length}{countOk ? " ✓" : ""}
                      </span>
                    )}
                  </div>
                  <textarea id="nq-answer" name="answer_key" value={answerKey}
                    onChange={(e) => setAnswerKey(e.target.value)}
                    className={`answer-key-textarea${countBad ? " error" : ""}`}
                    spellCheck={false}
                    placeholder={type ? `a\nb\nc\nb\na\n…` : "Select a type first"}
                  />
                  <p style={{ margin: "4px 0 0", fontSize: 11, color: "var(--c-text-3)" }}>
                    {answerKeyHint(type)}
                  </p>
                </div>

                <button type="submit" disabled={files.length === 0}
                  className="btn btn-primary"
                  style={{ width: "100%", justifyContent: "center", opacity: files.length === 0 ? 0.5 : 1 }}>
                  {files.length === 0 ? "Upload images first" : `Save ${files.length} question${files.length !== 1 ? "s" : ""}`}
                </button>
                <Link to={folderId ? `/library/folders/${folderId}` : "/library"}
                  className="btn btn-ghost" style={{ width: "100%", justifyContent: "center" }}>
                  Cancel
                </Link>
              </div>
            </div>
          </Form>
        </div>
      </main>
    </div>
  );
}
