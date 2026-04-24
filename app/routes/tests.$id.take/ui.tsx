import React from "react";
import type { QuestionType, QuestionStatus } from "~/lib/database.types";
import type { Section } from "./types";
import {
  OPTIONS, PALETTE_CFG, SHAPE_SIZE, SHAPE_CLIP, STATUS_MEANINGS, TOP_UTIL_ICONS, numpadBtn,
} from "./constants";

// ── UserAvatar ─────────────────────────────────────────────────

export function UserAvatar({ size }: { size: number }) {
  return (
    <div style={{ width: size, height: size, borderRadius: 4, overflow: "hidden", background: "#d6e8f5", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <svg width={size} height={size} viewBox="0 0 52 52" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect width="52" height="52" fill="#d6e8f5"/>
        <circle cx="26" cy="20" r="10" fill="#7aaecf"/>
        <ellipse cx="26" cy="42" rx="16" ry="10" fill="#7aaecf"/>
      </svg>
    </div>
  );
}

// ── SectionInstructions ────────────────────────────────────────

export function SectionInstructions({ section, qCount }: { section: Section; qCount: number }) {
  const { question_type, marks_correct, marks_wrong, marks_partial } = section;
  const mc = marks_correct ?? 4;
  const mw = marks_wrong ?? -1;
  const mp = marks_partial ?? 2;
  const maxMarks = mc * qCount;

  const UL = ({ children }: { children: React.ReactNode }) => (
    <ul style={{ margin: 0, paddingLeft: 22, lineHeight: 2 }}>{children}</ul>
  );
  const MarkRow = ({ label, val, note }: { label: string; val: string; note?: string }) => (
    <li><em>{label}</em> : {val}{note ? ` (${note})` : ""}</li>
  );

  if (question_type === "scq") {
    return (
      <UL>
        <li>This section contains <strong>{qCount}</strong> question{qCount !== 1 ? "s" : ""}.</li>
        <li>Each question has <strong>4</strong> options A, B, C, D. <strong>ONLY ONE</strong> of these 4 options is the correct answer.</li>
        <li>For each question, choose the option corresponding to the correct answer.</li>
        <li>Answer to each question will be evaluated according to the following marking scheme:
          <UL>
            <MarkRow label="Full Marks" val={`+${mc} If ONLY the correct option is chosen`} />
            <MarkRow label="Zero Marks" val="0 If none of the options is chosen (i.e. the question is unanswered)" />
            <MarkRow label="Negative Marks" val={`${mw} In all other cases.`} />
          </UL>
        </li>
      </UL>
    );
  }

  if (question_type === "paragraph") {
    return (
      <UL>
        <li>This section contains <strong>{qCount}</strong> question{qCount !== 1 ? "s" : ""} based on a passage / paragraph.</li>
        <li>Each question has <strong>4</strong> options A, B, C, D. <strong>ONLY ONE</strong> of these 4 options is the correct answer.</li>
        <li>For each question, choose the option corresponding to the correct answer.</li>
        <li>Answer to each question will be evaluated according to the following marking scheme:
          <UL>
            <MarkRow label="Full Marks" val={`+${mc} If ONLY the correct option is chosen`} />
            <MarkRow label="Zero Marks" val="0 If none of the options is chosen (i.e. the question is unanswered)" />
            <MarkRow label="Negative Marks" val={`${mw} In all other cases.`} />
          </UL>
        </li>
      </UL>
    );
  }

  if (question_type === "mcq") {
    return (
      <UL>
        <li>This section contains <strong>{qCount}</strong> question{qCount !== 1 ? "s" : ""}.</li>
        <li>Each question has <strong>4</strong> options A, B, C, D. <strong>ONE OR MORE</strong> of these 4 options may be correct answer(s).</li>
        <li>For each question, choose all correct option(s) to answer the question.</li>
        <li>Answer to each question will be evaluated according to the following marking scheme:
          <UL>
            <MarkRow label="Full Marks" val={`+${mc}`} note="If only (all) the correct option(s) are chosen" />
            <MarkRow label="Partial Marks" val={`+${mp}`} note="For each correct option marked, provided no incorrect option is marked" />
            <MarkRow label="Zero Marks" val="0" note="If no option is chosen (i.e. the question is unanswered)" />
            <MarkRow label="Negative Marks" val={`${mw}`} note="In all other cases" />
          </UL>
        </li>
      </UL>
    );
  }

  if (question_type === "integer") {
    return (
      <UL>
        <li>This section contains <strong>{qCount}</strong> question{qCount !== 1 ? "s" : ""}.</li>
        <li>The answer to each question is a <strong>Non-Negative Integer</strong>.</li>
        <li>For each question, enter the correct integer answer using the on-screen virtual numeric keypad.</li>
        <li>Answer to each question will be evaluated according to the following marking scheme:
          <UL>
            <MarkRow label="Full Marks" val={`+${mc}`} note="If ONLY the correct integer is entered" />
            <MarkRow label="Zero Marks" val="0" note="In all other cases" />
          </UL>
        </li>
      </UL>
    );
  }

  if (question_type === "numerical") {
    return (
      <UL>
        <li>This section contains <strong>{qCount}</strong> question{qCount !== 1 ? "s" : ""}.</li>
        <li>The answer to each question is a <strong>numerical value</strong> (decimal/real number).</li>
        <li>Enter the answer using the keyboard. Round to two decimal places if required.</li>
        <li>Answer to each question will be evaluated according to the following marking scheme:
          <UL>
            <MarkRow label="Full Marks" val={`+${mc}`} note="If the answer is correct within the specified range" />
            <MarkRow label="Zero Marks" val="0" note="In all other cases" />
          </UL>
        </li>
      </UL>
    );
  }

  return (
    <UL>
      <li>This section contains <strong>{qCount}</strong> question{qCount !== 1 ? "s" : ""}. Total Marks: {maxMarks}.</li>
    </UL>
  );
}

// ── PaletteIcon ────────────────────────────────────────────────

export function PaletteIcon({ status, num, active }: { status: QuestionStatus; num: number; active: boolean }) {
  const cfg = PALETTE_CFG[status];
  const shape = cfg.shape;
  const isCircle = shape === "circle";
  const isSquare = shape === "square";
  const clip = SHAPE_CLIP[shape];
  const S = SHAPE_SIZE.palette;

  return (
    <div style={{ width: S, height: S, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{
        width: S,
        height: S,
        background: cfg.bg,
        borderRadius: isCircle ? "50%" : isSquare ? 4 : 0,
        clipPath: clip,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        position: "relative",
        border: "none",
        boxSizing: "border-box",
      }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: cfg.text, lineHeight: 1 }}>{num}</span>
        {status === "answered_marked" && (
          <div style={{ position: "absolute", bottom: 3, right: 3, width: 11, height: 11,
            background: "linear-gradient(180deg,#6abe38 0%,#2d8a1a 100%)", borderRadius: "50%",
            display: "flex", flexDirection: "column", alignItems: "center",
            justifyContent: "center", gap: "1.5px", padding: "2px",
            boxSizing: "border-box" }}>
            {[0,1,2].map(i => <div key={i} style={{ width: "100%", height: "1.5px", background: "#fff", borderRadius: 1 }} />)}
          </div>
        )}
      </div>
    </div>
  );
}

// ── LegendItem ─────────────────────────────────────────────────

export function LegendItem({ count, label, status, darkMode = false }: { count: number; label: string; status: QuestionStatus; darkMode?: boolean }) {
  const cfg = PALETTE_CFG[status];
  const shape = cfg.shape;
  const isCircle = shape === "circle";
  const isSquare = shape === "square";
  const clip = SHAPE_CLIP[shape];
  const S = SHAPE_SIZE.legend;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <div style={{
        width: S, height: S,
        background: cfg.bg,
        borderRadius: isCircle ? "50%" : isSquare ? 3 : 0,
        clipPath: clip,
        flexShrink: 0,
        position: "relative",
        display: "flex", alignItems: "center", justifyContent: "center",
        border: "none",
        boxSizing: "border-box",
      }}>
        <span style={{ fontSize: 9, fontWeight: 700, color: cfg.text }}>{count}</span>
        {status === "answered_marked" && (
          <div style={{ position: "absolute", bottom: 1, right: 1, width: 8, height: 8,
            background: "linear-gradient(180deg,#6abe38 0%,#2d8a1a 100%)", borderRadius: "50%",
            display: "flex", flexDirection: "column", alignItems: "center",
            justifyContent: "center", gap: "1px", padding: "1.5px",
            boxSizing: "border-box" }}>
            {[0,1,2].map(i => <div key={i} style={{ width: "100%", height: "1px", background: "#fff", borderRadius: 1 }} />)}
          </div>
        )}
      </div>
      <span style={{ fontSize: 10, color: darkMode ? "#aaa" : "#444", lineHeight: 1.3 }}>{label}</span>
    </div>
  );
}

// ── TopUtilBtn ─────────────────────────────────────────────────

export function TopUtilBtn({ label, circleColor, onClick }: { label: string; circleColor: string; onClick?: () => void }) {
  return (
    <button type="button" onClick={onClick}
      style={{ background: "none", border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: 5, color: "#fff", fontSize: 12, padding: 0, whiteSpace: "nowrap" }}>
      <div style={{ width: 22, height: 22, borderRadius: "50%", background: circleColor, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
        {TOP_UTIL_ICONS[label] ?? null}
      </div>
      {label}
    </button>
  );
}

// ── AnswerInput ────────────────────────────────────────────────

export function AnswerInput({ questionType, value, onChange, darkMode = false }: { questionType: QuestionType; value: unknown; onChange: (v: unknown) => void; darkMode?: boolean }) {
  if (questionType === "scq" || questionType === "paragraph") {
    const selected: string = Array.isArray(value) ? (value as string[])[0] ?? "" : "";
    return (
      <div style={{ marginTop: 8 }}>
        {OPTIONS.map(opt => {
          const active = selected === opt;
          return (
            <div key={opt} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0", cursor: "pointer" }} onClick={() => onChange([opt])}>
              <div style={{ width: 18, height: 18, borderRadius: "50%", border: active ? "6px solid #1a6eb5" : `2px solid ${darkMode ? "#666" : "#888"}`, background: darkMode ? "#2a2a2a" : "#fff", boxSizing: "border-box", flexShrink: 0 }} />
              <span style={{ fontSize: 14, color: darkMode ? "#e0e0e0" : "#333" }}>({opt})</span>
            </div>
          );
        })}
      </div>
    );
  }

  if (questionType === "mcq") {
    const selected: string[] = Array.isArray(value) ? (value as string[]) : [];
    return (
      <div style={{ marginTop: 8 }}>
        {OPTIONS.map(opt => {
          const isOn = selected.includes(opt);
          return (
            <div key={opt} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0", cursor: "pointer" }}
              onClick={() => onChange(isOn ? selected.filter(x => x !== opt) : [...selected, opt])}>
              <div style={{ width: 18, height: 18, borderRadius: 3, border: isOn ? "none" : `2px solid ${darkMode ? "#666" : "#888"}`, background: isOn ? "#1a6eb5" : darkMode ? "#2a2a2a" : "#fff", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 11, fontWeight: 700, flexShrink: 0, boxSizing: "border-box" }}>
                {isOn ? "✓" : ""}
              </div>
              <span style={{ fontSize: 14, color: darkMode ? "#e0e0e0" : "#333" }}>({opt})</span>
            </div>
          );
        })}
      </div>
    );
  }

  if (questionType === "integer") {
    const numStr = value !== null && value !== undefined ? String(value) : "";
    function appendDigit(d: number) { onChange(parseInt(((numStr + d).replace(/^0+(?=\d)/, "")), 10)); }
    function backspace() { const s = numStr.slice(0, -1); onChange(s === "" ? null : parseInt(s, 10)); }
    return (
      <div style={{ marginTop: 10 }}>
        <p style={{ fontSize: 12, color: darkMode ? "#aaa" : "#555", margin: "0 0 8px" }}>Enter integer answer</p>
        <input readOnly value={numStr} placeholder="—" style={{ width: 88, padding: "6px 10px", border: "2px solid #1a6eb5", borderRadius: 4, fontSize: 22, fontWeight: 700, color: "#1a6eb5", textAlign: "center", background: darkMode ? "#1a2a3a" : "#eef2ff", display: "block", marginBottom: 10 }} />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 40px)", gap: 5 }}>
          {[7,8,9,4,5,6,1,2,3].map(n => (
            <button key={n} type="button" onClick={() => appendDigit(n)} style={{ ...numpadBtn, background: darkMode ? "#2a2a2a" : "#fff", color: darkMode ? "#e0e0e0" : "#333", borderColor: darkMode ? "#444" : "#ccc" }}>{n}</button>
          ))}
          <button type="button" onClick={() => appendDigit(0)} style={{ ...numpadBtn, background: darkMode ? "#2a2a2a" : "#fff", color: darkMode ? "#e0e0e0" : "#333", borderColor: darkMode ? "#444" : "#ccc" }}>0</button>
          <button type="button" onClick={backspace} style={{ ...numpadBtn, background: darkMode ? "#3a1a1a" : "#fee2e2", color: "#dc2626" }}>⌫</button>
        </div>
      </div>
    );
  }

  if (questionType === "numerical") {
    const initStr = value !== null && value !== undefined ? String(value) : "";
    const [editStr, setEditStr] = React.useState(initStr);
    const [cursorPos, setCursorPos] = React.useState(initStr.length);

    React.useEffect(() => {
      const newStr = value !== null && value !== undefined ? String(value) : "";
      setEditStr(newStr);
      setCursorPos(newStr.length);
    }, [value]); // eslint-disable-line

    // Store as string so "3.", "-", "-3." survive round-trips.
    // The scoring layer already does parseFloat(String(given)), so a string value is safe.
    function propagate(s: string) {
      setEditStr(s);
      onChange(s === "" ? null : s);
    }

    function insertChar(char: string) {
      if (char === "." && editStr.includes(".")) return;
      if (char === "-" && cursorPos !== 0) return;
      if (char === "-" && editStr.startsWith("-")) return;
      const before = editStr.slice(0, cursorPos);
      const after = editStr.slice(cursorPos);
      propagate(before + char + after);
      setCursorPos(cursorPos + 1);
    }

    function backspace() {
      if (cursorPos > 0) {
        propagate(editStr.slice(0, cursorPos - 1) + editStr.slice(cursorPos));
        setCursorPos(cursorPos - 1);
      }
    }

    function moveCursor(direction: "left" | "right") {
      if (direction === "left" && cursorPos > 0) setCursorPos(cursorPos - 1);
      else if (direction === "right" && cursorPos < editStr.length) setCursorPos(cursorPos + 1);
    }

    function clearAll() { propagate(""); setCursorPos(0); }

    const KP_WIDTH  = 166;
    const BTN_GAP   = 4;
    const BTN_COL   = Math.floor((KP_WIDTH - BTN_GAP * 2) / 3);
    const BTN_H     = 34;
    const BTN_RADIUS = 3;
    const BTN_BORDER = `1px solid ${darkMode ? "#555" : "#bbb"}`;
    const BTN_BG    = darkMode ? "#2a2a2a" : "#fff";
    const BTN_COLOR = darkMode ? "#e0e0e0" : "#222";
    const BTN_BASE: React.CSSProperties = {
      height: BTN_H, border: BTN_BORDER, borderRadius: BTN_RADIUS,
      background: BTN_BG, color: BTN_COLOR, cursor: "pointer",
      fontSize: 14, fontWeight: 400, fontFamily: "inherit",
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: 0, boxSizing: "border-box",
    };

    return (
      <div style={{ marginTop: 10, userSelect: "none" }}>
        <input
          readOnly
          value={editStr}
          placeholder=""
          style={{
            width: KP_WIDTH, height: 30, padding: "0 6px",
            border: `1px solid ${darkMode ? "#555" : "#aaa"}`,
            borderRadius: BTN_RADIUS, fontSize: 15, fontWeight: 400,
            color: BTN_COLOR, background: darkMode ? "#1a1a1a" : "#fff",
            display: "block", marginBottom: BTN_GAP, boxSizing: "border-box", outline: "none",
          }}
        />
        <div style={{ display: "inline-flex", flexDirection: "column", gap: BTN_GAP }}>
          <button type="button" onClick={backspace} style={{ ...BTN_BASE, width: KP_WIDTH, fontSize: 13 }}>Backspace</button>
          <div style={{ display: "flex", gap: BTN_GAP }}>
            {[7, 8, 9].map(n => <button key={n} type="button" onClick={() => insertChar(String(n))} style={{ ...BTN_BASE, width: BTN_COL }}>{n}</button>)}
          </div>
          <div style={{ display: "flex", gap: BTN_GAP }}>
            {[4, 5, 6].map(n => <button key={n} type="button" onClick={() => insertChar(String(n))} style={{ ...BTN_BASE, width: BTN_COL }}>{n}</button>)}
          </div>
          <div style={{ display: "flex", gap: BTN_GAP }}>
            {[1, 2, 3].map(n => <button key={n} type="button" onClick={() => insertChar(String(n))} style={{ ...BTN_BASE, width: BTN_COL }}>{n}</button>)}
          </div>
          <div style={{ display: "flex", gap: BTN_GAP }}>
            <button type="button" onClick={() => insertChar("0")} style={{ ...BTN_BASE, width: BTN_COL }}>0</button>
            <button type="button" onClick={() => insertChar(".")} style={{ ...BTN_BASE, width: BTN_COL }}>.</button>
            <button type="button" onClick={() => insertChar("-")} style={{ ...BTN_BASE, width: BTN_COL }}>-</button>
          </div>
          <div style={{ display: "flex", gap: BTN_GAP }}>
            <button type="button" onClick={() => moveCursor("left")} style={{ ...BTN_BASE, width: Math.floor((KP_WIDTH - BTN_GAP) / 2) }}>Left</button>
            <button type="button" onClick={() => moveCursor("right")} style={{ ...BTN_BASE, width: Math.ceil((KP_WIDTH - BTN_GAP) / 2) }}>Right</button>
          </div>
          <button type="button" onClick={clearAll} style={{ ...BTN_BASE, width: KP_WIDTH, fontSize: 13 }}>Clear All</button>
        </div>
      </div>
    );
  }

  return null;
}
