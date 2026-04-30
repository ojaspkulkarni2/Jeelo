import { data, redirect, Link } from "react-router";
import { useState, useRef, useEffect } from "react";
import type { Route } from "./+types/questions.$id";
import { requireUser } from "~/lib/auth.server";
import { createServerClient } from "~/lib/supabase.server";
import { uploadImage, deleteImage } from "~/lib/storage.server";
import { Sidebar } from "~/components/sidebar";
import { IconChevronRight } from "~/components/icons";
import type { QuestionType, Subject } from "~/lib/database.types";

// ── Types ─────────────────────────────────────────────────────

type FolderOption = { id: string; name: string; path: string };

type QuestionDetail = {
  id: string;
  image_url: string;
  type: QuestionType;
  subject: Subject;
  chapter: string;
  correct_answer: unknown;
  paragraph_id: string | null;
  folder_id: string | null;
  is_shared: boolean;
};

// ── Helpers ───────────────────────────────────────────────────

/** Convert stored correct_answer back into the text format used by the form */
function serializeAnswer(answer: unknown, type: QuestionType): string {
  if (type === "scq" || type === "paragraph") {
    if (Array.isArray(answer) && answer.length > 0)
      return String(answer[0]).toLowerCase();
    return "";
  }
  if (type === "mcq") {
    if (Array.isArray(answer))
      return answer.map((a) => String(a).toLowerCase()).join(" ");
    return "";
  }
  // integer / numerical
  return answer !== null && answer !== undefined ? String(answer) : "";
}

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

function answerKeyHint(type: QuestionType | ""): string {
  if (!type) return "Select a question type above first";
  if (type === "scq" || type === "paragraph") return "a, b, c, or d";
  if (type === "mcq") return "a  or  a,b  or  a b c";
  if (type === "integer") return "Integer — e.g. 3 or -7";
  if (type === "numerical") return "Number — e.g. 3.14 or -2.5";
  return "";
}

/** Build a flat folder list with indented path labels from a raw flat list */
async function buildFolderOptions(
  supabase: ReturnType<typeof import("~/lib/supabase.server").createServerClient>,
  ownerId: string
): Promise<FolderOption[]> {
  const { data: allFolders } = await supabase
    .from("folders")
    .select("id, name, parent_id")
    .eq("owner_id", ownerId)
    .order("name", { ascending: true });

  if (!allFolders || allFolders.length === 0) return [];

  // Build name → path lookup by walking parents
  const byId: Record<string, { name: string; parent_id: string | null }> = {};
  for (const f of allFolders) byId[f.id] = f;

  function getPath(id: string, depth = 0): string {
    const f = byId[id];
    if (!f) return "";
    if (!f.parent_id || depth > 4) return f.name;
    return getPath(f.parent_id, depth + 1) + " / " + f.name;
  }

  return allFolders.map((f) => ({ id: f.id, name: f.name, path: getPath(f.id) }));
}

// ── Loader ────────────────────────────────────────────────────

