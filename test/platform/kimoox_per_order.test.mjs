import assert from "node:assert/strict";
import test from "node:test";

import { openPlatformDb, PlatformStore } from "../../src/platform/db.mjs";
import { runPlatformOrderWithRetry } from "../../src/platform/runner_adapter.mjs";
import { createPlatformPaymentAdapterFactory } from "../../src/platform/order_processor.mjs";
import { prepareKimooxPerOrderCard, queryVccStoredCardBalance } from "../../src/platform/card_lifecycle.mjs";

test("Kimoox per-order mode opens a new card, runs payment, then withdraws and cancels", async () => {
  const db = openPlatformDb(":memory:");
  const store = new PlatformStore(db, { secretKey: "local-development-secret" });
  try {
    const cardGroupId = store.createCardGroup({ name: "kimoox temp cards" }, 10);
    const billingGroupId = store.createBillingGroup({ name: "kimoox billing" }, 11);
    store.createBillingAddress({
      billing_group_id: billingGroupId,
      name: "Kimoox User",
      country: "US",
      state: "CA",
      city: "Los Angeles",
      line1: "1 Kimoox Ave",
      postal_code: "90001",
    }, 12);
    store.upsertPlanConfig({
      plan_type: "plus",
      enabled: true,
      billing_group_id: billingGroupId,
      vcc_target_balance_usd: "30.00",
      kimoox_issue_mode: "per_order",
      kimoox_card_bin_id: "bin-1001",
      kimoox_card_type: "PREPAID",
      kimoox_holder_id: "holder-1",
      kimoox_reclaim_balance: true,
      kimoox_cancel_after_order: true,
    }, 13);
    store.setPlanCardGroups("plus", [{ card_group_id: cardGroupId, priority: 1 }], 14);
    store.setCardProviderConfig("kimoox", { base_url: "https://kimoox.test", api_key: "ak", api_secret: "sk", webhook_secret: "wh" }, 15);
    store.createRedeemBatchWithCodes({ name: "kimoox batch", plan_type: "plus", quantity: 1, codeFactory: () => "PLUS-KIMOOX-ORDER" }, 16);
    const locked = store.lockCodeAndCreateOrder({ code: "PLUS-KIMOOX-ORDER", order_no: "ord_kimoox_per_order" }, 17);
    store.setOrderRuntimeSecrets(locked.order.id, { accessToken: "at", sessionToken: "st" }, 18);

    const actions = [];
    let paid = false;
    let cashOutSubmitted = false;
    let cancelSubmitted = false;
    const provider = {
      async openCard(input) {
        actions.push("open:" + input.cardBinId + ":" + input.rechargeAmount);
        return { taskId: "task-1", batchNo: "batch-1", requestNo: input.requestNo, applyStatus: "SUBMITTED" };
      },
      async getOpenCardDetail(input) {
        actions.push("detail:" + (input.batchNo || input.taskId));
        return { taskId: "task-1", batchNo: "batch-1", applyStatus: "SUCCESS", taskStatus: "SUCCESS", successCount: 1 };
      },
      async listCardsWithPrivateInfo(input) {
        actions.push("private:" + (input.batchNo || input.cardId || ""));
        return [{ provider_card_id: "kc-1", number: "4242424242424242", exp_month: "12", exp_year: "2030", cvc: "123", masked_number: "4242****4242", card_balance: "30.00" }];
      },
      async listCards(input) {
        actions.push("balance:" + (input.cardId || ""));
        return [{
          provider_card_id: "kc-1",
          card_balance: cashOutSubmitted ? "0.00" : paid ? "12.34" : "30.00",
          masked_number: "4242****4242",
          state: cancelSubmitted ? "CANCELLED" : "ACTIVE",
        }];
      },
      async rechargeCard() {
        actions.push("unexpected-recharge");
        return { requestNo: "r" };
      },
      async cashOutCard(input) {
        actions.push("cashout:" + input.amount);
        if (input.amount === "12.33") {
          throw new Error("Kimoox API HTTP 500: 转出金额不能大于可转出余额，最多可转出 12.32 USD");
        }
        cashOutSubmitted = true;
        return { status: "PENDING", amount: input.amount, requestNo: input.requestNo };
      },
      async cancelCard(input) {
        actions.push("cancel:" + input.cardId);
        cancelSubmitted = true;
        return { status: "SUBMITTED", requestNo: input.requestNo };
      },
      async enableCard() { actions.push("unexpected-enable"); return {}; },
      async suspendCard() { actions.push("unexpected-freeze"); return {}; },
    };
    let directCard = null;
    const factory = createPlatformPaymentAdapterFactory({
      checkoutAdapterFactory: () => ({
        async execute() {
          actions.push("checkout");
          return { ok: true, status: "success", checkoutInput: "oaics_kimoox", checkout_input: "oaics_kimoox" };
        },
      }),
      directCardAdapterFactory: () => ({
        async execute(context) {
          directCard = context.card;
          actions.push("direct:" + context.card.provider_card_id);
          paid = true;
          return { ok: true, status: "success", message: "订阅成功" };
        },
      }),
    });

    const result = await runPlatformOrderWithRetry(store, locked.order.id, factory, { now: () => 500, cardProviderFactory: () => provider });
    assert.equal(result.ok, true);
    assert.equal(result.order.status, "succeeded");
    assert.equal(directCard.provider_card_id, "kc-1");
    assert.equal(store.getCardById(directCard.id).deleted_at > 0, true);
    assert.deepEqual(actions, [
      "checkout",
      "open:bin-1001:30.00",
      "detail:batch-1",
      "private:batch-1",
      "balance:kc-1",
      "direct:kc-1",
      "balance:kc-1",
      "cashout:12.33",
      "cashout:12.32",
      "balance:kc-1",
      "cancel:kc-1",
      "balance:kc-1",
    ]);
  } finally {
    store.close();
  }
});

