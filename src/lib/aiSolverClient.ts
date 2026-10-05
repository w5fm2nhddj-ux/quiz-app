import type { ImportedQuestion } from "@/importers";

export type SolverFailureCode =
  | "SERVICE_UNAVAILABLE"
  | "API_KEY_MISSING"
  | "API_KEY_INVALID"
  | "PROXY_CONFIGURATION_ERROR"
  | "UPSTREAM_UNREACHABLE"
  | "MODEL_TIMEOUT"
  | "RATE_LIMITED"
  | "QUOTA_EXHAUSTED"
  | "RATE_LIMIT_UNKNOWN"
  | "MODEL_PERMISSION_DENIED"
  | "MODEL_NOT_FOUND_OR_DENIED"
  | "MODEL_REQUEST_FAILED"
  | "INVALID_RESPONSE";

export type SolverDiagnostic = {
  httpStatus: number | null;
  apiType: string | null;
  apiCode: string | null;
  requestId: string | null;
  retryAfterSeconds: number | null;
  reachedDeepSeek: boolean | null;
};

export type SolverQuestionError = {
  id: string;
  code: string;
  reason: string;
  retryable?: boolean;
  diagnostic?: SolverDiagnostic | null;
};

export type SolverResponse = {
  questions: ImportedQuestion[];
  errors: SolverQuestionError[];
  halted?: SolverQuestionError | null;
  stats: {
    attempted?: number;
    sourceAnswers: number;
    aiAnswers: number;
    aiFailures: number;
    missingAnswers: number;
    needsReview: number;
  };
};

export type SolverProgress = {
  total: number;
  processed: number;
  succeeded: number;
  failed: number;
  questions: ImportedQuestion[];
  errors: SolverQuestionError[];
};

export type SolveMissingOptions = {
  limit?: number;
  batchSize?: number;
  signal?: AbortSignal;
  onProgress?: (progress: SolverProgress) => void;
  fetchImpl?: typeof fetch;
};

type SolverHealth = {
  ok: boolean;
  code?: string;
  error?: string;
  retryable?: boolean;
  diagnostic?: SolverDiagnostic;
};

type ErrorPayload = {
  code?: string;
  error?: string;
  retryable?: boolean;
  diagnostic?: SolverDiagnostic;
};

const solverApiUrl = "http://127.0.0.1:8787/api/solve-missing";
const solverHealthUrl = "http://127.0.0.1:8787/health/upstream";

export class SolverClientError extends Error {
  constructor(
    public readonly code: SolverFailureCode,
    message: string,
    public readonly action: string,
    public readonly diagnostic?: SolverDiagnostic,
  ) {
    super(message);
    this.name = "SolverClientError";
  }
}

const DEFAULT_AI_COMPLETION_DISABLED = false;
let aiCompletionEnabled = !DEFAULT_AI_COMPLETION_DISABLED;

export function isAiCompletionEnabled() {
  return aiCompletionEnabled;
}

export function setAiCompletionEnabled(enabled: boolean) {
  aiCompletionEnabled = enabled;
}

export function hasMissingAnswer(question: ImportedQuestion) {
  if (question.answer == null) return true;
  if (typeof question.answer === "boolean") return false;
  if (Array.isArray(question.answer)) {
    return !question.answer.some((value) => String(value).trim().length > 0);
  }
  return question.answer.trim().length === 0;
}

