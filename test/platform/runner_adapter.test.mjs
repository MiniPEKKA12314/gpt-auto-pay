import assert from "node:assert/strict";
import test from "node:test";

import { openPlatformDb, PlatformStore } from "../../src/platform/db.mjs";
import { createFunctionRunnerAdapter, runPlatformOrder, runPlatformOrderWithRetry } from "../../src/platform/runner_adapter.mjs";

function createReadyOrder() {
  const db = openPlatformDb(":memory:");
  const store = new PlatformStore(db, { secretKey: "local-development-secret" });
  const cardGroupId = store.createCardGroup({ name: "primary" }, 10);
  const cardId = store.createCard({
    card_group_id: cardGroupId,
    number: "4242424242421234",
    exp_month: "12",
    exp_year: "2030",
    cvc: "123",
    max_success_count: 10,
  }, 11);
  const billingGroupId = store.createBillingGroup({ name: "US" }, 12);
  const billingAddressId = store.createBillingAddress({
    billing_group_id: billingGroupId,
    name: "Test User",
    country: "US",
    state: "CA",
    city: "Los Angeles",
    line1: "1 Test Ave",
    postal_code: "90001",
  }, 13);
  store.upsertPlanConfig({ plan_type: "plus", billing_group_id: billingGroupId }, 14);
  store.setPlanCardGroups("plus", [{ card_group_id: cardGroupId, priority: 1 }], 15);
  store.createRedeemBatchWithCodes({
    name: "runner batch",
    plan_type: "plus",
    quantity: 1,
    codeFactory: () => "PLUS-RUNNER-1",
  }, 16);
  const locked = store.lockCodeAndCreateOrder({ code: "PLUS-RUNNER-1", order_no: "ord_runner" }, 17);
  return { store, cardId, billingAddressId, orderId: locked.order.id };
}

function createRetryReadyOrder({ cardCount = 1, plan = {} } = {}) {
  const db = openPlatformDb(":memory:");
  const store = new PlatformStore(db, { secretKey: "local-development-secret" });
  const cardGroupId = store.createCardGroup({ name: `retry-primary-${cardCount}` }, 10);
  const cardIds = [];
  const cardNumbers = ["4242424242424242", "4000056655665556", "5555555555554444"];
  for (let index = 0; index < cardCount; index += 1) {
    cardIds.push(store.createCard({
      card_group_id: cardGroupId,
      number: cardNumbers[index],
      exp_month: "12",
      exp_year: "2030",
      cvc: "123",
      priority: index + 1,
      max_success_count: 10,
    }, 11 + index));
  }
  const billingGroupId = store.createBillingGroup({ name: `retry-US-${cardCount}` }, 20);
  const billingAddressId = store.createBillingAddress({
    billing_group_id: billingGroupId,
    name: "Retry User",
    country: "US",
    state: "CA",
    city: "Los Angeles",
    line1: "2 Retry Ave",
    postal_code: "90002",
  }, 21);
  store.upsertPlanConfig({
    plan_type: "plus",
    billing_group_id: billingGroupId,
    ...plan,
  }, 22);
  store.setPlanCardGroups("plus", [{ card_group_id: cardGroupId, priority: 1 }], 23);
  store.createRedeemBatchWithCodes({
    name: `retry batch ${cardCount}`,
    plan_type: "plus",
    quantity: 1,
    codeFactory: () => `PLUS-RETRY-${cardCount}`,
  }, 24);
  const locked = store.lockCodeAndCreateOrder({ code: `PLUS-RETRY-${cardCount}`, order_no: `ord_retry_${cardCount}` }, 25);
  return { store, cardIds, billingAddressId, orderId: locked.order.id };
}

