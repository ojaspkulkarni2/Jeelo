// Auto-maintained by hand — regenerate with `supabase gen types typescript`
// after running migrations in production.
// Last updated: migration 002 (folders + sharing + role unification)

export type UserRole = "admin" | "student";
export type QuestionType = "scq" | "mcq" | "integer" | "numerical" | "paragraph";
export type Subject = "physics" | "chemistry" | "mathematics";

// Answer shapes per question type
export type ScqAnswer = [string]; // ["A"] | ["B"] | ["C"] | ["D"]
export type McqAnswer = string[]; // ["A","C"] etc — 1 or more
export type IntegerAnswer = number; // whole number
export type NumericalAnswer = number; // decimal
export type CorrectAnswer = ScqAnswer | McqAnswer | IntegerAnswer | NumericalAnswer;

// Per-question state during an attempt
export type QuestionStatus =
  | "not_visited"
  | "not_answered"
  | "answered"
  | "marked"
  | "answered_marked";

export interface QuestionState {
  answer?: CorrectAnswer; // only present if student has saved an answer
  status: QuestionStatus;
}

// The answers jsonb column shape: { [question_id: string]: QuestionState }
export type AttemptAnswers = Record<string, QuestionState>;

// Score breakdown written on submit
export interface SectionBreakdown {
  section_id: string;
  section_name: string;
  marks: number;
  correct: number;
  wrong: number;
  unattempted: number;
  partial: number;
}

export interface ScoreBreakdown {
  total: number;
  max_marks: number;
  sections: SectionBreakdown[];
  time_taken_seconds: number;
}

// ── Table row types ───────────────────────────────────────────

export interface Database {
  public: {
    Tables: {
      users: {
        Row: {
          id: string;
          role: UserRole;
          display_name: string;
          created_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["users"]["Row"], "created_at">;
        Update: Partial<Database["public"]["Tables"]["users"]["Insert"]>;
      };
      paragraphs: {
        Row: {
          id: string;
          owner_id: string;
          image_url: string;
          title: string | null;
          created_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["paragraphs"]["Row"], "id" | "created_at">;
        Update: Partial<Database["public"]["Tables"]["paragraphs"]["Insert"]>;
      };
      folders: {
        Row: {
          id: string;
          owner_id: string;
          parent_id: string | null;
          name: string;
          created_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["folders"]["Row"], "id" | "created_at">;
        Update: Partial<Database["public"]["Tables"]["folders"]["Insert"]>;
      };
      questions: {
        Row: {
          id: string;
          owner_id: string;
          image_url: string;
          type: QuestionType;
          subject: Subject;
          chapter: string;
          correct_answer: CorrectAnswer;
          paragraph_id: string | null;
          folder_id: string | null;
          is_shared: boolean;
          created_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["questions"]["Row"], "id" | "created_at">;
        Update: Partial<Database["public"]["Tables"]["questions"]["Insert"]>;
      };
      tests: {
        Row: {
          id: string;
          owner_id: string;
          title: string;
          duration_mins: number;
          is_published: boolean;
          created_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["tests"]["Row"], "id" | "created_at">;
        Update: Partial<Database["public"]["Tables"]["tests"]["Insert"]>;
      };
      test_sections: {
        Row: {
          id: string;
          test_id: string;
          name: string;
          question_type: QuestionType;
          subject: Subject;
          marks_correct: number;
          marks_wrong: number;
          marks_partial: number | null;
          display_order: number;
        };
        Insert: Omit<Database["public"]["Tables"]["test_sections"]["Row"], "id">;
        Update: Partial<Database["public"]["Tables"]["test_sections"]["Insert"]>;
      };
      test_questions: {
        Row: {
          test_section_id: string;
          question_id: string;
          display_order: number;
        };
        Insert: Database["public"]["Tables"]["test_questions"]["Row"];
        Update: Partial<Database["public"]["Tables"]["test_questions"]["Insert"]>;
      };
      attempts: {
        Row: {
          id: string;
          test_id: string;
          student_id: string;
          started_at: string;
          submitted_at: string | null;
          answers: AttemptAnswers;
          score_breakdown: ScoreBreakdown | null;
        };
        Insert: Omit<Database["public"]["Tables"]["attempts"]["Row"], "id" | "started_at">;
        Update: Partial<Database["public"]["Tables"]["attempts"]["Insert"]>;
      };
    };
  };
}
