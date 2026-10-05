import { solveWithDeepSeek, solverResultSchema } from "./solverAgent.js";

export function hasAnswer(answer) {
  if (answer == null) return false;
  if (typeof answer === "boolean") return true;
  if (Array.isArray(answer)) return answer.some((value) => String(value).trim().length > 0);
  return String(answer).trim().length > 0;
}

export class SolverTaskError extends Error {
  constructor(code, message, details = false) {
    super(message);
    this.name = "SolverTaskError";
    this.code = code;
    const normalized = typeof details === "boolean" ? { retryable: details } : details;
    this.retryable = Boolean(normalized.retryable);
    this.diagnostic = {
      httpStatus: normalized.httpStatus ?? null,
      apiType: normalized.apiType ?? null,
      apiCode: normalized.apiCode ?? null,
      requestId: normalized.requestId ?? null,
      retryAfterSeconds: normalized.retryAfterSeconds ?? null,
      reachedDeepSeek: normalized.reachedDeepSeek ?? null,
    };
  }
}

function redactSensitiveText(value) {
  return String(value)
    .replace(/\b(?:https?|socks5?h?):\/\/[^\s]+/gi, "[redacted-url]")
    .replace(/\bsk-[A-Za-z0-9_-]+/g, "[redacted-key]")
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]");
}

function errorChain(error) {
  const chain = [];
  const seen = new Set();
  let current = error;
  while (current && (typeof current === "object" || typeof current === "function") && chain.length < 8 && !seen.has(current)) {
    chain.push(current);
    seen.add(current);
    current = current.cause;
  }
  return chain;
}

function firstValue(chain, getter) {
  for (const item of chain) {
    const value = getter(item);
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return null;
}

function safeHeader(chain, name) {
  return firstValue(chain, (item) => {
    try {
      return item?.headers?.get?.(name);
    } catch {
      return null;
    }
  });
}

function normalizeDiagnostic(error) {
  const chain = errorChain(error);
  const statusValue = firstValue(chain, (item) => item?.status ?? item?.error?.status);
  const parsedStatus = Number(statusValue);
  const httpStatus = Number.isFinite(parsedStatus) && parsedStatus > 0 ? parsedStatus : null;
  const apiType = firstValue(chain, (item) => item?.type ?? item?.error?.type);
  const apiCode = firstValue(chain, (item) => item?.code ?? item?.error?.code);
  const rawRequestId = firstValue(chain, (item) => item?.requestID ?? item?.requestId ?? item?.request_id)
    ?? safeHeader(chain, "x-request-id");
  const rawRetryAfter = safeHeader(chain, "retry-after");
  const retryAfterNumber = Number(rawRetryAfter);
  return {
    httpStatus,
    apiType: apiType == null ? null : redactSensitiveText(apiType).slice(0, 100),
    apiCode: apiCode == null ? null : redactSensitiveText(apiCode).slice(0, 100),
    requestId: rawRequestId == null ? null : String(rawRequestId).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 128) || null,
    retryAfterSeconds: Number.isFinite(retryAfterNumber) && retryAfterNumber >= 0 ? retryAfterNumber : null,
    reachedDeepSeek: httpStatus !== null || rawRequestId != null ? true : null,
  };
}

function solverError(code, message, retryable, diagnostic, overrides = {}) {
  return new SolverTaskError(code, message, {
    ...diagnostic,
    ...overrides,
    retryable,
  });
}

