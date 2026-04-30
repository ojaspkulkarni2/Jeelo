import { data, useFetcher, Link } from "react-router";
import { useState, useEffect } from "react";
import type { Route } from "./+types/map";
import { requireUser } from "~/lib/auth.server";
import { createServerClient } from "~/lib/supabase.server";
import { Sidebar } from "~/components/sidebar";

const STEPS = [
  { key: "theory_done",        label: "Theory"       },
  { key: "own_questions_done", label: "Questions"    },
  { key: "curated_done",       label: "Fresh Test"   },
  { key: "arena_played",       label: "Arena"        },
  { key: "mastered",           label: "Layered Test" },
] as const;
type StepKey = typeof STEPS[number]["key"];

interface Progress {
  chapter_id: string;
  theory_done: boolean; own_questions_done: boolean;
  curated_done: boolean; practice_done: boolean; mastered: boolean;
}
interface CustomChapter { id: string; name: string; subjectSlug: string; }
const LS_KEY = "jeelo-custom-chapters";
function loadCustom(): CustomChapter[] {
  try { return JSON.parse(localStorage.getItem(LS_KEY) ?? "[]"); } catch { return []; }
}
function saveCustom(cc: CustomChapter[]) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(cc)); } catch {}
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const user = await requireUser(request, env);
  const supabase = createServerClient(env);

  const [subjectsRes, progressRes, questionCountsRes] = await Promise.all([
    supabase.from("subjects")
      .select("id, name, slug, display_order, chapters(id, name, slug, display_order)")
      .order("display_order"),
    supabase.from("chapter_progress")
      .select("chapter_id, theory_done, own_questions_done, curated_done, practice_done, mastered")
      .eq("user_id", user.id),
    supabase.from("questions").select("chapter").eq("owner_id", user.id),
  ]);

  const subjects = (subjectsRes.data ?? []).map((s: any) => ({
    ...s,
    chapters: [...(s.chapters ?? [])].sort((a: any, b: any) => a.display_order - b.display_order),
  }));

  const progressMap: Record<string, Progress> = {};
  for (const p of progressRes.data ?? []) progressMap[p.chapter_id] = p as Progress;

  const questionCounts: Record<string, number> = {};
  for (const q of questionCountsRes.data ?? []) {
    questionCounts[q.chapter] = (questionCounts[q.chapter] ?? 0) + 1;
  }

  const totalChapters = subjects.reduce((s: number, sub: any) => s + sub.chapters.length, 0);
  const masteredCount = Object.values(progressMap).filter((p) => p.mastered).length;
  return data({ user, subjects, progressMap, questionCounts, totalChapters, masteredCount });
}

export async function action({ request, context }: Route.ActionArgs) {
  const env = context.cloudflare.env;
  const user = await requireUser(request, env);
  const supabase = createServerClient(env);
  const fd = await request.formData();
  const intent    = fd.get("intent") as string;
  const chapterId = String(fd.get("chapter_id"));

  if (intent === "toggle_theory") {
    const current = fd.get("current") === "true";
    await supabase.from("chapter_progress").upsert({
      user_id: user.id, chapter_id: chapterId,
      theory_done: !current,
      theory_done_at: !current ? new Date().toISOString() : null,
      last_activity: new Date().toISOString(),
    }, { onConflict: "user_id,chapter_id" });
  }
  if (intent === "toggle_questions") {
    const current = fd.get("current") === "true";
    await supabase.from("chapter_progress").upsert({
      user_id: user.id, chapter_id: chapterId,
      own_questions_done: !current,
      last_activity: new Date().toISOString(),
    }, { onConflict: "user_id,chapter_id" });
  }
  if (intent === "toggle_curated") {
    const current = fd.get("current") === "true";
    await supabase.from("chapter_progress").upsert({
      user_id: user.id, chapter_id: chapterId,
      curated_done: !current,
      last_activity: new Date().toISOString(),
    }, { onConflict: "user_id,chapter_id" });
  }
  if (intent === "toggle_arena") {
    const current = fd.get("current") === "true";
    await supabase.from("chapter_progress").upsert({
      user_id: user.id, chapter_id: chapterId,
      practice_done: !current,
      last_activity: new Date().toISOString(),
    }, { onConflict: "user_id,chapter_id" });
  }
  if (intent === "toggle_mastered") {
    const current = fd.get("current") === "true";
    await supabase.from("chapter_progress").upsert({
      user_id: user.id, chapter_id: chapterId,
      mastered: !current,
      last_activity: new Date().toISOString(),
    }, { onConflict: "user_id,chapter_id" });
  }
  return data({ ok: true });
}

