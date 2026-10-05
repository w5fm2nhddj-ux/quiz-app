import assert from "node:assert/strict";
import {
  buildWrongSessionQuestionIds,
  clearWrongQuestions,
  getWrongQuestions,
  recordWrongQuestion,
  removeWrongQuestion,
} from "../src/lib/wrongQuestionTracker.ts";

const bankId = "bank-session-flow";
const bankQuestions = [
  { id: "q-1", question: "第一题", type: "single" as const, answer: ["A"], source: "mock" },
  { id: "q-2", question: "第二题", type: "single" as const, answer: ["B"], source: "mock" },
  { id: "q-3", question: "第三题", type: "single" as const, answer: ["C"], source: "mock" },
];

clearWrongQuestions(bankId);

recordWrongQuestion(bankId, { ...bankQuestions[0], question: "第一题", type: "single", answer: ["A"], source: "mock" }, ["B"]);
recordWrongQuestion(bankId, { ...bankQuestions[1], question: "第二题", type: "single", answer: ["B"], source: "mock" }, ["A"]);
recordWrongQuestion(bankId, { ...bankQuestions[2], question: "第三题", type: "single", answer: ["C"], source: "mock" }, ["B"]);

const sessionQuestionIds = buildWrongSessionQuestionIds(bankQuestions, getWrongQuestions(bankId));
assert.deepEqual(sessionQuestionIds, ["q-1", "q-2", "q-3"], "错题专项开始时应按当前错题本创建固定会话队列");

let currentIndex = 0;
let selected: string[] = [];
let submitted = false;
let score = 0;

assert.equal(sessionQuestionIds[currentIndex], "q-1", "第一题应先出现");
selected = ["A"];
submitted = true;
if (selected.length > 0 && selected.every((option) => option === "A")) {
  removeWrongQuestion(bankId, sessionQuestionIds[currentIndex]);
  score += 1;
}
assert.deepEqual(sessionQuestionIds, ["q-1", "q-2", "q-3"], "答对后不应改变当前会话快照");
assert.equal(getWrongQuestions(bankId).length, 2, "答对的题应从永久错题本移除");
assert.equal(getWrongQuestions(bankId).some((question) => question.questionId === "q-1"), false, "已答对的题不再保留在错题本");
assert.equal(submitted, true, "提交后一题在点击下一题前不能切换");

currentIndex += 1;
selected = [];
submitted = false;
assert.equal(sessionQuestionIds[currentIndex], "q-2", "点击下一题后才进入下一题");
selected = ["A"];
submitted = true;
if (selected.length > 0 && !selected.every((option) => option === "B")) {
  recordWrongQuestion(bankId, bankQuestions[1], selected);
}
assert.equal(getWrongQuestions(bankId).some((question) => question.questionId === "q-2"), true, "第二题答错仍保留在错题本");

currentIndex += 1;
selected = [];
submitted = false;
assert.equal(sessionQuestionIds[currentIndex], "q-3", "第三题仍在会话快照中");
selected = ["C"];
submitted = true;
if (selected.length > 0 && selected.every((option) => option === "C")) {
  removeWrongQuestion(bankId, sessionQuestionIds[currentIndex]);
  score += 1;
}
assert.equal(score, 2, "连续答对题目应累计分数");
assert.equal(sessionQuestionIds.length, 3, "整轮错题会话不应在答题过程中缩短");
assert.equal(currentIndex < sessionQuestionIds.length, true, "当前索引始终应落在数组范围内");

const nextWrongSession = buildWrongSessionQuestionIds(bankQuestions, getWrongQuestions(bankId));
assert.deepEqual(nextWrongSession, ["q-2"], "再次进入错题专项时，只应出现仍然答错的题");

console.log("wrong session flow tests passed: session snapshot, correct-answer removal, wrong-answer retention, and re-entry behavior verified.");