export function classifySolverError(error, didTimeout = false) {
  if (error instanceof SolverTaskError) return error;
  const chain = errorChain(error);
  const name = chain.map((item) => String(item?.name ?? item?.constructor?.name ?? "")).join(" ");
  const message = redactSensitiveText(firstValue(chain, (item) => item?.message) ?? error ?? "AI solve failed");
  const diagnostic = normalizeDiagnostic(error);
  const status = diagnostic.httpStatus;
  const apiCode = String(diagnostic.apiCode ?? "").toLowerCase();
  const apiType = String(diagnostic.apiType ?? "").toLowerCase();
  const fingerprint = `${name} ${apiCode} ${apiType} ${message}`;

  const quotaCodes = new Set([
    "insufficient_quota",
    "credit_balance_exhausted",
    "organization_spend_limit_exceeded",
    "project_spend_limit_exceeded",
    "organization_usage_limit_exceeded",
    "billing_hard_limit_reached",
    "usage_limit_reached",
  ]);
  const temporaryRateCodes = new Set(["rate_limit_exceeded", "slow_down"]);

  if (didTimeout || /timeout|timed out|abort/i.test(fingerprint)) {
    return solverError("MODEL_TIMEOUT", "模型请求超时", true, diagnostic, { reachedDeepSeek: diagnostic.reachedDeepSeek ?? false });
  }
  if (name.includes("ModelBehaviorError") || name.includes("ZodError")
    || /empty_model_output|invalid_model_json/i.test(apiCode)
    || /structured|schema|invalid.*output|空内容|json 无法解析/i.test(message)) {
    return solverError("INVALID_MODEL_OUTPUT", "模型返回结果不符合题目答案结构", false, diagnostic, { reachedDeepSeek: true });
  }

  if (status === 402 || quotaCodes.has(apiCode) || quotaCodes.has(apiType)
    || /insufficient_quota|credit_balance_exhausted|spend_limit_exceeded|usage_limit_exceeded|billing_hard_limit/i.test(fingerprint)) {
    return solverError("QUOTA_EXHAUSTED", "DeepSeek API 额度、余额或消费上限不足", false, diagnostic, { reachedDeepSeek: true });
  }
  if (temporaryRateCodes.has(apiCode) || temporaryRateCodes.has(apiType)) {
    return solverError("RATE_LIMITED", "DeepSeek API 暂时达到速率限制", true, diagnostic, { reachedDeepSeek: true });
  }
  if (status === 429) {
    return solverError("RATE_LIMITED", "DeepSeek API 暂时达到速率限制", true, diagnostic, { reachedDeepSeek: true });
  }
  if (status === 401 || /invalid_api_key|authentication_error|incorrect api key/i.test(fingerprint)) {
    return solverError("DEEPSEEK_AUTH_ERROR", "DeepSeek API Key 无效、已撤销或认证失败", false, diagnostic, { reachedDeepSeek: true });
  }
  if (status === 403 || /permission_denied|model.*permission|access.*denied/i.test(fingerprint)) {
    return solverError("MODEL_PERMISSION_DENIED", "DeepSeek API Key 没有执行该模型请求的权限", false, diagnostic, { reachedDeepSeek: true });
  }
  if (status === 404 && /model|not_found/i.test(fingerprint)) {
    return solverError("MODEL_NOT_FOUND_OR_DENIED", "配置的 DeepSeek 模型不存在，或当前账号无权使用", false, diagnostic, { reachedDeepSeek: true });
  }
  if (status === 400 || status === 422 || /invalid_request_error/i.test(apiType)) {
    return solverError("DEEPSEEK_BAD_REQUEST", "DeepSeek 拒绝了模型请求参数", false, diagnostic, { reachedDeepSeek: true });
  }
  if (status != null && status >= 500) {
    return solverError("MODEL_UNAVAILABLE", `DeepSeek API 暂时不可用（HTTP ${status}）`, true, diagnostic, { reachedDeepSeek: true });
  }
  if (/connection|fetch failed|network|econn|enotfound|socket/i.test(fingerprint)) {
    return solverError("MODEL_CONNECTION_ERROR", "无法连接 DeepSeek API", true, diagnostic, { reachedDeepSeek: false });
  }
  return solverError("MODEL_REQUEST_FAILED", message.slice(0, 300), false, diagnostic);
}

const GLOBAL_STOP_CODES = new Set([
  "QUOTA_EXHAUSTED",
  "RATE_LIMIT_UNKNOWN",
  "DEEPSEEK_AUTH_ERROR",
  "MODEL_PERMISSION_DENIED",
  "MODEL_NOT_FOUND_OR_DENIED",
  "DEEPSEEK_BAD_REQUEST",
]);

export function shouldStopSolverQueue(error) {
  return GLOBAL_STOP_CODES.has(error?.code);
}

function serializeSolverError(error, id) {
  return {
    id,
    code: error.code,
    reason: error.message,
    retryable: error.retryable,
    diagnostic: error.diagnostic,
  };
}

function normalizeChoice(value) {
  return typeof value === "string" ? value.trim().toUpperCase() : value;
}

export function validateSolvedAnswer(question, solved) {
  const optionIds = new Set((question.options ?? []).map((option) => String(option.id).trim().toUpperCase()));
  if (solved.answer === null) {
    return { ...solved, needsReview: true, confidence: Math.min(solved.confidence, 0.5) };
  }

  if (question.type === "single") {
    const answer = normalizeChoice(solved.answer);
    if (typeof answer !== "string" || !answer || optionIds.size > 0 && !optionIds.has(answer)) {
      throw new SolverTaskError("INVALID_MODEL_OUTPUT", "单选题答案必须是现有选项编号", false);
    }
    return { ...solved, answer };
  }
  if (question.type === "multiple") {
    if (!Array.isArray(solved.answer) || solved.answer.length === 0) {
      throw new SolverTaskError("INVALID_MODEL_OUTPUT", "多选题答案必须是非空选项数组", false);
    }
    const answer = [...new Set(solved.answer.map(normalizeChoice))];
    if (answer.some((item) => typeof item !== "string" || !item || optionIds.size > 0 && !optionIds.has(item))) {
      throw new SolverTaskError("INVALID_MODEL_OUTPUT", "多选题答案包含不存在的选项编号", false);
    }
    return { ...solved, answer };
  }
  if (question.type === "true_false") {
    if (typeof solved.answer !== "boolean") {
      throw new SolverTaskError("INVALID_MODEL_OUTPUT", "判断题答案必须是 true 或 false", false);
    }
    return solved;
  }
  if (typeof solved.answer !== "string" || !solved.answer.trim()) {
    throw new SolverTaskError("INVALID_MODEL_OUTPUT", "填空题或简答题答案必须是非空文本", false);
  }
  return { ...solved, answer: solved.answer.trim() };
}

