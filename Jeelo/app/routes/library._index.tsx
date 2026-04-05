import { data, Link, Form, useSearchParams } from "react-router";
import { useState, useRef } from "react";
import type { Route } from "./+types/library._index";
import { requireUser } from "~/lib/auth.server";
import { createServerClient } from "~/lib/supabase.server";
import { deleteImage } from "~/lib/storage.server";
import type { Subject, QuestionType } from "~/lib/database.types";
import { AppNav } from "~/components/app-nav";

// ── Types ──────────────────────────────────────────────────────

type FolderRow = {
  id: string;
  name: string;
  created_at: string;
  question_count: number;
};

type QuestionRow = {
  id: string;
  image_url: string;
  type: QuestionType;
  subject: Subject;
  chapter: string;
  is_shared: boolean;
  created_at: string;
};

// ── Loader ─────────────────────────────────────────────────────

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const user = await requireUser(request, env);
  const supabase = createServerClient(env);
  const url = new URL(request.url);
  const subject = (url.searchParams.get("subject") || null) as Subject | null;
  const qtype  = (url.searchParams.get("type")    || null) as QuestionType | null;

  // Root-level folders for this user
  const { data: rawFolders } = await supabase
    .from("folders")
    .select("id, name, created_at")
    .eq("owner_id", user.id)
    .is("parent_id", null)
    .order("name", { ascending: true });

  // Count questions per folder in one query
  const folderIds = (rawFolders ?? []).map((f) => f.id);
  let folderCounts: Record<string, number> = {};
  if (folderIds.length > 0) {
    const { data: countRows } = await supabase
      .from("questions")
      .select("folder_id")
      .in("folder_id", folderIds)
      .eq("owner_id", user.id);
    for (const row of countRows ?? []) {
      if (row.folder_id)
        folderCounts[row.folder_id] = (folderCounts[row.folder_id] ?? 0) + 1;
    }
  }

  const folders: FolderRow[] = (rawFolders ?? []).map((f) => ({
    ...f,
    question_count: folderCounts[f.id] ?? 0,
  }));

  // Root-level questions (no folder)
  let qQuery = supabase
    .from("questions")
    .select("id, image_url, type, subject, chapter, is_shared, created_at")
    .eq("owner_id", user.id)
    .is("folder_id", null)
    .order("created_at", { ascending: false });

  if (subject) qQuery = qQuery.eq("subject", subject);
  if (qtype)   qQuery = qQuery.eq("type", qtype);

  const { data: questions } = await qQuery;

  // All root-question counts (unfiltered, for pill display)
  const { count: totalRootQuestions } = await supabase
    .from("questions")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", user.id)
    .is("folder_id", null);

  return {
    user,
    folders,
    questions: (questions ?? []) as QuestionRow[],
    totalRootQuestions: totalRootQuestions ?? 0,
    filter: { subject, type: qtype },
  };
}

// ── Action ─────────────────────────────────────────────────────

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

  if (intent === "delete_folder") {
    const id = String(formData.get("id") ?? "");

    // Recursively collect all question image URLs under this folder tree
    // We do a breadth-first walk of sub-folders before the cascade delete
    const folderQueue = [id];
    const allImageUrls: string[] = [];

    while (folderQueue.length > 0) {
      const currentId = folderQueue.shift()!;

      // Collect question images at this level
      const { data: qs } = await supabase
        .from("questions")
        .select("image_url")
        .eq("folder_id", currentId)
        .eq("owner_id", user.id);
      for (const q of qs ?? []) {
        if (q.image_url) allImageUrls.push(q.image_url);
      }

      // Queue sub-folders
      const { data: subs } = await supabase
        .from("folders")
        .select("id")
        .eq("parent_id", currentId)
        .eq("owner_id", user.id);
      for (const sub of subs ?? []) folderQueue.push(sub.id);
    }

    // DB cascade will handle rows; we handle Storage cleanup
    await supabase.from("folders").delete().eq("id", id).eq("owner_id", user.id);
    await Promise.all(allImageUrls.map((url) => deleteImage(url, env)));
    return null;
  }

  if (intent === "delete_question") {
    const id = String(formData.get("id") ?? "");
    const { data: q } = await supabase
      .from("questions")
      .select("image_url")
      .eq("id", id)
      .eq("owner_id", user.id)
      .single();
    await supabase.from("questions").delete().eq("id", id).eq("owner_id", user.id);
    if (q?.image_url) await deleteImage(q.image_url, env);
    return null;
  }

  if (intent === "toggle_share") {
    const id = String(formData.get("id") ?? "");
    const current = formData.get("is_shared") === "true";
    await supabase
      .from("questions")
      .update({ is_shared: !current })
      .eq("id", id)
      .eq("owner_id", user.id);
    return null;
  }

  return null;
}