test("runner adapter marks successful orders used and increments card success count", async () => {
  const { store, cardId, billingAddressId, orderId } = createReadyOrder();
  try {
    let observedCard = null;
    const adapter = createFunctionRunnerAdapter(async ({ card, billingAddress, emit }) => {
      observedCard = card;
      assert.equal(billingAddress.id, billingAddressId);
      emit({ level: "info", stage: "fake", message: "fake runner saw resources" });
      return { status: "success", message: "已订阅" };
    });

    const result = await runPlatformOrder(store, orderId, adapter, { now: () => 100 });
    assert.equal(result.ok, true);
    assert.equal(result.order.status, "succeeded");
    assert.equal(result.redeemCode.status, "used");
    assert.equal(result.card.success_count, 1);
    assert.equal(observedCard.id, cardId);
    assert.equal(observedCard.number, "4242424242421234");
    assert.deepEqual(store.listOrderAttempts(orderId).map((attempt) => attempt.status), ["success"]);
    assert.match(store.listRunLogs(orderId).map((log) => log.message).join("\n"), /fake runner saw resources/);
  } finally {
    store.close();
  }
});

test("manual orders use the selected card and billing address", async () => {
  const db = openPlatformDb(":memory:");
  const store = new PlatformStore(db, { secretKey: "local-development-secret" });
  try {
    const defaultGroupId = store.createCardGroup({ name: "manual-default-cards" }, 10);
    store.createCard({
      card_group_id: defaultGroupId,
      number: "4242424242420001",
      exp_month: "12",
      exp_year: "2030",
      cvc: "111",
      max_success_count: 10,
    }, 11);
    const manualGroupId = store.createCardGroup({ name: "manual-selected-cards" }, 12);
    const manualCardId = store.createCard({
      card_group_id: manualGroupId,
      number: "5555555555554444",
      exp_month: "11",
      exp_year: "2031",
      cvc: "222",
      max_success_count: 10,
    }, 13);
    const defaultBillingGroupId = store.createBillingGroup({ name: "manual-default-billing" }, 14);
    store.createBillingAddress({
      billing_group_id: defaultBillingGroupId,
      name: "Default Billing",
      country: "US",
      city: "New York",
      line1: "1 Default St",
      postal_code: "10001",
    }, 15);
    const manualBillingGroupId = store.createBillingGroup({ name: "manual-selected-billing" }, 16);
    const manualBillingAddressId = store.createBillingAddress({
      billing_group_id: manualBillingGroupId,
      name: "Manual Billing",
      country: "US",
      state: "CA",
      city: "Los Angeles",
      line1: "2 Manual Ave",
      postal_code: "90001",
    }, 17);
    store.upsertPlanConfig({ plan_type: "plus", billing_group_id: defaultBillingGroupId }, 18);
    store.setPlanCardGroups("plus", [{ card_group_id: defaultGroupId, priority: 1 }], 19);

    const created = store.createManualOrder({
      plan_type: "plus",
      card_group_id: manualGroupId,
      card_id: manualCardId,
      billing_group_id: manualBillingGroupId,
      billing_address_id: manualBillingAddressId,
      access_token: "manual-at",
      session_token: "manual-session",
    }, 20);

    let observed = null;
    const result = await runPlatformOrderWithRetry(store, created.order.id, async () => createFunctionRunnerAdapter(async (context) => {
      observed = context;
      return { status: "success", message: "manual processed" };
    }), { now: () => 30 });

    assert.equal(result.ok, true);
    assert.equal(observed.card.id, manualCardId);
    assert.equal(observed.card.number, "5555555555554444");
    assert.equal(observed.billingAddress.id, manualBillingAddressId);
    assert.equal(store.getManualOrderOptions(created.order.id).card_id, manualCardId);
    assert.equal(store.listRedeemCodes({ q: "MANUAL" }).length, 0);
  } finally {
    store.close();
  }
});

test("runner adapter releases redeem code on failed execution", async () => {
  const { store, cardId, orderId } = createReadyOrder();
  try {
    const adapter = createFunctionRunnerAdapter(async () => ({ status: "failed", message: "payment declined" }));
    const result = await runPlatformOrder(store, orderId, adapter, { now: () => 200 });
    assert.equal(result.ok, false);
    assert.equal(result.order.status, "failed");
    assert.equal(result.redeemCode.status, "unused");
    assert.equal(store.getCardById(cardId).success_count, 0);
    assert.deepEqual(store.listOrderAttempts(orderId).map((attempt) => attempt.status), ["failed"]);
    assert.match(store.listRunLogs(orderId).map((log) => log.message).join("\n"), /payment declined/);
  } finally {
    store.close();
  }
});

