import { data, redirect, Link } from "react-router";
import { useState, useRef, useEffect } from "react";
import type { Route } from "./+types/admin.questions.new";
import { requireAdmin } from "~/lib/auth.server";
import { createServerClient } from "~/lib/supabase.server";
import { uploadImage } from "~/lib/storage.server";
import { AdminNav } from "~/components/admin-nav";
import type { QuestionType, Subject } from "~/lib/database.types";

// ── Loader ────────────────────────────────────────────────────

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const user = await requireAdmin(request, env);
  const supabase = createServerClient(env);

  // Load existing paragraphs so admin can link a question to one
  const { data: paragraphs } = await supabase
    .from("paragraphs")
    .select("id, title, image_url, created_at")
    .eq("owner_id", user.id)
    .order("created_at", { ascending: false });

  return { user, paragraphs: paragraphs ?? [] };
}

// ── Action ────────────────────────────────────────────────────

export async function action({ request, context }: Route.ActionArgs) {
  const env = context.cloudflare.env;
  const user = await requireAdmin(request, env);
  const formData = await request.formData();

  const imageFile = formData.get("image") as File | null;
  const subject = String(formData.get("subject") ?? "") as Subject;
  const chapter = String(formData.get("chapter") ?? "").trim();
  const type = String(formData.get("type") ?? "") as QuestionType;
  const paragraphId = formData.get("paragraph_id")
    ? String(formData.get("paragraph_id"))
    : null;

  // Validate image
  if (!imageFile || imageFile.size === 0)
    return data({ error: "Question image is required" }, { status: 400 });

  if (!imageFile.type.startsWith("image/"))
    return data({ error: "File must be an image (PNG, JPG, WEBP)" }, { status: 400 });

  if (imageFile.size > 10 * 1024 * 1024)
    return data({ error: "Image must be under 10 MB" }, { status: 400 });

  if (!["physics", "chemistry", "mathematics"].includes(subject))
    return data({ error: "Select a subject" }, { status: 400 });

  if (!chapter)
    return data({ error: "Chapter name is required" }, { status: 400 });

  if (!["scq", "mcq", "integer", "numerical", "paragraph"].includes(type))
    return data({ error: "Select a question type" }, { status: 400 });

  // Build correct_answer based on type
  let correctAnswer: unknown;

  if (type === "scq") {
    const opt = formData.get("answer_option");
    if (!opt) return data({ error: "Select the correct option (A / B / C / D)" }, { status: 400 });
    correctAnswer = [String(opt)];

  } else if (type === "mcq") {
    const opts = formData.getAll("answer_option").map(String);
    if (opts.length === 0)
      return data({ error: "Select at least one correct option" }, { status: 400 });
    correctAnswer = opts;

  } else if (type === "integer") {
    const val = formData.get("answer_number");
    if (val === null || val === "")
      return data({ error: "Enter the correct integer answer" }, { status: 400 });
    const parsed = parseInt(String(val), 10);
    if (isNaN(parsed))
      return data({ error: "Integer answer must be a valid number" }, { status: 400 });
    correctAnswer = parsed;

  } else if (type === "numerical") {
    const val = formData.get("answer_number");
    if (val === null || val === "")
      return data({ error: "Enter the correct numerical answer" }, { status: 400 });
    const parsed = parseFloat(String(val));
    if (isNaN(parsed))
      return data({ error: "Numerical answer must be a valid number" }, { status: 400 });
    correctAnswer = parsed;

  } else if (type === "paragraph") {
    if (!paragraphId)
      return data({ error: "Select a paragraph for this question" }, { status: 400 });
    const opts = formData.getAll("answer_option").map(String);
    if (opts.length === 0)
      return data({ error: "Select the correct answer option(s)" }, { status: 400 });
    correctAnswer = opts;
  }

  // Upload image to Supabase Storage
  const uploadResult = await uploadImage(imageFile, user.id, env);
  if ("error" in uploadResult)
    return data({ error: `Image upload failed: ${uploadResult.error}` }, { status: 500 });

  // Insert into DB
  const supabase = createServerClient(env);
  const { error: dbError } = await supabase.from("questions").insert({
    owner_id: user.id,
    image_url: uploadResult.publicUrl,
    type,
    subject,
    chapter,
    correct_answer: correctAnswer,
    paragraph_id: paragraphId,
  });

  if (dbError)
    return data({ error: dbError.message }, { status: 500 });

  return redirect("/admin/questions");
}

// ── Sub-component: dynamic answer section ─────────────────────

const OPTIONS = ["A", "B", "C", "D"];

function AnswerSection({ type }: { type: QuestionType | "" }) {
  if (!type) return null;

  if (type === "scq") {
    return (
      <div style={answerBoxStyle}>
        <p style={answerLabelStyle}>Correct option</p>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          {OPTIONS.map((opt) => (
            <label key={opt} style={radioLabelStyle}>
              <input type="radio" name="answer_option" value={opt} required />
              <span style={optBadgeStyle}>{opt}</span>
            </label>
          ))}
        </div>
      </div>
    );
  }

  if (type === "mcq" || type === "paragraph") {
    return (
      <div style={answerBoxStyle}>
        <p style={answerLabelStyle}>
          Correct option(s){type === "mcq" ? " — select all that apply" : ""}
        </p>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          {OPTIONS.map((opt) => (
            <label key={opt} style={radioLabelStyle}>
              <input type="checkbox" name="answer_option" value={opt} />
              <span style={optBadgeStyle}>{opt}</span>
            </label>
          ))}
        </div>
      </div>
    );
  }

  if (type === "integer") {
    return (
      <div style={fieldStyle}>
        <label style={labelStyle}>Correct integer answer</label>
        <input
          type="number"
          name="answer_number"
          step="1"
          required
          style={{ ...inputStyle, width: 120 }}
          placeholder="e.g. 3"
        />
        <p style={hintStyle}>Enter the exact integer the student must type.</p>
      </div>
    );
  }

  if (type === "numerical") {
    return (
      <div style={fieldStyle}>
        <label style={labelStyle}>Correct numerical answer</label>
        <input
          type="number"
          name="answer_number"
          step="any"
          required
          style={{ ...inputStyle, width: 160 }}
          placeholder="e.g. 3.14"
        />
        <p style={hintStyle}>Decimal accepted. Exact match required for full marks.</p>
      </div>
    );
  }

  return null;
}

