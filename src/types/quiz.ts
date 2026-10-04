export type QuestionType =
  | "single"
  | "multiple"
  | "boolean"
  | "fill"
  | "short";

export type Difficulty = "easy" | "medium" | "hard" | "";

export type QuestionOption = {
  id: string;
  text: string;
};

export type RelatedQuestion = {
  question: string;
  answer: string | string[] | boolean;
  explanation: string;
};

export type OptionExplanation = {
  optionId: string;
  explanation: string;
};

export type Question = {
  id: string;
  question: string;
  type: QuestionType;
  options: QuestionOption[];
  // 统一使用数组：单选题只有一个值，多选题可以有多个值。
  answer: string[];
  explanation: string;
  knowledgePoints: string[];
  optionExplanations?: OptionExplanation[];
  relatedQuestions?: RelatedQuestion[];
  source: string;
  difficulty: Difficulty;
  answerSource?: "source" | "ai" | "manual" | "missing";
  confidence?: number | null;
  needsReview?: boolean;
};

export type QuestionBank = {
  id: string;
  name: string;
  subject: string;
  source: string;
  createdAt: string;
  updatedAt: string;
  questions: Question[];
};

export type QuestionBankDraft = Pick<
  QuestionBank,
  "name" | "subject" | "source" | "questions"
>;
