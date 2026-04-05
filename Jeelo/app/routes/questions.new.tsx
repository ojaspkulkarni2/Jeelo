import { data, redirect, Link } from "react-router";
import { useState, useRef, useEffect } from "react";
import type { Route } from "./+types/questions.new";
import { requireUser } from "~/lib/auth.server";
import { createServerClient } from "~/lib/supabase.server";
import { uploadImage } from "~/lib/storage.server";
import { AppNav } from "~/components/app-nav";
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

  // ── Upload all images in parallel ──
  const uploads = await Promise.all(
    imageFiles.map((f) => uploadImage(f, user.id, env))
  );

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
  }

  const answerCount = answerKey
    .split("\n")
    .filter((l) => l.trim()).length;
  const countOk = files.length > 0 && answerCount === files.length;
  const countBad =
    files.length > 0 && answerCount > 0 && answerCount !== files.length;

  return (
    <div
      style={{
        fontFamily: "Arial, sans-serif",
        minHeight: "100vh",
        background: "#f9fafb",
      }}
    >
      <AppNav displayName={user.display_name} />

      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "28px 24px" }}>
        {/* Breadcrumb */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 24,
          }}
        >
          <Link
            to="/library"
            style={{ color: "#6b7280", textDecoration: "none", fontSize: 13 }}
          >
            My Library
          </Link>
          {folderId && folderName && (
            <>
              <span style={{ color: "#d1d5db" }}>›</span>
              <Link
                to={`/library/folders/${folderId}`}
                style={{ color: "#6b7280", textDecoration: "none", fontSize: 13 }}
              >
                {folderName}
              </Link>
            </>
          )}
          <span style={{ color: "#d1d5db" }}>›</span>
          <h1
            style={{
              margin: 0,
              fontSize: 18,
              fontWeight: 600,
              color: "#111827",
            }}
          >
            Add Questions
          </h1>
        </div>

        <form method="post" encType="multipart/form-data">
          {/* Pass folder context through the form */}
          {folderId && (
            <input type="hidden" name="folder_id" value={folderId} />
          )}
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

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 360px",
              gap: 28,
              alignItems: "start",
            }}
          >
            {/* ── LEFT: Image area ── */}
            <div>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: 10,
                }}
              >
                <label style={labelStyle}>
                  Question images
                  {files.length > 0 ? (
                    <span style={{ fontWeight: 400, color: "#9ca3af" }}>
                      {" "}
                      ({files.length} selected)
                    </span>
                  ) : (
                    " *"
                  )}
                </label>
                {files.length > 0 && (
                  <div style={{ display: "flex", gap: 8 }}>
                    <button
                      type="button"
                      onClick={() => addMoreRef.current?.click()}
                      style={{
                        fontSize: 12,
                        color: "#1a3a6b",
                        background: "none",
                        border: "1px solid #c7d2fe",
                        borderRadius: 5,
                        padding: "4px 10px",
                        cursor: "pointer",
                      }}
                    >
                      + Add more
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setFiles([]);
                        syncFileInput([]);
                      }}
                      style={{
                        fontSize: 12,
                        color: "#6b7280",
                        background: "none",
                        border: "1px solid #e5e7eb",
                        borderRadius: 5,
                        padding: "4px 10px",
                        cursor: "pointer",
                      }}
                    >
                      Clear all
                    </button>
                  </div>
                )}
              </div>

              {/* Hidden form input — receives files via DataTransfer */}
              <input
                ref={fileInputRef}
                type="file"
                name="images"
                multiple
                accept="image/*"
                style={{ display: "none" }}
                onChange={() => {}}
              />

              {/* Hidden picker for "Add more" button */}
              <input
                ref={addMoreRef}
                type="file"
                multiple
                accept="image/*"
                style={{ display: "none" }}
                onChange={(e) => {
                  if (e.target.files) addFiles(e.target.files);
                  e.target.value = "";
                }}
              />

              {/* Empty drop zone */}
              {files.length === 0 && (
                <div
                  role="button"
                  tabIndex={0}
                  style={{
                    border: `2px dashed ${
                      isDragging ? "#1a3a6b" : "#d1d5db"
                    }`,
                    borderRadius: 8,
                    background: isDragging ? "#eef2ff" : "#fff",
                    minHeight: 260,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    cursor: "pointer",
                    transition: "border-color 0.15s, background 0.15s",
                  }}
                  onClick={() => addMoreRef.current?.click()}
                  onKeyDown={(e) =>
                    e.key === "Enter" && addMoreRef.current?.click()
                  }
                  onDragOver={(e) => {
                    e.preventDefault();
                    setIsDragging(true);
                  }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setIsDragging(false);
                    if (e.dataTransfer.files) addFiles(e.dataTransfer.files);
                  }}
                >
                  <div style={{ textAlign: "center", padding: 32 }}>
                    <div style={{ fontSize: 40, marginBottom: 12 }}>📷</div>
                    <p
                      style={{
                        margin: "0 0 6px",
                        fontSize: 15,
                        color: "#374151",
                        fontWeight: 500,
                      }}
                    >
                      Click or drag images here
                    </p>
                    <p style={{ margin: 0, fontSize: 13, color: "#9ca3af" }}>
                      Select as many as you want — order matters
                    </p>
                  </div>
                </div>
              )}

              {/* Thumbnail grid */}
              {files.length > 0 && (
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns:
                      "repeat(auto-fill, minmax(130px, 1fr))",
                    gap: 10,
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setIsDragging(true);
                  }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setIsDragging(false);
                    if (e.dataTransfer.files) addFiles(e.dataTransfer.files);
                  }}
                >
                  {previews.map((url, i) => (
                    <div
                      key={i}
                      style={{
                        borderRadius: 6,
                        overflow: "hidden",
                        border: "1px solid #e5e7eb",
                        background: "#fff",
                      }}
                    >
                      <div style={{ position: "relative" }}>
                        <img
                          src={url}
                          alt={`Q${i + 1}`}
                          style={{
                            width: "100%",
                            height: 90,
                            objectFit: "cover",
                            display: "block",
                          }}
                        />
                        <button
                          type="button"
                          onClick={() => removeFile(i)}
                          aria-label="Remove"
                          style={{
                            position: "absolute",
                            top: 4,
                            right: 4,
                            background: "rgba(0,0,0,0.55)",
                            border: "none",
                            borderRadius: "50%",
                            width: 20,
                            height: 20,
                            cursor: "pointer",
                            color: "#fff",
                            fontSize: 10,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          ✕
                        </button>
                      </div>
                      <div style={{ padding: "4px 7px" }}>
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 700,
                            color: "#1a3a6b",
                          }}
                        >
                          Q{i + 1}
                        </span>
                        <span
                          style={{
                            fontSize: 10,
                            color: "#9ca3af",
                            marginLeft: 5,
                          }}
                        >
                          {files[i]?.name.length > 14
                            ? files[i].name.slice(0, 14) + "…"
                            : files[i]?.name}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* ── RIGHT: Metadata + Answer key ── */}
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {/* Subject */}
              <div style={fieldStyle}>
                <label style={labelStyle} htmlFor="subject">
                  Subject *
                </label>
                <select
                  id="subject"
                  name="subject"
                  required
                  style={inputStyle}
                >
                  <option value="">Select subject</option>
                  <option value="physics">Physics</option>
                  <option value="chemistry">Chemistry</option>
                  <option value="mathematics">Mathematics</option>
                </select>
              </div>

              {/* Chapter (optional) */}
              <div style={fieldStyle}>
                <label style={labelStyle} htmlFor="chapter">
                  Chapter{" "}
                  <span style={{ fontWeight: 400, color: "#9ca3af" }}>
                    (optional)
                  </span>
                </label>
                <input
                  id="chapter"
                  name="chapter"
                  type="text"
                  style={inputStyle}
                  placeholder="e.g. Thermodynamics"
                />
              </div>

              {/* Type */}
              <div style={fieldStyle}>
                <label style={labelStyle} htmlFor="type">
                  Question type *
                </label>
                <select
                  id="type"
                  name="type"
                  required
                  style={inputStyle}
                  value={type}
                  onChange={(e) => setType(e.target.value as QuestionType)}
                >
                  <option value="">Select type</option>
                  <option value="scq">Single Correct (SCQ)</option>
                  <option value="mcq">Multi Correct (MCQ)</option>
                  <option value="integer">Integer</option>
                  <option value="numerical">Numerical</option>
                  <option value="paragraph">Paragraph-based</option>
                </select>
              </div>

              {/* Paragraph selector */}
              {type === "paragraph" && (
                <div style={fieldStyle}>
                  <label style={labelStyle} htmlFor="paragraph_id">
                    Paragraph *
                  </label>
                  {paragraphs.length === 0 ? (
                    <p style={{ fontSize: 13, color: "#9ca3af", margin: 0 }}>
                      No paragraphs yet.{" "}
                      <Link
                        to="/paragraphs/new"
                        style={{ color: "#1a3a6b" }}
                      >
                        Upload one first →
                      </Link>
                    </p>
                  ) : (
                    <select
                      id="paragraph_id"
                      name="paragraph_id"
                      required
                      style={inputStyle}
                    >
                      <option value="">Select paragraph</option>
                      {paragraphs.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.title ??
                            `Paragraph — ${new Date(
                              p.created_at
                            ).toLocaleDateString("en-IN")}`}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              )}

              {/* Answer key */}
              <div style={fieldStyle}>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "baseline",
                  }}
                >
                  <label style={labelStyle} htmlFor="answer_key">
                    Answer key *
                  </label>
                  {files.length > 0 && (
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 600,
                        color: countOk
                          ? "#166534"
                          : countBad
                          ? "#9a3412"
                          : "#6b7280",
                      }}
                    >
                      {answerCount} / {files.length}
                      {countOk ? " ✓" : ""}
                    </span>
                  )}
                </div>
                <textarea
                  id="answer_key"
                  name="answer_key"
                  value={answerKey}
                  onChange={(e) => setAnswerKey(e.target.value)}
                  spellCheck={false}
                  style={{
                    padding: "10px 12px",
                    border: `1px solid ${countBad ? "#fca5a5" : "#d1d5db"}`,
                    borderRadius: 6,
                    fontSize: 16,
                    fontFamily: "monospace",
                    lineHeight: "1.9",
                    width: "100%",
                    boxSizing: "border-box",
                    color: "#111827",
                    background: "#fff",
                    height: 240,
                    resize: "vertical",
                    letterSpacing: "0.03em",
                  }}
                  placeholder={
                    type
                      ? `a\nb\nc\nb\na\n…`
                      : "Select a type first"
                  }
                />
                <p style={{ margin: "4px 0 0", fontSize: 11, color: "#9ca3af" }}>
                  {answerKeyHint(type)}
                </p>
              </div>

              {/* Submit */}
              <button
                type="submit"
                disabled={files.length === 0}
                style={{
                  background: files.length === 0 ? "#e5e7eb" : "#1a3a6b",
                  color: files.length === 0 ? "#9ca3af" : "#fff",
                  border: "none",
                  borderRadius: 6,
                  padding: "11px",
                  fontSize: 14,
                  fontWeight: 500,
                  cursor: files.length === 0 ? "not-allowed" : "pointer",
                  marginTop: 4,
                }}
              >
                {files.length === 0
                  ? "Upload images first"
                  : `Save ${files.length} question${
                      files.length !== 1 ? "s" : ""
                    }`}
              </button>

              <Link
                to={folderId ? `/library/folders/${folderId}` : "/library"}
                style={{
                  fontSize: 13,
                  color: "#6b7280",
                  textDecoration: "none",
                  textAlign: "center",
                }}
              >
                Cancel
              </Link>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────

const fieldStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
};

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