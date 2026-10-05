import type { ImportedAnswer, ImportedQuestion } from "@/importers";
import {
  isAiCompletionEnabled,
  solveMissingAnswers,
  type SolverResponse,
} from "@/lib/aiSolverClient";
import {
  questionBankRepository,
  type QuestionBankRepository,
} from "@/lib/questionBankRepository";
import type { Question, QuestionBank } from "@/types/quiz";

type SolveMissing = (
  questions: ImportedQuestion[],
  options: { limit: number; batchSize: number },
) => Promise<SolverResponse>;

export type CompleteQuestionResult = {
  bank: QuestionBank;
  question: Question;
  aiRequested: boolean;
  saved: boolean;
};

export function questionHasAnswer(question: Pick<Question, "answer">) {
  return question.answer.some((value) => String(value).trim().length > 0);
}

function toImportedQuestion(question: Question): ImportedQuestion {
  const typeMap: Record<Question["type"], ImportedQuestion["type"]> = {
    single: "single",
    multiple: "multiple",
    boolean: "true_false",
    fill: "fill",
    short: "short_answer",
  };
  return {
    ...question,
    type: typeMap[question.type],
    answer: null,
    difficulty: question.difficulty || null,
    answerSource: "missing",
    confidence: null,
    needsReview: true,
    parseWarnings: [],
  };
}

function toQuestionAnswer(answer: ImportedAnswer) {
  if (answer === null) return [];
  if (typeof answer === "boolean") return [answer ? "A" : "B"];
  const values = Array.isArray(answer) ? answer : [answer];
  return values.map((value) => String(value).trim()).filter(Boolean);
}

function findQuestion(bank: QuestionBank, questionId: string) {
  const question = bank.questions.find((item) => item.id === questionId);
  if (!question) throw new Error("没有找到需要补全答案的题目。");
  return question;
}

// 始终从仓库读取最新数据：先跳过已有答案，AI 返回后再检查一次，避免覆盖导入答案或人工答案。
export async function completeMissingQuestionAnswer(
  bankId: string,
  questionId: string,
  dependencies: {
    repository?: QuestionBankRepository;
    solve?: SolveMissing;
    now?: () => string;
  } = {},
): Promise<CompleteQuestionResult> {
  const repository = dependencies.repository ?? questionBankRepository;
  const solve = dependencies.solve ?? solveMissingAnswers;
  const currentBank = repository.getById(bankId);
  if (!currentBank) throw new Error("没有找到当前题库。");

  const currentQuestion = findQuestion(currentBank, questionId);
  if (questionHasAnswer(currentQuestion)) {
    return { bank: currentBank, question: currentQuestion, aiRequested: false, saved: false };
  }

  const explicitSolve = dependencies.solve ?? null;
  if (!isAiCompletionEnabled() && !explicitSolve) {
    return { bank: currentBank, question: currentQuestion, aiRequested: false, saved: false };
  }

  const result = await solve([toImportedQuestion(currentQuestion)], { limit: 1, batchSize: 1 });
  const solved = result.questions[0];
  const solvedAnswer = solved ? toQuestionAnswer(solved.answer) : [];
  if (!solved || solvedAnswer.length === 0) {
    throw new Error(result.errors[0]?.reason || "DeepSeek 没有返回可靠答案，请稍后重试或人工补充。");
  }

  // 模型请求期间用户可能已经人工填写答案，所以写入前必须重新读取并再次保护。
  const latestBank = repository.getById(bankId);
  if (!latestBank) throw new Error("当前题库已不存在，AI 答案未保存。");
  const latestQuestion = findQuestion(latestBank, questionId);
  if (questionHasAnswer(latestQuestion)) {
    return { bank: latestBank, question: latestQuestion, aiRequested: true, saved: false };
  }

  const updatedQuestion: Question = {
    ...latestQuestion,
    answer: solvedAnswer,
    explanation: solved.explanation,
    knowledgePoints: solved.knowledgePoints,
    optionExplanations: solved.optionExplanations,
    relatedQuestions: solved.relatedQuestions,
    answerSource: "ai",
    confidence: solved.confidence,
    needsReview: solved.needsReview,
  };
  const nextBank: QuestionBank = {
    ...latestBank,
    updatedAt: (dependencies.now ?? (() => new Date().toISOString()))(),
    questions: latestBank.questions.map((question) =>
      question.id === questionId ? updatedQuestion : question,
    ),
  };
  repository.save(nextBank);
  return { bank: nextBank, question: updatedQuestion, aiRequested: true, saved: true };
}