function mapServerError(payload: ErrorPayload, fallbackStatus?: number) {
  switch (payload.code) {
    case "DEEPSEEK_API_KEY_MISSING":
      return new SolverClientError(
        "API_KEY_MISSING",
        "本地服务没有读取到 DEEPSEEK_API_KEY。",
        "请检查项目根目录或上级目录的 .env，然后重新运行 npm run dev。",
      );
    case "DEEPSEEK_AUTH_ERROR":
      return new SolverClientError(
        "API_KEY_INVALID",
        "DeepSeek API Key 无效、已撤销或没有权限。",
        "请更换有效的 DeepSeek API Key，并重新启动本地服务。",
        payload.diagnostic,
      );
    case "MODEL_PERMISSION_DENIED":
      return new SolverClientError(
        "MODEL_PERMISSION_DENIED",
        "当前 API 项目或 Key 没有所需的模型请求权限。",
        "请在 DeepSeek 开放平台检查账号权限和模型访问；这不是网络故障。",
        payload.diagnostic,
      );
    case "MODEL_NOT_FOUND_OR_DENIED":
      return new SolverClientError(
        "MODEL_NOT_FOUND_OR_DENIED",
        "配置的模型不存在，或当前项目无权使用该模型。",
        "请确认服务端模型名为 deepseek-flash，并检查 DeepSeek 账号的模型访问权限。",
        payload.diagnostic,
      );
    case "DEEPSEEK_UNREACHABLE":
      return new SolverClientError(
        "UPSTREAM_UNREACHABLE",
        "本地服务无法连接 api.deepseek.com。",
        "请检查代理、VPN、DNS 和防火墙；网络恢复后点击重试。",
      );
    case "PROXY_UNSUPPORTED":
      return new SolverClientError(
        "PROXY_CONFIGURATION_ERROR",
        "当前配置的是 Node.js 内置网络栈不支持的代理协议。",
        "如果是 SOCKS 代理，请在 VPN 客户端开启 TUN，或改用它提供的 HTTP/Mixed 端口并配置 HTTPS_PROXY。",
      );
    case "PROXY_MISCONFIGURED":
      return new SolverClientError(
        "PROXY_CONFIGURATION_ERROR",
        "服务端代理环境变量不完整或格式无效。",
        "访问 DeepSeek 需要 HTTPS_PROXY；请在本机 .env 配置 http://127.0.0.1:<本地HTTP端口> 后重启服务。",
      );
    case "PROXY_CONNECTION_FAILED":
      return new SolverClientError(
        "UPSTREAM_UNREACHABLE",
        "本地服务已启用代理，但无法通过代理连接 DeepSeek。",
        "请确认 VPN 已连接、本地 HTTP/Mixed 代理端口正在监听，然后重启服务并试跑 5 道。",
      );
    case "PROXY_TIMEOUT":
      return new SolverClientError(
        "MODEL_TIMEOUT",
        "通过本地代理连接 DeepSeek 超时。",
        "请检查 VPN 节点和代理端口；恢复后只需重试仍缺答案的题目。",
      );
    case "DEEPSEEK_TIMEOUT":
    case "MODEL_TIMEOUT":
      return new SolverClientError(
        "MODEL_TIMEOUT",
        "DeepSeek 模型请求超时。",
        "请稍后重试小批量；若持续超时，请检查网络或降低并发。",
      );
    case "RATE_LIMITED":
      return new SolverClientError(
        "RATE_LIMITED",
        "DeepSeek API 暂时达到速率限制。",
        payload.diagnostic?.retryAfterSeconds != null
          ? `请至少等待 ${payload.diagnostic.retryAfterSeconds} 秒，再小批量重试仍缺答案的题目。`
          : "请按限速窗口等待后，再小批量重试仍缺答案的题目。",
        payload.diagnostic,
      );
    case "QUOTA_EXHAUSTED":
      return new SolverClientError(
        "QUOTA_EXHAUSTED",
        "DeepSeek API 额度、余额或消费上限不足。",
        "反复重试不会恢复。请在 DeepSeek 开放平台检查余额、充值状态和用量限制。",
        payload.diagnostic,
      );
    case "RATE_LIMIT_UNKNOWN":
      return new SolverClientError(
        "RATE_LIMIT_UNKNOWN",
        "DeepSeek 返回了 HTTP 429，但未提供可区分额度与限速的错误代码。",
        "请先查看下方脱敏诊断并检查 DeepSeek 开放平台；在确认原因前不要连续重试。",
        payload.diagnostic,
      );
    default:
      return new SolverClientError(
        "MODEL_REQUEST_FAILED",
        payload.error || `AI 服务请求失败${fallbackStatus ? `（HTTP ${fallbackStatus}）` : ""}。`,
        "请先试跑 5 道；如果仍失败，请查看本地服务终端中的错误。",
      );
  }
}

async function readJson<T>(response: Response): Promise<T> {
  try {
    return await response.json() as T;
  } catch {
    throw new SolverClientError(
      "INVALID_RESPONSE",
      `本地 AI 服务返回了无法解析的响应（HTTP ${response.status}）。`,
      "请重启 npm run dev 后再试。",
    );
  }
}

export async function assertSolverReady(fetchImpl: typeof fetch = fetch) {
  if (!isAiCompletionEnabled()) {
    throw new SolverClientError(
      "SERVICE_UNAVAILABLE",
      "当前离线版已关闭 AI 自动补全功能。",
      "请在导入预览或题目列表中手工补全答案；AI 接口仍保留在代码中，供后续重新启用。",
    );
  }

  let response: Response;
  try {
    response = await fetchImpl(solverHealthUrl, { signal: AbortSignal.timeout(12_000) });
  } catch {
    throw new SolverClientError(
      "SERVICE_UNAVAILABLE",
      "无法连接本地 AI 解题服务（127.0.0.1:8787）。",
      "请在项目目录运行 npm run dev，并保持终端窗口开启。",
    );
  }

  const health = await readJson<SolverHealth>(response);
  if (response.ok && health.ok) return;
  throw mapServerError(health, response.status);
}