test("Kimoox opens a fresh remote card after the configured per-card attempts are exhausted", async () => {
  const db = openPlatformDb(":memory:");
  const store = new PlatformStore(db, { secretKey: "local-development-secret" });
  try {
    const cardGroupId = store.createCardGroup({ name: "kimoox retry cards" }, 100);
    const billingGroupId = store.createBillingGroup({ name: "kimoox retry billing" }, 101);
    store.createBillingAddress({
      billing_group_id: billingGroupId,
      name: "Retry User",
      country: "US",
      state: "CA",
      city: "Los Angeles",
      line1: "2 Kimoox Ave",
      postal_code: "90002",
    }, 102);
    store.upsertPlanConfig({
      plan_type: "plus",
      billing_group_id: billingGroupId,
      card_source: "kimoox",
      vcc_target_balance_usd: "20.00",
      max_proxy_attempts_per_card: 1,
      remote_max_cards: 2,
      kimoox_card_bin_id: "bin-retry",
      kimoox_card_type: "PREPAID",
      remote_failure_withdraw: false,
      remote_failure_final_action: "cancel",
      remote_success_withdraw: false,
      remote_success_final_action: "cancel",
    }, 103);
    store.setPlanCardGroups("plus", [{ card_group_id: cardGroupId, priority: 1 }], 104);
    store.setCardProviderConfig("kimoox", { base_url: "https://kimoox.test", api_key: "ak", api_secret: "sk", webhook_secret: "wh" }, 105);
    store.createRedeemBatchWithCodes({ name: "kimoox retry batch", plan_type: "plus", quantity: 1, codeFactory: () => "PLUS-KIMOOX-RETRY" }, 106);
    const locked = store.lockCodeAndCreateOrder({ code: "PLUS-KIMOOX-RETRY", order_no: "ord_kimoox_retry" }, 107);
    store.setOrderRuntimeSecrets(locked.order.id, { accessToken: "at", sessionToken: "st" }, 108);

    let opened = 0;
    const cancelled = [];
    const provider = {
      async openCard(input) {
        opened += 1;
        return { taskId: `task-${opened}`, batchNo: `batch-${opened}`, requestNo: input.requestNo, applyStatus: "SUBMITTED" };
      },
      async getOpenCardDetail(input) {
        const suffix = String(input.batchNo || input.taskId).match(/(\d+)$/)?.[1] || "1";
        return { taskId: `task-${suffix}`, batchNo: `batch-${suffix}`, applyStatus: "SUCCESS", taskStatus: "SUCCESS", successCount: 1 };
      },
      async listCardsWithPrivateInfo(input) {
        const suffix = String(input.batchNo || input.cardId).match(/(\d+)$/)?.[1] || "1";
        return [{ provider_card_id: `kc-${suffix}`, number: `42424242424242${suffix}${suffix}`, exp_month: "12", exp_year: "2030", cvc: "123", masked_number: `4242****42${suffix}${suffix}` }];
      },
      async listCards(input) {
        const id = String(input.cardId || "kc-1");
        return [{ provider_card_id: id, card_balance: "20.00", masked_number: "4242****4242", state: cancelled.includes(id) ? "CANCELLED" : "ACTIVE" }];
      },
      async cancelCard(input) {
        cancelled.push(input.cardId);
        return { status: "SUBMITTED", requestNo: input.requestNo };
      },
      async rechargeCard() { throw new Error("unexpected recharge"); },
      async cashOutCard() { throw new Error("unexpected cash out"); },
      async enableCard() { return {}; },
      async suspendCard() { return {}; },
    };
    const usedCards = [];
    const factory = createPlatformPaymentAdapterFactory({
      checkoutAdapterFactory: () => ({
        async execute() {
          return { ok: true, status: "success", checkoutInput: "oaics_kimoox_retry", checkout_input: "oaics_kimoox_retry" };
        },
      }),
      directCardAdapterFactory: () => ({
        async execute(context) {
          usedCards.push(context.card.provider_card_id);
          if (usedCards.length === 1) return { ok: false, status: "failed", code: "DIRECT_CARD_DECLINED", message: "Payment was not approved" };
          return { ok: true, status: "success", message: "subscription confirmed" };
        },
      }),
    });

    const result = await runPlatformOrderWithRetry(store, locked.order.id, factory, { now: () => 700, cardProviderFactory: () => provider });
    assert.equal(result.ok, true);
    assert.equal(result.order.status, "succeeded");
    assert.deepEqual(usedCards, ["kc-1", "kc-2"]);
    assert.equal(opened, 2);
    assert.deepEqual(cancelled, ["kc-1", "kc-2"]);
    assert.match(store.listRunLogs(locked.order.id).map((log) => log.message).join("\n"), /新开下一张卡/);
  } finally {
    store.close();
  }
});

