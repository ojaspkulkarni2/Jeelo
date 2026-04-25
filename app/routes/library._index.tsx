import { data, Link, Form, useFetcher } from "react-router";
import { useState, useRef, useEffect } from "react";
import type { Route } from "./+types/library._index";
import { requireUser } from "~/lib/auth.server";
import { createServerClient } from "~/lib/supabase.server";
import { deleteImage } from "~/lib/storage.server";
import { Sidebar } from "~/components/sidebar";
import { DotMenu } from "~/components/three-dot-menu";
import { IconFolder, IconPlus, IconTrash, IconX, IconEdit } from "~/components/icons";

type FolderRow = { id: string; name: string; created_at: string; question_count: number };

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const user = await requireUser(request, env);
  const supabase = createServerClient(env);

  const { data: rawFolders } = await supabase
    .from("folders").select("id, name, created_at")
    .eq("owner_id", user.id).is("parent_id", null).order("name", { ascending: true });

  const folderIds = (rawFolders ?? []).map((f) => f.id);
  let folderCounts: Record<string, number> = {};
  if (folderIds.length > 0) {
    const { data: countRows } = await supabase.from("questions").select("folder_id").in("folder_id", folderIds).eq("owner_id", user.id);
    for (const row of countRows ?? []) { if (row.folder_id) folderCounts[row.folder_id] = (folderCounts[row.folder_id] ?? 0) + 1; }
  }

  const folders: FolderRow[] = (rawFolders ?? []).map((f) => ({ ...f, question_count: folderCounts[f.id] ?? 0 }));
  return { user, folders };
}

export async function action({ request, context }: Route.ActionArgs) {
  const env = context.cloudflare.env;
  const user = await requireUser(request, env);
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");
  const supabase = createServerClient(env);

  if (intent === "create_folder") {
    const name = String(formData.get("name") ?? "").trim();
    if (!name) return data({ error: "Folder name is required" }, { status: 400 });
    await supabase.from("folders").insert({ owner_id: user.id, name, parent_id: null });
    return null;
  }

  if (intent === "rename_folder") {
    const id   = String(formData.get("id")   ?? "");
    const name = String(formData.get("name") ?? "").trim();
    if (name) await supabase.from("folders").update({ name }).eq("id", id).eq("owner_id", user.id);
    return null;
  }

  // Move a root folder inside another root folder (making it a subfolder)
  if (intent === "move_folder") {
    const id       = String(formData.get("id")        ?? "");
    const targetId = String(formData.get("target_id") ?? "");
    if (id === targetId) return null;
    // Guard against circular nesting: target must not be a descendant of id
    const queue = [id];
    const descendants = new Set<string>([id]);
    while (queue.length) {
      const cur = queue.shift()!;
      const { data: subs } = await supabase.from("folders").select("id").eq("parent_id", cur).eq("owner_id", user.id);
      for (const s of subs ?? []) { descendants.add(s.id); queue.push(s.id); }
    }
    if (descendants.has(targetId)) return data({ error: "Cannot move a folder into its own subfolder" }, { status: 400 });
    await supabase.from("folders").update({ parent_id: targetId }).eq("id", id).eq("owner_id", user.id);
    return null;
  }

  if (intent === "delete_folder") {
    const id = String(formData.get("id") ?? "");
    const folderQueue = [id];
    const allImageUrls: string[] = [];
    const allQuestionIds: string[] = [];

    while (folderQueue.length > 0) {
      const currentId = folderQueue.shift()!;
      const { data: qs } = await supabase
        .from("questions")
        .select("id, image_url")
        .eq("folder_id", currentId)
        .eq("owner_id", user.id);
      for (const q of qs ?? []) {
        allQuestionIds.push(q.id);
        if (q.image_url) allImageUrls.push(q.image_url);
      }
      const { data: subs } = await supabase.from("folders").select("id").eq("parent_id", currentId).eq("owner_id", user.id);
      for (const sub of subs ?? []) folderQueue.push(sub.id);
    }

    // Delete question rows first (while folder_id is still set), then the folder
    if (allQuestionIds.length > 0) {
      await supabase.from("questions").delete().in("id", allQuestionIds).eq("owner_id", user.id);
    }
    await supabase.from("folders").delete().eq("id", id).eq("owner_id", user.id);
    await Promise.all(allImageUrls.map((url) => deleteImage(url, env)));
    return null;
  }

  return null;
}