// ── Component ──────────────────────────────────────────────────

export default function LibraryIndex({ loaderData }: Route.ComponentProps) {
  const { user, folders, questions, totalRootQuestions, filter } = loaderData;
  const [searchParams, setSearchParams] = useSearchParams();
  const [showNewFolder, setShowNewFolder] = useState(false);
  const folderInputRef = useRef<HTMLInputElement>(null);

  function setFilter(key: string, value: string | null) {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    setSearchParams(next, { preventScrollReset: true });
  }

  return (
    <div style={{ minHeight: "100vh", background: BG, fontFamily: FONT }}>
      <AppNav displayName={user.display_name} />

      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "32px 28px" }}>
        {/* ── Page header ── */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 28,
          }}
        >
          <div>
            <h1
              style={{
                fontSize: 22,
                fontWeight: 700,
                color: "#111827",
                margin: 0,
                letterSpacing: "-0.02em",
              }}
            >
              My Library
            </h1>
            <p style={{ margin: "3px 0 0", fontSize: 13, color: "#9ca3af" }}>
              {totalRootQuestions} question{totalRootQuestions !== 1 ? "s" : ""} at root
              {folders.length > 0 ? ` · ${folders.length} folder${folders.length !== 1 ? "s" : ""}` : ""}
            </p>
          </div>

          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={() => {
                setShowNewFolder((v) => !v);
                setTimeout(() => folderInputRef.current?.focus(), 50);
              }}
              style={btnSecondary}
            >
              <FolderPlusIcon />
              New Folder
            </button>
            <Link to="/questions/new" style={{ textDecoration: "none" }}>
              <span style={btnPrimary}>
                <UploadIcon />
                Upload Questions
              </span>
            </Link>
          </div>
        </div>

        {/* ── New folder inline form ── */}
        {showNewFolder && (
          <Form
            method="post"
            onSubmit={() => setShowNewFolder(false)}
            style={{
              background: "#fff",
              border: "1px solid #e5e7eb",
              borderRadius: 10,
              padding: "14px 16px",
              marginBottom: 24,
              display: "flex",
              alignItems: "center",
              gap: 10,
              boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
            }}
          >
            <input type="hidden" name="intent" value="create_folder" />
            <span style={{ fontSize: 22 }}>📁</span>
            <input
              ref={folderInputRef}
              name="name"
              required
              placeholder="Folder name (e.g. Thermodynamics)"
              autoFocus
              style={{
                flex: 1,
                border: "none",
                outline: "none",
                fontSize: 14,
                color: "#111827",
                background: "transparent",
              }}
            />
            <button type="submit" style={btnPrimary}>
              Create
            </button>
            <button
              type="button"
              onClick={() => setShowNewFolder(false)}
              style={{ ...btnSecondary, color: "#9ca3af" }}
            >
              Cancel
            </button>
          </Form>
        )}

        {/* ── Folders grid ── */}
        {folders.length > 0 && (
          <section style={{ marginBottom: 32 }}>
            <p style={sectionLabel}>Folders</p>
            <div style={folderGrid}>
              {folders.map((folder) => (
                <FolderCard key={folder.id} folder={folder} />
              ))}
            </div>
          </section>
        )}

        {/* ── Questions section ── */}
        <section>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 12,
              flexWrap: "wrap",
              gap: 8,
            }}
          >
            <p style={{ ...sectionLabel, margin: 0 }}>
              Questions
              {questions.length > 0 && (
                <span
                  style={{
                    marginLeft: 8,
                    fontSize: 12,
                    fontWeight: 500,
                    color: "#9ca3af",
                  }}
                >
                  {questions.length}
                </span>
              )}
            </p>

            {/* Filters */}
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {SUBJECTS.map((s) => (
                <FilterChip
                  key={s.value ?? "all-s"}
                  label={s.label}
                  active={filter.subject === s.value}
                  color={s.color}
                  onClick={() => setFilter("subject", s.value)}
                />
              ))}
              <div style={{ width: 1, background: "#e5e7eb", margin: "0 2px" }} />
              {TYPES.map((t) => (
                <FilterChip
                  key={t.value ?? "all-t"}
                  label={t.label}
                  active={filter.type === t.value}
                  onClick={() => setFilter("type", t.value)}
                />
              ))}
            </div>
          </div>

          {questions.length === 0 ? (
            <EmptyQuestions hasFilter={!!(filter.subject || filter.type)} />
          ) : (
            <div style={questionGrid}>
              {questions.map((q) => (
                <QuestionCard key={q.id} question={q} />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────

function FolderCard({ folder }: { folder: FolderRow }) {
  return (
    <Link
      to={`/library/folders/${folder.id}`}
      style={{ textDecoration: "none" }}
    >
      <div style={folderCardStyle}>
        <span style={{ fontSize: 28, lineHeight: 1, flexShrink: 0 }}>📁</span>
        <div style={{ flex: 1, overflow: "hidden" }}>
          <p
            style={{
              margin: 0,
              fontSize: 13,
              fontWeight: 500,
              color: "#111827",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {folder.name}
          </p>
          <p
            style={{
              margin: "2px 0 0",
              fontSize: 11,
              color: "#9ca3af",
            }}
          >
            {folder.question_count} question
            {folder.question_count !== 1 ? "s" : ""}
          </p>
        </div>
      </div>
    </Link>
  );
}

function QuestionCard({ question: q }: { question: QuestionRow }) {
  const subj = SUBJECT_META[q.subject];
  const type = TYPE_META[q.type];

  return (
    <div style={questionCardStyle}>
      {/* Thumbnail */}
      <div
        style={{
          background: "#f8f9fa",
          borderBottom: "1px solid #f0f0f0",
          height: 148,
          overflow: "hidden",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <img
          src={q.image_url}
          alt="Question"
          style={{
            maxWidth: "100%",
            maxHeight: "100%",
            objectFit: "contain",
            display: "block",
          }}
        />
      </div>

      {/* Info */}
      <div style={{ padding: "10px 12px 12px" }}>
        <div style={{ display: "flex", gap: 5, marginBottom: 6 }}>
          <span style={{ ...badge, background: subj.bg, color: subj.text }}>
            {subj.short}
          </span>
          <span style={{ ...badge, background: type.bg, color: type.text }}>
            {type.label}
          </span>
        </div>

        <p
          style={{
            margin: "0 0 8px",
            fontSize: 12,
            color: "#374151",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {q.chapter || <span style={{ color: "#d1d5db" }}>No chapter</span>}
        </p>

        {/* Actions */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            borderTop: "1px solid #f3f4f6",
            paddingTop: 8,
          }}
        >
          {/* Share toggle */}
          <Form method="post" style={{ display: "inline" }}>
            <input type="hidden" name="intent"    value="toggle_share" />
            <input type="hidden" name="id"        value={q.id} />
            <input type="hidden" name="is_shared" value={String(q.is_shared)} />
            <button
              type="submit"
              title={q.is_shared ? "Shared — click to make private" : "Private — click to share"}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                padding: "2px 4px",
                borderRadius: 4,
                fontSize: 14,
                opacity: q.is_shared ? 1 : 0.35,
              }}
            >
              {q.is_shared ? "🌐" : "🔒"}
            </button>
          </Form>

          {/* Delete */}
          <Form
            method="post"
            onSubmit={(e) => {
              if (!confirm("Delete this question? This cannot be undone."))
                e.preventDefault();
            }}
          >
            <input type="hidden" name="intent" value="delete_question" />
            <input type="hidden" name="id"     value={q.id} />
            <button
              type="submit"
              title="Delete question"
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                padding: "2px 4px",
                borderRadius: 4,
                fontSize: 14,
                color: "#9ca3af",
              }}
            >
              🗑
            </button>
          </Form>
        </div>
      </div>
    </div>
  );
}

function FilterChip({
  label,
  active,
  color,
  onClick,
}: {
  label: string;
  active: boolean;
  color?: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        border: active ? `1.5px solid ${color ?? "#1a3a6b"}` : "1.5px solid #e5e7eb",
        background: active ? (color ? color + "18" : "#eef2ff") : "#fff",
        color: active ? (color ?? "#1a3a6b") : "#6b7280",
        borderRadius: 20,
        padding: "3px 10px",
        fontSize: 12,
        fontWeight: active ? 600 : 400,
        cursor: "pointer",
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </button>
  );
}

function EmptyQuestions({ hasFilter }: { hasFilter: boolean }) {
  return (
    <div
      style={{
        background: "#fff",
        border: "1.5px dashed #e5e7eb",
        borderRadius: 12,
        padding: "48px 24px",
        textAlign: "center",
      }}
    >
      <p style={{ fontSize: 32, margin: "0 0 12px" }}>📷</p>
      <p
        style={{
          fontSize: 15,
          fontWeight: 600,
          color: "#374151",
          margin: "0 0 6px",
        }}
      >
        {hasFilter ? "No questions match this filter" : "No questions here yet"}
      </p>
      <p style={{ fontSize: 13, color: "#9ca3af", margin: "0 0 20px" }}>
        {hasFilter
          ? "Try clearing the filters above."
          : "Upload question images and set the answer key to get started."}
      </p>
      {!hasFilter && (
        <Link
          to="/questions/new"
          style={{ ...btnPrimary, textDecoration: "none", display: "inline-flex" }}
        >
          <UploadIcon /> Upload Questions
        </Link>
      )}
    </div>
  );
}

// ── Icons (inline SVG) ─────────────────────────────────────────

function FolderPlusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0 }}>
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
      <line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/>
    </svg>
  );
}

function UploadIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0 }}>
      <polyline points="16 16 12 12 8 16"/><line x1="12" y1="12" x2="12" y2="21"/>
      <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/>
    </svg>
  );
}

