import type { QuestionType, QuestionStatus, AttemptAnswers, ScoreBreakdown } from "~/lib/database.types";

export type QuestionRow = {
  id: string;
  image_url: string;
  type: QuestionType;
  subject: string;
  chapter: string;
  correct_answer: unknown;
  paragraph_id: string | null;
  paragraph_image_url: string | null;
};

export type SectionQuestion = QuestionRow & { display_order: number };

export type Section = {
  id: string;
  name: string;
  question_type: QuestionType;
  subject: string;
  marks_correct: number;
  marks_wrong: number;
  marks_partial: number | null;
  display_order: number;
  questions: SectionQuestion[];
};

export type Test = {
  id: string;
  title: string;
  duration_mins: number;
  is_published: boolean;
};

export type Attempt = {
  id: string;
  answers: AttemptAnswers;
  started_at: string;
  submitted_at: string | null;
  score_breakdown: ScoreBreakdown | null;
};
