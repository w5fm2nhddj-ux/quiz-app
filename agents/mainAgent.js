import { parseQuestionsWithDeepSeek } from "./questionAgent.js";
import { solveWithDeepSeek } from "./solverAgent.js";

function hasAnswer(answer) {
  if (answer == null) return false;
  if (typeof answer === "boolean") return true;
  if (Array.isArray(answer)) return answer.some((value) => String(value).trim().length > 0);
  return String(answer).trim().length > 0;
}

function normalizeQuestionText(value) {
  return String(value ?? "").replace(/\s+/g, "").replace(/[？?。.!！]/g, "").toLowerCase();
}

// 通用“题库优先”入口：命中且有答案时零 API 调用；缺答案或未命中时才调用 DeepSeek。
export async function answerWithQuestionBankPriority(inputQuestion, questionBank = [], options = {}) {
  const targetText = normalizeQuestionText(inputQuestion.question);
  const matched = questionBank.find((item) => normalizeQuestionText(item.question) === targetText);
  if (matched && hasAnswer(matched.answer)) {
    return { question: matched, answerSource: "source", matchedLocalBank: true };
  }

  const target = matched ?? inputQuestion;
  const solveQuestion = options.solveQuestion ?? solveWithDeepSeek;
  const solved = await solveQuestion(target, options);
  return {
    question: {
      ...target,
      ...solved,
      answerSource: solved.answer == null ? "missing" : "ai",
      needsReview: solved.needsReview || solved.confidence < 0.8,
    },
    answerSource: solved.answer == null ? "missing" : "ai",
    matchedLocalBank: Boolean(matched),
  };
}

// 保留原来的“主流程”职责，但不再依赖 OpenAI Agents SDK。
export async function processQuizImport(text, options = {}) {
  const parsed = await parseQuestionsWithDeepSeek(text, options);
  const questions = [];

  for (const question of parsed.questions) {
    // 题库原答案优先，只有缺答案题才调用 DeepSeek。
    if (hasAnswer(question.answer)) {
      questions.push(question);
      continue;
    }
    try {
      const solveQuestion = options.solveQuestion ?? solveWithDeepSeek;
      const solved = await solveQuestion(question, options);
      questions.push({
        ...question,
        answer: solved.answer,
        explanation: solved.explanation,
        knowledgePoints: solved.knowledgePoints,
        optionExplanations: solved.optionExplanations,
        relatedQuestions: solved.relatedQuestions,
        answerSource: solved.answer == null ? "missing" : "ai",
        confidence: solved.confidence,
        needsReview: solved.needsReview || solved.confidence < 0.8,
      });
    } catch {
      questions.push({ ...question, answer: null, answerSource: "missing", needsReview: true });
    }
  }

  return { questions };
}