export async function loader({ request, params, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const user = await requireUser(request, env);
  const supabase = createServerClient(env);
  const questionId = params.id!;

  const { data: q, error } = await supabase
    .from("questions")
    .select("id, image_url, type, subject, chapter, correct_answer, paragraph_id, folder_id, is_shared")
    .eq("id", questionId)
    .eq("owner_id", user.id)
    .single();

  if (error || !q) throw redirect("/discover");

  const [folderOptions, { data: paragraphs }] = await Promise.all([
    buildFolderOptions(supabase, user.id),
    supabase
      .from("paragraphs")
      .select("id, title, created_at")
      .eq("owner_id", user.id)
      .order("created_at", { ascending: false }),
  ]);

  return {
    user,
    question: q as QuestionDetail,
    folderOptions,
    paragraphs: paragraphs ?? [],
  };
}

// ── Action ────────────────────────────────────────────────────

export async function action({ request, params, context }: Route.ActionArgs) {
  const env = context.cloudflare.env;
  const user = await requireUser(request, env);
  const supabase = createServerClient(env);
  const questionId = params.id!;

  // Confirm ownership
  const { data: existing } = await supabase
    .from("questions")
    .select("image_url, folder_id")
    .eq("id", questionId)
    .eq("owner_id", user.id)
    .single();
  if (!existing) throw redirect("/discover");

  const formData = await request.formData();
  const subject = String(formData.get("subject") ?? "") as Subject;
  const chapter = String(formData.get("chapter") ?? "").trim();
  const type = String(formData.get("type") ?? "") as QuestionType;
  const answerRaw = String(formData.get("answer_key") ?? "").trim();
  const paragraphId = formData.get("paragraph_id") ? String(formData.get("paragraph_id")) : null;
  const folderIdRaw = formData.get("folder_id");
  // empty string means "root (no folder)"
  const folderId = folderIdRaw && String(folderIdRaw) !== "" ? String(folderIdRaw) : null;
  const newImageFile = formData.get("new_image") as File | null;

  // ── Validate ──
  if (!["physics", "chemistry", "mathematics"].includes(subject))
    return data({ error: "Select a subject" }, { status: 400 });
  if (!["scq", "mcq", "integer", "numerical", "paragraph"].includes(type))
    return data({ error: "Select a question type" }, { status: 400 });
  if (type === "paragraph" && !paragraphId)
    return data({ error: "Select a paragraph" }, { status: 400 });
  if (!answerRaw)
    return data({ error: "Answer key is required" }, { status: 400 });

  const parsed = parseAnswerLine(answerRaw, type);
  if ("error" in parsed)
    return data({ error: `Answer: ${parsed.error}` }, { status: 400 });

  // ── Optionally replace image ──
  let imageUrl = existing.image_url;
  if (newImageFile && newImageFile.size > 0) {
    if (!newImageFile.type.startsWith("image/"))
      return data({ error: "Replacement file is not an image" }, { status: 400 });
    if (newImageFile.size > 10 * 1024 * 1024)
      return data({ error: "Replacement image exceeds 10 MB" }, { status: 400 });

    const upload = await uploadImage(newImageFile, user.id, env);
    if ("error" in upload)
      return data({ error: `Upload failed: ${upload.error}` }, { status: 500 });

    // Delete old image after successful upload
    await deleteImage(existing.image_url, env);
    imageUrl = upload.publicUrl;
  }

  // ── Update DB ──
  const { error: dbError } = await supabase
    .from("questions")
    .update({
      subject,
      chapter,
      type,
      correct_answer: parsed.answer as never,
      paragraph_id: type === "paragraph" ? paragraphId : null,
      folder_id: folderId,
      image_url: imageUrl,
    })
    .eq("id", questionId)
    .eq("owner_id", user.id);

  if (dbError)
    return data({ error: dbError.message }, { status: 500 });

  const destination = "/discover";
  return redirect(destination);
}

// ── Component ─────────────────────────────────────────────────

export default function EditQuestion({ loaderData, actionData }: Route.ComponentProps) {
  const { user, question: q, folderOptions, paragraphs } = loaderData;
  const error = actionData && "error" in actionData ? actionData.error : null;

  const [type, setType] = useState<QuestionType | "">(q.type);
  const [answerKey, setAnswerKey] = useState(serializeAnswer(q.correct_answer, q.type));
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [replaceMode, setReplaceMode] = useState(false);
  const filePickerRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return () => { if (previewUrl) URL.revokeObjectURL(previewUrl); };
  }, [previewUrl]);

  function handleNewImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(URL.createObjectURL(file));
  }

  const backUrl = "/discover";

  return (
    <div className="app-layout">
      <Sidebar displayName={user.display_name} />
      <main className="app-main">
        <div className="pg-head">
          <div>
            <nav className="result-breadcrumb" style={{ marginBottom: 6 }}>
              <Link to="/discover" className="result-breadcrumb-link">Library</Link>
              <IconChevronRight size={13} />
              <Link to={backUrl} className="result-breadcrumb-link">
                {q.folder_id ? "Folder" : "Root"}
              </Link>
              <IconChevronRight size={13} />
              <span>Edit Question</span>
            </nav>
            <h1 className="pg-title">Edit Question</h1>
          </div>
        </div>

        <div className="pg-body">
          {error && <div className="alert-error" style={{ marginBottom: 20 }}>{error}</div>}

          <form method="post" encType="multipart/form-data">
            <div className="editor-two-col">

              {/* ── LEFT: Image ── */}
              <div className="editor-col">
                <div className="field">
                  <label className="label">Question image</label>
                  <div className="card" style={{ overflow: "hidden", position: "relative", padding: 0 }}>
                    <img
                      src={previewUrl ?? q.image_url}
                      alt="Question"
                      style={{ width: "100%", maxHeight: 480, objectFit: "contain", display: "block", background: "var(--c-subtle)" }}
                    />
                    {previewUrl && (
                      <div style={{
                        position: "absolute", top: 8, left: 8,
                        background: "var(--c-success)", color: "#fff",
                        fontSize: 11, fontWeight: 600,
                        padding: "3px 8px", borderRadius: "var(--r-xs)",
                      }}>
                        New image preview
                      </div>
                    )}
                  </div>

                  <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 4 }}>
                    {!replaceMode ? (
                      <button type="button" className="btn btn-ghost btn-sm"
                        onClick={() => { setReplaceMode(true); setTimeout(() => filePickerRef.current?.click(), 50); }}>
                        Replace image
                      </button>
                    ) : (
                      <>
                        <button type="button" className="btn btn-ghost btn-sm"
                          onClick={() => filePickerRef.current?.click()}>
                          Choose file
                        </button>
                        <button type="button" className="btn btn-ghost btn-sm"
                          onClick={() => {
                            setReplaceMode(false);
                            if (previewUrl) { URL.revokeObjectURL(previewUrl); setPreviewUrl(null); }
                            if (filePickerRef.current) filePickerRef.current.value = "";
                          }}>
                          Cancel
                        </button>
                        {previewUrl && <span style={{ fontSize: 12, color: "var(--c-success)" }}>✓ Selected</span>}
                      </>
                    )}
                  </div>

                  {replaceMode && (
                    <input ref={filePickerRef} type="file" name="new_image" accept="image/*"
                      style={{ display: "none" }} onChange={handleNewImage} />
                  )}
                </div>
              </div>

              {/* ── RIGHT: Metadata ── */}
              <div className="editor-col">
                <div className="field">
                  <label className="label" htmlFor="eq-subject">Subject *</label>
                  <select id="eq-subject" name="subject" required className="input" defaultValue={q.subject}>
                    <option value="">Select subject</option>
                    <option value="physics">Physics</option>
                    <option value="chemistry">Chemistry</option>
                    <option value="mathematics">Mathematics</option>
                  </select>
                </div>

                <div className="field">
                  <label className="label" htmlFor="eq-chapter">
                    Chapter <span style={{ fontWeight: 400, color: "var(--c-text-3)" }}>(optional)</span>
                  </label>
                  <input id="eq-chapter" name="chapter" type="text" className="input"
                    defaultValue={q.chapter ?? ""} placeholder="e.g. Thermodynamics" />
                </div>

                <div className="field">
                  <label className="label" htmlFor="eq-type">Question type *</label>
                  <select id="eq-type" name="type" required className="input" value={type}
                    onChange={(e) => { setType(e.target.value as QuestionType); setAnswerKey(""); }}>
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
                    <label className="label" htmlFor="eq-para">Paragraph *</label>
                    {paragraphs.length === 0 ? (
                      <p style={{ fontSize: 13, color: "var(--c-text-3)", margin: 0 }}>
                        No paragraphs yet.{" "}
                        <Link to="/paragraphs/new" style={{ color: "var(--c-brand-500)" }}>Upload one first →</Link>
                      </p>
                    ) : (
                      <select id="eq-para" name="paragraph_id" required className="input" defaultValue={q.paragraph_id ?? ""}>
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
                  <label className="label" htmlFor="eq-answer">Answer *</label>
                  <input id="eq-answer" name="answer_key" type="text" value={answerKey}
                    onChange={(e) => setAnswerKey(e.target.value)}
                    className="input"
                    style={{ fontFamily: "monospace", fontSize: 16, letterSpacing: "0.04em" }}
                    placeholder={type ? answerKeyHint(type) : "Select a type first"}
                    spellCheck={false} />
                  <p style={{ margin: "3px 0 0", fontSize: 11, color: "var(--c-text-3)" }}>
                    {answerKeyHint(type)}
                  </p>
                </div>

                <div className="field">
                  <label className="label" htmlFor="eq-folder">Folder</label>
                  <select id="eq-folder" name="folder_id" className="input" defaultValue={q.folder_id ?? ""}>
                    <option value="">Root (no folder)</option>
                    {folderOptions.map((f) => (
                      <option key={f.id} value={f.id}>{f.path}</option>
                    ))}
                  </select>
                </div>

                <hr style={{ border: "none", borderTop: "1px solid var(--c-border)", margin: "4px 0" }} />

                <button type="submit" className="btn btn-primary" style={{ width: "100%", justifyContent: "center" }}>
                  Save changes
                </button>
                <Link to={backUrl} className="btn btn-ghost" style={{ width: "100%", justifyContent: "center" }}>
                  Cancel
                </Link>
              </div>
            </div>
          </form>
        </div>
      </main>
    </div>
  );
}
