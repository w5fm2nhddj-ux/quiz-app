const DEFAULT_PRICING = {
  inputPricePer1M: Number(process.env.AI_INPUT_PRICE_PER_1M ?? 1.1),
  outputPricePer1M: Number(process.env.AI_OUTPUT_PRICE_PER_1M ?? 2.2),
  markupMultiplier: Number(process.env.AI_MARKUP_MULTIPLIER ?? 1.8),
  fixedServiceFeeFen: Number(process.env.AI_FIXED_SERVICE_FEE_FEN ?? 50),
  minChargeFen: Number(process.env.AI_MIN_CHARGE_FEN ?? 30),
};

const state = {
  wallets: new Map([
    ["demo-user", { userId: "demo-user", balanceFen: 10000, updatedAt: new Date().toISOString() }],
  ]),
  adminSessions: new Map(),
  transactions: [],
  requestIndex: new Map(),
  paymentOrders: [],
};

function normalizeFen(value) {
  const numeric = Number(value ?? 0);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.round(numeric));
}

function normalizePrice(value, fallback) {
  const numeric = Number(value ?? fallback);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : fallback;
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

export function ensureAiWallet(userId = "demo-user") {
  const safeUserId = String(userId || "demo-user").trim() || "demo-user";
  const current = state.wallets.get(safeUserId);
  if (current) return current;
  const wallet = { userId: safeUserId, balanceFen: 0, updatedAt: new Date().toISOString() };
  state.wallets.set(safeUserId, wallet);
  return wallet;
}

export function getAiWallet(userId = "demo-user") {
  return ensureAiWallet(userId);
}

export function createPaymentOrder(userId, amountFen, provider = "mock") {
  const order = {
    id: `pay_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    userId: String(userId || "demo-user"),
    amountFen: normalizeFen(amountFen),
    provider,
    providerOrderId: `mock-${Date.now()}`,
    status: "paid",
    createdAt: new Date().toISOString(),
    paidAt: new Date().toISOString(),
  };
  state.paymentOrders.push(order);
  return order;
}

export function rechargeAiWallet(userId, amountFen, provider = "mock") {
  const safeAmount = normalizeFen(amountFen);
  if (safeAmount <= 0) return { ok: false, code: "INVALID_AMOUNT", message: "充值金额必须为正整数分" };
  const wallet = ensureAiWallet(userId);
  const order = createPaymentOrder(userId, safeAmount, provider);
  wallet.balanceFen += safeAmount;
  wallet.updatedAt = new Date().toISOString();
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
  const providerCostFen = Math.round(
    ((safeInput * config.inputPricePer1M) + (safeOutput * config.outputPricePer1M)) / 1_000_000 * 100,
  );
  const chargedFen = Math.max(
    config.minChargeFen,
    Math.round(providerCostFen * config.markupMultiplier + config.fixedServiceFeeFen),
  );
  const platformFeeFen = Math.max(0, chargedFen - providerCostFen);

  return {
    inputTokens: Math.round(safeInput),
    outputTokens: Math.round(safeOutput),
    totalTokens: Math.round(safeInput + safeOutput),
    providerCostFen,
    platformFeeFen,
    chargedFen,
  };
}

export function createAdminSession(password) {
  const expectedPassword = String(process.env.AI_ADMIN_PASSWORD ?? "admin-demo-password").trim();
  if (!password || String(password).trim() !== expectedPassword) {
    return { ok: false, code: "INVALID_ADMIN_PASSWORD", message: "管理员密码错误" };
  }

  const token = `admin_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  state.adminSessions.set(token, {
    token,
    userId: "admin",
    adminMode: true,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 1000 * 60 * 30).toISOString(),
  });

  return { ok: true, token, adminMode: true, expiresAt: state.adminSessions.get(token).expiresAt };
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
    adminSessions: [...state.adminSessions.values()],
    transactions: [...state.transactions],
    paymentOrders: [...state.paymentOrders],
    pricing: getAiPricingConfig(),
  };
}

