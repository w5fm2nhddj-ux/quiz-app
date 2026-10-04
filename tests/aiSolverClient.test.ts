import assert from "node:assert/strict";
import {
  hasMissingAnswer,
  isAiCompletionEnabled,
  setAiCompletionEnabled,
  solveMissingAnswers,
  SolverClientError,
  type SolverProgress,
} from "../src/lib/aiSolverClient.ts";
import type { ImportedQuestion } from "../src/importers/types.ts";
import {
  canStartAiCompletion,
  createAiRunLock,
} from "../src/lib/aiCompletionControl.ts";

function question(id: string, answer: ImportedQuestion["answer"], answerSource: ImportedQuestion["answerSource"]): ImportedQuestion {
  return {
    id,
    question: `题目 ${id}`,
    type: "single",
    options: [{ id: "A", text: "甲" }, { id: "B", text: "乙" }],
    answer,
    explanation: "",
    knowledgePoints: [],
    source: "mock",
    difficulty: null,
    answerSource,
    confidence: null,
    needsReview: answer === null,
    parseWarnings: [],
  };
}

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

assert.equal(hasMissingAnswer(question("blank-string", "   ", "source")), true);
assert.equal(hasMissingAnswer(question("blank-array", ["", "   "], "source")), true);
assert.equal(hasMissingAnswer(question("false", false, "source")), false);
assert.equal(isAiCompletionEnabled(), false, "当前离线版必须关闭 AI 自动补全功能");

const offlineResult = await solveMissingAnswers([question("missing", null, "missing")], {
  fetchImpl: async () => { throw new Error("should not fetch when AI is disabled"); },
});
assert.equal(offlineResult.questions[0].answer, null, "离线模式下不得强制调用 AI 或覆盖题目");
assert.deepEqual(offlineResult.errors, [], "离线模式不应该产生 AI 失败错误");

setAiCompletionEnabled(true);
await assert.rejects(
  () => solveMissingAnswers([question("missing", null, "missing")], {
    fetchImpl: async () => { throw new TypeError("Failed to fetch"); },
  }),
  (error) => error instanceof SolverClientError && error.code === "SERVICE_UNAVAILABLE",
  "本地服务拒绝连接时必须返回可区分的错误",
);

await assert.rejects(
  () => solveMissingAnswers([question("missing", null, "missing")], {
    fetchImpl: async () => jsonResponse({ ok: false, code: "DEEPSEEK_API_KEY_MISSING" }, 503),
  }),
  (error) => error instanceof SolverClientError && error.code === "API_KEY_MISSING",
  "API Key 缺失必须与连接失败区分",
);

const healthFailures = [
  { serverCode: "PROXY_UNSUPPORTED", clientCode: "PROXY_CONFIGURATION_ERROR", actionText: "SOCKS" },
  { serverCode: "PROXY_CONNECTION_FAILED", clientCode: "UPSTREAM_UNREACHABLE", actionText: "VPN" },
  { serverCode: "DEEPSEEK_TIMEOUT", clientCode: "MODEL_TIMEOUT", actionText: "小批量" },
  { serverCode: "RATE_LIMITED", clientCode: "RATE_LIMITED", actionText: "限速" },
  { serverCode: "QUOTA_EXHAUSTED", clientCode: "QUOTA_EXHAUSTED", actionText: "反复重试不会恢复" },
] as const;

for (const failure of healthFailures) {
  await assert.rejects(
    () => solveMissingAnswers([question("missing", null, "missing")], {
      fetchImpl: async () => jsonResponse({ ok: false, code: failure.serverCode }, 503),
    }),
    (error) => error instanceof SolverClientError
      && error.code === failure.clientCode
      && error.action.includes(failure.actionText),
    `${failure.serverCode} 必须映射成可操作的前端提示`,
  );
}

const sourceQuestion = question("source", "A", "source");
const missingQuestions = [question("m1", null, "missing"), question("m2", null, "missing"), question("m3", null, "missing")];
const requests: string[][] = [];
const progressUpdates: SolverProgress[] = [];
const mockFetch: typeof fetch = async (input, init) => {
  const url = String(input);
  if (url.endsWith("/health/upstream")) return jsonResponse({ ok: true });
  const body = JSON.parse(String(init?.body)) as { questions: ImportedQuestion[] };
  requests.push(body.questions.map((item) => item.id));
  const solved = body.questions.map((item) => ({
    ...item,
    answer: "B",
    answerSource: "ai",
    confidence: 0.92,
    needsReview: false,
    explanation: "mock answer",
  }));
  return jsonResponse({ questions: solved, errors: [], stats: {} });
};

const trial = await solveMissingAnswers([sourceQuestion, ...missingQuestions], {
  limit: 2,
  batchSize: 1,
  fetchImpl: mockFetch,
  onProgress: (progress) => progressUpdates.push(progress),
});

assert.deepEqual(requests, [["m1"], ["m2"]], "试跑只提交限定数量且按批次发送");
assert.equal(trial.questions[0].answer, "A", "原题答案不得覆盖");
assert.equal(trial.questions[1].answer, "B");
assert.equal(trial.questions[2].answer, "B");
assert.equal(trial.questions[3].answer, null, "未进入本次试跑的题目必须保持缺失");
assert.equal(progressUpdates.at(-1)?.processed, 2);
assert.equal(progressUpdates.at(-1)?.succeeded, 2);

let postCount = 0;
let lastSavedProgress: SolverProgress | null = null;
await assert.rejects(
  () => solveMissingAnswers(missingQuestions, {
    batchSize: 1,
    fetchImpl: async (input, init) => {
      if (String(input).endsWith("/health/upstream")) return jsonResponse({ ok: true });
      postCount += 1;
      if (postCount === 2) throw new TypeError("connection interrupted");
      const body = JSON.parse(String(init?.body)) as { questions: ImportedQuestion[] };
      return jsonResponse({
        questions: body.questions.map((item) => ({ ...item, answer: "A", answerSource: "ai", confidence: 0.9, needsReview: false })),
        errors: [],
        stats: {},
      });
    },
    onProgress: (progress) => { lastSavedProgress = progress; },
  }),
  (error) => error instanceof SolverClientError && error.code === "SERVICE_UNAVAILABLE",
);
assert.equal(lastSavedProgress?.processed, 1, "后续批次断线时，首批进度必须已经交给页面保存");
assert.equal(lastSavedProgress?.questions[0].answer, "A", "后续批次失败不能回滚已完成答案");

assert.equal(canStartAiCompletion("trial", false, false), true, "小批量试跑不需要批量确认");
assert.equal(canStartAiCompletion("batch", true, false), false, "试跑未成功时不得批量处理");
assert.equal(canStartAiCompletion("batch", false, true), false, "批量补全必须明确确认");
assert.equal(canStartAiCompletion("batch", true, true), true);

const runLock = createAiRunLock();
assert.equal(runLock.tryStart(), true);
assert.equal(runLock.tryStart(), false, "处理中重复点击不能启动第二个请求");
runLock.release();
assert.equal(runLock.tryStart(), true, "当前请求结束后才允许重试");
runLock.release();

setAiCompletionEnabled(false);
console.log("AI solver client tests passed: offline default, error classification, trial limits, batching, progress and source-answer protection verified.");
