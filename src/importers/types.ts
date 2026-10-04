export type ImportedQuestionType =
  | "single"
  | "multiple"
  | "true_false"
  | "fill"
  | "short_answer";

export type ImportedDifficulty = "easy" | "medium" | "hard" | null;
export type ImportedAnswer = string | string[] | boolean | null;
export type AnswerSource = "source" | "ai" | "manual" | "missing";

export type ImportedOption = {
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

// 所有 importer 必须输出这个结构，刷题页面不关心原始文件类型。
export type ImportedQuestion = {
  id: string;
  question: string;
  type: ImportedQuestionType;
  options: ImportedOption[];
  answer: ImportedAnswer;
  explanation: string;
  knowledgePoints: string[];
  optionExplanations?: OptionExplanation[];
  relatedQuestions?: RelatedQuestion[];
  source: string;
  difficulty: ImportedDifficulty;
  answerSource: AnswerSource;
  confidence: number | null;
  needsReview: boolean;
  parseWarnings: string[];
};

export type FailedQuestionBlock = {
  index: number;
  marker: string;
  rawText: string;
  reason: string;
};

export type ImportStats = {
  rawTextLength: number;
  processedTextLength: number;
  detectedMarkers: number;
  blocksCreated: number;
  parsedQuestions: number;
  failedBlocks: number;
  sourceAnswers: number;
  aiAnswers: number;
  aiFailures: number;
  missingAnswers: number;
  needsReview: number;
};

export type CanonicalField =
  | "id"
  | "question"
  | "type"
  | "optionA"
  | "optionB"
  | "optionC"
  | "optionD"
  | "optionE"
  | "optionF"
  | "optionG"
  | "optionH"
  | "answer"
  | "explanation"
  | "knowledgePoints"
  | "source"
  | "difficulty";

export type TabularMapping = {
  headers: string[];
  fields: Partial<Record<CanonicalField, string>>;
  uncertainFields: CanonicalField[];
  rows: Record<string, unknown>[];
};

export type ImportResult = {
  success: boolean;
  questions: ImportedQuestion[];
  warnings: string[];
  errors: string[];
  failedBlocks: FailedQuestionBlock[];
  stats: ImportStats;
  total: number;
  suggestedName: string;
  suggestedSubject: string;
  source: string;
  mapping?: TabularMapping;
};

export interface FileImporter {
  extensions: string[];
  import(file: File, source?: string): Promise<ImportResult>;
}

export type ImportPreviewPayload = {
  result: ImportResult;
  originalName: string;
  createdAt: string;
  aiAttempted?: boolean;
};