function wait(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

export async function solveQuestionWithDeepSeek(question, options = {}) {
  if (hasAnswer(question.answer)) return question;
  const timeoutMs = options.timeoutMs ?? 30_000;
  const maxRetries = options.maxRetries ?? 2;
  const retryDelayMs = options.retryDelayMs ?? 500;
  const solveModel = options.solveModel ?? ((input, signal) => solveWithDeepSeek(input, {
    client: options.client,
    signal,
  }));
  let lastError;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const controller = new AbortController();
    let didTimeout = false;
    const timeout = setTimeout(() => {
      didTimeout = true;
      controller.abort(new Error("AI solve timeout"));
    }, timeoutMs);
    try {
      const solved = validateSolvedAnswer(
        question,
        solverResultSchema.parse(await solveModel(question, controller.signal)),
      );
      const usage = solved.usage ?? { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
      const normalizedResult = solved.answer === null ? {
        ...question,
        answer: null,
        explanation: solved.explanation,
        knowledgePoints: solved.knowledgePoints,
        optionExplanations: solved.optionExplanations,
        relatedQuestions: solved.relatedQuestions,
        answerSource: "missing",
        confidence: solved.confidence,
        needsReview: true,
      } : {
        ...question,
        answer: solved.answer,
        explanation: solved.explanation,
        knowledgePoints: solved.knowledgePoints,
        optionExplanations: solved.optionExplanations,
        relatedQuestions: solved.relatedQuestions,
        answerSource: "ai",
        confidence: solved.confidence,
        needsReview: solved.needsReview || solved.confidence < 0.8,
      };
      return {
        ...normalizedResult,
        usage: {
          promptTokens: Number(usage.promptTokens ?? usage.prompt_tokens ?? 0),
          completionTokens: Number(usage.completionTokens ?? usage.completion_tokens ?? 0),
          totalTokens: Number(usage.totalTokens ?? usage.total_tokens ?? 0),
        },
      };
    } catch (error) {
      lastError = classifySolverError(error, didTimeout);
      if (attempt < maxRetries && lastError.retryable) await wait(retryDelayMs * 2 ** attempt);
      else break;
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError instanceof Error ? lastError : new SolverTaskError("MODEL_REQUEST_FAILED", "AI solve failed");
}

export async function solveMissingQuestions(questions, options = {}) {
  const batchSize = Math.max(1, Math.min(options.batchSize ?? 10, 20));
  const concurrency = Math.max(1, Math.min(options.concurrency ?? 3, 5));
  const solveOne = options.solveOne ?? ((question) => solveQuestionWithDeepSeek(question, options));
  const output = questions.map((question) => ({ ...question }));
  const candidateIndexes = output
    .map((question, index) => hasAnswer(question.answer) ? -1 : index)
    .filter((index) => index >= 0);
  const errors = [];
  let aiFailures = 0;
  let attempted = 0;
  let halted = null;
  const usageTotals = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

  for (let start = 0; start < candidateIndexes.length; start += batchSize) {
    const batch = candidateIndexes.slice(start, start + batchSize);
    let cursor = 0;
    async function worker() {
      while (cursor < batch.length && !halted) {
        const index = batch[cursor];
        cursor += 1;
        try {
          // 再检查一次，确保已有答案永远不会被 AI 覆盖。
          if (!hasAnswer(output[index].answer)) {
            attempted += 1;
            output[index] = await solveOne(output[index]);
            const usage = output[index].usage ?? {};
            usageTotals.promptTokens += Number(usage.promptTokens ?? usage.prompt_tokens ?? 0);
            usageTotals.completionTokens += Number(usage.completionTokens ?? usage.completion_tokens ?? 0);
            usageTotals.totalTokens += Number(usage.totalTokens ?? usage.total_tokens ?? 0);
          }
          if (!hasAnswer(output[index].answer)) {
            aiFailures += 1;
            errors.push({
              id: output[index].id,
              code: "NO_RELIABLE_ANSWER",
              reason: "题目信息不足或存在歧义，AI 未给出可靠答案",
              retryable: false,
              diagnostic: null,
            });
          }
        } catch (error) {
          const classified = classifySolverError(error);
          aiFailures += 1;
          output[index] = {
            ...output[index],
            answer: null,
            answerSource: "missing",
            confidence: null,
            needsReview: true,
          };
          const serialized = serializeSolverError(classified, output[index].id);
          errors.push(serialized);
          if (shouldStopSolverQueue(classified)) halted = serialized;
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, batch.length) }, () => worker()));
    if (halted) break;
  }

  return {
    questions: output,
    errors,
    halted,
    usage: {
      promptTokens: usageTotals.promptTokens,
      completionTokens: usageTotals.completionTokens,
      totalTokens: usageTotals.totalTokens,
    },
    stats: {
      total: output.length,
      attempted,
      sourceAnswers: output.filter((question) => question.answerSource === "source").length,
      aiAnswers: output.filter((question) => question.answerSource === "ai").length,
      aiFailures,
      missingAnswers: output.filter((question) => !hasAnswer(question.answer)).length,
      needsReview: output.filter((question) => question.needsReview).length,
    },
  };
}