test("Kimoox balance lookup fails when the requested card is absent", async () => {
  const store = new PlatformStore(openPlatformDb(":memory:"));
  try {
    await assert.rejects(
      queryVccStoredCardBalance({
        store,
        card: { provider: "kimoox", provider_card_id: "wanted-card", number: "4242424242424242" },
        cardProviderFactory: () => ({
          async listCards() {
            return [{ provider_card_id: "different-card", number: "5555555555554444", card_balance: "99.00" }];
          },
        }),
      }),
      (error) => error.code === "KIMOOX_CARD_NOT_FOUND",
    );
  } finally {
    store.close();
  }
});

test("Kimoox open-card webhook can complete a pending API task", async () => {
  const store = new PlatformStore(openPlatformDb(":memory:"), { secretKey: "local-development-secret" });
  try {
    const cardGroupId = store.createCardGroup({ name: "webhook cards" }, 800);
    const retryRuntime = {};
    const provider = {
      async openCard(input) {
        store.insertWebhookEvent({
          provider: "kimoox",
          event_id: "evt-open-success",
          event_type: "CARD_OPEN.SUCCESS",
          payload: {
            eventId: "evt-open-success",
            eventType: "CARD_OPEN.SUCCESS",
            data: { requestNo: input.requestNo, cardId: "webhook-card-1", status: "SUCCESS" },
          },
        }, 801);
        return { requestNo: input.requestNo, applyStatus: "SUBMITTED" };
      },
      async getOpenCardDetail() {
        return { applyStatus: "SUBMITTED" };
      },
      async listCardsWithPrivateInfo(input) {
        assert.equal(input.cardId, "webhook-card-1");
        return [{
          provider_card_id: "webhook-card-1",
          number: "4242424242424242",
          exp_month: "12",
          exp_year: "2030",
          cvc: "123",
          masked_number: "4242****4242",
        }];
      },
    };
    const result = await prepareKimooxPerOrderCard({
      store,
      order: { id: 1, order_no: "ord_webhook_open" },
      plan: {
        card_source: "kimoox",
        card_groups: [{ card_group_id: cardGroupId, priority: 1 }],
        vcc_target_balance_usd: "20.00",
        kimoox_card_bin_id: "bin-webhook",
        kimoox_card_type: "PREPAID",
      },
      retryRuntime,
      emit() {},
      cardProviderFactory: () => provider,
      kimooxOpenTimeoutMs: 1000,
      now: () => 802,
    });
    assert.equal(result.ok, true);
    assert.equal(result.card.provider_card_id, "webhook-card-1");
    assert.equal(retryRuntime.kimooxRequestNo.includes("ord_webhook_open"), true);
  } finally {
    store.close();
  }
});

test("Kimoox open-card detail timeout records the request and fails once", async () => {
  const store = new PlatformStore(openPlatformDb(":memory:"), { secretKey: "local-development-secret" });
  try {
    const cardGroupId = store.createCardGroup({ name: "timeout cards" }, 900);
    const retryRuntime = {};
    let opens = 0;
    await assert.rejects(
      prepareKimooxPerOrderCard({
        store,
        order: { id: 2, order_no: "ord_open_timeout" },
        plan: {
          card_source: "kimoox",
          card_groups: [{ card_group_id: cardGroupId, priority: 1 }],
          vcc_target_balance_usd: "20.00",
          kimoox_card_bin_id: "bin-timeout",
          kimoox_card_type: "PREPAID",
        },
        retryRuntime,
        emit() {},
        cardProviderFactory: () => ({
          async openCard(input) {
            opens += 1;
            return { requestNo: input.requestNo, taskId: "pending-task", applyStatus: "SUBMITTED" };
          },
          async getOpenCardDetail() { return { taskId: "pending-task", applyStatus: "SUBMITTED" }; },
          async listCardsWithPrivateInfo() { return []; },
        }),
        kimooxOpenTimeoutMs: 1000,
        now: () => 901,
      }),
      (error) => error.code === "KIMOOX_OPEN_CARD_TIMEOUT",
    );
    assert.equal(opens, 1);
    assert.equal(retryRuntime.kimooxOpenSubmitted, true);
    assert.equal(Boolean(retryRuntime.kimooxRequestNo), true);
  } finally {
    store.close();
  }
});
