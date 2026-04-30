import type { Subject, QuestionType } from "~/lib/database.types";

export type ResultStatus = "correct" | "wrong" | "missed";

export type SectionMeta = {
  id: string;
  name: string;
  subject: Subject;
  question_type: QuestionType;
  marks_correct: number;
  marks_wrong: number;
};

export type SubjectStats = {
  subject: Subject;
  total: number;
  correct: number;
  wrong: number;
  missed: number;
  marks: number;
  positiveMarks: number;
};

export type LeaderboardEntry = {
  student_id: string;
  display_name: string;
  username: string | null;
  score: number;
  max_marks: number;
  correct: number;
  wrong: number;
  missed: number;
  time_taken_seconds: number;
  submitted_at: string;
  is_me: boolean;
};
