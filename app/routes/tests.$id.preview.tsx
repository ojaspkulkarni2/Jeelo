import { redirect, Link } from "react-router";
import type { Route } from "./+types/tests.$id.preview";
import { requireUser } from "~/lib/auth.server";
import { createServerClient } from "~/lib/supabase.server";
import { Sidebar } from "~/components/sidebar";
import {
  IconChevronRight, IconPlay, IconClock, IconTests,
  IconTrophy, IconTarget, IconBookOpen,
} from "~/components/icons";

type Section = {
  id: string;
  name: string;
  question_type: string;
  subject: string;
  marks_correct: number;
  marks_wrong: number;
  marks_partial: number | null;
  question_count: number;
};

type TestDetail = {
  id: string;
  title: string;
  description: string | null;
  duration_mins: number;
  is_published: boolean;
  owner_display_name: string;
  sections: Section[];
  total_questions: number;
  total_marks: number;
  my_attempt: { submitted: boolean; score_total: number | null; score_max: number | null } | null;
  is_owner: boolean;
};

export async function loader({ params, request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const user = await requireUser(request, env);
  const supabase = createServerClient(env);
  const testId = params.id!;

  const { data: test, error } = await supabase
    .from("tests")
    .select(`
      id, title, description, duration_mins, is_published, owner_id,
      users!owner_id(display_name),
      test_sections(
        id, name, question_type, subject,
        marks_correct, marks_wrong, marks_partial, display_order,
        test_questions(question_id)
      )
    `)
    .eq("id", testId)
    .single();

  if (error || !test) throw redirect("/tests");

  const isOwner = (test as any).owner_id === user.id;

  // Non-owners can only see published tests
  if (!isOwner && !(test as any).is_published) throw redirect("/all-tests");

  const sections: Section[] = ((test as any).test_sections ?? [])
    .sort((a: any, b: any) => a.display_order - b.display_order)
    .map((s: any) => ({
      id: s.id,
      name: s.name,
      question_type: s.question_type,
      subject: s.subject,
      marks_correct: s.marks_correct,
      marks_wrong: s.marks_wrong,
      marks_partial: s.marks_partial,
      question_count: (s.test_questions ?? []).length,
    }));

  const totalQuestions = sections.reduce((s, sec) => s + sec.question_count, 0);
  const totalMarks = sections.reduce(
    (s, sec) => s + sec.marks_correct * sec.question_count,
    0
  );

  const { data: attempt } = await supabase
    .from("attempts")
    .select("submitted_at, score_breakdown")
    .eq("test_id", testId)
    .eq("student_id", user.id)
    .maybeSingle();

  const myAttempt = attempt
    ? {
        submitted: !!attempt.submitted_at,
        score_total: (attempt.score_breakdown as any)?.total ?? null,
        score_max: (attempt.score_breakdown as any)?.max_marks ?? null,
      }
    : null;

  return {
    user,
    test: {
      id: (test as any).id,
      title: (test as any).title,
      description: (test as any).description ?? null,
      duration_mins: (test as any).duration_mins,
      is_published: (test as any).is_published,
      owner_display_name: ((test as any).users as any)?.display_name ?? "Unknown",
      sections,
      total_questions: totalQuestions,
      total_marks: totalMarks,
      my_attempt: myAttempt,
      is_owner: isOwner,
    } as TestDetail,
  };
}

const SUBJECT_META: Record<string, { label: string; color: string; bg: string }> = {
  physics:     { label: "Physics",     color: "#1d4ed8", bg: "#dbeafe" },
  chemistry:   { label: "Chemistry",   color: "#15803d", bg: "#dcfce7" },
  mathematics: { label: "Mathematics", color: "#7e22ce", bg: "#f3e8ff" },
};

const TYPE_META: Record<string, { desc: string }> = {
  scq:       { desc: "Single Correct" },
  mcq:       { desc: "Multi Correct" },
  integer:   { desc: "Integer Answer" },
  numerical: { desc: "Numerical Answer" },
  paragraph: { desc: "Paragraph-based" },
};

function StatPill({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        background: "var(--c-surface)",
        border: "1px solid var(--c-border)",
        borderRadius: "var(--r-md)",
        padding: "14px 18px",
        flex: 1,
        minWidth: 130,
      }}
    >
      <div style={{ color: "var(--c-brand-500)", flexShrink: 0 }}>{icon}</div>
      <div>
        <div
          style={{
            fontSize: 18,
            fontWeight: 700,
            color: "var(--c-text)",
            lineHeight: 1.2,
          }}
        >
          {value}
        </div>
        <div style={{ fontSize: 11, color: "var(--c-text-3)", marginTop: 2 }}>
          {label}
        </div>
      </div>
    </div>
  );
}

