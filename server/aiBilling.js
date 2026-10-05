import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const DEFAULT_PRICING = {
  inputPricePer1M: Number(process.env.AI_INPUT_PRICE_PER_1M ?? 1.1),
  outputPricePer1M: Number(process.env.AI_OUTPUT_PRICE_PER_1M ?? 2.2),
  markupMultiplier: Number(process.env.AI_MARKUP_MULTIPLIER ?? 1.8),
  fixedServiceFeeFen: Number(process.env.AI_FIXED_SERVICE_FEE_FEN ?? 50),
  minChargeFen: Number(process.env.AI_MIN_CHARGE_FEN ?? 30),
};

const state = {
  wallets: new Map(),
  userSessions: new Map(),
  adminSessions: new Map(),
  transactions: [],
  requestIndex: new Map(),
  paymentOrders: [],
};

function nowIso() {
  return new Date().toISOString();
}

function randomToken(prefix, bytes = 24) {
  return prefix + "_" + randomBytes(bytes).toString("hex");
}

function normalizeFen(value) {
  const numeric = Number(value ?? 0);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.round(numeric));
}

function normalizePrice(value, fallback) {
  const numeric = Number(value ?? fallback);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : fallback;
}

function secureEqual(left, right) {
  const leftHash = createHash("sha256").update(String(left)).digest();
  const rightHash = createHash("sha256").update(String(right)).digest();
  return timingSafeEqual(leftHash, rightHash);
}

export function getAiPricingConfig() {
  return {
    inputPricePer1M: normalizePrice(process.env.AI_INPUT_PRICE_PER_1M, DEFAULT_PRICING.inputPricePer1M),
    outputPricePer1M: normalizePrice(process.env.AI_OUTPUT_PRICE_PER_1M, DEFAULT_PRICING.outputPricePer1M),
    markupMultiplier: normalizePrice(process.env.AI_MARKUP_MULTIPLIER, DEFAULT_PRICING.markupMultiplier),
    fixedServiceFeeFen: normalizeFen(process.env.AI_FIXED_SERVICE_FEE_FEN ?? DEFAULT_PRICING.fixedServiceFeeFen),
    minChargeFen: normalizeFen(process.env.AI_MIN_CHARGE_FEN ?? DEFAULT_PRICING.minChargeFen),
  };
}

export function ensureAiWallet(userId) {
  const safeUserId = String(userId || "").trim();
  if (!safeUserId) throw new Error("AI_USER_ID_REQUIRED");
  const current = state.wallets.get(safeUserId);
  if (current) return current;
  const wallet = { userId: safeUserId, balanceFen: 0, updatedAt: nowIso() };
  state.wallets.set(safeUserId, wallet);
  return wallet;
}

export function getAiWallet(userId) {
  return ensureAiWallet(userId);
}

export function createUserSession() {
  const token = randomToken("usr");
  const userId = randomToken("wallet", 12);
  const session = {
    token,
    userId,
    createdAt: nowIso(),
    expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString(),
  };
  state.userSessions.set(token, session);
  ensureAiWallet(userId);
  return { token, userId, expiresAt: session.expiresAt };
}

export function validateUserSession(token) {
  if (!token) return null;
  const session = state.userSessions.get(String(token));
  if (!session) return null;
  if (new Date(session.expiresAt).getTime() <= Date.now()) {
    state.userSessions.delete(String(token));
    return null;
  }
  return session;
}

export function createPendingPaymentOrder(userId, amountFen, provider = "unconfigured") {
  const safeAmount = normalizeFen(amountFen);
  if (safeAmount <= 0) throw new Error("INVALID_AMOUNT");
  const order = {
    id: randomToken("pay", 10),
    userId: String(userId),
    amountFen: safeAmount,
    provider,
    providerOrderId: null,
    paymentUrl: null,
    status: "pending",
    createdAt: nowIso(),
    paidAt: null,
  };
  state.paymentOrders.push(order);
  return order;
}

export function applyVerifiedPayment({
  userId,
  amountFen,
  provider = "verified",
  providerOrderId = null,
} = {}) {
  const safeAmount = normalizeFen(amountFen);
  if (!userId || safeAmount <= 0) {
    return { ok: false, code: "INVALID_PAYMENT", message: "支付确认数据无效" };
  }
  const wallet = ensureAiWallet(userId);
  const order = {
    id: randomToken("pay", 10),
    userId: String(userId),
    amountFen: safeAmount,
    provider,
    providerOrderId,
    paymentUrl: null,
    status: "paid",
    createdAt: nowIso(),
    paidAt: nowIso(),
  };
  wallet.balanceFen += safeAmount;
  wallet.updatedAt = nowIso();
  state.paymentOrders.push(order);
  return { ok: true, wallet, order };
}

