import { Form, Link } from "react-router";
import type { Section, QuestionRow } from "./types";
import { btnPrimary, btnSecondary, SUBJECT_META, TYPE_META } from "./styles";

// ── PickerCard (private — only used within QuestionPickerPanel) ─

function PickerCard({ question: q, sectionId }: { question: QuestionRow; sectionId: string }) {
  return (
    <div style={{ border: "1px solid var(--c-brand-200)", borderRadius: 8, overflow: "hidden", background: "var(--c-surface)" }}>
      <div style={{ height: 110, display: "flex", alignItems: "center", justifyContent: "center", background: "var(--c-bg)", borderBottom: "1px solid var(--c-border)" }}>
        <img src={q.image_url} alt="Question" style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />
      </div>
      <div style={{ padding: "7px 8px" }}>
        <p style={{ margin: "0 0 6px", fontSize: 11, color: "var(--c-text-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {q.chapter || <span style={{ color: "var(--c-text-3)" }}>No chapter</span>}
        </p>
        <Form method="post">
          <input type="hidden" name="intent" value="add_question" />
          <input type="hidden" name="section_id" value={sectionId} />
          <input type="hidden" name="question_id" value={q.id} />
          <button type="submit" style={{ ...btnPrimary, fontSize: 11, padding: "4px 0", width: "100%", justifyContent: "center" }}>
            + Add
          </button>
        </Form>
      </div>
    </div>
  );
}

// ── QuestionPickerPanel ─────────────────────────────────────────

export function QuestionPickerPanel({
  section,
  testId: _testId,
  questions,
  folders,
  onClose,
}: {
  section: Section;
  testId: string;
  questions: QuestionRow[];
  folders: { id: string; name: string; displayName: string; count: number }[];
  onClose: () => void;
}) {
  const subjMeta = SUBJECT_META[section.subject];
  const typeMeta = TYPE_META[section.question_type];

  return (
    <div style={{ borderTop: "2px solid var(--c-brand-100)", background: "var(--c-subtle)", padding: "16px 20px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: "var(--c-brand-600)" }}>
          Add Questions to {section.name}
          <span style={{ fontWeight: 400, color: "var(--c-text-2)", marginLeft: 8 }}>
            {"— showing your "}
            <span style={{ color: subjMeta.text }}>{subjMeta.label}</span>
            {" / "}
            <span style={{ color: typeMeta.text }}>{typeMeta.label}</span>
            {" questions not yet in this section"}
          </span>
        </p>
        <button type="button" onClick={onClose} style={{ ...btnSecondary, fontSize: 12, padding: "4px 10px" }}>
          Close picker
        </button>
      </div>

      {folders.length > 0 && (
        <div style={{ marginBottom: 16, padding: "10px 14px", background: "var(--c-surface)", border: "1px solid var(--c-brand-200)", borderRadius: 8 }}>
          <p style={{ margin: "0 0 8px", fontSize: 11, fontWeight: 600, color: "var(--c-text-3)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Add by folder
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {folders.map((f) => (
              <Form key={f.id} method="post" style={{ display: "contents" }}>
                <input type="hidden" name="intent"     value="add_folder" />
                <input type="hidden" name="section_id" value={section.id} />
                <input type="hidden" name="folder_id"  value={f.id} />
                <button
                  type="submit"
                  title={`Add all ${f.count} question${f.count !== 1 ? "s" : ""} from "${f.displayName}"`}
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 6,
                    background: "var(--c-brand-50)", color: "var(--c-brand-700)",
                    border: "1px solid var(--c-brand-200)", borderRadius: 6,
                    padding: "5px 12px", fontSize: 12, fontWeight: 500,
                    cursor: "pointer", whiteSpace: "nowrap",
                  }}
                >
                  {f.displayName}
                  <span style={{ background: "var(--c-brand-200)", color: "var(--c-brand-700)", borderRadius: 10, padding: "1px 6px", fontSize: 11, fontWeight: 600 }}>
                    +{f.count}
                  </span>
                </button>
              </Form>
            ))}
          </div>
        </div>
      )}

      {questions.length === 0 ? (
        <div style={{ textAlign: "center", padding: "24px 0", color: "var(--c-text-3)", fontSize: 13 }}>
          No available questions match this section's type and subject.{" "}
          <Link to="/questions/new" style={{ color: "var(--c-brand-500)" }} target="_blank" rel="noopener noreferrer">
            Upload more →
          </Link>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 10 }}>
          {questions.map((q) => (
            <PickerCard key={q.id} question={q} sectionId={section.id} />
          ))}
        </div>
      )}
    </div>
  );
}
