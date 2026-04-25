import { redirect, Link, useSearchParams } from "react-router";
// NOTE: With directory routes the generated type path is "./+types/route".
// If your project uses flat-file routing (tests.$id.tsx), keep "./+types/tests.$id".
import type { Route } from "./+types/route";
import { requireUser } from "~/lib/auth.server";
import { createServerClient } from "~/lib/supabase.server";
import { uploadImage } from "~/lib/storage.server";
import { Sidebar } from "~/components/sidebar";
import { IconChevronRight } from "~/components/icons";
import type { QuestionType, Subject, ExamType } from "~/lib/database.types";
import type { QuestionRow, Section, Test } from "./types";
import { TestHeaderCard } from "./TestHeaderCard";
import { SectionCard } from "./SectionCard";
import { AddSectionForm } from "./AddSectionForm";

// ── Loader ─────────────────────────────────────────────────────

export async function loader({ params, request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const user = await requireUser(request, env);
  const supabase = createServerClient(env);
  const testId = params.id!;

  // Verify ownership and get test
  const { data: test, error: testError } = await supabase
    .from("tests")
    .select("id, title, description, duration_mins, is_published, exam_type")
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
  let pickerUsedElsewhere: QuestionRow[] = [];
  let pickerFolders: { id: string; name: string; displayName: string; count: number }[] = [];

  if (pickingSectionId) {
    const section = sections.find((s) => s.id === pickingSectionId);
    if (section) {
      // Questions already in THIS section are fully excluded
      const thisSecIds = new Set(section.questions.map((q) => q.id));
      // Questions in OTHER sections of this test — soft-hidden (shown via toggle)
      const otherSecIds = new Set(
        sections.flatMap((s) => s.id !== section.id ? s.questions.map((q) => q.id) : [])
      );

      const { data: qs } = await supabase
        .from("questions")
        .select("id, image_url, type, subject, chapter, folder_id, folders(id, name, parent_id, parent:parent_id(id, name))")
        .eq("owner_id", user.id)
        .eq("type", section.question_type)
        .eq("subject", section.subject)
        .order("created_at", { ascending: false });

      const allQs = (qs ?? []) as any[];
      // Split into fresh vs already-used-in-another-section
      const freshQs = allQs.filter((q: any) => !thisSecIds.has(q.id) && !otherSecIds.has(q.id));
      const usedQs  = allQs.filter((q: any) => !thisSecIds.has(q.id) && otherSecIds.has(q.id));

      pickerQuestions     = freshQs.map(({ folders: _f, ...rest }: any) => rest) as QuestionRow[];
      pickerUsedElsewhere = usedQs.map(({ folders: _f, ...rest }: any) => rest) as QuestionRow[];

      // Build folder list from fresh questions only
      const folderMap = new Map<string, { id: string; name: string; parentName: string | null; count: number }>();
      for (const q of freshQs) {
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
    pickerUsedElsewhere,
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
    const examTypeRaw = String(formData.get("exam_type") ?? "advanced");
    const examType: ExamType = examTypeRaw === "main" ? "main" : "advanced";
    if (title) {
      await supabase
        .from("tests")
        .update({ title, description, duration_mins: isNaN(durationMins) ? undefined : durationMins, exam_type: examType })
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
    const chapter       = String(formData.get("chapter") ?? "").trim();
    const marksCorrect  = parseFloat(String(formData.get("marks_correct") ?? "4"));
    const marksWrong    = parseFloat(String(formData.get("marks_wrong") ?? "0"));
    const marksPartialRaw = formData.get("marks_partial");
    const marksPartial  = questionType === "mcq" && marksPartialRaw
      ? parseFloat(String(marksPartialRaw))
      : null;
    const answerKey     = String(formData.get("answer_key") ?? "");
    const imageFiles    = (formData.getAll("images") as File[]).filter((f) => f.size > 0);

    if (!name || !questionType || !subject || !chapter) return null;
    if (isNaN(marksCorrect) || isNaN(marksWrong)) return null;
    if (marksPartial !== null && isNaN(marksPartial)) return null;

    const marksWrongNormalised = marksWrong > 0 ? -marksWrong : marksWrong;

    // ── Handle paragraph passage upload ──────────────────────────
    let paragraphId: string | null = null;
    if (questionType === "paragraph") {
      const paraImageFile = formData.get("paragraph_image") as File | null;
      if (!paraImageFile || paraImageFile.size === 0)
        return { error: "A passage image is required for paragraph-based sections" };

      const paraUpload = await uploadImage(paraImageFile, user.id, env);
      if ("error" in paraUpload)
        return { error: `Passage upload failed: ${paraUpload.error}` };

      const { data: para, error: paraErr } = await supabase
        .from("paragraphs")
        .insert({ owner_id: user.id, image_url: paraUpload.publicUrl, title: null })
        .select("id")
        .single();

      if (paraErr || !para)
        return { error: "Failed to save passage — please try again" };

      paragraphId = para.id;
    }

    // ── Parse answer key (only if images were uploaded) ─────────
    type ParsedAnswer = { answer: unknown } | { error: string };

    function parseAnswerLine(raw: string, type: QuestionType): ParsedAnswer {
      const line = raw.trim().toLowerCase();
      if (type === "scq" || type === "paragraph") {
        if (!["a","b","c","d"].includes(line)) return { error: `"${raw}" — use a, b, c, or d` };
        return { answer: [line.toUpperCase()] };
      }
      if (type === "mcq") {
        const opts = line.split(/[\s,]+/).filter(Boolean);
        if (!opts.length) return { error: "Empty line" };
        const bad = opts.find((o) => !["a","b","c","d"].includes(o));
        if (bad) return { error: `"${bad}" is not a valid option` };
        return { answer: [...new Set(opts)].sort().map((o) => o.toUpperCase()) };
      }
      if (type === "integer") {
        const n = parseInt(line, 10);
        if (isNaN(n)) return { error: `"${raw}" is not a valid integer` };
        return { answer: n };
      }
      if (type === "numerical") {
        const n = parseFloat(line);
        if (isNaN(n)) return { error: `"${raw}" is not a valid number` };
        return { answer: n };
      }
      return { error: "Unknown type" };
    }

    // Enforce image cap server-side (Cloudflare Workers ~50 subrequest limit:
    // imageCount + 5 fixed DB ops must stay under it)
    const MAX_IMAGES = 40;
    if (imageFiles.length > MAX_IMAGES) {
      return { error: `Max ${MAX_IMAGES} images per section — split into multiple sections if needed` };
    }

    let correctAnswers: unknown[] = [];
    if (imageFiles.length > 0) {
      const answerLines = answerKey.split("\n").map((l) => l.trim()).filter(Boolean);
      if (answerLines.length !== imageFiles.length) {
        return { error: `${answerLines.length} answer${answerLines.length !== 1 ? "s" : ""} but ${imageFiles.length} image${imageFiles.length !== 1 ? "s" : ""} — counts must match` };
      }
      for (let i = 0; i < answerLines.length; i++) {
        const result = parseAnswerLine(answerLines[i], questionType);
        if ("error" in result) return { error: `Answer ${i + 1}: ${result.error}` };
        correctAnswers.push(result.answer);
      }
    }

    // ── Create section ───────────────────────────────────────────
    const { data: last } = await supabase
      .from("test_sections")
      .select("display_order")
      .eq("test_id", testId)
      .order("display_order", { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data: sec, error: secErr } = await supabase
      .from("test_sections")
      .insert({
        test_id: testId,
        name,
        question_type: questionType,
        subject,
        marks_correct: marksCorrect,
        marks_wrong: marksWrongNormalised,
        marks_partial: marksPartial,
        display_order: (last?.display_order ?? 0) + 1,
      })
      .select("id")
      .single();

    if (secErr || !sec) return { error: secErr?.message ?? "Failed to create section — please try again" };

    // ── Upload images + insert questions (if any) ─────────────────
    if (imageFiles.length > 0) {
      const CHUNK = 5; // keep concurrent Supabase Storage fetches low
      const uploads: ({ publicUrl: string } | { error: string })[] = [];
      for (let i = 0; i < imageFiles.length; i += CHUNK) {
        const chunk = imageFiles.slice(i, i + CHUNK);
        const results = await Promise.all(chunk.map((f) => uploadImage(f, user.id, env)));
        uploads.push(...results);
      }

      const failIdx = uploads.findIndex((u) => "error" in u);
      if (failIdx !== -1) {
        return { error: `Upload failed for image ${failIdx + 1}: ${(uploads[failIdx] as { error: string }).error}` };
      }

      // Insert into questions table (tagged with subject/chapter/type for the bank)
      const { data: insertedQs, error: qErr } = await supabase
        .from("questions")
        .insert(
          (uploads as { publicUrl: string }[]).map((u, i) => ({
            owner_id: user.id,
            image_url: u.publicUrl,
            type: questionType,
            subject,
            chapter,
            correct_answer: correctAnswers[i],
            paragraph_id: paragraphId,
            folder_id: null,
            is_shared: false,
          }))
        )
        .select("id");

      if (!qErr && insertedQs && insertedQs.length > 0) {
        // Link questions to this section in display order
        await supabase.from("test_questions").insert(
          insertedQs.map((q, idx) => ({
            test_section_id: sec.id,
            question_id: q.id,
            display_order: idx + 1,
          }))
        );
      }
    }

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

    // If this came from a fetcher (XHR), return JSON so the picker can update
    // optimistically without a full page reload.
    const acceptHeader = request.headers.get("Accept") ?? "";
    if (acceptHeader.includes("application/json")) {
      return { ok: true, intent: "add_question", questionId, sectionId };
    }

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
  const { user, test, sections, pickingSectionId, pickerQuestions, pickerFolders, pickerUsedElsewhere } = loaderData;
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
                  pickerUsedElsewhere={pickingSectionId === section.id ? pickerUsedElsewhere : []}
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