export function estimateAiQuote({ questionCount = 1, estimatedInputTokens, estimatedOutputTokens } = {}) {
  const safeQuestionCount = Math.max(1, Number(questionCount) || 1);
  const config = getAiPricingConfig();
  const inputTokens = Math.max(0, Number(estimatedInputTokens ?? safeQuestionCount * 2500));
  const outputTokens = Math.max(0, Number(estimatedOutputTokens ?? safeQuestionCount * 1500));
  const totalTokens = inputTokens + outputTokens;
  const providerCostFen = Math.round(
    (inputTokens * config.inputPricePer1M / 1_000_000 + outputTokens * config.outputPricePer1M / 1_000_000) * 100,
  );
  const userChargeFen = Math.max(
    config.minChargeFen,
    Math.round(providerCostFen * config.markupMultiplier + config.fixedServiceFeeFen),
  );
  const platformFeeFen = Math.max(0, userChargeFen - providerCostFen);

  return {
    questionCount: safeQuestionCount,
    estimatedInputTokens: Math.round(inputTokens),
    estimatedOutputTokens: Math.round(outputTokens),
    estimatedTotalTokens: Math.round(totalTokens),
    estimatedProviderCostFen: providerCostFen,
    estimatedPlatformFeeFen: platformFeeFen,
    estimatedUserChargeFen: userChargeFen,
    currency: "CNY",
  };
}

export function calculateActualAiCost(inputTokens, outputTokens) {
  const config = getAiPricingConfig();
  const safeInput = Math.max(0, Number(inputTokens) || 0);
  const safeOutput = Math.max(0, Number(outputTokens) || 0);
  if (safeInput + safeOutput <= 0) {
    return { inputTokens: 0, outputTokens: 0, totalTokens: 0, providerCostFen: 0, platformFeeFen: 0, chargedFen: 0 };
  }
  const providerCostFen = Math.round(
    ((safeInput * config.inputPricePer1M) + (safeOutput * config.outputPricePer1M)) / 1_000_000 * 100,
  );
  const chargedFen = Math.max(
    config.minChargeFen,
    Math.round(providerCostFen * config.markupMultiplier + config.fixedServiceFeeFen),
  );
  return {
    inputTokens: Math.round(safeInput),
    outputTokens: Math.round(safeOutput),
    totalTokens: Math.round(safeInput + safeOutput),
    providerCostFen,
    platformFeeFen: Math.max(0, chargedFen - providerCostFen),
    chargedFen,
  };
}

export function createAdminSession(password) {
  const expectedPassword = String(process.env.AI_ADMIN_PASSWORD ?? "").trim();
  if (!expectedPassword) {
    return { ok: false, code: "ADMIN_PASSWORD_NOT_CONFIGURED", message: "服务器尚未配置 AI_ADMIN_PASSWORD" };
  }
  if (!password || !secureEqual(String(password).trim(), expectedPassword)) {
    return { ok: false, code: "INVALID_ADMIN_PASSWORD", message: "管理员密钥错误" };
  }
  const token = randomToken("admin");
  const session = {
    token,
    adminMode: true,
    createdAt: nowIso(),
    expiresAt: new Date(Date.now() + 1000 * 60 * 30).toISOString(),
  };
  state.adminSessions.set(token, session);
  return { ok: true, token, adminMode: true, expiresAt: session.expiresAt };
}

export function validateAdminSession(token) {
  if (!token) return false;
  const session = state.adminSessions.get(String(token));
  if (!session) return false;
  if (new Date(session.expiresAt).getTime() <= Date.now()) {
    state.adminSessions.delete(String(token));
    return false;
  }
  return true;
}

export function getAIBillingState() {
  return {
    wallets: [...state.wallets.values()],
    transactions: [...state.transactions],
    paymentOrders: [...state.paymentOrders],
    pricing: getAiPricingConfig(),
  };
}

