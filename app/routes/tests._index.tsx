import { data, redirect, Link, Form, useFetcher, useNavigate } from "react-router";
import { useState, useRef, useEffect } from "react";
import type { Route } from "./+types/tests._index";
import { requireUser } from "~/lib/auth.server";
import { createServerClient } from "~/lib/supabase.server";
import { Sidebar } from "~/components/sidebar";
import { DotMenu } from "~/components/three-dot-menu";
import { IconLayers, IconPlus, IconPlay, IconTests, IconTrash, IconX, IconFlash } from "~/components/icons";
import { useFetcher as useQuickFetcher } from "react-router";

type TestSummary = {
  id: string; title: string; duration_mins: number;
  is_published: boolean; created_at: string;
  visibility: "public" | "invite_only" | "private";
  section_count: number; question_count: number;
  submitted: boolean; in_progress: boolean;
  score_total: number | null; score_max: number | null;
  layers: TestSummary[];
};

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const user = await requireUser(request, env);
  const supabase = createServerClient(env);

  const { data: raw } = await supabase
    .from("tests")
    .select("id, title, duration_mins, is_published, visibility, created_at, test_sections(id, test_questions(question_id))")
    .eq("owner_id", user.id)
    .order("created_at", { ascending: false });

  const { data: myAttempts } = await supabase
    .from("attempts")
    .select("test_id, submitted_at, score_breakdown")
    .eq("student_id", user.id);

  const attemptMap = new Map<string, { submitted: boolean; scoreTotal: number | null; scoreMax: number | null }>();
  for (const a of (myAttempts ?? [])) {
    const sb = a.score_breakdown as any;
    attemptMap.set(a.test_id, {
      submitted: !!a.submitted_at,
      scoreTotal: sb?.total ?? null,
      scoreMax:   sb?.max_marks ?? null,
    });
  }

  const flat: TestSummary[] = (raw ?? []).map((t: any) => {
    const sections: any[] = t.test_sections ?? [];
    const questionCount = sections.reduce((sum: number, s: any) => sum + ((s.test_questions as any[])?.length ?? 0), 0);
    const att = attemptMap.get(t.id);
    return {
      id: t.id, title: t.title, duration_mins: t.duration_mins,
      is_published: t.is_published,
      visibility: t.visibility ?? "public",
      created_at: t.created_at,
      section_count: sections.length, question_count: questionCount,
      submitted:   att?.submitted    ?? false,
      in_progress: (att && !att.submitted) ? true : false,
      score_total: att?.scoreTotal ?? null,
      score_max:   att?.scoreMax   ?? null,
      layers: [],
    };
  });

  // Group [Layer N>=2] tests as sub-layers of their base test
  const layerRegex = /\[Layer (\d+)\]/;
  const layerMap = new Map<string, TestSummary[]>();
  for (const t of flat) {
    const m = t.title.match(layerRegex);
    if (m && parseInt(m[1]) >= 2) {
      const base = t.title.replace(/\s*\[Layer \d+\]/, "").trim();
      if (!layerMap.has(base)) layerMap.set(base, []);
      layerMap.get(base)!.push(t);
    }
  }

  const tests: TestSummary[] = [];
  for (const t of flat) {
    const m = t.title.match(layerRegex);
    if (m && parseInt(m[1]) >= 2) continue;
    const base = t.title.replace(/\s*\[Layer \d+\]/, "").trim();
    t.layers = (layerMap.get(base) ?? []).sort((a, b) => {
      const na = parseInt(a.title.match(layerRegex)?.[1] ?? "0");
      const nb = parseInt(b.title.match(layerRegex)?.[1] ?? "0");
      return na - nb;
    });
    tests.push(t);
  }

  return { user, tests };
}