// ── Design tokens ──────────────────────────────────────────────

const BG   = "#f0f2f5";
const FONT = "system-ui, -apple-system, 'Segoe UI', Arial, sans-serif";

const btnPrimary: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  background: "#1a3a6b",
  color: "#fff",
  border: "none",
  borderRadius: 7,
  padding: "8px 14px",
  fontSize: 13,
  fontWeight: 500,
  cursor: "pointer",
  whiteSpace: "nowrap",
};

const btnSecondary: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  background: "#fff",
  color: "#374151",
  border: "1px solid #e5e7eb",
  borderRadius: 7,
  padding: "7px 13px",
  fontSize: 13,
  fontWeight: 400,
  cursor: "pointer",
  whiteSpace: "nowrap",
};

const sectionLabel: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  color: "#9ca3af",
  margin: "0 0 10px",
};

const folderGrid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
  gap: 8,
};

const folderCardStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  background: "#fff",
  border: "1px solid #e5e7eb",
  borderRadius: 8,
  padding: "10px 14px",
  cursor: "pointer",
  transition: "box-shadow 0.1s",
};

const questionGrid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(196px, 1fr))",
  gap: 12,
};

const questionCardStyle: React.CSSProperties = {
  background: "#fff",
  border: "1px solid #e5e7eb",
  borderRadius: 10,
  overflow: "hidden",
  boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
};

