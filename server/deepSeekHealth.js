import { classifySolverError } from "../agents/solveMissingQuestions.js";

async function readErrorBody(response) {
  try {
    const body = await response.json();
    return body && typeof body === "object" && body.error && typeof body.error === "object"
      ? body.error
      : {};
  } catch {
    return {};
  }
}

// 只返回排障需要的脱敏字段，不转发响应正文或响应头。
export async function classifyDeepSeekHealthResponse(response, proxyStatus) {
  if (response.ok) return { ok: true, code: "OK", proxy: proxyStatus };
  const apiError = await readErrorBody(response);
  const classified = classifySolverError({
    name: "DeepSeekHealthError",
    status: response.status,
    type: apiError.type,
    code: apiError.code,
    message: apiError.message || `DeepSeek API returned HTTP ${response.status}`,
    requestID: response.headers.get("x-request-id"),
    headers: response.headers,
    error: apiError,
  });
  return {
    ok: false,
    code: classified.code,
    error: classified.message,
    retryable: classified.retryable,
    diagnostic: classified.diagnostic,
    proxy: proxyStatus,
  };
}