export async function action({ request, context }: Route.ActionArgs) {
  const env = context.cloudflare.env;
  const user = await requireUser(request, env);
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");
  const supabase = createServerClient(env);

  if (intent === "create_test") {
    const title = String(formData.get("title") ?? "").trim();
    const description = String(formData.get("description") ?? "").trim() || null;
    const durationMins = parseInt(String(formData.get("duration_mins") ?? ""), 10);
    const visibility = String(formData.get("visibility") ?? "public");
    if (!title) return data({ error: "Title is required" }, { status: 400 });
    if (isNaN(durationMins) || durationMins <= 0) return data({ error: "Duration must be a positive number" }, { status: 400 });
    const { data: test, error } = await supabase
      .from("tests")
      .insert({ owner_id: user.id, title, description, duration_mins: durationMins, is_published: false, visibility })
      .select("id")
      .single();
    if (error) return data({ error: error.message }, { status: 500 });
    throw redirect(`/tests/${test.id}`);
  }

  if (intent === "toggle_publish") {
    const id = String(formData.get("id") ?? "");
    const current = formData.get("is_published") === "true";
    await supabase.from("tests").update({ is_published: !current }).eq("id", id).eq("owner_id", user.id);
    return null;
  }

  if (intent === "set_visibility") {
    const id = String(formData.get("id") ?? "");
    const visibility = String(formData.get("visibility") ?? "public");
    await supabase.from("tests").update({ visibility }).eq("id", id).eq("owner_id", user.id);
    return null;
  }

  if (intent === "delete_test") {
    const id = String(formData.get("id") ?? "");
    await supabase.from("tests").delete().eq("id", id).eq("owner_id", user.id);
    return null;
  }

  if (intent === "quick_chemistry_test") {
    // Pull all chemistry SCQs owned by this user
    const { data: qs } = await supabase
      .from("questions")
      .select("id")
      .eq("owner_id", user.id)
      .eq("subject", "chemistry")
      .eq("type", "scq");

    const pool = (qs ?? []) as { id: string }[];
    if (pool.length === 0) return data({ error: "No Chemistry SCQs found in your library." }, { status: 400 });

    // Fisher-Yates shuffle
    for (let j = pool.length - 1; j > 0; j--) {
      const k = Math.floor(Math.random() * (j + 1));
      [pool[j], pool[k]] = [pool[k], pool[j]];
    }

    // Pick a random count between 10 and 15 (capped to what's available)
    const targetCount = Math.min(pool.length, 10 + Math.floor(Math.random() * 6));
    const picked      = pool.slice(0, targetCount);

    // Duration: 2 minutes per question
    const durationMins = targetCount * 2;

    const now = new Date();
    const label = `${now.toLocaleDateString("en-IN", { day: "numeric", month: "short" })} ${now.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}`;
    const title = `Quick Chemistry · ${picked.length}Q · ${label}`;

    const { data: test, error: testErr } = await supabase
      .from("tests")
      .insert({ owner_id: user.id, title, duration_mins: durationMins, is_published: true })
      .select("id")
      .single();
    if (testErr || !test) return data({ error: "Failed to create quick test." }, { status: 500 });

    const { data: sec, error: secErr } = await supabase
      .from("test_sections")
      .insert({
        test_id: test.id,
        name: "Chemistry — Mixed SCQ",
        question_type: "scq",
        subject: "chemistry",
        marks_correct: 4,
        marks_wrong: -1,
        display_order: 1,
      })
      .select("id")
      .single();
    if (secErr || !sec) return data({ error: "Failed to create section." }, { status: 500 });

    await supabase.from("test_questions").insert(
      picked.map((q, idx) => ({ test_section_id: sec.id, question_id: q.id, display_order: idx + 1 }))
    );

    throw redirect(`/tests/${test.id}/preview`);
  }

  return null;
}

// ── Visibility helpers ─────────────────────────────────────────

const VISIBILITY_LABELS: Record<string, { icon: string; label: string; hint: string }> = {
  public:      { icon: "globe", label: "Public",      hint: "Listed on Discover for everyone" },
  invite_only: { icon: "link",  label: "Invite only", hint: "Accessible via direct link only" },
  private:     { icon: "lock",  label: "Private",     hint: "Only visible to you" },
};

// ── NewTestModal ───────────────────────────────────────────────

