import { createServer, setGlobalProxyFromEnv } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { solveMissingQuestions } from "../agents/solveMissingQuestions.js";
import { configureProxyFromEnv } from "./proxyConfig.js";
import { classifyDeepSeekHealthResponse } from "./deepSeekHealth.js";
import { createDeepSeekEnvironmentLoader } from "./envConfig.js";
import { createQuestionAnswerCacheRepository, solveQuestionsWithCloudCache } from "./questionAnswerCache.js";
import {
  authorizeAiRequest,
  createAdminSession,
  createPendingPaymentOrder,
  createUserSession,
  estimateAiQuote,
  getAiWallet,
  getAIBillingState,
  releaseAiReservation,
  settleAiUsage,
  validateAdminSession,
  validateUserSession,
} from "./aiBilling.js";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const refreshDeepSeekEnvironment = createDeepSeekEnvironmentLoader(projectRoot);
let environmentStatus = refreshDeepSeekEnvironment();
const questionAnswerCache = createQuestionAnswerCacheRepository();
const proxyStatus = configureProxyFromEnv(process.env, setGlobalProxyFromEnv);

const host = "127.0.0.1";
const port = Number(process.env.SOLVER_PORT || 8787);
const maxBodySize = 2 * 1024 * 1024;
const upstreamTimeoutMs = 8_000;

function allowedOrigin(origin = "") {
  return /^http:\/\/(?:localhost|127\.0\.0\.1):\d+$/.test(origin) ? origin : "";
}

function sendJson(response, status, value, origin = "") {
  const safeOrigin = allowedOrigin(origin);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...(safeOrigin ? { "Access-Control-Allow-Origin": safeOrigin, Vary: "Origin" } : {}),
  });
  response.end(JSON.stringify(value));
}