// ── Component ─────────────────────────────────────────────────

export default function NewQuestion({ loaderData, actionData }: Route.ComponentProps) {
  const { user, paragraphs } = loaderData;
  const error = actionData && "error" in actionData ? actionData.error : null;

  const [type, setType] = useState<QuestionType | "">("");
  const [preview, setPreview] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Revoke the previous object URL whenever preview changes, and on unmount.
  // Prevents blob URL accumulation in browser memory.
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
      <AdminNav displayName={user.display_name} />

      <div style={{ maxWidth: 940, margin: "0 auto", padding: "28px 24px" }}>
        {/* Breadcrumb */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 24 }}>
          <Link to="/admin/questions" style={{ color: "#6b7280", textDecoration: "none", fontSize: 13 }}>
            ← Questions
          </Link>
          <span style={{ color: "#d1d5db" }}>›</span>
          <h1 style={{ margin: 0, fontSize: 18, fontWeight: 600, color: "#111827" }}>
            Add Question
          </h1>
        </div>

        <form method="post" encType="multipart/form-data">
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
              gridTemplateColumns: "1fr 1fr",
              gap: 24,
              alignItems: "start",
            }}
          >
            {/* ── Left: Image upload ── */}
            <div>
              <label style={{ ...labelStyle, display: "block", marginBottom: 8 }}>
                Question image *
              </label>

              {/* Drop zone */}
              <div
                role="button"
                tabIndex={0}
                style={{
                  border: `2px dashed ${isDragging ? "#1a3a6b" : "#d1d5db"}`,
                  borderRadius: 8,
                  background: isDragging ? "#eef2ff" : "#fff",
                  minHeight: 240,
                  display: "flex",
                  flexDirection: "column",
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
                    style={{ width: "100%", maxHeight: 360, objectFit: "contain" }}
                  />
                ) : (
                  <div style={{ textAlign: "center", padding: 32 }}>
                    <div style={{ fontSize: 36, marginBottom: 10 }}>📷</div>
                    <p style={{ margin: "0 0 4px", fontSize: 14, color: "#374151", fontWeight: 500 }}>
                      Click or drag image here
                    </p>
                    <p style={{ margin: 0, fontSize: 12, color: "#9ca3af" }}>
                      PNG, JPG, WEBP
                    </p>
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

            {/* ── Right: Metadata ── */}
            <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>

              {/* Subject */}
              <div style={fieldStyle}>
                <label style={labelStyle} htmlFor="subject">Subject *</label>
                <select id="subject" name="subject" required style={inputStyle}>
                  <option value="">Select subject</option>
                  <option value="physics">Physics</option>
                  <option value="chemistry">Chemistry</option>
                  <option value="mathematics">Mathematics</option>
                </select>
              </div>

              {/* Chapter */}
              <div style={fieldStyle}>
                <label style={labelStyle} htmlFor="chapter">Chapter *</label>
                <input
                  id="chapter"
                  name="chapter"
                  type="text"
                  required
                  style={inputStyle}
                  placeholder="e.g. Thermodynamics"
                />
              </div>

              {/* Type */}
              <div style={fieldStyle}>
                <label style={labelStyle} htmlFor="type">Question type *</label>
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

              {/* Paragraph selector — only shown when type = paragraph */}
              {type === "paragraph" && (
                <div style={fieldStyle}>
                  <label style={labelStyle} htmlFor="paragraph_id">Paragraph *</label>
                  {paragraphs.length === 0 ? (
                    <p style={{ fontSize: 13, color: "#9ca3af", margin: 0 }}>
                      No paragraphs yet.{" "}
                      <Link to="/admin/paragraphs/new" style={{ color: "#1a3a6b" }}>
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
                            `Paragraph — ${new Date(p.created_at).toLocaleDateString("en-IN")}`}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              )}

              {/* Dynamic answer section */}
              <AnswerSection type={type} />
            </div>
          </div>

          {/* Submit */}
          <div style={{ marginTop: 28, display: "flex", gap: 12, alignItems: "center" }}>
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
              Save Question
            </button>
            <Link
              to="/admin/questions"
              style={{ fontSize: 14, color: "#6b7280", textDecoration: "none" }}
            >
              Cancel
            </Link>
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

const answerBoxStyle: React.CSSProperties = {
  border: "1px solid #e5e7eb",
  borderRadius: 8,
  padding: "14px 16px",
  background: "#f9fafb",
};

const answerLabelStyle: React.CSSProperties = {
  margin: "0 0 12px",
  fontSize: 12,
  fontWeight: 600,
  color: "#6b7280",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
};

const radioLabelStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: 4,
  cursor: "pointer",
  userSelect: "none",
};

const optBadgeStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 36,
  height: 36,
  borderRadius: "50%",
  background: "#fff",
  border: "1px solid #d1d5db",
  fontSize: 14,
  fontWeight: 600,
  color: "#374151",
};

const hintStyle: React.CSSProperties = {
  margin: "4px 0 0",
  fontSize: 12,
  color: "#9ca3af",
};
