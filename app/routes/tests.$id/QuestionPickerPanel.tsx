import { Form, useFetcher } from "react-router";
import { useState, useEffect } from "react";
import type { Section, QuestionRow } from "./types";
import { btnPrimary, btnSecondary, SUBJECT_META, TYPE_META } from "./styles";

// ── PickerCard ──────────────────────────────────────────────────

function PickerCard({
  question: q,
  sectionId,
  dimmed,
  onAdded,
}: {
  question: QuestionRow;
  sectionId: string;
  dimmed?: boolean;
  onAdded: (id: string) => void;
}) {
  const fetcher = useFetcher();
  const isSubmitting = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data && (fetcher.data as any).ok) {
      onAdded(q.id);
    }
  }, [fetcher.state, fetcher.data]); // eslint-disable-line

  return (
    <div style={{
      border: "1px solid var(--c-brand-200)", borderRadius: 8, overflow: "hidden",
      background: "var(--c-surface)", opacity: dimmed ? 0.65 : 1,
      transition: "opacity 0.15s",
    }}>
      <div style={{ height: 110, display: "flex", alignItems: "center", justifyContent: "center", background: "var(--c-bg)", borderBottom: "1px solid var(--c-border)" }}>
        <img src={q.image_url} alt="Question" style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />
      </div>
      <div style={{ padding: "7px 8px" }}>
        <p style={{ margin: "0 0 6px", fontSize: 11, color: "var(--c-text-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {q.chapter || <span style={{ color: "var(--c-text-3)" }}>No chapter</span>}
        </p>
        <fetcher.Form method="post">
          <input type="hidden" name="intent" value="add_question" />
          <input type="hidden" name="section_id" value={sectionId} />
          <input type="hidden" name="question_id" value={q.id} />
          <button
            type="submit"
            disabled={isSubmitting}
            style={{
              ...btnPrimary, fontSize: 11, padding: "4px 0", width: "100%",
              justifyContent: "center",
              opacity: isSubmitting ? 0.6 : 1,
            }}
          >
            {isSubmitting ? "Adding…" : "+ Add"}
          </button>
        </fetcher.Form>
      </div>
    </div>
  );
}

// ── Sort helpers ────────────────────────────────────────────────

const SUBJECT_ORDER: Record<string, number> = { physics: 0, chemistry: 1, mathematics: 2 };
const TYPE_ORDER: Record<string, number>    = { scq: 0, mcq: 1, integer: 2, numerical: 3, paragraph: 4 };

function sortQuestions(qs: QuestionRow[]): QuestionRow[] {
  return [...qs].sort((a, b) => {
    const sa = SUBJECT_ORDER[a.subject] ?? 99;
    const sb = SUBJECT_ORDER[b.subject] ?? 99;
    if (sa !== sb) return sa - sb;
    const ca = (a.chapter ?? "").toLowerCase();
    const cb = (b.chapter ?? "").toLowerCase();
    if (ca !== cb) return ca.localeCompare(cb);
    const ta = TYPE_ORDER[a.type] ?? 99;
    const tb = TYPE_ORDER[b.type] ?? 99;
    return ta - tb;
  });
}

// Group sorted questions into { subject → chapter } buckets for display
type ChapterGroup = { subject: string; chapter: string; questions: QuestionRow[] };

function groupBySubjectChapter(qs: QuestionRow[]): ChapterGroup[] {
  const groups: ChapterGroup[] = [];
  for (const q of qs) {
    const last = groups[groups.length - 1];
    if (last && last.subject === q.subject && last.chapter === (q.chapter ?? "")) {
      last.questions.push(q);
    } else {
      groups.push({ subject: q.subject, chapter: q.chapter ?? "", questions: [q] });
    }
  }
  return groups;
}

// ── QuestionPickerPanel ─────────────────────────────────────────

export function QuestionPickerPanel({
  section,
  testId: _testId,
  questions,
  usedElsewhere,
  onClose,
}: {
  section: Section;
  testId: string;
  questions: QuestionRow[];
  folders: { id: string; name: string; displayName: string; count: number }[];
  usedElsewhere: QuestionRow[];
  onClose: () => void;
}) {
  const subjMeta = SUBJECT_META[section.subject];
  const typeMeta = TYPE_META[section.question_type];
  const [showUsed, setShowUsed] = useState(false);
  const [addedIds, setAddedIds] = useState<Set<string>>(new Set());

  function handleAdded(id: string) {
    setAddedIds((prev) => new Set([...prev, id]));
  }

  const visibleFresh     = sortQuestions(questions.filter((q) => !addedIds.has(q.id)));
  const visibleElsewhere = sortQuestions(usedElsewhere.filter((q) => !addedIds.has(q.id)));
  const totalAdded       = addedIds.size;

  const freshGroups = groupBySubjectChapter(visibleFresh);

  return (
    <div style={{ borderTop: "2px solid var(--c-brand-100)", background: "var(--c-subtle)", padding: "16px 20px" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: "var(--c-brand-600)" }}>
          Add Questions to {section.name}
          {totalAdded > 0 && (
            <span style={{ marginLeft: 10, fontSize: 12, fontWeight: 500, color: "var(--c-brand-500)", background: "var(--c-brand-50)", border: "1px solid var(--c-brand-200)", borderRadius: 10, padding: "2px 8px" }}>
              {totalAdded} added this session
            </span>
          )}
          <span style={{ fontWeight: 400, color: "var(--c-text-2)", marginLeft: 8 }}>
            {"— "}
            <span style={{ color: subjMeta.text }}>{subjMeta.label}</span>
            {" / "}
            <span style={{ color: typeMeta.text }}>{typeMeta.label}</span>
          </span>
        </p>
        <button type="button" onClick={onClose} style={{ ...btnSecondary, fontSize: 12, padding: "4px 10px" }}>
          Close picker
        </button>
      </div>

      {/* Empty state */}
      {visibleFresh.length === 0 && visibleElsewhere.length === 0 ? (
        <div style={{ textAlign: "center", padding: "24px 0", color: "var(--c-text-3)", fontSize: 13 }}>
          {totalAdded > 0
            ? `All done! ${totalAdded} question${totalAdded !== 1 ? "s" : ""} added.`
            : "No questions in your bank match this section's type and subject. Use \"Add Section\" below to upload some."
          }
        </div>
      ) : (
        <>
          {/* Fresh questions — grouped by subject → chapter */}
          {freshGroups.length > 0 ? (
            <div>
              {freshGroups.map((group, gi) => (
                <div key={`${group.subject}-${group.chapter}-${gi}`} style={{ marginBottom: 18 }}>
                  {/* Group header */}
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                    <span style={{
                      fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em",
                      color: SUBJECT_META[group.subject]?.text ?? "var(--c-text-2)",
                      background: SUBJECT_META[group.subject]?.bg ?? "var(--c-subtle)",
                      padding: "2px 8px", borderRadius: 4,
                    }}>
                      {SUBJECT_META[group.subject]?.label ?? group.subject}
                    </span>
                    {group.chapter && (
                      <span style={{ fontSize: 12, color: "var(--c-text-2)", fontWeight: 500 }}>
                        {group.chapter}
                      </span>
                    )}
                    <span style={{ fontSize: 11, color: "var(--c-text-3)" }}>
                      ({group.questions.length})
                    </span>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 10 }}>
                    {group.questions.map((q) => (
                      <PickerCard key={q.id} question={q} sectionId={section.id} onAdded={handleAdded} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ textAlign: "center", padding: "12px 0", color: "var(--c-text-3)", fontSize: 13 }}>
              No fresh questions — all matching questions are already used in this test.
            </div>
          )}

          {/* Used-elsewhere toggle */}
          {visibleElsewhere.length > 0 && (
            <div style={{ marginTop: 18 }}>
              <button
                type="button"
                onClick={() => setShowUsed((v) => !v)}
                style={{
                  background: "none", border: "none", cursor: "pointer",
                  fontSize: 12, fontWeight: 600, color: "var(--c-text-2)",
                  display: "flex", alignItems: "center", gap: 6, padding: "4px 0",
                }}
              >
                <span style={{
                  display: "inline-block",
                  transform: showUsed ? "rotate(90deg)" : "rotate(0deg)",
                  transition: "transform 0.15s", fontSize: 10,
                }}>▶</span>
                {showUsed ? "Hide" : "Show"} questions already used in this test ({visibleElsewhere.length})
              </button>
              {showUsed && (
                <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 10 }}>
                  {visibleElsewhere.map((q) => (
                    <PickerCard key={q.id} question={q} sectionId={section.id} dimmed onAdded={handleAdded} />
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