function logDiagnostic(scope, item) {
  const diagnostic = item?.diagnostic ?? {};
  console.error("[solver-diagnostic]", {
    scope,
    code: item?.code ?? "UNKNOWN",
    httpStatus: diagnostic.httpStatus ?? null,
    apiType: diagnostic.apiType ?? null,
    apiCode: diagnostic.apiCode ?? null,
    requestId: diagnostic.requestId ?? null,
    reachedDeepSeek: diagnostic.reachedDeepSeek ?? null,
    retryable: item?.retryable ?? false,
    message: String(item?.reason ?? item?.error ?? "").slice(0, 300),
  });
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBodySize) throw new Error("REQUEST_TOO_LARGE");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function checkDeepSeekUpstream() {
  environmentStatus = refreshDeepSeekEnvironment();
  if (!process.env.DEEPSEEK_API_KEY) {
    return {
      ok: false,
      code: "DEEPSEEK_API_KEY_MISSING",
      error: "DEEPSEEK_API_KEY is not configured on the server",
    };
  }
  if (["SOCKS_PROXY_UNSUPPORTED", "UNSUPPORTED_PROXY_PROTOCOL"].includes(proxyStatus.code)) {
    return {
      ok: false,
      code: "PROXY_UNSUPPORTED",
      error: "Configured proxy protocol is not supported by the current Node.js runtime",
      proxy: proxyStatus,
    };
  }
  if (["INVALID_PROXY_URL", "HTTPS_PROXY_MISSING"].includes(proxyStatus.code)) {
    return {
      ok: false,
      code: "PROXY_MISCONFIGURED",
      error: "Proxy environment variables are incomplete or invalid",
      proxy: proxyStatus,
    };
  }

  try {
    const response = await fetch("https://api.deepseek.com/models", {
      headers: { Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}` },
      signal: AbortSignal.timeout(upstreamTimeoutMs),
    });
    return classifyDeepSeekHealthResponse(response, proxyStatus);
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === "TimeoutError" || /timeout/i.test(error.message));
    return {
      ok: false,
      code: proxyStatus.enabled
        ? timedOut ? "PROXY_TIMEOUT" : "PROXY_CONNECTION_FAILED"
        : timedOut ? "DEEPSEEK_TIMEOUT" : "DEEPSEEK_UNREACHABLE",
      error: timedOut ? "Connection to api.deepseek.com timed out" : "Connection to api.deepseek.com failed",
      proxy: proxyStatus,
    };
  }
}

const server = createServer(async (request, response) => {
  const origin = request.headers.origin || "";
  if (request.method === "OPTIONS") {
    const safeOrigin = allowedOrigin(origin);
    response.writeHead(safeOrigin ? 204 : 403, {
      ...(safeOrigin ? { "Access-Control-Allow-Origin": safeOrigin } : {}),
      "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, X-AI-Session, X-AI-User-Session, X-User-Id",
    });
    response.end();
    return;
  }

  if (request.method === "GET" && request.url === "/health") {
    environmentStatus = refreshDeepSeekEnvironment();
    sendJson(response, 200, {
      ok: true,
      apiKeyConfigured: Boolean(process.env.DEEPSEEK_API_KEY),
      adminPasswordConfigured: Boolean(process.env.AI_ADMIN_PASSWORD),
      questionCacheConfigured: questionAnswerCache.isConfigured(),
      provider: "deepseek",
      model: "deepseek-flash",
      environment: environmentStatus,
      nodeVersion: process.version,
      proxy: proxyStatus,
    }, origin);
    return;
  }

  if (request.method === "GET" && request.url === "/health/upstream") {
    const result = await checkDeepSeekUpstream();
    if (!result.ok) logDiagnostic("upstream-health", result);
    sendJson(response, result.ok ? 200 : 503, result, origin);
    return;
  }

  if (request.method === "POST" && request.url === "/api/ai/session") {
    sendJson(response, 200, createUserSession(), origin);
    return;
  }

  if (request.method === "POST" && request.url === "/api/ai/admin-unlock") {
    try {
      environmentStatus = refreshDeepSeekEnvironment();
      const body = await readJson(request);
      const result = createAdminSession(body.password);
      if (!result.ok) {
        sendJson(response, result.code === "ADMIN_PASSWORD_NOT_CONFIGURED" ? 503 : 401, result, origin);
        return;
      }
      sendJson(response, 200, result, origin);
      return;
    } catch {
      sendJson(response, 400, { ok: false, code: "INVALID_REQUEST", error: "管理员解锁请求无效" }, origin);
      return;
    }
  }

  if (request.method === "POST" && request.url === "/api/ai/quote") {
    try {
      const body = await readJson(request);
      const quote = estimateAiQuote({
        questionCount: Array.isArray(body.questions) ? body.questions.length : Number(body.questionCount) || 1,
      });
      sendJson(response, 200, quote, origin);
      return;
    } catch {
      sendJson(response, 400, { ok: false, code: "INVALID_REQUEST", error: "报价请求无效" }, origin);
      return;
    }
  }

  if (request.method === "POST" && request.url === "/api/ai/access") {
    try {
      const body = await readJson(request);
      const userSession = validateUserSession(request.headers["x-ai-user-session"]);
      const authToken = String(request.headers["x-ai-session"] || request.headers.authorization || "").replace(/^Bearer\s+/i, "");
      const adminMode = validateAdminSession(authToken);
      if (!adminMode && !userSession) {
        sendJson(response, 401, { code: "AI_USER_SESSION_REQUIRED", error: "AI 计费会话已失效，请刷新页面重试。" }, origin);
        return;
      }
      const userId = adminMode ? "admin" : userSession.userId;
      const wallet = adminMode
        ? { userId: "admin", balanceFen: 0, updatedAt: new Date().toISOString() }
        : getAiWallet(userId);
      sendJson(response, 200, {
        userId,
        adminMode,
        wallet,
        quote: estimateAiQuote({ questionCount: Math.max(1, Number(body.questionCount) || 1) }),
        paymentConfigured: Boolean(process.env.AI_PAYMENT_PROVIDER),
      }, origin);
      return;
    } catch {
      sendJson(response, 400, { ok: false, code: "INVALID_REQUEST", error: "AI 权限检查请求无效" }, origin);
      return;
    }
  }

  if (request.method === "POST" && request.url === "/api/ai/checkout") {
    try {
      const userSession = validateUserSession(request.headers["x-ai-user-session"]);
      if (!userSession) {
        sendJson(response, 401, { code: "AI_USER_SESSION_REQUIRED", error: "AI 计费会话已失效，请刷新页面重试。" }, origin);
        return;
      }
      const body = await readJson(request);
      const order = createPendingPaymentOrder(
        userSession.userId,
        body.amountFen || 500,
        process.env.AI_PAYMENT_PROVIDER || "unconfigured",
      );
      sendJson(response, 200, {
        ok: true,
        order,
        paymentConfigured: Boolean(process.env.AI_PAYMENT_PROVIDER),
        message: process.env.AI_PAYMENT_PROVIDER
          ? "支付订单已创建；还需要接入支付渠道的下单地址与回调验签后才能自动入账。"
          : "支付界面已就绪，但尚未配置真实支付渠道；当前不会自动增加余额。",
      }, origin);
      return;
    } catch {
      sendJson(response, 400, { ok: false, code: "INVALID_REQUEST", error: "支付订单请求无效" }, origin);
      return;
    }
  }

  if (request.method === "GET" && request.url === "/api/ai/transactions") {
    const authToken = String(request.headers["x-ai-session"] || request.headers.authorization || "").replace(/^Bearer\s+/i, "");
    if (!validateAdminSession(authToken)) {
      sendJson(response, 403, { code: "ADMIN_REQUIRED", error: "仅管理员可查看计费流水" }, origin);
      return;
    }
    sendJson(response, 200, getAIBillingState(), origin);
    return;
  }
  if (request.method !== "POST" || request.url !== "/api/solve-missing") {
    sendJson(response, 404, { error: "Not found" }, origin);
    return;
  }

  if (origin && !allowedOrigin(origin)) {
    sendJson(response, 403, { error: "Origin not allowed" });
    return;
  }
  let billingRequestId = null;
  try {
    const body = await readJson(request);
    if (!Array.isArray(body.questions)) {
      sendJson(response, 400, { error: "questions 必须是数组" }, origin);
      return;
    }
    if (body.questions.length > 20) {
      sendJson(response, 400, {
        code: "BATCH_TOO_LARGE",
        error: "单次最多提交 20 道题，请由前端分批处理",
      }, origin);
      return;
    }
    if (body.sourceAnswers != null && (!Array.isArray(body.sourceAnswers) || body.sourceAnswers.length > 20)) {
      sendJson(response, 400, { code: "INVALID_SOURCE_ANSWERS", error: "原始答案缓存条数无效" }, origin);
      return;
    }

    const authToken = String(request.headers["x-ai-session"] || request.headers.authorization || "").replace(/^Bearer\s+/i, "");
    const adminMode = validateAdminSession(authToken);
    const userSession = validateUserSession(request.headers["x-ai-user-session"]);
    if (!adminMode && !userSession) {
      sendJson(response, 401, { code: "AI_USER_SESSION_REQUIRED", error: "AI 计费会话已失效，请刷新页面重试。" }, origin);
      return;
    }
    if (questionAnswerCache.isConfigured()) {
      for (const sourceQuestion of body.sourceAnswers ?? []) {
        if (!["source", "manual"].includes(sourceQuestion?.answerSource)) continue;
        try {
          await questionAnswerCache.saveQuestion(sourceQuestion, sourceQuestion.answerSource);
        } catch {
          // 缓存写入失败不应阻断当前题目解答。
        }
      }
    }
    let billing = null;
    const result = await solveQuestionsWithCloudCache(body.questions, {
      repository: questionAnswerCache,
      onCacheEvent(event, hash) {
        console.log(`[CACHE ${event}] ${hash}`);
      },
      async solveMisses(missQuestions) {
        environmentStatus = refreshDeepSeekEnvironment();
        if (!process.env.DEEPSEEK_API_KEY) {
          billing = { status: "api_key_missing", chargedFen: 0 };
          return {
            questions: missQuestions,
            errors: missQuestions.map((question) => ({
              id: question.id,
              code: "DEEPSEEK_API_KEY_MISSING",
              reason: "服务器没有配置 DEEPSEEK_API_KEY",
              retryable: false,
              diagnostic: null,
            })),
            halted: null,
            usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
            stats: { total: missQuestions.length, attempted: 0, aiFailures: missQuestions.length },
          };
        }

        const authorized = authorizeAiRequest({
          userId: adminMode ? "admin" : userSession.userId,
          authToken,
          requestId: body.requestId || `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          questionCount: missQuestions.length,
        });
        if (!authorized.allowed) {
          billing = {
            status: "insufficient_balance",
            chargedFen: 0,
            requiredFen: authorized.requiredFen,
            balanceFen: authorized.balanceFen,
          };
          return {
            questions: missQuestions,
            errors: missQuestions.map((question) => ({
              id: question.id,
              code: "INSUFFICIENT_BALANCE",
              reason: "缓存未命中的题目需要 AI 余额",
              retryable: false,
              diagnostic: null,
            })),
            halted: null,
            usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
            stats: { total: missQuestions.length, attempted: 0, aiFailures: missQuestions.length },
          };
        }
        billingRequestId = authorized.requestId;

        const solved = await solveMissingQuestions(missQuestions, {
          batchSize: 10,
          concurrency: 3,
          maxRetries: 2,
          timeoutMs: 30_000,
        });
        const usage = solved.usage ?? { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
        billing = settleAiUsage({
          userId: adminMode ? "admin" : userSession.userId,
          requestId: authorized.requestId,
          questionCount: missQuestions.length,
          inputTokens: usage.promptTokens,
          outputTokens: usage.completionTokens,
          totalTokens: usage.totalTokens,
        });
        return solved;
      },
    });
    for (const error of result.errors) logDiagnostic("question", error);
    sendJson(response, 200, {
      ...result,
      billing: billing ?? {
        status: result.cacheStatus === "unavailable"
          ? "cache_unavailable"
          : result.cacheStatus === "disabled" ? "cache_disabled" : "cache_only",
        chargedFen: 0,
        providerCostFen: 0,
        platformFeeFen: 0,
      },
    }, origin);
  } catch (error) {
    if (billingRequestId) releaseAiReservation(billingRequestId);
    if (error?.httpStatus && error?.payload) {
      sendJson(response, error.httpStatus, error.payload, origin);
      return;
    }
    const tooLarge = error instanceof Error && error.message === "REQUEST_TOO_LARGE";
    if (!tooLarge) {
      console.error("[solver-internal]", {
        name: error instanceof Error ? error.name : "UnknownError",
        message: String(error instanceof Error ? error.message : error)
          .replace(/\bsk-[A-Za-z0-9_-]+/g, "[redacted-key]")
          .replace(/\b(?:https?|socks5?h?):\/\/[^\s]+/gi, "[redacted-url]")
          .slice(0, 500),
      });
    }
    sendJson(response, tooLarge ? 413 : 500, {
      code: tooLarge ? "REQUEST_TOO_LARGE" : "SOLVER_SERVER_ERROR",
      error: tooLarge ? "请求超过 2 MB 限制" : "AI 解题服务发生内部错误，请查看服务端脱敏日志",
    }, origin);
  }
});

server.listen(port, host, () => {
  console.log(`Solver API listening on http://${host}:${port}`);
  console.log("DeepSeek environment status:", {
    loaded: environmentStatus.loaded,
    source: environmentStatus.source,
    keyExists: environmentStatus.keyExists,
    keyLength: environmentStatus.keyLength,
    attempts: environmentStatus.attempts,
  });
  console.log(proxyStatus.enabled
    ? `Outbound proxy enabled via ${proxyStatus.source} (${proxyStatus.protocol})`
    : `Outbound proxy mode: ${proxyStatus.code}`);
});
