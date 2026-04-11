import { data, redirect, Link, Form, useSearchParams, useFetcher } from "react-router";
import { useState, useRef, useEffect } from "react";
import type { Route } from "./+types/library.folders.$id";
import { requireUser } from "~/lib/auth.server";
import { createServerClient } from "~/lib/supabase.server";
import { deleteImage } from "~/lib/storage.server";
import type { Subject, QuestionType } from "~/lib/database.types";
import { Sidebar } from "~/components/sidebar";
import { DotMenu } from "~/components/three-dot-menu";
import { IconFolder, IconPlus, IconTrash, IconShare, IconX, IconChevronRight, IconEdit } from "~/components/icons";

type FolderRow = { id: string; name: string; created_at: string; question_count: number; subfolder_count: number };
type QuestionRow = { id: string; image_url: string; type: QuestionType; subject: Subject; chapter: string; is_shared: boolean; created_at: string };
type BreadcrumbItem = { id: string | null; name: string };

// ── Loader / Action (logic unchanged) ─────────────────────────
export async function loader({ request, params, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const user = await requireUser(request, env);
  const supabase = createServerClient(env);
  const folderId = params.id!;
  const url = new URL(request.url);
  const subject = (url.searchParams.get("subject") || null) as Subject | null;
  const qtype  = (url.searchParams.get("type")    || null) as QuestionType | null;

  const { data: folder, error: folderError } = await supabase.from("folders").select("id, name, parent_id").eq("id", folderId).eq("owner_id", user.id).single();
  if (folderError || !folder) throw redirect("/library");

  const breadcrumb: BreadcrumbItem[] = [{ id: null, name: "Library" }];
  let current: { id: string; name: string; parent_id: string | null } | null = folder;
  const trail: BreadcrumbItem[] = [];
  let depth = 0;
  while (current && depth < 5) {
    trail.unshift({ id: current.id, name: current.name });
    if (!current.parent_id) break;
    const { data: parent } = await supabase.from("folders").select("id, name, parent_id").eq("id", current.parent_id).eq("owner_id", user.id).single();
    current = parent ?? null; depth++;
  }
  breadcrumb.push(...trail);

  const { data: rawSubFolders } = await supabase.from("folders").select("id, name, created_at").eq("owner_id", user.id).eq("parent_id", folderId).order("name", { ascending: true });
  const subFolderIds = (rawSubFolders ?? []).map((f) => f.id);
  let folderCounts: Record<string, number> = {};
  let subFolderCounts: Record<string, number> = {};
  if (subFolderIds.length > 0) {
    const { data: countRows } = await supabase.from("questions").select("folder_id").in("folder_id", subFolderIds).eq("owner_id", user.id);
    for (const row of countRows ?? []) { if (row.folder_id) folderCounts[row.folder_id] = (folderCounts[row.folder_id] ?? 0) + 1; }
    const { data: subSubRows } = await supabase.from("folders").select("parent_id").in("parent_id", subFolderIds).eq("owner_id", user.id);
    for (const row of subSubRows ?? []) { if (row.parent_id) subFolderCounts[row.parent_id] = (subFolderCounts[row.parent_id] ?? 0) + 1; }
  }
  const subFolders: FolderRow[] = (rawSubFolders ?? []).map((f) => ({ ...f, question_count: folderCounts[f.id] ?? 0, subfolder_count: subFolderCounts[f.id] ?? 0 }));

  let qQuery = supabase.from("questions").select("id, image_url, type, subject, chapter, is_shared, created_at").eq("owner_id", user.id).eq("folder_id", folderId).order("created_at", { ascending: false });
  if (subject) qQuery = qQuery.eq("subject", subject);
  if (qtype)   qQuery = qQuery.eq("type", qtype);
  const { data: questions } = await qQuery;

  const { count: totalInFolder } = await supabase.from("questions").select("id", { count: "exact", head: true }).eq("owner_id", user.id).eq("folder_id", folderId);

  // All folders this user owns (for move-question target picker)
  const { data: allFolders } = await supabase.from("folders").select("id, name").eq("owner_id", user.id).order("name", { ascending: true });

  return { user, folder: { id: folder.id, name: folder.name }, breadcrumb, subFolders, questions: (questions ?? []) as QuestionRow[], totalInFolder: totalInFolder ?? 0, filter: { subject, type: qtype }, allFolders: (allFolders ?? []) as { id: string; name: string }[] };
}

export async function action({ request, params, context }: Route.ActionArgs) {
  const env = context.cloudflare.env;
  const user = await requireUser(request, env);
  const folderId = params.id!;
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");
  const supabase = createServerClient(env);

  if (intent === "create_subfolder") {
    const name = String(formData.get("name") ?? "").trim();
    if (!name) return data({ error: "Folder name is required" }, { status: 400 });
    await supabase.from("folders").insert({ owner_id: user.id, name, parent_id: folderId });
    return null;
  }
  if (intent === "rename_this_folder") {
    const name = String(formData.get("name") ?? "").trim();
    if (name) await supabase.from("folders").update({ name }).eq("id", folderId).eq("owner_id", user.id);
    return null;
  }
  if (intent === "rename_subfolder") {
    const id   = String(formData.get("id")   ?? "");
    const name = String(formData.get("name") ?? "").trim();
    if (name) await supabase.from("folders").update({ name }).eq("id", id).eq("owner_id", user.id);
    return null;
  }
  if (intent === "move_question") {
    const questionId     = String(formData.get("question_id")    ?? "");
    const targetFolderId = String(formData.get("target_folder_id") ?? "");
    await supabase.from("questions").update({ folder_id: targetFolderId }).eq("id", questionId).eq("owner_id", user.id);
    return null;
  }
  if (intent === "delete_folder") {
    const id = String(formData.get("id") ?? "");
    const folderQueue = [id]; const allImageUrls: string[] = [];
    while (folderQueue.length > 0) {
      const currentId = folderQueue.shift()!;
      const { data: qs } = await supabase.from("questions").select("image_url").eq("folder_id", currentId).eq("owner_id", user.id);
      for (const q of qs ?? []) { if (q.image_url) allImageUrls.push(q.image_url); }
      const { data: subs } = await supabase.from("folders").select("id").eq("parent_id", currentId).eq("owner_id", user.id);
      for (const sub of subs ?? []) folderQueue.push(sub.id);
    }
    await supabase.from("folders").delete().eq("id", id).eq("owner_id", user.id);
    await Promise.all(allImageUrls.map((url) => deleteImage(url, env)));
    return null;
  }
  if (intent === "delete_question") {
    const id = String(formData.get("id") ?? "");
    const { data: q } = await supabase.from("questions").select("image_url").eq("id", id).eq("owner_id", user.id).single();
    await supabase.from("questions").delete().eq("id", id).eq("owner_id", user.id);
    if (q?.image_url) await deleteImage(q.image_url, env);
    return null;
  }
  if (intent === "toggle_share") {
    const id = String(formData.get("id") ?? "");
    const current = formData.get("is_shared") === "true";
    await supabase.from("questions").update({ is_shared: !current }).eq("id", id).eq("owner_id", user.id);
    return null;
  }
  if (intent === "delete_this_folder") {
    const folderQueue = [folderId]; const allImageUrls: string[] = [];
    while (folderQueue.length > 0) {
      const currentId = folderQueue.shift()!;
      const { data: qs } = await supabase.from("questions").select("image_url").eq("folder_id", currentId).eq("owner_id", user.id);
      for (const q of qs ?? []) { if (q.image_url) allImageUrls.push(q.image_url); }
      const { data: subs } = await supabase.from("folders").select("id").eq("parent_id", currentId).eq("owner_id", user.id);
      for (const sub of subs ?? []) folderQueue.push(sub.id);
    }
    await supabase.from("folders").delete().eq("id", folderId).eq("owner_id", user.id);
    await Promise.all(allImageUrls.map((url) => deleteImage(url, env)));
    throw redirect("/library");
  }
  return null;
}

// ── Shared components ──────────────────────────────────────────
function MoveQuestionModal({ question, allFolders, currentFolderId, onClose }: {
  question: QuestionRow; allFolders: { id: string; name: string }[];
  currentFolderId: string; onClose: () => void;
}) {
  const fetcher = useFetcher();
  useEffect(() => { if (fetcher.state === "idle" && fetcher.data !== undefined) onClose(); }, [fetcher.state, fetcher.data]);
  const targets = allFolders.filter(f => f.id !== currentFolderId);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-box" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="modal-header">
          <span className="modal-title">Move question to…</span>
          <button type="button" className="btn btn-icon btn-ghost" onClick={onClose}><IconX size={16} /></button>
        </div>
        <div className="modal-body" style={{ gap: 8 }}>
          {targets.length === 0 ? (
            <p style={{ fontSize: 13, color: "var(--c-text-3)" }}>No other folders available.</p>
          ) : targets.map(f => (
            <fetcher.Form key={f.id} method="post" style={{ display: "contents" }}>
              <input type="hidden" name="intent" value="move_question" />
              <input type="hidden" name="question_id" value={question.id} />
              <input type="hidden" name="target_folder_id" value={f.id} />
              <button type="submit" style={{
                display: "flex", alignItems: "center", gap: 10,
                padding: "10px 14px", borderRadius: 8,
                border: "1px solid var(--c-border)", background: "var(--c-surface)",
                cursor: "pointer", width: "100%", textAlign: "left" as const, color: "var(--c-text-1)", fontSize: 14,
              }}>
                <IconFolder size={15} />{f.name}
              </button>
            </fetcher.Form>
          ))}
        </div>
        <div className="modal-footer" style={{ borderTop: "1px solid var(--c-border-subtle)", paddingTop: 12 }}>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

function QuestionCard({ question: q, allFolders, currentFolderId }: {
  question: QuestionRow; allFolders: { id: string; name: string }[]; currentFolderId: string;
}) {
  const [moving, setMoving] = useState(false);
  const subj = SUBJECT_META[q.subject]; const type = TYPE_META[q.type];
  return (
    <>
      <Link to={`/questions/${q.id}`} className="q-card" style={{ textDecoration: "none" }}>
        <div className="q-card-thumb"><img src={q.image_url} alt="Question" /></div>
        <div className="q-card-body">
          <div className="q-card-badges">
            <span className="q-badge" style={{ background: subj.bg, color: subj.text }}>{subj.short}</span>
            <span className="q-badge" style={{ background: type.bg, color: type.text }}>{type.label}</span>
          </div>
          <p className="q-card-chapter">{q.chapter || <span style={{ color: "var(--c-border-strong)" }}>No chapter</span>}</p>
          <div className="q-card-foot">
            <button type="button" className="q-card-action" title="Move to folder"
              onClick={e => { e.preventDefault(); setMoving(true); }}
              style={{ opacity: 0.6 }}>
              <IconFolder size={13} />
            </button>
            <Form method="post" style={{ display: "inline" }} onClick={(e) => e.stopPropagation()}>
              <input type="hidden" name="intent" value="toggle_share" /><input type="hidden" name="id" value={q.id} /><input type="hidden" name="is_shared" value={String(q.is_shared)} />
              <button type="submit" className="q-card-action" style={{ opacity: q.is_shared ? 1 : 0.3 }}><IconShare size={13} /></button>
            </Form>
            <Form method="post" style={{ display: "inline" }} onClick={(e) => e.stopPropagation()} onSubmit={(e) => { if (!confirm("Delete this question?")) e.preventDefault(); }}>
              <input type="hidden" name="intent" value="delete_question" /><input type="hidden" name="id" value={q.id} />
              <button type="submit" className="q-card-action q-card-action-danger"><IconTrash size={13} /></button>
            </Form>
          </div>
        </div>
      </Link>
      {moving && <MoveQuestionModal question={q} allFolders={allFolders} currentFolderId={currentFolderId} onClose={() => setMoving(false)} />}
    </>
  );
}

function RenameSubfolderModal({ folder, onClose }: { folder: FolderRow; onClose: () => void }) {
  const fetcher = useFetcher();
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => { if (fetcher.state === "idle" && fetcher.data !== undefined) onClose(); }, [fetcher.state, fetcher.data]);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-box" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="modal-header">
          <span className="modal-title">Rename folder</span>
          <button type="button" className="btn btn-icon btn-ghost" onClick={onClose}><IconX size={16} /></button>
        </div>
        <fetcher.Form method="post" className="modal-body">
          <input type="hidden" name="intent" value="rename_subfolder" />
          <input type="hidden" name="id" value={folder.id} />
          <div className="field">
            <label className="label">New name</label>
            <input ref={inputRef} name="name" className="input" defaultValue={folder.name} autoComplete="off" />
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary btn-sm" disabled={fetcher.state !== "idle"}>Rename</button>
          </div>
        </fetcher.Form>
      </div>
    </div>
  );
}