function mergeSolvedQuestions(current: ImportedQuestion[], incoming: ImportedQuestion[]) {
  const solvedById = new Map(incoming.map((question) => [question.id, question]));
  return current.map((question) => {
    // 用户手填、原题答案、或前一批已经成功的答案都不能被后续响应覆盖。
    if (!hasMissingAnswer(question)) return question;
    const solved = solvedById.get(question.id);
    if (!solved || hasMissingAnswer(solved)) return question;
    return {
      ...question,
      answer: solved.answer,
      explanation: solved.explanation,
      knowledgePoints: solved.knowledgePoints,
      optionExplanations: solved.optionExplanations,
      relatedQuestions: solved.relatedQuestions,
      answerSource: "ai" as const,
      confidence: solved.confidence,
      needsReview: solved.needsReview,
    };
  });
}

function buildStats(questions: ImportedQuestion[], aiFailures: number) {
  return {
    sourceAnswers: questions.filter((question) => question.answerSource === "source").length,
    aiAnswers: questions.filter((question) => question.answerSource === "ai").length,
    aiFailures,
    missingAnswers: questions.filter(hasMissingAnswer).length,
    needsReview: questions.filter((question) => question.needsReview).length,
  };
}

async function requestBatch(
  questions: ImportedQuestion[],
  fetchImpl: typeof fetch,
  signal?: AbortSignal,
) {
  const controller = new AbortController();
  const abortFromCaller = () => controller.abort(signal?.reason);
  signal?.addEventListener("abort", abortFromCaller, { once: true });
  const timeout = setTimeout(() => controller.abort(new Error("MODEL_TIMEOUT")), 2 * 60_000);

  try {
    const response = await fetchImpl(solverApiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ questions }),
      signal: controller.signal,
    });
    const payload = await readJson<SolverResponse & ErrorPayload>(response);
    if (!response.ok) throw mapServerError(payload, response.status);
    return payload;
  } catch (error) {
    if (error instanceof SolverClientError) throw error;
    if (controller.signal.aborted && !signal?.aborted) {
      throw new SolverClientError(
        "MODEL_TIMEOUT",
        "本批模型请求等待超过 2 分钟。",
        "已完成的批次已经保留；请检查网络后重试剩余题目。",
      );
    }
    if (signal?.aborted) throw error;
    throw new SolverClientError(
      "SERVICE_UNAVAILABLE",
      "与本地 AI 解题服务的连接中断。",
      "已完成的批次已经保留；请确认 npm run dev 仍在运行。",
    );
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abortFromCaller);
  }
}

export async function solveMissingAnswers(
  questions: ImportedQuestion[],
  options: SolveMissingOptions = {},
): Promise<SolverResponse> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const allMissing = questions.filter(hasMissingAnswer);
  const limit = Math.max(0, Math.min(options.limit ?? allMissing.length, allMissing.length));
  const candidates = allMissing.slice(0, limit);
  const batchSize = Math.max(1, Math.min(options.batchSize ?? 10, 20));

  if (candidates.length === 0) {
    return { questions, errors: [], stats: buildStats(questions, 0) };
  }

  if (!isAiCompletionEnabled()) {
    options.onProgress?.({
      total: candidates.length,
      processed: 0,
      succeeded: 0,
      failed: 0,
      questions,
      errors: [],
    });
    return { questions, errors: [], halted: null, stats: buildStats(questions, 0) };
  }

  await assertSolverReady(fetchImpl);

  let merged = questions.map((question) => ({ ...question }));
  const errors: SolverQuestionError[] = [];
  let processed = 0;
  let succeeded = 0;

  for (let start = 0; start < candidates.length; start += batchSize) {
    if (options.signal?.aborted) throw options.signal.reason;
    const batch = candidates.slice(start, start + batchSize);
    const payload = await requestBatch(batch, fetchImpl, options.signal);
    merged = mergeSolvedQuestions(merged, payload.questions);
    errors.push(...payload.errors);
    processed += payload.stats.attempted ?? batch.length;
    succeeded += payload.questions.filter((question) => !hasMissingAnswer(question)).length;
    options.onProgress?.({
      total: candidates.length,
      processed,
      succeeded,
      failed: errors.length,
      questions: merged,
      errors: [...errors],
    });
    if (payload.halted) break;
  }

  return {
    questions: merged,
    errors,
    halted: errors.find((error) => [
      "QUOTA_EXHAUSTED",
      "RATE_LIMIT_UNKNOWN",
      "DEEPSEEK_AUTH_ERROR",
      "MODEL_PERMISSION_DENIED",
      "MODEL_NOT_FOUND_OR_DENIED",
      "DEEPSEEK_BAD_REQUEST",
    ].includes(error.code)) ?? null,
    stats: buildStats(merged, errors.length),
  };
}
