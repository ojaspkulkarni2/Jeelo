import { Form, useFetcher } from "react-router";
import { useState } from "react";
import { DotMenu } from "~/components/three-dot-menu";
import type { Section, SectionQuestion, QuestionRow } from "./types";
import { btnPrimary, btnSecondary, arrowBtn, badge, labelStyle, inputStyle, SUBJECT_META, TYPE_META } from "./styles";
import { QuestionPickerPanel } from "./QuestionPickerPanel";

// ── QuestionThumbnail (private — only used within SectionCard) ──

function QuestionThumbnail({
  question: q,
  sectionId,
  index,
  total,
}: {
  question: SectionQuestion;
  sectionId: string;
  index: number;
  total: number;
}) {
  return (
    <div style={{ border: "1px solid var(--c-border)", borderRadius: 8, overflow: "hidden", background: "var(--c-subtle)" }}>
      <div style={{ height: 110, display: "flex", alignItems: "center", justifyContent: "center", background: "var(--c-bg)", borderBottom: "1px solid var(--c-border)" }}>
        <img src={q.image_url} alt={`Q${index + 1}`} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />
      </div>
      <div style={{ padding: "6px 8px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: "var(--c-brand-500)" }}>Q{index + 1}</span>
        <div style={{ display: "flex", gap: 2 }}>
          <Form method="post">
            <input type="hidden" name="intent" value="move_up" />
            <input type="hidden" name="section_id" value={sectionId} />
            <input type="hidden" name="question_id" value={q.id} />
            <button type="submit" disabled={index === 0} title="Move up" style={{ ...arrowBtn, opacity: index === 0 ? 0.25 : 1 }}>↑</button>
          </Form>
          <Form method="post">
            <input type="hidden" name="intent" value="move_down" />
            <input type="hidden" name="section_id" value={sectionId} />
            <input type="hidden" name="question_id" value={q.id} />
            <button type="submit" disabled={index === total - 1} title="Move down" style={{ ...arrowBtn, opacity: index === total - 1 ? 0.25 : 1 }}>↓</button>
          </Form>
          <Form method="post">
            <input type="hidden" name="intent" value="remove_question" />
            <input type="hidden" name="section_id" value={sectionId} />
            <input type="hidden" name="question_id" value={q.id} />
            <button type="submit" title="Remove from section" style={{ ...arrowBtn, color: "var(--c-error)" }}>✕</button>
          </Form>
        </div>
      </div>
    </div>
  );
}

// ── SectionCard ─────────────────────────────────────────────────

export function SectionCard({
  section,
  testId,
  isPicking,
  pickerQuestions,
  pickerFolders,
  pickerUsedElsewhere,
  onOpenPicker,
  onClosePicker,
}: {
  section: Section;
  testId: string;
  isPicking: boolean;
  pickerQuestions: QuestionRow[];
  pickerFolders: { id: string; name: string; displayName: string; count: number }[];
  pickerUsedElsewhere: QuestionRow[];
  onOpenPicker: () => void;
  onClosePicker: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const sectionEditFetcher = useFetcher();
  const sectionDeleteFetcher = useFetcher();
  const subjMeta = SUBJECT_META[section.subject];
  const typeMeta = TYPE_META[section.question_type];

  const markingStr = (() => {
    const pos = `+${section.marks_correct}`;
    const neg = section.marks_wrong !== 0 ? ` / ${section.marks_wrong}` : " / 0";
    const partial = section.marks_partial != null ? " / +1 per correct option" : "";
    return pos + neg + partial;
  })();

  function handleDeleteSection() {
    if (!confirm(`Delete section "${section.name}"?`)) return;
    const fd = new FormData();
    fd.set("intent", "delete_section");
    fd.set("section_id", section.id);
    sectionDeleteFetcher.submit(fd, { method: "post" });
  }

  type MI = import("~/components/three-dot-menu").MenuItem;
  const sectionMenuItems: MI[] = [
    { type: "action", label: "Edit section", onClick: () => setEditing(true) },
    { type: "sep" },
    { type: "action", label: "Delete section", danger: true, onClick: handleDeleteSection },
  ];

  return (
    <div style={{ background: "var(--c-surface)", border: "1px solid var(--c-border)", borderRadius: 10, overflow: "hidden" }}>
      {editing ? (
        <sectionEditFetcher.Form method="post"
          style={{ padding: "14px 20px", borderBottom: "1px solid var(--c-border)", display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          <input type="hidden" name="intent" value="edit_section" />
          <input type="hidden" name="section_id" value={section.id} />
          <div style={{ flex: 2, minWidth: 160, display: "flex", flexDirection: "column", gap: 4 }}>
            <label style={labelStyle}>Section name</label>
            <input name="name" defaultValue={section.name} required style={inputStyle} autoFocus />
          </div>
          <div style={{ width: 120, display: "flex", flexDirection: "column", gap: 4 }}>
            <label style={labelStyle}>Marks (correct)</label>
            <input name="marks_correct" type="number" step="0.5" defaultValue={section.marks_correct} style={inputStyle} />
          </div>
          <div style={{ width: 130, display: "flex", flexDirection: "column", gap: 4 }}>
            <label style={labelStyle}>Negative marking</label>
            <input name="marks_wrong" type="number" step="0.5" defaultValue={section.marks_wrong} style={inputStyle} />
          </div>
          <button type="submit" style={btnPrimary} disabled={sectionEditFetcher.state !== "idle"}>
            {sectionEditFetcher.state !== "idle" ? "Saving…" : "Save"}
          </button>
          <button type="button" onClick={() => setEditing(false)} style={btnSecondary}>Cancel</button>
        </sectionEditFetcher.Form>
      ) : (
        <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--c-border)", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: "var(--c-text)" }}>
              {section.name}
            </p>
            <div style={{ display: "flex", gap: 6, marginTop: 5, flexWrap: "wrap" }}>
              <span style={{ ...badge, background: subjMeta.bg, color: subjMeta.text }}>{subjMeta.label}</span>
              <span style={{ ...badge, background: typeMeta.bg, color: typeMeta.text }}>{typeMeta.label}</span>
              <span style={{ ...badge, background: "var(--c-subtle)", color: "var(--c-text-2)" }}>{markingStr}</span>
              <span style={{ ...badge, background: "var(--c-subtle)", color: "var(--c-text-3)" }}>
                {section.questions.length} Q
              </span>
            </div>
          </div>
          <DotMenu items={sectionMenuItems} />
        </div>
      )}

      <div style={{ padding: "16px 20px" }}>
        {section.questions.length === 0 ? (
          <p style={{ margin: 0, fontSize: 13, color: "var(--c-text-3)", textAlign: "center", padding: "16px 0" }}>
            No questions yet — add some below
          </p>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 10, marginBottom: 12 }}>
            {section.questions.map((q, idx) => (
              <QuestionThumbnail
                key={q.id}
                question={q}
                sectionId={section.id}
                index={idx}
                total={section.questions.length}
              />
            ))}
          </div>
        )}
        {!isPicking && (
          <button type="button" onClick={onOpenPicker} style={{ ...btnSecondary, fontSize: 12 }}>
            + Add Questions
          </button>
        )}
      </div>

      {isPicking && (
        <QuestionPickerPanel
          section={section}
          testId={testId}
          questions={pickerQuestions}
          folders={pickerFolders}
          usedElsewhere={pickerUsedElsewhere}
          onClose={onClosePicker}
        />
      )}
    </div>
  );
}
