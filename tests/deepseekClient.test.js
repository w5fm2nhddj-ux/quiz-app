import assert from "node:assert/strict";
import { DEEPSEEK_BASE_URL, DEEPSEEK_MODEL, parseJsonContent } from "../agents/deepseekClient.js";
import { solveWithDeepSeek } from "../agents/solverAgent.js";
import { classifyDeepSeekHealthResponse } from "../server/deepSeekHealth.js";
import { answerWithQuestionBankPriority } from "../agents/mainAgent.js";

assert.equal(DEEPSEEK_BASE_URL, "https://api.deepseek.com");
assert.equal(DEEPSEEK_MODEL, "deepseek-flash");
assert.deepEqual(parseJsonContent("```json\n{\"answer\":\"B\"}\n```"), { answer: "B" });
assert.throws(() => parseJsonContent(""), (error) => error.code === "EMPTY_MODEL_OUTPUT");
assert.throws(() => parseJsonContent("not json"), (error) => error.code === "INVALID_MODEL_JSON");

let request;
const mockClient = {
  chat: {
    completions: {
      async create(input) {
        request = input;
        return {
          choices: [{
            message: {
              content: JSON.stringify({
                answer: "B",
                explanation: "股指期货是金融衍生品。",
                knowledgePoints: ["股指期货", "金融衍生品"],
                optionExplanations: [
                  { optionId: "A", explanation: "股票是基础证券，不是本题答案。" },
                  { optionId: "B", explanation: "股指期货属于金融衍生品。" },
                ],
                relatedQuestions: [{
                  question: "期权属于哪类工具？",
                  answer: "金融衍生品",
                  explanation: "期权属于衍生金融工具。",
                }],
                confidence: 0.95,
                needsReview: false,
              }),
            },
          }],
        };
      },
    },
  },
};

const solved = await solveWithDeepSeek({
  question: "股指期货属于以下哪类金融工具？",
  type: "single",
  options: [{ id: "A", text: "股票" }, { id: "B", text: "金融衍生品" }],
  source: "mock",
}, { client: mockClient });

assert.equal(request.model, "deepseek-flash");
assert.deepEqual(request.response_format, { type: "json_object" });
assert.equal(solved.answer, "B");
assert.equal(solved.optionExplanations.length, 2);
assert.equal(solved.relatedQuestions.length, 1);

const authHealth = await classifyDeepSeekHealthResponse(new Response(JSON.stringify({
  error: { type: "authentication_error", code: "invalid_api_key", message: "bad key" },
}), {
  status: 401,
  headers: { "Content-Type": "application/json", "x-request-id": "req_mock_auth" },
}), { enabled: false });
assert.equal(authHealth.code, "DEEPSEEK_AUTH_ERROR");
assert.equal(authHealth.diagnostic.reachedDeepSeek, true);
assert.equal(authHealth.diagnostic.requestId, "req_mock_auth");

let priorityCalls = 0;
const localFirst = await answerWithQuestionBankPriority(
  { question: "题库已有答案？", answer: null },
  [{ question: "题库已有答案？", answer: "A", explanation: "本地解析" }],
  { solveQuestion: async () => { priorityCalls += 1; } },
);
assert.equal(priorityCalls, 0, "题库已有答案时不得调用 DeepSeek");
assert.equal(localFirst.question.answer, "A");

const missingLocal = await answerWithQuestionBankPriority(
  { question: "题库缺答案？", answer: null },
  [{ question: "题库缺答案？", answer: null }],
  {
    async solveQuestion(question) {
      priorityCalls += 1;
      return { ...question, answer: "B", explanation: "mock", knowledgePoints: [], relatedQuestions: [], confidence: 0.9, needsReview: false };
    },
  },
);
assert.equal(missingLocal.answerSource, "ai");
assert.equal(priorityCalls, 1, "题库命中但缺答案时必须调用 DeepSeek");

const notFound = await answerWithQuestionBankPriority(
  { question: "题库里完全没有的题", answer: null },
  [],
  {
    async solveQuestion(question) {
      priorityCalls += 1;
      return { ...question, answer: "参考答案", explanation: "mock", knowledgePoints: [], relatedQuestions: [], confidence: 0.85, needsReview: false };
    },
  },
);
assert.equal(notFound.matchedLocalBank, false);
assert.equal(notFound.answerSource, "ai");
assert.equal(priorityCalls, 2, "题库未命中时必须调用 DeepSeek");

console.log("DeepSeek client tests passed: configuration, JSON parsing and structured answer output verified.");
