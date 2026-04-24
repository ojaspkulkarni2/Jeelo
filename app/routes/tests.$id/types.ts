import type { QuestionType, Subject, ExamType } from "~/lib/database.types";

export type QuestionRow = {
  id: string;
  image_url: string;
  type: QuestionType;
  subject: Subject;
  chapter: string;
};

export type SectionQuestion = QuestionRow & { display_order: number };

export type Section = {
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

export type Test = {
  id: string;
  title: string;
  description: string | null;
  duration_mins: number;
  is_published: boolean;
  exam_type: ExamType;
};
