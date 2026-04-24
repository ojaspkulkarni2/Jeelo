import { Form } from "react-router";
import { useState } from "react";
import type { QuestionType } from "~/lib/database.types";
import { btnPrimary, labelStyle, inputStyle, TYPE_META } from "./styles";

export function AddSectionForm({ testId: _ }: { testId: string }) {
  const [qType, setQType] = useState<QuestionType | "">("");

  const defaultMarks: Record<QuestionType, { correct: number; wrong: number; partial: string }> = {
    scq:       { correct: 4, wrong: -1,  partial: "" },
    mcq:       { correct: 4, wrong: -2,  partial: "1" },
    integer:   { correct: 4, wrong: 0,   partial: "" },
    numerical: { correct: 4, wrong: 0,   partial: "" },
    paragraph: { correct: 3, wrong: -1,  partial: "" },
  };

  const defaults = qType ? defaultMarks[qType] : { correct: 4, wrong: -1, partial: "" };

  return (
    <div style={{ marginTop: 24, background: "var(--c-surface)", border: "1px solid var(--c-border)", borderRadius: 10, padding: "20px 24px" }}>
      <p style={{ margin: "0 0 16px", fontSize: 14, fontWeight: 600, color: "var(--c-text)" }}>
        + Add Section
      </p>
      <Form method="post">
        <input type="hidden" name="intent" value="add_section" />
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 12, marginBottom: 12 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <label style={labelStyle}>Section name *</label>
            <input name="name" required placeholder="e.g. Section 1 — Single Correct" style={inputStyle} />
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
            <select name="question_type" required value={qType} onChange={(e) => setQType(e.target.value as QuestionType)} style={inputStyle}>
              <option value="">Select</option>
              <option value="scq">Single Correct (SCQ)</option>
              <option value="mcq">Multiple Correct (MCQ)</option>
              <option value="integer">Integer</option>
              <option value="numerical">Numerical</option>
              <option value="paragraph">Paragraph-based</option>
            </select>
          </div>
        </div>
        <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div style={{ width: 130, display: "flex", flexDirection: "column", gap: 5 }}>
            <label style={labelStyle}>Marks (correct)</label>
            <input name="marks_correct" type="number" step="0.5" key={`correct-${qType}`} defaultValue={defaults.correct} style={inputStyle} />
          </div>
          <div style={{ width: 130, display: "flex", flexDirection: "column", gap: 5 }}>
            <label style={labelStyle}>Negative marking</label>
            <input name="marks_wrong" type="number" step="0.5" key={`wrong-${qType}`} defaultValue={defaults.wrong} style={inputStyle} />
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
          <button type="submit" style={btnPrimary}>Add Section</button>
        </div>
        {qType && (
          <p style={{ margin: "10px 0 0", fontSize: 11, color: "var(--c-text-3)" }}>
            JEE default for {TYPE_META[qType]?.label}: {defaults.correct > 0 ? `+${defaults.correct}` : defaults.correct} correct
            {defaults.wrong !== 0 ? `, ${defaults.wrong} wrong` : ", 0 negative"}
            {defaults.partial ? `, +${defaults.partial} partial` : ""}
          </p>
        )}
      </Form>
    </div>
  );
}