export function authorizeAiRequest({ userId, authToken, requestId, questionCount = 1 } = {}) {
  const safeRequestId = String(requestId || randomToken("req", 10));
  const existing = state.requestIndex.get(safeRequestId);
  if (existing) {
    return { allowed: true, idempotent: true, requestId: safeRequestId, adminMode: Boolean(existing.adminMode), transaction: existing };
  }

  if (validateAdminSession(authToken)) {
    const transaction = {
      id: randomToken("tx", 10),
      userId: "admin",
      requestId: safeRequestId,
      questionCount: Math.max(0, Number(questionCount) || 0),
      reservedFen: 0,
      chargedFen: 0,
      providerCostFen: 0,
      platformFeeFen: 0,
      status: "authorized",
      adminMode: true,
      createdAt: nowIso(),
    };
    state.requestIndex.set(safeRequestId, transaction);
    return { allowed: true, idempotent: false, requestId: safeRequestId, adminMode: true, transaction };
  }

  const wallet = ensureAiWallet(userId);
  const quote = estimateAiQuote({ questionCount });
  const requiredFen = quote.estimatedUserChargeFen;
  if (wallet.balanceFen < requiredFen) {
    return { allowed: false, code: "INSUFFICIENT_BALANCE", balanceFen: wallet.balanceFen, requiredFen, estimate: quote, requestId: safeRequestId };
  }

  wallet.balanceFen -= requiredFen;
  wallet.updatedAt = nowIso();
  const transaction = {
    id: randomToken("tx", 10),
    userId: String(userId),
    requestId: safeRequestId,
    questionCount: Math.max(0, Number(questionCount) || 0),
    reservedFen: requiredFen,
    chargedFen: 0,
    providerCostFen: quote.estimatedProviderCostFen,
    platformFeeFen: 0,
    status: "reserved",
    adminMode: false,
    createdAt: nowIso(),
  };
  state.requestIndex.set(safeRequestId, transaction);
  return { allowed: true, idempotent: false, requestId: safeRequestId, adminMode: false, transaction, estimate: quote };
}

export function releaseAiReservation(requestId) {
  const existing = state.requestIndex.get(String(requestId || ""));
  if (!existing || existing.adminMode || existing.status !== "reserved") return false;
  const wallet = ensureAiWallet(existing.userId);
  wallet.balanceFen += normalizeFen(existing.reservedFen);
  wallet.updatedAt = nowIso();
  existing.status = "released";
  existing.releasedAt = nowIso();
  return true;
}

export function settleAiUsage({ userId, requestId, questionCount = 0, inputTokens = 0, outputTokens = 0, totalTokens = 0 } = {}) {
  const safeRequestId = String(requestId || randomToken("req", 10));
  const existing = state.requestIndex.get(safeRequestId);
  if (existing && existing.status === "settled") return { ...existing, duplicate: true };

  const adminMode = Boolean(existing?.adminMode);
  const cost = calculateActualAiCost(inputTokens, outputTokens);
  let finalChargeFen = adminMode ? 0 : cost.chargedFen;
  const reservedFen = adminMode ? 0 : normalizeFen(existing?.reservedFen);

  if (!adminMode) {
    const wallet = ensureAiWallet(userId || existing?.userId);
    if (finalChargeFen < reservedFen) {
      wallet.balanceFen += reservedFen - finalChargeFen;
    } else if (finalChargeFen > reservedFen) {
      const extraNeeded = finalChargeFen - reservedFen;
      const extraCharged = Math.min(extraNeeded, wallet.balanceFen);
      wallet.balanceFen -= extraCharged;
      finalChargeFen = reservedFen + extraCharged;
    }
    wallet.updatedAt = nowIso();
  }

  const settled = {
    id: existing?.id ?? randomToken("tx", 10),
    userId: adminMode ? "admin" : String(userId || existing?.userId),
    requestId: safeRequestId,
    questionCount: Math.max(0, Number(questionCount) || 0),
    inputTokens: Math.max(0, Number(inputTokens) || 0),
    outputTokens: Math.max(0, Number(outputTokens) || 0),
    totalTokens: Math.max(0, Number(totalTokens) || 0),
    reservedFen,
    providerCostFen: cost.providerCostFen,
    platformFeeFen: Math.max(0, finalChargeFen - cost.providerCostFen),
    chargedFen: finalChargeFen,
    status: "settled",
    adminMode,
    createdAt: existing?.createdAt ?? nowIso(),
    settledAt: nowIso(),
  };
  state.requestIndex.set(safeRequestId, settled);
  state.transactions.push(settled);
  return settled;
}