// ── Rename modal ───────────────────────────────────────────────
function RenameModal({ folder, onClose }: { folder: FolderRow; onClose: () => void }) {
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
          <input type="hidden" name="intent" value="rename_folder" />
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

// ── Move modal ─────────────────────────────────────────────────
function MoveModal({ folder, allFolders, onClose }: { folder: FolderRow; allFolders: FolderRow[]; onClose: () => void }) {
  const fetcher = useFetcher();
  useEffect(() => { if (fetcher.state === "idle" && fetcher.data !== undefined) onClose(); }, [fetcher.state, fetcher.data]);
  const candidates = allFolders.filter(f => f.id !== folder.id);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-box" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="modal-header">
          <span className="modal-title">Move "{folder.name}" into…</span>
          <button type="button" className="btn btn-icon btn-ghost" onClick={onClose}><IconX size={16} /></button>
        </div>
        <div className="modal-body" style={{ gap: 8 }}>
          {candidates.length === 0 ? (
            <p style={{ fontSize: 13, color: "var(--c-text-3)", margin: 0 }}>No other folders to move into. Create another folder first.</p>
          ) : (
            candidates.map(target => (
              <fetcher.Form key={target.id} method="post" style={{ display: "contents" }}>
                <input type="hidden" name="intent" value="move_folder" />
                <input type="hidden" name="id" value={folder.id} />
                <input type="hidden" name="target_id" value={target.id} />
                <button type="submit" style={{
                  display: "flex", alignItems: "center", gap: 10,
                  padding: "10px 14px", borderRadius: 8,
                  border: "1px solid var(--c-border)", background: "var(--c-surface)",
                  cursor: "pointer", width: "100%", textAlign: "left" as const,
                  color: "var(--c-text-1)", fontSize: 14,
                }}>
                  <IconFolder size={15} />
                  {target.name}
                  <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--c-text-3)" }}>
                    {target.question_count}Q
                  </span>
                </button>
              </fetcher.Form>
            ))
          )}
        </div>
        <div className="modal-footer" style={{ borderTop: "1px solid var(--c-border-subtle)", paddingTop: 12 }}>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ── New Folder Modal ───────────────────────────────────────────
function NewFolderModal({ onClose }: { onClose: () => void }) {
  const fetcher = useFetcher();
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => { if (fetcher.state === "idle" && fetcher.data !== undefined) onClose(); }, [fetcher.state, fetcher.data]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-box" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="modal-header">
          <span className="modal-title">New folder</span>
          <button type="button" className="btn btn-icon btn-ghost" onClick={onClose}><IconX size={16} /></button>
        </div>
        <fetcher.Form method="post" className="modal-body">
          <input type="hidden" name="intent" value="create_folder" />
          <div className="field">
            <label className="label" htmlFor="folder-name">Folder name</label>
            <input ref={inputRef} id="folder-name" name="name" className="input" placeholder="e.g. Electrostatics PYQs" autoComplete="off" />
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary btn-sm" disabled={fetcher.state !== "idle"}>
              {fetcher.state !== "idle" ? "Creating…" : "Create folder"}
            </button>
          </div>
        </fetcher.Form>
      </div>
    </div>
  );
}

// ── Folder Card ────────────────────────────────────────────────
function FolderCard({
  folder, allFolders, onDelete,
}: {
  folder: FolderRow; allFolders: FolderRow[]; onDelete: (id: string) => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [moving,   setMoving]   = useState(false);

  const menuItems = [
    { type: "action" as const, label: "Rename", icon: <IconEdit size={14} />, onClick: () => setRenaming(true) },
    { type: "action" as const, label: "Move into folder…", icon: <IconFolder size={14} />, onClick: () => setMoving(true) },
    { type: "sep" as const },
    { type: "action" as const, label: "Delete folder", icon: <IconTrash size={14} />, danger: true, onClick: () => onDelete(folder.id) },
  ];

  return (
    <>
      <div className="list-row">
        <Link to={`/library/folders/${folder.id}`} className="list-row-left" style={{ textDecoration: "none", flex: 1, minWidth: 0 }}>
          <div className="list-row-icon"><IconFolder size={15} /></div>
          <div className="list-row-text">
            <span className="list-row-title">{folder.name}</span>
            <span className="list-row-meta">
              {folder.question_count === 0 ? "Empty" : `${folder.question_count} question${folder.question_count === 1 ? "" : "s"}`}
            </span>
          </div>
        </Link>
        <div className="list-row-right">
          <DotMenu items={menuItems} />
        </div>
      </div>
      {renaming && <RenameModal folder={folder} onClose={() => setRenaming(false)} />}
      {moving   && <MoveModal   folder={folder} allFolders={allFolders} onClose={() => setMoving(false)} />}
    </>
  );
}

// ── Page ────────────────────────────────────────────────────────
export default function LibraryIndex({ loaderData }: Route.ComponentProps) {
  const { user, folders } = loaderData;
  const [showNew, setShowNew] = useState(false);
  const deleteFetcher = useFetcher();

  function handleDeleteFolder(id: string) {
    if (!confirm("Delete this folder and all its questions? This cannot be undone.")) return;
    const fd = new FormData();
    fd.set("intent", "delete_folder"); fd.set("id", id);
    deleteFetcher.submit(fd, { method: "post" });
  }

  return (
    <div className="app-layout">
      <Sidebar displayName={(user as any).display_name ?? ""} />
      <main className="app-main">
        <div className="pg-head">
          <div>
            <h1 className="pg-title">Library</h1>
            <p className="pg-subtitle">
              {folders.length > 0 ? `${folders.length} folder${folders.length === 1 ? "" : "s"}` : "Your question bank, organised by folder"}
            </p>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn btn-ghost btn-sm" onClick={() => setShowNew(true)}>
              <IconPlus size={14} /> New folder
            </button>
            <Link to="/questions/new" className="btn btn-primary btn-sm">
              <IconPlus size={14} /> Add question
            </Link>
          </div>
        </div>

        <div className="pg-body">
          {folders.length === 0 ? (
            <div className="lib-empty">
              <img src="/jeelo-reading.png" alt="" className="lib-empty-mascot" draggable={false} />
              <p className="lib-empty-title">Your library is empty</p>
              <p className="lib-empty-body">Create a folder to start organising your questions.</p>
              <div style={{ display: "flex", gap: 10 }}>
                <button className="btn btn-ghost" onClick={() => setShowNew(true)}><IconPlus size={14} /> New folder</button>
                <Link to="/questions/new" className="btn btn-primary"><IconPlus size={14} /> Add question</Link>
              </div>
            </div>
          ) : (
            <div className="list-view">
              {folders.map((f) => (
                <FolderCard key={f.id} folder={f} allFolders={folders} onDelete={handleDeleteFolder} />
              ))}
            </div>
          )}
        </div>
      </main>
      {showNew && <NewFolderModal onClose={() => setShowNew(false)} />}
    </div>
  );
}
