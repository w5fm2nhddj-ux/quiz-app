import assert from "node:assert/strict";
import {
  solveMissingQuestions,
  solveQuestionWithDeepSeek,
  SolverTaskError,
  classifySolverError,
  hasAnswer,
  validateSolvedAnswer,
} from "../agents/solveMissingQuestions.js";

const questions = [
  { id: "1", question: "已有答案 1", type: "single", options: [], answer: "A", answerSource: "source", needsReview: false },
  { id: "2", question: "已有答案 2", type: "multiple", options: [], answer: ["A", "C"], answerSource: "source", needsReview: false },
  { id: "3", question: "缺答案 1", type: "single", options: [], answer: null, answerSource: "missing", needsReview: true },
  { id: "4", question: "缺答案 2", type: "single", options: [], answer: null, answerSource: "missing", needsReview: true },
];

assert.equal(hasAnswer("   "), false, "全空格答案必须进入补全队列");
assert.equal(hasAnswer(["", "   "]), false, "只含空字符串的答案数组必须进入补全队列");
assert.equal(hasAnswer(false), true, "判断题 false 是有效答案，不能进入补全队列");

let active = 0;
let maxActive = 0;
let calls = 0;
const queued = await solveMissingQuestions(questions, {
  batchSize: 10,
  concurrency: 2,
  async solveOne(question) {
    calls += 1;
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, 10));
    active -= 1;
    if (question.id === "4") throw new Error("simulated failure");
    return { ...question, answer: "B", answerSource: "ai", confidence: 0.9, needsReview: false };
  },
});

assert.equal(calls, 2, "只能调用缺答案题");
assert.ok(maxActive <= 2, "并发数不能超过设置值");
assert.equal(queued.questions[0].answer, "A", "不得覆盖原题答案");
assert.deepEqual(queued.questions[1].answer, ["A", "C"], "不得覆盖原题多选答案");
assert.equal(queued.questions[2].answerSource, "ai");
assert.equal(queued.questions[3].answer, null, "AI 失败仍保留题目");
assert.equal(queued.questions[3].answerSource, "missing");
assert.equal(queued.stats.sourceAnswers, 2);
assert.equal(queued.stats.aiAnswers, 1);
assert.equal(queued.stats.aiFailures, 1);
assert.equal(queued.stats.missingAnswers, 1);

let retryCalls = 0;
const retried = await solveQuestionWithDeepSeek(
  { id: "5", question: "重试题", type: "single", options: [], answer: null, answerSource: "missing" },
  {
    maxRetries: 2,
    retryDelayMs: 1,
    async solveModel() {
      retryCalls += 1;
      if (retryCalls < 3) throw new SolverTaskError("MODEL_CONNECTION_ERROR", "temporary connection error", true);
      return {
        answer: "C",
        explanation: "测试解析",
        knowledgePoints: ["测试"],
        relatedQuestions: [],
        confidence: 0.79,
        needsReview: false,
      };
    },
  },
);

assert.equal(retryCalls, 3, "首次失败后应最多重试两次");
assert.equal(retried.answer, "C");
assert.equal(retried.needsReview, true, "置信度低于 0.8 必须人工确认");

assert.throws(
  () => validateSolvedAnswer(
    { type: "single", options: [{ id: "A", text: "甲" }, { id: "B", text: "乙" }] },
    { answer: "C", explanation: "", knowledgePoints: [], confidence: 0.9, needsReview: false },
  ),
  (error) => error instanceof SolverTaskError && error.code === "INVALID_MODEL_OUTPUT",
  "单选答案不能引用不存在的选项",
);

const uncertain = validateSolvedAnswer(
  { type: "short_answer", options: [] },
  { answer: null, explanation: "题目信息不足", knowledgePoints: [], confidence: 0.9, needsReview: false },
);
assert.equal(uncertain.answer, null);
assert.equal(uncertain.needsReview, true, "无法可靠作答时必须人工确认");
assert.equal(uncertain.confidence, 0.5, "无法可靠作答时置信度上限为 0.5");

const redacted = classifySolverError(new Error("proxy http://user:secret@127.0.0.1:7890 failed with sk-sensitive"));
assert.equal(redacted.message.includes("secret"), false, "错误信息不能泄露代理密码");
assert.equal(redacted.message.includes("sk-sensitive"), false, "错误信息不能泄露 API Key");

const quotaError = classifySolverError({
  name: "RateLimitError",
  status: 429,
  type: "insufficient_quota",
  code: "credit_balance_exhausted",
  requestID: "req_safe_123",
  headers: new Headers({ "retry-after": "60" }),
  message: "balance exhausted",
});
assert.equal(quotaError.code, "QUOTA_EXHAUSTED");
assert.equal(quotaError.retryable, false, "额度不足不能鼓励重试");
assert.equal(quotaError.diagnostic.httpStatus, 429);
assert.equal(quotaError.diagnostic.requestId, "req_safe_123");
assert.equal(quotaError.diagnostic.reachedDeepSeek, true);

const temporaryRateError = classifySolverError({
  status: 429,
  type: "rate_limit_error",
  code: "rate_limit_exceeded",
  headers: new Headers({ "retry-after": "3" }),
  message: "too many requests",
});
assert.equal(temporaryRateError.code, "RATE_LIMITED");
assert.equal(temporaryRateError.retryable, true);
assert.equal(temporaryRateError.diagnostic.retryAfterSeconds, 3);

const insufficientBalance = classifySolverError({ status: 402, message: "Insufficient Balance" });
assert.equal(insufficientBalance.code, "QUOTA_EXHAUSTED", "DeepSeek HTTP 402 必须识别为余额不足");
assert.equal(insufficientBalance.retryable, false);

let fatalCalls = 0;
const stopped = await solveMissingQuestions([
  { id: "f1", question: "缺答案", type: "single", options: [], answer: null, answerSource: "missing" },
  { id: "f2", question: "缺答案", type: "single", options: [], answer: null, answerSource: "missing" },
  { id: "f3", question: "缺答案", type: "single", options: [], answer: null, answerSource: "missing" },
], {
  concurrency: 1,
  async solveOne() {
    fatalCalls += 1;
    throw quotaError;
  },
});
assert.equal(fatalCalls, 1, "额度等全局错误出现后应停止未开始的题目");
assert.equal(stopped.stats.attempted, 1);
assert.equal(stopped.questions.length, 3, "停止队列不能删除原题");

console.log("Solver queue tests passed: source answers preserved, batching/concurrency/retry/failure handling verified.");