function NewTestModal({ onClose, error }: { onClose: () => void; error?: string | null }) {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); }, []);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-box create-test-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="modal-header">
          <div>
            <span className="modal-title">Create a new test</span>
            <p style={{ fontSize: 12.5, color: "var(--c-text-3)", marginTop: 2, fontWeight: 400 }}>
              Set up the basics — you'll add questions next.
            </p>
          </div>
          <button type="button" className="btn btn-icon btn-ghost" onClick={onClose}><IconX size={16} /></button>
        </div>

        <Form method="post" className="modal-body" style={{ gap: 18 }}>
          <input type="hidden" name="intent" value="create_test" />
          {error && <div className="alert-error">{error}</div>}

          {/* Title */}
          <div className="field">
            <label className="label" htmlFor="test-title">Test title</label>
            <input ref={inputRef} id="test-title" name="title" className="input" placeholder="e.g. JEE Main Mock — Paper 1" autoComplete="off" />
          </div>

          {/* Description */}
          <div className="field">
            <label className="label" htmlFor="test-description">
              Description <span style={{ fontWeight: 400, color: "var(--c-text-3)" }}>(optional)</span>
            </label>
            <textarea
              id="test-description"
              name="description"
              className="input"
              placeholder="e.g. Covers Mechanics, Thermodynamics, Electrochemistry..."
              rows={2}
              style={{ resize: "vertical" as const }}
            />
          </div>

          {/* Duration */}
          <div className="field">
            <label className="label">Duration</label>
            <div className="create-test-duration-row">
              {[60, 90, 120, 180].map((mins) => (
                <label key={mins} className="create-test-duration-chip">
                  <input type="radio" name="duration_mins" value={mins} defaultChecked={mins === 180} style={{ display: "none" }} />
                  <span>{mins === 60 ? "1h" : mins === 90 ? "1h 30m" : mins === 120 ? "2h" : "3h"}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Visibility */}
          <div className="field">
            <label className="label">Visibility</label>
            <div className="create-test-duration-row">
              {(["public", "invite_only", "private"] as const).map((v) => {
                const meta = VISIBILITY_LABELS[v];
                return (
                  <label key={v} className="create-test-duration-chip" title={meta.hint}>
                    <input type="radio" name="visibility" value={v} defaultChecked={v === "public"} style={{ display: "none" }} />
                    <span>{meta.icon} {meta.label}</span>
                  </label>
                );
              })}
            </div>
          </div>

          <div className="modal-footer" style={{ marginTop: 6 }}>
            <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary btn-sm">Create &amp; add questions →</button>
          </div>
        </Form>
      </div>
    </div>
  );
}

// ── ScoreBadge ─────────────────────────────────────────────────

function ScoreBadge({ total, max }: { total: number; max: number }) {
  const pct = max > 0 ? Math.round((total / max) * 100) : 0;
  const color = pct >= 70 ? "var(--c-success)" : pct >= 40 ? "var(--c-brand-500)" : "var(--c-error)";
  return (
    <span style={{ fontSize: 11, fontWeight: 700, color, background: "var(--c-surface-2)", padding: "2px 8px", borderRadius: 20 }}>
      {total}/{max} · {pct}%
    </span>
  );
}

// ── LayerRow ───────────────────────────────────────────────────

