import { redirect, Link, Form, useSearchParams, useFetcher } from "react-router";
import { useState } from "react";
import type { Route } from "./+types/tests.$id";
import { requireUser } from "~/lib/auth.server";
import { createServerClient } from "~/lib/supabase.server";
import { Sidebar } from "~/components/sidebar";
import { IconChevronRight } from "~/components/icons";
import { DotMenu } from "~/components/three-dot-menu";
import type { QuestionType, Subject } from "~/lib/database.types";

// ── Types ──────────────────────────────────────────────────────

type QuestionRow = {
  id: string;
  image_url: string;
  type: QuestionType;
  subject: Subject;
  chapter: string;
};

type SectionQuestion = QuestionRow & { display_order: number };

type Section = {
  id: string;
  name: string;
  question_type: QuestionType;
  subject: Subject;
  marks_correct: number;
  marks_wrong: number;
  marks_partial: number | null;
  display_order: number;
  questions: SectionQuestion[];
};

type Test = {
  id: string;
  title: string;
  description: string | null;
  duration_mins: number;
  is_published: boolean;
};

// ── Loader ─────────────────────────────────────────────────────

export async function loader({ params, request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const user = await requireUser(request, env);
  const supabase = createServerClient(env);
  const testId = params.id!;

  // Verify ownership and get test
  const { data: test, error: testError } = await supabase
    .from("tests")
    .select("id, title, description, duration_mins, is_published")
    .eq("id", testId)
    .eq("owner_id", user.id)
    .single();

  if (testError || !test) throw redirect("/tests");

  // Sections with their questions (3-level join)
  const { data: rawSections } = await supabase
    .from("test_sections")
    .select(`
      id, name, question_type, subject,
      marks_correct, marks_wrong, marks_partial, display_order,
      test_questions(
        display_order,
        questions(id, image_url, type, subject, chapter)
      )
    `)
    .eq("test_id", testId)
    .order("display_order", { ascending: true });

  const sections: Section[] = (rawSections ?? []).map((s: any) => ({
    id: s.id,
    name: s.name,
    question_type: s.question_type as QuestionType,
    subject: s.subject as Subject,
    marks_correct: s.marks_correct,
    marks_wrong: s.marks_wrong,
    marks_partial: s.marks_partial,
    display_order: s.display_order,
    questions: ((s.test_questions ?? []) as any[])
      .sort((a: any, b: any) => a.display_order - b.display_order)
      .map((tq: any) => ({ display_order: tq.display_order, ...(tq.questions as QuestionRow) })),
  }));

  // Question picker — only loaded when ?picking=<sectionId>
  const url = new URL(request.url);
  const pickingSectionId = url.searchParams.get("picking") ?? null;
  let pickerQuestions: QuestionRow[] = [];
  let pickerFolders: { id: string; name: string; displayName: string; count: number }[] = [];

  if (pickingSectionId) {
    const section = sections.find((s) => s.id === pickingSectionId);
    if (section) {
      const addedIds = section.questions.map((q) => q.id);
      let query = supabase
        .from("questions")
        .select("id, image_url, type, subject, chapter, folder_id, folders(id, name, parent_id, parent:parent_id(id, name))")
        .eq("owner_id", user.id)
        .eq("type", section.question_type)
        .eq("subject", section.subject)
        .order("created_at", { ascending: false });

      if (addedIds.length > 0) {
        query = query.not("id", "in", `(${addedIds.join(",")})`);
      }

      const { data: qs } = await query;
      const allQs = (qs ?? []) as any[];

      pickerQuestions = allQs.map(({ folders: _f, ...rest }: any) => rest) as QuestionRow[];

      // Build folder list with parent info for disambiguation
      const folderMap = new Map<string, { id: string; name: string; parentName: string | null; count: number }>();
      for (const q of allQs) {
        if (!q.folder_id || !q.folders) continue;
        const folder = q.folders as any;
        const prev = folderMap.get(q.folder_id);
        if (prev) { prev.count++; }
        else {
          folderMap.set(q.folder_id, {
            id: q.folder_id,
            name: folder.name,
            parentName: folder.parent?.name ?? null,
            count: 1,
          });
        }
      }

      // Detect name collisions and build display names
      const nameCount = new Map<string, number>();
      for (const f of folderMap.values()) nameCount.set(f.name, (nameCount.get(f.name) ?? 0) + 1);

      pickerFolders = Array.from(folderMap.values())
        .map((f) => ({
          id: f.id,
          name: f.name,
          displayName: (nameCount.get(f.name) ?? 1) > 1 && f.parentName
            ? `${f.parentName} / ${f.name}`
            : f.name,
          count: f.count,
        }))
        .sort((a, b) => a.displayName.localeCompare(b.displayName));
    }
  }

  return {
    user,
    test: test as Test,
    sections,
    pickingSectionId,
    pickerQuestions,
    pickerFolders,
  };
}

// ── Action ─────────────────────────────────────────────────────

export async function action({ params, request, context }: Route.ActionArgs) {
  const env = context.cloudflare.env;
  const user = await requireUser(request, env);
  const supabase = createServerClient(env);
  const testId = params.id!;

  // Verify ownership for every action
  const { data: test } = await supabase
    .from("tests")
    .select("id")
    .eq("id", testId)
    .eq("owner_id", user.id)
    .single();
  if (!test) throw redirect("/tests");

  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");

  // ── Test-level ──────────────────────────────────────────

  if (intent === "update_test") {
    const title = String(formData.get("title") ?? "").trim();
    const description = String(formData.get("description") ?? "").trim() || null;
    const durationMins = parseInt(String(formData.get("duration_mins") ?? ""), 10);
    if (title) {
      await supabase
        .from("tests")
        .update({ title, description, duration_mins: isNaN(durationMins) ? undefined : durationMins })
        .eq("id", testId);
    }
    return { ok: true };
  }

  if (intent === "toggle_publish") {
    const current = formData.get("is_published") === "true";
    await supabase
      .from("tests")
      .update({ is_published: !current })
      .eq("id", testId);
    return null;
  }

  if (intent === "delete_test") {
    await supabase.from("tests").delete().eq("id", testId);
    throw redirect("/tests");
  }

  // ── Section-level ───────────────────────────────────────

  if (intent === "add_section") {
    const name          = String(formData.get("name") ?? "").trim();
    const questionType  = String(formData.get("question_type") ?? "") as QuestionType;
    const subject       = String(formData.get("subject") ?? "") as Subject;
    const marksCorrect  = parseFloat(String(formData.get("marks_correct") ?? "4"));
    const marksWrong    = parseFloat(String(formData.get("marks_wrong") ?? "0"));
    const marksPartialRaw = formData.get("marks_partial");
    const marksPartial  = questionType === "mcq" && marksPartialRaw
      ? parseFloat(String(marksPartialRaw))
      : null;

    if (!name || !questionType || !subject) return null;
    if (isNaN(marksCorrect) || isNaN(marksWrong)) return null;
    // marksPartial is optional (MCQ only), but if supplied it must be a real number
    if (marksPartial !== null && isNaN(marksPartial)) return null;

    // Negative marking must be stored as a negative number.
    // Coerce here so a user typing "1" instead of "-1" is corrected silently.
    const marksWrongNormalised = marksWrong > 0 ? -marksWrong : marksWrong;

    // Get next display_order
    const { data: last } = await supabase
      .from("test_sections")
      .select("display_order")
      .eq("test_id", testId)
      .order("display_order", { ascending: false })
      .limit(1)
      .maybeSingle();

    await supabase.from("test_sections").insert({
      test_id: testId,
      name,
      question_type: questionType,
      subject,
      marks_correct: marksCorrect,
      marks_wrong: marksWrongNormalised,
      marks_partial: marksPartial,
      display_order: (last?.display_order ?? 0) + 1,
    });
    return null;
  }

  if (intent === "delete_section") {
    const sectionId = String(formData.get("section_id") ?? "");
    // Verify section belongs to this test
    const { data: sec } = await supabase
      .from("test_sections")
      .select("id")
      .eq("id", sectionId)
      .eq("test_id", testId)
      .single();
    if (sec) {
      await supabase.from("test_sections").delete().eq("id", sectionId);
    }
    return null;
  }

  if (intent === "edit_section") {
    const sectionId    = String(formData.get("section_id") ?? "");
    const name         = String(formData.get("name") ?? "").trim();
    const marksCorrect = parseFloat(String(formData.get("marks_correct") ?? ""));
    const marksWrongRaw = parseFloat(String(formData.get("marks_wrong") ?? ""));
    const marksWrong   = marksWrongRaw > 0 ? -marksWrongRaw : marksWrongRaw;

    const { data: sec } = await supabase
      .from("test_sections").select("id").eq("id", sectionId).eq("test_id", testId).single();
    if (sec && name && !isNaN(marksCorrect) && !isNaN(marksWrong)) {
      await supabase.from("test_sections")
        .update({ name, marks_correct: marksCorrect, marks_wrong: marksWrong })
        .eq("id", sectionId);
    }
    return { ok: true };
  }

  // ── Question-level ──────────────────────────────────────

  if (intent === "add_question") {
    const sectionId  = String(formData.get("section_id") ?? "");
    const questionId = String(formData.get("question_id") ?? "");

    // Verify section belongs to this test
    const { data: sec } = await supabase
      .from("test_sections")
      .select("id, question_type, subject")
      .eq("id", sectionId)
      .eq("test_id", testId)
      .single();
    if (!sec) return null;

    // Verify question belongs to user and matches section type+subject
    const { data: q } = await supabase
      .from("questions")
      .select("id, type, subject")
      .eq("id", questionId)
      .eq("owner_id", user.id)
      .eq("type", sec.question_type)
      .eq("subject", sec.subject)
      .single();
    if (!q) return null;

    // Get next display_order for this section
    const { data: last } = await supabase
      .from("test_questions")
      .select("display_order")
      .eq("test_section_id", sectionId)
      .order("display_order", { ascending: false })
      .limit(1)
      .maybeSingle();

    // Upsert in case of duplicate (no-op if already exists)
    await supabase.from("test_questions").upsert({
      test_section_id: sectionId,
      question_id: questionId,
      display_order: (last?.display_order ?? 0) + 1,
    });

    // Stay on picker for this section so user can keep adding
    throw redirect(`/tests/${testId}?picking=${sectionId}`);
  }

  if (intent === "remove_question") {
    const sectionId  = String(formData.get("section_id") ?? "");
    const questionId = String(formData.get("question_id") ?? "");

    // Verify section belongs to this test
    const { data: sec } = await supabase
      .from("test_sections")
      .select("id")
      .eq("id", sectionId)
      .eq("test_id", testId)
      .single();
    if (!sec) return null;

    await supabase
      .from("test_questions")
      .delete()
      .eq("test_section_id", sectionId)
      .eq("question_id", questionId);
    return null;
  }

  if (intent === "move_up" || intent === "move_down") {
    const sectionId  = String(formData.get("section_id") ?? "");
    const questionId = String(formData.get("question_id") ?? "");

    // Verify section belongs to this test
    const { data: sec } = await supabase
      .from("test_sections")
      .select("id")
      .eq("id", sectionId)
      .eq("test_id", testId)
      .single();
    if (!sec) return null;

    // Fetch all questions in this section sorted by display_order
    const { data: allQs } = await supabase
      .from("test_questions")
      .select("question_id, display_order")
      .eq("test_section_id", sectionId)
      .order("display_order", { ascending: true });

    const qs = allQs ?? [];
    const idx = qs.findIndex((q) => q.question_id === questionId);
    if (idx === -1) return null;

    const targetIdx = intent === "move_up" ? idx - 1 : idx + 1;
    if (targetIdx < 0 || targetIdx >= qs.length) return null;

    // Swap display_order values
    const currentOrder = qs[idx].display_order;
    const targetOrder  = qs[targetIdx].display_order;

    if (currentOrder === targetOrder) return null; // No-op if equal

    await supabase
      .from("test_questions")
      .update({ display_order: targetOrder })
      .eq("test_section_id", sectionId)
      .eq("question_id", questionId);

    await supabase
      .from("test_questions")
      .update({ display_order: currentOrder })
      .eq("test_section_id", sectionId)
      .eq("question_id", qs[targetIdx].question_id);

    return null;
  }

  if (intent === "add_folder") {
    const sectionId = String(formData.get("section_id") ?? "");
    const folderId  = String(formData.get("folder_id")  ?? "");

    // Verify section belongs to this test
    const { data: sec } = await supabase
      .from("test_sections")
      .select("id, question_type, subject")
      .eq("id", sectionId)
      .eq("test_id", testId)
      .single();
    if (!sec) return null;

    // IDs already in section — to avoid duplicates
    const { data: existing } = await supabase
      .from("test_questions")
      .select("question_id")
      .eq("test_section_id", sectionId);
    const existingIds = (existing ?? []).map((r: any) => r.question_id as string);

    // Fetch all matching questions from folder
    let qQuery = supabase
      .from("questions")
      .select("id")
      .eq("owner_id", user.id)
      .eq("folder_id", folderId)
      .eq("type", sec.question_type)
      .eq("subject", sec.subject);
    if (existingIds.length > 0) {
      qQuery = qQuery.not("id", "in", `(${existingIds.join(",")})`);
    }
    const { data: toAdd } = await qQuery;
    if (!toAdd || toAdd.length === 0) throw redirect(`/tests/${testId}?picking=${sectionId}`);

    // Get current max display_order
    const { data: last } = await supabase
      .from("test_questions")
      .select("display_order")
      .eq("test_section_id", sectionId)
      .order("display_order", { ascending: false })
      .limit(1)
      .maybeSingle();

    let nextOrder = (last?.display_order ?? 0) + 1;
    const rows = (toAdd as any[]).map((q: any) => ({
      test_section_id: sectionId,
      question_id: q.id,
      display_order: nextOrder++,
    }));

    await supabase.from("test_questions").upsert(rows);
    throw redirect(`/tests/${testId}?picking=${sectionId}`);
  }

  return null;
}

// ── Component ──────────────────────────────────────────────────

export default function TestEditor({ loaderData }: Route.ComponentProps) {
  const { user, test, sections, pickingSectionId, pickerQuestions, pickerFolders } = loaderData;
  const [, setSearchParams] = useSearchParams();

  function openPicker(sectionId: string) {
    setSearchParams({ picking: sectionId }, { preventScrollReset: true });
  }

  function closePicker() {
    setSearchParams({}, { preventScrollReset: true });
  }

  const totalQuestions = sections.reduce((sum, s) => sum + s.questions.length, 0);

  return (
    <div className="app-layout">
      <Sidebar displayName={user.display_name} />
      <main className="app-main">
        <div style={{ maxWidth: 1100, margin: "0 auto" }}>

          {/* Breadcrumb */}
          <div className="pg-head" style={{ paddingBottom: 0 }}>
            <div>
              <nav className="result-breadcrumb" style={{ marginBottom: 6 }}>
                <Link to="/tests" className="result-breadcrumb-link">My Tests</Link>
                <IconChevronRight size={13} />
                <span>{test.title}</span>
              </nav>
              <h1 className="pg-title">{test.title}</h1>
            </div>
          </div>

          <div className="pg-body">

        {/* ── Test header card ── */}
        <TestHeaderCard test={test} totalQuestions={totalQuestions} sectionCount={sections.length} />

        {/* ── Sections ── */}
        <div style={{ marginTop: 24, display: "flex", flexDirection: "column", gap: 16 }}>
          {sections.map((section) => (
            <SectionCard
              key={section.id}
              section={section}
              testId={test.id}
              isPicking={pickingSectionId === section.id}
              pickerQuestions={pickingSectionId === section.id ? pickerQuestions : []}
              pickerFolders={pickingSectionId === section.id ? pickerFolders : []}
              onOpenPicker={() => openPicker(section.id)}
              onClosePicker={closePicker}
            />
          ))}
        </div>

        {/* ── Add section form ── */}
        <AddSectionForm testId={test.id} />
        </div>{/* pg-body */}
        </div>{/* maxWidth */}
      </main>
    </div>
  );
}

// ── TestHeaderCard ─────────────────────────────────────────────


function TestHeaderCard({
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

// ── SectionCard ────────────────────────────────────────────────


function SectionCard({
  section,
  testId,
  isPicking,
  pickerQuestions,
  pickerFolders,
  onOpenPicker,
  onClosePicker,
}: {
  section: Section;
  testId: string;
  isPicking: boolean;
  pickerQuestions: QuestionRow[];
  pickerFolders: { id: string; name: string; displayName: string; count: number }[];
  onOpenPicker: () => void;
  onClosePicker: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const sectionEditFetcher = useFetcher();
  const sectionDeleteFetcher = useFetcher();
  const subjMeta = SUBJECT_META[section.subject];
  const typeMeta = TYPE_META[section.question_type];

  const markingStr = (() => {
    const pos = `+${section.marks_correct}`;
    const neg = section.marks_wrong !== 0 ? ` / ${section.marks_wrong}` : " / 0";
    const partial = section.marks_partial != null ? " / +1 per correct option" : "";
    return pos + neg + partial;
  })();

  function handleDeleteSection() {
    if (!confirm(`Delete section "${section.name}"?`)) return;
    const fd = new FormData();
    fd.set("intent", "delete_section");
    fd.set("section_id", section.id);
    sectionDeleteFetcher.submit(fd, { method: "post" });
  }

  type MI = import("~/components/three-dot-menu").MenuItem;
  const sectionMenuItems: MI[] = [
    { type: "action", label: "Edit section", onClick: () => setEditing(true) },
    { type: "sep" },
    { type: "action", label: "Delete section", danger: true, onClick: handleDeleteSection },
  ];

  return (
    <div style={{ background: "var(--c-surface)", border: "1px solid var(--c-border)", borderRadius: 10, overflow: "hidden" }}>
      {editing ? (
        <sectionEditFetcher.Form method="post"
          style={{ padding: "14px 20px", borderBottom: "1px solid var(--c-border)", display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          <input type="hidden" name="intent" value="edit_section" />
          <input type="hidden" name="section_id" value={section.id} />
          <div style={{ flex: 2, minWidth: 160, display: "flex", flexDirection: "column", gap: 4 }}>
            <label style={labelStyle}>Section name</label>
            <input name="name" defaultValue={section.name} required style={inputStyle} autoFocus />
          </div>
          <div style={{ width: 120, display: "flex", flexDirection: "column", gap: 4 }}>
            <label style={labelStyle}>Marks (correct)</label>
            <input name="marks_correct" type="number" step="0.5" defaultValue={section.marks_correct} style={inputStyle} />
          </div>
          <div style={{ width: 130, display: "flex", flexDirection: "column", gap: 4 }}>
            <label style={labelStyle}>Negative marking</label>
            <input name="marks_wrong" type="number" step="0.5" defaultValue={section.marks_wrong} style={inputStyle} />
          </div>
          <button type="submit" style={btnPrimary} disabled={sectionEditFetcher.state !== "idle"}>
            {sectionEditFetcher.state !== "idle" ? "Saving…" : "Save"}
          </button>
          <button type="button" onClick={() => setEditing(false)} style={btnSecondary}>Cancel</button>
        </sectionEditFetcher.Form>
      ) : (
        <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--c-border)", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: "var(--c-text)" }}>
              {section.name}
            </p>
            <div style={{ display: "flex", gap: 6, marginTop: 5, flexWrap: "wrap" }}>
              <span style={{ ...badge, background: subjMeta.bg, color: subjMeta.text }}>{subjMeta.label}</span>
              <span style={{ ...badge, background: typeMeta.bg, color: typeMeta.text }}>{typeMeta.label}</span>
              <span style={{ ...badge, background: "var(--c-subtle)", color: "var(--c-text-2)" }}>{markingStr}</span>
              <span style={{ ...badge, background: "var(--c-subtle)", color: "var(--c-text-3)" }}>
                {section.questions.length} Q
              </span>
            </div>
          </div>
          <DotMenu items={sectionMenuItems} />
        </div>
      )}

      <div style={{ padding: "16px 20px" }}>
        {section.questions.length === 0 ? (
          <p style={{ margin: 0, fontSize: 13, color: "var(--c-text-3)", textAlign: "center", padding: "16px 0" }}>
            No questions yet — add some below
          </p>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 10, marginBottom: 12 }}>
            {section.questions.map((q, idx) => (
              <QuestionThumbnail
                key={q.id}
                question={q}
                sectionId={section.id}
                index={idx}
                total={section.questions.length}
              />
            ))}
          </div>
        )}
        {!isPicking && (
          <button type="button" onClick={onOpenPicker} style={{ ...btnSecondary, fontSize: 12 }}>
            + Add Questions
          </button>
        )}
      </div>

      {isPicking && (
        <QuestionPickerPanel
          section={section}
          testId={testId}
          questions={pickerQuestions}
          folders={pickerFolders}
          onClose={onClosePicker}
        />
      )}
    </div>
  );
}

// ── QuestionThumbnail ──────────────────────────────────────────


function QuestionThumbnail({
  question: q,
  sectionId,
  index,
  total,
}: {
  question: SectionQuestion;
  sectionId: string;
  index: number;
  total: number;
}) {
  return (
    <div style={{ border: "1px solid var(--c-border)", borderRadius: 8, overflow: "hidden", background: "var(--c-subtle)" }}>
      <div style={{ height: 110, display: "flex", alignItems: "center", justifyContent: "center", background: "var(--c-bg)", borderBottom: "1px solid var(--c-border)" }}>
        <img src={q.image_url} alt={`Q${index + 1}`} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />
      </div>
      <div style={{ padding: "6px 8px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: "var(--c-brand-500)" }}>Q{index + 1}</span>
        <div style={{ display: "flex", gap: 2 }}>
          <Form method="post">
            <input type="hidden" name="intent" value="move_up" />
            <input type="hidden" name="section_id" value={sectionId} />
            <input type="hidden" name="question_id" value={q.id} />
            <button type="submit" disabled={index === 0} title="Move up" style={{ ...arrowBtn, opacity: index === 0 ? 0.25 : 1 }}>↑</button>
          </Form>
          <Form method="post">
            <input type="hidden" name="intent" value="move_down" />
            <input type="hidden" name="section_id" value={sectionId} />
            <input type="hidden" name="question_id" value={q.id} />
            <button type="submit" disabled={index === total - 1} title="Move down" style={{ ...arrowBtn, opacity: index === total - 1 ? 0.25 : 1 }}>↓</button>
          </Form>
          <Form method="post">
            <input type="hidden" name="intent" value="remove_question" />
            <input type="hidden" name="section_id" value={sectionId} />
            <input type="hidden" name="question_id" value={q.id} />
            <button type="submit" title="Remove from section" style={{ ...arrowBtn, color: "var(--c-error)" }}>✕</button>
          </Form>
        </div>
      </div>
    </div>
  );
}

// ── QuestionPickerPanel ────────────────────────────────────────


function QuestionPickerPanel({
  section,
  testId,
  questions,
  folders,
  onClose,
}: {
  section: Section;
  testId: string;
  questions: QuestionRow[];
  folders: { id: string; name: string; displayName: string; count: number }[];
  onClose: () => void;
}) {
  const subjMeta = SUBJECT_META[section.subject];
  const typeMeta = TYPE_META[section.question_type];

  return (
    <div style={{ borderTop: "2px solid var(--c-brand-100)", background: "var(--c-subtle)", padding: "16px 20px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: "var(--c-brand-600)" }}>
          Add Questions to {section.name}
          <span style={{ fontWeight: 400, color: "var(--c-text-2)", marginLeft: 8 }}>
            {"— showing your "}
            <span style={{ color: subjMeta.text }}>{subjMeta.label}</span>
            {" / "}
            <span style={{ color: typeMeta.text }}>{typeMeta.label}</span>
            {" questions not yet in this section"}
          </span>
        </p>
        <button type="button" onClick={onClose} style={{ ...btnSecondary, fontSize: 12, padding: "4px 10px" }}>
          Close picker
        </button>
      </div>

      {folders.length > 0 && (
        <div style={{ marginBottom: 16, padding: "10px 14px", background: "var(--c-surface)", border: "1px solid var(--c-brand-200)", borderRadius: 8 }}>
          <p style={{ margin: "0 0 8px", fontSize: 11, fontWeight: 600, color: "var(--c-text-3)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Add by folder
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {folders.map((f) => (
              <Form key={f.id} method="post" style={{ display: "contents" }}>
                <input type="hidden" name="intent"     value="add_folder" />
                <input type="hidden" name="section_id" value={section.id} />
                <input type="hidden" name="folder_id"  value={f.id} />
                <button
                  type="submit"
                  title={`Add all ${f.count} question${f.count !== 1 ? "s" : ""} from "${f.displayName}"`}
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 6,
                    background: "var(--c-brand-50)", color: "var(--c-brand-700)",
                    border: "1px solid var(--c-brand-200)", borderRadius: 6,
                    padding: "5px 12px", fontSize: 12, fontWeight: 500,
                    cursor: "pointer", whiteSpace: "nowrap",
                  }}
                >
                  {f.displayName}
                  <span style={{ background: "var(--c-brand-200)", color: "var(--c-brand-700)", borderRadius: 10, padding: "1px 6px", fontSize: 11, fontWeight: 600 }}>
                    +{f.count}
                  </span>
                </button>
              </Form>
            ))}
          </div>
        </div>
      )}

      {questions.length === 0 ? (
        <div style={{ textAlign: "center", padding: "24px 0", color: "var(--c-text-3)", fontSize: 13 }}>
          No available questions match this section’s type and subject.{" "}
          <Link to="/questions/new" style={{ color: "var(--c-brand-500)" }} target="_blank" rel="noopener noreferrer">
            Upload more →
          </Link>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 10 }}>
          {questions.map((q) => (
            <PickerCard key={q.id} question={q} sectionId={section.id} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── PickerCard ─────────────────────────────────────────────────


function PickerCard({ question: q, sectionId }: { question: QuestionRow; sectionId: string }) {
  return (
    <div style={{ border: "1px solid var(--c-brand-200)", borderRadius: 8, overflow: "hidden", background: "var(--c-surface)" }}>
      <div style={{ height: 110, display: "flex", alignItems: "center", justifyContent: "center", background: "var(--c-bg)", borderBottom: "1px solid var(--c-border)" }}>
        <img src={q.image_url} alt="Question" style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />
      </div>
      <div style={{ padding: "7px 8px" }}>
        <p style={{ margin: "0 0 6px", fontSize: 11, color: "var(--c-text-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {q.chapter || <span style={{ color: "var(--c-text-3)" }}>No chapter</span>}
        </p>
        <Form method="post">
          <input type="hidden" name="intent" value="add_question" />
          <input type="hidden" name="section_id" value={sectionId} />
          <input type="hidden" name="question_id" value={q.id} />
          <button type="submit" style={{ ...btnPrimary, fontSize: 11, padding: "4px 0", width: "100%", justifyContent: "center" }}>
            + Add
          </button>
        </Form>
      </div>
    </div>
  );
}

// ── AddSectionForm ─────────────────────────────────────────────


function AddSectionForm({ testId: _ }: { testId: string }) {
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

// ── ── Styles & data ────────────────────────────────────────────────────────────────

const btnPrimary: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 6,
  background: "var(--c-brand-500)", color: "#fff", border: "none",
  borderRadius: 7, padding: "8px 16px", fontSize: 13,
  fontWeight: 500, cursor: "pointer", whiteSpace: "nowrap",
};

const btnSecondary: React.CSSProperties = {
  display: "inline-flex", alignItems: "center",
  background: "var(--c-surface)", color: "var(--c-text-2)", border: "1px solid var(--c-border)",
  borderRadius: 7, padding: "7px 13px", fontSize: 13,
  fontWeight: 400, cursor: "pointer", whiteSpace: "nowrap",
};

const arrowBtn: React.CSSProperties = {
  background: "none", border: "none", cursor: "pointer",
  fontSize: 12, color: "var(--c-text-3)", padding: "2px 4px", lineHeight: 1,
};

const badge: React.CSSProperties = {
  fontSize: 10, fontWeight: 700, letterSpacing: "0.04em",
  padding: "2px 7px", borderRadius: 4,
};

const labelStyle: React.CSSProperties = {
  fontSize: 12, fontWeight: 500, color: "var(--c-text-2)",
};

const inputStyle: React.CSSProperties = {
  padding: "8px 10px", border: "1px solid var(--c-border)",
  borderRadius: 6, fontSize: 14, width: "100%",
  boxSizing: "border-box", color: "var(--c-text)", background: "var(--c-surface)",
};

const SUBJECT_META: Record<string, { label: string; bg: string; text: string }> = {
  physics:     { label: "Physics",   bg: "#dbeafe", text: "#1d4ed8" },
  chemistry:   { label: "Chemistry", bg: "#dcfce7", text: "#15803d" },
  mathematics: { label: "Maths",     bg: "#f3e8ff", text: "#7e22ce" },
};

const TYPE_META: Record<string, { label: string; bg: string; text: string }> = {
  scq:       { label: "SCQ",       bg: "#fef3c7", text: "#92400e" },
  mcq:       { label: "MCQ",       bg: "#e0e7ff", text: "#3730a3" },
  integer:   { label: "Integer",   bg: "#d1fae5", text: "#065f46" },
  numerical: { label: "Numerical", bg: "#cffafe", text: "#0e7490" },
  paragraph: { label: "Paragraph", bg: "#fed7aa", text: "#9a3412" },
};