test("runner adapter fails cleanly when no card is available", async () => {
  const db = openPlatformDb(":memory:");
  const store = new PlatformStore(db);
  try {
    const billingGroupId = store.createBillingGroup({ name: "US" }, 1);
    store.createBillingAddress({
      billing_group_id: billingGroupId,
      name: "Test User",
      country: "US",
      city: "Los Angeles",
      line1: "1 Test Ave",
      postal_code: "90001",
    }, 2);
    store.upsertPlanConfig({ plan_type: "plus", billing_group_id: billingGroupId }, 3);
    store.createRedeemBatchWithCodes({
      name: "no card",
      plan_type: "plus",
      quantity: 1,
      codeFactory: () => "PLUS-NOCARD-1",
    }, 4);
    const locked = store.lockCodeAndCreateOrder({ code: "PLUS-NOCARD-1", order_no: "ord_no_card" }, 5);
    const adapter = createFunctionRunnerAdapter(async () => ({ status: "success" }));
    const result = await runPlatformOrder(store, locked.order.id, adapter, { now: () => 300 });
    assert.equal(result.ok, false);
    assert.equal(result.order.status, "failed");
    assert.equal(result.redeemCode.status, "unused");
    assert.match(store.listRunLogs(locked.order.id).map((log) => log.message).join("\n"), /没有可用卡/);
  } finally {
    store.close();
  }
});

test("retried runner retries proxy/page failures with the same card before succeeding", async () => {
  const { store, cardIds, orderId } = createRetryReadyOrder({
    cardCount: 1,
    plan: { max_proxy_attempts_per_card: 3 },
  });
  try {
    const seen = [];
    const result = await runPlatformOrderWithRetry(store, orderId, async ({ retry }) => ({
      async execute({ card }) {
        seen.push([card.id, retry.proxy_attempt_index]);
        if (retry.proxy_attempt_index < 2) {
          return { status: "failed", message: "ECONNRESET from proxy" };
        }
        return { status: "success", message: "订阅成功" };
      },
    }), { now: () => 500 });

    assert.equal(result.ok, true);
    assert.deepEqual(seen, [[cardIds[0], 0], [cardIds[0], 1], [cardIds[0], 2]]);
    assert.deepEqual(store.listOrderAttempts(orderId).map((attempt) => attempt.status), ["failed", "failed", "success"]);
    assert.equal(store.getCardById(cardIds[0]).success_count, 1);
    assert.equal(result.redeemCode.status, "used");
    assert.match(store.listRunLogs(orderId).map((log) => log.message).join("\n"), /继续换代理重试/);
  } finally {
    store.close();
  }
});

test("retried runner does not switch cards for checkout failures", async () => {
  const { store, cardIds, orderId } = createRetryReadyOrder({
    cardCount: 2,
    plan: {
      checkout_max_proxy_attempts: 2,
      max_proxy_attempts_per_card: 2,
      allow_card_switch: true,
      max_card_switches: 1,
    },
  });
  try {
    const seen = [];
    const result = await runPlatformOrderWithRetry(store, orderId, async ({ retry }) => ({
      async execute({ card }) {
        seen.push([card.id, retry.checkout_proxy_attempt_index, retry.proxy_attempt_index]);
        return {
          status: "failed",
          code: "CHECKOUT_FAILED",
          phase: "checkout",
          message: "checkout/create ECONNRESET",
        };
      },
    }), { now: () => 550 });

    assert.equal(result.ok, false);
    assert.deepEqual(seen, [
      [cardIds[0], 0, 0],
      [cardIds[0], 1, 0],
    ]);
    assert.deepEqual(store.listOrderAttempts(orderId).map((attempt) => [attempt.card_id, attempt.status]), [
      [cardIds[0], "failed"],
      [cardIds[0], "failed"],
    ]);
    assert.equal(store.getCardById(cardIds[0]).success_count, 0);
    assert.equal(store.getCardById(cardIds[1]).success_count, 0);
    assert.match(store.listRunLogs(orderId).map((log) => log.message).join("\n"), /提链失败，继续换提链代理重试/);
  } finally {
    store.close();
  }
});

