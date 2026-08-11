import assert from "node:assert/strict";
import test from "node:test";

import {
  buildRetryAttemptPlan,
  classifyAttemptResult,
  decideNextCheckoutRetry,
  decideNextRetry,
  isCheckoutPhaseResult,
  normalizeRetryPolicy,
} from "../../src/platform/retry_policy.mjs";

test("retry policy defaults to four proxy attempts and no card switch", () => {
  assert.deepEqual(normalizeRetryPolicy({}), {
    checkout_max_proxy_attempts: 4,
    max_proxy_attempts_per_card: 4,
    allow_card_switch: false,
    max_card_switches: 0,
    max_card_count: 1,
  });
  assert.deepEqual(
    buildRetryAttemptPlan({}).map((attempt) => [attempt.card_attempt_index, attempt.proxy_attempt_index]),
    [[0, 0], [0, 1], [0, 2], [0, 3]],
  );
});

test("retry plan expands proxy attempts across allowed card switches", () => {
  const attempts = buildRetryAttemptPlan({
    max_proxy_attempts_per_card: 2,
    allow_card_switch: true,
    max_card_switches: 2,
  });

  assert.deepEqual(
    attempts.map((attempt) => [attempt.attempt_no, attempt.card_attempt_index, attempt.proxy_attempt_index, attempt.is_card_switch]),
    [
      [1, 0, 0, false],
      [2, 0, 1, false],
      [3, 1, 0, true],
      [4, 1, 1, false],
      [5, 2, 0, true],
      [6, 2, 1, false],
    ],
  );
});

test("attempt classifier separates proxy/page issues, declined cards, verification, and success", () => {
  assert.equal(classifyAttemptResult({ ok: true, status: "success" }).category, "success");
  assert.equal(classifyAttemptResult({ status: "failed", message: "Invalid HTTP response from proxy tunnel" }).category, "proxy_or_page");
  assert.equal(classifyAttemptResult({ status: "failed", message: "Payment was not approved" }).category, "card_declined");
  assert.equal(classifyAttemptResult({ status: "failed", code: "DIRECT_CARD_AUTH_REQUIRED" }).category, "verification_required");
  assert.equal(classifyAttemptResult({ status: "failed", message: "runner returned empty result" }).category, "unknown");
});

test("retry decision tries proxy first, then card switch when allowed", () => {
  const plan = {
    max_proxy_attempts_per_card: 2,
    allow_card_switch: true,
    max_card_switches: 1,
  };

  const proxyRetry = decideNextRetry(
    { status: "failed", message: "ECONNRESET from proxy" },
    plan,
    { card_attempt_index: 0, proxy_attempt_index: 0 },
  );
  assert.equal(proxyRetry.action, "retry_proxy");
  assert.deepEqual(proxyRetry.next, { card_attempt_index: 0, proxy_attempt_index: 1 });

  const switchAfterProxyExhausted = decideNextRetry(
    { status: "failed", message: "ECONNRESET from proxy" },
    plan,
    { card_attempt_index: 0, proxy_attempt_index: 1 },
  );
  assert.equal(switchAfterProxyExhausted.action, "switch_card");
  assert.deepEqual(switchAfterProxyExhausted.next, { card_attempt_index: 1, proxy_attempt_index: 0 });

  const declinedSwitch = decideNextRetry(
    { status: "failed", message: "Payment was not approved" },
    plan,
    { card_attempt_index: 0, proxy_attempt_index: 0 },
  );
  assert.equal(declinedSwitch.action, "switch_card");

  const exhausted = decideNextRetry(
    { status: "failed", message: "Payment was not approved" },
    plan,
    { card_attempt_index: 1, proxy_attempt_index: 0 },
  );
  assert.equal(exhausted.action, "stop");
  assert.equal(exhausted.exhausted, true);
});

test("checkout retry decision never switches cards", () => {
  const plan = {
    checkout_max_proxy_attempts: 2,
    max_proxy_attempts_per_card: 2,
    allow_card_switch: true,
    max_card_switches: 3,
  };

  assert.equal(isCheckoutPhaseResult({ status: "failed", code: "CHECKOUT_FAILED" }), true);

  const retry = decideNextCheckoutRetry(
    { status: "failed", code: "CHECKOUT_FAILED", message: "checkout/create ECONNRESET" },
    plan,
    { checkout_proxy_attempt_index: 0, card_attempt_index: 0, proxy_attempt_index: 0 },
  );
  assert.equal(retry.action, "retry_checkout_proxy");
  assert.deepEqual(retry.next, { checkout_proxy_attempt_index: 1 });

  const exhausted = decideNextCheckoutRetry(
    { status: "failed", code: "CHECKOUT_FAILED", message: "checkout/create ECONNRESET" },
    plan,
    { checkout_proxy_attempt_index: 1, card_attempt_index: 0, proxy_attempt_index: 0 },
  );
  assert.equal(exhausted.action, "stop");
  assert.equal(exhausted.exhausted, true);
});

test("successful attempts complete without another retry", () => {
  const decision = decideNextRetry({ ok: true, status: "success" }, {
    max_proxy_attempts_per_card: 2,
    allow_card_switch: true,
    max_card_switches: 5,
  }, { card_attempt_index: 0, proxy_attempt_index: 0 });

  assert.equal(decision.action, "complete");
  assert.equal(decision.exhausted, false);
  assert.equal(decision.next, null);
});