function SubFolderCard({ folder, onDelete }: { folder: FolderRow; onDelete: (id: string) => void }) {
  const [renaming, setRenaming] = useState(false);
  const menuItems = [
    { type: "action" as const, label: "Rename", icon: <IconEdit size={14} />, onClick: () => setRenaming(true) },
    { type: "sep" as const },
    { type: "action" as const, label: "Delete folder", icon: <IconTrash size={14} />, danger: true, onClick: () => onDelete(folder.id) },
  ];

  function meta() {
    const parts: string[] = [];
    if (folder.question_count > 0) parts.push(`${folder.question_count} question${folder.question_count === 1 ? "" : "s"}`);
    if (folder.subfolder_count > 0) parts.push(`${folder.subfolder_count} sub-folder${folder.subfolder_count === 1 ? "" : "s"}`);
    return parts.length > 0 ? parts.join(" · ") : "Empty";
  }

  return (
    <>
      <div className="list-row">
        <Link to={`/library/folders/${folder.id}`} className="list-row-left" style={{ textDecoration: "none", flex: 1, minWidth: 0 }}>
          <div className="list-row-icon"><IconFolder size={15} /></div>
          <div className="list-row-text">
            <span className="list-row-title">{folder.name}</span>
            <span className="list-row-meta">{meta()}</span>
          </div>
        </Link>
        <div className="list-row-right">
          <DotMenu items={menuItems} />
        </div>
      </div>
      {renaming && <RenameSubfolderModal folder={folder} onClose={() => setRenaming(false)} />}
    </>
  );
}

