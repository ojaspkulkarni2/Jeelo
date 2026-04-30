import { data } from "react-router";
import type { Route } from "./+types/feed-actions";
import { requireUser } from "~/lib/auth.server";
import { createServerClient } from "~/lib/supabase.server";

// Resource route — handles all feed mutations (answer, solid, comment, report).
// Lives at /feed-actions so that posting here never triggers the /feed loader to revalidate.

export async function action({ request, context }: Route.ActionArgs) {
  const env = context.cloudflare.env;
  const user = await requireUser(request, env);
  const supabase = createServerClient(env);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "report") {
    const questionId = String(formData.get("question_id"));
    const reason     = String(formData.get("reason"));
    const note       = String(formData.get("note") ?? "").trim();
    const validReasons = ["error_in_question","bad_image","wrong_answer_key","repeated_question","other"];
    if (!validReasons.includes(reason)) return data({ ok: false, error: "Invalid reason" });
    await supabase.from("question_reports").upsert({
      question_id: questionId,
      reporter_id: user.id,
      reason,
      note: note || null,
    }, { onConflict: "question_id,reporter_id" });
    return data({ ok: true, reported: true });
  }

  if (intent === "answer") {
    const questionId    = String(formData.get("question_id"));
    const answer        = String(formData.get("answer"));
    const correctAnswer = String(formData.get("correct_answer"));
    const timeTaken     = parseInt(String(formData.get("time_taken_secs") ?? "0"), 10) || null;
    const norm = (v: string) => { try { const p = JSON.parse(v); return Array.isArray(p) ? p[0] : String(p); } catch { return v; } };
    const isCorrect = norm(answer).toUpperCase().trim() === norm(correctAnswer).toUpperCase().trim();

    const answerRow = {
      user_id:         user.id,
      question_id:     questionId,
      answer:          JSON.stringify(answer),
      is_correct:      isCorrect,
      answered_at:     new Date().toISOString(),
      time_taken_secs: timeTaken,
    };

    if (isCorrect) {
      // Correct answer — always save, marks question as solved
      await supabase.from("feed_answers").upsert(answerRow, { onConflict: "user_id,question_id" });
    } else {
      // Wrong answer — only insert if no row exists yet; never overwrite a correct answer
      await supabase.from("feed_answers").upsert(answerRow, { onConflict: "user_id,question_id", ignoreDuplicates: true });
    }

    const { data: allAnswers } = await supabase
      .from("feed_answers")
      .select("is_correct")
      .eq("question_id", questionId);

    const total   = allAnswers?.length ?? 1;
    const correct = allAnswers?.filter((a: any) => a.is_correct).length ?? 0;

    return data({ ok: true, isCorrect, pctCorrect: Math.round((correct / total) * 100) });
  }

  if (intent === "solid") {
    const questionId = String(formData.get("question_id"));
    const { data: existing } = await supabase
      .from("solids")
      .select("user_id")
      .eq("user_id", user.id)
      .eq("question_id", questionId)
      .maybeSingle();

    if (existing) {
      await supabase.from("solids").delete()
        .eq("user_id", user.id).eq("question_id", questionId);
    } else {
      await supabase.from("solids").insert({ user_id: user.id, question_id: questionId });
    }
    return data({ ok: true });
  }

  if (intent === "get_comments") {
    const questionId = String(formData.get("question_id"));
    const [commentsRes, avgTimeRes, reportCountRes, myReportRes] = await Promise.all([
      supabase
        .from("comments")
        .select("id, body, created_at, author_id, users!author_id(display_name, username)")
        .eq("question_id", questionId)
        .is("parent_id", null)
        .order("created_at", { ascending: true })
        .limit(30),
      supabase
        .from("feed_answers")
        .select("time_taken_secs")
        .eq("question_id", questionId)
        .not("time_taken_secs", "is", null),
      supabase
        .from("question_reports")
        .select("id", { count: "exact" })
        .eq("question_id", questionId),
      supabase
        .from("question_reports")
        .select("reason")
        .eq("question_id", questionId)
        .eq("reporter_id", user.id)
        .maybeSingle(),
    ]);
    const times = (avgTimeRes.data ?? []).map((r: any) => r.time_taken_secs as number).filter(Boolean);
    const avgTime = times.length > 0 ? Math.round(times.reduce((s: number, n: number) => s + n, 0) / times.length) : null;
    return data({ comments: commentsRes.data ?? [], avgTime, reportCount: reportCountRes.count ?? 0, myReport: myReportRes.data?.reason ?? null });
  }

  if (intent === "post_comment") {
    const questionId = String(formData.get("question_id"));
    const body = String(formData.get("body")).trim();
    if (body.length > 0 && body.length <= 1000) {
      await supabase.from("comments").insert({
        author_id: user.id,
        question_id: questionId,
        body,
      });
    }
    const { data: comments } = await supabase
      .from("comments")
      .select("id, body, created_at, author_id, users!author_id(display_name, username)")
      .eq("question_id", questionId)
      .is("parent_id", null)
      .order("created_at", { ascending: true })
      .limit(30);
    return data({ comments: comments ?? [] });
  }

  return data({ ok: false });
}

export default function FeedActions() {
  return null;
}
