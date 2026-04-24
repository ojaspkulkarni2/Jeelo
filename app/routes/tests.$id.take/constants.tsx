import type { CSSProperties } from "react";
import type { QuestionType, QuestionStatus } from "~/lib/database.types";

export const FONT     = "Arial, 'Helvetica Neue', Helvetica, sans-serif";
export const JEE_GOLD = "#f5c000";
export const JEE_BLUE = "#4169a1";
export const OPTIONS  = ["A", "B", "C", "D"] as const;

// shape: "square" | "hex-down" | "hex-up" | "circle"
// hex-up   = angled top corners → wide flat bottom (ANSWERED green)
// hex-down = wide flat top → angled bottom corners (NOT ANSWERED red)
export const PALETTE_CFG: Record<QuestionStatus, { bg: string; text: string; border: string; shape: string }> = {
  not_visited:     { bg: "#d8d8d8", text: "#444",  border: "#aaa",    shape: "square"   },
  not_answered:    { bg: "#d94025", text: "#fff",  border: "none",    shape: "hex-down" },
  answered:        { bg: "#79c020", text: "#fff",  border: "none",    shape: "hex-up"   },
  marked:          { bg: "#7e57c0", text: "#fff",  border: "none",    shape: "circle"   },
  answered_marked: { bg: "#7e57c0", text: "#fff",  border: "none",    shape: "circle"   },
};

// All shapes share the same W×H bounding box; clip-path carves the visual silhouette
export const SHAPE_SIZE = { palette: 44, legend: 26 };

// Clip-paths per shape type
export const SHAPE_CLIP: Record<string, string | undefined> = {
  "square":   undefined,
  "hex-down": "polygon(0% 0%, 100% 0%, 100% 60%, 68% 100%, 32% 100%, 0% 60%)",
  "hex-up":  "polygon(32% 0%, 68% 0%, 100% 40%, 100% 100%, 0% 100%, 0% 40%)",
  "circle":   undefined,
};

export const STATUS_MEANINGS: Record<QuestionStatus, string> = {
  not_visited:     "You have not visited this question",
  not_answered:    "You have not answered this question",
  answered:        "You have answered this question",
  marked:          "You have NOT answered the question, but have marked the question for Review, will be considered for evaluation",
  answered_marked: "The question(s) 'Answered and Marked for Review' will be considered for evaluation.",
};

export const TYPE_LABELS: Record<QuestionType, string> = {
  scq: "Single Correct", mcq: "Multiple Correct",
  integer: "Integer", numerical: "Numerical", paragraph: "Paragraph",
};

const topBarBase: CSSProperties = {
  background: "#1d1d00", color: "#fff",
  padding: "0 14px", height: 40,
  display: "flex", alignItems: "center", flexShrink: 0, gap: 12,
};
export function getTopBarStyle(darkMode: boolean): CSSProperties {
  return { ...topBarBase, background: darkMode ? "#0d0d0d" : "#1d1d00" };
}

export const navArrowBtn: CSSProperties = {
  background: "#ddd", border: "1px solid #bbb", borderRadius: 3,
  padding: "4px 9px", cursor: "pointer", fontSize: 12, color: "#333",
};
export const btnMarkReview: CSSProperties = {
  background: JEE_BLUE, color: "#fff", border: "none",
  borderRadius: 4, padding: "12px 24px", fontSize: 15, fontWeight: 600, cursor: "pointer",
};
export const btnClear: CSSProperties = {
  background: "#fff", color: "#333", border: "1px solid #bbb",
  borderRadius: 4, padding: "11px 22px", fontSize: 15, cursor: "pointer",
};
export const btnSaveNext: CSSProperties = {
  background: "#1a6eb5", color: "#fff", border: "none",
  borderRadius: 4, padding: "12px 28px", fontSize: 15, fontWeight: 600, cursor: "pointer",
};
export const btnSubmit: CSSProperties = {
  background: "#1a6eb5", color: "#fff", border: "2px solid #fff",
  borderRadius: 4, padding: "10px 30px", fontSize: 15, fontWeight: 600, cursor: "pointer",
};
export const numpadBtn: CSSProperties = {
  width: 40, height: 36, border: "1px solid #ccc", borderRadius: 4,
  background: "#fff", cursor: "pointer", fontSize: 14, fontWeight: 600, color: "#333",
};
export const MODAL_OVERLAY: CSSProperties = {
  position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)",
  display: "flex", alignItems: "center", justifyContent: "center", zIndex: 70,
};
export const MODAL_HEADER: CSSProperties = {
  background: "#1a6eb5", color: "#fff", padding: "7px 16px",
  display: "flex", justifyContent: "space-between", alignItems: "center",
  fontSize: 14, fontWeight: 700, flexShrink: 0,
};
export const MODAL_CLOSE_BTN: CSSProperties = {
  background: "rgba(255,255,255,0.2)", border: "none", color: "#fff",
  borderRadius: 3, padding: "3px 10px", cursor: "pointer", fontSize: 13, fontWeight: 600,
};
export const MODAL_WARNING: CSSProperties = {
  background: "#fff8f8", color: "#dc2626", padding: "9px 16px",
  margin: 0, fontSize: 13, borderBottom: "1px solid #fecaca", flexShrink: 0, lineHeight: 1.5,
};
export const thStyle: CSSProperties = {
  border: "1px solid #bbb", padding: "7px 12px", fontWeight: 700, textAlign: "left", background: "#e8e8e8", color: "#000",
};
export const tdStyle: CSSProperties = {
  border: "1px solid #bbb", padding: "9px 12px", verticalAlign: "middle", color: "#000",
};
export const confirmTd: CSSProperties = {
  border: "1px solid #ccc", padding: "8px 12px", fontSize: 13, color: "#000",
};

export const TOP_UTIL_ICONS: Record<string, React.ReactNode> = {
  "Accessibility": (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="5" r="2"/>
      <path d="M12 22v-7l-2-5H5l2-5h10l2 5h-5l-2 5v7"/>
    </svg>
  ),
  "Instructions": (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/>
      <line x1="12" y1="8" x2="12" y2="12"/>
      <line x1="12" y1="16" x2="12.01" y2="16"/>
    </svg>
  ),
  "Question Paper": (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <polyline points="14 2 14 8 20 8"/>
      <line x1="16" y1="13" x2="8" y2="13"/>
      <line x1="16" y1="17" x2="8" y2="17"/>
      <polyline points="10 9 9 9 8 9"/>
    </svg>
  ),
};