function stepsDone(p: Progress | undefined): number {
  if (!p) return 0;
  return [p.theory_done, p.own_questions_done, p.curated_done, p.practice_done, p.mastered].filter(Boolean).length;
}

// ── Hex colour helpers ────────────────────────────────────────
// Returns fill colour for a hex based on steps done (0-5)
function hexFill(done: number, mastered: boolean): string {
  if (mastered || done >= 5) return "var(--c-brand-500)";
  if (done === 4) return "var(--c-brand-400, #d97040)";
  if (done === 3) return "var(--c-brand-300, #e89e6a)";
  if (done === 2) return "var(--c-brand-200, #f2c4aa)";
  if (done === 1) return "var(--c-brand-100, #fadcc8)";
  return "var(--c-subtle)";
}
function hexStroke(done: number, mastered: boolean): string {
  if (mastered || done >= 5) return "var(--c-brand-600)";
  if (done >= 3) return "var(--c-brand-400, #d97040)";
  if (done > 0) return "var(--c-brand-200, #f2c4aa)";
  return "var(--c-border)";
}
function hexTextColor(done: number, mastered: boolean): string {
  return (mastered || done >= 5) ? "#fff" : done >= 3 ? "var(--c-brand-800, #5a2000)" : done >= 1 ? "var(--c-brand-700, #7a3010)" : "var(--c-text-3)";
}

