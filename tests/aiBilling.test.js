import assert from "node:assert/strict";
import {
  applyVerifiedPayment,
  authorizeAiRequest,
  calculateActualAiCost,
  createAdminSession,
  createPendingPaymentOrder,
  createUserSession,
  ensureAiWallet,
  estimateAiQuote,
  releaseAiReservation,
  settleAiUsage,
  validateAdminSession,
  validateUserSession,
} from "../server/aiBilling.js";

delete process.env.AI_ADMIN_PASSWORD;
const missingAdmin = createAdminSession("anything");
assert.equal(missingAdmin.ok, false);
assert.equal(missingAdmin.code, "ADMIN_PASSWORD_NOT_CONFIGURED");

process.env.AI_ADMIN_PASSWORD = "demo-admin";
assert.equal(createAdminSession("wrong").ok, false);
const adminSession = createAdminSession("demo-admin");
assert.equal(adminSession.ok, true);
assert.equal(validateAdminSession(adminSession.token), true);

const userSession = createUserSession();
assert.equal(validateUserSession(userSession.token)?.userId, userSession.userId);
assert.equal(ensureAiWallet(userSession.userId).balanceFen, 0);

const quote = estimateAiQuote({ questionCount: 4 });
assert.ok(quote.estimatedUserChargeFen > 0);
assert.ok(quote.estimatedPlatformFeeFen >= 0);

const pending = createPendingPaymentOrder(userSession.userId, 1000, "unconfigured");
assert.equal(pending.status, "pending");
assert.equal(ensureAiWallet(userSession.userId).balanceFen, 0);

const verified = applyVerifiedPayment({ userId: userSession.userId, amountFen: 1000, provider: "test", providerOrderId: "paid-1" });
assert.equal(verified.ok, true);
assert.equal(ensureAiWallet(userSession.userId).balanceFen, 1000);

const authorization = authorizeAiRequest({ userId: userSession.userId, requestId: "req-billing-1", questionCount: 1 });
assert.equal(authorization.allowed, true);
assert.equal(authorization.transaction.status, "reserved");
assert.ok(ensureAiWallet(userSession.userId).balanceFen < 1000);

const settled = settleAiUsage({
  userId: userSession.userId,
  requestId: "req-billing-1",
  questionCount: 1,
  inputTokens: 1000,
  outputTokens: 500,
  totalTokens: 1500,
});
assert.equal(settled.status, "settled");

applyVerifiedPayment({ userId: userSession.userId, amountFen: 500, provider: "test", providerOrderId: "paid-2" });
const releaseAuth = authorizeAiRequest({ userId: userSession.userId, requestId: "req-release-1", questionCount: 1 });
const afterReserve = ensureAiWallet(userSession.userId).balanceFen;
assert.equal(releaseAiReservation(releaseAuth.requestId), true);
assert.ok(ensureAiWallet(userSession.userId).balanceFen > afterReserve);

const adminAuth = authorizeAiRequest({ userId: "admin", requestId: "req-admin-1", questionCount: 1, authToken: adminSession.token });
assert.equal(adminAuth.adminMode, true);
assert.equal(adminAuth.transaction.chargedFen, 0);

const bypassAttempt = authorizeAiRequest({ userId: "empty-wallet", requestId: "req-bypass-1", questionCount: 1, adminMode: true });
assert.equal(bypassAttempt.allowed, false);

const cost = calculateActualAiCost(1000, 500);
assert.ok(cost.providerCostFen >= 0);
assert.ok(cost.chargedFen >= cost.providerCostFen);
assert.equal(calculateActualAiCost(0, 0).chargedFen, 0);

console.log("ai billing tests passed");
