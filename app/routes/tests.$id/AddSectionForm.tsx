import { useState, useRef, useEffect } from "react";
import { useFetcher } from "react-router";
import type { QuestionType } from "~/lib/database.types";
import { btnPrimary, labelStyle, inputStyle, TYPE_META } from "./styles";

// ── Helpers ────────────────────────────────────────────────────

function countAnswerLines(raw: string): number {
  return raw.split("\n").filter((l) => l.trim()).length;
}

function answerKeyHint(type: QuestionType | ""): string {
  if (!type) return "Select a question type above first";
  if (type === "scq" || type === "paragraph") return "One line per question — a, b, c, or d";
  if (type === "mcq") return "One line per question — a  or  a,b  or  a b c";
  if (type === "integer") return "One integer per line — e.g.  3  or  -7";
  if (type === "numerical") return "One number per line — e.g.  3.14  or  -2.5";
  return "";
}

// ── AddSectionForm ─────────────────────────────────────────────

export function AddSectionForm({ testId: _ }: { testId: string }) {
  const fetcher = useFetcher();
  const [qType, setQType] = useState<QuestionType | "">("");
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [answerKey, setAnswerKey] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [clientError, setClientError] = useState<string | null>(null);
  const [formKey, setFormKey] = useState(0);
  const [paraFile, setParaFile] = useState<File | null>(null);
  const [paraPreview, setParaPreview] = useState<string | null>(null);

  const isSubmitting = fetcher.state !== 'idle';
  const serverError = (fetcher.data as any)?.error ?? null;
  // Don't show a stale server error while a new submission is in-flight
  const error = isSubmitting ? clientError : (clientError ?? serverError);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const addMoreRef   = useRef<HTMLInputElement>(null);
  const folderRef    = useRef<HTMLInputElement>(null);
  const paraFileRef  = useRef<HTMLInputElement>(null);

  const defaultMarks: Record<QuestionType, { correct: number; wrong: number; partial: string }> = {
    scq:       { correct: 4, wrong: -1,  partial: "" },
    mcq:       { correct: 4, wrong: -2,  partial: "1" },
    integer:   { correct: 4, wrong: 0,   partial: "" },
    numerical: { correct: 4, wrong: 0,   partial: "" },
    paragraph: { correct: 3, wrong: -1,  partial: "" },
  };
  const defaults = qType ? defaultMarks[qType] : { correct: 4, wrong: -1, partial: "" };

  useEffect(() => {
    const urls = files.map((f) => URL.createObjectURL(f));
    setPreviews(urls);
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
  }, [files]);

  // Reset form after a successful submission
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data !== undefined) {
      const d = fetcher.data as any;
      if (!d?.error) {
        setFiles([]);
        if (fileInputRef.current) {
          const dt = new DataTransfer();
          fileInputRef.current.files = dt.files;
        }
        setAnswerKey("");
        setQType("");
        setClientError(null);
        setParaFile(null);
        setParaPreview(null);
        if (paraFileRef.current) {
          const dt = new DataTransfer();
          paraFileRef.current.files = dt.files;
        }
        setFormKey((k) => k + 1); // forces uncontrolled inputs to reset
      }
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

    // .txt in the batch → auto-populate answer key
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

  function handleParaFile(f: File) {
    setParaFile(f);
    const url = URL.createObjectURL(f);
    setParaPreview(url);
    if (paraFileRef.current) {
      const dt = new DataTransfer();
      dt.items.add(f);
      paraFileRef.current.files = dt.files;
    }
  }

  function clearPara() {
    setParaFile(null);
    setParaPreview(null);
    if (paraFileRef.current) {
      const dt = new DataTransfer();
      paraFileRef.current.files = dt.files;
    }
  }

  const MAX_IMAGES = 40; // Cloudflare Workers: ~50 subrequest limit; images + 5 DB ops must stay under it
  const answerCount = countAnswerLines(answerKey);
  const countOk  = files.length > 0 && answerCount === files.length;
  const countBad = files.length > 0 && answerCount > 0 && answerCount !== files.length;

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setClientError(null);

    if (files.length > MAX_IMAGES) {
      setClientError(`Max ${MAX_IMAGES} images per section — split into multiple sections if needed`);
      return;
    }

    if (files.length > 0 && !countOk) {
      setClientError(
        `${answerCount} answer line${answerCount !== 1 ? "s" : ""} but ${files.length} image${files.length !== 1 ? "s" : ""} — counts must match`
      );
      return;
    }

    if (qType === "paragraph" && !paraFile) {
      setClientError("A passage image is required for paragraph-based sections");
      return;
    }

    const fd = new FormData(e.currentTarget);
    fetcher.submit(fd, { method: "post", encType: "multipart/form-data" });
  }

  return (
    <div style={{
      marginTop: 24,
      background: "var(--c-surface)",
      border: "1px solid var(--c-border)",
      borderRadius: 10,
      overflow: "hidden",
    }}>
      {/* Header */}
      <div style={{
        padding: "12px 20px",
        borderBottom: "1px solid var(--c-border)",
        background: "var(--c-subtle)",
      }}>
        <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: "var(--c-text-2)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
          + Add Section
        </p>
      </div>

      <form
        key={formKey}
        method="post"
        encType="multipart/form-data"
        onSubmit={handleSubmit}
        style={{ padding: "20px 24px" }}
      >
        <input type="hidden" name="intent" value="add_section" />

        {/* Hidden real file input for submission */}
        <input ref={fileInputRef} type="file" name="images" multiple accept="image/*" style={{ display: "none" }} onChange={() => {}} />
        {/* Image-only picker */}
        <input ref={addMoreRef} type="file" multiple accept="image/*" style={{ display: "none" }}
          onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ""; }} />
        {/* Folder picker — no accept filter so .txt comes through too */}
        <input ref={folderRef} type="file"
          // @ts-ignore
          webkitdirectory="" multiple style={{ display: "none" }}
          onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ""; }} />
        {/* Hidden passage image input (paragraph type only) */}
        <input ref={paraFileRef} type="file" name="paragraph_image" accept="image/*" style={{ display: "none" }}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleParaFile(f); }} />

        {error && (
          <div className="alert-error" style={{ marginBottom: 16, fontSize: 13 }}>{error}</div>
        )}

        {/* ── Section metadata row ── */}
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr", gap: 12, marginBottom: 14 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <label style={labelStyle}>Section name *</label>
            <input name="name" required placeholder="e.g. Physics — SCQ" style={inputStyle} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <label style={labelStyle}>Subject *</label>
            <select name="subject" required style={inputStyle}>
              <option value="">Select</option>
              <option value="physics">Physics</option>
              <option value="chemistry">Chemistry</option>
              <option value="mathematics">Mathematics</option>
            </select>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <label style={labelStyle}>Question type *</label>
            <select name="question_type" required value={qType}
              onChange={(e) => setQType(e.target.value as QuestionType)} style={inputStyle}>
              <option value="">Select</option>
              <option value="scq">Single Correct (SCQ)</option>
              <option value="mcq">Multiple Correct (MCQ)</option>
              <option value="integer">Integer</option>
              <option value="numerical">Numerical</option>
              <option value="paragraph">Paragraph-based</option>
            </select>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <label style={labelStyle}>Chapter *</label>
            <input name="chapter" required placeholder="e.g. Thermodynamics" style={inputStyle} />
          </div>
        </div>

        {/* ── Marks row ── */}
        <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap", marginBottom: 20 }}>
          <div style={{ width: 130, display: "flex", flexDirection: "column", gap: 5 }}>
            <label style={labelStyle}>Marks (correct)</label>
            <input name="marks_correct" type="number" step="0.5" key={`c-${qType}`} defaultValue={defaults.correct} style={inputStyle} />
          </div>
          <div style={{ width: 130, display: "flex", flexDirection: "column", gap: 5 }}>
            <label style={labelStyle}>Negative marking</label>
            <input name="marks_wrong" type="number" step="0.5" key={`w-${qType}`} defaultValue={defaults.wrong} style={inputStyle} />
          </div>
          {qType === "mcq" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 5, justifyContent: "flex-end" }}>
              <label style={labelStyle}>Partial marking</label>
              <label style={{ display: "flex", alignItems: "center", gap: 8, height: 36, cursor: "pointer", userSelect: "none" }}>
                <input type="checkbox" name="marks_partial" value="1" defaultChecked={!!defaults.partial}
                  style={{ width: 15, height: 15, accentColor: "var(--c-brand-500)", cursor: "pointer" }} />
                <span style={{ fontSize: 13, color: "var(--c-text-2)" }}>+1 per correct option</span>
              </label>
            </div>
          )}
          {qType && (
            <p style={{ margin: "0 0 4px", fontSize: 11, color: "var(--c-text-3)", alignSelf: "flex-end" }}>
              JEE default: {defaults.correct > 0 ? `+${defaults.correct}` : defaults.correct} correct
              {defaults.wrong !== 0 ? `, ${defaults.wrong} wrong` : ", 0 negative"}
              {defaults.partial ? `, +${defaults.partial} partial` : ""}
            </p>
          )}
        </div>

        {/* ── Paragraph passage uploader ── */}
        {qType === "paragraph" && (
          <div style={{ marginBottom: 20 }}>
            <label style={labelStyle}>Passage image *</label>
            {paraPreview ? (
              <div style={{ position: "relative", display: "inline-block", marginTop: 6 }}>
                <img
                  src={paraPreview}
                  alt="Passage preview"
                  style={{ maxWidth: "100%", maxHeight: 220, objectFit: "contain", borderRadius: 6, border: "1px solid var(--c-border)", display: "block" }}
                />
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  style={{ position: "absolute", top: 6, right: 6 }}
                  onClick={clearPara}
                >
                  Remove
                </button>
              </div>
            ) : (
              <div
                className="upload-zone"
                style={{ minHeight: 100, cursor: "pointer", marginTop: 6 }}
                onClick={() => paraFileRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleParaFile(f); }}
              >
                <div className="upload-zone-inner">
                  <p className="upload-zone-text">Click or drag the passage image here</p>
                  <p className="upload-zone-sub">PNG, JPG, WEBP</p>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Images + answer key ── */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 20 }}>

          {/* Left — image drop zone */}
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <label style={labelStyle}>
                Question images
                {files.length > 0
                  ? <span style={{ fontWeight: 400, color: "var(--c-text-3)", marginLeft: 4 }}>({files.length} selected)</span>
                  : <span style={{ fontWeight: 400, color: "var(--c-text-3)", marginLeft: 4 }}>(optional — add later)</span>
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
              <label style={labelStyle}>
                Answer key
                {files.length > 0 ? " *" : <span style={{ fontWeight: 400, color: "var(--c-text-3)", marginLeft: 4 }}>(required if images uploaded)</span>}
              </label>
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
              placeholder={qType ? "a\nb\nc\n…" : "Select a question type first"}
              style={{ flex: 1, minHeight: 200, resize: "vertical" }}
            />
            <p style={{ margin: "2px 0 0", fontSize: 11, color: "var(--c-text-3)" }}>
              {answerKeyHint(qType)}
            </p>
            <p style={{ margin: "2px 0 0", fontSize: 11, color: "var(--c-text-3)" }}>
              Include <code style={{ fontSize: 10 }}>answers.txt</code> in your folder to auto-fill this.
            </p>
          </div>
        </div>

        {/* ── Submit ── */}
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <button
            type="submit"
            style={{ ...btnPrimary, opacity: isSubmitting ? 0.6 : 1, cursor: isSubmitting ? "not-allowed" : "pointer" }}
            disabled={isSubmitting}
          >
            {isSubmitting
              ? "Creating…"
              : files.length > 0
              ? `Create section + upload ${files.length} question${files.length !== 1 ? "s" : ""}`
              : "Create section"}
          </button>
          {files.length === 0 && (
            <span style={{ fontSize: 12, color: "var(--c-text-3)" }}>
              You can add questions to the section afterwards too.
            </span>
          )}
        </div>
      </form>
    </div>
  );
}
