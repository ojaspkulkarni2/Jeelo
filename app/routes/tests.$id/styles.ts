import type { CSSProperties } from "react";

export const btnPrimary: CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 6,
  background: "var(--c-brand-500)", color: "#fff", border: "none",
  borderRadius: 7, padding: "8px 16px", fontSize: 13,
  fontWeight: 500, cursor: "pointer", whiteSpace: "nowrap",
};

export const btnSecondary: CSSProperties = {
  display: "inline-flex", alignItems: "center",
  background: "var(--c-surface)", color: "var(--c-text-2)", border: "1px solid var(--c-border)",
  borderRadius: 7, padding: "7px 13px", fontSize: 13,
  fontWeight: 400, cursor: "pointer", whiteSpace: "nowrap",
};

export const arrowBtn: CSSProperties = {
  background: "none", border: "none", cursor: "pointer",
  fontSize: 12, color: "var(--c-text-3)", padding: "2px 4px", lineHeight: 1,
};

export const badge: CSSProperties = {
  fontSize: 10, fontWeight: 700, letterSpacing: "0.04em",
  padding: "2px 7px", borderRadius: 4,
};

export const labelStyle: CSSProperties = {
  fontSize: 12, fontWeight: 500, color: "var(--c-text-2)",
};

export const inputStyle: CSSProperties = {
  padding: "8px 10px", border: "1px solid var(--c-border)",
  borderRadius: 6, fontSize: 14, width: "100%",
  boxSizing: "border-box", color: "var(--c-text)", background: "var(--c-surface)",
};

export const SUBJECT_META: Record<string, { label: string; bg: string; text: string }> = {
  physics:     { label: "Physics",   bg: "#dbeafe", text: "#1d4ed8" },
  chemistry:   { label: "Chemistry", bg: "#dcfce7", text: "#15803d" },
  mathematics: { label: "Maths",     bg: "#f3e8ff", text: "#7e22ce" },
};

export const TYPE_META: Record<string, { label: string; bg: string; text: string }> = {
  scq:       { label: "SCQ",       bg: "#fef3c7", text: "#92400e" },
  mcq:       { label: "MCQ",       bg: "#e0e7ff", text: "#3730a3" },
  integer:   { label: "Integer",   bg: "#d1fae5", text: "#065f46" },
  numerical: { label: "Numerical", bg: "#cffafe", text: "#0e7490" },
  paragraph: { label: "Paragraph", bg: "#fed7aa", text: "#9a3412" },
};
