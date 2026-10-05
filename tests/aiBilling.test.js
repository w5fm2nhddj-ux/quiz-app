import assert from "node:assert/strict";
import {
  authorizeAiRequest,
  calculateActualAiCost,
  createAdminSession,
  estimateAiQuote,
  getAiWallet,
  rechargeAiWallet,
  settleAiUsage,
  validateAdminSession,
} from "../server/aiBilling.js";

process.env.AI_ADMIN_PASSWORD = "demo-admin";

const adminSession = createAdminSession("demo-admin");
assert.equal(adminSession.ok, true, "管理员密码应成功解锁 AI");
assert.equal(validateAdminSession(adminSession.token), true, "管理员 session 必须有效");

const quote = estimateAiQuote({ questionCount: 4 });
assert.ok(quote.estimatedUserChargeFen > 0, "报价应包含预估费用");
assert.equal(quote.estimatedInputTokens > 0, true, "报价必须提供输入 token 估计");
assert.equal(quote.estimatedOutputTokens > 0, true, "报价必须提供输出 token 估计");

const walletBefore = { ...getAiWallet("wallet-user") };
const rechargeResult = rechargeAiWallet("wallet-user", 1000, "mock");
assert.equal(rechargeResult.ok, true, "Mock 充值应成功增加余额");
assert.equal(getAiWallet("wallet-user").balanceFen, walletBefore.balanceFen + 1000, "充值后余额必须增加");

const authorization = authorizeAiRequest({
  userId: "wallet-user",
  requestId: "req-billing-1",
  questionCount: 1,
  estimatedChargeFen: 80,
});
assert.equal(authorization.allowed, true, "余额足够时应授权 AI 请求");
assert.equal(authorization.transaction.chargedFen, 80, "授权时应记录预计收费");

const actual = settleAiUsage({
  userId: "wallet-user",
  requestId: "req-billing-1",
  inputTokens: 1000,
  outputTokens: 500,
  totalTokens: 1500,
  chargedFen: 80,
});
assert.equal(actual.chargedFen, 80, "实际结算应使用最终费用");
assert.equal(getAiWallet("wallet-user").balanceFen < 1000, true, "实际扣费后余额应减少");

const adminAuth = authorizeAiRequest({
  userId: "admin",
  requestId: "req-admin-1",
  questionCount: 1,
  authToken: adminSession.token,
  adminMode: true,
});
assert.equal(adminAuth.adminMode, true, "管理员 session 应绕过用户余额");
assert.equal(adminAuth.transaction.chargedFen, 0, "管理员调用应不扣用户余额");

const insufficient = authorizeAiRequest({
  userId: "tiny-user",
  requestId: "req-insufficient-1",
  questionCount: 1,
  estimatedChargeFen: 999999,
});
assert.equal(insufficient.allowed, false, "余额不足时必须拒绝请求");
assert.equal(insufficient.code, "INSUFFICIENT_BALANCE", "拒绝码必须为 INSUFFICIENT_BALANCE");

const cost = calculateActualAiCost(1000, 500);
assert.ok(cost.providerCostFen >= 0, "实际成本必须可计算");
assert.ok(cost.platformFeeFen >= 0, "平台服务费必须可计算");
assert.ok(cost.chargedFen >= cost.providerCostFen, "实际收费必须覆盖成本");

console.log("ai billing tests passed: admin unlock, quote, mock payment, actual settlement and insufficient balance verified.");