const badge: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: "0.04em",
  padding: "2px 7px",
  borderRadius: 4,
};

// ── Data maps ──────────────────────────────────────────────────

const SUBJECT_META: Record<string, { short: string; bg: string; text: string }> = {
  physics:     { short: "PHY", bg: "#dbeafe", text: "#1d4ed8" },
  chemistry:   { short: "CHE", bg: "#dcfce7", text: "#15803d" },
  mathematics: { short: "MTH", bg: "#f3e8ff", text: "#7e22ce" },
};

const TYPE_META: Record<string, { label: string; bg: string; text: string }> = {
  scq:       { label: "SCQ",     bg: "#fef3c7", text: "#92400e" },
  mcq:       { label: "MCQ",     bg: "#e0e7ff", text: "#3730a3" },
  integer:   { label: "Integer", bg: "#d1fae5", text: "#065f46" },
  numerical: { label: "Num",     bg: "#cffafe", text: "#0e7490" },
  paragraph: { label: "Para",    bg: "#fed7aa", text: "#9a3412" },
};

const SUBJECTS: Array<{ label: string; value: Subject | null; color?: string }> = [
  { label: "All",         value: null },
  { label: "Physics",     value: "physics",     color: "#1d4ed8" },
  { label: "Chemistry",   value: "chemistry",   color: "#15803d" },
  { label: "Maths",       value: "mathematics", color: "#7e22ce" },
];

const TYPES: Array<{ label: string; value: QuestionType | null }> = [
  { label: "All",     value: null },
  { label: "SCQ",     value: "scq" },
  { label: "MCQ",     value: "mcq" },
  { label: "Integer", value: "integer" },
  { label: "Num",     value: "numerical" },
  { label: "Para",    value: "paragraph" },
];