export function authorizeAiRequest({
  userId = "demo-user",
  authToken,
  requestId,
  questionCount = 1,
  estimatedChargeFen,
  adminMode = false,
} = {}) {
  const safeRequestId = String(requestId || `ai-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  if (state.requestIndex.has(safeRequestId)) {
    return {
      allowed: true,
      idempotent: true,
      requestId: safeRequestId,
      transaction: state.requestIndex.get(safeRequestId),
    };
  }

  const validAdmin = Boolean(adminMode) || validateAdminSession(authToken);
  if (validAdmin) {
    const transaction = {
      id: `tx_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      userId: userId || "admin",
      requestId: safeRequestId,
      questionCount: Math.max(0, Number(questionCount) || 0),
      chargedFen: 0,
      providerCostFen: 0,
      platformFeeFen: 0,
      status: "authorized",
      adminMode: true,
      createdAt: new Date().toISOString(),
    };
    state.requestIndex.set(safeRequestId, transaction);
    return { allowed: true, idempotent: false, requestId: safeRequestId, adminMode: true, transaction };
  }

  const wallet = ensureAiWallet(userId);
  const quote = estimateAiQuote({ questionCount, estimatedInputTokens: questionCount * 2500, estimatedOutputTokens: questionCount * 1500 });
  const requiredFen = normalizeFen(estimatedChargeFen ?? quote.estimatedUserChargeFen);
  if (wallet.balanceFen < requiredFen) {
    return {
      allowed: false,
      code: "INSUFFICIENT_BALANCE",
      balanceFen: wallet.balanceFen,
      requiredFen,
      estimate: quote,
      requestId: safeRequestId,
    };
  }

  const transaction = {
    id: `tx_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    userId: String(userId || "demo-user"),
    requestId: safeRequestId,
    questionCount: Math.max(0, Number(questionCount) || 0),
    chargedFen: requiredFen,
    providerCostFen: quote.estimatedProviderCostFen,
    platformFeeFen: quote.estimatedPlatformFeeFen,
    status: "authorized",
    adminMode: false,
    createdAt: new Date().toISOString(),
  };
  state.requestIndex.set(safeRequestId, transaction);
  return { allowed: true, idempotent: false, requestId: safeRequestId, adminMode: false, transaction, estimate: quote };
}

export function settleAiUsage({
  userId = "demo-user",
  requestId,
  questionCount = 0,
  inputTokens = 0,
  outputTokens = 0,
  totalTokens = 0,
  providerCostFen,
  platformFeeFen,
  chargedFen,
  adminMode = false,
}) {
  const safeRequestId = String(requestId || `ai-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  const existing = state.requestIndex.get(safeRequestId);
  if (existing && existing.status === "settled") {
    return { ...existing, duplicate: true };
  }

  const cost = calculateActualAiCost(inputTokens, outputTokens);
  const finalProviderCostFen = normalizeFen(providerCostFen ?? cost.providerCostFen);
  const finalPlatformFeeFen = normalizeFen(platformFeeFen ?? cost.platformFeeFen);
  const finalChargeFen = normalizeFen(chargedFen ?? cost.chargedFen);
  const settled = {
    id: existing?.id ?? `tx_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    userId: String(userId || "demo-user"),
    requestId: safeRequestId,
    questionCount: Math.max(0, Number(questionCount) || 0),
    inputTokens: Math.max(0, Number(inputTokens) || 0),
    outputTokens: Math.max(0, Number(outputTokens) || 0),
    totalTokens: Math.max(0, Number(totalTokens) || 0),
    providerCostFen: finalProviderCostFen,
    platformFeeFen: finalPlatformFeeFen,
    chargedFen: adminMode ? 0 : finalChargeFen,
    status: "settled",
    adminMode: Boolean(adminMode),
    createdAt: existing?.createdAt ?? new Date().toISOString(),
    settledAt: new Date().toISOString(),
  };

  if (!adminMode) {
    const wallet = ensureAiWallet(userId);
    wallet.balanceFen = Math.max(0, wallet.balanceFen - settled.chargedFen);
    wallet.updatedAt = new Date().toISOString();
  }

  state.requestIndex.set(safeRequestId, settled);
  state.transactions.push(settled);
  return settled;
}