function FilterChip({ label, active, color, onClick }: { label: string; active: boolean; color?: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={`filter-chip${active ? " active" : ""}`} style={active && color ? { borderColor: color, color, background: color + "18" } : {}}>
      {label}
    </button>
  );
}

function NewSubfolderModal({ onClose }: { onClose: () => void }) {
  const fetcher = useFetcher();
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => { if (fetcher.state === "idle" && fetcher.data !== undefined) onClose(); }, [fetcher.state, fetcher.data, onClose]);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="modal-header">
          <span className="modal-title">New sub-folder</span>
          <button type="button" className="btn btn-icon btn-ghost" onClick={onClose}><IconX size={16} /></button>
        </div>
        <fetcher.Form method="post" className="modal-body">
          <input type="hidden" name="intent" value="create_subfolder" />
          <div className="field">
            <label className="label" htmlFor="sf-name">Folder name</label>
            <input ref={inputRef} id="sf-name" name="name" className="input" placeholder="e.g. Chapter 4 PYQs" autoComplete="off" />
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary btn-sm" disabled={fetcher.state !== "idle"}>{fetcher.state !== "idle" ? "Creating…" : "Create"}</button>
          </div>
        </fetcher.Form>
      </div>
    </div>
  );
}

// ── Page ────────────────────────────────────────────────────────
export default function FolderView({ loaderData }: Route.ComponentProps) {
  const { user, folder, breadcrumb, subFolders, questions, totalInFolder, filter, allFolders } = loaderData;
  const [searchParams, setSearchParams] = useSearchParams();
  const [showNewSub, setShowNewSub] = useState(false);
  const [renamingFolder, setRenamingFolder] = useState(false);
  const deleteFetcher = useFetcher();

  function setFilter(key: string, value: string | null) {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value); else next.delete(key);
    setSearchParams(next, { preventScrollReset: true });
  }
  function handleDeleteSubFolder(id: string) {
    if (!confirm("Delete this folder and all its questions?")) return;
    const fd = new FormData(); fd.set("intent", "delete_folder"); fd.set("id", id);
    deleteFetcher.submit(fd, { method: "post" });
  }

  const folderMenuItems = [
    { type: "action" as const, label: "Rename folder", icon: <IconEdit size={14} />, onClick: () => setRenamingFolder(true) },
    { type: "link" as const, label: "Add question here", icon: <IconPlus size={14} />, to: `/questions/new?folder_id=${folder.id}` },
    { type: "sep" as const },
    { type: "action" as const, label: "Delete this folder", icon: <IconTrash size={14} />, danger: true,
      onClick: () => {
        if (!confirm(`Delete "${folder.name}" and all its questions? This cannot be undone.`)) return;
        const fd = new FormData(); fd.set("intent", "delete_this_folder");
        deleteFetcher.submit(fd, { method: "post" });
      }
    },
  ];

  return (
    <div className="app-layout">
      <Sidebar displayName={user.display_name} />
      <main className="app-main">
        <div className="pg-head">
          <div>
            <nav className="result-breadcrumb" style={{ marginBottom: 6 }}>
              {breadcrumb.map((crumb, i) => (
                <span key={crumb.id ?? "root"} style={{ display: "contents" }}>
                  {i > 0 && <IconChevronRight size={13} />}
                  {i < breadcrumb.length - 1
                    ? <Link to={crumb.id ? `/library/folders/${crumb.id}` : "/library"} className="result-breadcrumb-link">{crumb.name}</Link>
                    : <span>{crumb.name}</span>}
                </span>
              ))}
            </nav>
            <h1 className="pg-title">{folder.name}</h1>
            <p className="pg-subtitle">
              {totalInFolder} question{totalInFolder !== 1 ? "s" : ""}
              {subFolders.length > 0 ? ` · ${subFolders.length} sub-folder${subFolders.length !== 1 ? "s" : ""}` : ""}
            </p>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn btn-ghost btn-sm" onClick={() => setShowNewSub(true)}><IconPlus size={14} /> Sub-folder</button>
            <Link to={`/questions/new?folder_id=${folder.id}`} className="btn btn-primary btn-sm"><IconPlus size={14} /> Add question</Link>
            <DotMenu items={folderMenuItems} align="right" />
          </div>
        </div>

        <div className="pg-body">
          {subFolders.length > 0 && (
            <section style={{ marginBottom: 32 }}>
              <p className="pg-section-label">Sub-folders</p>
              <div className="list-view">
                {subFolders.map((sf) => <SubFolderCard key={sf.id} folder={sf} onDelete={handleDeleteSubFolder} />)}
              </div>
            </section>
          )}

          <section>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
              <p className="pg-section-label" style={{ margin: 0 }}>Questions {questions.length > 0 && <span style={{ fontWeight: 400, color: "var(--c-text-3)", textTransform: "none" }}>({questions.length})</span>}</p>
              <div style={{ display: "flex", gap: 5, flexWrap: "wrap", alignItems: "center" }}>
                {SUBJECTS.map((s) => <FilterChip key={s.value ?? "all-s"} label={s.label} active={filter.subject === s.value} color={s.color} onClick={() => setFilter("subject", s.value)} />)}
                <div style={{ width: 1, height: 16, background: "var(--c-border)", margin: "0 3px" }} />
                {TYPES.map((t) => <FilterChip key={t.value ?? "all-t"} label={t.label} active={filter.type === t.value} onClick={() => setFilter("type", t.value)} />)}
              </div>
            </div>
            {questions.length === 0 ? (
              <div className="lib-empty" style={{ padding: "40px 24px" }}>
                <img src="/jeelo-reading.png" alt="" className="lib-empty-mascot" draggable={false} />
                <p className="lib-empty-title">{filter.subject || filter.type ? "No questions match this filter" : "This folder is empty"}</p>
                <p className="lib-empty-body">{filter.subject || filter.type ? "Try clearing the filters." : "Add questions to this folder to get started."}</p>
                {!filter.subject && !filter.type && <Link to={`/questions/new?folder_id=${folder.id}`} className="btn btn-primary"><IconPlus size={14} /> Add question</Link>}
              </div>
            ) : (
              <div className="q-grid">
                {questions.map((q) => (
                  <QuestionCard key={q.id} question={q} allFolders={allFolders} currentFolderId={folder.id} />
                ))}
              </div>
            )}
          </section>
        </div>
      </main>
      {showNewSub && <NewSubfolderModal onClose={() => setShowNewSub(false)} />}
      {renamingFolder && (
        <div className="modal-backdrop" onClick={() => setRenamingFolder(false)}>
          <div className="modal-box" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true">
            <div className="modal-header">
              <span className="modal-title">Rename folder</span>
              <button type="button" className="btn btn-icon btn-ghost" onClick={() => setRenamingFolder(false)}><IconX size={16} /></button>
            </div>
            <Form method="post" className="modal-body" onSubmit={() => setRenamingFolder(false)}>
              <input type="hidden" name="intent" value="rename_this_folder" />
              <div className="field">
                <label className="label">New name</label>
                <input name="name" className="input" defaultValue={folder.name} autoFocus autoComplete="off" />
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRenamingFolder(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary btn-sm">Rename</button>
              </div>
            </Form>
          </div>
        </div>
      )}
    </div>
  );
}

