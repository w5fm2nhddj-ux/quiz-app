import { createServer, setGlobalProxyFromEnv } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { solveMissingQuestions } from "../agents/solveMissingQuestions.js";
import { configureProxyFromEnv } from "./proxyConfig.js";
import { classifyDeepSeekHealthResponse } from "./deepSeekHealth.js";
import { createDeepSeekEnvironmentLoader } from "./envConfig.js";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const refreshDeepSeekEnvironment = createDeepSeekEnvironmentLoader(projectRoot);
let environmentStatus = refreshDeepSeekEnvironment();
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
      "Access-Control-Allow-Headers": "Content-Type",
    });
    response.end();
    return;
  }

  if (request.method === "GET" && request.url === "/health") {
    environmentStatus = refreshDeepSeekEnvironment();
    sendJson(response, 200, {
      ok: true,
      apiKeyConfigured: Boolean(process.env.DEEPSEEK_API_KEY),
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

  if (request.method !== "POST" || request.url !== "/api/solve-missing") {
    sendJson(response, 404, { error: "Not found" }, origin);
    return;
  }

  if (origin && !allowedOrigin(origin)) {
    sendJson(response, 403, { error: "Origin not allowed" });
    return;
  }
  environmentStatus = refreshDeepSeekEnvironment();
  if (!process.env.DEEPSEEK_API_KEY) {
    sendJson(response, 503, {
      code: "DEEPSEEK_API_KEY_MISSING",
      error: "服务器没有配置 DEEPSEEK_API_KEY",
    }, origin);
    return;
  }

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
    const result = await solveMissingQuestions(body.questions, {
      batchSize: 10,
      concurrency: 3,
      maxRetries: 2,
      timeoutMs: 30_000,
    });
    for (const error of result.errors) logDiagnostic("question", error);
    sendJson(response, 200, result, origin);
  } catch (error) {
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
