const AI_API_BASE = "http://127.0.0.1:8787/api/ai";
const USER_SESSION_KEY = "ai-user-session";
const USER_ID_KEY = "ai-user-id";
const ADMIN_SESSION_KEY = "ai-session";

export type AiQuote = {
  questionCount: number;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  estimatedTotalTokens: number;
  estimatedProviderCostFen: number;
  estimatedPlatformFeeFen: number;
  estimatedUserChargeFen: number;
  currency: "CNY";
};

export type AiWallet = {
  userId: string;
  balanceFen: number;
  updatedAt: string;
};

export type AiAccessSnapshot = {
  userId: string;
  adminMode: boolean;
  wallet: AiWallet;
  quote: AiQuote;
  paymentConfigured: boolean;
};

export type AiCheckoutResult = {
  ok: boolean;
  paymentConfigured: boolean;
  message: string;
  order?: {
    id: string;
    amountFen: number;
    status: string;
    paymentUrl?: string | null;
  };
};

type UserSession = {
  token: string;
  userId: string;
  expiresAt: string;
};

type AdminUnlockResponse = {
  ok: boolean;
  token?: string;
  expiresAt?: string;
  code?: string;
  message?: string;
  error?: string;
};

function storage() {
  return typeof window === "undefined" ? null : window.localStorage;
}

export function getAiSessionToken() {
  return storage()?.getItem(ADMIN_SESSION_KEY) ?? null;
}

async function readJson<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => null);
  if (!payload) throw new Error(`AI 服务返回了无效响应（HTTP ${response.status}）。`);
  return payload as T;
}

export async function ensureAiUserSession(fetchImpl: typeof fetch = fetch): Promise<UserSession> {
  const local = storage();
  const existingToken = local?.getItem(USER_SESSION_KEY);
  const existingUserId = local?.getItem(USER_ID_KEY);
  if (existingToken && existingUserId) {
    return { token: existingToken, userId: existingUserId, expiresAt: "" };
  }

  const response = await fetchImpl(`${AI_API_BASE}/session`, { method: "POST" });
  const payload = await readJson<UserSession & { error?: string }>(response);
  if (!response.ok || !payload.token || !payload.userId) {
    throw new Error(payload.error || "无法创建 AI 计费会话。");
  }
  local?.setItem(USER_SESSION_KEY, payload.token);
  local?.setItem(USER_ID_KEY, payload.userId);
  return payload;
}

export async function fetchAiAccess(questionCount: number, fetchImpl: typeof fetch = fetch): Promise<AiAccessSnapshot> {
  const userSession = await ensureAiUserSession(fetchImpl);
  const adminSession = getAiSessionToken();
  const response = await fetchImpl(`${AI_API_BASE}/access`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-AI-User-Session": userSession.token,
      ...(adminSession ? { Authorization: `Bearer ${adminSession}` } : {}),
    },
    body: JSON.stringify({ questionCount }),
  });
  const payload = await readJson<AiAccessSnapshot & { error?: string }>(response);
  if (!response.ok) throw new Error(payload.error || "无法读取 AI 计费信息。");
  return payload;
}

export async function unlockAiAdmin(password: string, fetchImpl: typeof fetch = fetch) {
  const response = await fetchImpl(`${AI_API_BASE}/admin-unlock`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  const payload = await readJson<AdminUnlockResponse>(response);
  if (!response.ok || !payload.ok || !payload.token) {
    throw new Error(payload.message || payload.error || "管理员密钥无效。");
  }
  storage()?.setItem(ADMIN_SESSION_KEY, payload.token);
  return payload;
}

export async function createAiCheckout(amountFen: number, fetchImpl: typeof fetch = fetch): Promise<AiCheckoutResult> {
  const userSession = await ensureAiUserSession(fetchImpl);
  const response = await fetchImpl(`${AI_API_BASE}/checkout`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-AI-User-Session": userSession.token,
    },
    body: JSON.stringify({ amountFen }),
  });
  const payload = await readJson<AiCheckoutResult & { error?: string }>(response);
  if (!response.ok) throw new Error(payload.error || "创建支付订单失败。");
  return payload;
}
