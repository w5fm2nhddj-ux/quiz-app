import assert from "node:assert/strict";
import type { ImportedQuestion } from "../src/importers/types.ts";
import { questionBankRepository } from "../src/lib/questionBankRepository.ts";
import {
  completeMissingQuestionAnswer,
  questionHasAnswer,
} from "../src/lib/questionAnswerCompletion.ts";
import type { Question, QuestionBank } from "../src/types/quiz.ts";

class MemoryStorage {
  private readonly values = new Map<string, string>();

  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: { localStorage: new MemoryStorage() },
});

function makeQuestion(id: string, answer: string[], answerSource: Question["answerSource"]): Question {
  return {
    id,
    question: id === "source-answer" ? "1 + 1 等于多少？" : "中国的首都是哪里？",
    type: "single",
    options: [
      { id: "A", text: id === "source-answer" ? "2" : "上海" },
      { id: "B", text: id === "source-answer" ? "3" : "北京" },
    ],
    answer,
    explanation: answer.length > 0 ? "原题解析" : "",
    knowledgePoints: [],
    source: "自动化测试",
    difficulty: "easy",
    answerSource,
    confidence: null,
    needsReview: answer.length === 0,
  };
}

const bank: QuestionBank = {
  id: "persistence-flow-bank",
  name: "答案持久化测试",
  subject: "通识",
  source: "自动化测试",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  questions: [
    makeQuestion("source-answer", ["A"], "source"),
    makeQuestion("missing-answer", [], "missing"),
  ],
};

questionBankRepository.save(bank);

let modelCalls = 0;
const solve = async (questions: ImportedQuestion[]) => {
  modelCalls += 1;
  const solved = questions.map((question) => ({
    ...question,
    answer: "B",
    explanation: "北京是中华人民共和国的首都。",
    knowledgePoints: ["中国地理"],
    optionExplanations: [
      { optionId: "A", explanation: "上海不是首都。" },
      { optionId: "B", explanation: "北京是首都。" },
    ],
    relatedQuestions: [],
    answerSource: "ai" as const,
    confidence: 0.98,
    needsReview: false,
  }));
  return {
    questions: solved,
    errors: [],
    stats: {
      attempted: questions.length,
      sourceAnswers: 0,
      aiAnswers: solved.length,
      aiFailures: 0,
      missingAnswers: 0,
      needsReview: 0,
    },
  };
};

// A：题库原本有答案时，模型调用数必须保持为 0，答案和来源都不能被覆盖。
const sourceResult = await completeMissingQuestionAnswer(bank.id, "source-answer", {
  solve,
  now: () => "2026-02-01T00:00:00.000Z",
});
assert.equal(sourceResult.aiRequested, false);
assert.equal(sourceResult.saved, false);
assert.equal(modelCalls, 0);
assert.deepEqual(sourceResult.question.answer, ["A"]);
assert.equal(sourceResult.question.answerSource, "source");

// B：缺答案题只调用一次，结果写回 repository/localStorage。
const solvedResult = await completeMissingQuestionAnswer(bank.id, "missing-answer", {
  solve,
  now: () => "2026-02-01T00:00:00.000Z",
});
assert.equal(solvedResult.aiRequested, true);
assert.equal(solvedResult.saved, true);
assert.equal(modelCalls, 1);
assert.deepEqual(solvedResult.question.answer, ["B"]);
assert.equal(solvedResult.question.answerSource, "ai");

// 模拟刷新页面后重新从持久化仓库读取。
const afterRefresh = questionBankRepository.getById(bank.id);
assert.ok(afterRefresh);
assert.deepEqual(afterRefresh.questions[1].answer, ["B"]);
assert.equal(afterRefresh.questions[1].explanation, "北京是中华人民共和国的首都。");
assert.deepEqual(afterRefresh.questions[1].knowledgePoints, ["中国地理"]);

// 再次打开同一道题时直接复用已保存答案，不产生第二次模型请求。
const reopened = await completeMissingQuestionAnswer(bank.id, "missing-answer", { solve });
assert.equal(reopened.aiRequested, false);
assert.equal(reopened.saved, false);
assert.equal(modelCalls, 1);
assert.deepEqual(reopened.question.answer, ["B"]);

assert.equal(questionHasAnswer(makeQuestion("blank", ["   "], "source")), false);

console.log("Question answer persistence tests passed: source answer skipped AI; missing answer solved once, saved, reloaded and reused.");