function LayerRow({ layer }: { layer: TestSummary }) {
  const fetcher = useFetcher();
  const layerMatch = layer.title.match(/\[Layer (\d+)\]/);
  const layerNum = layerMatch ? parseInt(layerMatch[1]) : "?";
  const hrs = Math.floor(layer.duration_mins / 60);
  const mins = layer.duration_mins % 60;
  const durationStr = hrs > 0 ? `${hrs}h ${mins > 0 ? `${mins}m` : ""}`.trim() : `${mins}m`;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 16px 9px 44px", borderTop: "1px solid var(--c-border-subtle)", background: "var(--c-surface-2)" }}>
      <span className="chain-layer-badge" style={{ margin: 0, flexShrink: 0 }}>Layer {layerNum}</span>
      <span style={{ fontSize: 13, color: "var(--c-text-2)", flex: 1 }}>
        {durationStr} · {layer.section_count} section{layer.section_count !== 1 ? "s" : ""} · {layer.question_count} Q
      </span>
      {layer.submitted && layer.score_total !== null && layer.score_max !== null && (
        <ScoreBadge total={layer.score_total} max={layer.score_max} />
      )}
      {layer.submitted ? (
        <Link to={`/tests/${layer.id}/result`} className="btn btn-ghost btn-sm" style={{ fontSize: 12, padding: "4px 10px" }}>View Result</Link>
      ) : layer.is_published ? (
        <Link to={`/tests/${layer.id}/preview`} className="btn btn-ghost btn-sm" style={{ fontSize: 12, padding: "4px 10px" }}>
          <IconPlay size={11} /> {layer.in_progress ? "Resume" : "Take"}
        </Link>
      ) : null}
      <Form method="post" style={{ display: "contents" }}>
        <input type="hidden" name="intent" value="delete_test" />
        <input type="hidden" name="id" value={layer.id} />
        <button type="submit" title="Delete layer"
          onClick={(e) => { if (!confirm(`Delete Layer ${layerNum}?`)) e.preventDefault(); }}
          style={{ background: "none", border: "none", cursor: "pointer", color: "var(--c-text-3)", padding: "2px 4px" }}>
          <IconTrash size={13} />
        </button>
      </Form>
    </div>
  );
}

// ── TestCard ───────────────────────────────────────────────────

function VisibilityIcon({ icon }: { icon: string }) {
  if (icon === "globe") return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ display:"inline-block", verticalAlign:"middle", marginBottom:1 }}>
      <circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/>
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
    </svg>
  );
  if (icon === "link") return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ display:"inline-block", verticalAlign:"middle", marginBottom:1 }}>
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
    </svg>
  );
  if (icon === "lock") return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ display:"inline-block", verticalAlign:"middle", marginBottom:1 }}>
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
      <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
    </svg>
  );
  return null;
}