const SUBJECT_META: Record<string, { short: string; bg: string; text: string }> = { physics: { short: "PHY", bg: "rgba(29,78,216,0.1)", text: "#1d4ed8" }, chemistry: { short: "CHE", bg: "rgba(21,128,61,0.1)", text: "#15803d" }, mathematics: { short: "MTH", bg: "rgba(126,34,206,0.1)", text: "#7e22ce" } };
const TYPE_META: Record<string, { label: string; bg: string; text: string }> = { scq: { label: "SCQ", bg: "rgba(180,140,30,0.1)", text: "#92400e" }, mcq: { label: "MCQ", bg: "rgba(55,48,163,0.1)", text: "#3730a3" }, integer: { label: "Integer", bg: "rgba(6,95,70,0.1)", text: "#065f46" }, numerical: { label: "Num", bg: "rgba(14,116,144,0.1)", text: "#0e7490" }, paragraph: { label: "Para", bg: "rgba(154,52,18,0.1)", text: "#9a3412" } };
const SUBJECTS: Array<{ label: string; value: Subject | null; color?: string }> = [{ label: "All", value: null }, { label: "Physics", value: "physics", color: "#1d4ed8" }, { label: "Chemistry", value: "chemistry", color: "#15803d" }, { label: "Maths", value: "mathematics", color: "#7e22ce" }];
const TYPES: Array<{ label: string; value: QuestionType | null }> = [{ label: "All", value: null }, { label: "SCQ", value: "scq" }, { label: "MCQ", value: "mcq" }, { label: "Integer", value: "integer" }, { label: "Num", value: "numerical" }, { label: "Para", value: "paragraph" }];
