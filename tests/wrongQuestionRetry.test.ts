import assert from "node:assert/strict";
import { resolveWrongPracticeQuestions } from "../src/lib/wrongQuestionTracker.ts";

const bankQuestions = [
  { id: "q-1", question: "一题" },
  { id: "q-2", question: "二题" },
  { id: "q-3", question: "三题" },
];

const wrongRecords = [
  { questionId: "q-1" },
  { questionId: "q-2" },
  { questionId: "q-3" },
];

assert.deepEqual(resolveWrongPracticeQuestions(bankQuestions, wrongRecords, null), ["q-1", "q-2", "q-3"], "默认错题专项需要按错题顺序生成队列");
assert.deepEqual(resolveWrongPracticeQuestions(bankQuestions, wrongRecords, "q-2"), ["q-2"], "点击某道错题时必须精确定位到该题");
assert.deepEqual(resolveWrongPracticeQuestions(bankQuestions, wrongRecords, "missing"), [], "不存在的题目必须返回空结果而不是误打开其他题");

console.log("wrong question retry tests passed: questionId routing and default queue behavior verified.");