test("retried runner switches cards for declined payments when plan allows it", async () => {
  const { store, cardIds, orderId } = createRetryReadyOrder({
    cardCount: 2,
    plan: {
      max_proxy_attempts_per_card: 2,
      allow_card_switch: true,
      max_card_switches: 1,
    },
  });
  try {
    const seenCards = [];
    const result = await runPlatformOrderWithRetry(store, orderId, async () => ({
      async execute({ card }) {
        seenCards.push(card.id);
        if (card.id === cardIds[0]) {
          return { status: "failed", message: "Payment was not approved" };
        }
        return { status: "success", message: "第二张卡订阅成功" };
      },
    }), { now: () => 600 });

    assert.equal(result.ok, true);
    assert.deepEqual(seenCards, cardIds);
    assert.deepEqual(store.listOrderAttempts(orderId).map((attempt) => [attempt.card_id, attempt.status]), [
      [cardIds[0], "failed"],
      [cardIds[1], "success"],
    ]);
    assert.equal(store.getCardById(cardIds[0]).success_count, 0);
    assert.equal(store.getCardById(cardIds[1]).success_count, 1);
    assert.match(store.listRunLogs(orderId).map((log) => log.message).join("\n"), /切换下一张卡重试/);
  } finally {
    store.close();
  }
});


test("runner adapter unfreezes VCC cards before use and freezes after success", async () => {
  const { store, cardId, orderId } = createReadyOrder();
  try {
    store.updateCard(cardId, {
      provider: "vcc",
      provider_card_id: "remote-success-1",
      auto_unfreeze_before_use: true,
      auto_freeze_after_success: true,
      auto_freeze_after_failure: true,
    }, 90);
    const actions = [];
    const cardProviderFactory = () => ({
      async enableCard(target) {
        actions.push(["enable", target.cardId, target.cardNum]);
        return { ok: true, action: "enable" };
      },
      async suspendCard(target) {
        actions.push(["suspend", target.cardId, target.cardNum]);
        return { ok: true, action: "suspend" };
      },
    });
    const adapter = createFunctionRunnerAdapter(async () => ({ status: "success", message: "done" }));

    const result = await runPlatformOrder(store, orderId, adapter, { now: () => 700, cardProviderFactory });

    assert.equal(result.ok, true);
    assert.deepEqual(actions.map((item) => item[0]), ["enable", "suspend"]);
    assert.equal(actions[0][1], "remote-success-1");
    assert.equal(actions[0][2], "4242424242421234");
    const logs = store.listRunLogs(orderId).map((log) => log.stage);
    assert.equal(logs.includes("card_unfreeze"), true);
    assert.equal(logs.includes("card_freeze"), true);
  } finally {
    store.close();
  }
});

test("retried runner freezes failed VCC card before switching to next card", async () => {
  const { store, cardIds, orderId } = createRetryReadyOrder({
    cardCount: 2,
    plan: { allow_card_switch: true, max_card_switches: 1, max_proxy_attempts_per_card: 1 },
  });
  try {
    for (const [index, cardId] of cardIds.entries()) {
      store.updateCard(cardId, {
        provider: "vcc",
        provider_card_id: `remote-${index + 1}`,
        auto_unfreeze_before_use: true,
        auto_freeze_after_success: true,
        auto_freeze_after_failure: true,
      }, 800 + index);
    }
    const actions = [];
    const cardProviderFactory = () => ({
      async enableCard(target) {
        actions.push(["enable", target.cardId]);
        return { ok: true };
      },
      async suspendCard(target) {
        actions.push(["suspend", target.cardId]);
        return { ok: true };
      },
    });
    const result = await runPlatformOrderWithRetry(store, orderId, async () => ({
      async execute({ card }) {
        if (card.id === cardIds[0]) return { status: "failed", message: "Payment was not approved" };
        return { status: "success", message: "second ok" };
      },
    }), { now: () => 900, cardProviderFactory });

    assert.equal(result.ok, true);
    assert.deepEqual(actions, [
      ["enable", "remote-1"],
      ["suspend", "remote-1"],
      ["enable", "remote-2"],
      ["suspend", "remote-2"],
    ]);
    assert.equal(store.getCardById(cardIds[0]).success_count, 0);
    assert.equal(store.getCardById(cardIds[1]).success_count, 1);
  } finally {
    store.close();
  }
});
