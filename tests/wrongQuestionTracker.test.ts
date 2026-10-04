import assert from "node:assert/strict";
import {
  clearWrongQuestions,
  getWrongQuestions,
  recordWrongQuestion,
  type WrongQuestionRecord,
} from "../src/lib/wrongQuestionTracker.ts";

const bankId = "bank-1";
const question = {
  id: "q-1",
  question: "2 + 2 = ?",
  type: "single" as const,
  options: [
    { id: "A", text: "3" },
    { id: "B", text: "4" },
  ],
  answer: ["B"],
  explanation: "2 + 2 = 4",
  knowledgePoints: ["基础运算"],
  source: "mock",
  difficulty: "easy" as const,
  answerSource: "source" as const,
  confidence: 1,
};

clearWrongQuestions(bankId);
const before = getWrongQuestions(bankId);
assert.equal(before.length, 0, "空题库的错题本应为空");

recordWrongQuestion(bankId, question, ["A"]);
const wrongList = getWrongQuestions(bankId);
assert.equal(wrongList.length, 1, "答错后应加入错题本");
assert.equal(wrongList[0].questionId, "q-1");
assert.deepEqual(wrongList[0].selectedOptions, ["A"]);
assert.deepEqual(wrongList[0].correctAnswer, ["B"]);

recordWrongQuestion(bankId, question, ["A"]);
assert.equal(getWrongQuestions(bankId).length, 1, "同一道题重复答错应保持单条记录");

const first = getWrongQuestions(bankId)[0] as WrongQuestionRecord;
assert.ok(first.lastAttemptedAt.length > 0, "记录应保留最近尝试时间");

clearWrongQuestions(bankId);
assert.equal(getWrongQuestions(bankId).length, 0, "清空错题本后应为空");

console.log("wrong question tracker tests passed: record, dedupe, and clear operations verified.");
