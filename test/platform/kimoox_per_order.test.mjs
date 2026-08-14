import assert from "node:assert/strict";
import test from "node:test";

import { openPlatformDb, PlatformStore } from "../../src/platform/db.mjs";
import { runPlatformOrderWithRetry } from "../../src/platform/runner_adapter.mjs";
import { createPlatformPaymentAdapterFactory } from "../../src/platform/order_processor.mjs";

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