function TestCard({ test: t }: { test: TestSummary }) {
  const fetcher = useFetcher();
  const navigate = useNavigate();
  const [layersOpen, setLayersOpen] = useState(false);
  const hrs = Math.floor(t.duration_mins / 60);
  const mins = t.duration_mins % 60;
  const durationStr = hrs > 0 ? `${hrs}h ${mins > 0 ? `${mins}m` : ""}`.trim() : `${mins}m`;

  const isPublished = fetcher.formData
    ? fetcher.formData.get("is_published") !== "true"
    : t.is_published;

  function handleTogglePublish() {
    const fd = new FormData();
    fd.set("intent", "toggle_publish"); fd.set("id", t.id); fd.set("is_published", String(t.is_published));
    fetcher.submit(fd, { method: "post" });
  }

  function handleSetVisibility(visibility: string) {
    const fd = new FormData();
    fd.set("intent", "set_visibility"); fd.set("id", t.id); fd.set("visibility", visibility);
    fetcher.submit(fd, { method: "post" });
  }

  const layerMatch = t.title.match(/\[Layer (\d+)\]/);
  const displayTitle = t.title.replace(/\s*\[Layer \d+\]/, "");
  const layerNum = layerMatch ? parseInt(layerMatch[1]) : null;
  const hasLayers = t.layers.length > 0;

  const visibilityMeta = VISIBILITY_LABELS[t.visibility] ?? VISIBILITY_LABELS.public;

  // Build visibility menu items - only show options that aren't the current state
  const visibilityItems = [];
  if (t.visibility !== "public") {
    visibilityItems.push({ type: "action" as const, label: "Make Public", onClick: () => handleSetVisibility("public") });
  }
  if (t.visibility !== "invite_only") {
    visibilityItems.push({ type: "action" as const, label: "Make Invite only", onClick: () => handleSetVisibility("invite_only") });
  }
  if (t.visibility !== "private") {
    visibilityItems.push({ type: "action" as const, label: "Make Private", onClick: () => handleSetVisibility("private") });
  }

  const menuItems = [
    { type: "action" as const, label: "Edit test", icon: <IconTests size={14} />, onClick: () => { navigate(`/tests/${t.id}`); } },
    { type: "sep" as const },
    { type: "action" as const, label: isPublished ? "Unpublish" : "Publish", onClick: handleTogglePublish },
    { type: "sep" as const },
    ...visibilityItems,
    { type: "sep" as const },
    {
      type: "action" as const, label: "Delete test", icon: <IconTrash size={14} />, danger: true,
      onClick: () => {
        if (!confirm(`Delete "${t.title}"?`)) return;
        const fd = new FormData(); fd.set("intent", "delete_test"); fd.set("id", t.id);
        fetcher.submit(fd, { method: "post" });
      }
    },
  ];

  // Where the card click navigates
  const rowDestination = isPublished
    ? (t.submitted ? `/tests/${t.id}/result` : `/tests/${t.id}/preview`)
    : `/tests/${t.id}`;

  return (
    <div className="list-row" style={{ flexDirection: "column", alignItems: "stretch", padding: 0, gap: 0 }}>
      {/* Clickable card row — use div+navigate so inner buttons can stopPropagation cleanly */}
      <div
        onClick={() => navigate(rowDestination)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "14px 16px",
          cursor: "pointer",
        }}
      >
        <div className="list-row-left" style={{ flex: 1, minWidth: 0 }}>
          <div className="list-row-icon">
            {hasLayers ? <IconLayers size={15} /> : <IconTests size={15} />}
          </div>
          <div className="list-row-text">
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              {layerNum && <span className="chain-layer-badge" style={{ marginBottom: 0 }}>Layer {layerNum}</span>}
              <span className="list-row-title">{displayTitle}</span>
              {hasLayers && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setLayersOpen(v => !v); }}
                  style={{ background: "var(--c-surface-2)", border: "none", borderRadius: 10, padding: "1px 8px", fontSize: 11, fontWeight: 600, color: "var(--c-brand-500)", cursor: "pointer" }}
                >
                  {t.layers.length} layer{t.layers.length !== 1 ? "s" : ""} {layersOpen ? "▲" : "▼"}
                </button>
              )}
            </div>
            <span className="list-row-meta">
              {durationStr} · {t.section_count} section{t.section_count !== 1 ? "s" : ""} · {t.question_count} question{t.question_count !== 1 ? "s" : ""}
            </span>
          </div>
        </div>
        <div className="list-row-right">
          {t.submitted && t.score_total !== null && t.score_max !== null && (
            <ScoreBadge total={t.score_total} max={t.score_max} />
          )}
          {!isPublished ? (
            <span className="list-status-badge draft">Draft</span>
          ) : (
            <span className={`list-status-badge ${t.visibility === 'public' ? 'published' : t.visibility === 'private' ? 'private' : 'invite'}`}>
              {visibilityMeta.label}
            </span>
          )}
          {isPublished ? (
            t.submitted ? (
              <Link
                to={`/tests/${t.id}/result`}
                className="btn btn-ghost btn-sm"
                onClick={(e) => e.stopPropagation()}
              >
                View Result
              </Link>
            ) : (
              <Link
                to={`/tests/${t.id}/preview`}
                className="btn btn-primary btn-sm"
                onClick={(e) => e.stopPropagation()}
              >
                <IconPlay size={12} /> {t.in_progress ? "Resume" : "Take test"}
              </Link>
            )
          ) : (
            <Link
              to={`/tests/${t.id}`}
              className="btn btn-ghost btn-sm"
              onClick={(e) => e.stopPropagation()}
            >
              Edit
            </Link>
          )}
          {/* Wrap DotMenu to stop card navigation firing when the menu is opened */}
          <span onClick={(e) => e.stopPropagation()}>
            <DotMenu items={menuItems} />
          </span>
        </div>
      </div>
      {hasLayers && layersOpen && t.layers.map(layer => <LayerRow key={layer.id} layer={layer} />)}
    </div>
  );
}

// ── LayeredExplainer ───────────────────────────────────────────

