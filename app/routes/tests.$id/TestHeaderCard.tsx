import { useFetcher } from "react-router";
import { useState } from "react";
import { DotMenu } from "~/components/three-dot-menu";
import type { ExamType } from "~/lib/database.types";
import type { Test } from "./types";
import { btnPrimary, btnSecondary, labelStyle, inputStyle } from "./styles";

export function TestHeaderCard({
  test,
  totalQuestions,
  sectionCount,
}: {
  test: Test;
  totalQuestions: number;
  sectionCount: number;
}) {
  const [editing, setEditing] = useState(false);
  const [copied, setCopied] = useState(false);
  const editFetcher = useFetcher();
  const actionFetcher = useFetcher();
  const hrs  = Math.floor(test.duration_mins / 60);
  const mins = test.duration_mins % 60;
  const durationStr = hrs > 0
    ? `${hrs}h ${mins > 0 ? `${mins}m` : ""}`.trim()
    : `${mins}m`;

  function handleShare() {
    const url = `${window.location.origin}/tests/${test.id}/preview`;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function handleTogglePublish() {
    const fd = new FormData();
    fd.set("intent", "toggle_publish");
    fd.set("is_published", String(test.is_published));
    actionFetcher.submit(fd, { method: "post" });
  }

  function handleDelete() {
    if (!confirm("Delete this test? This cannot be undone.")) return;
    const fd = new FormData();
    fd.set("intent", "delete_test");
    actionFetcher.submit(fd, { method: "post" });
  }

  type MI = import("~/components/three-dot-menu").MenuItem;
  const menuItems: MI[] = [
    { type: "action", label: "Edit details", onClick: () => setEditing(true) },
    { type: "sep" },
    ...(test.is_published
      ? ([
          { type: "link",   label: "Preview →", to: `/tests/${test.id}/preview` },
          { type: "action", label: copied ? "✓ Copied!" : "Copy share link", onClick: handleShare },
          { type: "sep" },
        ] as MI[])
      : []),
    { type: "action", label: test.is_published ? "Unpublish" : "Publish", onClick: handleTogglePublish },
    { type: "sep" },
    { type: "action", label: "Delete test", danger: true, onClick: handleDelete },
  ];

  return (
    <div style={{ background: "var(--c-surface)", border: "1px solid var(--c-border)", borderRadius: 10, padding: "20px 24px" }}>
      {editing ? (
        <editFetcher.Form method="post" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <input type="hidden" name="intent" value="update_test" />
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
            <div style={{ flex: 1, minWidth: 200, display: "flex", flexDirection: "column", gap: 5 }}>
              <label style={labelStyle}>Title</label>
              <input name="title" defaultValue={test.title} required style={inputStyle} autoFocus />
            </div>
            <div style={{ width: 140, display: "flex", flexDirection: "column", gap: 5 }}>
              <label style={labelStyle}>Duration (minutes)</label>
              <input name="duration_mins" type="number" defaultValue={test.duration_mins} min="1" max="600" style={inputStyle} />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              <label style={labelStyle}>Exam type</label>
              <div style={{ display: "flex", gap: 6, height: 36, alignItems: "center" }}>
                {(["main", "advanced"] as ExamType[]).map((t) => (
                  <label key={t} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer",
                    padding: "6px 12px", borderRadius: 6, border: "1px solid var(--c-border)",
                    background: "var(--c-subtle)", userSelect: "none" }}>
                    <input type="radio" name="exam_type" value={t} defaultChecked={test.exam_type === t}
                      style={{ accentColor: "var(--c-brand-500)", cursor: "pointer" }} />
                    {t === "main" ? "JEE Main" : "JEE Advanced"}
                  </label>
                ))}
              </div>
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <label style={labelStyle}>Description <span style={{ fontWeight: 400, color: "var(--c-text-3)" }}>(optional)</span></label>
            <textarea name="description" defaultValue={test.description ?? ""} placeholder="e.g. Covers Mechanics, Thermodynamics..." rows={2} style={{ ...inputStyle, resize: "vertical" }} />
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="submit" style={btnPrimary} disabled={editFetcher.state !== "idle"}>
              {editFetcher.state !== "idle" ? "Saving…" : "Save"}
            </button>
            <button type="button" onClick={() => setEditing(false)} style={btnSecondary}>Cancel</button>
          </div>
        </editFetcher.Form>
      ) : (
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 style={{ margin: "0 0 4px", fontSize: 20, fontWeight: 700, color: "var(--c-text)", letterSpacing: "-0.02em" }}>
              {test.title}
            </h2>
            {test.description && (
              <p style={{ margin: "0 0 6px", fontSize: 13, color: "var(--c-text-2)", lineHeight: 1.5 }}>{test.description}</p>
            )}
            <p style={{ margin: 0, fontSize: 13, color: "var(--c-text-3)" }}>
              {durationStr} · {sectionCount} section{sectionCount !== 1 ? "s" : ""} · {totalQuestions} question{totalQuestions !== 1 ? "s" : ""}
              {" · "}
              <span style={{ color: "var(--c-text-3)", fontWeight: 500 }}>
                {test.exam_type === "main" ? "JEE Main" : "JEE Advanced"}
              </span>
              {" · "}
              <span style={{ color: test.is_published ? "var(--c-brand-500)" : "var(--c-text-3)", fontWeight: 600 }}>
                {test.is_published ? "● Published" : "○ Draft"}
              </span>
            </p>
          </div>
          <DotMenu items={menuItems} />
        </div>
      )}
    </div>
  );
}