// ── Component ─────────────────────────────────────────────────
export default function MapPage({ loaderData }: Route.ComponentProps) {
  const { user, subjects, progressMap, questionCounts, totalChapters, masteredCount } = loaderData;
  const [activeSubject, setActiveSubject] = useState<string>((subjects as any[])[0]?.slug ?? "physics");
  const [selected, setSelected]           = useState<string | null>(null);
  const [custom, setCustom]               = useState<CustomChapter[]>([]);
  const [adding, setAdding]               = useState(false);
  const [newName, setNewName]             = useState("");
  const fetcher = useFetcher();

  useEffect(() => { setCustom(loadCustom()); }, []);
  useEffect(() => { setSelected(null); }, [activeSubject]);

  const pendingToggle = fetcher.formData?.get("intent") != null
    ? {
        chapterId: String(fetcher.formData!.get("chapter_id")),
        intent: String(fetcher.formData!.get("intent")),
        current: fetcher.formData!.get("current") === "true",
      }
    : null;

  const currentSubject   = (subjects as any[]).find((s) => s.slug === activeSubject);
  const customForSubject = custom.filter((c) => c.subjectSlug === activeSubject);
  const allChapters      = [...(currentSubject?.chapters ?? []), ...customForSubject.map(c => ({ ...c, isCustom: true }))];
  const inProgress       = Object.values(progressMap as Record<string, Progress>)
    .filter((p) => !p.mastered && stepsDone(p) > 0).length;

  function addChapter() {
    const name = newName.trim();
    if (!name) return;
    const next = [...custom, { id: `custom-${Date.now()}`, name, subjectSlug: activeSubject }];
    setCustom(next); saveCustom(next); setNewName(""); setAdding(false);
  }
  function removeChapter(id: string) {
    const next = custom.filter((c) => c.id !== id);
    setCustom(next); saveCustom(next);
    if (selected === id) setSelected(null);
  }

  // ── Hex geometry ─────────────────────────────────────────────
  // Flat-top pointy hexes — smaller and wider grid
  const HEX_R  = 36;    // circumradius (corner to center)
  const HEX_W  = HEX_R * 2;
  const HEX_H  = Math.sqrt(3) * HEX_R;
  const COL_W  = HEX_W * 0.75;   // horizontal spacing
  const COLS   = 8;
  const PAD    = 10;

  function hexPoints(cx: number, cy: number): string {
    return Array.from({ length: 6 }, (_, i) => {
      const a = (Math.PI / 180) * (60 * i);
      return `${cx + HEX_R * Math.cos(a)},${cy + HEX_R * Math.sin(a)}`;
    }).join(" ");
  }

  // Layout chapters into hex grid
  const hexes = allChapters.map((ch, idx) => {
    const col = idx % COLS;
    const row = Math.floor(idx / COLS);
    const cx  = PAD + HEX_R + col * COL_W;
    const cy  = PAD + HEX_H / 2 + row * HEX_H + (col % 2 === 1 ? HEX_H / 2 : 0);
    return { ch, cx, cy, idx };
  });

  const rows   = Math.ceil(allChapters.length / COLS);
  const svgW   = PAD * 2 + HEX_R + (COLS - 1) * COL_W + HEX_R;
  const svgH   = PAD * 2 + rows * HEX_H + HEX_H / 2;

  const selectedChapter = selected ? allChapters.find((c: any) => c.id === selected) : null;
  const selectedProg    = selected ? (progressMap as any)[selected] as Progress | undefined : undefined;

  return (
    <div className="app-layout">
      <Sidebar displayName={user.display_name} username={(user as any).username} />
      <main className="app-main" style={{ padding: 0, display: "flex", flexDirection: "column", minHeight: 0 }}>

        {/* ── Header ── */}
        <div style={{ padding: "20px 28px 0", borderBottom: "1px solid var(--c-border)", background: "var(--c-surface)" }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 14 }}>
            <div>
              <h1 style={{ fontFamily: "var(--font-display)", fontSize: 22, fontWeight: 700, margin: 0, color: "var(--c-text)" }}>Map</h1>
              <p style={{ margin: "3px 0 0", fontSize: 12, color: "var(--c-text-3)" }}>
                {masteredCount} mastered · {inProgress} in progress · {totalChapters - masteredCount - inProgress} untouched
              </p>
            </div>
            {/* Add chapter — top right */}
            {adding ? (
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <input autoFocus value={newName} onChange={e => setNewName(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") addChapter(); if (e.key === "Escape") setAdding(false); }}
                  placeholder="Chapter name"
                  style={{ padding: "6px 10px", borderRadius: 8, fontSize: 13, border: "1px solid var(--c-brand-500)", outline: "none", background: "var(--c-surface)", color: "var(--c-text)", width: 180 }} />
                <button type="button" onClick={addChapter}
                  style={{ padding: "6px 12px", borderRadius: 8, fontSize: 13, fontWeight: 600, background: "var(--c-brand-500)", color: "#fff", border: "none", cursor: "pointer" }}>Add</button>
                <button type="button" onClick={() => setAdding(false)}
                  style={{ padding: "6px 10px", borderRadius: 8, fontSize: 13, background: "transparent", border: "1px solid var(--c-border)", color: "var(--c-text-3)", cursor: "pointer" }}>✕</button>
              </div>
            ) : (
              <button type="button" onClick={() => setAdding(true)}
                className="btn btn-ghost btn-sm" style={{ flexShrink: 0 }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                Add chapter
              </button>
            )}
          </div>

          {/* Subject tabs */}
          <div style={{ display: "flex", gap: 2 }}>
            {(subjects as any[]).map((s) => {
              const total    = s.chapters.length + custom.filter((c: any) => c.subjectSlug === s.slug).length;
              const mastered = s.chapters.filter((c: any) => (progressMap as any)[c.id]?.mastered).length;
              const active   = s.slug === activeSubject;
              return (
                <button key={s.slug} type="button" onClick={() => setActiveSubject(s.slug)} style={{
                  padding: "7px 16px", borderRadius: "8px 8px 0 0", fontSize: 13, fontWeight: 600,
                  background: active ? "var(--c-bg)" : "transparent",
                  color: active ? "var(--c-text)" : "var(--c-text-3)",
                  border: active ? "1px solid var(--c-border)" : "1px solid transparent",
                  borderBottom: active ? "1px solid var(--c-bg)" : "none",
                  cursor: "pointer", marginBottom: active ? -1 : 0,
                }}>
                  {s.name}
                  <span style={{ marginLeft: 6, fontSize: 10, color: active ? "var(--c-brand-500)" : "var(--c-text-3)", fontWeight: 700 }}>
                    {mastered}/{total}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Body: hex grid + detail panel ── */}
        <div style={{ flex: 1, overflowY: "auto", display: "flex", gap: 0 }}>

          {/* Hex grid */}
          <div style={{ flex: 1, padding: "24px 20px", overflowY: "auto" }}>
            {/* Legend */}
            <div style={{ display: "flex", gap: 16, marginBottom: 16, flexWrap: "wrap" }}>
              {[
                { label: "Not started", fill: "var(--c-subtle)",               stroke: "var(--c-border)" },
                { label: "1–2 steps",   fill: "var(--c-brand-100,#fadcc8)",    stroke: "var(--c-brand-200,#f2c4aa)" },
                { label: "3–4 steps",   fill: "var(--c-brand-300,#e89e6a)",    stroke: "var(--c-brand-400,#d97040)" },
                { label: "Mastered",    fill: "var(--c-brand-500)",             stroke: "var(--c-brand-600)" },
              ].map(({ label, fill, stroke }) => (
                <div key={label} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <svg width="14" height="14" viewBox="-1 -1 2 2">
                    <polygon points="1,0 0.5,0.866 -0.5,0.866 -1,0 -0.5,-0.866 0.5,-0.866"
                      fill={fill} stroke={stroke} strokeWidth="0.1" />
                  </svg>
                  <span style={{ fontSize: 11, color: "var(--c-text-3)" }}>{label}</span>
                </div>
              ))}
            </div>

            <svg
              viewBox={`0 0 ${svgW} ${svgH}`}
              style={{ overflow: "visible", display: "block", width: "100%", height: "auto" }}
            >
              {hexes.map(({ ch, cx, cy }) => {
                const prog    = (progressMap as any)[ch.id] as Progress | undefined;
                let done      = stepsDone(prog);
                let mastered  = prog?.mastered ?? false;

                // Optimistic
                if (pendingToggle?.chapterId === ch.id) {
                  if (pendingToggle.intent === "toggle_theory") {
                    const next = !pendingToggle.current;
                    done = done + (next ? 1 : -1);
                  }
                }

                const isSelected = selected === ch.id;
                const fill   = hexFill(done, mastered);
                const stroke = hexStroke(done, mastered);
                const tc     = hexTextColor(done, mastered);

                // Inner hex for selection ring (slightly smaller radius)
                const innerR = HEX_R - 2;
                const innerPoints = Array.from({ length: 6 }, (_, i) => {
                  const a = (Math.PI / 180) * (60 * i);
                  return `${cx + innerR * Math.cos(a)},${cy + innerR * Math.sin(a)}`;
                }).join(" ");

                // Word-wrap name into up to 2 lines — threshold widened so full
                // words like "Kinematics" (10 chars) don't break unnecessarily.
                const words = ch.name.split(" ");
                const lines: string[] = [];
                let cur = "";
                for (const w of words) {
                  const test = cur ? `${cur} ${w}` : w;
                  if (test.length > 11 && cur) { lines.push(cur); cur = w; }
                  else cur = test;
                }
                if (cur) lines.push(cur);
                const truncLines = lines.slice(0, 2);
                const lineH = 7.5;
                const totalH = truncLines.length * lineH;
                // Center text in the hex body (above the pip row at cy + HEX_R*0.55)
                const textAreaCenterY = cy - HEX_R * 0.08;
                const textY = textAreaCenterY - totalH / 2 + lineH * 0.75;

                return (
                  <g key={ch.id} onClick={() => setSelected(selected === ch.id ? null : ch.id)}
                    style={{ cursor: "pointer" }}>
                    {/* Base hex */}
                    <polygon
                      points={hexPoints(cx, cy)}
                      fill={fill}
                      stroke={isSelected ? "none" : stroke}
                      strokeWidth={1.5}
                      strokeLinejoin="round"
                      style={{ transition: "fill 0.25s" }}
                    />
                    {/* Selection ring — uniform width using inner polygon */}
                    {isSelected && <>
                      <polygon
                        points={hexPoints(cx, cy)}
                        fill="none"
                        stroke="var(--c-brand-600)"
                        strokeWidth={3}
                        strokeLinejoin="round"
                        style={{ filter: "drop-shadow(0 2px 6px rgba(0,0,0,0.20))" }}
                      />
                      <polygon
                        points={innerPoints}
                        fill={fill}
                        stroke="none"
                      />
                    </>}
                    {/* Step pip dots — 5 pips */}
                    {[0,1,2,3,4].map(i => {
                      const px = cx - 11 + i * 5.5;
                      const py = cy + HEX_R * 0.60;
                      const filled = i < done;
                      return (
                        <circle key={i} cx={px} cy={py} r={filled ? 2.0 : 1.6}
                          fill={filled
                            ? (mastered ? "#fff" : done >= 3 ? "var(--c-brand-700,#7a3010)" : "var(--c-brand-500)")
                            : "rgba(0,0,0,0.12)"}
                        />
                      );
                    })}
                    {/* Chapter name — Garamond, feels etched into the hex */}
                    <text
                      textAnchor="middle"
                      fontSize={6.5} fontWeight="500"
                      fontFamily="var(--font-display)"
                      letterSpacing="-0.01em"
                      fill={tc} style={{ pointerEvents: "none", userSelect: "none" }}
                    >
                      {truncLines.map((line, li) => (
                        <tspan key={li} x={cx} y={textY + li * lineH}>{line}</tspan>
                      ))}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>

          {/* Detail panel */}
          {selectedChapter && (
            <div style={{
              width: 300, flexShrink: 0, borderLeft: "1px solid var(--c-border)",
              background: "var(--c-surface)", overflowY: "auto",
              padding: "20px 20px 32px",
            }}>
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 16 }}>
                <div>
                  <div style={{ fontFamily: "var(--font-display)", fontSize: 17, fontWeight: 700, color: "var(--c-text)", lineHeight: 1.3 }}>
                    {selectedChapter.name}
                  </div>
                  {(selectedChapter as any).isCustom && (
                    <span style={{ fontSize: 9, color: "var(--c-text-3)", border: "1px solid var(--c-border)", borderRadius: 3, padding: "0 4px" }}>custom</span>
                  )}
                </div>
                <button type="button" onClick={() => setSelected(null)}
                  style={{ background: "none", border: "none", cursor: "pointer", color: "var(--c-text-3)", fontSize: 16, padding: "2px 4px" }}>✕</button>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                {STEPS.map((step, i) => {
                  let done = false;
                  if (step.key === "theory_done")        done = selectedProg?.theory_done ?? false;
                  if (step.key === "own_questions_done") done = selectedProg?.own_questions_done ?? false;
                  if (step.key === "curated_done")       done = selectedProg?.curated_done ?? false;
                  if (step.key === "arena_played")       done = selectedProg?.practice_done ?? false;
                  if (step.key === "mastered")           done = selectedProg?.mastered ?? false;

                  if (pendingToggle?.chapterId === selected) {
                    if (pendingToggle.intent === "toggle_theory" && step.key === "theory_done")
                      done = !pendingToggle.current;
                    if (pendingToggle.intent === "toggle_questions" && step.key === "own_questions_done")
                      done = !pendingToggle.current;
                  }

                  const slug = (selectedChapter as any).slug ?? selectedChapter.id;
                  return (
                    <div key={step.key} style={{
                      display: "flex", alignItems: "center", gap: 10,
                      padding: "10px 0", borderBottom: i < STEPS.length - 1 ? "1px solid var(--c-border)" : "none",
                    }}>
                      <div style={{
                        width: 24, height: 24, borderRadius: "50%", flexShrink: 0,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        background: done ? "var(--c-brand-500)" : "var(--c-border)",
                        color: done ? "#fff" : "var(--c-text-3)", fontSize: 10, fontWeight: 700,
                      }}>
                        {done ? "✓" : i + 1}
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: done ? "var(--c-text-3)" : "var(--c-text)" }}>{step.label}</div>
                      </div>
                      {/* Action */}
                      {step.key === "theory_done" && (
                        <fetcher.Form method="post">
                          <input type="hidden" name="intent"     value="toggle_theory" />
                          <input type="hidden" name="chapter_id" value={selectedChapter.id} />
                          <input type="hidden" name="current"    value={done ? "true" : "false"} />
                          <button type="submit" style={panelBtn(done)}>{done ? "Undo" : "Done"}</button>
                        </fetcher.Form>
                      )}
                      {step.key === "own_questions_done" && (
                        <fetcher.Form method="post">
                          <input type="hidden" name="intent"     value="toggle_questions" />
                          <input type="hidden" name="chapter_id" value={selectedChapter.id} />
                          <input type="hidden" name="current"    value={done ? "true" : "false"} />
                          <button type="submit" style={panelBtn(done)}>{done ? "Undo" : "Done"}</button>
                        </fetcher.Form>
                      )}
                      {step.key === "curated_done" && (
                        <fetcher.Form method="post">
                          <input type="hidden" name="intent"     value="toggle_curated" />
                          <input type="hidden" name="chapter_id" value={selectedChapter.id} />
                          <input type="hidden" name="current"    value={done ? "true" : "false"} />
                          <button type="submit" style={panelBtn(done)}>{done ? "Undo" : "Done"}</button>
                        </fetcher.Form>
                      )}
                      {step.key === "arena_played" && (
                        <fetcher.Form method="post">
                          <input type="hidden" name="intent"     value="toggle_arena" />
                          <input type="hidden" name="chapter_id" value={selectedChapter.id} />
                          <input type="hidden" name="current"    value={done ? "true" : "false"} />
                          <button type="submit" style={panelBtn(done)}>{done ? "Undo" : "Done"}</button>
                        </fetcher.Form>
                      )}
                      {step.key === "mastered" && !(selectedChapter as any).isCustom && (
                        <fetcher.Form method="post">
                          <input type="hidden" name="intent"     value="toggle_mastered" />
                          <input type="hidden" name="chapter_id" value={selectedChapter.id} />
                          <input type="hidden" name="current"    value={done ? "true" : "false"} />
                          <button type="submit" style={panelBtn(done)}>{done ? "Undo" : "Done"}</button>
                        </fetcher.Form>
                      )}
                    </div>
                  );
                })}
              </div>

              {(selectedChapter as any).isCustom && (
                <button type="button" onClick={() => removeChapter(selectedChapter.id)}
                  style={{ marginTop: 20, fontSize: 11, color: "var(--c-error)", background: "none", border: "none", cursor: "pointer" }}>
                  Remove chapter
                </button>
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

function panelBtn(active: boolean): React.CSSProperties {
  return {
    display: "inline-flex", alignItems: "center",
    padding: "4px 10px", borderRadius: 6,
    fontSize: 11, fontWeight: 600, cursor: "pointer",
    textDecoration: "none", whiteSpace: "nowrap",
    background: active ? "var(--c-subtle)" : "transparent",
    color: active ? "var(--c-text-3)" : "var(--c-brand-600)",
    border: `1px solid ${active ? "var(--c-border)" : "var(--c-brand-200,#f2c4aa)"}`,
  };
}