function LayeredExplainer() {
  return (
    <div className="layer-explainer">
      <p className="layer-explainer-label"><IconLayers size={12} /> How layered tests work</p>
      <div className="layer-explainer-steps">
        {[
          { n: "1", title: "Take the test", body: "Complete an NTA-style exam from your question bank." },
          { n: "2", title: "Wrong answers → Layer 2", body: "Every question you got wrong is pulled into a new test automatically." },
          { n: "3", title: "Repeat until zero", body: "Keep layering until every question is answered correctly." },
        ].map((step) => (
          <div key={step.n} className="layer-explainer-step">
            <div className="layer-explainer-num">{step.n}</div>
            <div>
              <p className="layer-explainer-step-title">{step.title}</p>
              <p className="layer-explainer-step-body">{step.body}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────

export default function TestsIndex({ loaderData, actionData }: Route.ComponentProps) {
  const { user, tests } = loaderData;
  const error = actionData && "error" in actionData ? actionData.error : null;
  const [showCreate, setShowCreate] = useState(false);
  const quickFetcher = useQuickFetcher();

  const unattempted = tests.filter((t) => !t.submitted);
  const attempted   = tests.filter((t) => t.submitted);

  return (
    <div className="app-layout">
      <Sidebar displayName={user.display_name} />
      <main className="app-main">
        <div className="pg-head">
          <div>
            <h1 className="pg-title">Tests</h1>
            <p className="pg-subtitle">{tests.length === 0 ? "Create and take NTA-style layered tests" : `${tests.length} test${tests.length === 1 ? "" : "s"}`}</p>
          </div>
          {tests.length > 0 && (
            <div style={{ display: "flex", gap: 8 }}>
              <quickFetcher.Form method="post">
                <input type="hidden" name="intent" value="quick_chemistry_test" />
                <button
                  type="submit"
                  className="btn btn-ghost btn-sm"
                  title="Pick 10–15 random Chemistry SCQs and start immediately"
                  disabled={quickFetcher.state !== "idle"}
                >
                  ⚗️ {quickFetcher.state !== "idle" ? "Creating…" : "Quick test"}
                </button>
              </quickFetcher.Form>
              <Link to="/tests/generate" className="btn btn-ghost btn-sm">
                <IconFlash size={14} /> Generate
              </Link>
              <button className="btn btn-primary btn-sm" onClick={() => setShowCreate(true)}>
                <IconPlus size={14} /> New test
              </button>
            </div>
          )}
        </div>

        <div className="pg-body">
          {tests.length === 0 ? (
            <>
              <div className="lib-empty">
                <div className="lib-empty-icon" style={{ color: "var(--c-brand-400)" }}><IconLayers size={28} /></div>
                <p className="lib-empty-title">No tests yet</p>
                <p className="lib-empty-body">Create your first test. Every wrong answer automatically becomes the next layer.</p>
                <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
                  <button className="btn btn-primary" onClick={() => setShowCreate(true)}><IconPlus size={15} /> Create a test</button>
                  <quickFetcher.Form method="post">
                    <input type="hidden" name="intent" value="quick_chemistry_test" />
                    <button type="submit" className="btn btn-ghost" disabled={quickFetcher.state !== "idle"}>
                      ⚗️ {quickFetcher.state !== "idle" ? "Creating…" : "Quick Chemistry test"}
                    </button>
                  </quickFetcher.Form>
                </div>
              </div>
              <LayeredExplainer />
            </>
          ) : (
            <>
              {unattempted.length > 0 && (
                <section className="tests-section">
                  {attempted.length > 0 && (
                    <h2 className="tests-section-title" style={{ marginBottom: 10, marginTop: 0 }}>Unattempted</h2>
                  )}
                  <div className="list-view">
                    {unattempted.map((t) => <TestCard key={t.id} test={t} />)}
                  </div>
                </section>
              )}
              {attempted.length > 0 && (
                <section className="tests-section" style={{ marginTop: unattempted.length > 0 ? 28 : 0 }}>
                  <h2 className="tests-section-title" style={{ marginBottom: 10 }}>Attempted</h2>
                  <div className="list-view">
                    {attempted.map((t) => <TestCard key={t.id} test={t} />)}
                  </div>
                </section>
              )}
              <LayeredExplainer />
            </>
          )}
        </div>
      </main>
      {showCreate && <NewTestModal onClose={() => setShowCreate(false)} error={error} />}
    </div>
  );
}