export default function TestPreviewPage({ loaderData }: Route.ComponentProps) {
  const { user, test: t } = loaderData;

  const hrs = Math.floor(t.duration_mins / 60);
  const mins = t.duration_mins % 60;
  const durationStr =
    hrs > 0 ? `${hrs}h${mins > 0 ? ` ${mins}m` : ""}` : `${mins}m`;

  const scorePercent =
    t.my_attempt?.score_total != null && t.my_attempt?.score_max
      ? Math.round((t.my_attempt.score_total / t.my_attempt.score_max) * 100)
      : null;

  const scoreColor =
    scorePercent == null
      ? "var(--c-text)"
      : scorePercent >= 70
      ? "var(--c-success)"
      : scorePercent >= 40
      ? "var(--c-brand-500)"
      : "var(--c-error)";

  const backTo = t.is_owner ? "/tests" : "/all-tests";
  const backLabel = t.is_owner ? "My Tests" : "Discover";

  return (
    <div className="app-layout">
      <Sidebar displayName={user.display_name} />
      <main className="app-main">
        <div
          style={{ maxWidth: 780, margin: "0 auto", padding: "0 24px 60px" }}
        >
          {/* Breadcrumb */}
          <div className="pg-head" style={{ paddingBottom: 0 }}>
            <nav className="result-breadcrumb" style={{ marginBottom: 6 }}>
              <Link to={backTo} className="result-breadcrumb-link">
                {backLabel}
              </Link>
              <IconChevronRight size={13} />
              <span>{t.title}</span>
            </nav>
          </div>

          {/* Hero card */}
          <div
            style={{
              background: "var(--c-surface)",
              border: "1px solid var(--c-border)",
              borderRadius: "var(--r-lg)",
              padding: "28px 28px 24px",
              marginBottom: 16,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "flex-start",
                justifyContent: "space-between",
                gap: 16,
                flexWrap: "wrap",
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <h1
                  style={{
                    margin: "0 0 6px",
                    fontSize: 26,
                    fontWeight: 700,
                    color: "var(--c-text)",
                    letterSpacing: "-0.02em",
                    fontFamily: "var(--font-display)",
                    lineHeight: 1.2,
                  }}
                >
                  {t.title}
                </h1>
                {t.description && (
                  <p
                    style={{
                      margin: "0 0 10px",
                      fontSize: 14,
                      color: "var(--c-text-2)",
                      lineHeight: 1.6,
                    }}
                  >
                    {t.description}
                  </p>
                )}
                <p
                  style={{ margin: 0, fontSize: 13, color: "var(--c-text-3)" }}
                >
                  Created by {t.owner_display_name}
                </p>
              </div>

              {/* Score badge if already submitted */}
              {t.my_attempt?.submitted && t.my_attempt.score_total != null && (
                <div
                  style={{
                    background: "var(--c-subtle)",
                    borderRadius: "var(--r-md)",
                    padding: "14px 20px",
                    textAlign: "center",
                    flexShrink: 0,
                    border: "1px solid var(--c-border)",
                  }}
                >
                  <div
                    style={{
                      fontSize: 24,
                      fontWeight: 800,
                      color: scoreColor,
                      lineHeight: 1,
                    }}
                  >
                    {t.my_attempt.score_total}/{t.my_attempt.score_max}
                  </div>
                  <div
                    style={{
                      fontSize: 11,
                      color: "var(--c-text-3)",
                      marginTop: 4,
                    }}
                  >
                    {scorePercent}% · Your score
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Stats row */}
          <div
            style={{
              display: "flex",
              gap: 10,
              marginBottom: 16,
              flexWrap: "wrap",
            }}
          >
            <StatPill
              icon={<IconClock size={17} />}
              label="Duration"
              value={durationStr}
            />
            <StatPill
              icon={<IconTests size={17} />}
              label="Questions"
              value={String(t.total_questions)}
            />
            <StatPill
              icon={<IconTarget size={17} />}
              label="Total Marks"
              value={String(t.total_marks)}
            />
            <StatPill
              icon={<IconBookOpen size={17} />}
              label="Sections"
              value={String(t.sections.length)}
            />
          </div>

          {/* Sections breakdown */}
          <div
            style={{
              background: "var(--c-surface)",
              border: "1px solid var(--c-border)",
              borderRadius: "var(--r-lg)",
              overflow: "hidden",
              marginBottom: 28,
            }}
          >
            <div
              style={{
                padding: "13px 20px",
                borderBottom: "1px solid var(--c-border)",
                fontSize: 12,
                fontWeight: 600,
                color: "var(--c-text-3)",
                display: "grid",
                gridTemplateColumns: "1fr 140px 80px 110px",
                gap: 12,
                textTransform: "uppercase",
                letterSpacing: "0.05em",
              }}
            >
              <span>Section</span>
              <span>Type</span>
              <span style={{ textAlign: "center" }}>Questions</span>
              <span style={{ textAlign: "center" }}>Marking</span>
            </div>

            {t.sections.length === 0 ? (
              <div
                style={{
                  padding: "28px",
                  textAlign: "center",
                  color: "var(--c-text-3)",
                  fontSize: 13,
                }}
              >
                No sections added yet.
              </div>
            ) : (
              t.sections.map((sec, i) => {
                const subj = SUBJECT_META[sec.subject] ?? {
                  label: sec.subject,
                  color: "var(--c-text)",
                  bg: "var(--c-subtle)",
                };
                const type = TYPE_META[sec.question_type] ?? {
                  desc: sec.question_type,
                };
                const markStr = `+${sec.marks_correct}${
                  sec.marks_wrong !== 0 ? ` / ${sec.marks_wrong}` : ""
                }`;
                const sectionMarks = sec.marks_correct * sec.question_count;

                return (
                  <div
                    key={sec.id}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 140px 80px 110px",
                      gap: 12,
                      alignItems: "center",
                      padding: "14px 20px",
                      borderTop:
                        i === 0 ? "none" : "1px solid var(--c-border)",
                    }}
                  >
                    <div>
                      <div
                        style={{
                          fontSize: 13,
                          fontWeight: 500,
                          color: "var(--c-text)",
                          marginBottom: 4,
                        }}
                      >
                        {sec.name}
                      </div>
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 700,
                          padding: "2px 7px",
                          borderRadius: 4,
                          background: subj.bg,
                          color: subj.color,
                        }}
                      >
                        {subj.label}
                      </span>
                    </div>
                    <div
                      style={{
                        fontSize: 12,
                        color: "var(--c-text-2)",
                      }}
                    >
                      {type.desc}
                    </div>
                    <div
                      style={{
                        textAlign: "center",
                        fontSize: 14,
                        fontWeight: 600,
                        color: "var(--c-text)",
                      }}
                    >
                      {sec.question_count}
                    </div>
                    <div style={{ textAlign: "center" }}>
                      <div
                        style={{
                          fontSize: 12,
                          fontWeight: 600,
                          color: "var(--c-text-2)",
                          background: "var(--c-subtle)",
                          padding: "3px 9px",
                          borderRadius: 5,
                          display: "inline-block",
                        }}
                      >
                        {markStr}
                      </div>
                      <div
                        style={{
                          fontSize: 10,
                          color: "var(--c-text-3)",
                          marginTop: 3,
                        }}
                      >
                        max {sectionMarks} marks
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* CTA buttons */}
          <div
            style={{
              display: "flex",
              gap: 10,
              justifyContent: "flex-end",
              flexWrap: "wrap",
            }}
          >
            {t.is_owner && (
              <Link to={`/tests/${t.id}`} className="btn btn-ghost">
                Edit test
              </Link>
            )}

            {t.my_attempt?.submitted ? (
              <Link to={`/tests/${t.id}/result`} className="btn btn-ghost">
                <IconTrophy size={15} /> View Result
              </Link>
            ) : t.total_questions > 0 ? (
              <Link
                to={`/tests/${t.id}/take`}
                className="btn btn-primary"
                style={{ gap: 8 }}
              >
                <IconPlay size={14} />
                {t.my_attempt && !t.my_attempt.submitted
                  ? "Resume Test"
                  : "Take Test"}
              </Link>
            ) : (
              <span
                style={{
                  fontSize: 13,
                  color: "var(--c-text-3)",
                  alignSelf: "center",
                }}
              >
                No questions yet — can't take this test.
              </span>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
