import assert from "node:assert/strict";
import test from "node:test";

import { createAuditLog, redactAuditPayload } from "../../src/platform/audit.mjs";
import { OrderStatus } from "../../src/platform/constants.mjs";
import { createOrder, publicOrderSummary, transitionOrder } from "../../src/platform/orders.mjs";
import { buildPlanRuntimeConfig, DEFAULT_FAILURE_MESSAGE, normalizePlanCardGroups, normalizePlanConfig } from "../../src/platform/plans.mjs";

test("plan config normalizes defaults and retry policy", () => {
  const config = normalizePlanConfig({
    plan_type: "plus",
    payment_country: "PH",
    payment_currency: "PHP",
    allow_card_switch: "true",
    max_card_switches: 2,
    remote_balance_success_fallback: "true",
  });
  assert.equal(config.display_name, "Plus");
  assert.equal(config.payment_country, "PH");
  assert.equal(config.payment_currency, "PHP");
  assert.equal(config.failure_message, DEFAULT_FAILURE_MESSAGE);
  assert.equal(config.checkout_max_proxy_attempts, 4);
  assert.equal(config.max_proxy_attempts_per_card, 4);
  assert.equal(config.remote_balance_success_fallback, true);
  assert.equal(config.allow_card_switch, true);
  assert.equal(config.max_card_switches, 2);
  assert.throws(() => normalizePlanConfig({ plan_type: "enterprise" }), /invalid plan_type/);
  assert.throws(() => normalizePlanConfig({ plan_type: "plus", checkout_max_proxy_attempts: 0 }), /between 1 and 1000/);
  assert.throws(() => normalizePlanConfig({ plan_type: "plus", max_proxy_attempts_per_card: 0 }), /between 1 and 1000/);
});

test("plan card groups sort by lower priority first", () => {
  assert.deepEqual(
    normalizePlanCardGroups([
      { card_group_id: 8, priority: 100 },
      { card_group_id: 3, priority: 10 },
      { card_group_id: 2, priority: 10 },
    ]),
    [
      { card_group_id: 2, priority: 10 },
      { card_group_id: 3, priority: 10 },
      { card_group_id: 8, priority: 100 },
    ],
  );
  const runtime = buildPlanRuntimeConfig(
    { plan_type: "go", billing_group_id: 5 },
    [{ card_group_id: 9, priority: 1 }],
  );
  assert.equal(runtime.plan_type, "go");
  assert.equal(runtime.billing_group_id, 5);
  assert.equal(runtime.card_groups[0].card_group_id, 9);
});

test("orders transition timestamps and public summaries stay concise", () => {
  const order = createOrder({
    order_no: "ord_1",
    redeem_code_id: 10,
    plan_type: "pro5x",
  }, 100);
  assert.equal(order.status, OrderStatus.CREATED);
  assert.equal(publicOrderSummary(order).message, "排队中");

  const queued = transitionOrder(order, OrderStatus.QUEUED, 110);
  assert.equal(queued.queued_at, 110);

  const running = transitionOrder(queued, OrderStatus.RUNNING, 120);
  assert.equal(running.started_at, 120);
  assert.equal(publicOrderSummary(running).message, "正在处理");

  const succeeded = transitionOrder(running, OrderStatus.SUCCEEDED, 130);
  assert.equal(succeeded.finished_at, 130);
  assert.deepEqual(publicOrderSummary(succeeded), {
    order_id: "ord_1",
    plan_type: "pro5x",
    plan_name: "Pro 5x",
    status: "succeeded",
    message: "Pro 5x 充值成功",
  });

  const failed = transitionOrder(running, OrderStatus.FAILED, 140);
  assert.equal(
    publicOrderSummary(failed, { plan_type: "pro5x", failure_message: "统一失败文案" }).message,
    "统一失败文案",
  );
});

test("audit logs redact sensitive before/after payloads", () => {
  assert.deepEqual(
    redactAuditPayload({
      note: "ok",
      card_number: "4242424242424242",
      nested: { access_token: "secret", count: 2 },
    }),
    {
      note: "ok",
      card_number: "[redacted]",
      nested: { access_token: "[redacted]", count: 2 },
    },
  );

  const audit = createAuditLog({
    admin_id: 1,
    action: "view_card_secret",
    target_type: "card",
    target_id: "12",
    ip: "127.0.0.1",
    before: { encrypted_number: "abc", note: "old" },
    after: { cvc: "123", note: "new" },
  }, 150);

  assert.equal(audit.admin_id, 1);
  assert.equal(audit.action, "view_card_secret");
  assert.equal(audit.created_at, 150);
  assert.deepEqual(JSON.parse(audit.before_json), { encrypted_number: "[redacted]", note: "old" });
  assert.deepEqual(JSON.parse(audit.after_json), { cvc: "[redacted]", note: "new" });
});
